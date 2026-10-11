<template>
  <view class="page detail has-action-bar">
    <LoadState :loading="loading" :error="error" skeleton skeleton-variant="detail" skeleton-pad="page" @retry="load">
      <!-- 不可修改提示 -->
      <view v-if="bill && !bill.editable" class="readonly-bar">
        <view class="readonly-bar__icon"><Icon name="alert-circle" :size="16" color="danger" /></view>
        <text class="readonly-bar__text">{{ reasonText }}</text>
      </view>

      <template v-if="bill">
        <!-- 单头 -->
        <view class="card head">
          <view class="head__top">
            <view class="head__top-left">
              <StatusTag :status="bill.status" :pulse="pulseN" />
              <!-- ★ 作废按钮（需求：放在单据状态旁；★ 只有未审核单才能作废，已审核要先反审） -->
              <text v-if="bill.status === 'unapproved'" class="void-btn" :class="{ 'is-busy': busy }" @click="onVoid">作废</text>
            </view>
            <text class="head__no">{{ bill.billNo }}</text>
          </view>
          <view class="head__divider" />
          <text class="head__label">客户名称</text>
          <view class="head__name-line">
            <text class="head__name">{{ bill.customerName || '未命名客户' }}</text>
            <!-- 这张单的客户现在停着 ⇒ 开单页面上就该看见，别等下一次要开才发现 -->
            <StopTag kind="customer" :code="bill.customerCode || bill.customerId" />
          </view>
          <view class="head__meta">
            <view class="head__meta-item">
              <text class="head__meta-label">开单日期</text>
              <text class="head__meta-value">{{ bill.billDate }}</text>
            </view>
            <view v-if="bill.createdBy" class="head__meta-item">
              <text class="head__meta-label">制单人</text>
              <text class="head__meta-value">{{ bill.createdBy }}</text>
            </view>
            <view v-if="bill.warehouse || bill.warehouseName" class="head__meta-item">
              <text class="head__meta-label">发货仓库</text>
              <text class="head__meta-value">{{ warehouseText }}</text>
            </view>
          </view>
        </view>

        <!-- 商品明细 -->
        <view class="card goods-card">
          <view class="goods-card__head">
            <text class="goods-card__title">商品明细</text>
            <text class="goods-card__count">（{{ (bill.items || []).length }} 项）</text>
          </view>
          <view v-for="(it, i) in (bill.items || [])" :key="it.idenGuid || i" class="good">
            <view class="good__main">
              <view class="good__name-line">
                <text class="good__name ellipsis">{{ it.name }}</text>
                <StopTag kind="product" :code="it.productId || it.hpbh" />
              </view>
              <!-- 赠品行：单价与数量照原样显示，下面那一格金额是 0（折后金额），
                   不打个标会让人以为这张单录错了。 -->
              <text v-if="it.gift" class="gift-tag">赠品 · 不计入合计</text>
              <text class="good__meta">{{ it.spec }} · {{ it.unit }}</text>
              <!-- ★ 明细行备注（XSMX.BZ_XSMX）—— 与单头「备注」是两回事 -->
              <text v-if="it.remark" class="good__remark">备注：{{ it.remark }}</text>
            </view>
            <view class="good__right">
              <text class="good__price">¥{{ fmtMoney(it.price) }} × {{ it.qty }}</text>
              <text class="good__amount">¥{{ fmtMoneyGroup(it.amount) }}</text>
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

        <view class="bottom-gap" />
      </template>

      <EmptyState v-else-if="!loading" text="请选择销售单" sub="从销售单列表进入详情" />
    </LoadState>

    <!-- 底部操作 -->
    <view v-if="bill" class="action-bar">
      <!-- 复制：任意状态可用（★ 作废单也只能复制，见需求） -->
      <button class="btn-ghost action-bar__btn" @click="goCopy">
        <text>复制</text>
      </button>
      <button class="btn-ghost action-bar__btn" @click="goPrint">
        <Icon name="printer" :size="18" color="text-2" />
        <text>打印</text>
      </button>
      <!-- 修改：仅未审核显示（已审核/作废不显示） -->
      <button v-if="bill.status === 'unapproved'" class="btn-ghost action-bar__btn"
              :disabled="!bill.editable" @click="goEdit">
        <text>{{ bill.editable ? '修改' : '不可修改' }}</text>
      </button>
      <!-- 审核（未审核）/ 反审（已审核）；作废单两者都不显示 -->
      <button v-if="bill.status === 'unapproved'" class="btn-primary action-bar__btn" :class="{ 'is-busy': busy }" @click="onAudit">
        <text>{{ busy ? '处理中…' : '审核' }}</text>
      </button>
      <button v-else-if="bill.status === 'approved'" class="btn-primary action-bar__btn" :class="{ 'is-busy': busy }" @click="onUnaudit">
        <text>{{ busy ? '处理中…' : '反审' }}</text>
      </button>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { salesApi } from '../../api/salesBill'
