/**
 * 金额 / 日期 / 通用格式化
 */
export function fmtMoney(v, withSign = false) {
  if (v === null || v === undefined || v === '' || isNaN(v)) return '0.00'
  const n = Number(v)
  const s = Math.abs(n).toFixed(2)
  const sign = n < 0 ? '-' : (withSign && n > 0 ? '+' : '')
  return sign + s
}

/** 千分位金额 */
export function fmtMoneyGroup(v) {
  const s = fmtMoney(v)
  const [int, dec] = s.split('.')
  const neg = int.startsWith('-')
  const abs = neg ? int.slice(1) : int
  const grouped = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (neg ? '-' : '') + grouped + (dec ? '.' + dec : '')
}

export function fmtQty(v) {
  if (v === null || v === undefined || v === '') return '0'
  const n = Number(v)
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

export function fmtDate(d, withTime = false) {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d.replace(/-/g, '/')) : new Date(d)
  if (isNaN(dt.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  const s = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
  return withTime ? `${s} ${p(dt.getHours())}:${p(dt.getMinutes())}` : s
}

export function fmtDateShort(d) {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d.replace(/-/g, '/')) : new Date(d)
  if (isNaN(dt.getTime())) return ''
  const p = (x) => String(x).padStart(2, '0')
  return `${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

/** 当月范围 */
export function monthRange(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth()
  const from = new Date(y, m, 1)
  const to = new Date(y, m + 1, 0, 23, 59, 59)
  return { from: fmtDate(from), to: fmtDate(to) }
}

/** 今天范围 */
export function todayRange() {
  const s = fmtDate(new Date())
  return { from: s, to: s }
}

/**
 * 快捷档 → 日期区间。**只在这里算一次**：
 * 「近90天」到底是 89 还是 90 天前、上月含不含 31 号，两处各写迟早对不上，
 * 而对不上的表现是"同一个档名，两个页面圈出的单不一样"。
 * `all` 回空串 = 不带日期条件（Agent 侧 date_from/date_to 缺省即不拼 WHERE）。
 */
export function quickRange(key, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth()
  const d = (x) => fmtDate(x)
  if (key === 'today') return todayRange()
  if (key === '7d') return { from: d(new Date(y, m, now.getDate() - 6)), to: d(now) }
  if (key === 'thisMonth') return { from: d(new Date(y, m, 1)), to: d(now) }
  if (key === 'lastMonth') return { from: d(new Date(y, m - 1, 1)), to: d(new Date(y, m, 0)) }
  if (key === '90d') return { from: d(new Date(y, m, now.getDate() - 89)), to: d(now) }
  if (key === 'year') return { from: d(new Date(y, 0, 1)), to: d(now) }
  return { from: '', to: '' }
}

export function debounce(fn, wait = 300) {
  let t = null
  return function (...args) {
    clearTimeout(t)
    t = setTimeout(() => fn.apply(this, args), wait)
  }
}

/** 简单 toast */
export function toast(msg, icon = 'none') {
  uni.showToast({ title: msg, icon, duration: 2000 })
}
