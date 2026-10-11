/**
 * 「这一类单据刚被写过」的跨页标记。
 *
 * 为什么要有：列表页原先每次 onShow 都整页 reload —— 于是「点开一张单看一眼、返回」
 * 列表就跳回第一页、翻到第 N 页的位置没了（用户报的 P1-4）。
 * 但不 reload 又会漏掉真发生过的写（建单/改单/审核/作废），所以判据换成：
 * **只有写过的才刷**，看一眼不算。
 *
 * ★ 分 kind（sales / purchase）：改销售单不该把采购列表也刷一遍。
 * ★ 读一次即清：take 之后同一趟返回不会再触发第二次刷新。
 */
const KEY = 'jxc_bill_written'

function read() {
  try { return uni.getStorageSync(KEY) || {} } catch (e) { return {} }
}

export function markBillWritten(kind) {
  const cur = read()
  cur[kind] = true
  try { uni.setStorageSync(KEY, cur) } catch (e) { /* 记不上最多是列表晚刷一次 */ }
}

/** 取走标记（有写行为 true） */
export function takeBillWritten(kind) {
  const cur = read()
  if (!cur[kind]) return false
  delete cur[kind]
  try { uni.setStorageSync(KEY, cur) } catch (e) {}
  return true
}
