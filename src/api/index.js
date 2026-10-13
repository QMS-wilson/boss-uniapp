import { http, reportHttp, PRINT_TIMEOUT } from '../utils/request'
import { config } from '../utils/config'
import {
  toDashboard, toSalesSummary, toCustomerRanking, toProductRanking, toTrend,
  toReceivables, toStatement, toCustomerProducts, toCapabilities,
  toPurchaseSummary, toSupplierRanking, toProfit,
  toInventory, toStockFlow,
} from '../utils/adapt'

/**
 * ============================================================================
 * 接口层 —— 路径与参数名严格按照线上 cloudapi/business.py 的真实契约。
 *
 * 真实 envelope：{ ok:true, data } / { ok:false, error:{ code, message } }
 *               （不是文档里的 { success, data }）
 * 鉴权：Authorization: Bearer <token>，由 utils/request.js 自动注入。
 *
 * ★ 所有路径都在服务器上用 curl 实测过：跑不通的接口一律不写进来，
 *   宁可让它报「后端未提供」也不要留一个看起来能用的假路径。
 * ============================================================================
 */

/**
 * 库存：GET /inventory?keyword&warehouse&flag&productId&limit&offset
 *       GET /inventory/flow?productId&startDate&endDate&limit
 *
 * ★ 2026-09-25：库存页改版后返回体是 {items,total,truncated}（合计为同口径全量 SQL），
 *   不再是裸数组。老 exe 返裸数组时 toInventory 也能吃（Array 分支）。
 */
export const inventoryApi = {
  list: async (params = {}) => {
    const res = await http.get('/inventory', {
      keyword: params.keyword || undefined,
      warehouse: params.warehouse || undefined,
      flag: params.flag || undefined,
      productId: params.productId || undefined,
      limit: params.limit || 200,
      offset: params.offset || undefined,
    }, { cacheKey: 'inventory:' + JSON.stringify(params), offlineOk: true })
    if (res.ok) res.data = toInventory(res.data)
    return res
  },
  flow: async (params = {}) => {
    const res = await http.get('/inventory/flow', {
      productId: params.productId,
      startDate: params.from,
      endDate: params.to,
      limit: params.limit || 500,
    }, { cacheKey: 'inventory:flow:' + JSON.stringify(params) })
    if (res.ok) res.data = toStockFlow(res.data)
    return res
  },
}

/** 取价：GET /price?customerId&productId&unit（business.py 就是读这两个名字） */
export const priceApi = {
  /**
   * 取价：GET /price?customerId&productId&unit[&priceTrace&priceTypeXs]
   *
   * ★ 参数名以 cloudapi/business.py 为准：customerId / productId / unit。
   * ★ 2026-09-22 新增 priceTrace / priceTypeXs（可选）—— 单据页面的「价格方案」。
   *   Agent 侧 price.resolve 会用它们**覆盖**客户档案里的同名配置，
   *   不传则完全按客户档案（既有行为不变）。
   *   priceTrace=201 → 最近销价；200 → 按 priceTypeXs 选价格列（0..5 零售..销售价5，13 最低销价）。
   */
  resolve: (customerId, productId, unit, scheme) =>
    http.get('/price', {
      customerId, productId, unit,
      priceTrace: scheme?.priceTrace,
      priceTypeXs: scheme?.priceTypeXs,
    }),
}

/**
 * 应收汇总：GET /reports/receivables/summary
 * ★ 注意是 receivables/summary（带斜杠），不是 receivables-summary。
 * 真实参数：keyword / onlyReceivable / pageSize
 * 真实返回：总额、客户数与明细（来自 Khdan.J_Due）
 */
