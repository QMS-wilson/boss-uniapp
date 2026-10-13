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
      <view class="query__row query__row--quick">
        <text class="query__label">快捷</text>
        <view class="query__value query__value--quick">
          <view
            v-for="q in QUICKS" :key="q.key"
            class="qchip" :class="{ 'qchip--on': activeQuick === q.key }"
            @click="setQuick(q.key)" hover-class="hv-on" :hover-stay-time="80">{{ q.label }}</view>
        </view>
      </view>
      <button class="btn-primary query__submit" :disabled="!canQuery || loading" @click="load">
        {{ loading ? '查询中...' : '查询货品明细' }}
      </button>
    </view>

    <template v-if="report">
      <!-- 汇总三格 -->
      <view class="summary">
        <view class="summary__cell">
          <text class="metric-label">商品种类</text>
          <text class="summary__value">{{ summary.productCount || 0 }}<text class="summary__unit">种</text></text>
        </view>
        <view class="summary__cell">
          <text class="metric-label">销售数量</text>
          <text class="summary__value">{{ summary.totalQuantity || 0 }}</text>
        </view>
        <view class="summary__cell summary__cell--hl">
          <text class="metric-label">销售金额</text>
          <text class="summary__value">¥{{ fmtMoneyGroup(summary.totalAmount) }}</text>
        </view>
      </view>

      <!-- 货品汇总 -->
      <view class="section-head">
        <text class="section-head__title">货品汇总</text>
        <text class="section-head__action">共 {{ summary.productCount || 0 }} 种</text>
      </view>
      <view v-if="items.length" class="goods">
        <view v-for="it in items" :key="it.productId" class="goods__row" @click="goProduct(it.productId)" hover-class="hv-on" :hover-stay-time="80">
          <view class="goods__main">
            <view class="goods__name-line">
              <text class="goods__name">{{ it.productName || it.productId }}</text>
              <StopTag kind="product" :code="it.productId" />
            </view>
            <text class="goods__meta">{{ metaOf(it) }}</text>
          </view>
          <view class="goods__right">
            <text class="goods__amount">¥{{ fmtMoneyGroup(it.amount) }}</text>
            <!-- ★ 单价：入口副标题一直写着「数量、单价及金额」，后端 averagePrice 也一直在返回，
                 之前模板没渲染这一列（adapt 里字段叫 avgPrice）。 -->
            <text class="goods__price">¥{{ fmtMoneyGroup(it.avgPrice) }}<text class="goods__unit">/{{ it.unit || '件' }}</text></text>
            <text class="goods__qty">{{ fmtQty(it.quantity) }} {{ it.unit || '件' }} · {{ it.billCount }} 笔</text>
          </view>
        </view>
        <view class="goods__sub">
          <text>本页前 {{ items.length }} 种小计</text>
          <text class="goods__subv">¥{{ fmtMoneyGroup(listSubtotal) }}<text v-if="subtotalPct" class="goods__subp"> · 占 {{ subtotalPct }}</text></text>
        </view>
      </view>
      <EmptyState v-else text="暂无可显示的货品明细" sub="该客户在此期间没有购买记录" />

      <!-- ★ 明细有行数上限时合计 ≠ 列表相加，不写清楚就会被当成算错 -->
      <view v-if="report && report.truncated" class="trunc">
        <text>该客户期间内共 {{ summary.productCount }} 种货品，接口单次最多返回 {{ report.rowLimit }} 种，
          上面是金额最高的前 {{ items.length }} 种。合计三格取的是全量 SQL，所以「合计 ≠ 列表相加」不是算错。
          「导出」里 CSV 导的就是本页这些行；Excel 那张是按单逐行展开的，另有一个行数上限，
          两边都被截断时请把期间缩小到没被截断为止。</text>
      </view>

      <view v-if="items.length" class="btns">
        <view class="btn-ghost btns__b" @click="showFormats = true" hover-class="hv-on" :hover-stay-time="80">
          <Icon name="file-text" :size="16" color="text-2" /><text>导出</text>
        </view>
        <view class="btn-primary btns__b" @click="goReconcile" hover-class="hv-on" :hover-stay-time="80"><text>做往来对账单</text></view>
      </view>
    </template>

    <!-- ★ 查询失败 ⇒ 错误块（带原因 + 点击重试）。排在"请选择客户与日期"那张空态**之前**，
         否则失败会被渲染成"还没查"—— 这是本项目反复出现的"把失败说成空"那一类。 -->
    <LoadState v-else-if="queryError" :error="queryError" @retry="load" />

    <EmptyState
      v-else-if="!loading"
      icon="chart"
      text="请选择客户与日期"
      sub="选择后将生成货品明细"
    />

    <!-- 导出格式选择。
         ★ 「月份对账单」这张是**逐单逐行**的（一行一个货品，带系统单号与开单日期），
           比屏上这张按货品聚合的表细一层 —— 所以它要单独再问一次云端（多带"要货品行"开关），
           不在页面每次查询里背着。
         ★ 两格是**写死的两个站点**，不循环：图标管线靠静态扫调用点生成 data-URI 表，
           `:name="f.icon"` 这种动态名它取不到名字，结果不是报错而是图标静默变成灰块。 -->
    <view v-if="showFormats" class="mask" @click="showFormats = false">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">选择导出格式</text>
          <view class="picker-close" @click="showFormats = false" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="20" color="text-3" /></view>
        </view>
        <view class="picker-list">
          <view class="fmt-item" @click="pickFormat('excel')" hover-class="hv-on" :hover-stay-time="80">
            <view class="fmt-item__icon"><Icon name="grid" :size="20" color="text-2" /></view>
            <view class="fmt-item__text">
              <text class="pi-name">月份对账单（Excel）</text>
              <text class="pi-meta">逐单逐行：一行一个货品，带系统单号与开单日期</text>
              <text class="pi-meta">本页 {{ summary.productCount || 0 }} 种货品，导出时按单拆开</text>
            </view>
            <Icon name="chevron-right" :size="16" color="text-4" />
          </view>
          <view class="fmt-item" @click="pickFormat('csv')" hover-class="hv-on" :hover-stay-time="80">
            <view class="fmt-item__icon"><Icon name="file-text" :size="20" color="text-2" /></view>
            <view class="fmt-item__text">
              <text class="pi-name">货品明细（CSV）</text>
              <text class="pi-meta">一种货品一行，与屏上这张表的数字一致</text>
              <text class="pi-meta">{{ items.length }} 行，能贴进微信或导进表格软件再算</text>
            </view>
            <Icon name="chevron-right" :size="16" color="text-4" />
          </view>
        </view>
      </view>
    </view>

    <!-- 客户选择弹窗（全量 + 搜索；旧 ActionSheet 只能选到前 8 个客户） -->
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
import { fmtMoneyGroup, fmtQty, fmtDate, quickRange } from '../../utils/format'
import { exportCsv, saveWorkbook } from '../../utils/export'
import { buildStatementWorkbook, flattenStatementRows } from '../../utils/statementExcel'
import Icon from '../../components/Icon.vue'
import EmptyState from '../../components/EmptyState.vue'
import LoadState from '../../components/LoadState.vue'
import StopTag from '../../components/StopTag.vue'

