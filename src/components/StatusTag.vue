<template>
  <view class="status-tag" :class="[cls, { 'tag-pulse': pulsing }]">
    <view class="dot" />
    <text>{{ label }}</text>
  </view>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from 'vue'
import { STATUS_LABEL } from '../utils/billState'

const props = defineProps({
  status: { type: String, required: true },
  /**
   * 递增这个数字 = 播一次「状态变了」的脉冲（审核 / 反审 / 作废成功后）。
   * ★ 用"递增计数"而不是布尔：连做两次同向操作也要能各播一次，
   *   布尔从 true 到 true 不会触发 watch，第二次就没反应了。
   * ★ 父页务必**等新状态到位后再加**，否则脉冲会播在旧标签上（见 sales/detail 的 load）。
   */
  pulse: { type: Number, default: 0 },
})
const label = computed(() => STATUS_LABEL[props.status] || props.status)
const cls = computed(() => {
  if (props.status === 'void') return 'tag-void'
  if (props.status === 'draft') return 'tag-draft'
  return props.status === 'approved' ? 'tag-approved' : 'tag-unapproved'
})

/**
 * 为什么是"加类 + 超时摘类"而不是常驻类 + 动画重放：
 * CSS 里同一个 animation 换不掉就得先移除再添加，否则第二次不播。
 * 摘掉之后元素回到静态标签，也**不会**留下 transform —— 这点很重要，
 * 常驻 transform 会成为后代 fixed 的包含块（App.vue 里 ls-body 那段就是这个坑）。
 */
const PULSE_MS = 460
const pulsing = ref(false)
let onTimer = null, offTimer = null
watch(() => props.pulse, (n, o) => {
  if (!n || n === o) return
  // ★ 先摘类、隔一帧再加：同一个 animation 想在类上重播，必须先真的移除过，
  //   同一个 tick 里 false→true 会被 Vue 合并成一次 DOM 更新，动画不会重来。
  clearTimeout(onTimer); clearTimeout(offTimer)
  pulsing.value = false
  onTimer = setTimeout(() => {
    pulsing.value = true
    offTimer = setTimeout(() => { pulsing.value = false }, PULSE_MS)
  }, 20)
})
onUnmounted(() => { clearTimeout(onTimer); clearTimeout(offTimer) })
</script>

<style lang="scss" scoped>
.status-tag { display: inline-flex; align-items: center; gap: 6rpx; padding: 4rpx 14rpx; border-radius: $radius-tag; font-size: $fs-mini; font-weight: $fw-bold; line-height: 1.4; }
.dot { width: 10rpx; height: 10rpx; border-radius: 50%; }
.tag-approved { background: $color-success-bg; color: $color-success; .dot { background: $color-success; } }
.tag-unapproved { background: $color-warning-bg; color: $color-warning; .dot { background: $color-warning; } }
/* 已作废：中性灰，不要用红 —— 作废是正常业务动作，不是错误 */
.tag-void { background: $color-bg-sunken; color: $color-text-3; .dot { background: $color-text-4; } }
/* 草稿：也是绿，但加一圈**虚线描边** —— 「已审核」是实底绿，两者同屏出现（草稿箱行、
   开单页标题区），只靠底色深浅分不开。虚线正好对上"还没落库、还差一步"的意思。 */
.tag-draft {
  background: $color-success-bg; color: $color-success;
  border: 1rpx dashed $color-success;
  .dot { background: $color-success; }
}
/* 状态变更脉冲（.tag-pulse + @keyframes）定义在 App.vue —— 采购详情页的 `.po-tag` 也要播
   同一个脉冲，两处各写一份会漂移。这里只负责在合适的时机把类挂上去 / 摘下来。 */
</style>
