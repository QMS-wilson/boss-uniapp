<template>
  <view class="page home">
    <LoadState :loading="loading" :error="error" :offline="offline" :cached-at="cachedAt" @retry="load">
      <!-- 标题行：经营概览标题 + 店铺账套合并为一行 -->
      <view class="hello">
        <view class="hello__main">
          <text class="hello__title">经营概览</text>
          <text class="hello__sub">数据来自当前店铺 · 更新于 {{ updatedAt }}</text>
        </view>
        <view class="store-bar" @click="goStoreSelect" hover-class="hv-on" :hover-stay-time="80">
          <view class="store-icon"><Icon name="store" :size="16" color="primary" /></view>
          <view class="store-meta">
            <text class="store-name">{{ auth.currentStore?.title || auth.currentStore?.name || '未选择店铺' }}</text>
            <!-- ★ 两本账的机器必须一眼看见"现在读的是哪本"：切错账的数字看着全都正常，
                 这是本项目最难查的一类故障，界面上不能再只写一句"当前经营账套"。 -->
            <text class="store-sub">{{ dbLine }}</text>
          </view>
          <view v-if="auth.hasMultiDatabase" class="store-switch">
            <text class="store-switch__hint">切账套</text>
            <Icon name="chevron-right" :size="14" color="primary" />
          </view>
        </view>
      </view>

      <!-- 指标区：本月销售额 + 今日销售额（一行两列） -->
      <view class="metrics">
        <view class="metric-card">
          <text class="metric-label">本月销售额</text>
          <AnimatedNumber class="metric-value metric-value--sm" :value="dash.monthRevenue" prefix="¥" />
          <view class="metric-foot">
            <!-- 后端没回张数（旧 Agent 包）就不显示这一行：挂着「共 0 张销售单」会被读成
                 这个月一单没开，而真实情况是"这个数没提供"。 -->
            <text v-if="dash.monthBillCount !== null && dash.monthBillCount !== undefined"
                  class="metric-note">共 {{ dash.monthBillCount }} 张销售单</text>
            <!-- 后端不提供环比，monthDelta 为 null 时不显示 -->
            <view
              v-if="dash.monthDelta !== null && dash.monthDelta !== undefined"
              class="metric-delta"
              :class="deltaUp ? 'up' : 'down'"
            >
              <!-- 涨跌两色原本靠 .up/.down 的文字色，但 Icon 不认 currentColor，
                   动态 :color 又生成不出 combo ⇒ 拆成两个静态站点各写死颜色。 -->
              <Icon v-if="deltaUp" name="trending-up" :size="13" color="danger" />
              <Icon v-else name="trending-down" :size="13" color="success" />
              <text>{{ Math.abs(dash.monthDelta) }}%</text>
            </view>
          </view>
        </view>

        <view class="metric-card">
          <text class="metric-label">今日销售额</text>
          <AnimatedNumber class="metric-value metric-value--sm" :value="dash.todayRevenue" prefix="¥" />
          <view class="metric-foot">
            <text class="metric-note">销售单 {{ dash.todayBills }} 笔</text>
            <!-- 待审核不挂在这一格：它是**全量**未审核张数，摆在「今日」下面会被读成
                 "今天有 N 张没审"。引导统一收在下面「需要处理」那一条，一个地方一个门。 -->
          </view>
        </view>
      </view>

      <!-- 应收账款（强调块） -->
      <view class="receivable" @click="goCustomerList" hover-class="hv-on" :hover-stay-time="80">
        <view class="receivable__head">
          <view class="receivable__label">
            <Icon name="wallet" :size="17" color="white" />
            <text>应收账款</text>
          </view>
          <Icon name="chevron-right" :size="17" color="white" />
        </view>
        <AnimatedNumber class="receivable__value" :value="dash.receivableTotal" prefix="¥" />
        <text class="receivable__note">
          {{ dash.receivableCount > 0 ? dash.receivableCount + ' 位客户有未结应收' : '客户未结应收' }}
        </text>
      </view>

      <!-- 主操作 -->
      <button class="btn-primary new-bill" @click="goNewBill">
        <Icon name="plus" :size="20" color="white" />
        <text>新建销售单</text>
      </button>

      <!-- 快捷入口 -->
      <view class="entries">
        <view class="entry" @click="goCustomerList" hover-class="hv-on" :hover-stay-time="80">
          <view class="entry__icon entry__icon--blue"><Icon name="users" :size="19" color="primary" /></view>
          <view class="entry__meta">
            <text class="entry__title">客户资料</text>
            <text class="entry__sub">查看客户与应收账款</text>
          </view>
          <Icon name="chevron-right" :size="17" />
        </view>
        <view class="entry" @click="goProductList" hover-class="hv-on" :hover-stay-time="80">
          <view class="entry__icon entry__icon--violet"><Icon name="package" :size="19" color="violet" /></view>
          <view class="entry__meta">
            <text class="entry__title">产品资料</text>
            <text class="entry__sub">查看与维护商品信息</text>
          </view>
          <Icon name="chevron-right" :size="17" />
        </view>
        <view class="entry" @click="goSupplierList" hover-class="hv-on" :hover-stay-time="80">
          <view class="entry__icon entry__icon--green"><Icon name="truck" :size="19" color="success" /></view>
          <view class="entry__meta">
            <text class="entry__title">供应商资料</text>
            <text class="entry__sub">查看与维护供应商信息</text>
          </view>
          <Icon name="chevron-right" :size="17" />
        </view>
      </view>

      <!-- 待办提醒 -->
      <view v-if="todoList.length" class="todo">
        <view class="todo__head">
          <Icon name="alert-circle" :size="17" color="warning" />
          <text>需要处理</text>
        </view>
        <view v-for="t in todoList" :key="t.text" class="todo__row" @click="onTodo(t)" hover-class="hv-on" :hover-stay-time="80">
          <text class="todo__text">{{ t.text }}</text>
          <view class="todo__go">
            <text>{{ t.action }}</text>
            <Icon name="chevron-right" :size="15" color="warning" />
          </view>
        </view>
      </view>

      <!-- 最近销售单 -->
      <view class="section-head">
        <text class="section-head__title">最近销售单</text>
        <view class="section-head__action" @click="goSalesList" hover-class="hv-on" :hover-stay-time="80">
          <text>查看全部</text>
          <Icon name="chevron-right" :size="15" color="text-3" />
        </view>
      </view>
      <view v-if="recent.length" class="list list--inline">
        <view v-for="(b, i) in recent" :key="b.id" :class="enterClass(i)" :style="enterStyle(i)">
          <BillRow :bill="b" @select="goDetail(b.id)" />
        </view>
      </view>
      <EmptyState v-else text="暂无销售单" sub="点击上方按钮开始第一张单据" />
    </LoadState>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { useAuthStore } from '../../store/auth'
