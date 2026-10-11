<template>
  <view class="page my">
    <!-- 账号卡 -->
    <view class="account" @click="goStoreSelect" hover-class="hv-on" :hover-stay-time="80">
      <view class="account__badge">{{ initial }}</view>
      <view class="account__meta">
        <text class="account__name">{{ auth.currentStore?.title || auth.currentStore?.name || '当前店铺' }}</text>
        <text class="account__sub">当前账套 · {{ auth.user?.name || '未登录' }}</text>
      </view>
      <!-- ★ 只有一家 / 只有一本账时不画这颗箭头：以前它无条件挂着，点下去却什么都不发生。
           箭头就是"这里能进"的承诺，兑现不了就别写（首页那条店铺条同一条规矩）。 -->
      <Icon v-if="auth.hasMultiDatabase" name="chevron-right" :size="17" />
    </view>

    <!-- 设备与连接 -->
    <text class="group-title">设备与连接</text>
    <view class="card settings">
      <view class="settings__row">
        <text class="settings__label">数据连接状态</text>
        <view class="settings__value" :class="dbClass">
          <view class="dot" />
          <text>{{ dbText }}</text>
        </view>
      </view>
      <view class="settings__row">
        <text class="settings__label">本地服务连接</text>
        <view class="settings__value" :class="connClass">
          <view class="dot" />
          <text>{{ connText }}</text>
        </view>
      </view>
      <view class="settings__row" @click="goPrint" hover-class="hv-on" :hover-stay-time="80">
        <text class="settings__label">打印机</text>
        <view class="settings__value muted">
          <text>{{ caps?.printers ? caps.printers + ' 台可用' : '未连接' }}</text>
          <Icon name="chevron-right" :size="16" />
        </view>
      </view>    </view>

    <!-- 本期经营 -->
    <text class="group-title">本期经营</text>
    <view class="card perf">
      <view class="perf__item">
        <text class="metric-label">当月营业额</text>
        <text class="perf__value">¥{{ fmtMoneyGroup(dash.monthRevenue || 0) }}</text>
      </view>
      <!-- 张数/客单价：后端旧包不回 month_count ⇒ 整格不显示。
           摆个「0 张 / ¥0」是把"没提供"说成"没生意"（首页同一条规矩）。 -->
      <view v-if="dash.monthBillCount !== null && dash.monthBillCount !== undefined" class="perf__item">
        <text class="metric-label">单据数</text>
        <text class="perf__value">{{ dash.monthBillCount }}<text class="perf__unit">张</text></text>
      </view>
      <view v-if="dash.avgBill !== null && dash.avgBill !== undefined" class="perf__item">
        <text class="metric-label">客单价</text>
        <text class="perf__value">¥{{ fmtMoneyGroup(dash.avgBill) }}</text>
      </view>
    </view>

    <!-- 系统 -->
    <text class="group-title">系统</text>
    <view class="card settings">
      <view class="settings__row" @click="goInventory" hover-class="hv-on" :hover-stay-time="80">
        <text class="settings__label">库存查询</text>
        <view class="settings__value muted"><Icon name="chevron-right" :size="16" /></view>
      </view>
      <!-- ★ 2026-09-23：「打印设置」已移除 —— 它与「设备与连接」模块里的「打印机」重复
           （两处都跳同一个打印页），只保留设备与连接那一处。 -->
      <view class="settings__row" @click="goConfig" hover-class="hv-on" :hover-stay-time="80">
        <text class="settings__label">系统配置</text>
        <view class="settings__value muted"><Icon name="chevron-right" :size="16" /></view>
      </view>
      <view class="settings__row" @click="goYxParts" hover-class="hv-on" :hover-stay-time="80">
        <text class="settings__label">燕秀产品处理</text>
        <view class="settings__value muted"><Icon name="chevron-right" :size="16" /></view>
      </view>
      <view class="settings__row" @click="onAuthReview" hover-class="hv-on" :hover-stay-time="80">
        <text class="settings__label">授权信息</text>
        <view class="settings__value muted"><Icon name="chevron-right" :size="16" /></view>
      </view>
      <view class="settings__row" @click="onAbout" hover-class="hv-on" :hover-stay-time="80">
        <text class="settings__label">关于本应用</text>
        <view class="settings__value muted">
          <text class="settings__ver">{{ appVer }}</text>
          <Icon name="chevron-right" :size="16" />
        </view>
      </view>
      <view class="settings__row settings__row--danger" @click="onLogout" hover-class="hv-on" :hover-stay-time="80">
        <text class="settings__label settings__label--danger">退出登录</text>
        <Icon name="logout" :size="17" />
      </view>
    </view>

    <view class="bottom-gap" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '../../store/auth'