const customerId = ref('')
const customerName = ref('')
/** ★ 查询失败的原因（空串=没失败）：必须落在界面上，不能只飘一支 toast 就把页面交回空态 */
const queryError = ref('')
const customers = ref([])
const startDate = ref('')
const endDate = ref('')
/** 从报表首页带进来的区间（两个都是 `YYYY-MM-DD` 才算，缺一个就按本月） */
const presetRange = ref(null)
const report = ref(null)
const loading = ref(false)
// ★ 请求代际：选客户/快捷期间在 loading 里照样能点（不在任何门控区内），
//   先选 A（慢）再选 B（快）时，A 的旧响应后到会把屏上数字改成"A 的金额、B 的抬头"。
//   与 inventory/index.vue 同款：谁最新谁说了算，旧响应直接丢弃。
let loadSeq = 0

/** 常用区间：省掉每次点两个日期控件；手改日期后自动取消高亮 */
const QUICKS = [
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: '90d', label: '近90天' },
  { key: 'year', label: '本年' },
]
const quick = ref('thisMonth')
const activeQuick = computed(() => quick.value)

// ★ 客户选择弹窗（全量列表 + 本地搜索），替换「只能选前 8 个」的 ActionSheet
const showPicker = ref(false)
const custKeyword = ref('')
// 导出格式选择：Excel 那张要**再问一次云端**（多带一个"要货品行"的开关），
// 所以另有一个在途标记，不与查询的 loading 混用 —— 混用了会让人以为在查重查。
const showFormats = ref(false)
const exporting = ref(false)
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

