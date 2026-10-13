<template>
  <view class="page detail">
    <!-- 查询条件 -->
    <view class="card query">
      <view class="query__row" @click="showPicker = true" hover-class="hv-on" :hover-stay-time="80">
        <text class="query__label">客户</text>
        <view class="query__value">
          <text class="ellipsis" :class="customerId ? 'query__text' : 'query__placeholder'">
            {{ customerName || '请选择客户' }}
          </text>
          <StopTag kind="customer" :code="customerId" />
          <Icon name="chevron-down" :size="16" />
        </view>
      </view>
      <view class="query__row query__row--dates">
        <text class="query__label">期间</text>
        <view class="query__value query__value--dates">
          <picker mode="date" :value="startDate" @change="onStart">
            <view class="date-box"><text>{{ startDate || '开始日期' }}</text></view>
          </picker>
          <text class="date-sep">至</text>
          <picker mode="date" :value="endDate" @change="onEnd">
            <view class="date-box"><text>{{ endDate || '结束日期' }}</text></view>
          </picker>
        </view>
      </view>
      <button class="btn-primary query__submit" :disabled="!canQuery || loading" @click="load">
        {{ loading ? '查询中...' : '查询对账单' }}
      </button>
    </view>

    <template v-if="statement">
      <!-- 四个数：全部是「我方应收」口径，正数=客户欠我们，负数=客户预收（我们欠货） -->
      <view class="balance">
        <view class="balance__cell">
          <text class="metric-label">期初应收</text>
          <text class="balance__value">{{ dueText(summary.openingBalance) }}</text>
        </view>
        <view class="balance__cell">
          <text class="metric-label">本期出货</text>
          <text class="balance__value balance__value--up">{{ moneyText(summary.salesAmount) }}</text>
        </view>
        <view class="balance__cell">
          <text class="metric-label">本期收款</text>
          <text class="balance__value balance__value--down">{{ moneyText(summary.paymentAmount) }}</text>
        </view>
        <view class="balance__cell balance__cell--hl">
          <text class="metric-label">期末应收</text>
          <text class="balance__value">{{ dueText(summary.closingBalance) }}</text>
        </view>
      </view>
      <text class="balance__note">{{ dueWord(summary.closingBalance) }}：{{ dueExplain(summary.closingBalance) }}</text>

      <!-- 流水 -->
      <view class="section-head">
        <text class="section-head__title">往来流水</text>
        <text class="section-head__action">期末{{ dueWord(summary.closingBalance) }} {{ moneyText(summary.closingBalance) }}</text>
      </view>
      <view v-if="statement.items && statement.items.length" class="ledger">
        <view v-for="(it, i) in statement.items" :key="it.billNo + i" class="ledger__row" @click="goBill(it.billNo)" hover-class="hv-on" :hover-stay-time="80">
          <view class="ledger__left">
            <text class="ledger__date">{{ shortDate(it.date) }}</text>
            <view class="ledger__info">
              <view class="ledger__title">
                <text class="ledger__type">{{ it.typeName }}</text>
                <text class="ledger__no">{{ it.billNo }}</text>
              </view>
              <text class="ledger__desc">{{ it.description }}</text>
            </view>
          </view>
          <view class="ledger__right">
            <!-- ★ 借（出货）应收增加 → +红；贷（收款）应收减少 → -绿。
                 旧写法恒渲染 +¥debit，收款行会显示 +¥0.00。 -->
            <text class="ledger__amount" :class="{ 'ledger__amount--in': it.credit > 0 }">
              {{ it.credit > 0 ? '-¥' + fmtMoneyGroup(it.credit) : '+¥' + fmtMoneyGroup(it.debit) }}
            </text>
            <text class="ledger__balance">{{ dueWord(it.balance) }} {{ moneyText(it.balance) }}</text>
          </view>
        </view>
        <!-- 后端口径说明（当前账套无收款流水，期初按期末倒推） -->
        <view v-if="statement.note" class="ledger-note">
          <text>{{ statement.note }}</text>
        </view>
        <view v-if="statement.truncated" class="ledger-note ledger-note--warn">
          <text>流水超过 {{ statement.rowLimit }} 行，下面只列了前 {{ statement.rowLimit }} 行，
            「导出」同样只有本页这些行。出货合计与期初是按整个期间算的，不受这个截断影响 ——
            要逐行核对请把期间缩短到没被截断为止。</text>
        </view>
      </view>
      <EmptyState v-else text="暂无可显示的往来流水" sub="该客户在此期间没有发生业务" />

      <view v-if="statement && statement.items && statement.items.length" class="btns">
        <view class="btn-ghost btns__b" @click="doExport" hover-class="hv-on" :hover-stay-time="80">
          <Icon name="file-text" :size="16" color="text-2" /><text>导出对账明细 CSV</text>
        </view>
      </view>
    </template>

    <!-- ★ 查询失败 ⇒ 错误块（原因 + 点击重试），必须排在「请选择客户与日期」之前：
         以前失败只剩一支 toast，页面落回空态，看着像"这人没业务"（2026-10-12）。 -->
    <LoadState v-else-if="queryError" :error="queryError" @retry="load" />

    <EmptyState
      v-else-if="!loading"
      icon="file-text"
      text="请选择客户与日期"
      sub="选择后将生成对账单"
    />

    <!-- 客户选择弹窗（全量 + 搜索；ActionSheet 最多显示几条且选不到 8 名以外的客户） -->
    <view v-if="showPicker" class="mask" @click="showPicker = false">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">选择客户</text>
          <view class="picker-close" @click="showPicker = false" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="20" color="text-3" /></view>
        </view>
        <view class="picker-search">
          <view class="search-box">
            <Icon name="search" :size="20" color="text-3" />
            <input v-model="custKeyword" placeholder="搜名称/编码" />
          </view>
        </view>
        <view class="picker-list">
          <view v-for="c in custOptions" :key="c.id" class="picker-item" @click="pickCustomer(c)" hover-class="hv-on" :hover-stay-time="80">
            <text class="pi-name">{{ c.name }}</text>
            <text class="pi-meta">{{ c.id }} · {{ c.mobile || '' }}</text>
          </view>
          <view v-if="custTruncated" class="picker-trunc">
            <text>客户共 {{ custTotal }} 家，只载入了前 {{ customers.length }} 家，关键字也只在这部分里找；搜不到请去「客户」页查编号</text>
          </view>
          <EmptyState v-if="!custOptions.length" text="没有匹配的客户" />
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { reportApi } from '../../api/index'
import { customerApi } from '../../api/customer'
import { cancelByScope } from '../../utils/request'
import { fmtMoneyGroup, fmtDate } from '../../utils/format'
import { exportCsv } from '../../utils/export'
import Icon from '../../components/Icon.vue'
import EmptyState from '../../components/EmptyState.vue'
import LoadState from '../../components/LoadState.vue'
import StopTag from '../../components/StopTag.vue'

