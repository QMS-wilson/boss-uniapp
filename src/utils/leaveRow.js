import { ref } from 'vue'

/**
 * 删行之前先让那行"走掉"（2026-10-09）
 *
 * 为什么要有这个：删草稿（以及将来的其它删除）以前是**行凭空消失**、
 * 下面的行瞬间上移 —— 人分不清是"删掉了"还是"列表出问题了"。
 * 破坏性操作最需要的是"我看到它被移走了"这个确认感。
 *
 * 用法：
 *   const { leavingId, leaveThen } = useRowLeave()
 *   // 模板： :class="{ 'row-leave': leavingId === b.id }"
 *   // 删除： leaveThen(b.id, () => { removeDraft(b.id); refreshDrafts() })
 *
 * ★ 为什么是"延迟删除"而不是"动画结束回调"：小程序端拿不到可靠的 animationend，
 *   （和 `<transition>` 的 leave 不支持是同一类问题），只能按时间对齐。
 *   所以 LEAVE_MS 必须**略大于** App.vue 里 .row-leave 的动画时长（$dur-panel = 240ms），
 *   留 20ms 余量；改了那边记得改这里。
 * ★ 不做 prefers-reduced-motion 检测：低端小程序里 matchMedia 不可靠，
 *   而 App.vue 已经把 .row-leave 的 animation 归零 —— 动画没了，260ms 后照样删掉，
 *   只是看不见过程，行为正确。
 */
export const LEAVE_MS = 260

export function useRowLeave() {
  const leavingId = ref('')
  let timer = null

  /** @param {string} id 行的 key；@param {Function} doRemove 动画放完后再执行的真删除 */
  function leaveThen(id, doRemove) {
    if (leavingId.value) return          // 上一行还在走，忽略这次（防连点删两行）
    leavingId.value = id
    timer = setTimeout(() => {
      leavingId.value = ''
      doRemove()
    }, LEAVE_MS)
  }

  return { leavingId, leaveThen }
}
