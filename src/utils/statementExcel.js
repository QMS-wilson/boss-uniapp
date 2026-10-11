/**
 * 「月份对账单」版式（一行一个货品的那张表）。
 *
 * 用它的地方：**客户货品明细页**（`pages/report/goods.vue`）的「导出 → 月份对账单（Excel）」。
 * ★ 不是往来对账页 —— 这张是逐单逐行的货品明细，与货品明细页同粒度；
 *   对账页只出「对账明细 CSV」（一行一张单的借贷流水）。这条挂错过一次，别再改回去。
 *
 * 版式源：客户：月份对账单.xlsx（厂商 V3 导出的那张，2026-10-08 按它 1:1 逆出规格）
 * —— 12 列、两级合并、宋体、全细框、A4 横版。
 * 这份实现是**纯函数**（不碰 uni / DOM），所以版式对拍门
 * `scripts/check-statement-excel-format.mjs` 能在 Node 里调同一个函数生成同一个文件，
 * 再拿 SheetJS 与厂商那份逐项量回来（合并/列宽/行高/样式号/数字格式/值）。
 *
 * ★ 两处与厂商那张**故意不一样**（2026-10-08 定的）：
 *   ① 数量取**开单单位数量**（S_SLUnit），不是厂商印的基本数量（S_SL）。
 *      厂商那张多单位行会出「180 × 60 ≠ 900」（180 个、60 是每件价、900 = 15 件 × 60），
 *      改取开单单位后「数量 × 单价 = 应收金额」在同一行里成立。
 *   ② 数量/单价/金额写成**数字**，不是厂商那种文本格（文本格每格左上角一个绿三角、客户没法选中求和）。
 *      格式仍与厂商一致用 **General**；只有合计那一格用 `General"元"`。
 *      ★ 别改成 `0.####` 这类"小数点后全用可选位"的写法：Excel 会照样把小数点印出来，
 *        屏幕上就是「5.」「1475.」（用户实拍到的那条）。General 才会整数不带点、有小数才带小数。
 *
 * ★ 「票号」这一列参考文件里全空，现网也没有可确认真源（XS.NoteCode/NoteCode2 实测都是空串，
 *   把它们当票号是猜的）⇒ **保持空列**，等有确切口径再填，不许拿别的字段凑。
 */
import { buildXlsx } from './xlsxWrite.js'
import { sumMoney } from './money.js'

/* ---------------------------------------------------------------- 版式常量
 * 下面每一号都能在参考文件的 xl/styles.xml / sheet1.xml 里量到，改动请一并跑对拍门。
 */
const FONTS = [
  { name: '宋体', sz: 11 },          // 0 基础（不被引用，占住 xf 0 的默认位）
  { name: '宋体', sz: 12 },          // 1 「客户：xxx」
  { name: '宋体', sz: 22 },          // 2 公司抬头（整行最高、最显眼的那一号）
  { name: '宋体', sz: 10 },          // 3 其余全部：期间、电话、表头、数据、合计
]
const BORDERS = [
  {},                                                        // 0 无框（抬头那两行）
  { left: 'thin', right: 'thin', top: 'thin', bottom: 'thin' },   // 1 四周细框
  { left: 'thin', top: 'thin', bottom: 'thin' },                  // 2 合并格**左半**
  { right: 'thin', top: 'thin', bottom: 'thin' },                 // 3 合并格**右半**
  { top: 'thin', bottom: 'thin' },                                // 4 合并格**中间**
]
/**
 * s 号即 cellXfs 下标。★ 合并区为什么要给每一格都填样式：
 *   OOXML 的合并只留左上角那格的值，**边框是逐格画的** —— 右半不给 s=3，
 *   那条竖线就断在合并区中间（厂商那张给每一侧都配了号，这里照做）。
 */