const customerId = ref('')
const customerName = ref('')
/** ★ 查询失败的原因（空串=没失败）：要落在界面上，不能只飘一支 toast 就把页面交回空态 */
const queryError = ref('')
const customers = ref([])
const startDate = ref('')
const endDate = ref('')
/** 从报表首页带进来的区间（两个都是 `YYYY-MM-DD` 才算，缺一个就按本月） */
const presetRange = ref(null)
const statement = ref(null)
const loading = ref(false)
// ★ 请求代际：选客户/改期间在 loading 里照样能点，旧慢响应后到会把 A 客户的金额
//   写进 B 客户的抬头里。与 goods.vue / inventory/index.vue 同款守卫。
let loadSeq = 0

// ★ 客户选择弹窗（全量列表 + 本地搜索）。
//   旧 ActionSheet 只展示前 8 个客户且列表只拉 100 条 —— 客户一多就选不到目标客户。
const showPicker = ref(false)
const custKeyword = ref('')
// 单次只拉 1000 家：超出的客户搜不到也选不到，必须把这件事说明白（与 receivable 的截断口径一致）
const custTotal = ref(0)
const custTruncated = computed(() => custTotal.value > customers.value.length)
const custOptions = computed(() => {
  const kw = custKeyword.value.trim().toLowerCase()
  if (!kw) return customers.value
  return customers.value.filter((c) =>
    (c.name || '').toLowerCase().includes(kw) ||
    (c.id || '').toLowerCase().includes(kw) ||
    (c.py || '').toLowerCase().includes(kw) ||
    String(c.mobile || '').includes(kw))
})

