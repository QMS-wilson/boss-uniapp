/**
 * 开单明细那一行的「库存」提示（纯函数，好让 Node 门能真调它）。
 *
 * ★★ 为什么要分四种说法：现网实测（`shiwantongda`）—— 货品档案 48,591 个，
 *   `Inventory` 里有行的只有 211 个，而那 211 个里 **191 个账面是负数**。
 *   老写法只算 `需求 − 库存 > 0` 就报"库存差 N 支"，于是：
 *     · 从没入过库的货品（库里根本没行）被报成"欠货" —— 其实该说的是"这货品还没有库存记录"；
 *     · 账面 -312 的货品开 1 个会报"库存差 313 个" —— 那是**库存数字不对**，不是欠货 313 个。
 *   一句话冒充三种情况，用户看多了就不看了，那才是真危险。
 *
 * ★ 口径：一律折算到**基本单位**再比（`数量 × 单位倍率` vs 账面）。
 *   不折算会出现"填 3 包、账面 320 支 ⇒ 说够"，倍率 10 时实际要 30 支 —— 数字都对、结论错。
 * ★ 这行按非基本单位开时（1 桶 = 12 支），提示里把换算一起说了，
 *   免得同一行上左边写"按桶开"、右边写"差 1 支"要人自己对。
 * ★ 库存没随档案带回来（老 Agent、离线缓存里没这个字段）时**返回 null**：
 *   宁可不显示，也不编一个"够"或"欠"。
 */
import { fmtQty } from './format.js'

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100

/**
 * @param {object} it   明细行（qty / rate / unit / baseUnit / stock / stockRecord / gift）
 *        stockRecord：0 = 这货品在 Inventory 里没有行；1 = 有行；undefined = 后端没告诉我们（老包）
 * @param {object} [opt] { on:boolean } 配置项关了就直接不出
 * @returns {null|{kind:string, text:string}}
 */
export function stockHint(it = {}, opt = {}) {
  if (opt.on === false) return null
  if (!Number(it.qty)) return null
  const base = String(it.baseUnit || '')
  const unit = String(it.unit || '')
  const rate = Number(it.rate) > 0 ? Number(it.rate) : 1
  if (it.stock === undefined || it.stock === null || it.stock === '') return null
  const stock = Number(it.stock) || 0
  // 只有"这行按别的单位开"且倍率真不是 1 时才补换算，否则说了是废话
  const conv = (unit && base && unit !== base && rate > 1)
    ? '1 ' + unit + ' = ' + fmtQty(rate) + ' ' + base : ''
  // 括号里的片段按需要拼：没有片段就不留一对空括号，有两片就用顿号并起来（不会「（）（）」）
  const paren = (list) => {
    const keep = list.filter(Boolean)
    return keep.length ? '（' + keep.join('，') + '）' : ''
  }

  // ★ 没记录 ≠ 欠货：这句话不能拿 0 当账面去算差额
  if (it.stockRecord === 0) return { kind: 'noRecord', text: '这货品还没有库存记录' + paren([conv]) }
  if (stock < 0) {
    return {
      kind: 'negative',
      text: '账面 ' + fmtQty(stock) + (base ? ' ' + base : '') + '，库存数字不对' + paren([conv]),
    }
  }
  const gap = round2((Number(it.qty) || 0) * rate - stock)
  if (gap <= 0) return null
  const tail = base ? ' ' + base : ''
  return {
    kind: 'short',
    text: '还差 ' + fmtQty(gap) + tail + paren(['账面 ' + fmtQty(stock) + tail, conv]),
  }
}
