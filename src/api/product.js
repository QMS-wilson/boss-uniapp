import { http } from '../utils/request'
import { config } from '../utils/config'
import { toProduct, toSalesHistory } from '../utils/adapt'

/**
 * 商品接口（真实路径 /api/v1/products）
 *   GET  /products?keyword&limit&offset
 *   GET  /products/{hpbh}
 *   POST /products                     新增（code 可留空 = 按本店 V3 规则自动带出）
 *   PUT  /products/{hpbh}              修改（真实是 PUT）
 *   GET  /product-next-code?category=  自动带出编号（规则在 V3 配置里，见 nextCode）
 *
 * ★ 分页（2026-09-19 后端新增）：limit + offset 真分页，
 *   返回 {items, total, limit, offset, hasMore}，不再夹到 300 条。
 *
 * 注意：真实后端商品主键是「货品编号 hpbh」，不是内部 id。
 */
export const productApi = {
  /**
   * 列表/搜索。
   * @param {object} params
   *   keyword  关键词（编码/名称/规格/拼音）
   *   pageSize 每页条数（默认 config.LIST_PAGE_SIZE）
   *   offset   跳过条数（无限滚动用；与 page 二选一）
   *   page     页码（1 起，内部换算成 offset）
   *   showStopped  带上「停止使用」的货品（档案页那个开关；开单页不许传）
   *   usage    开单方向 'sale' | 'purchase'：Agent 会按方向再排掉停售/停购的，
   *            并且这时 showStopped 失效 —— 单上不该出现停掉的东西
   */
  list: async (params = {}) => {
    const size = params.pageSize || params.limit || config.LIST_PAGE_SIZE
    const offset = params.offset !== undefined
      ? Math.max(0, Number(params.offset) || 0)
      : Math.max(0, ((Number(params.page) || 1) - 1) * size)
    const q = {
      keyword: params.keyword || undefined,
      limit: size,
      offset,
      // ★ 不给就别发这个键：cacheKey 是 JSON.stringify(q)，多一个 undefined 键会让
      //   同一份查询落到两个桶里，离线兜底时读到的是另一份旧数据。
      show_stopped: params.showStopped ? 1 : undefined,
      usage: params.usage || undefined,
    }
    const res = await http.get('/products', q, {
      cacheKey: 'products:' + JSON.stringify(q),
      offlineOk: true,
    })
    if (res.ok) res.data = normalizeList(res.data, offset)
    return res
  },

  detail: async (hpbh) => {
    const res = await http.get('/products/' + encodeURIComponent(hpbh), null, {
      cacheKey: 'product:' + hpbh, offlineOk: true,
    })
    if (res.ok) res.data = toProduct(res.data)
    return res
  },

  /**
   * ★ 不带 draftType（2026-09-29 摘掉）：货品建档没有幂等键，自动重放一次就多一个同号货品。
   *   留着那份草稿也永远不会被重放（白名单只认单据类），是假承诺 ⇒ 摘掉，断网就报网络错误。
   */
  create: (data) => http.post('/products', data),
  update: (hpbh, data) =>
    http.put('/products/' + encodeURIComponent(hpbh), { ...data, code: hpbh }),

  /**
   * 最近销售记录（某货品）。
   *
   * ★★ 走专用接口 `GET /products/{hpbh}/sales-history`（Agent 直查 XSMX 明细）。
   *    以前这里是拉 `GET /sales` 列表再在每张单里找 `lines[]` —— 但销售单
   *    **列表项不含明细行**（契约只给 line_count/qty），所以恒为空数组，
   *    页面永远显示「暂无历史销售记录」。列表接口为性能计不带明细，是设计如此。
   *
   * ★★ **默认不带 customer**：不传时是「该货品最近卖给谁、什么价」的全量参考。
   *    销售单编辑页的「最近销售」传 customer（＝只看当前客户），
   *    因为那里的语义是「上次卖给**这个**客户多少钱」。
   *    传 customer 会把结果收窄（实测同货品 3 条 → 1 条）—— 这是调用方要的语义，
   *    不是 bug；不需要收窄的场景就别传。
   *
   * ★★ **cacheKey 必须含 customer**：离线缓存是按 key 存的，
   *    只按 hpbh 当 key 会把「A 客户的历史」在离线时返回给 B 客户 —— 静默错数据。
   */
  salesHistory: async (hpbh, params = {}) => {
    const customer = params.customer || ''
    const limit = params.limit || 8
    const res = await http.get(
      '/products/' + encodeURIComponent(hpbh) + '/sales-history',
      { limit, customer: customer || undefined },
      { cacheKey: 'salesHistory:' + hpbh + '|' + customer, offlineOk: true },
    )
    if (!res.ok) return { ok: false, message: res.message }
    return { ok: true, data: toSalesHistory(res.data) }
  },

  /** 条码搜索：真实接口支持 keyword，条码当作 keyword 传 */
  searchByBarcode: (barcode) =>
    http.get('/products', { keyword: barcode, limit: 1 }),

  /**
   * 货品类别（编辑页下拉）。返回 [{code,name,stopped}]，code 就是保存时要写的类别编号。
   * ★ 与 Agent 的 `_resolve_category` 同源：界面给的 code 一定在 HpType 里，
   *   不会再出现"写了个不存在的类别、货品从筛选里消失"。
   */
  types: async () => {
    const res = await http.get('/product-types', null, {
      cacheKey: 'product-types', offlineOk: true,
    })
    if (!res.ok) return res
    const list = Array.isArray(res.data) ? res.data : (res.data && res.data.items) || []
    return { ok: true, data: list.map((t) => ({
      code: t.code || t.Key_ || '', name: t.name || t.Text || '', stopped: !!t.stopped,
    })).filter((t) => t.code) }
  },

  /**
   * 货品编号自动带出（新增页用）。
   *
   * ★★ 前端**不自己算号**：规则存在这台机器 V3 的配置里（按几级类别出号、流水补几位），
   *   而且要"技术员在 V3 里改了配置，下一个号就跟着改"。界面算一份、Agent 算一份，
   *   两边迟早对不上，症状就是"手机上显示的编号和真正入库的不是同一个"。
   * ★ **不许加 cacheKey**：这是一个"下一个"值，缓存它 = 两个人拿到同一个号。
   *
   * 返回 {ok, data:{code, prefix, levels, serialLen, serialType, autobh, needCategory}}
   */
  nextCode: async (category) => {
    const res = await http.get('/product-next-code', { category: category || undefined })
    if (!res.ok) return res
    const d = res.data || {}
    return {
      ok: true,
      data: {
        code: d.code || '', prefix: d.prefix || '',
        levels: Number(d.levels || 0), serialLen: Number(d.serial_len || 0),
        serialType: Number(d.serial_type || 0), autobh: !!d.autobh,
        needCategory: !!d.need_category,
      },
    }
  },
}

