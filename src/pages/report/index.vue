<template>
  <view class="page report">
    <LoadState :loading="loading" :error="fatalError" :offline="!!cachedNote" :cached-at="cachedAt" :note="cachedNote" @retry="load">
      <!-- 标题 + 数据时点（报表页最常被问的是「这是什么时候的数」） -->
      <view class="hello">
        <view class="hello__l">
          <text class="hello__title">账款与经营分析</text>
          <text class="hello__sub">未结应收看客户档案，经营看所选期间</text>
        </view>
        <view class="hello__stamp">
          <text class="hello__stamp-k">数据截至</text>
          <text class="hello__stamp-v">{{ stamp }}</text>
        </view>
      </view>

      <!-- ============ 应收账款 + 账龄（与期间无关，永远在第一位） ============ -->
      <view class="ar" @click="go('receivable')" hover-class="hv-on" :hover-stay-time="80">
        <view v-if="st.receivables.state === 'loading' && !receivables.total" class="ar__sk">
          <view class="sk sk--l" /><view class="sk sk--xl" /><view class="sk sk--m" />
        </view>
        <view v-else-if="st.receivables.state === 'error' && !receivables.total" class="ar__sk">
          <text class="ar__errt">应收账款暂时取不到</text>
          <text class="ar__err">{{ st.receivables.error }}</text>
          <view class="ar__retry" @click.stop="run('receivables')"><Icon name="refresh" :size="14" color="text" /><text>重试</text></view>
        </view>
        <template v-else>
          <text class="ar__l">未结应收合计（客户欠我方货款）</text>
          <view class="ar__v"><AnimatedNumber :value="receivables.total" format="money" prefix="¥" /></view>
          <text class="ar__n">{{ receivables.count }} 家客户有未结应收 · 与客户档案同源</text>

          <view v-if="aging.length" class="ar__bar">
            <view
              v-for="b in aging" :key="'b' + b.key"
              class="ar__seg" :style="{ width: b.pct + '%', background: b.color }"
            />
          </view>
          <view v-if="aging.length" class="ar__grid">
            <view
              v-for="b in aging" :key="'c' + b.key"
              class="ar__c" :class="{ 'ar__c--hot': b.key === '90+' }"
            >
              <text class="ar__c-k">{{ b.label }}</text>
              <text class="ar__c-v">{{ wan(b.amount) }}</text>
              <text class="ar__c-n">{{ b.customers }} 家</text>
            </view>
          </view>

          <view class="ar__foot">
            <text>按客户查看应收明细 / 逐家催收</text>
            <Icon name="chevron-right" :size="16" color="text" />
          </view>
          <text v-if="aging.length" class="ar__hint">{{ receivables.agingNote }}。分段合计 ¥{{ fmtMoneyGroup(receivables.agingTotal) }}{{ agingClosed ? ' = 应收总额 ✓' : ' ≠ 应收总额，请核对' }}</text>
        </template>
      </view>

      <!-- ============ 报表入口 ============ -->
      <view class="entries">
        <view class="entry" @click="go('reconcile')" hover-class="hv-on" :hover-stay-time="80">
          <view class="entry__icon entry__icon--blue"><Icon name="file-text" :size="19" color="primary" /></view>
          <view class="entry__meta">
            <text class="entry__title">往来对账</text>
            <text class="entry__sub">按客户看期初应收、出货、收款、期末应收</text>
          </view>
          <Icon name="chevron-right" :size="17" />
        </view>
        <view class="entry" @click="go('goods')" hover-class="hv-on" :hover-stay-time="80">
          <view class="entry__icon entry__icon--violet"><Icon name="chart" :size="19" color="violet" /></view>
          <view class="entry__meta">
            <text class="entry__title">客户货品明细</text>
            <text class="entry__sub">按客户看期间购买数量、单价、金额</text>
          </view>
          <Icon name="chevron-right" :size="17" />
        </view>
      </view>

      <view class="section-head">
        <text class="section-head__title">经营分析</text>
        <text class="section-head__action">销售业务 · {{ rangeLabel }}</text>
      </view>

      <!-- ============ 期间筛选 ============ -->
      <view class="period">
        <view
          v-for="p in PERIODS" :key="p.key"
          class="period__chip" :class="{ 'period__chip--on': period === p.key }"
          @click="setPeriod(p.key)" hover-class="hv-on" :hover-stay-time="80">{{ p.label }}</view>
      </view>
      <view class="period period--sub">
        <view
          v-for="q in QUICKS" :key="q.key"
          class="period__chip period__chip--sm" :class="{ 'period__chip--on': period === q.key }"
          @click="setPeriod(q.key)" hover-class="hv-on" :hover-stay-time="80">{{ q.label }}</view>
      </view>
      <view v-if="period === 'custom'" class="period-custom">
        <picker mode="date" :value="customFrom" @change="onCustomFrom">
          <view class="date-box" :class="{ 'date-box--err': customTouched && !customFrom }">
            <text>{{ customFrom || '开始日期' }}</text>
          </view>
        </picker>
        <text class="date-sep">至</text>
        <picker mode="date" :value="customTo" @change="onCustomTo">
          <view class="date-box" :class="{ 'date-box--err': customTouched && !customTo }">
            <text>{{ customTo || '结束日期' }}</text>
          </view>
        </picker>
      </view>
      <text v-if="period === 'custom' && !rangeReady" class="period-tip">
        起止日期未填齐（或开始晚于结束）。填完整之前不会发查询 —— 否则后端会按「本月1日~今天」出数，
        数字和你以为的区间不是一回事。
      </text>

      <!-- ============ 数据区 ============ -->
      <view class="report-data">
        <!-- 四格 -->
        <view class="mod" :class="modCls('sales')">
          <view class="analysis">
            <view class="analysis__cell">
              <text class="metric-label">销售汇总</text>
              <!-- ★ 必须是 view：text 组件里放自定义组件，小程序端整块不渲染（实测踩过） -->
              <view class="analysis__value"><AnimatedNumber :value="summary.totalAmount" format="money" prefix="¥" /></view>
              <view class="analysis__foot">
                <text v-if="pill(summary.compare && summary.compare.amount)" class="delta" :class="'delta--' + pill(summary.compare.amount).k">
                  {{ pill(summary.compare.amount).t }}
                </text>
                <text class="metric-note">{{ summary.billCount }} 张单</text>
              </view>
            </view>
            <view class="analysis__cell">
              <text class="metric-label">客单价</text>
              <view class="analysis__value"><AnimatedNumber :value="summary.avgBill" format="money" prefix="¥" /></view>
              <view class="analysis__foot">
                <text v-if="pill(summary.compare && summary.compare.avgBill)" class="delta" :class="'delta--' + pill(summary.compare.avgBill).k">
                  {{ pill(summary.compare.avgBill).t }}
                </text>
                <text class="metric-note">单均金额</text>
              </view>
            </view>
            <view class="analysis__cell">
              <text class="metric-label">销售数量</text>
              <view class="analysis__value"><AnimatedNumber :value="summary.totalQty" format="raw" /><text class="analysis__unit">件</text></view>
              <view class="analysis__foot">
                <text v-if="pill(summary.compare && summary.compare.qty)" class="delta" :class="'delta--' + pill(summary.compare.qty).k">
                  {{ pill(summary.compare.qty).t }}
                </text>
                <text class="metric-note">全部商品</text>
              </view>
            </view>
            <view class="analysis__cell">
              <text class="metric-label">活跃客户</text>
              <!-- 后端没返回该字段时显示「—」而不是 0（旧版 Agent 无 customerCount） -->
              <view class="analysis__value">
                <template v-if="summary.customerCount !== null">
                  <AnimatedNumber :value="summary.customerCount" format="raw" /><text class="analysis__unit">家</text>
                </template>
                <text v-else>—</text>
              </view>
              <view class="analysis__foot">
                <text v-if="customerDelta" class="delta" :class="customerDelta.k">{{ customerDelta.t }}</text>
                <text class="metric-note">{{ summary.activeDays ? summary.activeDays + ' 天有出货' : '期间有出货' }}</text>
              </view>
            </view>
          </view>
          <text v-if="summary.previous" class="mod__cmp">环比对象：上一等长周期 {{ summary.previous.dateFrom }} ~ {{ summary.previous.dateTo }}</text>
          <view class="mod__err" v-if="st.sales.state === 'error'">
            <text>{{ st.sales.error }}</text>
            <view class="mod__retry" @click="run('sales')" hover-class="hv-on" :hover-stay-time="80"><Icon name="refresh" :size="14" /><text>重试</text></view>
          </view>
        </view>

        <!-- 断档提示 -->
        <view v-if="summary.gaps && summary.gaps.length" class="warnbar">
          <Icon name="alert-circle" :size="16" color="warning" />
          <text class="warnbar__x">{{ rangeLabel }}里有 {{ summary.gaps.length }} 段出货断档（最长
            {{ fmtMD(summary.gaps[0].from) }}~{{ fmtMD(summary.gaps[0].to) }} 共 {{ summary.gaps[0].days }} 天 0 单）。
            环比降幅先受断档影响，别当成经营下滑。</text>
        </view>

        <!-- 趋势 -->
        <view class="mod" :class="modCls('trend')">
          <view class="card chart-card">
            <view class="chart-head">
              <text class="chart-head__t">{{ gran === 'day' ? '销售趋势（按日）' : '销售趋势（按月）' }}</text>
              <view class="chart-head__seg">
                <text
                  v-for="g in GRANS" :key="g.key"
                  class="chart-head__tab" :class="{ 'chart-head__tab--on': gran === g.key }"
                  @click="switchGran(g.key)"
                >{{ g.label }}</text>
              </view>
            </view>
            <LineChart
              :data="trendData"
              :extras="trendExtras"
              :gap-bands="trendBands"
              :summary="fmtMoneyGroup(trendTotal)"
              :summary-label="rangeLabel + '合计'"
              :max-labels="5"
              :title="''"
              :subtitle="''"
            />
            <!-- 聚合口径（峰值不重复列：读数行已经显示当前点/峰值） -->
            <view class="chart__stats">
              <!-- ★ 文案跟着粒度走：按月时点数是"月"，写死"天/日均"会把月均说成日均（差 30 倍量级） -->
              <text class="chart__stat tnum">{{ trendActiveDays }}/{{ trendData.length }} {{ gran === 'month' ? '个月有出货' : '天有出货' }}</text>
              <text class="chart__stat tnum">{{ gran === 'month' ? '有单月均' : '有单日均' }} ¥{{ fmtMoneyGroup(trendAvg) }}</text>
              <text v-if="gran === 'month'" class="chart__stat">断档标注只在按日视图下有效</text>
            </view>
          </view>
          <view class="mod__err" v-if="st.trend.state === 'error'">
            <text>{{ st.trend.error }}</text>
            <view class="mod__retry" @click="run('trend')" hover-class="hv-on" :hover-stay-time="80"><Icon name="refresh" :size="14" /><text>重试</text></view>
          </view>
        </view>

        <!-- 毛利 -->
        <view class="mod" :class="modCls('profit')">
          <!-- 成本来源不足 ⇒ 隐藏数字。毛利率 99%+ 不是业绩好，是没有成本。 -->
          <view v-if="profit && !profit.available" class="card profit profit--off">
            <view class="profit__head">
              <text class="profit__title">毛利 / 毛利率</text>
              <text class="profit__off">成本来源不足 · 已隐藏</text>
            </view>
            <text class="profit__big">暂不出示</text>
            <text class="profit__why">{{ profit.note }}。若照常出数，毛利率会显示
              {{ (profit.grossMargin * 100).toFixed(1) }}% —— 那是没有成本扣减的假象。</text>
            <view class="profit__src">
              <text class="profit__srcr">在售货品有采购均价：{{ profit.costedProducts }} / {{ profit.soldProducts }} 个</text>
              <text class="profit__srcr">明细成本字段有值：{{ profit.sources.detailCost.costedRows || 0 }} / {{ profit.sources.detailCost.rows || 0 }} 行</text>
              <text class="profit__srcr">档案成本价：{{ profit.sources.masterCostPrice.products || 0 }} / {{ profit.sources.masterCostPrice.total || 0 }} 个</text>
              <text class="profit__srcr">进货单：{{ profit.sources.purchaseBills.count || 0 }} 张 · ¥{{ fmtMoneyGroup(profit.sources.purchaseBills.amount || 0) }}</text>
            </view>
            <text class="profit__act">录入进货单或在商品档案维护成本价后，这里会自动恢复。</text>
          </view>
          <view v-else-if="profit" class="card profit">
            <view class="profit__head">
              <text class="profit__title">毛利</text>
              <text class="profit__sub">{{ rangeLabel }} · 成本按采购均价估算</text>
            </view>
            <view class="profit__main">
              <view class="profit__value" :class="profit.grossProfit >= 0 ? 'up' : 'down'">
                <AnimatedNumber :value="profit.grossProfit" format="money" prefix="¥" />
              </view>
              <view class="profit__margin">毛利率 <AnimatedNumber :value="profit.grossMargin" format="pct" /></view>
            </view>
            <view class="profit__grid">
              <view class="profit__cell">
                <text class="metric-label">销售额</text>
                <view class="profit__num"><AnimatedNumber :value="profit.salesAmount" format="money" prefix="¥" /></view>
              </view>
              <view class="profit__cell">
                <text class="metric-label">成本</text>
                <view class="profit__num"><AnimatedNumber :value="profit.costAmount" format="money" prefix="¥" /></view>
              </view>
            </view>
          </view>
          <view class="mod__err" v-if="st.profit.state === 'error'">
            <text>{{ st.profit.error }}</text>
            <view class="mod__retry" @click="run('profit')" hover-class="hv-on" :hover-stay-time="80"><Icon name="refresh" :size="14" /><text>重试</text></view>
          </view>
        </view>

        <!-- 排行 -->
        <view class="mod" :class="modCls('customerRank')">
          <view class="card chart-card">
            <BarChart
              title="客户销售额排行"
              :subtitle="rangeLabel + ' · 按销售额降序'"
              :data="ranking"
              kind="customer"
              :limit="5"
              clickable
              expandable
              @select="goCustomer"
            />
          </view>
          <view class="mod__err" v-if="st.customerRank.state === 'error'">
            <text>{{ st.customerRank.error }}</text>
            <view class="mod__retry" @click="run('customerRank')" hover-class="hv-on" :hover-stay-time="80"><Icon name="refresh" :size="14" /><text>重试</text></view>
          </view>
        </view>

        <view class="mod" :class="modCls('productRank')">
          <view class="card chart-card">
            <BarChart
              title="商品销售额排行"
              :subtitle="rangeLabel + ' · 按销售额降序'"
              :data="productRanking"
              kind="product"
              :limit="5"
              clickable
              expandable
              @select="goProduct"
            />
          </view>
          <view class="mod__err" v-if="st.productRank.state === 'error'">
            <text>{{ st.productRank.error }}</text>
            <view class="mod__retry" @click="run('productRank')" hover-class="hv-on" :hover-stay-time="80"><Icon name="refresh" :size="14" /><text>重试</text></view>
          </view>
        </view>

        <!-- 采购 -->
        <view class="section-head section-head--mt">
          <text class="section-head__title">采购业务</text>
          <text class="section-head__action">{{ rangeLabel }}</text>
        </view>
        <view class="mod" :class="modCls('purchase')">
          <view class="analysis analysis--2">
            <view class="analysis__cell">
              <text class="metric-label">采购汇总</text>
              <view class="analysis__value"><AnimatedNumber :value="purchaseSummary.totalAmount" format="money" prefix="¥" /></view>
              <text class="metric-note">{{ purchaseSummary.billCount }} 张进货单</text>
            </view>
            <view class="analysis__cell">
              <text class="metric-label">进货数量</text>
              <view class="analysis__value"><AnimatedNumber :value="purchaseSummary.totalQty" format="raw" /><text class="analysis__unit">件</text></view>
              <text class="metric-note">{{ purchaseSummary.supplierCount }} 家供应商</text>
            </view>
          </view>
          <view class="mod__err" v-if="st.purchase.state === 'error'">
            <text>{{ st.purchase.error }}</text>
            <view class="mod__retry" @click="run('purchase')" hover-class="hv-on" :hover-stay-time="80"><Icon name="refresh" :size="14" /><text>重试</text></view>
          </view>
        </view>

        <!-- ★ 供应商少于 3 家时不画排行：一张测试进货单画出来的「排行」只会让人怀疑数据 -->
        <view v-if="supplierRanking.length >= 3" class="mod" :class="modCls('supplierRank')">
          <view class="card chart-card">
            <BarChart
              title="供应商进货排行"
              :subtitle="rangeLabel + ' · 按进货额降序'"
              :data="supplierRanking"
              kind="supplier"
              :limit="5"
              expandable
            />
          </view>
        </view>
        <view v-else class="card thin">
          <text class="thin__t">供应商进货排行暂不展示</text>
          <text class="thin__d">{{ rangeLabel }}只有 {{ supplierRanking.length }} 家供应商有进货（合计
            {{ purchaseSummary.billCount }} 张进货单）。进货录入满 3 家后这里会自动出现。</text>
        </view>

        <!-- 经营提醒 -->
        <view class="card notice">
          <view class="notice__head">
            <Icon name="alert-circle" :size="17" />
            <text>经营提醒</text>
          </view>
          <view v-if="notices.length">
            <view
              v-for="(n, i) in notices" :key="i"
              class="notice__row" @click="openNotice(n)" hover-class="hv-on" :hover-stay-time="80">
              <view class="notice__dot" :class="'notice__dot--' + n.level" />
              <text class="notice__text">{{ n.text }}</text>
              <text v-if="n.action" class="notice__act">{{ n.action }}</text>
            </view>
          </view>
          <text v-else class="notice__empty">暂无经营提醒</text>
        </view>

        <!-- 导出 / 打印 -->
        <view class="card exp">
          <text class="exp__t">带走这份报表</text>
          <text class="exp__d">导出 {{ rangeLabel }}（{{ range.from }} ~ {{ range.to }}）的汇总与排行</text>
          <view class="exp__row">
            <view class="exp__btn" @click="exportOverview" hover-class="hv-on" :hover-stay-time="80"><Icon name="list" :size="16" /><text>导出 CSV</text></view>
            <view class="exp__btn exp__btn--p" @click="go('reconcile')" hover-class="hv-on" :hover-stay-time="80"><Icon name="printer" :size="16" color="white" /><text>往来对账（可导出）</text></view>
          </view>
        </view>
      </view>

      <view class="bottom-gap" />
    </LoadState>
  </view>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { onPullDownRefresh, onUnload, onShow } from '@dcloudio/uni-app'