export const receivableApi = {
  list: async (params = {}) => {
    const res = await reportHttp.get('/reports/receivables/summary', buildReceivableQ(params))
    if (res.ok) res.data = toReceivables(res.data)
    return res
  },
  summary: async (params = {}) => {
    // ★★ cacheKey 必须含筛选（与 product.js 的 `products:JSON.stringify(q)` 同一套路）：
    //   早先固定写死 'receivables'，于是带着关键字/停用开关的那一枪在**断网时**
    //   会把"无筛选"那份缓存当结果回给页面 —— 界面看着像查过了，其实是另一套数。
    const q = buildReceivableQ(params)
    const res = await reportHttp.get('/reports/receivables/summary', q, {
      cacheKey: 'receivables:' + JSON.stringify(q), offlineOk: true,
    })
    if (res.ok) res.data = toReceivables(res.data)
    return res
  },
  /**
   * 应收明细页：带账龄段筛选。
   * ★ 筛选只影响 items 列表；total/aging 始终是全量账面（页面合计才不会随筛选跳变）。
   * @param {string} [params.aging] '' | 0-30 | 31-60 | 61-90 | 90+
   */
  detail: async (params = {}) => {
    const res = await reportHttp.get('/reports/receivables/summary', {
      ...buildReceivableQ(params), aging: params.aging || undefined,
    })
    if (res.ok) res.data = toReceivables(res.data)
    return res
  },
}

function buildReceivableQ(params = {}) {
  return {
    keyword: params.keyword || undefined,
    onlyReceivable: params.onlyReceivable === undefined ? 'true' : String(params.onlyReceivable),
    pageSize: params.pageSize || params.limit || 200,
    // 只决定列不列暂停往来的客户；合计与账龄一直是全量
    show_stopped: params.showStopped ? 1 : undefined,
  }
}

/**
 * 经营看板：GET /dashboard/summary?month_start&today
 * ★ 真实实现按 month_start / today 两个日期算，不传则默认本月与今天。
 * 真实返回：month_amount / today_amount / today_count / receivable_total
 */
export const dashboardApi = {
  get: async (params = {}) => {
    const today = strToday()
    const res = await http.get('/dashboard/summary', {
      month_start: params.month_start || today.slice(0, 8) + '01',
      today: params.today || today,
    }, { cacheKey: 'dashboard:' + today, offlineOk: true })
    if (res.ok) res.data = toDashboard(res.data)
    return res
  },
}

/**
 * 报表：真实参数一律是 startDate / endDate（business.py 读的是这两个驼峰名），
 * 不是 date_from / date_to（那是 agent 内部 op 的参数名）。
 * 返回值统一经 adapt.js 转成页面形状。
 *
 * ★ 实测：不传期间时后端会返回空/异常结果，所以这里**必须给默认区间**。
 *   fromRange() 负责兜底：给了 from/to 就用，没给就按月/年推算。
 */
