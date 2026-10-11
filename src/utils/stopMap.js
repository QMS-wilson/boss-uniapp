/**
 * 停用档案清单（前端侧唯一查表口）—— 给"每一个档案名字旁边都要有停用标签"这件事用。
 *
 * ★ 为什么集中查表、而不是让每条接口都带一个 stop 字段：
 *   渲染客户/供应商/货品名字的地方有 30 来处（单据列表与详情、库存、报表三个排行、
 *   对账、草稿箱、首页最近单据、各种 picker…）。逐处加字段 = 改六七个模块 + 每处再翻一遍
 *   "六档状态怎么说话"，以后新增页面一定会漏。而"这个编号现在停不停"和它出现在哪张单上无关，
 *   所以一次把**停着的那些**取回来（现网实测：货品 10 条、客户 9 家、供应商 0 家，很小），
 *   页面按编号查表贴标签。
 *
 * ★ 三条边界：
 *   1) 查不到就当**没有标签**（不猜）。清单没加载完时页面先光秃秃的，加载完响应式补上 ——
 *      所以标签读的是这里的 reactive 状态，不是组件挂载时算一次的常量。
 *   2) 编号两侧可能带空格（现网有 " 12454514" 这种）⇒ 建索引时 trim 与原值都塞，
 *      查的时候也两头都试，免得"库里带空格、单上不带"就漏标。
 *   3) 清单超过后端 cap 会回 truncated_*，那种情况标签会漏在后段 ⇒ 记在 truncated 里，
 *      界面/门要能知道"这次不是全的"，不许静默当全量。
 */
import { reactive } from 'vue'
import { http } from '../utils/request'

const TTL = 5 * 60 * 1000      // 5 分钟内的清单算新（停用是低频操作，别每页都打一次）
const KINDS = ['customer', 'supplier', 'product']

const state = reactive({
  map: { customer: {}, supplier: {}, product: {} },
  loaded: false,
  loading: false,
  truncated: {},
  at: 0,
  error: '',
})

function indexRows(target, rows) {
  if (!Array.isArray(rows)) return
  rows.forEach((r) => {
    const label = r.statusName || '停用'
    if (r.code) target[String(r.code).trim()] = label
    if (r.codeRaw) target[String(r.codeRaw)] = label
  })
}

/** 这个编号现在停不停；停着就回要贴的文案（停止使用/停止销售/停止采购/暂停往来），否则空串 */
export function stopLabel(kind, code) {
  const c = code === null || code === undefined ? '' : String(code)
  if (!c) return ''
  const m = state.map[kind]
  if (!m) return ''
  return m[c] || m[c.trim()] || ''
}

export function stopMapState() {
  return state
}

/**
 * 取清单。默认 5 分钟内不重取；`force` 用于人在这一页里刚改过档案（比如把谁启用了）。
 * 走离线兜底（cacheKey）⇒ Agent 掉线时标签照样贴得出来，用的是上次那份清单。
 */
export async function loadStopMap(force = false) {
  const fresh = state.loaded && (Date.now() - state.at) < TTL
  if (state.loading || (fresh && !force)) return state
  state.loading = true
  try {
    const res = await http.get('/archive-stop-status', null, {
      cacheKey: 'archiveStopStatus', offlineOk: true,
    })
    if (res && res.ok && res.data) {
      const d = res.data
      KINDS.forEach((k) => { state.map[k] = {} })
      indexRows(state.map.customer, d.customers)
      indexRows(state.map.supplier, d.suppliers)
      indexRows(state.map.product, d.products)
      state.truncated = {
        customer: !!d.truncated_customers, supplier: !!d.truncated_suppliers,
        product: !!d.truncated_products,
      }
      state.at = Date.now()
      state.loaded = true
      state.error = ''
    } else if (res) {
      state.error = res.message || '停用档案清单没拿到'
    }
  } finally {
    state.loading = false
  }
  return state
}