import { dashboardApi } from '../../api/index'
import { salesApi } from '../../api/salesBill'
import { fmtMoneyGroup } from '../../utils/format'
import { expiringDrafts } from '../../utils/draftBox'
import Icon from '../../components/Icon.vue'
import BillRow from '../../components/BillRow.vue'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import { useEnterStagger } from '../../utils/enterStagger'

/** 「最近销售单」前几行错峰到位。首页不做骨架屏：这一页是"成绩单 + 待办 + 最近单据"
 *  三段拼出来的，骨架形状对不上反而更糟（见 Skeleton.vue 顶部那条要求）。 */
const { armEnter, enterClass, enterStyle } = useEnterStagger()
// 金额不再硬跳：报表页早就有这个滚动组件（520ms ease-out，H5 走 rAF、
// 小程序降级 setTimeout 32ms），首页三个数一直是自己在那儿"啪"地换。
import AnimatedNumber from '../../components/AnimatedNumber.vue'

const auth = useAuthStore()

/*
 * 首页那一行要说清"现在读的是哪本账"。
 * ★ 单账套商户不显示库名：对他们这行就是"当前经营账套"，与改造前一模一样；
 *   只有真有两本账的商户才把库名摆出来（切错账的数字看着全都正常，
 *   这是本项目最难查的一类故障，界面上必须能自查）。
 */
