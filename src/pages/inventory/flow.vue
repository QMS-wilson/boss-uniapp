<template>
  <view class="page flow-page">
    <!-- 货品头 -->
    <view class="card">
      <view class="p-name-line">
        <text class="p-name ellipsis">{{ pName || pId }}</text>
        <StopTag kind="product" :code="pId" />
      </view>
      <text class="p-meta">{{ [pId, pSpec, pUnit].filter(Boolean).join(' · ') }}</text>
      <view class="p-fig">
        <view class="p-fig__cell">
          <text class="metric-label">现存量</text>
          <text class="p-fig__v" :class="{ 'is-neg': stock < 0 }">{{ fmtQty(stock) }}<text class="p-fig__u">{{ pUnit }}</text></text>
        </view>
        <view class="p-fig__cell">
          <text class="metric-label">本期入库</text>
          <text class="p-fig__v" :class="{ 'is-in': sum.inQty > 0 }">{{ sum.inQty > 0 ? '+' + fmtQty(sum.inQty) : fmtQty(sum.inQty) }}</text>
        </view>
        <view class="p-fig__cell">
          <text class="metric-label">本期出库</text>
          <text class="p-fig__v" :class="{ 'is-out': sum.outQty > 0 }">{{ sum.outQty > 0 ? '-' + fmtQty(sum.outQty) : fmtQty(sum.outQty) }}</text>
        </view>
      </view>
    </view>

    <!-- 期间 -->
    <view class="card range">
      <view class="range__row">
        <text class="range__label">期间</text>
        <view class="range__picks">
          <picker mode="date" :value="from" @change="onFrom">
            <view class="date-box"><text>{{ from || '不限' }}</text></view>
          </picker>
          <text class="date-sep">至</text>
          <picker mode="date" :value="to" @change="onTo">
            <view class="date-box"><text>{{ to || '不限' }}</text></view>
          </picker>
        </view>
      </view>
      <view class="range__row range__row--quick">
        <text class="range__label">快捷</text>
        <view class="range__quick">
          <view
            v-for="q in QUICKS" :key="q.key"
            class="qchip" :class="{ 'qchip--on': quick === q.key }"
            @click="setQuick(q.key)" hover-class="hv-on" :hover-stay-time="80">{{ q.label }}</view>
        </view>
      </view>
    </view>

    <LoadState :loading="loading" :error="error" @retry="load">
      <template v-if="rows.length">
        <!-- 期初 → 期末：结存是自己递推的，不是 V3 流水表那一列 -->
        <view class="bridge">
          <view class="bridge__end">
            <text class="metric-label">期初结存</text>
            <text class="bridge__v tnum">{{ fmtQty(sum.opening) }}</text>
          </view>
          <view class="bridge__mid"><Icon name="arrow-right" :size="18" color="text-3" /></view>
          <view class="bridge__end bridge__end--hl">
            <text class="metric-label">期末结存</text>
            <text class="bridge__v tnum">{{ fmtQty(sum.closing) }}</text>
          </view>
        </view>
        <text class="bridge__note">
          共 {{ sum.rows }} 笔。期末 {{ fmtQty(sum.closing) }} = 期初 {{ fmtQty(sum.opening) }}
          + 入 {{ fmtQty(sum.inQty) }} - 出 {{ fmtQty(sum.outQty) }}，逐笔累计得出。
        </text>
        <text v-if="balNote" class="bridge__note bridge__note--warn">{{ balNote }}</text>

        <view class="section-head">
          <text class="section-head__title">收发存流水</text>
          <text class="section-head__action">按日期升序</text>
        </view>
        <view class="list">
          <view v-for="(r, idx) in rows" :key="idx" class="fl">
            <view class="fl__date">
              <text class="fl__d">{{ r.date }}</text>
              <text class="fl__type">{{ r.typeName }}</text>
            </view>
            <view class="fl__mid">
              <text class="fl__qty" :class="r.outQty > 0 ? 'is-out' : 'is-in'">
                {{ r.outQty > 0 ? '-' + fmtQty(r.outQty) : '+' + fmtQty(r.inQty) }}
              </text>
              <text class="fl__bill ellipsis">{{ r.billNo || '—' }}</text>
            </view>
            <view class="fl__bal">
              <text class="fl__bal-label">结存</text>
              <text class="fl__bal-v tnum" :class="{ 'is-neg': r.balance < 0 }">{{ fmtQty(r.balance) }}</text>
            </view>
          </view>
        </view>

        <view v-if="truncated" class="trunc">
          <text>该货品在此期间共超过 {{ rowLimit }} 笔，上面是最早的 {{ rowLimit }} 笔，
            所以「期末结存」不等于最后一行的结存。把期间缩短（如切成「本月」）再看；
            「导出 CSV」导的是本页这些行，不是全部流水。</text>
        </view>
        <view class="btns">
          <view class="btn-ghost btns__b" @click="doExport" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="file-text" :size="16" color="text-2" /><text>导出 CSV</text>
          </view>
          <view class="btn-primary btns__b" @click="goProduct" hover-class="hv-on" :hover-stay-time="80"><text>看商品资料</text></view>
        </view>
      </template>

      <EmptyState
        v-else-if="!loading && !error"
        icon="list"
        text="该期间没有出入库流水"
        sub="出入库要单据记账后才会产生流水；把期间切成「全部」试试"
      />
      <view class="bottom-gap" />
    </LoadState>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { inventoryApi } from '../../api/index'