const summary = computed(() => report.value?.summary || { productCount: 0, totalQuantity: 0, totalAmount: 0 })
const items = computed(() => report.value?.items || [])
const canQuery = computed(() => !!customerId.value && !!startDate.value && !!endDate.value)

/** 本页（已返回的）金额小计与占全量合计的比例 —— 截断时让用户知道自己看到的是多少 */
const listSubtotal = computed(() =>
  items.value.reduce((s, r) => s + (Number(r.amount) || 0), 0))
const subtotalPct = computed(() => {
  const total = Number(summary.value.totalAmount) || 0
  return total ? ((listSubtotal.value / total) * 100).toFixed(1) + '%' : ''
})

/** 规格在真库里大多为空串，直接拼会变成「 · 包」这种残缺行 */
function metaOf(it) {
  return [it.spec, '编号 ' + it.productId].filter(Boolean).join(' · ')
}

/** 区间一律走 utils/format.js 的 quickRange —— 四页各写一份的话，
 *  "本月/近90天"在两个页面圈出的单就会不一样，而对不上数时没人会想到是这个原因。 */
function setQuick(key) {
  const r = quickRange(key)
  startDate.value = r.from
  endDate.value = r.to
  quick.value = key
  if (canQuery.value) load()
}

function defaultRange() {
  // ★ 报表首页带过来的期间优先（与对账页同一套，见 report/index.vue 的 go()）
  if (presetRange.value) {
    startDate.value = presetRange.value.from
    endDate.value = presetRange.value.to
    quick.value = ''      // 这个区间对不上任何一颗快捷档，别让它亮着骗人
    return
  }
  setQuick('thisMonth')
}

function pickCustomer(c) {
  customerId.value = c.id; customerName.value = c.name
  showPicker.value = false
  load()
}
function onStart(e) { startDate.value = e.detail.value; quick.value = '' }
function onEnd(e) { endDate.value = e.detail.value; quick.value = '' }

async function load() {
  if (!canQuery.value) return
  // ★ 日期填反了要明说：Agent 那边只会回空集，界面写成"期间内没有业务"，
  //   等于把"你自己填错了"伪装成"这客户没单"。
  if (startDate.value && endDate.value && startDate.value > endDate.value) {
    uni.showToast({ title: '开始日期晚于结束日期，先改一下期间', icon: 'none' }); return
  }
  const my = ++loadSeq
  loading.value = true
  queryError.value = ''
  const res = await reportApi.customerProducts({
    customerId: customerId.value, from: startDate.value, to: endDate.value,
  })
  if (my !== loadSeq) return    // 已有更新的查询发出，这次响应作废
  loading.value = false
  report.value = res.ok ? res.data : null
  // ★★ 失败要说得出、也要看得见（2026-10-12）：以前只有一支 toast，
  //   页面随即落回「请选择客户与日期」那张空态 —— 把"查失败了"演成"还没查"，
  //   而 toast 1.5 秒就没了，没人来得及看。错误块由 LoadState 出，带原因 + 点击重试。
  queryError.value = res.ok ? '' : String(res.message || '查询失败，点此重试')
}

function doExport() {
  exportCsv(
    `货品明细_${customerName.value || customerId.value}_${startDate.value}_${endDate.value}`,
    ['货品编号', '品名', '规格', '单位', '数量', '单价', '金额', '笔数'],
    items.value.map((i) => [i.productId, i.productName, i.spec, i.unit, i.quantity, i.avgPrice, i.amount, i.billCount]),
  )
}

/** 选完格式再动手：两条路的取数范围不一样，别在弹层里就把两条都跑一遍。 */
function pickFormat(key) {
  showFormats.value = false
  if (key === 'csv') return doExport()
  return doExportExcel()
}

/**
 * 导出「月份对账单」Excel —— 逐单逐行那张（一行一个货品，带系统单号与开单日期）。
 *
 * ★ 为什么数据不在本页已有的 report 里：`customerProducts` 回的是**按货品聚合**的一种一行
 *   （屏上这张表就是它），而这张版式要的是**每张单里每个货品各一行**。
 *   逐单逐行那层挂在往来对账那条查询上（`withLines=1`，云端默认不给），所以这里单独发一次。
 * ★ 期间用的是本页当前选中的起止 ⇒ 与屏上那三格汇总同一把尺子；对不上数时先查这里。
 */