const dbLine = computed(() => {
  if (!auth.hasMultiDatabase) return '当前经营账套'
  const cur = auth.currentDatabase || auth.databases[0] || ''
  const def = auth.databases[0] || ''
  return '账套 ' + cur + (cur === def ? '（默认）' : '（非默认，注意别切错）')
})
const loading = ref(true)
const error = ref('')
/** ★ 看板走的是 offlineOk：断网时拿到的是缓存值。不标出来就等于拿几天前的数做决策 */
const offline = ref(false)
const cachedAt = ref(0)
const updatedAt = ref('--:--')
const dash = ref({
  monthRevenue: 0, monthBillCount: null, monthDelta: null,
  todayRevenue: 0, todayBills: 0, pending: null,
  receivableTotal: 0, receivableCount: 0,
})
const recent = ref([])

/* 涨跌判定收进一个 computed：模板属性里写 `>=` 会把 <Icon> 标签的扫描截断，
   图标组合就会漏生成（2026-10-04 踩过，见 scripts/gen-icon-data.py 的站点正则）。 */
const deltaUp = computed(() => Number(dash.value.monthDelta) >= 0)

/*
 * 待办：按「现在就能办掉」排，待审核在最前。
 * ★ 这个张数不是看板 op 给的（它没有这一项），是 load() 里用
 *   bill.list?state=pending&limit=1 的 total 覆盖进 dash.pending 的。
 *   null（那一路没拿到）就不出这条 —— 拿 0 冒充「没有单等着审」比不说更坏。
 *   旧注释曾写「移动端也没有审核接口」，那是错的：salesbill.audit 四个 op 一直在，
 *   详见 api/salesBill.js 末尾与 utils/adapt.js 的 toDashboard。
 */
const todoList = computed(() => {
  const list = []
  if (dash.value.pending > 0) {
    list.push({ text: `${dash.value.pending} 张销售单待审核`, action: '去审核', to: 'sales' })
  }
  if (dash.value.receivableTotal > 0) {
    list.push({ text: `应收账款 ¥${fmtMoneyGroup(dash.value.receivableTotal)} 未结清`, action: '去对账', to: 'reconcile' })
  }
  // ★ 草稿临期：读的是本机草稿桶，不依赖网络 —— 断网时这条照样提醒（不然到期才发现）。
  const soon = expiringDrafts(3)
  if (soon.length) {
    const min = Math.min(...soon.map((d) => d.remainingDays))
    list.push({
      text: `${soon.length} 张草稿${min <= 0 ? '今天' : ' ' + min + ' 天内'}过期`,
      action: '去草稿箱', to: 'drafts',
    })
  }
  return list
})

