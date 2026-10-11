import { http } from '../utils/request'
import { config } from '../utils/config'
import {
  toPurchaseList, toPurchaseDetail,
  toSupplierList, toSupplier, toSupplierPrices,
} from '../utils/adapt'

/**
 * 采购（V3「进货单」）与供应商接口 —— 2026-09-20 起接入真实后端。
 *
 * ★★ 改这一版之前的状态（务必知道，别再退回）：
 *    后端**确实没有**采购接口（`GET /api/v1/purchases` → 404），
 *    所以本文件曾用 `mockOnly()` 直接吐 `src/mock/data.js` 的示例单
 *    （CG0000002x、供应商「佛山磨料磨具厂」等虚构数据）。
 *    现在 Agent 侧加了 `purchase.*` / `supplier.*` op，
 *    云端 business.py 也补了路由，**示例数据已全部下线**。
 *
 * 真实表映射（Agent 侧）：JH / JHMX（进货单）、Gysdan（供应商）、
 *                         Price_Gys（供应商进货价）、GysType（供应商分类）。
 *
 * 真实契约（路径与参数名严格照线上 business.py，别猜）：
 *   GET /purchases?keyword&state&date_from&date_to&supplier&limit&offset
 *   GET /purchases/{bill_no}
 *   GET /suppliers?keyword&limit&offset
 *   GET /suppliers/{code}
 *   GET /suppliers/{code}/prices
 *   GET /supplier-types
 *
 * ★ `state` 取值 pending|audited|void —— 这是 **V3 真实状态位**收敛来的，
 *   不是页面上原来那套 mock 的「待确认/已入库」。
 *   ★★★ 2026-09-20 纠正：收敛规则**不是**看 is_ok！
 *       is_ok(V3 IsOk)=1 正式单 / =0 草稿单，两者都算未审核；
 *       作废的唯一判据是 UserVoid(作废人) / TimeVoid(作废时间) 有值。
 *       详见 utils/adapt.js 的 purchaseStatus() 与 v3agent/purchase.py。
 */
export const purchaseApi = {
  /**
   * 采购单列表。
   * @param {object} params
   *   keyword   单号 / 流水号 / 供应商编号 / 供应商名 / 备注
   *   state     pending(未审核) | audited(已审核) | void(已作废)
   *   supplier  供应商编号（精确）
   *   from/to   日期区间（含当天）
   *   pageSize / limit / page / offset
   */
  list: async (params = {}) => {
    const size = params.pageSize || params.limit || config.PAGE_SIZE
    const offset = params.offset !== undefined
      ? Math.max(0, Number(params.offset) || 0)
      : Math.max(0, ((Number(params.page) || 1) - 1) * size)
    const q = {
      keyword: params.keyword || undefined,
      // ★ state 是真契约；status 只为 USE_MOCK 时的 mock 路由兼容
      state: params.state || undefined,
      status: params.state || undefined,
      supplier: params.supplier || undefined,
      date_from: params.from || undefined,
      date_to: params.to || undefined,
      limit: size,
      offset,
    }
    const res = await http.get('/purchases', q, {
      cacheKey: 'purchases:' + JSON.stringify(q),
      offlineOk: true,
    })
    if (res.ok) res.data = toPurchaseList(res.data, offset)
    return res
  },

  detail: async (billNo) => {
    const res = await http.get('/purchases/' + encodeURIComponent(billNo), null, {
      cacheKey: 'purchase:' + billNo, offlineOk: true,
    })
    if (res.ok) res.data = toPurchaseDetail(res.data)
    return res
  },

  /**
   * 新建采购单 —— ★ 2026-09-20 起后端已接通（Agent `purchase.create` op + `POST /purchases`）。
   *
   * 历史演进（别再退回）：
   *   早期后端确实没有写接口，这里返回 `BACKEND_NOT_AVAILABLE`，
   *   页面照实提示「请在财鲸V3 客户端录入」。
   *   现在 Agent 侧已实现 `purchase.create`：走 JH/JHMX 逐行 DML +
   *   触发器联动（InvenFlow 库存流水、Gysdan 应付），提交前自检
   *   「明细行数 == 库存流水行数」。
   *
   * ★ 服务端会强制两件事，前端无需传：
   *     表头时间写入 `YYYY-MM-DD HH:mm:ss`（无毫秒）
   *     制单人 zdrbh / UserInsert / UserUpdate = `SYSTEM`
   *
   * @param {object} body
   *   supplier   供应商编号（必填，精确）
   *   lines      [{ hpbh, unit, qty, price, remark? }]（必填，至少一行）
   *   note       单头备注（★ 注意 JH.NoteCode 只有 20 字，服务端会卡）
   *   ndate      开单时间（可选，缺省取服务端当前时间）
   *   warehouse  仓库编号（可选，缺省取供应商默认仓 / 101-）
   */
  create: async (body = {}) => {
    // ★ draftType：断网时这张进货单落进草稿桶（`purchasebill.create`），联网后由
    //   flushDrafts 自动重放 —— 与销售建单同一套（幂等键 client_token 已在 payload 里）。
    //   以前这里没配 draftType，页面里那条 `res.draft` 分支根本走不到（假承诺）。
    const res = await http.post('/purchases', body, { draftType: 'purchasebill.create' })
    return res
  },
  /**
   * 改采购单 —— 2026-10-08 接通（Agent `purchase.update` + `PUT /purchases/{bill_no}`）。
   *
   * ★ 与建单不同的三件事，页面上必须体现：
   *   · `lines` 是**最终的完整明细**，每行带 `iden_guid`；没带的行按新增处理。
   *   · **不想动明细就别带 `lines` 这个键**（带了空数组服务端直接拒，不会当成清空）。
   *   · 单头只认 `ndate / supplier / note`，系统单号不可改。
   * ★ 服务端会拒的情况（都会回一句可读的原因，不是 500）：
   *   已审核 / 已作废 / 有付款额 / 有优惠额 / 某行已退货或来自进货订单。
   *   这些在详情页的锁单卡上提前就说清楚了，不该等人撞上去。
   * ★ 不带 client_token：PUT 按单号天然幂等，重复提交是同一次改动落两遍。
   */
  update: (billNo, data) =>
    http.put('/purchases/' + encodeURIComponent(billNo), data, { draftType: 'purchasebill.update' }),
}

