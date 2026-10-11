/**
 * xlsx 版式指纹与对拍（门专用，**不参与构建**）。
 *
 * 为什么不用 SheetJS 读样式：社区版 `read` 会把 `cell.s` 原样留着但**样式表是它内部重建的**，
 * 拿不到"参考文件里那一号到底是几号字、哪几条边有线"。所以这里直接读 OOXML 原文，
 * 把 s 号解析成 {字号/字体, 边框边, 对齐, 数字格式} 四件套再比。
 */
import AdmZip from 'adm-zip'

const EDGES = ['left', 'right', 'top', 'bottom']

function attrsOf(tag) {
  const o = {}
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = m[2]
  return o
}
function block(xml, name) {
  const i = xml.indexOf('<' + name)
  if (i < 0) return ''
  const close = xml.indexOf('</' + name + '>', i)
  return close < 0 ? xml.slice(i, xml.indexOf('>', i) + 1) : xml.slice(i, close)
}
function unesc(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/** styles.xml → 每个 s 号（cellXfs 下标）对应的样式四件套 */
export function readXfs(stylesXml) {
  const fmts = {}
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/>/g)) {
    const a = attrsOf(m[1])
    fmts[a.numFmtId] = unesc(a.formatCode || '')
  }
  const fonts = [...block(stylesXml, 'fonts').matchAll(/<font>([\s\S]*?)<\/font>/g)].map((fm) => {
    const sz = /<sz val="([^"]*)"/.exec(fm[1])
    const nm = /<name val="([^"]*)"/.exec(fm[1])
    return { sz: sz ? sz[1] : '', name: nm ? unesc(nm[1]) : '', bold: /<b\/>/.test(fm[1]) }
  })
  const borders = [...block(stylesXml, 'borders').matchAll(/<border>([\s\S]*?)<\/border>/g)].map((bm) => {
    const on = []
    for (const e of EDGES) {
      const em = new RegExp('<' + e + ' style="([^"]*)"').exec(bm[1])
      if (em) on.push(e + ':' + em[1])
    }
    return on.sort().join(',')
  })
  return [...block(stylesXml, 'cellXfs').matchAll(/<xf\b([\s\S]*?)(?:\/>|<\/xf>)/g)].map((m) => {
    const a = attrsOf(m[1].split('>')[0])
    const al = /<alignment([^>]*)>/.exec(m[1])
    const aa = al ? attrsOf(al[1]) : {}
    const f = fonts[+a.fontId] || {}
    const nf = a.numFmtId === undefined ? '0' : a.numFmtId
    return {
      font: (f.name || '?') + '/' + (f.sz || '?') + (f.bold ? '+b' : ''),
      border: borders[+a.borderId] || '',
      align: aa.horizontal || '(默认)',
      fmt: fmts[nf] || (nf === '0' ? 'General' : '#' + nf),
    }
  })
}

/** sharedStrings.xml → 文本表（参考文件那批全用共享字符串，`<v>` 里是**下标**不是文本） */
function readShared(zip) {
  let xml = ''
  try { xml = zip.readAsText('xl/sharedStrings.xml') } catch (e) { return [] }
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => {
    // 富文本一节一节拼（厂商那份是整段 <t>，WPS 拆段时会有多个 <r><t>）
    return unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
  })
}

/** 一个 xlsx 文件 → 版式指纹 */
export function fingerprint(file, zip = new AdmZip(file)) {
  const sx = zip.readAsText('xl/worksheets/sheet1.xml')
  const xfs = readXfs(zip.readAsText('xl/styles.xml'))
  const sst = readShared(zip)

  const colWidths = {}
  for (const m of sx.matchAll(/<col\b([^>]*)\/>/g)) {
    const a = attrsOf(m[1])
    for (let c = +a.min; c <= +a.max; c++) colWidths[c] = Math.round(parseFloat(a.width) * 100) / 100
  }
  const rowHeights = {}
  for (const m of sx.matchAll(/<row\b([^>]*)>/g)) {
    const a = attrsOf(m[1])
    if (a.ht) rowHeights[+a.r] = parseFloat(a.ht)
  }
  const cells = {}
  for (const m of sx.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrsOf(m[1])
    const st = xfs[+a.s] || {}
    const v = m[2] && /<v>([\s\S]*?)<\/v>/.exec(m[2])
    const is = m[2] && /<t[^>]*>([\s\S]*?)<\/t>/.exec(m[2])
    let value = ''
    if (a.t === 's') value = sst[v ? +v[1] : -1] || ''            // 共享字符串：v 是下标
    else if (a.t === 'inlineStr') value = is ? unesc(is[1]) : ''
    else value = v ? unesc(v[1]) : ''
    // 文本的两种写法（s / inlineStr）归一成同一个类型：两者在表里看不出任何差别，
    // 拿它当差异会把"厂商用共享字符串、我们用内联"这件无关紧要的事报成错。
    const type = a.t === 's' || a.t === 'inlineStr' || a.t === 'str' ? 's' : (a.t || 'n')
    cells[a.r] = {
      s: +(a.s || 0), type, value,
      font: st.font || '', border: st.border || '', align: st.align || '', fmt: st.fmt || '',
    }
  }
  const setup = attrsOf(block(sx, 'pageSetup').split('>')[0])
  const margins = attrsOf(block(sx, 'pageMargins').split('>')[0])
  return {
    cells, colWidths, rowHeights, merges: [...sx.matchAll(/<mergeCell ref="([^"]+)"/g)].map((m) => m[1]),
    defaultRowHeight: parseFloat(attrsOf(block(sx, 'sheetFormatPr').split('>')[0]).defaultRowHeight || ''),
    page: {
      paperSize: setup.paperSize || '', orientation: setup.orientation || '(默认)',
      fitToPage: /fitToPage="1"/.test(sx),
      margins: [margins.left, margins.top].map((x) => Math.round(parseFloat(x || 0) * 1e6) / 1e6).join('x'),
    },
  }
}