async function doExportExcel() {
  if (exporting.value) return
  exporting.value = true
  uni.showLoading({ title: '正在取货品行', mask: true })
  const res = await reportApi.statement({
    customerId: customerId.value, from: startDate.value, to: endDate.value, lines: true,
  })
  uni.hideLoading()
  exporting.value = false
  if (!res.ok) {
    uni.showToast({ title: res.message || '取货品行失败', icon: 'none', duration: 3000 })
    return
  }
  const st = res.data || {}
  const bills = st.items || []
  const rows = flattenStatementRows(bills)

  // ★ 一张单都没展开 ⇒ 这文件导出去会是一张"有单号、没货品"的空表，
  //   而它看起来是成功的。这种情况必须停下来讲原因，不能默默发出去。
  if (!rows.some((r) => r.productId)) {
    uni.showModal({
      title: bills.length + ' 张单都没回货品行',
      content: '这张版式要的是「一行一个货品」，本地服务这次只给了单头的钱。'
        + '多半是电脑上那个 V3 助手还是旧版，升级后再导一次；也可以先用 CSV 那条发出去。',
      confirmText: '改导 CSV', cancelText: '知道了',
      success: (r) => { if (r.confirm) doExport() },
    })
    return
  }

  // 两种截断是两件不同的事：一个砍的是**单**，一个砍的是**货品行**。
  const cut = []
  if (st.truncated) cut.push('流水按上限只取了前 ' + st.rowLimit + ' 张单，后面的单不在这张表里')
  if (st.linesTruncated) cut.push('货品行按上限只取了前 ' + st.lineLimit + ' 行，排在后面的单会整单没有展开的行')
  if (cut.length && !(await askContinue(cut))) return

  const bytes = buildStatementWorkbook({
    customerName: st.customerName || customerName.value,
    from: startDate.value, to: endDate.value, rows,
  })
  saveWorkbook(
    `月份对账单_${st.customerName || customerId.value}_${startDate.value}_${endDate.value}.xlsx`,
    bytes, '含 ' + rows.length + ' 行货品',
  )
}

/** 截断了还要不要照样导。showModal 自身出错时**不拦**（拦下来等于把人堵在门外）。 */
function askContinue(lines) {
  return new Promise((resolve) => {
    uni.showModal({
      title: '这一份是不完整的',
      content: lines.join('；') + '。要照样导出吗？想逐行核对请把期间缩短到没被截断为止。',
      confirmText: '照样导出', cancelText: '先改期间',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(true),
    })
  })
}

function goReconcile() {
  if (!customerId.value) return
  uni.navigateTo({
    url: `/pages/report/reconcile?customerId=${encodeURIComponent(customerId.value)}&name=${encodeURIComponent(customerName.value || '')}`,
  })
}

function goProduct(pid) {
  // ★ product/detail.vue 的 onLoad 读的是 q.id（不是 code），传错键 = 详情页永远空白。
  //   Agent 侧已把明细 productId 统一 LTRIM(RTRIM)（详情查询也是 trim 口径，两边闭合）。
  if (!pid) return
  uni.navigateTo({ url: '/pages/product/detail?id=' + pid })
}

// ★ 客户详情页「客户货品明细」入口带 ?customerId=&name= 进来 —— 必须接住并自动查询。
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
  // ★ 报表选客户要连暂停往来的一起给：这位今天不进货了，他名下的历史照样要能对账、看账龄。
  //   （档案列表页相反 —— 默认只给正常往来的，那里"停用"意味着平时别碍眼。）
  const res = await customerApi.list({ pageSize: 1000, showStopped: true })
  if (res.ok) {
    const d = res.data || {}
    customers.value = d.list || d.items || []
    custTotal.value = Number(d.total) || customers.value.length
    if (customerId.value && !customerName.value) {
      const hit = customers.value.find((c) => c.id === customerId.value)
      if (hit) customerName.value = hit.name
    }
  }
  // 从客户档案带客户进来 → 自动出当月货品明细
  if (customerId.value) load()
})