import { fmtDate, fmtQty, quickRange } from '../../utils/format'
import { exportCsv } from '../../utils/export'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'

const QUICKS = [
  { key: 'all', label: '全部' },
  { key: 'thisMonth', label: '本月' },
  { key: '90d', label: '近90天' },
  { key: 'year', label: '本年' },
]

const pId = ref('')
const pName = ref('')
const pSpec = ref('')
const pUnit = ref('')
// ★ 现存量只认「库存」页传进来的数（Inventory 口径）。
//   流水窗口选在过去时，期末结存 ≠ 现存量，用流水回填会把两个概念搅在一起。
const stock = ref(0)
const from = ref('')
const to = ref('')
const quick = ref('all')
const rows = ref([])
const sum = ref({ rows: 0, opening: 0, inQty: 0, outQty: 0, netQty: 0, closing: 0 })
const truncated = ref(false)
const rowLimit = ref(500)
const loading = ref(false)
const error = ref('')
// ★ 请求代际：快捷期间/日期控件在 loading 里照样能点，快速连点「本月」→「近90天」时，
//   慢的旧响应后到会把结存数字配到错误的期间高亮上 —— 谁最新谁说了算。
let loadSeq = 0

/** 期末与现存量不等时把原因说清楚（选了过去期间 / 有没写进流水的记账） */
const balNote = computed(() => {
  if (!rows.value.length) return ''
  const close = sum.value.closing
  if (Math.abs(close - stock.value) < 0.005) return ''
  const head = `期末 ${fmtQty(close)} ≠ 现存量 ${fmtQty(stock.value)}：`
  return to.value
    ? head + `本窗口结束于 ${to.value}，之后还有出入库，两个数不等是对的。要看当前数请切「全部」。`
    : head + `差额 ${fmtQty(stock.value - close)} 没写在流水里（期初直录或手工调整）。`
})

function setQuick(k) {
  // ★ 区间只从 utils/format.js 的 quickRange 出（与报表/对账页同一份算法）
  const r = quickRange(k)
  from.value = r.from
  to.value = r.to
  quick.value = k
  load()
}
function onFrom(e) { from.value = e.detail.value; quick.value = ''; load() }
function onTo(e) { to.value = e.detail.value; quick.value = ''; load() }

async function load() {
  // ★ 日期填反了先说清楚，别让 Agent 回一个空集被显示成"这段时间没有出入库"
  if (from.value && to.value && from.value > to.value) {
    uni.showToast({ title: '开始日期晚于结束日期，先改一下期间', icon: 'none' })
    return
  }
  const my = ++loadSeq
  loading.value = true; error.value = ''
  const res = await inventoryApi.flow({ productId: pId.value, from: from.value, to: to.value })
  if (my !== loadSeq) return    // 已有更新的查询发出，这次响应作废
  loading.value = false
  if (res.ok) {
    rows.value = res.data.items
    sum.value = res.data.summary
    truncated.value = res.data.truncated
    rowLimit.value = res.data.rowLimit
    if (!pName.value) pName.value = res.data.product.name
    if (!pSpec.value) pSpec.value = res.data.product.spec
    if (!pUnit.value) pUnit.value = res.data.product.unit
  } else error.value = res.message
}

function doExport() {
  exportCsv(
    `收发存_${pId.value}_${from.value || '全部'}_${to.value || '至今'}`,
    ['日期', '单据类型', '单号', '入库数', '出库数', '结存', '成本价', '入库金额', '出库金额'],
    rows.value.map((r) => [r.date, r.typeName, r.billNo, r.inQty, r.outQty, r.balance, r.costPrice, r.inAmount, r.outAmount]),
  )
}
function goProduct() {
  uni.navigateTo({ url: '/pages/product/detail?id=' + encodeURIComponent(pId.value) })
}