import { fmtMoney, fmtMoneyGroup } from '../../utils/format'
import { checkEditable, editableReasonText } from '../../utils/billState'
import { markBillWritten } from '../../utils/billWrites'
import StatusTag from '../../components/StatusTag.vue'
import StopTag from '../../components/StopTag.vue'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import Icon from '../../components/Icon.vue'

const id = ref('')
const bill = ref(null)
const loading = ref(true)
const error = ref('')
/** 状态变更脉冲：load 拿到的新状态与上一次不同才递增一次（见 StatusTag.vue 的 pulse） */
const pulseN = ref(0)
let lastStatus = ''

/**
 * 发货仓库显示：Agent 返回 warehouse(编码 `101-`) + warehouse_name(中文名 `主仓库`)。
 * ★ 原来只显示编码 —— 用户看到「101-」不知道是哪个仓。
 *   有名字时显示「主仓库（101-）」，与采购详情页 warehouseText 口径一致。
 */
const warehouseText = computed(() => {
  const b = bill.value
  if (!b) return '—'
  if (b.warehouseName && b.warehouse) return `${b.warehouseName}（${b.warehouse}）`
  return b.warehouseName || b.warehouse || '—'
})

const reasonText = computed(() => {
  if (!bill.value) return ''
  // 优先用后端返回的不可改原因（最权威）
  if (Array.isArray(bill.value.editableReasons) && bill.value.editableReasons.length) {
    return editableReasonText(bill.value.editableReasons)
  }
  const { reasons } = checkEditable(bill.value)
  return editableReasonText(reasons) || '该单据不可修改'
})

async function load() {
  if (!id.value) { loading.value = false; return }
  loading.value = true; error.value = ''
  const res = await salesApi.detail(id.value)
  loading.value = false
  if (res.ok) {
    /* ★ 状态**确实变了**才脉冲：首次进页面 lastStatus 为空 ⇒ 不播（刚打开的标签不该自己抖），
       之后审核/反审/作废、以及从改单页返回后状态变化，各播一次。
       ★ 必须在 bill.value 赋值**之前**递增 —— 赋值之后标签已经换成新字，
         脉冲就跟"新状态"没关系了，看着像标签自己在动。 */
    if (lastStatus && lastStatus !== res.data.status) pulseN.value++
    lastStatus = res.data.status
    bill.value = res.data
  }
  else error.value = res.message
}

function goEdit() {
  if (!bill.value?.editable) return
  uni.navigateTo({ url: '/pages/sales/edit?mode=edit&id=' + id.value })
}
function goPrint() { uni.navigateTo({ url: '/pages/print/index?billId=' + id.value }) }

/* ★ 审核/反审/作废共用一把在飞锁：这类写请求是 云端→Agent 的慢 RPC，期间单据状态
   还没变、按钮仍可点 —— 双发会让第二个请求失败并弹原始报错（"刚成功却报失败"）。 */
const busy = ref(false)

/* 审核（未审核 → 已审核）：只改 IsAuditing/AuditingTime，不动金额库存明细 */
function onAudit() {
  if (busy.value) return
  uni.showModal({
    title: '审核',
    content: '审核后该单据将不可修改，确认审核？',
    confirmText: '审核',
    success: async (r) => {
      if (!r.confirm || busy.value) return
      busy.value = true
      const res = await salesApi.audit(id.value)
      busy.value = false
      if (res.ok) { markBillWritten('sales'); uni.showToast({ title: '已审核', icon: 'success' }); load() }
      else uni.showToast({ title: res.message || '审核失败', icon: 'none' })
    },
  })
}

/* 反审（已审核 → 未审核）；★ 作废单后端会拒绝（只能复制） */
function onUnaudit() {
  if (busy.value) return
  uni.showModal({
    title: '反审',
    content: '反审后该单据将恢复为未审核，确认反审？',
    confirmText: '反审',
    success: async (r) => {
      if (!r.confirm || busy.value) return
      busy.value = true
      const res = await salesApi.unaudit(id.value)
      busy.value = false
      if (res.ok) { markBillWritten('sales'); uni.showToast({ title: '已反审', icon: 'success' }); load() }
      else uni.showToast({ title: res.message || '反审失败', icon: 'none' })
    },
  })
}

