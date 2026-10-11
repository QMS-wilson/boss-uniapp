/**
 * 「本地服务掉线」这条系统通知的判据与文案（纯函数，好让 Node 门能真调它 ——
 * 这里只碰 storage，不发请求、不碰 plus）。
 *
 * ★★ 判据是「**这一段**掉线我没报过」，而不是「我亲眼见过它在线」。两个时刻都问云端要
 *   （云端一直盯着那台机器），本机只记住"为哪一段报过"：
 *     身份键 = 最后一次上线时刻 + 最后一次离线时刻
 *     发的前提 = 见过上线 + 离线距今不超过 FRESH_MS + 这个键还没报过
 *   ★ 为什么不能拿"我采到过在线"当依据（2026-10-05 现场的教训）：应用 90 秒采一次，
 *     那台机器只在线了 1 分 51 秒，整段被跳过 —— 应用永远不知道它曾经在线过，
 *     于是那次掉线一声不响。采样采不到的事实，得由一直看着的那一方给。
 *   ★ 为什么还要 FRESH_MS：应用关了一周再打开，"离线"是陈年事实，页面本来就写着，
 *     这时候弹一条"一周前掉的"纯属噪音。
 *   ★ 为什么还要"见过上线"：那台机器从来没接入过（还没装机、装错了家）不叫掉线。
 *
 * ★★ 旧云端（还没带上这两个时刻）时两个值都是 0 ⇒ 退回「我采到过在线才算」的老判据。
 *   绝不拿"本次读数时刻"冒充云端给的离线时刻 —— 那会把陈年离线判成刚掉的，装机就吵人。
 *
 * ★★ 为什么「读不到」绝不能当成「掉线」：带 cacheKey 的读请求断网时会退到离线缓存
 *   （utils/request.js 的 offlineOk），把缓存里的旧状态当实况会出现两种错：自己断网那一刻
 *   报"本地服务掉线"，或者缓存里那句旧的"在线"把真掉线盖掉。⇒ 只有真从云端读回来的布尔值
 *   参与判定，读不到就原样留着上次状态 —— 既不发，也不清空。
 *
 * ★ 单位：云端给的是 unix **秒**，本文件一律用**毫秒**（与 Date.now() 同单位）；
 *   换算只发生在 utils/agentWatch.js 读回来的那一处，别在这里乘第二遍。
 *
 * ★ 状态键带商户码：这台机器换过一家之后，别家的在线/离线记录不能接着参与判定。
 */
// ★ 带 .js 扩展名：门脚本是 Node 直接 import，Node ESM 不补扩展名。
import { merchantCode } from './merchant.js'
import { fmtDate } from './format.js'

/** 提醒开关（**默认开**：与 cfg:billStockWarn 同一判法 —— 只有存了 false 才算关） */
export const NOTICE_TOGGLE_KEY = 'cfg:agentNotice'
/** 掉线多久以内还值得补一条通知（毫秒）。过了这个点，页面写着离线就够了 */
export const FRESH_MS = 30 * 60 * 1000
const STATE_PREFIX = 'jxc_agent_state:'