const summary = computed(() => statement.value?.summary || {
  openingBalance: 0, salesAmount: 0, paymentAmount: 0, closingBalance: 0,
})
const canQuery = computed(() => !!customerId.value && !!startDate.value && !!endDate.value)

/**
 * ★ 「余额」这个词已从界面上去掉：它分不清是**客户欠我们的应收**还是
 *   **客户多付/未提货的预收**（V3 自己的报表也叫「应收款/期初应收/欠款」，不叫余额）。
 *   本页面所有数字统一是「我方应收」口径：正数=应收（客户欠货款的钱），
 *   负数=预收（我们欠客户货），零=已结清。
 */
function dueWord(v) {
  const n = Number(v) || 0
  if (n > 0.004) return '应收'
  if (n < -0.004) return '预收'
  return '已结清'
}
function dueExplain(v) {
  const n = Number(v) || 0
  if (n > 0.004) return '客户尚欠我方货款'
  if (n < -0.004) return '我方欠客户货（客户多付或尚未提货）'
  return '双方已结清，不欠不预'
}
/** 带方向的金额文本：预收不显示成负数，而是「预收 ¥123」 */
function moneyText(v) {
  const n = Number(v) || 0
  return '¥' + fmtMoneyGroup(Math.abs(n) < 0.005 ? 0 : n)
}
function dueText(v) {
  const n = Number(v) || 0
  if (n < -0.004) return '预收 ¥' + fmtMoneyGroup(-n)
  if (n > 0.004) return '¥' + fmtMoneyGroup(n)
  return '已结清'
}

/**
 * 日期列只显示「月-日」（MM-DD）：年份由上方期间范围给了，省下 ~12px 宽后
 * 不再折行（原来 10 字符 ≈66px 塞不进 54px 的列，必然断行）。
 * 后端 date 是 `YYYY-MM-DD`（可能带时分秒），取第 6~10 位即 `MM-DD`；导出仍用完整日期。 */
function shortDate(d) {
  const s = String(d || '')
  return s.length >= 10 ? s.slice(5, 10) : s
}

/**
 * 默认取当月 1 日 ~ 今天。
 * ★ 以前到"本月末"（含未来日期）：报表页/货品页的「本月」都是到今天的，
 *   从它们跳到对账页，同一句"本月"圈的单不一样，两个页面对不出数。
 */
function defaultRange() {
  // ★ 报表首页带过来的期间优先（?from=&to=，见 report/index.vue 的 go()）：
  //   早先这一页恒按"本月"，从报表页选了上季度点进来却回到本月，期间像是没带过去。
  if (presetRange.value) {
    startDate.value = presetRange.value.from
    endDate.value = presetRange.value.to
    return
  }
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  startDate.value = fmtDate(new Date(y, m, 1))
  endDate.value = fmtDate(now)
}

function pickCustomer(c) {
  customerId.value = c.id; customerName.value = c.name
  showPicker.value = false
  load()
}
function onStart(e) { startDate.value = e.detail.value }
function onEnd(e) { endDate.value = e.detail.value }

async function load() {
  if (!canQuery.value) return
  // ★ 日期填反了要明说：Agent 那边只会回空集，界面就写成"该客户期间内没有业务"，
  //   把人往"真没单"上引（这条与报表页 rangeReady 同一个教训）。
  if (startDate.value && endDate.value && startDate.value > endDate.value) {
    uni.showToast({ title: '开始日期晚于结束日期，先改一下期间', icon: 'none' })
    return
  }
  const my = ++loadSeq
  loading.value = true
  queryError.value = ''
  const res = await reportApi.statement({
    customerId: customerId.value, from: startDate.value, to: endDate.value,
  })
  if (my !== loadSeq) return    // 已有更新的查询发出，这次响应作废
  loading.value = false
  statement.value = res.ok ? res.data : null
  // ★ 失败落到错误块（带原因 + 点击重试），不再只有一闪而过的 toast
  queryError.value = res.ok ? '' : String(res.message || '查询失败，点此重试')
}

