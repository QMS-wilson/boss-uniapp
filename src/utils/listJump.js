/**
 * 跨页跳转的一次性旗标。
 *
 * 为什么要中转：sales/list 是 tabBar 页，`switchTab` 带不了 query，
 * 首页那颗「去草稿箱」只能先落一个键、由列表页 onShow 接住再切筛选。
 *
 * ★★ 键必须带商户码与账套后缀（2026-10-12 修）：早先写的是裸键
 *   `sales_list_drafts` / `sales_list_pending` / `sales_list_customer`，
 *   于是 A 家点出来的「只看草稿」会被 B 家接住，B 家一进来就落在草稿格里、
 *   还带着 A 家那个客户筛选。这类键都是一次性旗标，改名不会搬走任何有用的数据
 *   （旧的裸键最多残留一次，下次进列表读到的是新键）。
 */
import { storageKey, databaseSuffix } from './merchant'

const keyOf = (name) => storageKey(name) + databaseSuffix()

export function setJumpFlag(name, value = '1') {
  try { uni.setStorageSync(keyOf(name), value) } catch (e) { /* 传不进去只是不切筛选，别把跳转本身带崩 */ }
}

/** 读一次即清：不清的话下一次普通进入列表页也会被判成「带着上次那个筛选」 */
export function takeJumpFlag(name) {
  const k = keyOf(name)
  let v
  try { v = uni.getStorageSync(k) } catch (e) { return null }
  if (v === '' || v === null || v === undefined) return null
  try { uni.removeStorageSync(k) } catch (e) {}
  return v
}