/**
 * 归一化列表响应。
 *
 * ★ 兼容三种形状：
 *   1) 新后端分页对象 {items, total, limit, offset, hasMore}
 *   2) 旧后端裸数组 [ {...} ]（total 退化为本页条数）
 *   3) 其他包装 {list|rows|items}
 *
 * hasMore 优先用后端给的；后端没给就按 offset+本页条数 < total 推算。
 */
function normalizeList(data, offset = 0) {
  let arr = []
  let total = 0
  let hasMore
  if (Array.isArray(data)) { arr = data; total = data.length }
  else if (data && typeof data === 'object') {
    arr = data.items || data.list || data.rows || []
    total = Number(data.total ?? data.count ?? (offset + arr.length)) || (offset + arr.length)
    if (typeof data.hasMore === 'boolean') hasMore = data.hasMore
  }
  if (hasMore === undefined) hasMore = offset + arr.length < total
  return { list: arr.map(toProduct).filter(Boolean), total, hasMore, offset,
    // ★ 停用条数与"这次有没有放出来"：开关打开后停用的排在最前面，
    //   但没打开时人根本不知道后面还有 —— 这一句提示全靠这两个数。
    stoppedCount: Number(data && data.stoppedCount) || 0,
    showStopped: !!(data && data.showStopped) }
}
