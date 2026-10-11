<template>
  <text class="amount" :class="cls">{{ sign }}{{ text }}</text>
</template>

<script setup>
import { computed } from 'vue'
import { fmtMoneyGroup } from '../utils/format'

const props = defineProps({
  value: { type: [Number, String], default: 0 },
  unit: { type: String, default: '' },
  sign: { type: Boolean, default: false }, // 正数也显示 +
  /** 着色语义（正数时生效）：text 深色（默认，金额/合计）· danger 红（应收/应付）·
   *  success 绿（收款/退款）· primary 主色（售价） */
  tone: { type: String, default: 'text' },
})

const num = computed(() => Number(props.value) || 0)
const sign = computed(() => {
  if (props.sign && num.value > 0) return '+'
  return ''
})
const text = computed(() => fmtMoneyGroup(Math.abs(num.value)) + (props.unit ? ' ' + props.unit : ''))

/* ★ 颜色规则只在这一处定，三条互斥、优先级明确：
   0 → 淡灰（不制造假警报）；负数 → 绿（红冲/退款/预收）；正数 → 按 tone。
   改一处 = 全站生效，别在调用方再各自写颜色。 */
const cls = computed(() => {
  if (num.value === 0) return 'amount--zero'
  if (num.value < 0) return 'amount--neg'
  return 'amount--' + (props.tone || 'text')
})
</script>

<style lang="scss" scoped>
.amount {
  color: $color-text;
  font-variant-numeric: tabular-nums;
  font-weight: $fw-bold;
}
.amount--text { color: $color-text; }
.amount--danger { color: $color-danger; }
.amount--success { color: $color-success; }
.amount--primary { color: $color-primary; }
.amount--neg { color: $color-success; }
.amount--zero { color: $color-text-3; font-weight: $fw-normal; }
</style>
