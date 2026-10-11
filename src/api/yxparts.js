import { http } from '../utils/request'

/**
 * 燕秀零件处理（走云端通用信封 `/api/v1/rpc` → 本地 Agent 的 yxparts.* op）。
 *
 * ★ 为什么用 /rpc 而不是像商品/销售那样各开一条 REST：
 *   这一组动作是"把手机上的表格矩阵交给本机 Agent 算"，参数与返回天然是 JSON，
 *   云端本身不解析业务（只做鉴权/账套路由/审计），所以走通用信封最贴合；
 *   新加一个 op（比如以后的维护动作）不用动云端代码。
 *
 * ★ 返回一律是云端信封：{ ok:true, data } / { ok:false, error:{ code, message, detail } }。
 *   页面要按 error.code 分支（YX_HEADER_NOT_FOUND / YX_ACCOUNT_SET_EMPTY 等），
 *   不要只 toast message —— message 是给人看的，code 才是给程序判断的。
 */

const WRITE_TIMEOUT = 60000

function call(op, params, extra = {}) {
  return http.post('/rpc', { op, params }, { timeout: WRITE_TIMEOUT, ...extra })
}

export const yxApi = {
  /** 表格矩阵 → 逐行匹配结果（解析/归一化/匹配全在 Agent，与桌面同一套） */
  match: (sheets) => call('yxparts.match', { sheets }),

  /** 未匹配行的候选物料（与桌面双击弹窗同序同值） */
  suggest: (row, keyword = '') => call('yxparts.suggest', {
    name: row.name, spec: row.spec, actual: row.actual, keyword,
  }),

  /** 人工确认 → 写 Agent 本地记忆库（同一客户写法下次自动命中） */
  remember: (row, hpbh, unit) => call('yxparts.remember', {
    key: (row.name || '') + (row.spec || ''),
    keyB: (row.name || '') + (row.actual || ''),
    actual: row.actual || '',
    customerName: row.customerName || ((row.name || '') + (row.spec || '')),
    hpbh,
    unit,
  }),

  /** 匹配记忆：列表 / 删除（维护页用） */
  memoryList: () => call('yxparts.memory.list', {}),
  memoryDelete: (id) => call('yxparts.memory.delete', { id }),

  /** 物料库现状：HPKhType / hpdan 行数、客户类别编号、记忆条数 */
  capabilities: () => call('yxparts.capabilities', {}),

  /**
   * 导入燕秀品名（写 HPKhType）—— 两步走，都是同一个 op：
   *   importPreview：把**原始矩阵**交给 Agent 解析 + 预检（查编号/单位、判重），**一行都不写**；
   *   importApply  ：按预检结果真正写库（逐行 INSERT，部分失败不算错）。
   *
   * ★ App 侧不解析模板：表头识别与取值都在 Agent（与匹配同一条 A1.5 原则）。
   * ★ 直接给 rows 也支持（老调用方/脚本用）。
   */
  importPreview: (sheets, lbtypeKh) =>
    call('yxparts.importCustomers', { sheets, lbtypeKh, dryRun: true }),

  importApply: (rows, lbtypeKh) =>
    call('yxparts.importCustomers', { rows, lbtypeKh }),
}

export default yxApi