export const reportApi = {
  salesSummary: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/sales-summary', {
      startDate: from, endDate: to,
      customerId: p.customerId || undefined,
    })
    if (res.ok) res.data = toSalesSummary(res.data)
    return res
  },

  salesTrend: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/sales-trend', {
      startDate: from, endDate: to,
      granularity: p.granularity || 'day',
    })
    if (res.ok) res.data = toTrend(res.data)
    return res
  },

  /**
   * 日粒度趋势（报表页「销售趋势」用）。
   * ★ 同样是 /reports/sales-trend，只是 granularity=day。
   *   后端按天聚合：key = CONVERT(varchar(10), x.NDate, 120) → '2026-09-18'。
   * ★ 页面常传 { days: 30 } 而不传具体日期 —— 这里换算成近 N 天区间，
   *   否则 startDate/endDate 为 undefined，被 request.js 当空值剔除，后端拿不到期间。
   */
  dailyTrend: async (p = {}) => {
    const range = p.from && p.to
      ? { from: p.from, to: p.to }
      : daysAgoRange(p.days || 30)
    const res = await reportHttp.get('/reports/sales-trend', {
      startDate: range.from, endDate: range.to,
      granularity: 'day',
    })
    if (res.ok) res.data = toTrend(res.data)
    return { ...res, range }
  },

  /**
   * 月度趋势。
   * ★ 后端没有 /reports/monthly-trend 这个路径；
   *   月度视图是 sales-trend 的 granularity=month。
   * ★ 页面常传 { months: 12 } 而不传具体日期 —— 这里把它换算成近 12 个月区间，
   *   否则 startDate/endDate 为 undefined，请求参数被过滤掉，后端拿不到期间。
   */
  monthlyTrend: async (p = {}) => {
    const months = num(p.months, 12)
    const range = p.from && p.to
      ? { from: p.from, to: p.to }
      : monthsAgoRange(months)
    const res = await reportHttp.get('/reports/sales-trend', {
      startDate: range.from, endDate: range.to,
      granularity: 'month',
    })
    if (res.ok) res.data = toTrend(res.data)
    return res
  },

  customerRanking: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/customer-ranking', {
      startDate: from, endDate: to, limit: p.limit || 20,
    })
    if (res.ok) res.data = toCustomerRanking(res.data)
    return res
  },

  productRanking: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/product-ranking', {
      startDate: from, endDate: to, limit: p.limit || 20,
    })
    if (res.ok) res.data = toProductRanking(res.data)
    return res
  },

  /**
   * 客户往来对账：GET /reports/customer-statement
   * ★ 不是 /reports/statements。
   * 真实返回是嵌套结构：customer / period / summary{closingBalance,...} / items[]{debit,credit,balance}
   * @param {boolean} [p.lines] 要**一行一个货品**的货品层（items[].lines）。
   *   ★ 只在导出「月份对账单」那张时传 true：这一层比流水行多一个数量级，
   *     页面每次查对账都背上是白给的开销；不传 ⇒ 返回体与以前完全一样。
   */
  statement: async (p = {}) => {
    const { from, to } = fromRange(p)
    const q = { customerId: p.customerId, startDate: from, endDate: to }
    if (p.lines) q.withLines = 1
    const res = await reportHttp.get('/reports/customer-statement', q)
    if (res.ok) res.data = toStatement(res.data)
    return res
  },

  /**
   * 客户货品明细：GET /reports/customer-product-detail
   * ★ 不是 /reports/customer-products。
   * 真实返回：summary{productCount,totalQuantity,totalAmount} + items[]{quantity,amount,billCount,averagePrice}
   */
  customerProducts: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/customer-product-detail', {
      customerId: p.customerId, startDate: from, endDate: to, limit: p.limit || 200,
    })
    if (res.ok) res.data = toCustomerProducts(res.data)
    return res
  },

  /** 采购汇总：GET /reports/purchase-summary */
  purchaseSummary: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/purchase-summary', {
      startDate: from, endDate: to, supplier: p.supplier || undefined,
    })
    if (res.ok) res.data = toPurchaseSummary(res.data)
    return res
  },

  /** 采购趋势：GET /reports/purchase-trend */
  purchaseTrend: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/purchase-trend', {
      startDate: from, endDate: to, granularity: p.granularity || 'day',
    })
    if (res.ok) res.data = toTrend(res.data)
    return res
  },

  /** 供应商排行：GET /reports/supplier-ranking */
  supplierRanking: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/supplier-ranking', {
      startDate: from, endDate: to, limit: p.limit || 20,
    })
    if (res.ok) res.data = toSupplierRanking(res.data)
    return res
  },

  /** 毛利：GET /reports/profit-summary */
  profitSummary: async (p = {}) => {
    const { from, to } = fromRange(p)
    const res = await reportHttp.get('/reports/profit-summary', {
      startDate: from, endDate: to,
    })
    if (res.ok) res.data = toProfit(res.data)
    return res
  },
}

/**
 * 采购 / 供应商 —— 2026-09-20 起走真实后端，实现在 `api/purchase.js`。
 *
 * ★ 这里以前长这样（已删除，别再写回来）：
 *     export const purchaseApi = {
 *       list: (params) => mockOnly('purchase.list', '/purchases', params),
 *       detail: (id)   => mockOnly('purchase.detail', '/purchases/' + id, {}),
 *     }
 *   即：**无论 USE_MOCK 是什么，都直接吐 mock 的示例采购单**
 *   （CG0000002x + 虚构供应商）。因为当时 `GET /api/v1/purchases` 实测 404。
 *   现在 Agent 加了 `purchase.*` op、云端补了路由，示例数据全部下线。
 *
 * 页码保持从 `api/index.js` 可导入，页面无需改动 import 路径。
 */
export { purchaseApi, supplierApi } from './purchase'

