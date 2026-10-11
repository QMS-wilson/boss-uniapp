<template>
  <!--
    档案停用标签：只要这一处渲染的是客户/供应商/货品的名字，就该在旁边挂一枚。

    ★ 为什么标签自己会去取清单（而不是要求每个页面先 loadStopMap）：
      这条需求的失败方式是"某个新页面忘了"，而忘了不会报错、没人发现 ——
      用户看到的就是"为什么这家停用了没标"。把取数放进组件，页面只要肯写 <StopTag> 就一定对。
    ★ `label` 是给**接口已经带了状态**的那些行用的（档案三页、应收页），直接贴、不查表；
      两条路都走同一个样式，界面上不会出现两种长相的停用标记。
  -->
  <text v-if="shown" class="stop-tag" :class="{ 'stop-tag--soft': soft }">{{ shown }}</text>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { stopLabel, loadStopMap } from '../utils/stopMap'

const props = defineProps({
  kind: { type: String, default: '' },        // customer | supplier | product
  code: { type: [String, Number], default: '' },
  label: { type: String, default: '' },       // 接口已带状态时直接给，跳过查表
  stopped: { type: [Boolean, String], default: null },
})

// 「停止采购/停止销售/新建货品」是方向上的停，不是这条档案废了 ⇒ 用次要色；只有真停用醒目
const SOFT = ['停止采购', '停止销售', '新建货品', '商城上架']

const shown = computed(() => {
  if (props.label) return props.label
  if (props.stopped === false) return ''
  if (!props.kind) return ''
  return stopLabel(props.kind, props.code)
})
const soft = computed(() => SOFT.indexOf(shown.value) >= 0)

onMounted(() => {
  if (!props.label) loadStopMap()
})
</script>

<style lang="scss" scoped>
.stop-tag {
  flex: 0 0 auto;
  font-size: $fs-micro;
  color: $color-danger;
  background: $color-bg-sunken;
  padding: 4rpx 12rpx;
  border-radius: $radius-tag;
  line-height: 1.4;
}
.stop-tag--soft { color: $color-text-3; }
</style>
