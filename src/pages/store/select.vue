<template>
  <view class="page">
    <!-- ★ 账套：一台主机两本账的老板才有这一块。点了是**真的换数据源**（请求带 X-Database）。 -->
    <view v-if="auth.hasMultiDatabase" class="card">
      <view class="card__title">选择账套</view>
      <view class="card__hint">
        该商户在这台设备上配置了 {{ auth.databases.length }} 个账套。
        <text v-if="auth.isV3Operator">当前以 V3 操作员身份登录，切换账套需要重新登录（操作员与口令属于具体账套）。</text>
        <text v-else>切换后客户、商品、单据、报表均为该账套的数据。</text>
      </view>
      <view
        v-for="d in auth.databases" :key="d"
        class="store-row" :class="{ 'store-row--active': d === shown }"
        @click="pickDatabase(d)" hover-class="hv-on" :hover-stay-time="80">
        <view class="store-row__info">
          <Icon name="store" :size="20" class="store-row__icon" color="text-3" />
          <view class="store-row__text">
            <text class="store-row__name ellipsis">{{ d }}</text>
            <text class="store-row__id">{{ databaseHint(d) }}</text>
          </view>
        </view>
        <view v-if="d === shown" class="tag tag--cur">
          <Icon name="check" :size="14" color="primary" />
          <text>当前</text>
        </view>
        <view v-else class="tag tag--switch">
          <text>进入</text>
          <Icon name="arrow-right" :size="14" color="primary" />
        </view>
      </view>
    </view>

    <!-- 店铺只是入口名称（客户端归属），不改变任何数据 ⇒ 不给「进入」按钮。
         以前点了会弹一句「已切换至 X」而数据一点没变 —— 那种按钮比没有更坏。 -->
    <view class="card">
      <view class="card__title">我的店铺</view>
      <view v-if="!auth.hasMultiDatabase" class="card__hint">
        以下店铺共用同一账套，切换店铺不会改变页面数据。
      </view>
      <view v-for="s in auth.stores" :key="s.name" class="store-row store-row--static">
        <view class="store-row__info">
          <Icon name="store" :size="20" class="store-row__icon" color="text-3" />
          <view class="store-row__text">
            <text class="store-row__name ellipsis">{{ s.title || s.name }}</text>
            <text class="store-row__id">
              当前账套 {{ shown || '默认账套' }}
              <text v-if="s.online === false"> · 本地服务离线</text>
            </text>
          </view>
        </view>
        <view v-if="s.name === auth.currentStoreName" class="tag tag--cur"><text>本机</text></view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { useAuthStore } from '../../store/auth'
import { setSelectedDatabase } from '../../utils/merchant'
import { toast } from '../../utils/format'
import Icon from '../../components/Icon.vue'

const auth = useAuthStore()

// 没点名时读的就是清单第一本（云端约定的默认库）
const shown = computed(() => auth.currentDatabase || auth.databases[0] || '')

function databaseHint(d) {
  if (d === auth.databases[0]) return '默认账套'
  return d === shown.value ? '当前在读' : '其他账套'
}

function pickDatabase(d) {
  if (d === shown.value) { uni.navigateBack(); return }
  // ★ V3 操作员身份切账套 = 换一个人，必须重新登录：
  //   人是那本账 UserInfo 里的一行、口令也是那本库的。带着 A 本的令牌去读 B 本，
  //   屏幕上的制单人/权限与数字就来自两套东西 —— 这种错看着全是正常的。
  //   应用账号与微信登录是平台侧身份，跟哪本账无关，所以照旧即时切。
  if (auth.isV3Operator) {
    uni.showModal({
      title: '切换账套需要重新登录',
      content: '当前登录身份「' + ((auth.user || {}).name || (auth.user || {}).username || '')
        + '」属于账套 ' + (shown.value || '默认账套') + '。切换到 ' + d
        + ' 需要重新输入该账套的操作员与口令。',
      confirmText: '去重新登录',
      cancelText: '暂不切换',
      success: (r) => {
        if (!r.confirm) return
        auth.clear()                 // clear() 会把选择清成默认，所以目标账套在它之后写
        setSelectedDatabase(d)
        uni.reLaunch({ url: '/pages/login/index' })
      },
    })
    return
  }
  if (!auth.switchDatabase(d)) {
    toast('该账套未登记至当前商户，无法切换', 'error')
    return
  }
  toast('已切换至账套 ' + d, 'success')
  // ★ 用 reLaunch 而不是 switchTab：这条链上十几个页面各自持有列表/报表状态，
  //   只让首页重读会让别的页面继续显示上一本账的数字。切账套是低频重操作，
  //   重建一次页面栈换来「不会有旧数字残留」是划算的。
  setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 400)
}
</script>

<style lang="scss" scoped>
.card__title {
  font-size: $fs-caption;
  font-weight: $fw-bold;
  color: $color-text-3;
  margin-bottom: 6rpx;
}

.card__hint {
  font-size: $fs-mini;
  color: $color-text-3;
  line-height: 1.5;
  margin-bottom: $space-inner;
}

.store-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-inner;
  padding: 26rpx 20rpx;
  margin: 0 -#{$space-inner};
  border-radius: $radius-card-sm;
  border-bottom: 1rpx solid $color-divider;
}
.store-row:last-child { border-bottom: 0; }
.store-row--active {
  background: $color-primary-bg;
  border-bottom-color: transparent;
}
/* 只读行：不给左右留白，看起来就不像可点的 */
.store-row--static { padding-left: 0; padding-right: 0; }
.store-row__info { display: flex; align-items: center; gap: $space-inner; flex: 1; min-width: 0; }
.store-row__icon { color: $color-text-3; flex: 0 0 auto; }
.store-row--active .store-row__icon { color: $color-primary; }
.store-row__text { display: flex; flex-direction: column; min-width: 0; }
.store-row__name { font-size: $fs-body; font-weight: $fw-bold; }
.store-row__id { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }

.tag {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6rpx;
  font-size: $fs-micro;
  font-weight: $fw-bold;
  padding: 8rpx 20rpx;
  border-radius: $radius-pill;
  line-height: 1;
}
.tag--cur {
  color: $color-primary;
  background: $color-card;
  border: 1rpx solid $color-primary;
}
.tag--switch { color: $color-primary; background: $color-primary-bg; }
</style>
