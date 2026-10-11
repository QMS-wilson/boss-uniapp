/**
 * xlsx 写出器（**零依赖 + 纯函数**，Node 可直接 import 当门用）。
 *
 * ★ 为什么不用已经装了的 SheetJS（`xlsx`）来写：
 *   社区版的 `write()` **不输出样式** —— 字体、边框、数字格式、行高这些它在读的时候
 *   能看见，写的时候一律丢掉（`cell.s` 只有商业版 xlsx-pro / xlsx-js-style 才认）。
 *   而对账单这张表的"格式"恰恰就是边框 + 合并 + 宋体字号 + 列宽 ⇒ 用它写出来是一张
 *   没有格线的裸表，跟客户手里那张厂商的完全不是一个东西。
 *
 * ★ 为什么不再引一个带样式的 fork：
 *   那份 fork 又要 400 KB 级进页面 chunk（`utils/yxExcel.js` 顶部记着相对 base 下
 *   动态 import 会炸的那条，同一个坑区），而版式要的就这几号样式。
 *   手写 OOXML + STORE 打包 ≈ 200 行，换来的是**三端都能跑**（只用 ArrayBuffer /
 *   DataView / Uint8Array，没有 TextEncoder、没有 Blob、没有 Node API），
 *   以及"版式对拍门能在 Node 里逐项目量回来"。
 *
 * ★ 为什么强调"纯"：不许碰 uni / DOM。落盘是 `utils/export.js` 的事，
 *   这里只把 spec 变成字节 —— 门才能在 Node 里调同一个函数生成同一个文件。
 *
 * 结构（Excel/WPS 都按这个顺序校验，写错了会报"文件已损坏"）：
 *   [Content_Types].xml · _rels/.rels · xl/workbook.xml · xl/_rels/workbook.xml.rels
 *   · xl/styles.xml · xl/worksheets/sheet1.xml
 */

/* ------------------------------------------------------------------ 字节与编码 */

/** 手写 UTF-8：小程序的 JS 引擎不保证有 TextEncoder，不能赌。 */
export function utf8(str) {
  const out = []
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i)
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00); i++ }
    }
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
  }
  return new Uint8Array(out)
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * STORE（不压缩）打包成 zip。
 * ★ 不压缩是有意的：三端都没有可靠的 deflate（H5 有 CompressionStream 但小程序没有），
 *   而这张表最多几十 KB，压不压看不出差别。少一个依赖就少一类"某端打不开"。
 * ★ generalPurposeFlag 写 0x0800（UTF-8 文件名），文件名本身是纯 ASCII，
 *   留这一位是为了以后部件名带上中文也不会被解开成乱码。
 */
