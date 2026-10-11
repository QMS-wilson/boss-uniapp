<template>
  <view class="page detail has-action-bar">
    <LoadState :loading="loading" :error="error" skeleton skeleton-variant="detail" skeleton-pad="page" @retry="load">
      <template v-if="cust">
        <!-- 累计销售 / 当前应收 -->
        <view class="top-stats">
          <view class="top-stat">
            <text class="metric-label">累计销售</text>
            <text class="top-stat__value">¥{{ fmtMoneyGroup(cust.saleSum) }}</text>
          </view>
          <view class="top-stat top-stat--hl">
            <text class="metric-label">当前应收</text>
            <text class="top-stat__value">¥{{ fmtMoneyGroup(cust.due) }}</text>
          </view>
        </view>

        <!-- 快捷动作 -->
        <view class="quick-actions">
          <view class="quick-action" @click="goReconcile" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="file-text" :size="19" color="text-2" />
            <text>往来对账</text>
          </view>
          <view class="quick-action" @click="goGoods" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="chart" :size="19" color="text-2" />
            <text>客户货品明细</text>
          </view>
        </view>

        <!-- 详细信息（联系方式 + 价格方案 + 编号合并） -->
        <view class="card contacts">
          <text class="contacts__title">详细信息</text>
          <view class="contact-row">
            <Icon name="user" :size="17" color="text-3" />
            <text class="contact-row__label">客户名称</text>
            <text class="contact-row__value">{{ cust.name || '-' }}</text>
            <!-- 客户停用不会把历史单抹掉：从单据点进来照样能看，但要说清这位现在暂停往来了 -->
            <StopTag kind="customer" :code="cust.code || cust.id" :label="cust.stopped ? (cust.statusName || '暂停往来') : ''" />
          </view>
          <view class="contact-row">
            <Icon name="phone" :size="17" color="text-3" />
            <text class="contact-row__label">电话</text>
            <text class="contact-row__value">{{ cust.phone || '-' }}</text>
          </view>
          <view class="contact-row">
            <Icon name="tag" :size="17" color="text-3" />
            <text class="contact-row__label">客户类别</text>
            <text class="contact-row__value">{{ cust.type || '-' }}</text>
          </view>
          <view class="contact-row contact-row--top">
            <Icon name="store" :size="17" color="text-3" />
            <text class="contact-row__label">地址</text>
            <text class="contact-row__value contact-row__value--wrap">{{ cust.address || '-' }}</text>
          </view>
          <view class="contact-row">
            <Icon name="yen" :size="17" color="text-3" />
            <text class="contact-row__label">价格方案</text>
            <text class="contact-row__value">{{ priceSchemeLabel(cust.priceTrace, cust.priceTypeXs) }}</text>
          </view>
          <view class="contact-row">
            <Icon name="box" :size="17" color="text-3" />
            <text class="contact-row__label">客户编号</text>
            <text class="contact-row__value">{{ cust.code }}</text>
          </view>
        </view>

        <!-- 最近销售记录 -->
        <view class="section-head">
          <text class="section-head__title">最近销售记录</text>
          <view class="section-head__action" @click="goSalesList" hover-class="hv-on" :hover-stay-time="80">
            <text>查看全部</text>
            <Icon name="chevron-right" :size="15" color="text-3" />
          </view>
        </view>
        <view v-if="recentBills.length" class="list list--inline">
          <BillRow v-for="b in recentBills" :key="b.id" :bill="b" @select="goBill(b.id)" />
        </view>
        <!-- ★ 最近销售**没拉到** ≠ 没有单据：把失败说成"从没成交过"，催收场景是危险的误导 -->
        <view v-else-if="recentError" @click="load" hover-class="hv-on" :hover-stay-time="80">
          <EmptyState icon="alert-circle" text="交易记录没拉到" sub="不是没有单，是这次请求失败——点这里重试" />
        </view>
        <EmptyState v-else text="暂无交易记录" sub="该客户还没有销售单" />

        <view class="bottom-gap" />
      </template>

      <EmptyState v-else-if="!loading" text="未找到客户" sub="请从客户列表重新进入" />
    </LoadState>

    <!-- 底部操作 -->
    <view v-if="cust" class="action-bar">
      <button class="btn-ghost action-bar__btn" @click="callPhone">
        <Icon name="phone" :size="18" color="text-2" />
        <text>致电</text>
      </button>
      <button class="btn-primary action-bar__btn" @click="goEdit">
        <text>修改客户资料</text>
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { customerApi } from '../../api/customer'
import { salesApi } from '../../api/salesBill'
import { fmtMoneyGroup } from '../../utils/format'
import { priceSchemeLabel } from '../../utils/adapt'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'
import BillRow from '../../components/BillRow.vue'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'

const code = ref('')
const cust = ref(null)
const recentBills = ref([])
const recentError = ref(false)
const loading = ref(true)
const error = ref('')