const XFS = [
  { font: 0 },                                        // 0 默认
  { font: 1, align: 'left' },                          // 1 A1 客户
  { font: 2, align: 'left' },                          // 2 E1 抬头
  { font: 3, align: 'right' },                         // 3 A2 期间
  { font: 3, align: 'center' },                        // 4 G2 电话
  { font: 3, border: 1, align: 'center' },             // 5 普通格（表头/数据/合计两端）
  { font: 3, border: 2, align: 'center' },             // 6 合并左半（D 货品编号 / F 货品名称 / B 合计左）
  { font: 3, border: 3, align: 'center' },             // 7 合并右半（E / G / 合计 I）
  { font: 3, border: 4, align: 'center' },             // 8 合并中间（合计 C~H）
  // 9 合计金额。★ 数字格式只能用 `General"元"`：
  //   写成 `0.####"元"` 或 `0.##"元"` 时，小数点后全是可选位，Excel **照样把小数点印出来**
  //   ⇒ 用户实拍到的「5.」「1475.」就是这么来的。General 才是"整数不带点、有小数才带小数"。
  { font: 3, border: 1, align: 'center', fmt: 164 },
]
/**
 * 只登记这一条。数量/单价/应收金额那三列**不另设格式** —— 用 5 号（General），
 * 与参考文件那三列同一个格式（厂商那三格是文本，我们的是数字，格式都是 General）。
 */
const NUMFMTS = [
  { id: 164, code: 'General"元"' },
]
const STYLES = { numFmts: NUMFMTS, fonts: FONTS, borders: BORDERS, xfs: XFS }

/** 参考文件里的列宽（字符宽，Excel 的 width 值），12 列一列一个 */
export const COL_WIDTHS = [10, 14, 14, 7, 7, 17, 12, 7, 6, 10, 10, 12]
/**
 * 表头十一个格子（D/E、F/G 是合并对，所以数组里有两个空位占着列号）。
 * ★ 最后一列本版改成「销售备注」：厂商模板里印的是「销售备柱」（它的错字），
 *   2026-10-08 用户拍板"备注改上" ⇒ 这一格是**唯一有意与参考文件不同**的文字，
 *   版式对拍门的值层白名单里记的就是它（EXPECTED_TEXT_DIFF）。
 */
export const HEADER_TEXT = ['单据类型', '系统单号', '开单日期', '货品编号', '', '货品名称', '',
  '数量', '单价', '应收金额', '票号', '销售备注']

/** 单据类型文案：V3/我们对客户说的话 → 厂商那张表里的列值 */
export const BILL_TYPE_TEXT = { 销售出货: '销售单', 销售出货单: '销售单', 销售单: '销售单' }

/* ---------------------------------------------------------------- 抬头的暂写死值
 * ★★ 2026-10-08 定：**暂用厂商那张里的抬头与电话**，先不接真源。
 *   真源已经在库里量到了，是账套自己的 `HxAccountInfo`（实测现网 CorpName=同达、Tel/MainTitle 都空）：
 *     MainTitle 有值 → 整行用它；否则拼「CorpName + 对帐单」；右侧放 Tel。
 *   这一层要在 Agent 上开一个只读 op 才能拿到，所以先写死在这**一处** ——
 *   换成活值只动下面这两个常量和调用点，版式其余部分不用碰。
 *   ⚠ 写死的代价：换成第二家商户来导，抬头还是「同达五金」，所以**别把它当成已完成**。
 */
export const DEFAULT_TITLE = '同达五金对帐单'
export const DEFAULT_PHONE = '0760一23122658 87857475'

/* ---------------------------------------------------------------- 行铺平 */

/**
 * 流水（一行一张单）→ 货品行（一行一个货品）。
 * 一张单没有货品行时**仍出一行**（货品那几列留空）：
 * ★ 不是兜底好看 —— 明细层被 lineLimit 截断时，后面的单就是没有 lines，
 *   直接跳过会让这些单**从导出里消失**，而合计也悄悄少一截。宁可留一行空货品行，
 *   让人一眼看出"这单没展开"。
 */
export function flattenStatementRows(items) {
  const rows = []
  for (const it of items || []) {
    const base = {
      type: BILL_TYPE_TEXT[it.typeName] || it.typeName || '销售单',
      billNo: it.billNo || '',
      date: fmtCnDate(it.date),
    }
    const lines = it.lines && it.lines.length ? it.lines : [null]
    for (const ln of lines) {
      rows.push(ln
        ? {
            ...base,
            productId: ln.productId || '',
            name: ln.productName || '',
            qty: ln.quantity,
            price: ln.price,
            // 赠品行厂商那张把应收金额印成**空格**（J_JEZK 本来就是 0），不是印 0
            amount: (ln.gift || !Number(ln.amount)) ? '' : ln.amount,
            invoiceNo: '',
            remark: ln.remark || '',
          }
        : { ...base, productId: '', name: '', qty: '', price: '', amount: '', invoiceNo: '', remark: '' })
    }
  }
  return rows
}

