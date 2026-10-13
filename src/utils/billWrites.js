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
 * ★★ 键带商户码与账套后缀（2026-10-12 修）：早先是裸键，在 A 家写过的单会把 B 家的
 *    列表也刷一次；更坏的是反过来 —— A 家那趟刷新被 B 家的「看一眼返回」读走清掉了，
 *    回到 A 家列表看到的是离开时的旧金额/旧状态。
 */
import { storageKey as tenantKey, databaseSuffix } from './merchant'

const KEY_BASE = 'jxc_bill_written'
/** 每次调用现算：商户码与账套都是在运行中变的（登录、切账套），常量会锁死在启动那一刻 */
const keyOf = () => tenantKey(KEY_BASE) + databaseSuffix()

function read() {
  try { return uni.getStorageSync(keyOf()) || {} } catch (e) { return {} }
}

export function markBillWritten(kind) {
  const cur = read()
  cur[kind] = true
  try { uni.setStorageSync(keyOf(), cur) } catch (e) { /* 记不上最多是列表晚刷一次 */ }
}

/** 取走标记（有写行为 true） */
export function takeBillWritten(kind) {
  const cur = read()
  if (!cur[kind]) return false
  delete cur[kind]
  try { uni.setStorageSync(keyOf(), cur) } catch (e) {}
  return true
}
