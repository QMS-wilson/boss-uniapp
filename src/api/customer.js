import { http } from '../utils/request'
import { config } from '../utils/config'
import { toCustomer, toCustomerList } from '../utils/adapt'

/**
 * 客户接口（真实路径 /api/v1/customers）
 *   GET  /customers?keyword&limit&offset
 *   GET  /customers/{code}
 *   POST /customers            新增
 *   PUT  /customers/{code}     修改（真实是 PUT，不是 PATCH）
 *   GET  /customer-types
 *
 * ★ 分页（2026-09-19 后端新增）：limit + offset 真分页，
 *   返回 {items, total, limit, offset, hasMore}。
 */
export const customerApi = {
  /**
   * 列表/搜索。
   * @param {object} params
   *   keyword  关键词（编号/名称/拼音）
   *   pageSize 每页条数（默认 config.LIST_PAGE_SIZE）
   *   offset   跳过条数（无限滚动用；与 page 二选一）
   *   page     页码（1 起，内部换算成 offset）
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
      // 档案页「显示已停用」开关：1 = 连暂停往来的客户一起回。开单页选客户不传。
      show_stopped: params.showStopped ? 1 : undefined,
    }
    const res = await http.get('/customers', q, {
      cacheKey: 'customers:' + JSON.stringify(q),
      offlineOk: true,
    })
    if (res.ok) res.data = toCustomerList(res.data, offset)
    return res
  },

  detail: async (code) => {
    const res = await http.get('/customers/' + encodeURIComponent(code), null, {
      cacheKey: 'customer:' + code, offlineOk: true,
    })
    if (res.ok) res.data = toCustomer(res.data)
    return res
  },

  /**
   * ★ 这两个写接口**不带 draftType**（2026-09-29 摘掉的）：
   *   自动重放要有幂等键兜底，客户建档没有（重放一次就多一个同号/同名客户，删都找不到）。
   *   以前挂着 draftType 只是"断网了也给你留点东西"，实际那份永远不会被重放（白名单不认它），
   *   等于一个做不到的承诺 —— 摘掉，断网就是普通网络错误提示。
   */
  create: (data) => http.post('/customers', data),
  update: (code, data) =>
    http.put('/customers/' + encodeURIComponent(code), { ...data, code }),

  types: () =>
    http.get('/customer-types', null, { cacheKey: 'customer-types', offlineOk: true }),
}