import { dashboardApi, capabilityApi } from '../../api/index'
import { fmtMoneyGroup } from '../../utils/format'
import { appInfo, appVersionText } from '../../utils/appInfo'
import Icon from '../../components/Icon.vue'

const auth = useAuthStore()
const dash = ref({})
const caps = ref(null)
/** 这一端自己的版本号（不是 Agent 的）。★ 必须是 computed：App 端要等
 *    `plus.runtime.getProperty` 回来才知道装过没装过 wgt，取一次常量会一直停在基线值。 */
const appVer = computed(() => appVersionText())

const initial = computed(() => {
  const n = auth.currentStore?.title || auth.currentStore?.name || '财'
  return n.slice(0, 1)
})

/**
 * 「数据连接状态」的文案与配色。
 *
 * ★ 三种状态，不能只用两态：
 *   - backendKnown 有值 + healthy → 数据正常（绿）
 *   - backendKnown 有值 + error   → 连接异常（橙），并把原因带到弹窗
 *   - 后端未上报 dbStatus          → 显示「—」，改成中性色，**不假装正常**
 *     （老版本 Agent 不返回该字段时，宁可显示未知，也不给虚假的确定性）
 */
const dbText = computed(() => {
  const c = caps.value
  if (!c) return '—'
  if (!c.dbStatusKnown) return '状态未知'
  return c.dbStatus === 'healthy' ? '数据正常' : '连接异常'
})
const dbClass = computed(() => {
  const c = caps.value
  if (!c || !c.dbStatusKnown) return 'muted'
  return c.dbStatus === 'healthy' ? 'ok' : 'warn'
})

/**
 * 本地服务这一格：同样三态，且**吃离线缓存翻出来的那一份不算数**（caps.stale）。
 * ★ 2026-10-05 现场：本地服务早就停了，这一格却一直挂着「已连接」——
 *   两个原因叠的：① 这页只在 onMounted 取一次数（tabBar 页不会重新挂载，于是那是
 *   第一次进页面时的快照）；② 断网时 capabilityApi 会退到缓存，缓存里那句"在线"是旧的。
 *   只修①还是会挂谎，所以这里连 stale 一起判。
 */
const connText = computed(() => {
  const c = caps.value
  if (!c) return '—'
  if (c.stale) return '状态未知'
  return c.agentOnline ? '已连接' : '离线'
})
const connClass = computed(() => {
  const c = caps.value
  if (!c || c.stale) return 'muted'
  return c.agentOnline ? 'ok' : 'warn'
})

async function load() {
  const [d, c] = await Promise.all([dashboardApi.get(), capabilityApi.get()])
  if (d.ok) dash.value = d.data
  // 读不到就清空，别留着上一次的结果 —— 那等于挂着"已连接"说瞎话
  caps.value = c.ok ? c.data : null
}

function goStoreSelect() {
  // 同首页：只有真能换数据源的入口才给点（一家两本账）。
  // 单账套商户点进来只会看到"读的是同一套账"，那就不如不给这个按钮。
  if (auth.hasMultiDatabase) uni.navigateTo({ url: '/pages/store/select' })
}
function goInventory() { uni.navigateTo({ url: '/pages/inventory/index' }) }
function goPrint() { uni.navigateTo({ url: '/pages/print/index' }) }
/** ★ 2026-09-23：系统模块新增「系统配置」（页面内容暂留空，后续再填）。 */
function goConfig() { uni.navigateTo({ url: '/pages/settings/config' }) }
/** ★ 2026-10-07：燕秀清单 → 货品编号 → 销售单（分步接入中）。
 *    2026-10-10：该页原先那张「接入进度」卡已删，进度不再在界面上标，入口本身不变。 */
