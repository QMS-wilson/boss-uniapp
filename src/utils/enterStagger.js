import { ref, nextTick } from 'vue'

/**
 * 列表首屏"错峰到位"动效（2026-10-09）
 *
 * 为什么要有这个：下拉/进页面时一屏 20 行同时出现，观感是"页面整个刷新了"，
 * 而不是"数据一条条到位"。给前几行加一点时间差，人眼就会读成"加载完成"。
 *
 * ★ 三条纪律，破一条就是负分（开单页一天点几百次，慢一点都记账）：
 *   ① 只给**前 8 项**、步进 **28ms** ⇒ 总时长 224ms，比一次淡入长不了多少；
 *      超过 8 项的部分不加，否则长列表会"尾巴还在飘"。
 *   ② **只在页面第一次拿到数据时播一次**（done 锁）。翻页、下拉刷新、
 *      切筛选档、搜索都不是"首屏"，一律不播 —— 那些动作用户只想快点看到结果。
 *   ③ 动画用 `backwards` 填充（见 App.vue 的 .enter-row），**不能用 forwards/both**，
 *      否则 animation 会把 transform/opacity 永久钉在终态，压死 .hv-on 的按下反馈。
 */
export const ENTER_MAX = 8
export const ENTER_STEP = 28
const ENTER_TOTAL = ENTER_MAX * ENTER_STEP + 240

export function useEnterStagger() {
  const enterOn = ref(false)
  let timer = null
  let done = false

  /** 数据赋值成功后调用（内部已 nextTick，直接写在赋值后面即可） */
  function armEnter() {
    if (done) return
    done = true
    nextTick(() => {
      enterOn.value = true
      timer = setTimeout(() => { enterOn.value = false }, ENTER_TOTAL)
    })
  }

  function enterClass(i) {
    return (enterOn.value && i < ENTER_MAX) ? 'enter-row' : ''
  }

  function enterStyle(i) {
    return (enterOn.value && i < ENTER_MAX)
      ? { animationDelay: (i * ENTER_STEP) + 'ms' }
      : null
  }

  return { enterOn, armEnter, enterClass, enterStyle }
}
