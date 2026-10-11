<template>
  <!--
    骨架屏（2026-10-09）——
    ★ 唯一的设计要求：**高度要尽量贴近真实行**，否则数据进来时内容弹一下，
      比"直接转圈"更难看。所以每个变体都照真实结构量过（见各变体上的注释）。
      详情页做不到严丝合缝（每页卡片高度本来就不同），目标是"不跳得太厉害"。

    三个变体：
      · bill   —— 单据行（BillRow：单号+状态 / 客户+数量 / 日期+金额）  min-height 232rpx
      · row    —— 档案行（客户/供应商/商品/库存：左主区两行 + 右侧金额） min-height 136rpx
      · detail —— 详情页三张卡（头部 / 区块 / 汇总）—— 结构固定，所以形状可以写死

    ★ 只做 opacity 呼吸，不做扫光渐变：扫光要 background-position 动画 + 渐变，
      在低端安卓小程序上会掉帧，而骨架屏的收益本来全在"占住位置"，不在花活。
  -->
  <view v-if="variant === 'detail'" class="sk">
    <!-- ① 头部卡（单号/客户名 + 状态标签 那种） -->
    <view class="sk__row sk__row--detail sk__row--head">
      <view class="sk__line">
        <view class="sk__bar sk__bar--h1" />
        <view class="sk__bar sk__bar--tag" />
      </view>
      <view class="sk__line">
        <view class="sk__bar sk__bar--f" />
        <view class="sk__bar sk__bar--fv" />
      </view>
      <view class="sk__line">
        <view class="sk__bar sk__bar--f" />
        <view class="sk__bar sk__bar--fv" />
      </view>
    </view>

    <!-- ② 区块卡（明细 / 往来 / 单位 那种：一个小标题 + 若干行） -->
    <view class="sk__row sk__row--detail sk__row--block">
      <view class="sk__bar sk__bar--h2" />
      <view v-for="j in 3" :key="j" class="sk__line">
        <view class="sk__bar sk__bar--f2" />
        <view class="sk__bar sk__bar--fv" />
      </view>
    </view>

    <!-- ③ 汇总卡（合计金额那种，最后一行条带更粗） -->
    <view class="sk__row sk__row--detail sk__row--sum">
      <view class="sk__line">
        <view class="sk__bar sk__bar--f" />
        <view class="sk__bar sk__bar--fv" />
      </view>
      <view class="sk__line">
        <view class="sk__bar sk__bar--f" />
        <view class="sk__bar sk__bar--amt" />
      </view>
    </view>
  </view>

  <view v-else class="sk">
    <view v-for="i in rows" :key="i" class="sk__row" :class="'sk__row--' + variant">
      <block v-if="variant === 'bill'">
        <view class="sk__line">
          <view class="sk__bar sk__bar--no" />
          <view class="sk__bar sk__bar--tag" />
        </view>
        <view class="sk__line">
          <view class="sk__bar sk__bar--name" />
          <view class="sk__bar sk__bar--qty" />
        </view>
        <view class="sk__line sk__line--foot">
          <view class="sk__bar sk__bar--date" />
          <view class="sk__bar sk__bar--amount" />
        </view>
      </block>
      <block v-else>
        <view class="sk__line sk__line--mid">
          <view class="sk__col">
            <view class="sk__bar sk__bar--name" />
            <view class="sk__bar sk__bar--meta" />
          </view>
          <view class="sk__col sk__col--right">
            <view class="sk__bar sk__bar--qty" />
            <view class="sk__bar sk__bar--amount" />
          </view>
        </view>
      </block>
    </view>
  </view>
</template>

<script setup>
defineProps({
  /** 骨架行数（bill / row 用）。默认 5：一屏大约能看见 4~5 张卡，再多也没有增量价值。 */
  rows: { type: Number, default: 5 },
  /** bill = 单据行（三段）｜row = 档案行（左主右额）｜detail = 详情页三张卡 */
  variant: { type: String, default: 'bill' },
})
</script>

<style lang="scss" scoped>
.sk { display: flex; flex-direction: column; gap: $space-gap; }

.sk__row {
  background: $color-card;
  border-radius: $radius-card;
  padding: 28rpx;
  box-shadow: $shadow-card;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
/* 与真实行同高（见模板顶部注释），保证内容替换时不跳 */
.sk__row--bill { min-height: 232rpx; }
.sk__row--row { min-height: 136rpx; justify-content: center; }
/* 详情页的卡内间距是 $space-card(36rpx)，比列表行的 28rpx 宽 */
.sk__row--detail { padding: $space-card; gap: 22rpx; }
.sk__row--head { min-height: 250rpx; }
.sk__row--block { min-height: 330rpx; }
.sk__row--sum { min-height: 170rpx; }

.sk__line { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; }
.sk__line--mid { align-items: flex-start; }
.sk__line--foot { padding-top: 18rpx; border-top: 1rpx solid $color-divider; align-items: baseline; }
.sk__col { display: flex; flex-direction: column; gap: 12rpx; min-width: 0; }
.sk__col--right { align-items: flex-end; }

.sk__bar {
  background: $color-bg-sunken;
  border-radius: 8rpx;
  animation: sk-breathe $dur-spin ease-in-out infinite alternate;
}
/* 每根条带错开一点相位，整块一起明灭会像"页面在闪" */
.sk__bar--no { width: 42%; height: 22rpx; }
.sk__bar--tag { width: 88rpx; height: 30rpx; border-radius: $radius-tag; }
.sk__bar--name { width: 58%; height: 28rpx; }
.sk__bar--qty { width: 64rpx; height: 20rpx; }
.sk__bar--date { width: 34%; height: 20rpx; }
.sk__bar--amount { width: 110rpx; height: 30rpx; animation-delay: 240ms; }
.sk__bar--meta { width: 200rpx; height: 20rpx; animation-delay: 160ms; }
/* detail 变体 */
.sk__bar--h1 { width: 52%; height: 34rpx; }
.sk__bar--h2 { width: 32%; height: 26rpx; }
.sk__bar--f { width: 26%; height: 22rpx; }
.sk__bar--f2 { width: 44%; height: 22rpx; animation-delay: 120ms; }
.sk__bar--fv { width: 30%; height: 22rpx; animation-delay: 200ms; }
.sk__bar--amt { width: 130rpx; height: 32rpx; animation-delay: 280ms; }

@keyframes sk-breathe {
  from { opacity: .5; }
  to { opacity: 1; }
}
/* ★ 与 App.vue 同一套策略：系统开了"减少动效"就把呼吸也停掉（静态灰条一样能占位） */
@media (prefers-reduced-motion: reduce) {
  .sk__bar { animation: none; opacity: .75; }
}
</style>