async function load() {
  loading.value = true
  error.value = ''
  // 第三路只要一个总数：limit=1 不拉明细。bill.list 回的是独立 COUNT(*)
  // （v3agent/sales.py:398），2026-09-20 起不再回裸数组 ⇒ 这个 total 是真数。
  const [dRes, bRes, pRes] = await Promise.all([
    dashboardApi.get(),
    salesApi.list({ pageSize: 3 }),
    salesApi.list({ status: 'unapproved', pageSize: 1 }),
  ])
  loading.value = false
  offline.value = !!dRes.offline
  cachedAt.value = dRes.cachedAt || 0
  if (dRes.ok) {
    dash.value = { ...dash.value, ...dRes.data }
  } else {
    error.value = dRes.message || '经营数据加载失败'
  }
  // ★ 看板那个 op 没有「待审核张数」这一项（toDashboard 给 null），所以在这里用列表的
  //   total 覆盖回去。这一路没拿到就留 null —— 宁可不说，也不说「0 张待审核」。
  if (pRes.ok) dash.value.pending = Number(pRes.data.total) || 0
  if (bRes.ok) recent.value = bRes.data.list || bRes.data.items || []
  armEnter()
  const now = new Date()
  updatedAt.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function onTodo(t) {
  // 三条都得「点进去就落在该落的地方」。sales/list 是 tabBar 页，switchTab 带不了 query，
  // 所以待审核与草稿两路一律经 storage 中转，由列表页 onShow 接住并切筛选。
  if (t.to === 'sales') goPending()
  else if (t.to === 'reconcile') uni.navigateTo({ url: '/pages/report/reconcile' })
  else if (t.to === 'drafts') goDrafts()
}
function goNewBill() { uni.navigateTo({ url: '/pages/sales/edit?mode=create' }) }
function goSalesList() { uni.switchTab({ url: '/pages/sales/list' }) }
/** 草稿箱在销售列表的「草稿」格里；sales/list 是 tabBar 页，switchTab 带不了 query ⇒ storage 中转 */
function goDrafts() {
  uni.setStorageSync('sales_list_drafts', '1')
  uni.switchTab({ url: '/pages/sales/list' })
}
// ★ sales/list 是 tabBar 页，switchTab 不能带 query，改用 storage 中转
function goPending() {
  uni.setStorageSync('sales_list_pending', '1')
  uni.switchTab({ url: '/pages/sales/list' })
}
function goDetail(id) { uni.navigateTo({ url: '/pages/sales/detail?id=' + id }) }
function goCustomerList() { uni.navigateTo({ url: '/pages/customer/list' }) }
function goProductList() { uni.navigateTo({ url: '/pages/product/list' }) }
function goSupplierList() { uni.navigateTo({ url: '/pages/supplier/list' }) }
function goStoreSelect() {
  // 只有真能改变数据的入口才给点：一家两本账时是「选择账套」，
  // 单账套商户点进去只会看到一行"读的是同一套账"，那就不该有这个按钮。
  if (auth.hasMultiDatabase) uni.navigateTo({ url: '/pages/store/select' })
}

/** ★ onShow 不是 onMounted：tabBar 页切走再回来不会重新挂载，挂在 onMounted 上
 *    等于整个应用生命周期只取一次数（「我的」页那个假「已连接」就是这么来的）。
 *    开完单回首页、早上开机第一次进首页，都该看到当下的数。 */
onShow(load)
onPullDownRefresh(async () => { await load(); uni.stopPullDownRefresh() })
</script>

<style lang="scss" scoped>
.home { padding-bottom: 60rpx; }

/* ============ 标题行（经营概览 + 账套合一） ============ */
.hello {
  display: flex; align-items: center; justify-content: space-between;
  gap: 20rpx; margin-bottom: $space-gap;
}
.hello__main { flex: 1; min-width: 0; }
.hello__title { display: block; font-size: $fs-display; font-weight: $fw-heavy; letter-spacing: -1rpx; }
.hello__sub {
  display: block; font-size: $fs-caption; color: $color-text-3; margin-top: 8rpx;
  /* 副标题被右侧账套卡挤窄时会折成「…· 更新」/「于 12:20」两行断句 —— 单行省略，
     完整时间戳意义不大，断句才难看。 */
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ============ 店铺条（内联紧凑） ============ */
.store-bar {
  display: flex; align-items: center; gap: 12rpx;
  flex: 0 0 auto; max-width: 46%;
  background: $color-card; border-radius: $radius-card;
  padding: 14rpx 20rpx; box-shadow: $shadow-card;
}
.store-icon {
  width: 48rpx; height: 48rpx; border-radius: $radius-icon; flex: 0 0 auto;
  background: $color-primary-bg; color: $color-primary;
  display: flex; align-items: center; justify-content: center;
}
.store-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.store-name {
  font-size: $fs-caption; font-weight: $fw-bold; color: $color-text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.store-sub { font-size: $fs-micro; color: $color-text-3; margin-top: 2rpx; }
.store-switch {
  display: flex; align-items: center; gap: 2rpx; flex: 0 0 auto;
  font-size: $fs-caption; color: $color-primary;
}
.store-switch__hint { font-size: $fs-micro; line-height: 1.4; }

/* ============ 指标卡 ============ */
.metrics { display: grid; grid-template-columns: 1fr 1fr; gap: $space-gap; }
.metric-card {
  background: $color-card; border-radius: $radius-card;
  padding: 30rpx 28rpx; box-shadow: $shadow-card;
  display: flex; flex-direction: column;
}
.metric-card--wide { grid-column: 1 / -1; }
.metric-value--sm { font-size: 40rpx; }
.metric-unit { font-size: $fs-caption; font-weight: $fw-normal; color: $color-text-3; margin-left: 4rpx; }
.metric-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; }
.metric-foot .metric-note { margin-top: 0; }
.metric-delta {
  display: flex; align-items: center; gap: 4rpx;
  font-size: $fs-mini; font-weight: $fw-bold; font-variant-numeric: tabular-nums;
}
.metric-delta.up { color: $color-danger; }     /* 中式习惯：涨为红 */
.metric-delta.down { color: $color-success; }  /* 跌为绿 */
.metric-card .metric-note { margin-top: 10rpx; }

/* ============ 应收账款 ============ */
.receivable {
  margin-top: $space-gap;
  border-radius: $radius-card;
  padding: 30rpx 28rpx;
  background: linear-gradient(135deg, $color-primary 0%, #4a92ff 100%);
  box-shadow: $shadow-primary;
  display: flex; flex-direction: column;
}
.receivable__head { display: flex; align-items: center; justify-content: space-between; color: rgba(255,255,255,0.86); }
.receivable__label { display: flex; align-items: center; gap: 10rpx; font-size: $fs-caption; }
.receivable__value {
  font-family: $font-num; font-size: 52rpx; font-weight: $fw-heavy;
  color: #fff; letter-spacing: -1rpx; margin-top: 14rpx;
  font-variant-numeric: tabular-nums;
}
.receivable__note { font-size: $fs-mini; color: rgba(255,255,255,0.78); margin-top: 8rpx; }

/* ============ 主按钮 ============ */
.new-bill { margin-top: $space-gap; width: 100%; }

/* ============ 入口 ============ */
.entries { display: flex; flex-direction: column; gap: $space-inner; margin-top: $space-gap; }
.entry {
  display: flex; align-items: center; gap: 20rpx;
  background: $color-card; border-radius: $radius-card;
  padding: 24rpx 28rpx; box-shadow: $shadow-card;
}
.entry__icon {
  width: 68rpx; height: 68rpx; border-radius: $radius-icon; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.entry__icon--blue { background: $color-primary-bg; color: $color-primary; }
.entry__icon--violet { background: $color-violet-bg; color: $color-violet; }
.entry__icon--green { background: $color-success-bg; color: $color-success; }
.entry__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.entry__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.entry__sub { font-size: $fs-mini; color: $color-text-3; margin-top: 4rpx; }
.entry > :deep(.icon-svg) { color: $color-text-4; flex: 0 0 auto; }

/* ============ 待办 ============ */
.todo {
  margin-top: $space-gap;
  background: $color-warning-bg;
  border-radius: $radius-card;
  padding: 24rpx 28rpx;
}
.todo__head {
  display: flex; align-items: center; gap: 10rpx;
  font-size: $fs-caption; font-weight: $fw-bold; color: $color-warning;
  margin-bottom: 6rpx;
}
.todo__row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 1rpx solid rgba(232, 149, 47, 0.16);
}
.todo__row:last-child { border-bottom: 0; padding-bottom: 0; }
.todo__text { font-size: $fs-caption; color: #8a6a2f; flex: 1; min-width: 0; }
.todo__go { display: flex; align-items: center; gap: 2rpx; font-size: $fs-mini; color: $color-warning; font-weight: $fw-bold; }

/* 列表内嵌（已有外边距，去掉 .list 的横向内边距） */
.list--inline { padding: 0; }
</style>