import { reportApi, receivableApi } from '../../api/index'
import { cancelByScope } from '../../utils/request'
import { fmtMoneyGroup } from '../../utils/format'
import { fillDailyTrend } from '../../utils/adapt'
import { exportCsv } from '../../utils/export'
import Icon from '../../components/Icon.vue'
import LineChart from '../../components/LineChart.vue'
import BarChart from '../../components/BarChart.vue'
import LoadState from '../../components/LoadState.vue'
import AnimatedNumber from '../../components/AnimatedNumber.vue'

/* ============================ 状态 ============================ */
const loading = ref(true)       // 仅首次进入整页 loading
const stamp = ref('—')

/**
 * ★ 模块级状态（2026-09-24 改造）。
 *   旧写法只有 salesSummary 失败会置整页 error，其余 7 个模块失败时
 *   旧值/0 会静默留在屏上 —— 那是「假成功」，比整页报错更糟。
 *   现在每个模块各自记 state/error/at，失败只糊这一块，并给单块重试。
 */
const PERIOD_MODS = ['sales', 'trend', 'customerRank', 'productRank', 'profit', 'purchase', 'supplierRank']
const ALL_MODS = PERIOD_MODS.concat(['receivables'])
const st = reactive({})
ALL_MODS.forEach((k) => { st[k] = { state: 'idle', error: '', at: '' } })

