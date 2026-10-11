<template>
  <!--
    三选一确认框：是 / 否 / 取消。

    ★ 为什么不用 uni.showModal：它只有两个按钮，而这里的语义是三个动作
      （是＝再加一行、否＝去改已经录的那一行、取消＝什么都不做留在原处），
      少一个按钮就得把"什么都不做"塞进 cancel，用户点了以为关掉了却触发了别的动作。
    ★ 也不自己造滚动选择器：这是一次性判断，三个按钮一行摆开最省手指。
    ★ mask 点击 = 取消（与全站 .mask 行为一致）。
  -->
  <view v-if="show" class="dlg-mask" @click="onCancel">
    <view class="dlg" @click.stop>
      <text v-if="title" class="dlg__title">{{ title }}</text>
      <text class="dlg__body">{{ content }}</text>
      <view class="dlg__btns">
        <view class="dlg__btn dlg__btn--yes" @click="onYes" hover-class="hv-on" :hover-stay-time="80">{{ yesText }}</view>
        <view class="dlg__btn dlg__btn--no" @click="onNo" hover-class="hv-on" :hover-stay-time="80">{{ noText }}</view>
        <view class="dlg__btn dlg__btn--cancel" @click="onCancel" hover-class="hv-on" :hover-stay-time="80">{{ cancelText }}</view>
      </view>
    </view>
  </view>
</template>

<script setup>
defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  content: { type: String, default: '' },
  yesText: { type: String, default: '是' },
  noText: { type: String, default: '否' },
  cancelText: { type: String, default: '取消' },
})
const emit = defineEmits(['yes', 'no', 'cancel'])
function onYes() { emit('yes') }
function onNo() { emit('no') }
function onCancel() { emit('cancel') }
</script>

<style lang="scss" scoped>
/* ★ z-index 要压过开单页的商品选择面板（.mask 是 100），不然框弹在面板底下看不见 */
.dlg-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(21, 36, 59, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 $space-page;
  animation: mask-in $dur-fast $ease-out;
}
.dlg {
  width: 100%;
  max-width: 600rpx;
  background: $color-card;
  border-radius: $radius-card;
  padding: $space-card;
  box-sizing: border-box;
  /* ★ 居中弹框不走"从底下推上来"：它不在屏幕边上，推上来会让人以为下面还有内容。
       用轻微放大落位，配合 $ease-spring 的那一点点过冲表示"这就是那个决定"。 */
  animation: dlg-pop $dur-panel $ease-spring;
}
@keyframes dlg-pop {
  from { opacity: 0; transform: scale(.92); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes mask-in { from { opacity: 0; } to { opacity: 1; } }
.dlg__title { display: block; text-align: center; font-size: $fs-subtitle; font-weight: $fw-bold; }
.dlg__body {
  display: block;
  margin-top: 14rpx;
  text-align: center;
  font-size: $fs-body;
  line-height: 1.6;
  color: $color-text-2;
}
.dlg__btns { display: flex; gap: $space-tight; margin-top: $space-card; }
.dlg__btn {
  flex: 1;
  min-width: 0;
  height: 88rpx;  /* U6：44px */
  line-height: 88rpx;
  text-align: center;
  border-radius: $radius-btn;
  font-size: $fs-body;
  font-weight: $fw-bold;
  box-sizing: border-box;
}
.dlg__btn--yes { background: $color-primary; color: #fff; }
.dlg__btn--yes:active { background: $color-primary-dark; }
.dlg__btn--no { background: $color-primary-bg; color: $color-primary-dark; }
.dlg__btn--no:active { background: $color-primary-border; }
.dlg__btn--cancel { background: $color-bg-sunken; color: $color-text-3; font-weight: $fw-normal; }
</style>
