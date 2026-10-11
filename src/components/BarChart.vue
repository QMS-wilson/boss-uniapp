<template>
  <view class="bars">
    <view class="bars__head">
      <view class="bars__meta">
        <text class="bars__title">{{ title }}</text>
        <text v-if="subtitle" class="bars__sub">{{ subtitle }}</text>
      </view>
      <text v-if="unit" class="bars__unit">{{ unit }}</text>
    </view>

    <view class="bars__body">
      <view
        v-for="(row, i) in rows" :key="(row.id || row.name) + i"
        class="bars__row" :class="{ 'bars__row--tap': clickable }"
        @click="onSelect(row, i)" hover-class="hv-on" :hover-stay-time="80">
        <view class="bars__rank" :class="rankClass(i)">{{ i + 1 }}</view>
        <view class="bars__name-line">
          <text class="bars__name ellipsis">{{ row.name }}</text>
          <!-- 排行里这位/这件要是停着的一定要说出来：老板会照着这张表去催款、去补货 -->
          <StopTag v-if="kind" :kind="kind" :code="row.id" />
        </view>
        <view class="bars__track">
          <view
            class="bars__fill"
            :class="{ 'bars__fill--top': i === 0 }"
            :style="{ width: row.percent + '%', animationDelay: Math.min(i, 8) * 40 + 'ms' }"
          />
        </view>
        <text class="bars__value">{{ row.display }}</text>
        <Icon v-if="clickable" name="chevron-right" :size="14" class="bars__chevron" color="text-4" />
      </view>
      <view v-if="!rows.length" class="bars__empty">
        <text>暂无数据</text>
      </view>
      <view v-if="expandable && collapsed && rawCount > limit" class="bars__more" @click="collapsed = false" hover-class="hv-on" :hover-stay-time="80">
        <text>查看全部 {{ rawCount }} 项</text>
        <Icon name="chevron-down" :size="15" color="primary" />
      </view>
      <view v-else-if="expandable && !collapsed" class="bars__more" @click="collapsed = true" hover-class="hv-on" :hover-stay-time="80">
        <text>收起</text>
        <Icon name="chevron-up" :size="15" color="primary" />
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { fmtMoneyGroup } from '../utils/format'
import Icon from './Icon.vue'
import StopTag from './StopTag.vue'

const props = defineProps({
  title: { type: String, default: '排行' },
  subtitle: { type: String, default: '' },
  unit: { type: String, default: '' },
  /** [{ name, value, id }] */
  data: { type: Array, default: () => [] },
  /** 数值展示方式：money | raw */
  format: { type: String, default: 'money' },
  limit: { type: Number, default: 5 },
  /** 是否可点行下钻（emit select） */
  clickable: { type: Boolean, default: false },
  /** 是否支持「查看全部」展开（折叠时只显示 limit 条） */
  expandable: { type: Boolean, default: false },
  /** 这一张排行是哪种档案的：customer | supplier | product（不传就不贴停用标签） */
  kind: { type: String, default: '' },
})
const emit = defineEmits(['select'])

const collapsed = ref(true)

const rawCount = computed(() => props.data.length)

/** 归一化 + 排序。★ 保留 id 供下钻跳转用。 */
const sorted = computed(() =>
  props.data
    .map((d) => ({
      id: d.id ?? d.customerId ?? d.productId ?? d.code ?? d.hpbh ?? '',
      name: d.name ?? d.customerName ?? d.productName ?? '-',
      value: Number(d.value ?? d.amount ?? 0),
    }))
    .sort((a, b) => b.value - a.value)
)

const rows = computed(() => {
  const take = props.expandable && collapsed.value ? props.limit : sorted.value.length
  const list = sorted.value.slice(0, take)
  const max = Math.max(...list.map((x) => x.value), 1)
  return list.map((x) => ({
    ...x,
    percent: Math.max(3, Math.round((x.value / max) * 100)),
    display: props.format === 'money' ? '¥' + fmtMoneyGroup(x.value) : String(x.value),
  }))
})