const summary = ref({ totalAmount: 0, billCount: 0, avgBill: 0, totalQty: 0, customerCount: 0, activeDays: 0, gaps: [], previous: null, compare: null })
const trendRaw = ref([])
const ranking = ref([])
const productRanking = ref([])
const supplierRanking = ref([])
const receivables = ref({ total: 0, count: 0, aging: [], agingTotal: 0, agingNote: '', list: [] })
const profit = ref(null)
const purchaseSummary = ref({ totalAmount: 0, billCount: 0, totalQty: 0, supplierCount: 0 })

/* ============================ 期间 ============================ */
const PERIODS = [
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: '30d', label: '近30天' },
  { key: '90d', label: '近90天' },
  { key: 'custom', label: '自定义' },
]
/** 自定义之上的常用快捷键：都是「算好 from/to 后走同一条 range」，不额外加接口 */
const QUICKS = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近7天' },
  { key: 'quarter', label: '本季度' },
  { key: 'year', label: '本年' },
  { key: 'lastYearSame', label: '去年同期' },
]
const period = ref('thisMonth')
const customFrom = ref('')
const customTo = ref('')
const customTouched = ref(false)
const gran = ref('day')
const GRANS = [{ key: 'day', label: '按日' }, { key: 'month', label: '按月' }]

