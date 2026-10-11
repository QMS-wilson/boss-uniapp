<template>
  <!--
    骨架屏分支（2026-10-09）——
    ★ 走**显式 prop** 而不是 `$slots.skeleton` 探测：小程序端的 $slots 在模板里不可靠，
      页面写 `skeleton` 就是"我这儿的结构能预知"，没写就还是转圈。
    ★ 骨架**不进 .state-wrap**：那一层有 padding 60rpx + 居中，骨架会被压成一条。
      这里用与 .list 完全相同的 padding，数据进来时列表位置不动 —— 这才是骨架屏的意义。
  -->
  <view v-if="loading && skeleton" class="ls-skel" :class="'ls-skel--' + skeletonPad">
    <Skeleton :rows="skeletonRows" :variant="skeletonVariant" />
  </view>
  <view v-else-if="loading" class="state-wrap">
    <view class="spinner" /><text class="state-text">加载中…</text>
  </view>
  <view v-else-if="error" class="state-wrap" @click="$emit('retry')" hover-class="hv-on" :hover-stay-time="80">
    <view class="state-icon"><Icon name="alert-circle" :size="32" color="text-3" /></view>
    <text class="state-text">{{ error }}</text>
    <text class="state-retry">点击重试</text>
  </view>
  <!--
    ★ 离线兜底**不能整屏换成一句提示**（旧写法就是这样，结果没有任何页面敢传 offline，
      这条分支成了死代码，而用户看到的是"几天前的数长得和实时一模一样"）。
      数据照常显示，只在顶上压一条说明。
  -->
  <block v-else>
    <view v-if="offline" class="offline-bar">
      <Icon name="refresh" :size="15" color="warning" />
      <text class="offline-bar__t">{{ note || (cachedAtText + ' · 本地服务没连上，下面这些是缓存里的数') }}</text>
    </view>
    <!-- ★ 包这一层只为"内容淡入"：以前 spinner 一消失，整屏内容**硬切**出来，
         读起来像页面重新加载了一次而不是"数据到了"。
         .page 是普通块级、全站没有任何 `.page > xxx` 直接子选择器（已核），
         所以这一层不改布局；sticky/底栏遮挡那两道门跑过才算数。 -->
    <view class="ls-body"><slot /></view>
  </block>
</template>

<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
import Skeleton from './Skeleton.vue'
import { fmtDate } from '../utils/format'

const props = defineProps({ loading: Boolean, error: { type: String, default: '' }, offline: Boolean, cachedAt: { type: Number, default: 0 },
  /** 页面自己写清楚"哪一块是缓存"（报表只有单块走缓存时，整页话术会误导） */
  note: { type: String, default: '' },
  /** 加载态用骨架屏替代转圈（★ 只有"结构可预知"的列表页该开，首页那种拼装页别开） */
  skeleton: Boolean,
  skeletonRows: { type: Number, default: 5 },
  /** bill = 单据行｜row = 档案行｜detail = 详情页三张卡（见 Skeleton.vue） */
  skeletonVariant: { type: String, default: 'bill' },
  /** ★ 骨架容器的 padding 必须与页面容器一致，否则数据进来会整体位移：
   *    list = 列表页（= App.vue 的 .list：16rpx 36rpx 0）｜page = 详情页（= .page：36rpx） */
  skeletonPad: { type: String, default: 'list' } })
defineEmits(['retry'])
const cachedAtText = computed(() => props.cachedAt ? '缓存于 ' + fmtDate(props.cachedAt, true) : '上次成功读取的')
</script>

<style lang="scss" scoped>
/* ★ padding 与页面容器一一对应（见 skeletonPad 的注释），骨架与真实内容严丝合缝 */
.ls-skel { animation: ls-in $dur-fast $ease-out; }
.ls-skel--list { padding: $space-inner $space-page 0; }   /* = App.vue 的 .list */
.ls-skel--page { padding: $space-page; }                  /* = App.vue 的 .page */
.ls-body { animation: ls-in $dur-slow $ease-out; }
/* ★ 只淡 opacity，**不要带 transform/translateY**：
     祖先只要有非 none 的 transform 就会变成 `position: fixed` 后代的包含块，
     而 product/detail、sales/edit、purchase/edit 三页的 `.action-bar`（fixed 底栏）
     就在这个插槽里面（product/detail.vue:99 在 LoadState 3~104 行之间）。
     带 translateY 的话那 320ms 里底栏会脱离视口、跟着内容一起往下挪 —— 又是一次
     "动效把布局弄坏"的教科书案例。opacity 只造 stacking context，不造包含块，安全。 */
@keyframes ls-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.state-wrap {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 60rpx 0;
  animation: ls-in $dur-fast $ease-out;
}
.state-icon { color: $color-text-3; margin-bottom: 16rpx; }
.state-text { font-size: $fs-body; color: $color-text-2; }
.state-retry { font-size: $fs-caption; color: $color-primary; margin-top: 12rpx; }
.offline-bar {
  display: flex; align-items: center; gap: 10rpx;
  margin: 0 $space-page $space-inner;
  padding: 14rpx 20rpx;
  border-radius: $radius-card;
  background: rgba(232, 149, 47, 0.12);
  color: $color-warning;
}
.offline-bar__t { font-size: $fs-caption; line-height: 1.5; }
.spinner { width: 48rpx; height: 48rpx; border-radius: 50%; border: 4rpx solid $color-border; border-top-color: $color-primary; animation: spin $dur-spin linear infinite; margin-bottom: 16rpx; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