function rankClass(i) {
  return i === 0 ? 'bars__rank--gold' : i === 1 ? 'bars__rank--silver' : i === 2 ? 'bars__rank--bronze' : ''
}

function onSelect(row, i) {
  if (!props.clickable || !row.id) return
  emit('select', { id: row.id, name: row.name, value: row.value, index: i })
}
</script>

<style lang="scss" scoped>
.bars { padding: 30rpx 28rpx; }

.bars__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; }
.bars__title { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; color: $color-text; }
.bars__sub { display: block; font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.bars__unit { font-size: $fs-mini; color: $color-text-3; flex: 0 0 auto; }

.bars__body { margin-top: 26rpx; display: flex; flex-direction: column; gap: 26rpx; }
.bars__row { display: flex; align-items: center; gap: 14rpx; }
.bars__row--tap { cursor: pointer; }
.bars__row--tap:active { opacity: 0.7; }

.bars__rank {
  width: 34rpx; height: 34rpx; border-radius: 10rpx; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  font-family: $font-num; font-size: $fs-micro; font-weight: $fw-heavy;
  background: $color-bg-sunken; color: $color-text-3;
}
.bars__rank--gold { background: #fff2d9; color: #c8860d; }
.bars__rank--silver { background: $color-bg-sunken; color: #6b7a8d; }
.bars__rank--bronze { background: #fbeade; color: #b57a41; }

/* 名字那一栏宽度是定死的（170rpx）：把标签横着挤进去会让名字只剩几十 px，
   所以停用时改成上下两行 —— 只有停着的那几行长一点，正常的行一点都不变。 */
.bars__name-line { flex: 0 0 auto; width: 170rpx; display: flex; flex-direction: column; gap: 4rpx; }
.bars__name {
  width: 100%;
  font-size: $fs-caption; color: $color-text-2;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.bars__track {
  flex: 1; min-width: 0; height: 16rpx; border-radius: 999rpx;
  background: $color-bg-sunken; overflow: hidden;
}
.bars__fill {
  height: 100%; border-radius: 999rpx;
  background: linear-gradient(90deg, $color-primary, $color-primary-light);
  /* 从左边"长"出来（2026-10-09）：条形图整块刷出来时，读者看不出谁比谁多多少；
     生长过程本身就是一次排序的可视化。
     ★ transform-origin 必须是 left —— 默认 center 会让条从中间往两边长。
     ★ 填充用 backwards：延迟期保持 scaleX(0)，否则条会先整根闪一下再重播。
       这里**不能**用 forwards（同 .enter-row 的理由：没有需要保留的终态）。
     ★ 延迟在模板里按行给（Math.min(i,8)×40ms）：展开"查看全部"时有 20+ 条，
       不设上限会拖到 800ms 以上，那就成慢动作了。 */
  transform-origin: left center;
  animation: bar-grow $dur-slow $ease-out backwards;
}
.bars__fill--top { background: linear-gradient(90deg, $color-primary-dark, $color-primary); }
@keyframes bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@media (prefers-reduced-motion: reduce) {
  .bars__fill { animation: none; }
}

.bars__value {
  flex: 0 0 auto; min-width: 130rpx; text-align: right;
  font-family: $font-num; font-size: $fs-micro; font-weight: $fw-bold;
  color: $color-text-2; font-variant-numeric: tabular-nums;
}
.bars__chevron { flex: 0 0 auto; color: $color-text-4; }

.bars__more {
  display: flex; align-items: center; justify-content: center; gap: 6rpx;
  padding: 16rpx 0 0; font-size: $fs-caption; color: $color-primary; font-weight: $fw-bold;
}
.bars__empty { padding: 40rpx 0; text-align: center; font-size: $fs-caption; color: $color-text-4; }
</style>
