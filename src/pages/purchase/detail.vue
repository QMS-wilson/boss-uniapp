<template>
  <view class="page detail has-action-bar">
    <LoadState :loading="loading" :error="error" skeleton skeleton-variant="detail" skeleton-pad="page" @retry="load">
      <template v-if="bill">
        <!-- 单据头 -->
        <view class="card head">
          <view class="head__top">
            <view class="po-tag" :class="tagClass(bill.status)">
              <view class="po-tag__dot" />
              <text>{{ statusLabel(bill.status) }}</text>
            </view>
            <text class="head__no">{{ bill.billNo }}</text>
          </view>
          <view class="head__divider" />
          <text class="head__label">供应商</text>
          <view class="head__name-line">
            <text class="head__name ellipsis">{{ bill.supplierName || '（未指定供应商）' }}</text>
            <StopTag kind="supplier" :code="bill.supplierCode" />
          </view>
          <view class="head__meta">
            <view class="head__meta-item">
              <text class="head__meta-label">采购日期</text>
              <text class="head__meta-value">{{ bill.billDate }}</text>
            </view>
            <view class="head__meta-item">
              <text class="head__meta-label">入库仓库</text>
              <text class="head__meta-value">{{ warehouseText }}</text>
            </view>
          </view>
        </view>

        <!-- 不可修改提示（真实改单限制，来自 Agent 的 editable_reasons） -->
        <view v-if="bill.editable === false && bill.editableReasons?.length" class="card lock-card">
          <Icon name="alert-circle" :size="16" color="brown" />
          <text class="lock-card__text">此单不可修改：{{ bill.editableReasons.join('、') }}</text>
        </view>

        <!-- 商品明细 -->
        <view class="card goods-card">
          <view class="goods-card__head">
            <text class="goods-card__title">商品明细</text>
            <text class="goods-card__count">（{{ bill.items?.length || 0 }} 项）</text>
          </view>
          <view v-for="(line, i) in bill.items || []" :key="line.productId + i" class="good">
            <view class="good__main">
              <view class="good__name-line">
                <text class="good__name ellipsis">{{ line.name || line.productId }}</text>
                <StopTag kind="product" :code="line.productId" />
              </view>
              <!-- 赠品行：金额那一格是 0（折后金额），打个标免得被当成录错 -->
              <text v-if="line.gift" class="gift-tag">赠品 · 不计入合计</text>
              <text class="good__meta">{{ line.spec ? line.spec + ' · ' : '' }}{{ line.unit }}</text>
            </view>
            <view class="good__right">
              <text class="good__price">¥{{ fmtMoney(line.price) }} × {{ line.qty }}</text>
              <text class="good__amount">¥{{ fmtMoneyGroup(line.amount) }}</text>
            </view>
          </view>
          <view class="goods-card__total">
            <text class="goods-card__total-label">
              商品总数 <text class="goods-card__total-qty">{{ bill.totalQty }}</text>
            </text>
            <view class="goods-card__total-right">
              <text class="goods-card__total-text">合计</text>
              <text class="goods-card__total-amount">¥{{ fmtMoneyGroup(bill.totalAmount) }}</text>
            </view>
          </view>
        </view>

        <!-- 备注 -->
        <view class="card memo">
          <text class="memo__title">备注</text>
          <text class="memo__text">{{ bill.memo || '暂无备注' }}</text>
        </view>

        <!-- 单据信息 -->
        <view class="card meta-card">
          <text class="meta-card__title">单据信息</text>
          <view class="meta-card__row">
            <text class="meta-card__label">制单人</text>
            <text class="meta-card__value">{{ bill.createdBy || '—' }}</text>
          </view>
          <view class="meta-card__row">
            <text class="meta-card__label">制单时间</text>
            <text class="meta-card__value">{{ bill.createdAt || '—' }}</text>
          </view>
          <view class="meta-card__row">
            <text class="meta-card__label">付款方式</text>
            <text class="meta-card__value">{{ bill.fkfs || '—' }}</text>
          </view>
          <view class="meta-card__row">
            <text class="meta-card__label">可否修改</text>
            <text class="meta-card__value" :class="{ 'meta-card__value--warn': bill.editable === false }">
              {{ bill.editable === false ? '不可修改' : (canModify ? '可修改' : '本版不支持改单') }}
            </text>
          </view>
        </view>

        <view class="bottom-gap" />
      </template>

      <EmptyState v-else-if="!loading" text="请选择采购单" sub="从采购单列表进入详情" />
    </LoadState>

    <!-- 底部操作 -->
    <view v-if="bill" class="action-bar">
      <button class="btn-ghost action-bar__btn" @click="onPrint">
        <Icon name="printer" :size="18" color="text-2" />
        <text>打印</text>
      </button>
      <button class="action-bar__btn"
              :class="canModify ? 'btn-primary' : 'btn-ghost is-disabled'" @click="goEdit">
        <text>{{ modifyLabel }}</text>
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { purchaseApi } from '../../api/index'
import { fmtMoney, fmtMoneyGroup } from '../../utils/format'
import { purchaseStatusLabel } from '../../utils/adapt'
import { hasOp, opList, loadAccountOptions } from '../../store/options'
import Icon from '../../components/Icon.vue'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import StopTag from '../../components/StopTag.vue'