/** '2026-09-29' → '2026年09月29日'。★ 只做字符串切分，不 new Date()：跨端解析差异犯不上。 */
export function fmtCnDate(s) {
  const d = String(s || '').slice(0, 10)
  if (d.length < 10 || d.charAt(4) !== '-' || d.charAt(7) !== '-') return d
  return d.slice(0, 4) + '年' + d.slice(5, 7) + '月' + d.slice(8, 10) + '日'
}

/* ---------------------------------------------------------------- 生成 */

/**
 * @param {object} p
 *   customerName / from / to / title / phone
 *   rows: flattenStatementRows() 的结果
 * @returns {Uint8Array} xlsx 字节
 */
export function buildStatementWorkbook(p = {}) {
  const rows = p.rows || []
  const cells = []
  const merges = ['A1:D1', 'E1:L1', 'A2:F2', 'G2:L2']
  const put = (r, c, v, s) => cells.push({ r, c, v, s })

  put(1, 1, '客户：' + (p.customerName || ''), 1)
  put(1, 5, p.title || DEFAULT_TITLE, 2)
  put(2, 1, '[' + (p.from || '') + '至' + (p.to || '') + ']', 3)
  put(2, 7, p.phone || DEFAULT_PHONE, 4)
  // 抬头两行的其余格也要落样式：合并区靠每格的样式铺底，空着会与正文串号
  for (let c = 2; c <= 4; c++) put(1, c, '', 1)
  for (let c = 6; c <= 12; c++) put(1, c, '', 2)
  for (let c = 2; c <= 6; c++) put(2, c, '', 3)
  for (let c = 8; c <= 12; c++) put(2, c, '', 4)

  // 第 3 行表头：D:E（货品编号）与 F:G（货品名称）是合并对，其余单格
  const pairCols = [4, 6]
  HEADER_TEXT.forEach((t, i) => {
    const c = i + 1
    const s = pairCols.indexOf(c) >= 0 ? 6 : (pairCols.indexOf(c - 1) >= 0 ? 7 : 5)
    put(3, c, t, s)
  })
  merges.push('D3:E3', 'F3:G3')

  rows.forEach((row, idx) => {
    const r = 4 + idx
    put(r, 1, row.type, 5)
    put(r, 2, row.billNo, 5)
    put(r, 3, row.date, 5)
    put(r, 4, row.productId, 6); put(r, 5, '', 7); merges.push('D' + r + ':E' + r)
    put(r, 6, row.name, 6); put(r, 7, '', 7); merges.push('F' + r + ':G' + r)
    put(r, 8, row.qty, 5)
    put(r, 9, row.price, 5)
    put(r, 10, row.amount, 5)
    put(r, 11, row.invoiceNo, 5)
    put(r, 12, row.remark, 5)
  })

  // 合计行：A 标签、B:I 合并成一条空白区（照厂商那张）、J 金额带「元」、K/L 空
  const tr = 4 + rows.length
  put(tr, 1, '应收金额', 5)
  put(tr, 2, '', 6)
  for (let c = 3; c <= 8; c++) put(tr, c, '', 8)
  put(tr, 9, '', 7)
  merges.push('B' + tr + ':I' + tr)
  put(tr, 10, sumMoney(rows.map((x) => x.amount).filter((v) => v !== '')), 9)
  put(tr, 11, '', 5)
  put(tr, 12, '', 5)

  const rowHeights = { 1: 21, 2: 17.25 }
  for (let r = 3; r <= tr; r++) rowHeights[r] = 18

  return buildXlsx({
    sheetName: 'Sheet1',
    styles: STYLES,
    sheet: {
      cells,
      merges,
      colWidths: COL_WIDTHS,
      rowHeights,
      defaultRowHeight: 14.25,
      // 12 列摊在 A4 横版上刚好不切列 ⇒ 厂商那张是手打分页线（rowBreaks id="11"）。
      // 这里行数不固定，改用 fitToWidth=1：**只保证宽度不切列**，纵向让它自然分页。
      print: { paperSize: 9, landscape: true, fitToWidth: true },
    },
  })
}
