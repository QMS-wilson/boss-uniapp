/**
 * 金额取整 —— 与 Agent 侧同一个口径，前端不许自己发明。
 *
 * ★★ 为什么不用 Math.round：它是"五入"，而库里那列是
 *   `v3agent/sales.py` 的 `(qty * price).quantize(Decimal("0.01"))`，
 *   Decimal 默认舍入是**四舍六入、五取偶**。两边一漂就是一分钱：
 *     1.5 × 1.23 → 前端 1.85 / 库里 1.84
 *     3   × 0.335 → 前端 1.01 / 库里 1.00
 *   开单页显示的合计与详情页、V3 桌面端的应收就是这么对不上的（随行数放大）。
 *
 * ★ 为什么不用 toFixed(2)：ECMAScript 的 toFixed 在平局上同样偏"五入"，
 *   而且 `1.845` 这类数在二进制里根本不是 .845，落到哪一边看实现 —— 不可复现。
 *
 * 所以这里按**十进制字符串精确相乘**（BigInt），再按半偶取整到分，
 * 与 Python 的 `Decimal(str(x))` 完全同路径。
 */

/** '1.23' / 1.23 / '-0.5' → { d: 整数值, e: 10 的指数 }，解析不了返回 null */
function parseDec(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (!m[2] && !m[3])) return null
  const fp = m[3] || ''
  let d = BigInt((m[2] || '0') + fp)
  if (m[1] === '-') d = -d
  return { d, e: -fp.length }
}

/** n / den（den>0）四舍六入五取偶 */
function divHalfEven(n, den) {
  const q = n / den
  const r = n % den
  const ar = r < 0n ? -r : r
  if (ar * 2n > den) return n >= 0n ? q + 1n : q - 1n
  if (ar * 2n < den) return q
  if (q % 2n !== 0n) return n >= 0n ? q + 1n : q - 1n
  return q
}

/**
 * 两个数相乘并取整到「分」，舍入与 Decimal.quantize 一致。
 * 任一解析不了就按 0 算（录单里空价是常态，别抛错打断输入）。
 */
export function mulMoney(qty, price) {
  const a = parseDec(qty)
  const b = parseDec(price)
  if (!a || !b) return 0
  const d = a.d * b.d
  const k = a.e + b.e + 2            // 要的是「分」：cents = d × 10^k
  const cents = k >= 0 ? d * 10n ** BigInt(k) : divHalfEven(d, 10n ** BigInt(-k))
  return Number(cents) / 100
}

/**
 * 合计 = **各行已取整金额相加**（单头那四个 SUM 就是 SUM(J_JEZK)，不是先加后取整）。
 * 传进来的 items 用 qty/price/gift 三个字段，与 billState.calcTotal 一致。
 */
export function sumLineAmounts(items) {
  let cents = 0
  for (const it of items || []) {
    if (it && it.gift) continue      // 赠品行 J_JEZK 记 0
    cents += Math.round(mulMoney(it && it.qty, it && it.price) * 100)
  }
  return cents / 100
}

/**
 * 一组金额相加（**精确到分、半偶**），给"合计 = 各行已取整金额相加"这类场景用。
 *
 * ★ 为什么不能用 `arr.reduce((a,b)=>a+b,0)`：0.1 + 0.2 = 0.30000000000000004，
 *   一张二十行的对账单能把 ¥0.03 的误差留在合计里，而客户手里那张是**逐行相加**的，
 *   差一分就是对不上账（报表页 v2 那轮量过同样的现象）。
 * ★ 与 sumLineAmounts 的分工：那个是" qty × price 再相加"（开单页现算），
 *   这个是"已经取整的金额相加"（对账单/导出的行金额来自库里 J_JEZK，不能再乘一遍）。
 */
export function sumMoney(values) {
  let cents = 0n
  for (const v of values || []) {
    const d = parseDec(v)
    if (!d) continue
    const k = d.e + 2
    cents += k >= 0 ? d.d * 10n ** BigInt(k) : divHalfEven(d.d, 10n ** BigInt(-k))
  }
  return Number(cents) / 100
}

/**
 * 均值（客单价这类"一笔多少钱"）= total / count，取整到分、半偶。
 *
 * ★ 返回 **null** 而不是 0：count 为 0 时"客单价 0 元"会被读成"这个月一单都没卖出钱"，
 *   而真实含义是"没有可摊的单"。调用方拿到 null 必须**不显示这一行**（见首页/「我的」页）。
 * 分母为负、或任一数解析不了同样给 null。
 */
export function avgMoney(total, count) {
  const a = parseDec(total)
  const b = parseDec(count)
  if (!a || !b || b.d <= 0n) return null
  const k = a.e + 2 - b.e                 // cents = (a.d × 10^(a.e+2)) / (b.d × 10^b.e)
  const den = k >= 0 ? b.d : b.d * 10n ** BigInt(-k)
  const num = k >= 0 ? a.d * 10n ** BigInt(k) : a.d
  return Number(divHalfEven(num, den)) / 100
}

