/**
 * 明细行的"要问一句"操作（销售开单页与采购开单页共用）。
 *
 * ★ 为什么单独一个文件而不是两页各写：这两页历史上凡是"各写一遍"的地方都漂过
 *   （退出挽留、赠品口径都是抽出来之后才对齐的）。删行的确认框同理 ——
 *   文案、按钮字数、活值口径必须一模一样，否则用户在两个页面学到两套规则。
 */
import { fmtMoney } from './format'

/**
 * 删掉明细里的第 i 行。**先问一句再删**：
 *   一单十几行、每行填了品名数量单价备注，点一下 × 就没了，
 *   误操作的代价比"多打一个字"高得多。
 * ★ 确认框里报的是这一行**现在的活值**（品名 / 数量单位 / 这一行的钱），
 *   不是"确定要删除吗"那种说了等于没说的话。
 * ★ 按钮字数按小程序 `showModal` 的限制来（confirmText/cancelText 各 ≤ 4 字），
 *   语义写"删掉 / 留着"，比"确定 / 取消"更不容易点错。
 * @param {object} form 页面表单（要有 items 数组）
 * @param {number} i 要删的那一行下标
 */
export function confirmRemoveLine(form, i) {
  const it = (form.items || [])[i]
  if (!it) return
  const qty = Number(it.qty) || 0
  const amt = Math.round(qty * (Number(it.price) || 0) * 100) / 100
  const what = it.name || it.productId || '这一行'
  uni.showModal({
    title: '删掉这一行？',
    content: '「' + what + '」' + qty + (it.unit ? ' ' + it.unit : '')
      + (it.gift ? '（赠品，不计入合计）' : ' · ¥' + fmtMoney(amt)),
    confirmText: '删掉',
    cancelText: '留着',
    success: (res) => {
      // ★ 只在确认时才删：点"留着"、按系统返回关掉弹窗都不动数据
      if (res && res.confirm) form.items.splice(i, 1)
    },
  })
}
