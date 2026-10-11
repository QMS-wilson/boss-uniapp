<template>
  <text class="an">{{ display }}</text>
</template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { fmtMoneyGroup, fmtQty } from '../utils/format'

/**
 * 数字滚动动画（count-up）。
 *
 * ★ 用途：报表页切换期间/粒度时，让金额、数量等指标从旧值平滑滚动到新值，
 *   替代「整页转圈 + 生硬跳变」，观感更顺。
 * ★ format 三种：
 *     money → 千分位金额（fmtMoneyGroup）
 *     raw   → 数量（fmtQty）
 *     pct   → 百分比（值 × 100 + %）
 *   prefix/suffix 用于拼 ¥、件、% 等前后缀（负号由 fmtMoneyGroup 自带）。
 */

const props = defineProps({
  value: { type: [Number, String], default: 0 },
  format: { type: String, default: 'money' },
  prefix: { type: String, default: '' },
  suffix: { type: String, default: '' },
})

const display = ref('')
let timer = 0           // rAF handle（H5）或 timeout handle（小程序）
const DUR = 520         // ms，滚动时长

/**
 * ★★★ 小程序逻辑层（AppService）**没有 requestAnimationFrame** —— 它是浏览器/DOM API，
 *   小程序没有 DOM。直接调用会抛 `TypeError: requestAnimationFrame is not a function`，
 *   而且是在 `watch(..., {immediate:true})` 里**同步抛**的 ⇒ 打断组件初始化，
 *   并且此后**每一次值变化都会再抛一次**。
 *   实测（2026-09-22 微信开发者工具日志）：report 页 9 个 <AnimatedNumber>
 *   → 启动一次报 29 次错（9 次首挂 + 20 次数据更新）。
 *
 *   结论：不能无条件用 rAF。H5 走 rAF（跟屏幕刷新对齐、后台自动暂停）；
 *   小程序降级 setTimeout —— 且间隔取 32ms（≈31fps）而非 16ms：
 *   小程序每次赋值都要 setData 跨线程序列化，60fps 是纯浪费。
 */
const HAS_RAF = typeof requestAnimationFrame === 'function'
const MP_FRAME = 32

function schedule(fn) {
  return HAS_RAF ? requestAnimationFrame(fn) : setTimeout(fn, MP_FRAME)
}
function unschedule(h) {
  if (!h) return
  if (HAS_RAF) cancelAnimationFrame(h)
  else clearTimeout(h)
}

function fmt(v) {
  if (props.format === 'money') return fmtMoneyGroup(v)
  if (props.format === 'pct') return (v * 100).toFixed(1) + '%'
  return fmtQty(v)
}

function render(v) {
  display.value = props.prefix + fmt(v) + props.suffix
}

function animate(from, to) {
  if (timer) { unschedule(timer); timer = 0 }
  // 起点=终点就没必要滚（首挂 value=0 时能省掉整个动画的 setData）
  if (from === to) { render(to); return }
  const start = Date.now()
  const step = () => {
    const t = Math.min((Date.now() - start) / DUR, 1)
    const e = 1 - Math.pow(1 - t, 3)   // ease-out cubic
    render(from + (to - from) * e)
    if (t < 1) timer = schedule(step)
    else timer = 0
  }
  timer = schedule(step)
}

watch(
  () => Number(props.value),
  (nv, ov) => {
    const to = Number.isFinite(nv) ? nv : 0
    const from = Number.isFinite(ov) ? ov : 0
    // 首次挂载（ov undefined）也从 0 滚到目标值，进场就有动画
    animate(from, to)
  },
  { immediate: true },
)

onBeforeUnmount(() => { if (timer) { unschedule(timer); timer = 0 } })
</script>

<style lang="scss" scoped>
.an { font-variant-numeric: tabular-nums; }
</style>