function zipStore(files) {
  const parts = [], central = []
  let offset = 0
  for (const f of files) {
    const name = utf8(f.name)
    const data = f.data
    const crc = crc32(data)
    const lh = new Uint8Array(30 + name.length)
    const lv = new DataView(lh.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true)
    lv.setUint16(8, 0, true)                     // method = store
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lh.set(name, 30)
    parts.push(lh, data)

    const ch = new Uint8Array(46 + name.length)
    const cv = new DataView(ch.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(12, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    ch.set(name, 46)
    central.push(ch)

    offset += lh.length + data.length
  }
  const centralSize = central.reduce((a, b) => a + b.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const all = parts.concat(central, [eocd])
  const total = all.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const b of all) { out.set(b, p); p += b.length }
  return out
}

/* ------------------------------------------------------------------ XML 片段 */

const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** 控制字符（0x00-0x08 等）在 OOXML 里是非法字符，留着会让 Excel 报文件损坏 ⇒ 直接丢。 */
function esc(v) {
  return String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/[&<>"]/g, (c) => XML_ESC[c])
}

function colName(c) {          // 1 → A
  let s = ''
  while (c > 0) {
    const m = (c - 1) % 26
    s = String.fromCharCode(65 + m) + s
    c = Math.floor((c - m) / 26)
  }
  return s
}
export function cellRef(r, c) { return colName(c) + r }   // 1 基行列 → "A1"

/* ------------------------------------------------------------------ 样式表 */

const BORDER_EDGES = ['left', 'right', 'top', 'bottom']

/**
 * styles.xml。`numFmts` 从 164 起（1~163 是 Excel 内建号，占了会改坏全局格式）。
 */
function stylesXml(styles) {
  const fonts = (styles.fonts || []).map((f) => {
    let s = '<font>'
    if (f.b) s += '<b/>'
    if (f.u) s += '<u/>'
    if (f.color) s += '<color rgb="' + f.color + '"/>'
    s += '<sz val="' + (f.sz || 11) + '"/>'
    s += '<name val="' + esc(f.name || '宋体') + '"/>'
    s += '<charset val="' + (f.charset || 134) + '"/>'   // 134 = GB2312，中文必需
    return s + '</font>'
  })
  const borders = (styles.borders || []).map((b) => {
    let s = '<border>'
    for (const e of BORDER_EDGES) s += '<' + e + (b[e] ? ' style="' + b[e] + '"><color auto="1"/></' + e + '>' : '/>')
    return s + '<diagonal/></border>'
  })
  const xfs = (styles.xfs || []).map((x) => {
    let s = '<xf numFmtId="' + (x.fmt || 0) + '" fontId="' + (x.font || 0)
      + '" fillId="' + (x.fill || 0) + '" borderId="' + (x.border || 0) + '" xfId="0"'
    if (x.fmt) s += ' applyNumberFormat="1"'
    s += ' applyFont="1" applyBorder="1"'
    if (x.align || x.valign || x.wrap) {
      s += ' applyAlignment="1"><alignment'
      if (x.align) s += ' horizontal="' + x.align + '"'
      s += ' vertical="' + (x.valign || 'center') + '"'
      if (x.wrap) s += ' wrapText="1"'
      s += '/>'
    } else s += '>'
    return s + '</xf>'
  })
  const nf = (styles.numFmts || []).length
    ? '<numFmts count="' + styles.numFmts.length + '">'
      + styles.numFmts.map((f) => '<numFmt numFmtId="' + f.id + '" formatCode="' + esc(f.code) + '"/>').join('')
      + '</numFmts>'
    : ''
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + nf
    + '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="' + borders.length + '">' + borders.join('') + '</borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>'
    + '</styleSheet>'
}

/* ------------------------------------------------------------------ 工作表 */

function sheetXml(sheet) {
  const byRow = new Map()
  let maxR = 1, maxC = 1
  for (const cell of sheet.cells || []) {
    if (!cell.r || !cell.c) continue
    if (cell.r > maxR) maxR = cell.r
    if (cell.c > maxC) maxC = cell.c
    if (!byRow.has(cell.r)) byRow.set(cell.r, [])
    byRow.get(cell.r).push(cell)
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b)

  const cols = (sheet.colWidths || []).map((w, i) => w == null ? ''
    : '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('')

  const rowXml = rows.map((r) => {
    const cs = byRow.get(r).sort((a, b) => a.c - b.c).map((cell) => {
      const ref = cellRef(cell.r, cell.c)
      const s = cell.s ? ' s="' + cell.s + '"' : ''
      const v = cell.v
      if (v === null || v === undefined || v === '') return '<c r="' + ref + '"' + s + '/>'
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) return '<c r="' + ref + '"' + s + '/>'
        return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>'
      }
      return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">'
        + esc(v) + '</t></is></c>'
    }).join('')
    const h = (sheet.rowHeights && sheet.rowHeights[r]) || sheet.defaultRowHeight
    const ht = h ? ' ht="' + h + '" customHeight="1"' : ''
    return '<row r="' + r + '"' + ht + ' spans="1:' + maxC + '">' + cs + '</row>'
  }).join('')

  const merges = (sheet.merges || []).length
    ? '<mergeCells count="' + sheet.merges.length + '">'
      + sheet.merges.map((m) => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>'
    : ''

  const pr = sheet.print || {}
  const margins = pr.margins || { x: 0.593740157480315, y: 0.593740157480315 }
  // ★ CT_Worksheet 的子元素是**有顺序的 sequence**（schema 强制）：
  //   sheetPr → dimension → sheetViews → sheetFormatPr → cols → sheetData → mergeCells
  //   → pageMargins → pageSetup → headerFooter。
  //   放错顺序不报语法错，是 Excel 直接判"文件已损坏，无法打开"，
  //   而 WPS 常常还能打开 ⇒ 只在 WPS 上点一遍会漏掉这一类。
  const sheetPr = pr.fitToWidth ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''
  const print = '<pageMargins left="' + margins.x + '" right="' + margins.x
    + '" top="' + margins.y + '" bottom="' + margins.y + '" header="0" footer="0"/>'
    + '<pageSetup paperSize="' + (pr.paperSize || 9) + '" orientation="'
    + (pr.landscape === false ? 'portrait' : 'landscape') + '"'
    + (pr.fitToWidth ? ' fitToWidth="1" fitToHeight="0"' : '') + '/>'

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + sheetPr
    + '<dimension ref="A1:' + colName(maxC) + maxR + '"/>'
    + '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="' + (sheet.defaultRowHeight || 14.25) + '"/>'
    + (cols ? '<cols>' + cols + '</cols>' : '')
    + '<sheetData>' + rowXml + '</sheetData>'
    + merges
    + print
    + '<headerFooter/>'
    + '</worksheet>'
}

/* ------------------------------------------------------------------ 入口 */

/**
 * @param {object} spec { sheetName, sheet:{cells,colWidths,rowHeights,merges,print}, styles:{numFmts,fonts,borders,xfs} }
 * @returns {Uint8Array}  可直接落盘的 xlsx 字节
 */
export function buildXlsx(spec) {
  const name = spec.sheetName || 'Sheet1'
  const files = [
    { name: '[Content_Types].xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>') },
    { name: '_rels/.rels', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>') },
    { name: 'xl/workbook.xml', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="' + esc(name) + '" sheetId="1" r:id="rId1"/></sheets>'
      + '</workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>') },
    { name: 'xl/styles.xml', data: utf8(stylesXml(spec.styles || {})) },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml(spec.sheet || {})) },
  ]
  return zipStore(files)
}