const rowOf = (ref) => +/[0-9]+/.exec(ref)[0]
const colOf = (ref) => /^[A-Z]+/.exec(ref)[0]

/** 数字格（本版口径②：写数而不是文本）允许与参考文件在 fmt/type 上不同 */
function isNumericCell(ref, totalRow) {
  const r = rowOf(ref), c = colOf(ref)
  if (c === 'J' && r === totalRow) return true
  return r >= 4 && r < totalRow && ['H', 'I', 'J'].indexOf(c) >= 0
}

/**
 * 逐格对拍。返回差异描述数组（空数组 = 一致）。
 * 结构（合并/列宽/行高/页面）与每一格的 字体/边框/对齐 **一律要求一致**；
 * 数字格式与单元格类型只在"数字格"白名单里允许不同 —— 这正是本版有意改的两条口径。
 */
export function compareAgainst(got, ref) {
  const out = []
  const refs = Object.keys(ref.cells)
  const totalRow = Math.max(...refs.map(rowOf))
  for (const r of refs) {
    const x = ref.cells[r], y = got.cells[r]
    if (!y) { out.push(r + ' 生成文件里缺这一格'); continue }
    for (const k of ['font', 'border', 'align']) {
      if (x[k] !== y[k]) out.push(`${r} ${k}：参考「${x[k] || '无'}」/ 生成「${y[k] || '无'}」`)
    }
    const num = isNumericCell(r, totalRow)
    if (x.fmt !== y.fmt && !num) out.push(`${r} 数字格式：参考「${x.fmt}」/ 生成「${y.fmt}」`)
    // ★ 数字格有一条**不看参考文件**的硬规矩：不许用"小数点后全是可选位"的格式。
    //   `0.####` 这类写法在 Excel/WPS 里会把整数印成「5.」「1475.」（小数点照样画），
    //   用户实拍到的就是这个。要"整数不带点、有小数才带小数"只有 General 办得到。
    //   这条必须钉在门里：它两边都跟参考文件不同（参考那三格是文本），走白名单会被放过。
    if (num && /0\.#/.test(y.fmt)) {
      out.push(`${r} 数字格式「${y.fmt}」会把整数印成「5.」⇒ 该用 General`)
    }
    // 两边都是空格子时不比类型：厂商给每个空格都写了一个空文本格（t="s" 指到下标 21），
    // 我们写的是"只有样式的空格"。这在表里看不出任何差别，报出来只是噪音。
    if (!num && x.type !== y.type && !(x.value === '' && y.value === '')) {
      out.push(`${r} 单元格类型：参考 ${x.type} / 生成 ${y.type}`)
    }
    if (num && y.type !== 'n') out.push(`${r} 口径②要求数字格，生成的是 ${y.type}`)
  }
  if (got.merges.slice().sort().join(',') !== ref.merges.slice().sort().join(',')) {
    const miss = ref.merges.filter((m) => got.merges.indexOf(m) < 0)
    const more = got.merges.filter((m) => ref.merges.indexOf(m) < 0)
    out.push(`合并区不一致：缺 ${miss.join(',') || '-'}　多 ${more.join(',') || '-'}`)
  }
  if (JSON.stringify(got.colWidths) !== JSON.stringify(ref.colWidths)) {
    out.push('列宽不一致：参考 ' + JSON.stringify(ref.colWidths) + ' / 生成 ' + JSON.stringify(got.colWidths))
  }
  if (JSON.stringify(got.rowHeights) !== JSON.stringify(ref.rowHeights)) {
    out.push('行高不一致：参考 ' + JSON.stringify(ref.rowHeights) + ' / 生成 ' + JSON.stringify(got.rowHeights))
  }
  if (got.defaultRowHeight !== ref.defaultRowHeight) out.push('默认行高不一致 ' + got.defaultRowHeight + ' vs ' + ref.defaultRowHeight)
  for (const k of ['paperSize', 'orientation', 'margins']) {
    if (got.page[k] !== ref.page[k]) out.push(`页面 ${k}：参考「${ref.page[k]}」/ 生成「${got.page[k]}」`)
  }
  return out
}
