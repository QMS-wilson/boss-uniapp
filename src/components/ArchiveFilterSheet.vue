<template>
  <!--
    档案列表（货品 / 客户 / 供应商）的筛选半页：从底部弹起，和销售单列表那套同一个交互。

    ★ 为什么把「显示已停用」收进来而不是挂在列表下面一条：那一格横在列表顶上会永久吃掉一行高度，
      而它管的又是"低频看一眼"的东西 —— 平时不该占地方。放半页里 = 列表能多显示一条货品。
    ★ 面板里改的是**草稿值**，点「确定」才生效（与 FilterSheet 同一条规矩）：
      边点边查会让人以为筛选在抽风，也看不见"我到底筛了什么"。
    ★ 那两句说明的条数取自接口（stoppedCount），不是拿当前页猜 ——
      一页 120 条，停用的在第 400 页时"猜"会报 0 条。
  -->
  <view v-if="show" class="af-mask" @click="onCancel">
    <view class="af" @click.stop>
      <view class="af__head">
        <text class="af__title">筛选</text>
        <view class="af__x" @click="onCancel" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="18" color="text-3" /></view>
      </view>

      <view class="af__row" @click="draft = !draft" hover-class="hv-on" :hover-stay-time="80">
        <view class="af__main">
          <text class="af__label">显示已停用</text>
          <text class="af__desc">{{ hintText }}</text>
        </view>
        <view class="tg" :class="{ 'tg--on': draft }"><view class="tg__dot" /></view>
      </view>

      <view class="af__bar">
        <view class="af__btn af__btn--ghost" @click="onReset" hover-class="hv-on" :hover-stay-time="80">重置</view>
        <view class="af__btn af__btn--go" @click="onApply" hover-class="hv-on" :hover-stay-time="80">
          确定<text v-if="draft" class="af__n">1</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  /** 当前生效的值（打开面板时拿它当草稿的初值） */
  stopped: { type: Boolean, default: false },
  /** 停用的条数（接口回的活值） */
  count: { type: Number, default: 0 },
  /** 单元词：货品 / 客户 / 供应商 —— 面板里那两句要说清在筛哪一类 */
  noun: { type: String, default: '档案' },
})
const emit = defineEmits(['close', 'apply'])

const draft = ref(props.stopped)
// 每次打开都从"当前生效值"起算：上次点了取消的草稿不许留下来咬人
watch(() => props.show, (v) => { if (v) draft.value = !!props.stopped })

const hintText = computed(() => {
  const n = Number(props.count) || 0
  if (!n) return '默认只显示可以正常开单往来的' + props.noun
  return props.stopped
    ? `列表里已含这 ${n} 条，并排在最前面`
    : `另有 ${n} 条停用的${props.noun}没显示（停用的不能再开单）`
})

function onApply() { emit('apply', draft.value) }
function onReset() { emit('apply', false) }
function onCancel() { emit('close') }
</script>

<style lang="scss" scoped>
/* z-index 要压过 tabBar（uni-h5 的 uni-tabbar 是 998），半页遮罩取 1000 */
.af-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(21, 36, 59, 0.5);
  display: flex;
  align-items: flex-end;
  animation: mask-in $dur-fast $ease-out;
}
.af {
  width: 100%;
  background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  padding: $space-card $space-page calc(#{$space-card} + env(safe-area-inset-bottom));
  box-sizing: border-box;
  animation: af-up $dur-panel $ease-out;
}
@keyframes af-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes mask-in { from { opacity: 0; } to { opacity: 1; } }
.af__head { display: flex; align-items: center; justify-content: space-between; }
.af__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.af__x { padding: 6rpx; }
.af__row {
  display: flex; align-items: center; gap: 20rpx;
  margin-top: 24rpx; padding: 20rpx 0;
  border-top: 1rpx solid $color-divider;
}
.af__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.af__label { font-size: $fs-body; font-weight: $fw-bold; }
.af__desc { font-size: $fs-mini; color: $color-text-3; line-height: 1.5; }
.af__bar { display: flex; gap: $space-inner; margin-top: 28rpx; }
.af__btn {
  flex: 1; height: 88rpx; line-height: 88rpx; text-align: center; /* U6：44px */
  border-radius: $radius-btn; font-size: $fs-body; font-weight: $fw-bold;
}
.af__btn--ghost { background: $color-bg-sunken; color: $color-text-2; font-weight: $fw-normal; }
.af__btn--go { background: $color-primary; color: #fff; }
.af__btn--go:active { background: $color-primary-dark; }
.af__n { font-family: $font-num; margin-left: 6rpx; opacity: 0.9; }

/* 开关：与系统配置页、应收页同一套形状（这里没引组件是因为它只有 6 行样式，
   三处共用一个组件反而要把颜色令牌传来传去） */
.tg {
  flex: 0 0 auto; width: 84rpx; height: 48rpx; border-radius: 24rpx;
  background: $color-bg-sunken; border: 1rpx solid $color-divider;
  display: flex; align-items: center; padding: 3rpx; box-sizing: border-box;
}
.tg--on { background: $color-primary; border-color: $color-primary; }
.tg__dot { width: 40rpx; height: 40rpx; border-radius: 50%; background: #fff; }
.tg--on .tg__dot { transform: translateX(36rpx); }
</style>