async function load() {
  if (!code.value) { loading.value = false; return }
  loading.value = true; error.value = ''
  const res = await customerApi.detail(code.value)
  if (!res.ok) {
    loading.value = false
    error.value = res.message
    return
  }
  cust.value = res.data
  // 客户档案接口不返回单据列表，单独拉一次该客户的销售单
  const bRes = await salesApi.list({ customerId: code.value, pageSize: 5 })
  loading.value = false
  if (bRes.ok) {
    recentError.value = false
    recentBills.value = (bRes.data.list || []).slice(0, 3)
  } else {
    // ★ 失败不许静默：空着不说，界面就会显示成「该客户还没有销售单」
    recentError.value = true
    recentBills.value = []
  }
}

function goReconcile() {
  // ★ name 一起带上（encodeURIComponent）：对账页直接显示客户名并自动查询，
  //   免得页面还得等客户列表回来才能补名称。
  const name = encodeURIComponent(cust.value?.name || '')
  uni.navigateTo({ url: `/pages/report/reconcile?customerId=${code.value}&name=${name}` })
}
function goGoods() {
  const name = encodeURIComponent(cust.value?.name || '')
  uni.navigateTo({ url: `/pages/report/goods?customerId=${code.value}&name=${name}` })
}
function goSalesList() {
  // ★ sales/list 是 tabBar 页，switchTab 不能带 query —— 用 storage 中转
  //   （与首页「待审核 N 笔」的 sales_list_pending 同一套路）。
  uni.setStorageSync('sales_list_customer', { code: code.value, name: cust.value?.name || '' })
  uni.switchTab({ url: '/pages/sales/list' })
}
function goBill(id) { uni.navigateTo({ url: '/pages/sales/detail?id=' + id }) }
function goEdit() { uni.navigateTo({ url: '/pages/customer/edit?mode=edit&code=' + code.value }) }
function callPhone() {
  const num = cust.value?.phone
  if (!num) { uni.showToast({ title: '该客户未登记电话', icon: 'none' }); return }
  uni.makePhoneCall({ phoneNumber: String(num), fail: () => {} })
}

onLoad((q) => { code.value = q.code || q.id || ''; load() })
// ★ 从「修改客户资料」返回时必须刷新（与销售单详情同理）。
let entered = false
onShow(() => {
  if (!entered) { entered = true; return }
  if (code.value) load()
})
</script>

<style lang="scss" scoped>
/* 底栏让位预留统一由全局 .has-action-bar 提供（值来自 uni.scss 的底栏令牌）。
 * ★ 不要再在这里写 padding-bottom，会静默压掉全局预留。 */

/* 顶部双卡 */
.top-stats { display: grid; grid-template-columns: 1fr 1fr; gap: $space-gap; }
.top-stat {
  background: $color-card; border-radius: $radius-card;
  padding: 30rpx 28rpx; box-shadow: $shadow-card;
  display: flex; flex-direction: column;
}
.top-stat--hl { background: $color-primary-bg; box-shadow: none; }
.top-stat__value {
  font-family: $font-num; font-size: 40rpx; font-weight: $fw-heavy;
  color: $color-text; margin-top: 12rpx;
  font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 快捷动作 */
.quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: $space-inner; margin-top: $space-gap; }
.quick-action {
  display: flex; align-items: center; justify-content: center; gap: 10rpx;
  height: 92rpx; border-radius: $radius-btn;
  background: $color-card; border: 1rpx solid $color-border;
  color: $color-text-2; font-size: $fs-caption;
}

/* 联系方式 */
.contacts { margin-top: $space-gap; }
.contacts__title { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; margin-bottom: 8rpx; }
.contact-row {
  display: flex; align-items: center; gap: 14rpx;
  padding: 20rpx 0; border-bottom: 1rpx solid $color-divider;
  color: $color-text-3;
}
.contact-row:last-child { border-bottom: 0; padding-bottom: 0; }
.contact-row--top { align-items: flex-start; }
.contact-row__label { flex: 0 0 auto; font-size: $fs-caption; color: $color-text-3; }
.contact-row__value {
  flex: 1; min-width: 0; text-align: right;
  font-size: $fs-caption; color: $color-text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.contact-row__value--wrap { white-space: normal; line-height: 1.6; }
/* 暂停往来标记：贴在名称后面，从历史单据点进来也能看见 */

/* 取价策略 */
.policy { margin-top: $space-gap; }
.policy__title { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; margin-bottom: 8rpx; }
.policy__row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18rpx 0; border-bottom: 1rpx solid $color-divider;
}
.policy__row:last-child { border-bottom: 0; padding-bottom: 0; }
.policy__label { font-size: $fs-caption; color: $color-text-3; }
.policy__value { font-size: $fs-caption; color: $color-text-2; }
.policy__value--num {
  font-family: $font-num; font-variant-numeric: tabular-nums; color: $color-text-3;
}

.list--inline { padding: 0; }
.action-bar__btn { flex: 1; }
.bottom-gap { height: 40rpx; }
</style>
