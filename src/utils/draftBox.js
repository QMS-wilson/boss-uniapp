/**
 * 草稿箱 —— 手动草稿的唯一业务入口（cache store 保持薄，只管桶的读写）
 *
 * 两类东西共用一个桶（`jxc_drafts:<商户码>[:<账套>]`），但**语义完全不同**：
 *   手动草稿  type=`salesbill.manual` / `purchasebill.manual`
 *             存的是**表单形状**（回填即所见即所得），永不自动提交，只能人手动点「提交」
 *   断网草稿  type=`salesbill.create` / `salesbill.update`（…阶段 4 起加 purchasebill.*）
 *             存的是**提交 payload**，联网/冷启动由 flushDrafts 自动重放
 *
 * ★ 为什么手动草稿不会被自动传上去：`flushDrafts()` 的白名单只认 `*.create` / `*.update`，
 *   `*.manual` 落到 else 分支 `continue`。这条不变量是"半填的单子绝不能变成真单"的唯一防线，
 *   改白名单时必须一起想清楚（所以判据也钉在 scripts/check-draft-box.js 里）。
 * ★ 手动草稿提交走的是现有 `client_token` 幂等（submitToken 随草稿一起存），
 *   所以"提交后响应丢了再点一次"不会重复建单。
 */
import { useCacheStore } from '../store/cache'
import { merchantCode, selectedDatabase } from './merchant'
import { toast } from './format'

const TTL_KEY = 'cfg:draftTtlDays'
const TTL_DEFAULT = 30
const DAY = 24 * 60 * 60 * 1000
/** 草稿桶软上限：只提醒不自动删 —— 自动删人的东西得他自己同意 */
const SOFT_CAP = 100
/** 退出开单时留不留草稿（默认开，见 billExitAsk） */
const EXIT_ASK_KEY = 'cfg:billExitAsk'
/** 开单明细那句库存提示（默认开，见 billStockWarn） */
const STOCK_WARN_KEY = 'cfg:billStockWarn'
/** 单价 0 元的明细行是否必须记成赠品（**默认关**，见 billZeroGift） */
const ZERO_GIFT_KEY = 'cfg:billZeroGift'

export const DRAFT_TTL_OPTIONS = [7, 15, 30, 60, 90, 180, 365]