/** 打印销售单：POST /print/salesbill { billNo, mode, copies } */
export const printApi = {
  // ★ 打印/预览这两个写接口**不带 draftType**（2026-09-29 摘掉）：断网时落一份"待打印"草稿，
  //   既不会被 flushDrafts 重放（白名单只认单据类），也没有任何地方能撤销它 —— 纯粹是垃圾数据，
  //   还会让人以为"没印成功、联网会自动补印"。断网就老老实实报网络错误。
  /**
   * 打印单据
   * @param {string} billNo  单号
   * @param {string} mode    layout(V3版式·静默直投) | system(纯文本·旧行为)
   *                         | html | payload | image
   * @param {number} copies  份数
   * @param {string} [printer] 指定打印机名（留空 = 系统默认打印机）
   * @param {string} [format]  打印格式（V3 报表方案名，来自 print.format.list）
   */
  printBill: (billNo, mode = 'layout', copies = 1, printer = '', format = '') =>
    http.post('/print/salesbill', {
      billNo, mode, copies,
      printer: printer || undefined,
      format: format || undefined,
      // ★ 云端给打印这条是 120s RPC，多页/慢机很常见 ⇒ 前端等到 190s（含排队）
    }, { timeout: PRINT_TIMEOUT }),

  /**
   * 版式预览：Agent 按 V3 原版版式出 PNG（与「版式打印」共用同一套绘制代码）。
   * @returns {Promise<{ok:boolean, data:{images:[{url,page,width,height}], totalPages:number}}>}
   *          url 是**相对路径**（/api/v1/print/preview/xxx.png），展示时要拼 config.BASE_URL。
   *          ★ 图片路由故意不做鉴权：小程序 <image> 组件带不了 Authorization 头，
   *            所以用「随机文件名 + 24h TTL」当一次性凭证。
   */
  previewBill: (billNo) =>
    http.post('/print/salesbill/preview', { billNo }, { timeout: PRINT_TIMEOUT }),
}

/**
 * 能力发现：GET /capabilities（返回 agent 在线状态与支持的全部 op）
 *
 * ★★ 真实响应是**嵌套**的：{ client, agent:{online,version,ops}, rest, capabilities }
 *    页面原先按 mock 的平铺形状读（caps?.agentOnline / caps?.dbStatus），
 *    实测全为 undefined → 状态永远显示「连接异常 / 离线」（2026-09-20 确认）。
 *    这里统一经 toCapabilities 归一化，页面只认扁平字段。
 */
export const capabilityApi = {
  get: async () => {
    const res = await http.get('/capabilities', null, { cacheKey: 'capabilities', offlineOk: true })
    if (res.ok) res.data = toCapabilities(res.data, res.ok, res.offline)
    return res
  },
}

function strToday() {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function num(v, dft = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : dft
}

/**
 * 报表默认区间兜底。
 *
 * ★ 为什么要兜底：实测线上不传 startDate/endDate 时后端拿不到期间，
 *   返回的结果对页面没有意义。页面（report/index.vue）调用时大多不传日期，
 *   全依赖这里按月推算，否则请求参数被 request.js 过滤掉（undefined 会被剔除）。
 *
 * 默认口径：本月 1 日 → 今天。
 */
function fromRange(p = {}) {
  if (p.from && p.to) return { from: p.from, to: p.to }
  const today = strToday()
  return { from: p.from || today.slice(0, 8) + '01', to: p.to || today }
}

/** 近 N 个月（含本月）的区间：2025-10-01 → 2026-09-19 */
function monthsAgoRange(months) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
  const p = (x) => String(x).padStart(2, '0')
  const from = start.getFullYear() + '-' + p(start.getMonth() + 1) + '-01'
  return { from, to: strToday() }
}

/**
 * 近 N 天（含今天）的区间：2026-08-22 → 2026-09-20
 * ★ 日粒度趋势专用。sales-trend 按天聚合时每天一个点，
 *   区间给太长（比如 12 个月 = 365 点）会把横轴挤死、也没法看。
 *   days 默认 30，即 charts 上 30 根柱子/点。
 */
function daysAgoRange(days) {
  const n = Math.max(1, num(days, 30))
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1))
  const p = (x) => String(x).padStart(2, '0')
  const from = start.getFullYear() + '-' + p(start.getMonth() + 1) + '-' + p(start.getDate())
  return { from, to: strToday() }
}

/** 近 N 天的日粒度销售趋势：/reports/sales-trend?granularity=day */
export function daysTrendRange(days) {
  return daysAgoRange(days)
}
