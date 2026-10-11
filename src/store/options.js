import { capabilityApi } from '../api/index'
import { toAccountOptions } from '../utils/adapt'

/**
 * 本店 V3 的业务开关（多单位 / 包装单位 / 数量按单位 / 货品品牌 / 编号规则）。
 *
 * ★ 为什么要单独一个 store：这些开关决定**界面露不露功能**，而同一套 H5 要服务多家账套 ——
 *   没开多单位的那家不该看到一个它存不进去的单位编辑器。capabilities 里带着打印机与动作清单，
 *   每个页面各拉一次等于每次进编辑页多打一发慢接口，所以这里合并并发请求、结果全应用共享。
 *
 * ★★ 取值判据只有一条：**`xxx === false` 才隐藏**。
 *   null = 不知道（库里没这行 / 同名多行值冲突 / 老版本 Agent 没回这块 / 这次没取到），
 *   按"照常显示"走。把"不知道"当"没开"，一次网络抖动就是客户整片功能消失。
 *
 * ⚠ `productCode`（编号规则）可能来自 capabilities 的离线缓存，只用于**显示"本店按几级出号"**；
 *   真正出库的那个号永远走 `productApi.nextCode()` 现问现取，不从这里推算。
 */
export const UNKNOWN = toAccountOptions(null)

let cached = null
let pending = null
/** 本地服务(Agent)真发布出来的 op 清单。空数组 = 不知道（老 Agent 没回 / 这次没取到）。 */
let knownOps = []

/** 同步读（界面初始值用；没取到就是全 null） */
export function accountOptions() {
  return cached || UNKNOWN
}

/**
 * 这个动作本地服务到底支持不支持 —— 界面按它决定**画不画**那颗按钮。
 *
 * ★ 为什么要有这一条（2026-10-08，采购改单）：H5 是一次发给所有商户的，
 *   而客户机上那个 Agent 是**一家一家换包**的。同一个前端代码，
 *   在换了包的机器上能改采购单、在没换的机器上不能。
 *   以前靠源码里一个 `PURCHASE_UPDATE_SUPPORTED = false` 常量写死，
 *   于是要么所有人都点不了、要么所有人都点了必然失败 —— 两头都错。
 *   判据只能是 Agent 自己报的清单。
 *
 * ★ 清单为空时回 `false`（＝不画）。这里和 `accountOptions` 那套"不知道就照常显示"
 *   **故意相反**：业务开关不知道就当开着，最多是露一个存不进去的输入框；
 *   写动作不知道还当支持，是让人提交一次注定失败的请求。
 */
export function hasOp(name) {
  return knownOps.indexOf(String(name)) >= 0
}

/** 给「系统配置」页与门用：原样吐出清单（副本，免得被改） */
export function opList() {
  return knownOps.slice()
}

/**
 * 换身份/换账套时必须清掉：业务开关是**账套级**的（capabilities 带 X-Database 去取），
 * 留着上一家的值就会给没启用多单位的账套露出单位编辑器 —— 存不进去或静默丢列。
 * op 清单同理：那是**那台机器上那份 exe** 的能力，换一家就是换一份包。
 */
export function resetAccountOptions() { cached = null; pending = null; knownOps = [] }

/**
 * 取一次开关。`force=true` 忽略缓存（后台改了 V3 配置后想立刻看到效果时用）。
 * 失败**不缓存**：下次进页面还会再试。
 */
export async function loadAccountOptions(force) {
  if (cached && !force) return cached
  if (pending && !force) return pending
  const p = (async () => {
    try {
      const res = await capabilityApi.get()
      const d = (res && res.ok && res.data) || null
      // ★ op 清单与业务开关来自**同一次请求**，但各自独立成立：
      //   老 Agent 可能回了 ops 没回 accountOptions（或反过来），谁也别挡谁。
      if (d && Array.isArray(d.opList)) knownOps = d.opList
      const o = (d && d.accountOptions) || null
      if (o && o.known) {
        cached = o
        return o
      }
      return UNKNOWN
    } catch (e) {
      return UNKNOWN
    } finally {
      if (pending === p) pending = null
    }
  })()
  if (!force) pending = p
  return p
}

/** 给门与「我的」页用：把三态翻成人话（不是"开/关"两态，避免把未知说成没开） */
export function describeOptions(o) {
  const t = (v) => (v === true ? '开了' : (v === false ? '没开' : '未知'))
  const x = o || UNKNOWN
  const pc = x.productCode
  return '多单位 ' + t(x.multiUnit) + '；包装单位 ' + t(x.multiUnitPackage)
    + '；数量按单位 ' + t(x.billQtyByUnit) + '；品牌 ' + t(x.useBrandName)
    + '；编号规则 ' + (pc ? '取 ' + pc.levels + ' 级前缀、流水补到 ' + pc.serialLen + ' 位' : '未知')
}