function goYxParts() { uni.navigateTo({ url: '/pages/yxparts/index' }) }

function onAuthReview() {
  uni.showModal({
    title: '授权信息',
    content: `用户：${auth.user?.name || '—'}\n店铺：${auth.currentStore?.title || auth.currentStore?.name || '—'}\n账套：${auth.currentDatabase || auth.databases[0] || '默认'}\n可访问店铺：${auth.stores.length} 家\n本地服务连接：${connText.value}`,
    showCancel: false,
  })
}
function onAbout() {
  const c = caps.value
  const a = appInfo()
  // ★ 两个版本分开说：应用版本是**这一端自己**的（APK/小程序/网页），
  //   本地服务版本是客户机上那个 Agent 的 —— 以前混成一个字段，还兜底印 '1.0.0'。
  uni.showModal({
    title: '关于',
    content: `移动经营管理端\n应用版本：${a.version || '未获取'}\n本地服务版本：${c?.agentVersion || '未获取'}\n数据服务：${c?.dbStatus === 'healthy' ? '正常' : (c?.dbStatusKnown ? '异常' : '未知')}`,
    showCancel: false,
  })
}
function onLogout() {
  uni.showModal({
    title: '退出登录', content: '确定要退出当前账号吗？',
    success: (r) => { if (r.confirm) { auth.clear(); uni.reLaunch({ url: '/pages/login/index' }) } },
  })
}

/** ★ 用 onShow 而不是 onMounted：tabBar 页切走再切回来不会重新挂载，
 *    挂在 onMounted 上就等于"整个应用生命周期里只取一次数"（2026-10-05 那个假「已连接」）*/
onShow(load)
</script>

<style lang="scss" scoped>
.my { padding-bottom: 40rpx; }

/* 账号卡 */
.account {
  display: flex; align-items: center; gap: 22rpx;
  background: $color-card; border-radius: $radius-card;
  padding: 30rpx 28rpx; box-shadow: $shadow-card;
}
.account__badge {
  width: 84rpx; height: 84rpx; border-radius: $radius-icon; flex: 0 0 auto;
  background: $color-primary; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 36rpx; font-weight: $fw-heavy;
}
.account__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.account__name { font-size: $fs-subtitle; font-weight: $fw-bold; }
.account__sub { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.account > :deep(.icon-svg) { color: $color-text-4; flex: 0 0 auto; }

/* 分组标题 */
.group-title {
  display: block;
  font-size: $fs-caption; font-weight: $fw-bold; color: $color-text-3;
  margin: $space-gap 0 $space-inner 4rpx;
}

/* 设置列表 */
.settings { padding: 0 $space-card; }
.settings__row {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 96rpx; border-bottom: 1rpx solid $color-divider;
  gap: 20rpx;
}
.settings__row:last-child { border-bottom: 0; }
.settings__label { font-size: $fs-body; color: $color-text; }
.settings__label--danger { color: $color-danger; }
.settings__value { display: flex; align-items: center; gap: 4rpx; font-size: $fs-caption; }
.settings__value.ok { color: $color-success; }
.settings__value.warn { color: $color-warning; }
.settings__value.muted { color: $color-text-4; }
.settings__ver {
  font-family: $font-num; color: $color-text-4;
  font-variant-numeric: tabular-nums;
}
.dot { width: 12rpx; height: 12rpx; border-radius: 50%; background: currentColor; }

/* 经营三格 */
.perf { display: flex; }
.perf__item {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center;
  gap: 12rpx; position: relative;
}
.perf__item + .perf__item::before {
  content: ''; position: absolute; left: 0; top: 8rpx; bottom: 8rpx;
  width: 1rpx; background: $color-divider;
}
.perf__value {
  font-family: $font-num; font-size: 32rpx; font-weight: $fw-heavy;
  color: $color-text; font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
}
.perf__unit { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-3; margin-left: 2rpx; }

.bottom-gap { height: 40rpx; }
</style>
