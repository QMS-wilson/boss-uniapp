/**
 * 开单页「中途退出挽留」—— 销售/采购两页共用一份判断（两处各写迟早漂）。
 *
 * ★ 三端能拦到什么程度（2026-10-02 按 node_modules 里的运行时真源核过，没凭文档想当然）：
 *   · App：物理键/手势返回 → plus 的 `backbutton` → `uni.navigateBack({from:'backbutton'})`
 *     （uni-app-plus/dist/uni.runtime.esm.js 的 backbuttonListener）
 *   · H5：头栏返回按钮 → 同样是 navigateBack({from:'backbutton'})（uni-h5 的 onPageHeadBackButton）
 *   ⇒ 这两条都会走本页的 `onBackPress`，返回 true 就是把人留在本页。
 *   · 小程序：**mp-weixin 的运行时里没有 onBackPress 这个钩子**（整个 dist 搜不到）；
 *     H5 用浏览器自己的后退离开也不经过 uni.navigateBack ⇒ 拦不住。
 *   ⇒ 拦不住的那一端退到 `onUnload`：不问了，直接把内容留进草稿箱，并标成「自动存的」。
 *
 * ★ 配置项（draftBox 的 billExitAsk）关掉 ⇒ 两条都不做：既不弹框，也不静默留。
 * ★ 只在「改过东西」且「已经填出了内容」时才问 —— 只点了个日期不该拦人。
 * ★ 改单态（编辑一张已存在的单）不给「存草稿」：那等于给同一张单留第二份意图，
 *   与底栏「编辑态不出现存草稿按钮」是同一条口径，所以那里只问「放弃修改？」。
 */
import { ref } from 'vue'
import { onBackPress, onUnload } from '@dcloudio/uni-app'
import { billExitAsk } from './draftBox'

/**
 * @param {Object} o
 *  ready       () => bool        页面渲染完了（没渲染完别拿空表单跟人比）
 *  editable    () => bool        这单还能改（已审核/作废的只读页没什么可挽留）
 *  hasContent  () => bool        已经填出了内容（选了往来单位**或**加了明细）
 *  canDraft    () => bool        这一态能存草稿吗（create/复制/草稿续开=true，改单=false）
 *  sig         () => Object      **只含人手填的东西**的表单快照（判改没改就比它）
 *  askText     () => {title, content, discardContent}
 *  silentSave  () => void        拦不住的那一端：把现在的内容存成自动草稿
 *  saving      () => bool        提交在飞（可选）：在飞时既不拦、也不静默存
 */
export function useBillExitGuard(o) {
  return createExitGuard(o)
}

/**
 * ★ hooks 这个参数只为验证而存在：`onBackPress` 在小程序运行时里根本不存在，
 *   那条拦不住的路（onUnload 静默存）在浏览器里也驱动不了 —— 只能把两个钩子换成假的，
 *   在 Node 里跑**同一份判断**（scripts/check-bill-exit-guard-logic.mjs）。
 *   页面里请继续用 useBillExitGuard()，别传第二个参数。
 */
export function createExitGuard(o, hooks) {
  const reg = hooks || { onBackPress, onUnload }
  const askShow = ref(false)
  const askTitle = ref('')
  const askContent = ref('')
  /** 进页面/回填完成时的那份快照 —— 判"到底改没改过"只能跟它比 */
  let baseline = ''
  /** 已经答过、或页面自己正在跳走（提交成功、存完草稿、选了直接退出）：别再拦、别再静默存 */
  let bypass = false
  /** 弹框/模态已经在屏幕上了：再按返回只是回到本页，不叠第二层 */
  let pending = false
  /** 已经让人走了（提交成功/存完草稿/直接退出）——下次 onShow 若还是这个实例就得拉回可写态 */
  let leaving = false

  function sig() { return JSON.stringify(o.sig() || {}) }
  function markClean() { baseline = sig(); closeAsk(); bypass = false }
  function isDirty() { return !!o.ready() && sig() !== baseline }
  /** 页面自己要走（goBack / redirectTo 之前先调用它），挽留闸门就此让路 */
  function allowLeave() { bypass = true; closeAsk(); leaving = true }
  /**
   * keep-alive 复用旧实例时把它从"已经走了"的状态拉回来。
   * ★ H5 后退走的是 popstate，页面实例不销毁；不拉回来的话底栏会永远停在"提交中…"、
   *   挽留闸门也永久失效。返回 true = 这一次确实是从"已离开"回来的。
   */
  function onResume() {
    if (!leaving) return false
    leaving = false; bypass = false
    return true
  }
  /** 关掉弹框 = 人还在本页，下一次按返回要能再问（不许把 pending 漏在true） */
  function closeAsk() { askShow.value = false; pending = false }

  function worthAsking() {
    // ★ 提交在飞时不拦：拦下让人"直接退出"，请求几百毫秒后照样落库，
    //   他以为没提交 → 回去再开一张。也不静默存：那会给同一张单留第二份意图。
    if (o.saving && o.saving()) return false
    return !bypass && !pending && billExitAsk()
      && !!o.editable() && isDirty() && !!o.hasContent()
  }

  /**
   * 返回动作的唯一实现。返回 true = 这一次返回被吃掉了（人留在本页或在弹框里做选择）。
   * ★ onBackPress 与页内「取消」按钮共用 —— 点「取消」也是"中途退出"，
   *   只拦返回键不拦取消，等于留一个"点它就能绕过挽留"的洞。
   */
  function tryBack() {
    if (pending) return true
    if (!worthAsking()) return false
    const t = o.askText()
    askTitle.value = t.title
    askContent.value = t.content
    if (o.canDraft()) { askShow.value = true; pending = true; return true }
    // 改单态：两个按钮就够（放弃修改 / 继续改），不给它造第二份草稿
    pending = true
    uni.showModal({
      title: t.title,
      content: t.discardContent,
      confirmText: '放弃修改',
      cancelText: '继续改',
      success: (r) => { pending = false; if (r && r.confirm) { bypass = true; uni.navigateBack() } },
      fail: () => { pending = false },
    })
    return true
  }

  reg.onBackPress(tryBack)

  reg.onUnload(() => {
    if (bypass || pending || !worthAsking() || !o.canDraft()) return
    o.silentSave()
  })

  return { askShow, askTitle, askContent, markClean, allowLeave, closeAsk, tryBack, isDirty, onResume }
}
