/**
 * 燕秀清单：只做一件事 —— 把 .xls/.xlsx 字节读成**原始二维矩阵**。
 *
 * ★ 2026-10-09 起（《燕秀集成方案》A1.5 定案）：表头识别、列映射、归一化、匹配
 *   全部由本地 Agent 用 Python 那一份实现（`v3agent/yxparts/core.py`）。
 *   这里**刻意不留任何业务规则** —— 两套实现漂移过一次就很难发现
 *   （症状是匹配率静默下降、不报错），所以 JS 这边只负责"把文件摊开成行列"。
 *   原先与 core.py 逐行对拍的那份 JS 实现和它的对拍脚本已随之下线。
 *
 * ★ 仍然写成 `import * as XLSX`（**不是** default 导入）：打包时 rollup 走 module
 *   字段 → xlsx.mjs，那个文件没有 default 导出，写 default 会直接构建失败。
 */
import * as XLSX from 'xlsx'

/**
 * 字节 → 每张工作表的矩阵（含表头行与空行，交给 Agent 判定）。
 *
 * raw:false ⇒ 取单元格**显示文本**：日期不会变成 45000 这种序列号、
 * 长编号不会被 JS 数字精度截断，与桌面端 `core._cell_to_str` 的口径一致。
 */
export function bufferToSheets(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  return wb.SheetNames.map((name) => ({
    name,
    matrix: XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1, raw: false, defval: '', blankrows: true,
    }),
  }))
}

/** 给 op 用的载荷：`{ name, rows }[]`，单元格统一成字符串。 */
export function sheetsForOp(sheets) {
  return (sheets || []).map((s) => ({
    name: String((s && s.name) || ''),
    rows: (((s && s.matrix) || [])).map((row) =>
      (row || []).map((c) => (c === null || c === undefined ? '' : String(c)))),
  }))
}

/** 一步到位：字节 → `yxparts.match` 的入参。页面用这个。 */
export function payloadForOp(buffer) {
  return sheetsForOp(bufferToSheets(buffer))
}
