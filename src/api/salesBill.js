import { http } from '../utils/request'
import { config } from '../utils/config'
import { toBillList, toBillDetail } from '../utils/adapt'

/**
 * 销售单接口（真实路径 /api/v1/sales）
 *
 * 真实契约：
 *   GET  /sales?date_from&date_to&keyword&customer&state&limit&offset   列表
 *        ★ state 只认 pending / audited / void（详见下方 STATUS_TO_STATE）
 *        ★ 返回 {items,total,limit,offset,hasMore}（2026-09-20 起，之前是裸数组）
 *   GET  /sales/{bill_no}                         详情（含 editable / editable_reasons）
 *   POST /sales                                   新建（body: {customer, lines, ndate?, warehouse?, note?}）
 *   PUT  /sales/{bill_no}                         改单（body: {header, lines}）
 *
 * 断网时：新建/改单落草稿（由 request 层的 draftType 触发），联网后 flushDrafts 上传。
 */
/**
 * ★★ 页面内部状态枚举 → 线上查询词表
 *
 * 线上**只有这一套**词汇：pending / audited / void（与采购 /purchases?state= 完全一致）。
 * 页面和 mock 内部仍用 unapproved / approved（见 utils/billState.js、
 * components/StatusTag.vue），转换**只在这里做一次** ——
 * 绝不让 UI 枚举漏到 URL 上。
 *
 * 历史事故（2026-09-20）：老实现直接把 `status: 'unapproved'` 当 `state` 发出去，
 * Agent 里 `int(state)` → `invalid literal for int() with base 10: 'unapproved'`，
 * 销售列表点「未审核 / 已审核」直接 500。
 */
const STATUS_TO_STATE = {
  unapproved: 'pending',
  approved: 'audited',
  pending: 'pending',
  audited: 'audited',
  void: 'void',
  voided: 'void',
}

export const salesApi = {
  list: async (params = {}) => {
    const size = params.pageSize || params.limit || config.PAGE_SIZE
    const page = Number(params.page) > 0 ? Number(params.page) : 1
    const status = params.status || ''
    // 认识的走映射；不认识的**原样透传**，让 Agent 报可读错误 ——
    // 静默丢弃会把「参数写错」伪装成「筛选没实现」。
    const mapped = STATUS_TO_STATE[status]
    const q = {
      limit: size,
      offset: (page - 1) * size,
      keyword: params.keyword || undefined,
      state: status ? (mapped || status) : undefined,
      date_from: params.startDate || params.from || undefined,
      date_to: params.endDate || params.to || undefined,
      // ★ customerId 也要认：客户详情页的「最近单据」传的是 customerId，
      //   以前没映射 → 该客户名下其实拉的是**全部**单据（静默错数据）。
      customer: params.customer || params.customerId || undefined,
    }
    const res = await http.get('/sales', q, {
      cacheKey: 'sales:' + JSON.stringify(q),
      offlineOk: true,
    })
    if (res.ok) res.data = toBillList(res.data)
    return res
  },

  detail: async (billNo) => {
    const res = await http.get('/sales/' + encodeURIComponent(billNo), null, {
      cacheKey: 'sale:' + billNo,
      offlineOk: true,
    })
    if (res.ok) res.data = toBillDetail(res.data)
    return res
  },

  /** 新建（body 已由页面组装为真实结构） */
  create: (data) =>
    http.post('/sales', data, { draftType: 'salesbill.create' }),

  /** 改单（仅未审核且无前置关联；lines 须为最终完整明细，含 iden_guid） */
  update: (billNo, data) =>
    http.put('/sales/' + encodeURIComponent(billNo), data, { draftType: 'salesbill.update' }),

  /** 审核（未审核、未作废 → 已审核） */
  audit: (billNo) =>
    http.post('/sales/' + encodeURIComponent(billNo) + '/audit', {}),

  /** 反审（已审核、未作废 → 未审核；作废单后端会拒绝） */
  unaudit: (billNo) =>
    http.post('/sales/' + encodeURIComponent(billNo) + '/unaudit', {}),

  /** 作废（未作废 → 已作废；作废是终态，无法反审恢复） */
  void: (billNo) =>
    http.post('/sales/' + encodeURIComponent(billNo) + '/void', {}),

  /** 复制（任意状态 → 新建未审核单，返回新单 bill_no） */
  copy: (billNo) =>
    http.post('/sales/' + encodeURIComponent(billNo) + '/copy', {}),
}

/*
 * ★ 审核 / 反审 / 作废 / 复制：后端**是**提供的，别信旧注释。
 *   2026-10-08 复核：`v3agent/ops.py:178,186,194,202` 有 salesbill.audit/unaudit/void/copy 四个 op，
 *   `cloudapi/business.py:199,206,213,220` 四条路由都在，`pages/sales/detail.vue:94-113` 也真在调。
 *   这里曾经写过一段「后端未提供…页面也已同步去掉审核按钮」的假话，
 *   并连带让 utils/adapt.js 把看板 pending 恒置 0、首页撤掉待审核引导 —— 三处一起改掉了。
 *
 * ★ 列表归一化已上移到 utils/adapt.js 的 toBillList()（可被 test-adapters.py 直接断言）。
 */