/** 导出对账明细（发给客户/存档）。金额按借贷分列，末尾带应收余额。 */
function doExport() {
  const s = summary.value
  exportCsv(
    `对账单_${customerName.value || customerId.value}_${startDate.value}_${endDate.value}`,
    ['日期', '类型', '单号', '摘要', '借方(出货·应收增加)', '贷方(收款·应收减少)', '应收余额(负=预收)'],
    (statement.value?.items || []).map((it) => [it.date, it.typeName, it.billNo, it.description, it.debit, it.credit, it.balance])
      .concat([['', '', '', '期初应收', '', '', s.openingBalance],
               ['', '', '', '期末应收', '', '', s.closingBalance]]),
  )
}

function goBill(billNo) {
  // ★ 直跳销售单详情：详情页的 id 就是 bill_no（adapt.toBillDetail id=bill_no）。
  //   旧写法 navigateTo '/pages/sales/list' 有两个问题：sales/list 是 tabBar 页
  //   （navigateTo 打开它在 H5 下直接失败），而且用户想看的是「这一张单」。
  if (!billNo) return
  uni.navigateTo({ url: '/pages/sales/detail?id=' + billNo })
}

// ★ 客户详情页「往来对账」入口带 ?customerId=&name= 进来 —— 必须接住并自动查询。
//   旧版不读参数：跳过来是空表单，客户得重选一遍。
onLoad((q) => {
  if (q && q.customerId) {
    customerId.value = q.customerId
    customerName.value = q.name ? decodeURIComponent(q.name) : ''
  }
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) {
    presetRange.value = { from: q.from, to: q.to }
  }
})

onMounted(async () => {
  defaultRange()
  // ★ 对账必须能查到暂停往来的客户（挂着应收的人不会因为停用就不用对账）⇒ 这里要全量。
  const res = await customerApi.list({ pageSize: 1000, showStopped: true })
  if (res.ok) {
    const d = res.data || {}
    customers.value = d.list || d.items || []
    custTotal.value = Number(d.total) || customers.value.length
    // 带参进入但没带名称：从客户列表补齐
    if (customerId.value && !customerName.value) {
      const hit = customers.value.find((c) => c.id === customerId.value)
      if (hit) customerName.value = hit.name
    }
  }
  // 从客户档案带客户进来 → 自动出当月对账单
  if (customerId.value) load()
})

// ★ 卸载时取消在飞报表请求（2026-09-22）：避免慢查询回调写进已销毁页面
onUnload(() => { cancelByScope('report') })
</script>

<style lang="scss" scoped>
.detail { padding-bottom: 60rpx; }

/* 查询卡 */
/* ★ 卡片自己带底部内边距：竖向 padding 为 0 时，按钮的 margin-bottom 会和卡片底边距折叠到卡片外面，
   结果按钮贴着卡片下沿、那 30rpx 反而变成了卡片与四格之间的空隙。 */
.query { padding: 0 $space-card 30rpx; }
.query__row {
  display: flex; align-items: center; min-height: 100rpx;
  border-bottom: 1rpx solid $color-divider;
}
.query__row:last-of-type { border-bottom: 0; }
.query__row--dates { min-height: 100rpx; }
.query__label { flex: 0 0 auto; width: 100rpx; font-size: $fs-body; color: $color-text-2; }
.query__value { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8rpx; }
.query__value--dates { gap: 12rpx; }
.query__text { font-size: $fs-body; font-weight: $fw-bold; color: $color-text; }
.query__placeholder { font-size: $fs-body; color: $color-text-4; }
.date-box {
  padding: 12rpx 20rpx; border-radius: $radius-input;
  background: $color-bg; font-size: $fs-caption; color: $color-text-2;
}
.date-sep { font-size: $fs-mini; color: $color-text-4; }
.query__submit { margin: 26rpx 0 0; width: 100%; }