function pos(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function agentNoticeOn() {
  return uni.getStorageSync(NOTICE_TOGGLE_KEY) !== false
}

/** 落一次开关，返回**读回来的值**（写不进去也得说实话，别让界面停在假状态上） */
export function setAgentNotice(on) {
  uni.setStorageSync(NOTICE_TOGGLE_KEY, !!on)
  return agentNoticeOn()
}

function stateKey(store) {
  return STATE_PREFIX + merchantCode() + '|' + String(store || '')
}

/** 上一次记下的这台服务状态；没读过返回 null（这就是「第一眼」） */
export function readAgentState(store) {
  const v = uni.getStorageSync(stateKey(store))
  if (!v || typeof v !== 'object') return null
  if (v.online !== true && v.online !== false) return null
  // 老版本存的是 {online, at}：缺 onAt/notifiedFor 就按 0/空串走，不猜
  return { online: v.online, at: pos(v.at), onAt: pos(v.onAt), notifiedFor: String(v.notifiedFor || '') }
}

/**
 * 记一次状态。
 * ★ 只认布尔：把"没读到/脏值"折算成 false 写进去，等于亲手把一条已知在线的记录改成离线 ——
 *   下一次判定就成了"上次在线、这次没在线"，发出一条根本没发生过的通知。
 * @returns {boolean} 写没写成
 */
export function writeAgentState(store, st) {
  const online = st && st.online
  if (online !== true && online !== false) return false
  uni.setStorageSync(stateKey(store), {
    online, at: pos(st.at), onAt: pos(st.onAt), notifiedFor: String(st.notifiedFor || ''),
  })
  return true
}

/**
 * 那条通知长什么样。
 * @param {string} title 店铺显示名（空串就不提店名，别让通知里出现「『』」）
 * @param {number} offAt 断开那一刻（毫秒，云端给的就用云端的 —— 比"我发现"准）
 */
export function agentDownNotice(title, offAt) {
  const who = String(title || '').trim()
  const when = fmtDate(pos(offAt) || 0, true)
  return {
    title: '本地服务已断开',
    content: (who ? '「' + who + '」的' : '') + '本地服务连不上了'
      + (when ? '（' + when + ' 断开）' : '')
      + '，开单、查库存、打印都要等它恢复',
    // payload 必须是字符串：它是原样过一遍系统通知再回给应用的
    payload: JSON.stringify({ kind: 'agent-down', store: who, at: pos(offAt) }),
  }
}

/**
 * 判定这一次要不要发。
 * @param {object|null} prev 上次记下的状态 {online, at, onAt, notifiedFor}
 * @param {object|null} cur 这次从云端读回来的：
 *        {online, store?, title?, at?, lastOnlineAt?, lastOfflineAt?}
 *        —— `online` 不是布尔（接口失败、断网吃缓存、没登录）就当**不可信**；
 *        两个 last*At 是**毫秒**，0/缺 = 云端没给（旧云端或那一路没有成对事件）
 * @param {number} [now] 本机的"现在"（毫秒），门要拿它把时间拨动
 * @returns {{action:'none'|'down', state:object|null, notice:object|null}}
 *          `state` 原样等于传入的 `prev` 时表示"这次什么都没学到"，调用方别写回去。
 */
export function decideAgentNotice(prev, cur, now) {
  const online = cur && cur.online
  if (online !== true && online !== false) return { action: 'none', state: prev || null, notice: null }
  const t = pos(now) || Date.now()
  const lastOn = pos(cur.lastOnlineAt)
  const lastOff = pos(cur.lastOfflineAt)

  if (online === true) {
    // 在线：把"这一段"的身份留住（掉线时要拿它当键）；报过的记录作废
    return {
      action: 'none', notice: null,
      state: { online: true, at: t, onAt: lastOn || (prev && prev.online === true ? prev.onAt : 0) || t,
        notifiedFor: '' },
    }
  }

  // 离线。先定"上一次是在什么时候在线的"
  const onAt = lastOn || (prev && prev.online === true ? prev.at : pos(prev && prev.onAt))
  const st = { online: false, at: t, onAt, notifiedFor: (prev && prev.notifiedFor) || '' }
  if (!onAt) return { action: 'none', state: st, notice: null }   // 从没见过它在线 = 没有"掉"这回事

  // 身份键：云端口径用「这一段」的两个时刻；本机口径只用上线时刻
  //（离线时刻在旧云端下每轮都是"现在"，拿它当键会让同一次掉线反复报）
  const key = lastOff ? 's|' + onAt + '|' + lastOff : 'o|' + onAt
  if (st.notifiedFor === key) return { action: 'none', state: st, notice: null }
  // 旧云端且我没亲眼见过在线：无从判断这段掉线新不新鲜，宁可不发（这就是升级前的老行为）
  if (!lastOff && !(prev && prev.online === true)) return { action: 'none', state: st, notice: null }
  // 陈年离线：应用关了些日子，回来看到的是旧闻
  if (lastOff && t - lastOff > FRESH_MS) return { action: 'none', state: st, notice: null }

  st.notifiedFor = key
  return { action: 'down', state: st, notice: agentDownNotice(cur.title || cur.store, lastOff || t) }
}
