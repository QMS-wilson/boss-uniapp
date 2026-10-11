<template>
  <!-- ★ fade-in 定义在 App.vue（全局 .fade-in）：空态是"结果"，不该硬切出来 -->
  <view class="empty fade-in">
    <view class="empty-icon"><Icon :name="icon" :size="40" color="text-3" /></view>
    <text class="empty-text">{{ text }}</text>
    <text v-if="sub" class="empty-sub">{{ sub }}</text>
  </view>
</template>

<script setup>
import Icon from './Icon.vue'
defineProps({
  icon: { type: String, default: 'inbox' },
  text: { type: String, default: '暂无数据' },
  sub: { type: String, default: '' },
})
</script>

<style lang="scss" scoped>
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80rpx 0; }
.empty-icon { color: $color-text-3; opacity: 0.5; margin-bottom: 20rpx; }
.empty-text { font-size: $fs-body; color: $color-text-2; }
.empty-sub { font-size: $fs-caption; color: $color-text-3; margin-top: 8rpx; }
</style>
