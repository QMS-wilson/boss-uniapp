<template>
  <view class="page detail has-action-bar">
    <LoadState :loading="loading" :error="error" skeleton skeleton-variant="detail" skeleton-pad="page" @retry="load">
      <template v-if="sup">
        <!-- 应付 / 预付款 -->
        <view class="top-stats">
          <view class="top-stat">
            <text class="metric-label">应付账款</text>
            <text class="top-stat__value">¥{{ fmtMoneyGroup(sup.due) }}</text>
          </view>
          <view class="top-stat top-stat--hl">
            <text class="metric-label">预付款</text>
            <text class="top-stat__value">¥{{ fmtMoneyGroup(sup.advance) }}</text>
          </view>
        </view>

        <!-- 联系方式 -->
        <view class="card contacts">
          <text class="contacts__title">联系方式</text>
          <view class="contact-row">
            <Icon name="user" :size="17" color="text-3" />
            <text class="contact-row__label">联系人</text>
            <text class="contact-row__value">{{ sup.contact || '-' }}</text>
          </view>
          <view class="contact-row">
            <Icon name="phone" :size="17" color="text-3" />
            <text class="contact-row__label">电话</text>
            <text class="contact-row__value">{{ sup.phone || sup.tel || '-' }}</text>
          </view>
          <view class="contact-row">
            <Icon name="tag" :size="17" color="text-3" />
            <text class="contact-row__label">供应商类别</text>
            <text class="contact-row__value">{{ sup.type || '-' }}</text>
          </view>
          <view class="contact-row contact-row--top">
            <Icon name="store" :size="17" color="text-3" />
            <text class="contact-row__label">地址</text>
            <text class="contact-row__value contact-row__value--wrap">{{ sup.address || '-' }}</text>
          </view>
        </view>

        <!-- 结算信息 -->
        <view class="card policy">
          <text class="policy__title">结算信息</text>
          <view class="policy__row">
            <text class="policy__label">供应商编号</text>
            <text class="policy__value policy__value--num">{{ sup.code }}</text>
          </view>
          <view class="policy__row">
            <text class="policy__label">开户银行</text>
            <text class="policy__value">{{ sup.bankName || '-' }}</text>
          </view>
          <view class="policy__row">
            <text class="policy__label">银行账号</text>
            <text class="policy__value policy__value--num">{{ sup.bankId || '-' }}</text>
          </view>
        </view>

        <!-- 进货价历史 -->
        <view class="section-head">
          <text class="section-head__title">进货价历史</text>
          <text class="section-head__action">共 {{ prices.length }} 项</text>
        </view>
        <view v-if="prices.length" class="list list--inline">
          <view v-for="(p, i) in prices" :key="p.productId + i" class="price-row">
            <view class="price-row__main">
              <view class="price-row__name-line">
                <text class="price-row__name ellipsis">{{ p.name }}</text>
                <StopTag kind="product" :code="p.productId" />
              </view>
              <text class="price-row__meta ellipsis">{{ p.spec || '—' }} · {{ p.lastBillNo || '无单据' }}</text>
            </view>
            <text class="price-row__price">¥{{ fmtMoneyGroup(p.price) }}</text>
          </view>
        </view>
        <EmptyState v-else text="暂无进货价记录" sub="该供应商还没有进货单" />

        <view class="bottom-gap" />
      </template>

      <EmptyState v-else-if="!loading" text="未找到供应商" sub="请从供应商列表重新进入" />
    </LoadState>

    <!-- 底部操作 -->
    <view v-if="sup" class="action-bar">
      <button class="btn-primary action-bar__btn" @click="goEdit">
        <text>修改供应商资料</text>
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { supplierApi } from '../../api/index'
import { fmtMoneyGroup } from '../../utils/format'
import Icon from '../../components/Icon.vue'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import StopTag from '../../components/StopTag.vue'

const code = ref('')
const sup = ref(null)
const prices = ref([])
const loading = ref(true)
const error = ref('')

async function load() {
  if (!code.value) { loading.value = false; return }
  loading.value = true; error.value = ''
  const [dRes, pRes] = await Promise.all([
    supplierApi.detail(code.value),
    supplierApi.prices(code.value),
  ])
  loading.value = false
  if (dRes.ok) {
    sup.value = dRes.data
    if (pRes.ok) prices.value = pRes.data || []
  } else {
    error.value = dRes.message
  }
}

function goEdit() {
  if (!sup.value) return
  uni.navigateTo({ url: '/pages/supplier/edit?mode=edit&id=' + encodeURIComponent(code.value) })
}

onLoad((q) => { code.value = q.code || q.id || ''; load() })
// ★ 从「修改供应商资料」返回时必须重新拉取，否则改完还是显示原数据。
//   首次进入由 onLoad 负责，这里跳过，避免重复请求。
let entered = false
onShow(() => {
  if (!entered) { entered = true; return }
  if (code.value) load()
})
</script>

<style lang="scss" scoped>
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

/* 结算信息 */
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

/* 进货价历史 */
.section-head { display: flex; align-items: center; justify-content: space-between; margin-top: $space-gap; }
.section-head__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.section-head__action { font-size: $fs-mini; color: $color-text-3; }

.price-row {
  display: flex; align-items: center; justify-content: space-between; gap: $space-inner;
  background: $color-card; border-radius: $radius-card;
  padding: 24rpx 28rpx; box-shadow: $shadow-card;
}
.price-row__main { flex: 1; min-width: 0; }
.price-row__name { display: block; font-size: $fs-caption; font-weight: $fw-bold; color: $color-text; }
.price-row__name-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.price-row__meta { display: block; margin-top: 6rpx; font-size: $fs-mini; color: $color-text-3; }
.price-row__price {
  flex: 0 0 auto; font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold;
  color: $color-danger; font-variant-numeric: tabular-nums;
}

.list--inline { padding: 0; }
.action-bar__btn { flex: 1; }
.bottom-gap { height: 40rpx; }
</style>