onLoad((q) => {
  pId.value = q.id ? decodeURIComponent(q.id) : ''
  pName.value = q.name ? decodeURIComponent(q.name) : ''
  stock.value = Number(q.qty) || 0
  pSpec.value = q.spec ? decodeURIComponent(q.spec) : ''
  pUnit.value = q.unit ? decodeURIComponent(q.unit) : ''
})
onMounted(load)
</script>

<style lang="scss" scoped>
.flow-page { padding-top: 24rpx; }

/* 货品头 */
.p-name { display: block; font-size: $fs-title; font-weight: $fw-heavy; }
.p-name-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.p-meta { display: block; margin-top: 10rpx; font-size: $fs-mini; color: $color-text-3; }
.p-fig { display: flex; gap: $space-inner; margin-top: 24rpx; }
.p-fig__cell {
  flex: 1; min-width: 0; background: $color-bg-sunken;
  border-radius: $radius-card-sm; padding: 18rpx 20rpx;
}
.p-fig__v {
  display: block; font-family: $font-num; font-size: 32rpx; font-weight: $fw-heavy;
  color: $color-text; margin-top: 6rpx; font-variant-numeric: tabular-nums;
}
.p-fig__u { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-3; margin-left: 4rpx; }
.is-neg { color: $color-danger; }
.is-in { color: $color-success; }
.is-out { color: $color-danger; }

/* 期间 */
.range { padding: 0 $space-card; }
.range__row {
  display: flex; align-items: center; min-height: 96rpx;
  border-bottom: 1rpx solid $color-divider;
}
.range__row--quick { min-height: 88rpx; border-bottom: 0; }
.range__label { flex: 0 0 auto; width: 90rpx; font-size: $fs-body; color: $color-text-2; }
.range__picks { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 12rpx; }
.date-box {
  padding: 12rpx 20rpx; border-radius: $radius-input;
  background: $color-bg; font-size: $fs-caption; color: $color-text-2;
}
.date-sep { font-size: $fs-mini; color: $color-text-4; }
.range__quick { flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 12rpx; flex-wrap: wrap; }
.qchip {
  font-size: $fs-mini; color: $color-text-2; background: $color-bg;
  border-radius: $radius-pill; padding: 8rpx 22rpx;
}
.qchip--on { background: $color-primary; color: #fff; font-weight: $fw-bold; }

/* 期初 → 期末 */
.bridge {
  display: flex; align-items: center; gap: $space-inner;
  margin-top: $space-gap; padding: 26rpx $space-card;
  background: $color-card; border-radius: $radius-card; box-shadow: $shadow-card;
}
.bridge__end { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.bridge__end--hl { align-items: flex-end; text-align: right; }
.bridge__mid { flex: 0 0 auto; display: flex; align-items: center; }
.bridge__v {
  font-family: $font-num; font-size: 38rpx; font-weight: $fw-heavy; color: $color-text;
  margin-top: 8rpx; font-variant-numeric: tabular-nums;
}
.bridge__note {
  display: block; margin: 14rpx $space-page 0;
  font-size: $fs-mini; color: $color-text-3; line-height: 1.7;
}

/* 流水行 */
.fl {
  display: flex; align-items: center; gap: $space-inner;
  background: $color-card; border-radius: $radius-card;
  padding: 24rpx 26rpx; box-shadow: $shadow-card;
}
.fl__date { flex: 0 0 190rpx; display: flex; flex-direction: column; }
.fl__d { font-family: $font-num; font-size: $fs-caption; color: $color-text; font-variant-numeric: tabular-nums; }
.fl__type { font-size: $fs-micro; color: $color-text-3; margin-top: 6rpx; }
.fl__mid { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.fl__qty { font-family: $font-num; font-size: $fs-subtitle; font-weight: $fw-heavy; font-variant-numeric: tabular-nums; }
.fl__bill { font-size: $fs-micro; color: $color-text-4; margin-top: 6rpx; }
.fl__bal { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; }
.fl__bal-label { font-size: $fs-micro; color: $color-text-4; }
.fl__bal-v {
  font-family: $font-num; font-size: $fs-body; font-weight: $fw-bold; color: $color-text;
  margin-top: 6rpx; font-variant-numeric: tabular-nums;
}

.trunc {
  margin: $space-inner $space-page 0; padding: 20rpx 24rpx;
  background: $color-warning-bg; border-radius: $radius-card-sm;
  font-size: $fs-mini; color: $color-warning-text; line-height: 1.7;
}
.btns { display: flex; gap: 16rpx; padding: $space-gap $space-page 0; }
.btns__b { flex: 1; height: 88rpx; }
</style>
