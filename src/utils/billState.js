/**
 * 销售单状态机（显式化改单边界，对应会话"未审核可改、已审核只读"）
 *
 * 可改条件：status === 'unapproved'
 *           且 hasPayment / hasShipment / hasReconcile / hasLinkage 全为 false
 * 不可改时返回 reasons[] 供 UI / API 展示具体原因。
 *
 * ★★★ 2026-09-20 纠正：新增 VOID。V3 的 ISOK **不是**作废位
 *     （ISOK=1 正式 / ISOK=0 草稿，都算未审核），作废靠 UserVoid/TimeVoid 判，
 *     适配层（utils/adapt.js 的 toStatus）已收敛出 'void'。
 *     作废单恒只读 —— 旧代码只判 approved，作废单会被当成可改。
 */

import { mulMoney } from './money.js'   // ★ 带扩展名：门脚本用 Node 直接 import 本文件

/**
 * ★ 「本版能不能改采购单」不在这里写死了（2026-10-08 撤掉那个常量）。
 *   判据换成 Agent 自己报的动作清单：`store/options.js` 的 `hasOp('purchase.update')`。
 *   原因很具体：H5 一次发给所有商户，客户机上那个 exe 是一家一家换的 ——
 *   源码里一个 true/false 只能二选一地错：要么所有人都点不了，要么没换包的那家点了必失败。
 *   这个文件被门脚本用 Node 直接 import，所以不能引 store（那会拖进整个运行时）。
 */

export const BILL_STATUS = {
  UNAPPROVED: 'unapproved',
  APPROVED: 'approved',
  VOID: 'void',
}

export const STATUS_LABEL = {
  unapproved: '未审核',
  approved: '已审核',
  void: '已作废',
  // ★ 草稿只是**前端**的词（库里没有这张单，服务端 state 只有 pending/audited/void）。
  //   它出现在草稿箱的行与开单页的标题区，不进 STATUS_TO_STATE 那套查询参数。
  draft: '草稿',
}

/**
 * 判断单据是否可改
 * @returns {{ editable:boolean, reasons:string[] }}
 */
export function checkEditable(bill) {
  const reasons = []
  if (!bill) return { editable: false, reasons: ['单据不存在'] }

  if (bill.status === 'void') reasons.push('单据已作废')
  if (bill.status === 'approved') reasons.push('单据已审核')
  if (bill.hasPayment) reasons.push('已关联收款')
  if (bill.hasShipment) reasons.push('已发货')
  if (bill.hasReconcile) reasons.push('已对账')
  if (bill.hasLinkage) reasons.push('已关联其他单据')

  return { editable: reasons.length === 0, reasons }
}

/** 不可改原因转人话 */
export function editableReasonText(reasons) {
  if (!reasons || !reasons.length) return ''
  return '不可修改：' + reasons.join('、')
}

/**
 * 明细合计。
 * ★ 赠品行（`gift`）**不计金额、但计数量** —— 这是 V3 桌面端实测出来的口径，不是前端定的
 *   （样本 `geshi/XK00000003`：单头 `J_JESUM=162` 含赠品价值、`J_JEZKSUM=156` 不含、
 *     `S_SLSUM=26` 含赠品的 1 件，库存就是按数量扣的）。
 *   对应到库里：`totalAmount` = SUM(J_JEZK) = 单头 `J_JEWF`（应收），
 *   赠品那部分只存在于 SUM(J_JE)（`J_JESUM`）里，所以单独回一个 `giftAmount` 给界面说清楚。
 * @returns {{totalAmount:number,totalQty:number,giftCount:number,giftAmount:number}}
 */
export function calcTotal(items) {
  const zero = { totalAmount: 0, totalQty: 0, giftCount: 0, giftAmount: 0 }
  if (!Array.isArray(items)) return zero
  let cents = 0, totalQty = 0, giftCount = 0, giftCents = 0
  for (const it of items) {
    const qty = Number(it.qty) || 0
    totalQty += qty                      // 数量含赠品：库存按它走
    // ★ 金额一律走 utils/money：与库里 J_JEZK 同一个舍入路径（半偶），
    //   合计是「各行已取整金额相加」—— 单头那四个 SUM 就是这么回的，
    //   先加后取整会让开单页与详情页差出一分钱。
    const amt = Math.round(mulMoney(it.qty, it.price) * 100)
    if (it.gift) { giftCount++; giftCents += amt; continue }
    cents += amt
  }
  return {
    totalAmount: cents / 100,
    totalQty: Math.round(totalQty * 100) / 100,
    giftCount, giftAmount: giftCents / 100,
  }
}