/* 余额四格 */
.balance {
  display: grid; grid-template-columns: 1fr 1fr; gap: $space-inner;
  margin-top: $space-gap;
}
.balance__cell {
  background: $color-card; border-radius: $radius-card;
  padding: 26rpx 24rpx; box-shadow: $shadow-card;
  display: flex; flex-direction: column;
}
.balance__cell--hl { background: $color-primary-bg; box-shadow: none; }
.balance__value {
  font-family: $font-num; font-size: $fs-num-lg; font-weight: $fw-heavy;
  color: $color-text; margin-top: 10rpx;
  font-variant-numeric: tabular-nums;
}
.balance__value--up { color: $color-danger; }    /* 本期出货增加应收 → 红 */
.balance__value--down { color: $color-success; } /* 本期收款减少应收 → 绿 */
/* 方向说明：把「这个数字到底是谁欠谁」一次讲清，避免又被读成预存款 */
.balance__note {
  display: block; margin: 12rpx 4rpx 0; font-size: $fs-micro; color: $color-text-3; line-height: 1.6;
}

/* 流水 */
.ledger { display: flex; flex-direction: column; gap: $space-inner; }
.ledger__row {
  background: $color-card; border-radius: $radius-card;
  padding: 26rpx 28rpx; box-shadow: $shadow-card;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx;
}
.ledger__left { flex: 1; min-width: 0; display: flex; gap: 18rpx; }
.ledger__date {
  flex: 0 0 auto; width: 108rpx;
  font-family: $font-num; font-size: $fs-mini; color: $color-text-3;
  font-variant-numeric: tabular-nums; padding-top: 4rpx;
}
.ledger__info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ledger__title { display: flex; align-items: center; gap: 10rpx; }
.ledger__type { font-size: $fs-caption; font-weight: $fw-bold; color: $color-text; }
.ledger__no { font-family: $font-num; font-size: $fs-micro; color: $color-text-2; }
.ledger__desc {
  font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ledger__right { flex: 0 0 auto; text-align: right; display: flex; flex-direction: column; }
.ledger__amount {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold;
  color: $color-danger; font-variant-numeric: tabular-nums;
}
.ledger__amount--in { color: $color-success; }  /* 收款（贷）→ 绿 */
.ledger__balance {
  font-family: $font-num; font-size: $fs-micro; color: $color-text-2;
  margin-top: 6rpx; font-variant-numeric: tabular-nums;
}
.ledger-note {
  padding: 8rpx 8rpx 0;
  font-size: $fs-mini; color: $color-text-4;
}
.ledger-note--warn { color: $color-warning-text; }
.btns { display: flex; gap: 16rpx; margin-top: $space-gap; }
.btns__b { flex: 1; height: 88rpx; }

/* 客户选择弹窗（与 sales/edit.vue 同一套样式） */
/* .mask 样式与入场动画统一在 App.vue 全局（2026-10-08 收拢） */
.picker {
  width: 100%;
  max-height: 80vh;
  background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $space-card;
  border-bottom: 1rpx solid $color-divider;
}
.picker-title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.picker-close { display: flex; align-items: center; justify-content: center; color: $color-text-3; }
.picker-search { padding: $space-inner $space-card; }
.search-box {
  display: flex;
  align-items: center;
  gap: 14rpx;
  height: 80rpx;
  padding: 0 28rpx;
  border-radius: $radius-pill;
  background: $color-bg-sunken;
  color: $color-text-3;
  box-sizing: border-box;
}
.search-box input { flex: 1; min-width: 0; background: transparent; font-size: $fs-body; color: $color-text; }
/* 普通视图 + 显式滚动约束（scroll-view 在 max-height 弹窗里拿不到高度，滚不动） */
.picker-list {
  flex: 1;
  min-height: 0;
  max-height: 56vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 $space-card;
  box-sizing: border-box;
}
.picker-item { padding: 26rpx 0; border-bottom: 1rpx solid $color-divider; }
.picker-item:last-child { border-bottom: 0; }
.pi-name { font-size: $fs-body; font-weight: $fw-bold; }
.pi-meta { display: block; margin-top: 8rpx; font-size: $fs-mini; color: $color-text-3; }
.picker-trunc { padding: 20rpx 0 26rpx; font-size: $fs-micro; color: $color-warning-text; line-height: 1.6; }
</style>