/* 作废（未作废 → 已作废）；★ 作废是终态，弹窗明确告知「无法反审恢复」 */
function onVoid() {
  if (busy.value) return
  uni.showModal({
    title: '作废单据',
    content: '作废后该单据不可恢复（仅可复制新建），确定要作废吗？',
    confirmText: '作废',
    confirmColor: '#e64340',
    success: async (r) => {
      if (!r.confirm || busy.value) return
      busy.value = true
      const res = await salesApi.void(id.value)
      busy.value = false
      if (res.ok) { markBillWritten('sales'); uni.showToast({ title: '已作废', icon: 'success' }); load() }
      else uni.showToast({ title: res.message || '作废失败', icon: 'none' })
    },
  })
}

/* 复制：跳转到「新增」页并预填原单数据，由用户决定是否修改/保存（不直接建单） */
function goCopy() {
  uni.navigateTo({ url: '/pages/sales/edit?mode=copy&from=' + encodeURIComponent(id.value) })
}

onLoad((q) => { id.value = q.id || ''; load() })
// ★★ 「修改销售单」保存后返回本页，必须重新拉取 —— 否则页面还挂着改之前的单头
//   与明细（用户反馈的原话：「保存修改返回销售单详情时应自动刷新，否则还是会
//   显示原数据」）。首次进入由 onLoad 负责，这里跳过，避免重复请求。
let entered = false
onShow(() => {
  if (!entered) { entered = true; return }
  if (id.value) load()
})
</script>

<style lang="scss" scoped>
/* 底栏让位预留统一由全局 .has-action-bar 提供（值来自 uni.scss 的底栏令牌）。
 * ★ 不要再在这里写 padding-bottom：页面 scoped 规则优先级更高，
 *   会静默压掉全局预留，导致内容被底部按钮盖住。 */

/* 只读提示 */
.readonly-bar {
  display: flex; align-items: center; gap: 12rpx;
  background: $color-danger-bg; border-radius: $radius-card;
  padding: 22rpx 28rpx; margin-bottom: $space-gap;
}
.readonly-bar__icon { color: $color-danger; display: flex; align-items: center; flex: 0 0 auto; }
.readonly-bar__text { flex: 1; font-size: $fs-caption; color: $color-danger; line-height: 1.5; }

/* 单头 */
.head { padding: 0; overflow: hidden; }
.head__top { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 28rpx 0; }
.head__top-left { display: flex; align-items: center; gap: 14rpx; }
/* 作废按钮：状态标签旁的小字操作，弱层级但可点 */
.void-btn {
  font-size: $fs-mini; color: $color-danger;
  padding: 4rpx 16rpx; border: 1rpx solid $color-danger; border-radius: $radius-btn;
  line-height: 1.4;
}
/* 写操作在飞：按钮压暗示意"正在处理"，真正的重入由 busy 守卫挡住 */
.is-busy { opacity: 0.6; }
.head__no {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold;
  color: $color-text-2; font-variant-numeric: tabular-nums;
}
.head__divider { height: 1rpx; background: $color-divider; margin: 22rpx 0 20rpx; }
.head__label { display: block; font-size: $fs-mini; color: $color-text-3; padding: 0 28rpx; }
.head__name { display: block; font-size: 36rpx; font-weight: $fw-heavy; padding: 8rpx 28rpx 0; }
.head__name-line { display: flex; align-items: center; gap: 12rpx; }
.good__name-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.head__meta { display: flex; gap: 40rpx; padding: 24rpx 28rpx 28rpx; }
.head__meta-item { display: flex; flex-direction: column; }
.head__meta-label { font-size: $fs-micro; color: $color-text-3; }
.head__meta-value {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold;
  color: $color-text-2; margin-top: 6rpx; font-variant-numeric: tabular-nums;
}

/* 明细 */
.goods-card { margin-top: $space-gap; }
.goods-card__head { display: flex; align-items: baseline; margin-bottom: 8rpx; }
.goods-card__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.goods-card__count { font-size: $fs-mini; color: $color-text-3; margin-left: 6rpx; }

.good {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 20rpx; padding: 22rpx 0; border-bottom: 1rpx solid $color-divider;
}
.good:last-of-type { border-bottom: 0; }
.good__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.good__name { font-size: $fs-body; font-weight: $fw-bold; color: $color-text; }
/* 赠品行标记：警示色而不是主色 —— 它解释的是"这行有钱但没进合计"，不是状态 */
.gift-tag {
  display: inline-block; width: fit-content; margin-top: 6rpx;
  padding: 3rpx 12rpx; border-radius: $radius-tag;
  background: $color-warning-bg; color: $color-warning;
  font-size: $fs-micro; font-weight: $fw-bold;
}
.good__meta { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
/* ★ 明细行备注：与单头「备注」区分开，用更弱的层级 + 可换行 */
.good__remark {
  font-size: $fs-mini; color: $color-text-4; margin-top: 6rpx;
  word-break: break-all;
}
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

.action-bar__btn { flex: 1; }
.bottom-gap { height: 40rpx; }
</style>