const id = ref('')
const bill = ref(null)
const loading = ref(true)
const error = ref('')

const statusLabel = (s) => purchaseStatusLabel(s)
const tagClass = (s) => (s === 'audited' ? 'po-tag--done'
  : s === 'void' ? 'po-tag--void' : 'po-tag--pending')

/**
 * 仓库显示：Agent 返回 warehouse(编码 101-) + warehouse_name(主仓库)。
 * ★ 原来只显示编码，对用户没意义；有名字就「主仓库（101-）」这样显示。
 */
const warehouseText = computed(() => {
  const b = bill.value
  if (!b) return '—'
  if (b.warehouseName && b.warehouse) return `${b.warehouseName}（${b.warehouse}）`
  return b.warehouseName || b.warehouse || '—'
})

async function load() {
  if (!id.value) { loading.value = false; return }
  loading.value = true; error.value = ''
  const res = await purchaseApi.detail(id.value)
  loading.value = false
  if (res.ok) bill.value = res.data
  else error.value = res.message
}

function onPrint() {
  // ★ 后端只有 print.salesbill（销售单），没有采购单打印 op。
  //   照实说明，不要伪造一个「打印成功」的 toast。
  uni.showToast({ title: '采购单打印后端暂未开放', icon: 'none' })
}
/**
 * 能不能真改这张单：本地服务发布过这个动作 + 这张单本身允许，两个条件缺一不可。
 * ★ 能力那一半问的是 Agent 报回来的动作清单（`hasOp`），不是源码里的常量 ——
 *   H5 一次发所有商户，客户机上的 exe 一家一家换，写死谁都会错一头。
 */
/**
 * 能不能真改这张单：本地服务发布过这个动作 + 这张单本身允许，两个条件缺一不可。
 * ★ 能力那一半问的是 Agent 报回来的动作清单，不是源码里的常量 ——
 *   H5 一次发给所有商户，客户机上的 exe 一家一家换，写死谁都会错一头。
 * ★ 必须经由 ref：`hasOp` 读的是模块级变量、不是响应式的。直接写进 computed
 *   只会在首帧算一次，capabilities 后到也救不回来（按钮会永远停在"不支持"）。
 */
const opCanUpdate = ref(false)
const opsKnown = ref(false)
function syncOp() {
  opsKnown.value = opList().length > 0
  opCanUpdate.value = hasOp('purchase.update')
}
const canModify = computed(() => opCanUpdate.value
  && !!bill.value && bill.value.editable !== false)

/**
 * 按钮上那句话要分得清是**哪一件事**不让改：
 * 这台机器的服务不改进货单（换包就好）/ 这张单本身锁着（锁单卡写了原因）
 * / 还没确认过（点了会去问一次，不装死也不误导）。
 * 混成一句「不支持」会让人去翻设置。
 */
const modifyLabel = computed(() => {
  if (canModify.value) return '修改采购单'
  if (!opsKnown.value) return '修改采购单'
  if (!opCanUpdate.value) return '这台机器的服务不改进货单'
  return '这张单不可修改'
})

async function goEdit() {
  // 一次都没拿到动作清单 ⇒ 现在去问一次再决定，而不是按"不知道"就把人挡在外面
  if (!opsKnown.value) {
    uni.showLoading({ title: '确认中', mask: true })
    await loadAccountOptions(true)
    uni.hideLoading()
    syncOp()
  }
  if (!opCanUpdate.value) {
    uni.showToast({
      title: opsKnown.value ? '这台机器的本地服务还不改进货单，请先更新到最新版'
        : '连不上本地服务，确认不了这台机器能不能改进货单',
      icon: 'none', duration: 3000,
    })
    return
  }
  if (bill.value && bill.value.editable === false) {
    uni.showToast({ title: '此单不可修改', icon: 'none' })
    return
  }
  uni.navigateTo({ url: '/pages/purchase/edit?id=' + id.value })
}

onLoad((opt) => { id.value = opt?.id || '' })
// ★ 动作清单要在**画按钮之前**尽量到位。拉过一次就全应用共享，这里不额外加请求
//   （capabilities 由 store/options 合并并发），拿到后再把两个 ref 刷一次。
loadAccountOptions().then(syncOp)
onMounted(load)
// ★ 从「修改采购单」返回时必须重新拉取，否则显示改之前的数据。
//   首次进入由 onMounted 负责，这里跳过，避免重复请求。
let entered = false
onShow(() => {
  if (!entered) { entered = true; return }
  if (id.value) load()
})
</script>