// ★ 卸载时取消在飞报表请求（2026-09-22）：避免慢查询回调写进已销毁页面
onUnload(() => { cancelByScope('report') })
</script>

<style lang="scss" scoped>
.detail { padding-bottom: 60rpx; }

/* 查询卡（与对账单页一致） */
/* ★ 卡片自己带底部内边距：竖向 padding 为 0 时，按钮的 margin-bottom 会和卡片底边距折叠到卡片外面，
   结果按钮贴着卡片下沿、那 30rpx 反而变成了卡片与三格之间的空隙。 */
.query { padding: 0 $space-card 30rpx; }
.query__row {
  display: flex; align-items: center; min-height: 100rpx;
  border-bottom: 1rpx solid $color-divider;
}
.query__row:last-of-type { border-bottom: 0; }
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

/* 汇总三格 */
.summary {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: $space-inner;
  margin-top: $space-gap;
}
.summary__cell {
  background: $color-card; border-radius: $radius-card;
  padding: 24rpx 20rpx; box-shadow: $shadow-card;
  display: flex; flex-direction: column;
}
.summary__cell--hl { background: $color-primary-bg; box-shadow: none; }
.summary__value {
  font-family: $font-num; font-size: 32rpx; font-weight: $fw-heavy;
  color: $color-text; margin-top: 10rpx;
  font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.summary__unit { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-3; margin-left: 2rpx; }

/* 货品列表 */
.goods { display: flex; flex-direction: column; gap: $space-inner; }
.goods__row {
  background: $color-card; border-radius: $radius-card;
  padding: 26rpx 28rpx; box-shadow: $shadow-card;
  display: flex; align-items: center; justify-content: space-between; gap: 20rpx;
}
.goods__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.goods__name {
  font-size: $fs-body; font-weight: $fw-bold; color: $color-text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.goods__name-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.goods__meta { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.goods__right { flex: 0 0 auto; text-align: right; display: flex; flex-direction: column; }
.goods__amount {
  font-family: $font-num; font-size: $fs-body; font-weight: $fw-heavy;
  color: $color-text; font-variant-numeric: tabular-nums;
}
.goods__qty {
  font-family: $font-num; font-size: $fs-micro; color: $color-text-4;
  margin-top: 6rpx; font-variant-numeric: tabular-nums;
}
.goods__price {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold; color: $color-primary;
  margin-top: 6rpx; font-variant-numeric: tabular-nums;
}
.goods__unit { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-4; }
.goods__sub {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  background: $color-bg-sunken; border-radius: $radius-card; padding: 22rpx 28rpx;
  font-size: $fs-caption; color: $color-text-2;
}
.goods__subv { font-family: $font-num; font-weight: $fw-bold; color: $color-text; font-variant-numeric: tabular-nums; }
.goods__subp { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-3; }

/* 快捷期间 */
.query__row--quick { min-height: 88rpx; }
.query__value--quick { gap: 12rpx; flex-wrap: wrap; }
.qchip {
  font-size: $fs-mini; color: $color-text-2; background: $color-bg;
  border-radius: $radius-pill; padding: 8rpx 22rpx;
}
.qchip--on { background: $color-primary; color: #fff; font-weight: $fw-bold; }

/* 截断说明 / 底部操作 */
.trunc {
  margin-top: $space-inner; padding: 20rpx 24rpx;
  background: $color-warning-bg; border-radius: $radius-card-sm;
  font-size: $fs-mini; color: $color-warning-text; line-height: 1.7;
}
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

/* 导出格式：图标在左、两行说明在中、进箭头在右。
   第二行（多少种/多少行）比第一行淡一档 —— 它是量，不是这句话的主角。 */
.fmt-item {
  display: flex; align-items: center; gap: 20rpx;
  padding: 28rpx 0; border-bottom: 1rpx solid $color-divider;
}
.fmt-item:last-child { border-bottom: 0; }
.fmt-item__icon {
  flex: 0 0 auto; width: 60rpx; height: 60rpx; border-radius: $radius-input;
  background: $color-bg; display: flex; align-items: center; justify-content: center;
}
.fmt-item__text { flex: 1; min-width: 0; }
.fmt-item__text .pi-meta + .pi-meta { color: $color-text-4; }
.picker-trunc { padding: 20rpx 0 26rpx; font-size: $fs-micro; color: $color-warning-text; line-height: 1.6; }
</style>