export const supplierApi = {
  list: async (params = {}) => {
    const size = params.pageSize || params.limit || config.LIST_PAGE_SIZE
    const offset = params.offset !== undefined
      ? Math.max(0, Number(params.offset) || 0)
      : Math.max(0, ((Number(params.page) || 1) - 1) * size)
    const q = { keyword: params.keyword || undefined, limit: size, offset,
      // 档案页「显示已停用」开关：1 = 连暂停往来的供应商一起回。开单页选供应商不传。
      show_stopped: params.showStopped ? 1 : undefined }
    const res = await http.get('/suppliers', q, {
      cacheKey: 'suppliers:' + JSON.stringify(q),
      offlineOk: true,
    })
    if (res.ok) res.data = toSupplierList(res.data, offset)
    return res
  },

  detail: async (code) => {
    const res = await http.get('/suppliers/' + encodeURIComponent(code), null, {
      cacheKey: 'supplier:' + code, offlineOk: true,
    })
    if (res.ok) res.data = toSupplier(res.data)
    return res
  },

  /** 供应商分类（GysType），用于新建供应商时选类别 */
  types: async () => {
    const res = await http.get('/supplier-types', null, {
      cacheKey: 'supplier-types', offlineOk: true,
    })
    return res
  },

  /** 该供应商的最近进货价（Price_Gys），采购编辑页带价用 */
  prices: async (code, limit = 200) => {
    const res = await http.get('/suppliers/' + encodeURIComponent(code) + '/prices',
      { limit }, { cacheKey: 'supplier-prices:' + code, offlineOk: true })
    if (res.ok) res.data = toSupplierPrices(res.data)
    return res
  },

  /**
   * 新增供应商（2026-09-21 接通：Agent `supplier.save` op + `POST /suppliers`）。
   * body: { name, code?, type_code?, contact?, phone?, tel?, address?,
   *         remark?, bank_name?, bank_id? }
   * ★ 编号缺省由 Agent 侧 G+5 位自增；phone 落 Gysdan.SJ（手机）、tel 落 Tel。
   * ★ 不带 draftType（2026-09-29 摘掉）：供应商建档没有幂等键，自动重放一次就多一家同号供应商；
   *   而那份草稿又永远不会被重放（白名单只认单据类）——留着就是假承诺，断网直接报网络错误。
   */
  create: (data) => http.post('/suppliers', data),

  /** 编辑供应商（PUT /suppliers/{code}，云端会把 code 并进 body） */
  update: (code, data) =>
    http.put('/suppliers/' + encodeURIComponent(code), { ...data, code }),
}