<style lang="scss" scoped>
/* 底栏让位预留统一由全局 .has-action-bar 提供（值来自 uni.scss 的底栏令牌）。
 * ★ 不要再在这里写 padding-bottom，会静默压掉全局预留。 */

/* 单据头 */
.head { padding: 0; overflow: hidden; }
.head__top { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 28rpx 0; }
.head__no {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold;
  color: $color-text-2; font-variant-numeric: tabular-nums;
}
.head__divider { height: 1rpx; background: $color-divider; margin: 22rpx 0 20rpx; }
.head__label { display: block; font-size: $fs-mini; color: $color-text-3; padding: 0 28rpx; }
.head__name { display: block; font-size: 36rpx; font-weight: $fw-heavy; padding: 8rpx 28rpx 0; }
.head__name-line { display: flex; align-items: center; gap: 12rpx; }
.head__meta { display: flex; gap: 40rpx; padding: 24rpx 28rpx 28rpx; }
.head__meta-item { display: flex; flex-direction: column; }
.head__meta-label { font-size: $fs-micro; color: $color-text-3; }
.head__meta-value {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold;
  color: $color-text-2; margin-top: 6rpx; font-variant-numeric: tabular-nums;
}

.po-tag {
  display: inline-flex; align-items: center; gap: 8rpx;
  padding: 6rpx 16rpx; border-radius: $radius-tag;
  font-size: $fs-micro; font-weight: $fw-bold;
}
.po-tag__dot { width: 10rpx; height: 10rpx; border-radius: 50%; }
.po-tag--done { background: $color-success-bg; color: $color-success; }
.po-tag--done .po-tag__dot { background: $color-success; }
.po-tag--pending { background: $color-warning-bg; color: $color-warning; }
.po-tag--pending .po-tag__dot { background: $color-warning; }
.po-tag--void { background: $color-bg-sunken; color: $color-text-3; }
.po-tag--void .po-tag__dot { background: $color-text-4; }

/* 不可修改提示 */
.lock-card {
  margin-top: $space-gap;
  display: flex; align-items: flex-start; gap: 12rpx;
  background: $color-warning-bg; color: #8a6a2f;
}
.lock-card__text { flex: 1; font-size: $fs-mini; line-height: 1.6; }

/* 商品明细 */
.goods-card { margin-top: $space-gap; }
.goods-card__head { display: flex; align-items: baseline; margin-bottom: 8rpx; }
.goods-card__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.goods-card__count { font-size: $fs-mini; color: $color-text-3; margin-left: 6rpx; }

.good {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 20rpx; padding: 22rpx 0;
  border-bottom: 1rpx solid $color-divider;
}
.good__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.good__name { font-size: $fs-body; font-weight: $fw-bold; color: $color-text; }
.good__name-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
/* 赠品行标记（与销售详情同一写法）：警示色，解释"行上有钱、合计里没有" */
.gift-tag {
  display: inline-block; width: fit-content; margin-top: 6rpx;
  padding: 3rpx 12rpx; border-radius: $radius-tag;
  background: $color-warning-bg; color: $color-warning;
  font-size: $fs-micro; font-weight: $fw-bold;
}
.good__meta { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.good__right { flex: 0 0 auto; text-align: right; display: flex; flex-direction: column; }
.good__price {
  font-family: $font-num; font-size: $fs-mini; color: $color-text-3;
  font-variant-numeric: tabular-nums;
}
.good__amount {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold;
  color: $color-text; margin-top: 6rpx; font-variant-numeric: tabular-nums;
}

.goods-card__total {
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 24rpx;
}
.goods-card__total-label { font-size: $fs-caption; color: $color-text-2; }
.goods-card__total-qty {
  font-family: $font-num; font-weight: $fw-bold; color: $color-text; margin-left: 4rpx;
}
.goods-card__total-right { display: flex; align-items: baseline; gap: 10rpx; }
.goods-card__total-text { font-size: $fs-caption; color: $color-text-2; }
.goods-card__total-amount {
  font-family: $font-num; font-size: 40rpx; font-weight: $fw-heavy;
  color: $color-danger; font-variant-numeric: tabular-nums;
}

/* 备注 */
.memo { margin-top: $space-gap; }
.memo__title { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; margin-bottom: 14rpx; }
.memo__text { display: block; font-size: $fs-caption; color: $color-text-2; line-height: 1.7; }

/* 单据信息 */
.meta-card { margin-top: $space-gap; }
.meta-card__title { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; margin-bottom: 8rpx; }
.meta-card__row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18rpx 0; border-bottom: 1rpx solid $color-divider;
}
.meta-card__row:last-child { border-bottom: 0; padding-bottom: 0; }
.meta-card__label { font-size: $fs-caption; color: $color-text-3; }
.meta-card__value {
  font-family: $font-num; font-size: $fs-caption; color: $color-text-2;
  font-variant-numeric: tabular-nums;
}
.meta-card__value--warn { color: $color-warning; font-family: inherit; }

.action-bar__btn { flex: 1; }
.bottom-gap { height: 40rpx; }
</style>