function fmtDate(d) {
  const p = (x) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function todayStr() { return fmtDate(new Date()) }
function hhmm() {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  // ★ 带上日期：报表是 tab 页、切走几小时回来实例还在，只到 HH:MM 会把昨天的数标成"刚刚"
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
function fmtMD(s) { return String(s || '').slice(5).replace('-', '/') }

const range = computed(() => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const first = new Date(y, m, 1)
  switch (period.value) {
    case 'lastMonth': return { from: fmtDate(new Date(y, m - 1, 1)), to: fmtDate(new Date(y, m, 0)) }
    case '30d': return { from: fmtDate(new Date(y, m, now.getDate() - 29)), to: todayStr() }
    case '90d': return { from: fmtDate(new Date(y, m, now.getDate() - 89)), to: todayStr() }
    case '7d': return { from: fmtDate(new Date(y, m, now.getDate() - 6)), to: todayStr() }
    case 'today': return { from: todayStr(), to: todayStr() }
    case 'quarter': return { from: fmtDate(new Date(y, Math.floor(m / 3) * 3, 1)), to: todayStr() }
    case 'year': return { from: fmtDate(new Date(y, 0, 1)), to: todayStr() }
    // 去年同期：去年同月 1 日 ~ 去年同月同日（与「本月至今」等长，才可比）
    case 'lastYearSame': return { from: fmtDate(new Date(y - 1, m, 1)), to: fmtDate(new Date(y - 1, m, now.getDate())) }
    case 'custom': return { from: customFrom.value, to: customTo.value }
    default: return { from: fmtDate(first), to: todayStr() }
  }
})

const rangeLabel = computed(() => {
  const hit = PERIODS.concat(QUICKS).find((p) => p.key === period.value)
  return period.value === 'custom' ? (range.value.from && range.value.to ? range.value.from + ' ~ ' + range.value.to : '自定义') : (hit ? hit.label : '')
})

/** 自定义期间必须两端齐全且顺序正确，否则不发期区间查询（避免静默出「本月」的数） */
const rangeReady = computed(() => {
  if (period.value !== 'custom') return true
  const { from, to } = range.value
  return !!(from && to && from <= to)
})

/* ============================ 派生数据 ============================ */
const trendFilled = computed(() => {
  if (gran.value !== 'day') {
    return trendRaw.value.map((r) => ({ date: r.date || '', value: num(r.amount), bills: num(r.count) }))
  }
  return fillDailyTrend(trendRaw.value, range.value.from, range.value.to)
})
const trendData = computed(() => trendFilled.value.map((d) => ({ label: axisLabel(d.date), value: d.value })))
/** 读数行的附加信息：那天开了几张单（0 单的日子明确写出来，不留白让人猜） */
const trendExtras = computed(() => trendFilled.value.map((d) => (d.bills ? d.bills + ' 张单' : '未开单')))
const trendTotal = computed(() => trendFilled.value.reduce((s, d) => s + d.value, 0))
const trendActiveDays = computed(() => trendFilled.value.filter((d) => d.value > 0).length)
const trendAvg = computed(() => (trendActiveDays.value ? trendTotal.value / trendActiveDays.value : 0))

/** 断档带：后端 gaps（连续无单 ≥3 天）映射到已补零序列的下标 */
const trendBands = computed(() => {
  if (gran.value !== 'day') return []
  const idx = {}
  trendFilled.value.forEach((d, i) => { idx[d.date] = i })
  return (summary.value.gaps || []).reduce((out, g, i) => {
    const from = idx[g.from]
    const to = idx[g.to]
    if (from === undefined || to === undefined) return out
    out.push({ from, to, label: i === 0 ? '无出货 ' + g.days + ' 天' : '' })
    return out
  }, [])
})

function axisLabel(date) {
  const s = String(date || '')
  if (gran.value === 'month') return s.length >= 7 ? s.slice(5) + '月' : s
  return s.length >= 10 ? s.slice(5).replace('-', '/') : s
}

const AGING_COLORS = ['#ffffff', 'rgba(255,255,255,.74)', 'rgba(255,255,255,.5)', '#ffd8c5', 'rgba(255,255,255,.34)']
const aging = computed(() => {
  const total = receivables.value.total || 0
  return (receivables.value.aging || []).map((b, i) => ({
    ...b,
    // 极小段也给 1.2% 宽度，否则画不出来（61-90 天本库只有 0.1%）
    pct: total ? Math.max(1.2, (b.amount / total) * 100) : 0,
    color: AGING_COLORS[i] || 'rgba(255,255,255,.34)',
  }))
})
const agingClosed = computed(() => Math.abs((receivables.value.agingTotal || 0) - (receivables.value.total || 0)) < 0.01)
const bucket90 = computed(() => (receivables.value.aging || []).find((b) => b.key === '90+') || null)
const cust90Top = computed(() => (receivables.value.list || []).find((i) => i.agingKey === '90+') || null)
const customerDelta = computed(() => {
  const c = summary.value.compare
  if (!c || c.customers === undefined || c.customers === null) return null
  const n = Number(c.customers) || 0
  return { k: n >= 0 ? 'delta--up' : 'delta--down', t: (n >= 0 ? '+' : '−') + Math.abs(n) + ' 家' }
})

const notices = computed(() => {
  const out = []
  if (bucket90.value && bucket90.value.amount > 0) {
    const top = cust90Top.value
    out.push({
      level: 'danger', url: '/pages/report/receivable?aging=90+', action: '去催收',
      text: `${bucket90.value.customers} 家客户已超过 90 天没有出货，仍挂应收 ¥${fmtMoneyGroup(bucket90.value.amount)}`
        + (top ? `；最大一家 ${top.customerName} ¥${wan(top.balance)} · ${top.daysSince} 天未动单` : ''),
    })
  }
  if (profit.value && !profit.value.available) {
    out.push({ level: 'warning', url: '', action: '', text: '毛利无法核算：' + profit.value.note })
  }
  const g = (summary.value.gaps || [])[0]
  if (g) {
    out.push({
      level: 'info', url: '/pages/sales/list', tab: true, action: '看流水',
      text: `${rangeLabel.value}有 ${g.days} 天出货断档（${fmtMD(g.from)}~${fmtMD(g.to)}），环比降幅先受断档影响`,
    })
  }
  return out
})

/**
 * 提醒行跳转。
 * ★ 模板里不能直接写 uni.xxx：小程序端模板表达式取不到全局 uni（只有白名单全局对象）。
 * ★ 销售列表是 tabBar 页 —— navigateTo 打不开（H5 直接失败），必须 switchTab。
 */
function openNotice(n) {
  if (!n || !n.url) return
  if (n.tab) uni.switchTab({ url: n.url })
  else uni.navigateTo({ url: n.url })
}

/* ============================ 取数 ============================ */
const LOADERS = {
  sales: async () => {
    const r = await reportApi.salesSummary(range.value)
    if (r.ok) summary.value = r.data
    return r
  },
  trend: async () => {
    const r = await reportApi.salesTrend({ ...range.value, granularity: gran.value })
    if (r.ok) trendRaw.value = Array.isArray(r.data) ? r.data : []
    return r
  },
  customerRank: async () => {
    const r = await reportApi.customerRanking({ ...range.value, limit: 20 })
    if (r.ok) {
      ranking.value = (Array.isArray(r.data) ? r.data : []).map((x) => ({
        id: x.customerId, name: x.customerName, value: num(x.salesAmount), bills: num(x.salesCount),
      }))
    }
    return r
  },
  productRank: async () => {
    const r = await reportApi.productRanking({ ...range.value, limit: 20 })
    if (r.ok) {
      productRanking.value = (Array.isArray(r.data) ? r.data : []).map((x) => ({
        id: x.productId, name: x.productName, value: num(x.salesAmount), qty: num(x.quantity),
      }))
    }
    return r
  },
  profit: async () => {
    const r = await reportApi.profitSummary(range.value)
    if (r.ok) profit.value = r.data
    return r
  },
  purchase: async () => {
    const r = await reportApi.purchaseSummary(range.value)
    if (r.ok) purchaseSummary.value = r.data
    return r
  },
  supplierRank: async () => {
    const r = await reportApi.supplierRanking({ ...range.value, limit: 20 })
    if (r.ok) {
      supplierRanking.value = (Array.isArray(r.data) ? r.data : []).map((x) => ({
        id: x.supplierId, name: x.supplierName, value: num(x.purchaseAmount), bills: num(x.purchaseCount),
      }))
    }
    return r
  },
  receivables: async () => {
    const r = await receivableApi.summary({ pageSize: 300 })
    if (r.ok) receivables.value = r.data
    return r
  },
}

/** 请求代际：每发起一批 +1，回调只在"还是最新这批"时才写状态 */
let curBatch = 0
const cachedNote = ref('')
const cachedAt = ref(0)

async function run(key, my) {
  // ★ 自定义区间没填齐时，任何一条区间类查询都不许发：早先守卫只写在 refreshPeriod 上，
  //   于是「单块重试」和「切按日/按月」会绕过去，api 层的兜底把它算成"本月"——
  //   标签写着自定义、屏上是本月的数。
  if (PERIOD_MODS.indexOf(key) >= 0 && !rangeReady.value) {
    st[key].state = 'error'
    st[key].error = '自定义日期还没填完整，这一块的数没重取'
    return false
  }
  const b = my === undefined ? curBatch : my
  const was = st[key].state
  st[key].state = was === 'ok' ? 'refresh' : 'loading'
  let res
  try {
    res = await LOADERS[key]()
  } catch (e) {
    res = { ok: false, message: (e && e.message) || '请求异常' }
  }
  // ★ 代际：报表一次发 7~8 枪、云端 report 只有 3 位，完成顺序基本随机。
  //   被新一批取代的迟到响应必须丢弃，否则"chip 是近90天、屏上是上月"，
  //   而且一条迟到的失败会把已经刷新好的模块翻成红块。
  if (b !== curBatch) return false
  const ok = !!(res && res.ok)
  if (ok) st[key].staleAt = ''
  else if (was === 'ok' && st[key].at) st[key].staleAt = st[key].at
  st[key].state = ok ? 'ok' : 'error'
  // ★ 失败但旧数据还在屏上时必须点名：LOADERS 只在成功时覆盖 ref，所以红块里显示的
  //   其实是**上一个期间**的数，而顶部"数据截至"是成功块的时间 —— 一屏混着两个期间。
  st[key].error = ok ? '' : (((res && res.message) || '加载失败')
    + (st[key].staleAt ? '；这一块显示的还是 ' + st[key].staleAt + ' 的数，别和上面的时点混着看' : ''))
  if (key === 'receivables') { cachedNote.value = ok && res.offline ? '未结应收那一块读的是缓存' : '' ; cachedAt.value = (res && res.cachedAt) || 0 }
  if (ok) st[key].at = hhmm()
  return ok
}

/**
 * ★ 并发上限对齐云端 report 闸（3 位）：一次发 7~8 枪只会让排在后面的那些
 *   等 8 秒后被拒（AGENT_BUSY），结果就是"半屏红 + 半屏新数"，还得人逐个点重试。
 */
async function runPool(keys, my, size = 3) {
  const q = keys.slice()
  const worker = async () => { while (q.length) await run(q.shift(), my) }
  await Promise.all(Array.from({ length: Math.min(size, q.length) }, worker))
}

function modCls(key) {
  return {
    'mod--refresh': st[key].state === 'refresh',
    'mod--loading': st[key].state === 'loading',
  }
}

async function refreshPeriod() {
  if (!rangeReady.value) return
  curBatch++
  lastFetch = Date.now()
  await runPool(PERIOD_MODS, curBatch)
  touchStamp()
}

function touchStamp() {
  const ok = ALL_MODS.filter((k) => st[k].state === 'ok')
  if (ok.length) stamp.value = ok.map((k) => st[k].at).sort().slice(-1)[0]
}

async function load(withAcct = true) {
  curBatch++
  lastFetch = Date.now()
  if (loading.value) {
    st.receivables.state = 'loading'
    PERIOD_MODS.forEach((k) => { st[k].state = 'loading' })
  }
  const keys = withAcct ? ALL_MODS : PERIOD_MODS.filter(() => rangeReady.value)
  await runPool(keys, curBatch)
  loading.value = false
  touchStamp()
}

/** 整页错误兜底：首屏连销售都取不到，页面没有任何可信数字时才整页报错 */
const fatalError = computed(() =>
  (loading.value || !st.sales.at) && st.sales.state === 'error' ? st.sales.error : ''
)

function setPeriod(key) {
  if (period.value === key) return
  period.value = key
  if (key !== 'custom') refreshPeriod()
  else if (rangeReady.value) refreshPeriod()
}
function onCustomFrom(e) { customFrom.value = e.detail.value; customTouched.value = true; if (rangeReady.value) refreshPeriod() }
function onCustomTo(e) { customTo.value = e.detail.value; customTouched.value = true; if (rangeReady.value) refreshPeriod() }

async function switchGran(key) {
  if (key === gran.value) return
  gran.value = key
  curBatch++
  await run('trend', curBatch)
}

/* ============================ 跳转 / 导出 ============================ */
function go(name) { uni.navigateTo({ url: `/pages/report/${name}` }) }
function goCustomer(item) { if (item && item.id) uni.navigateTo({ url: '/pages/customer/detail?code=' + item.id }) }
function goProduct(item) { if (item && item.id) uni.navigateTo({ url: '/pages/product/detail?id=' + item.id }) }

function exportOverview() {
  // ★ 某块没刷成功时，屏上有红条和「仍是 X 时刻的数」，但导出的文件里没有那个上下文 ——
  //   旧期间的排行会冠着当前期间的标题被人拿走。导出前把旧数块逐个标出来。
  const staleNote = (k) => {
    const s = st[k]
    if (!s || s.state !== 'error' || !s.staleAt) return ''
    return '（这一块没刷出来，是 ' + s.staleAt + ' 上一时点的旧数）'
  }
  const rows = [
    ['期间', `${range.value.from} ~ ${range.value.to}`, rangeLabel.value],
    ['销售汇总', num2(summary.value.totalAmount), `${summary.value.billCount} 张出货单` + staleNote('sales')],
    ['客单价', num2(summary.value.avgBill), ''],
    ['销售数量', num2(summary.value.totalQty), '件'],
    ['活跃客户', summary.value.customerCount, `其中 ${summary.value.activeDays} 天有出货`],
    ['应收账款', num2(receivables.value.total), `${receivables.value.count} 家未结（账面，与期间无关）` + staleNote('receivables')],
    ['毛利', profit.value && profit.value.available ? num2(profit.value.grossProfit) : '成本来源不足·未核算', (profit.value ? profit.value.note : '') + staleNote('profit')],
    [],
    ['客户销售额排行', '', staleNote('customerRank')],
    ...ranking.value.map((r, i) => [i + 1, r.name, num2(r.value), `${r.bills || ''} 张单`]),
    [],
    ['商品销售额排行', '', staleNote('productRank')],
    ...productRanking.value.map((r, i) => [i + 1, r.name, num2(r.value), `${r.qty || ''} 件`]),
  ]
  exportCsv(`经营报表_${range.value.from}_${range.value.to}`, ['项目', '名称/数值', '金额', '说明'], rows)
}

/* ============================ 工具 ============================ */
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function num2(v) { return Number(num(v).toFixed(2)) }
function wan(n) { return (num(n) / 10000).toFixed(2) + '万' }

/**
 * 环比角标。
 * ★ 配色不用红绿：本应用里红=盈利/涨（中式习惯，见毛利卡），
 *   营收环比再用红绿会自相矛盾，改用 蓝=升 / 橙=降。
 * @returns {null|{k:string,t:string}}
 */
function pill(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return null
  const p = (Math.abs(v) * 100).toFixed(1) + '%'
  return v >= 0 ? { k: 'up', t: '↑' + p } : { k: 'down', t: '↓' + p }
}

onMounted(() => load(true))

/**
 * tab 页不销毁 ⇒ 切走半天再回来，屏上还是半天前的数（而"数据截至"看着像刚刚）。
 * 超过 10 分钟就自己重取一次；首帧由 onMounted 负责，别双发。
 */
let lastFetch = 0
let shown = false
onShow(() => {
  if (!shown) { shown = true; return }
  if (Date.now() - lastFetch > 10 * 60 * 1000) load(true)
})
onPullDownRefresh(async () => { await load(true); uni.stopPullDownRefresh() })
onUnload(() => cancelByScope('report'))
</script>

<style lang="scss" scoped>
.report { padding-bottom: 40rpx; }

/* 模块级刷新：只糊这一块，不锁整页 */
.mod { position: relative; transition: opacity .24s ease; }
.mod--refresh { opacity: .55; }
.mod--loading { opacity: .7; }
.mod__err {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  margin-top: -8rpx; padding: 18rpx 24rpx;
  background: $color-danger-bg; border-radius: $radius-card-sm;
  font-size: $fs-caption; color: $color-danger;
}
.mod__retry {
  display: flex; align-items: center; gap: 6rpx; flex: 0 0 auto;
  background: $color-card; border: 1rpx solid $color-border;
  border-radius: $radius-pill; padding: 8rpx 22rpx; font-size: $fs-mini; color: $color-text-2;
}
.mod__cmp { display: block; margin: 10rpx 12rpx 0; font-size: $fs-micro; color: $color-text-4; }
.sk { background: linear-gradient(90deg, rgba(255,255,255,.18), rgba(255,255,255,.32), rgba(255,255,255,.18)); border-radius: 12rpx; }
.sk--l { width: 40%; height: 26rpx; }
.sk--xl { width: 76%; height: 60rpx; margin: 16rpx 0; }
.sk--m { width: 52%; height: 24rpx; }

/* 标题 */
.hello { margin-bottom: $space-gap; display: flex; align-items: flex-start; justify-content: space-between; gap: 16rpx; }
.hello__l { flex: 1; min-width: 0; }
.hello__title { display: block; font-size: $fs-display; font-weight: $fw-heavy; letter-spacing: -1rpx; }
.hello__sub { display: block; font-size: $fs-caption; color: $color-text-3; margin-top: 8rpx; }
.hello__stamp { flex: 0 0 auto; text-align: right; padding-top: 8rpx; }
.hello__stamp-k { display: block; font-size: $fs-micro; color: $color-text-4; }
.hello__stamp-v { display: block; font-family: $font-num; font-size: $fs-mini; color: $color-text-3; margin-top: 4rpx; }

/* ============ 应收账款卡 ============ */
.ar {
  margin: 0; padding: 30rpx 30rpx 8rpx; border-radius: $radius-card;
  background: linear-gradient(135deg, $color-primary 0%, #3d8bff 56%, #6fa8ff 100%);
  box-shadow: $shadow-primary; color: #fff;
}
.ar__l { display: block; font-size: $fs-caption; opacity: .88; }
.ar__v { font-family: $font-num; font-size: 60rpx; font-weight: $fw-heavy; letter-spacing: -1.5rpx; margin-top: 6rpx; }
.ar__n { display: block; font-size: $fs-micro; opacity: .82; margin-top: 8rpx; }
.ar__bar { display: flex; height: 12rpx; border-radius: 8rpx; overflow: hidden; margin: 26rpx 0 4rpx; background: rgba(255,255,255,.22); }
.ar__seg { height: 100%; min-width: 8rpx; }
.ar__grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6rpx; margin-top: 12rpx; }
.ar__c { padding: 12rpx 4rpx 16rpx; }
.ar__c--hot { background: rgba(255,255,255,.16); border-radius: 16rpx; }
.ar__c-k { display: block; font-size: $fs-micro; opacity: .9; }
.ar__c-v { display: block; font-family: $font-num; font-size: 26rpx; font-weight: $fw-heavy; margin-top: 6rpx; }
.ar__c-n { display: block; font-size: $fs-micro; opacity: .8; margin-top: 4rpx; }
.ar__foot {
  display: flex; align-items: center; justify-content: space-between;
  border-top: 1rpx solid rgba(255,255,255,.22); margin-top: 8rpx; padding: 20rpx 2rpx;
  font-size: $fs-caption;
}
.ar__hint { display: block; font-size: $fs-micro; opacity: .74; line-height: 1.6; padding: 0 2rpx 20rpx; }
.ar__errt { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; }
.ar__err { display: block; font-size: $fs-mini; opacity: .85; margin-top: 10rpx; }
.ar__retry {
  display: inline-flex; align-items: center; gap: 6rpx; margin: 18rpx 0 24rpx;
  background: rgba(255,255,255,.2); border-radius: $radius-pill; padding: 10rpx 26rpx; font-size: $fs-mini;
}

/* 入口 */
.entries { display: flex; flex-direction: column; gap: $space-inner; margin-top: $space-gap; }
.entry {
  display: flex; align-items: center; gap: 20rpx;
  background: $color-card; border-radius: $radius-card;
  padding: 26rpx 28rpx; box-shadow: $shadow-card;
}
.entry__icon {
  width: 68rpx; height: 68rpx; border-radius: $radius-icon; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.entry__icon--blue { background: $color-primary-bg; color: $color-primary; }
.entry__icon--violet { background: $color-violet-bg; color: $color-violet; }
.entry__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.entry__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.entry__sub { font-size: $fs-mini; color: $color-text-3; margin-top: 4rpx; }
.entry > :deep(.icon-svg) { color: $color-text-4; flex: 0 0 auto; }

/* 四格 */
.analysis {
  display: grid; grid-template-columns: 1fr 1fr; gap: $space-inner;
  background: $color-card; border-radius: $radius-card;
  padding: $space-inner; box-shadow: $shadow-card;
}
.analysis--2 { margin-top: $space-inner; }
.analysis__cell {
  padding: 22rpx 20rpx; border-radius: $radius-card-sm;
  background: $color-bg; display: flex; flex-direction: column;
}
.analysis__value {
  font-family: $font-num; font-size: $fs-num-lg; font-weight: $fw-heavy;
  color: $color-text; margin: 10rpx 0 6rpx; font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.analysis__unit { font-size: $fs-mini; font-weight: $fw-normal; color: $color-text-3; margin-left: 4rpx; }
.analysis__foot { display: flex; align-items: center; gap: 10rpx; flex-wrap: wrap; }
.delta { font-size: $fs-micro; font-weight: $fw-bold; border-radius: 8rpx; padding: 2rpx 10rpx; }
.delta--up { background: $color-primary-bg; color: $color-primary; }
.delta--down { background: $color-warning-bg; color: $color-warning; }

/* 图表 */
.chart-card { margin-top: $space-gap; padding: 0; overflow: hidden; }
.chart-head { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; padding: 24rpx 24rpx 0; }
.chart-head__t { font-size: $fs-subtitle; font-weight: $fw-bold; }
.chart-head__seg { display: flex; background: $color-bg; border-radius: $radius-pill; padding: 4rpx; }
/* ★ 点名要过渡的属性，不用 `all`：这一格换选中态时会连 font-weight 一起变，
     `all` 会把宽度和排版也拖进补间 ⇒ 换粒度时整条分段控件抖一下。 */
.chart-head__tab { font-size: $fs-mini; color: $color-text-3; padding: 8rpx 22rpx; border-radius: $radius-pill; transition: background-color $dur-fast $ease-out, color $dur-fast $ease-out, box-shadow $dur-fast $ease-out; }
.chart-head__tab--on { background: $color-card; color: $color-primary; font-weight: $fw-bold; box-shadow: $shadow-card; }
.chart__stats { display: flex; gap: 24rpx; padding: 4rpx 28rpx 24rpx; }
.chart__stat { font-size: $fs-micro; color: $color-text-3; font-variant-numeric: tabular-nums; }

/* 期间 */
.period { display: flex; flex-wrap: wrap; gap: 14rpx; margin-bottom: $space-inner; }
.period--sub { margin-bottom: $space-gap; }
.period__chip {
  font-size: $fs-caption; color: $color-text-2;
  background: $color-card; border-radius: $radius-pill;
  padding: 10rpx 26rpx; box-shadow: $shadow-card;
  transition: background-color $dur-fast $ease-out, color $dur-fast $ease-out;
}
.period__chip--sm { font-size: $fs-mini; padding: 8rpx 22rpx; color: $color-text-3; }
.period__chip--on { background: $color-primary; color: #fff; font-weight: $fw-bold; }
.period-custom { display: flex; align-items: center; gap: 16rpx; margin-bottom: 12rpx; }
.date-box {
  background: $color-card; border-radius: $radius-input;
  padding: 12rpx 22rpx; font-size: $fs-caption; color: $color-text; box-shadow: $shadow-card;
}
.date-box--err { border: 2rpx solid $color-danger; color: $color-danger; }
.date-sep { font-size: $fs-caption; color: $color-text-3; }
.period-tip {
  display: block; margin-bottom: $space-gap; padding: 18rpx 22rpx;
  background: $color-danger-bg; border-radius: $radius-card-sm;
  font-size: $fs-mini; color: $color-danger; line-height: 1.6;
}

/* 断档提示 */
.warnbar {
  display: flex; align-items: flex-start; gap: 12rpx;
  margin-top: $space-inner; padding: 20rpx 24rpx;
  background: $color-warning-bg; border-radius: $radius-card-sm;
}
.warnbar__x { flex: 1; font-size: $fs-mini; color: $color-warning-text; line-height: 1.6; }

/* 毛利 */
.profit { margin-top: $space-gap; padding: 30rpx 28rpx; }
.profit--off { border: 2rpx dashed $color-border; background: #fbfcfd; box-shadow: none; }
.profit__head { display: flex; align-items: baseline; justify-content: space-between; gap: 16rpx; }
.profit__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.profit__sub { font-size: $fs-mini; color: $color-text-3; }
.profit__off { font-size: $fs-micro; color: $color-text-3; background: $color-bg-sunken; border-radius: 8rpx; padding: 4rpx 12rpx; }
.profit__big { display: block; font-size: 44rpx; font-weight: $fw-heavy; color: $color-text-3; margin-top: 12rpx; }
.profit__why { display: block; font-size: $fs-mini; color: $color-text-2; line-height: 1.7; margin-top: 12rpx; }
.profit__src { margin-top: 16rpx; padding: 18rpx 20rpx; background: $color-bg; border-radius: $radius-card-sm; }
.profit__srcr { display: block; font-size: $fs-mini; color: $color-text-2; line-height: 2; font-variant-numeric: tabular-nums; }
.profit__act { display: block; font-size: $fs-micro; color: $color-text-4; margin-top: 14rpx; }
.profit__main { display: flex; align-items: baseline; gap: 16rpx; margin-top: 18rpx; }
.profit__value { font-family: $font-num; font-size: 52rpx; font-weight: $fw-heavy; letter-spacing: -1rpx; font-variant-numeric: tabular-nums; }
.profit__value.up { color: $color-danger; }      /* 中式习惯：盈利/涨为红 */
.profit__value.down { color: $color-success; }   /* 亏损/跌为绿 */
.profit__margin { font-size: $fs-caption; color: $color-text-3; font-weight: $fw-bold; }
.profit__grid { display: flex; gap: $space-inner; margin-top: 20rpx; }
.profit__cell { flex: 1; background: $color-bg; border-radius: $radius-card-sm; padding: 20rpx; display: flex; flex-direction: column; gap: 8rpx; }
.profit__num { font-family: $font-num; font-size: 30rpx; font-weight: $fw-bold; font-variant-numeric: tabular-nums; }

/* 薄卡（采购排行未达门槛） */
.thin { margin-top: $space-gap; padding: 26rpx 28rpx; }
.thin__t { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; color: $color-text-2; }
.thin__d { display: block; font-size: $fs-mini; color: $color-text-3; line-height: 1.7; margin-top: 10rpx; }

/* 提醒 */
.notice { margin-top: $space-gap; padding: 26rpx 28rpx; }
.notice__head { display: flex; align-items: center; gap: 10rpx; font-size: $fs-subtitle; font-weight: $fw-bold; margin-bottom: 8rpx; }
.notice__row { display: flex; align-items: flex-start; gap: 14rpx; padding: 14rpx 0; border-bottom: 1rpx solid $color-divider; }
.notice__row:last-child { border-bottom: 0; }
.notice__dot { width: 12rpx; height: 12rpx; border-radius: 50%; flex: 0 0 auto; margin-top: 14rpx; }
.notice__dot--danger { background: $color-danger; }
.notice__dot--warning { background: $color-warning; }
.notice__dot--info { background: $color-primary; }
.notice__text { flex: 1; min-width: 0; font-size: $fs-caption; color: $color-text-2; line-height: 1.6; }
.notice__act { flex: 0 0 auto; font-size: $fs-mini; color: $color-primary; margin-top: 4rpx; }
.notice__empty { font-size: $fs-caption; color: $color-text-4; }

/* 导出 */
.exp { margin-top: $space-gap; padding: 26rpx 28rpx; }
.exp__t { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; }
.exp__d { display: block; font-size: $fs-mini; color: $color-text-3; margin-top: 8rpx; }
.exp__row { display: flex; gap: 16rpx; margin-top: 20rpx; }
.exp__btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 8rpx;
  height: 84rpx; border-radius: $radius-btn; border: 1rpx solid $color-border;
  font-size: $fs-body; color: $color-text-2;
}
.exp__btn--p { background: $color-primary; color: #fff; border-color: $color-primary; font-weight: $fw-bold; }

.section-head { display: flex; align-items: baseline; justify-content: space-between; padding: 30rpx 12rpx 16rpx; }
.section-head__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.section-head__action { font-size: $fs-mini; color: $color-text-3; }
.section-head--mt { margin-top: $space-gap; }
.metric-label { font-size: $fs-mini; color: $color-text-3; }
.metric-note { font-size: $fs-micro; color: $color-text-4; }
.bottom-gap { height: 40rpx; }
</style>