/** kind 只有两个取值：'sales' | 'purchase' */
export function manualType(kind) {
  return (kind === 'purchase' ? 'purchasebill' : 'salesbill') + '.manual'
}
function kindOfType(type) {
  const t = String(type || '')
  if (t.indexOf('salesbill.') === 0) return 'sales'
  if (t.indexOf('purchasebill.') === 0) return 'purchase'
  return ''
}
function isManual(d) {
  return String((d || {}).type || '').slice(-7) === '.manual'
}
/** 单据类草稿（手动 + 断网）才算草稿箱里的东西；客户/商品/打印那些不参与（阶段 5 摘除） */
function isBillDraft(d) {
  return kindOfType((d || {}).type) !== ''
}
/** 「MM-DD HH:mm」—— 草稿行与开单页标题区共用同一写法（两处各排一次日期迟早不一致） */
export function draftStampText(stamp) {
  const d = new Date(Number(stamp) || 0)
  const p = (x) => String(x).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/** 一条草稿"最后一次被改"的时间：断网草稿没有 savedAt，退到 createdAt */
export function draftStamp(d) {
  return Number((d || {}).savedAt) || Number((d || {}).createdAt) || 0
}

/** 这条草稿属不属于"现在这一家、这一本账"（两道归属过滤，与 flushDrafts 同一口径） */
function isMine(d) {
  return String((d || {}).mkt || '') === merchantCode()
    && String((d || {}).db || '') === selectedDatabase()
}

/* ---------------- 配置项 ---------------- */
export function draftTtlDays() {
  const v = Number(uni.getStorageSync(TTL_KEY))
  return v >= 1 ? Math.round(v) : TTL_DEFAULT
}
export function setDraftTtlDays(days) {
  const v = Number(days)
  if (v >= 1) uni.setStorageSync(TTL_KEY, Math.round(v))
  return draftTtlDays()
}
/** 还剩几天（向上取整；已经过期回 0 或负数，由调用方分流） */
export function remainingDays(d, ttl) {
  const used = ttl || draftTtlDays()
  return Math.ceil((expiryAt(d, used) - Date.now()) / DAY)
}

/**
 * 这条草稿"该在什么时候出桶"的唯一算法 —— 剪枝与显示必须共用它，
 * 否则会出现界面上写着「剩 3 天」、下次启动却被剪掉。
 * ★ 单条续期（用户在草稿行点「留下」）走 `keepUntil`，**不去改 savedAt**：
 *   savedAt 同时驱动界面上的「存于 …」，改它就等于篡改"这张草稿是什么时候留的"。
 */
export function expiryAt(d, ttl) {
  const keep = Number((d || {}).keepUntil) || 0
  if (keep > 0) return keep
  return draftStamp(d) + (ttl || draftTtlDays()) * DAY
}
export function isExpired(d, ttl) {
  return expiryAt(d, ttl) <= Date.now()
}
/**
 * 单条续期：从**现在**起再留 `days` 天（默认按当前保留天数那一档）。
 * 不给无限期 —— 桶只进不出的话，100 条软上限会变成天天弹提醒。
 */
export function extendDraft(id, days) {
  const cache = useCacheStore()
  const d = cache.drafts.find((x) => x.id === id)
  if (!d) return 0
  const n = Number(days) >= 1 ? Math.round(Number(days)) : draftTtlDays()
  const until = Date.now() + n * DAY
  cache.updateDraft(id, { keepUntil: until })
  return until
}

/**
 * 退出开单页时留不留草稿（配置项，**默认开**）。
 * ★ 默认开的写法是「只有明确存过 false 才算关」：没设过时 getStorageSync 回的是空串，
 *   不是 false —— 拿 `=== true` 判就把默认写成了关。
 * ★ 关掉之后**两条都不做**：既不弹框，也不在离开那一刻静默存一条。
 *   人说的是"别问我"，那也不能替他做"留一条他没点过的草稿"。
 */
export function billExitAsk() {
  return uni.getStorageSync(EXIT_ASK_KEY) !== false
}
export function setBillExitAsk(on) {
  uni.setStorageSync(EXIT_ASK_KEY, !!on)
  return billExitAsk()
}

/**
 * 开单明细上那句库存提示开不开（配置项，**默认关** — 2026-10-10 用户改）。
 *
 * ★ 改的是默认值，不是判法：仍然用 `!== false` 这种"没设过 storage 就是默认态"的写法，
 *   只是默认态从"开"翻成"关" ⇒ 判据必须改成 `=== true`
 *   （没设过时 getStorageSync 回的是空串，用 `!== false` 判会把默认又写回打开）。
 * ★ 它**只关那句提示**，不动任何数：件数、合计、折合、能不能提交全都不变 ——
 *   关掉的理由是"这本账的库存数字本来就没人信"，不是"这货真能超卖"。
 */
export function billStockWarn() {
  return uni.getStorageSync(STOCK_WARN_KEY) === true
}
export function setBillStockWarn(on) {
  uni.setStorageSync(STOCK_WARN_KEY, !!on)
  return billStockWarn()
}

/**
 * 单价 0 元的明细行是否**必须**记成赠品（配置项，**默认开** — 2026-10-10 用户改）。
 *
 * ★ 2026-10-10 与上面那个开关**对调了默认值**，所以两极性的判法也跟着换：
 *   上一个从 `!== false` 改成 `=== true`，这一个从 `=== true` 改成 `!== false`。
 *   两个都改完，"没设过 storage" 时读出来才是用户要的那一对默认态。
 * ★ 不管开不开，开单页都会在"单价填成 0"那一刻问一句要不要记赠品；
 *   这个开关只决定**不记赠品时让不让提交**。
 */
export function billZeroGift() {
  return uni.getStorageSync(ZERO_GIFT_KEY) !== false
}
export function setBillZeroGift(on) {
  uni.setStorageSync(ZERO_GIFT_KEY, !!on)
  return billZeroGift()
}

/* ---------------- 读写 ---------------- *//**
 * 存一张手动草稿。带着 `form.draftId` 就是**原地覆盖**（createdAt 不变，只动 form 与 savedAt），
 * 否则新建一条。返回草稿 id（页面把它揣在 form.draftId 里，下次覆盖同一条）。
 *
 * `auto=true` 只改**来源标记**（草稿行上写「自动存于」而不是「存于」），类型仍是 `*.manual` ⇒
 * 一样不进自动重放的白名单。开单页被小程序/H5 后退那种拦不住的退出带走时用它；
 * 人自己点过「存草稿」之后要把这个标记清掉（那是他手动留的，别再写成系统替他留的）。
 */
export function saveManualDraft(kind, form, submitToken, auto) {
  const cache = useCacheStore()
  const now = Date.now()
  const src = Object.assign({}, form || {})
  const id = src.draftId && cache.drafts.some((d) => d.id === src.draftId && isManual(d))
    ? src.draftId : ''
  if (id) {
    cache.updateDraft(id, { form: src, savedAt: now, auto: !!auto, submitToken: submitToken || undefined })
    _capNotice(cache)
    return id
  }
  const d = cache.putDraft({
    id: 'draft_' + now + '_' + Math.random().toString(36).slice(2, 6),
    mkt: merchantCode(), db: selectedDatabase(),
    type: manualType(kind),
    createdAt: now, savedAt: now, auto: !!auto,
    form: src, submitToken: submitToken || '',
  })
  _capNotice(cache)
  return d.id
}

function _capNotice(cache) {
  if (cache.drafts.length >= SOFT_CAP) {
    toast('草稿已有 ' + cache.drafts.length + ' 条，建议清理后再存（不会自动删你的草稿）')
  }
}

/**
 * 当前商户+账套桶内某一类单据的全部草稿，手动与断网合并、按最后修改时间倒序。
 * 每行带：origin('manual'|'offline') / kind / remainingDays / stamp。
 */
export function listDrafts(kind) {
  const ttl = draftTtlDays()
  return useCacheStore().drafts
    .filter((d) => isMine(d) && isBillDraft(d) && (!kind || kindOfType(d.type) === kind))
    .map((d) => Object.assign({}, d, {
      origin: isManual(d) ? 'manual' : 'offline',
      kind: kindOfType(d.type),
      stamp: draftStamp(d),
      remainingDays: remainingDays(d, ttl),
    }))
    .sort((a, b) => b.stamp - a.stamp)
}

/** 角标用的计数：不传 kind 就是全部 */
export function countDrafts(kind) {
  return listDrafts(kind).length
}

/** 首页待办：N 张草稿将在 X 天内过期（过期本身会被 prune 掉，所以只看 0~days） */
export function expiringDrafts(withinDays, kind) {
  const n = Number(withinDays) || 3
  return listDrafts(kind).filter((d) => d.remainingDays <= n)
}

export function removeDraft(id) {
  useCacheStore().removeDraft(id)
}

/** 草稿页/编辑页回填时读那一条（不属于本商户本账套的一律读不到） */
export function getDraft(id) {
  return listDrafts().find((d) => d.id === id) || null
}

/**
 * 断网草稿「立即上传」：走与 flushDrafts 完全同一份重放逻辑的单条版。
 * 成功即出桶；失败把原因带回去（不静默吞掉，否则人以为传上去了）。
 */
export async function upgradeOfflineDraft(id) {
  const cache = useCacheStore()
  const d = cache.drafts.find((x) => x.id === id)
  if (!d) return { ok: false, message: '这条草稿已经不在了' }
  if (isManual(d)) return { ok: false, message: '手动草稿要进编辑页点「提交」，它不参与自动上传' }
  if (!isMine(d)) return { ok: false, message: '这条草稿不属于当前商户或当前账套' }
  const r = await cache.replayDraft(d)
  if (r && r.ok) return { ok: true }
  return { ok: false, message: (r && r.message) || '上传失败' }
}

/**
 * 按配置天数剪枝。启动时跑一次 ⇒ 把天数改小之后，超期草稿下次启动就没了。
 * ★ 只动"归属明确"的条目：mkt/db 对不上或干脆没有标记的旧草稿留在桶里，
 *   它们在界面上本来就不可见，删掉换来的风险大于收益（与 flushDrafts 的克制一致）。
 */
export function pruneDrafts() {
  if (!merchantCode()) return 0   // 没配连接时桶键是裸键，里面可能是别家的历史数据 ⇒ 一律不动
  const ttl = draftTtlDays()
  const cache = useCacheStore()
  const keep = []
  let dropped = 0
  for (const d of cache.drafts) {
    // ★ 判过期只走 isExpired 一份实现（续期过的那条看 keepUntil，没续期的看"存于 + 天数"）
    if (isMine(d) && isBillDraft(d) && isExpired(d, ttl)) { dropped++; continue }
    keep.push(d)
  }
  if (dropped) cache.setDrafts(keep)
  return dropped
}
