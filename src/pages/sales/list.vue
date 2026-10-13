<template>
  <view class="page-flush page-flush--fixed list-page">
    <!-- 搜索栏 + 漏斗：日期区间/客户这类"两个值 + 一排快捷档"塞不进横滚的筛选条，
         点漏斗从底部弹半页（见 components/FilterSheet.vue） -->
    <view class="search-bar search-bar--sticky">
      <view class="search-line">
        <view class="search-input">
          <Icon name="search" :size="18" color="text-3" />
          <input
            v-model="keyword" confirm-type="search"
            placeholder="搜索单号、客户名称" placeholder-class="search-input__placeholder"
            @input="onInput" @confirm="reload"
          />
          <view v-if="keyword" class="search-clear" @click="clearKeyword" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="x" :size="15" color="text-2" />
          </view>
        </view>
        <view class="search-fan" :class="{ 'search-fan--on': activeCount }" @click="sheet = true" hover-class="hv-on" :hover-stay-time="80">
          <!-- 两个静态配色各写一个节点：图标表是按"名|色"预生成的，
               动态 :color 表达式生成器认不出来 ⇒ 线上只会有一档有图。 -->
          <Icon v-if="activeCount" name="filter" :size="18" color="white" />
          <Icon v-else name="filter" :size="18" color="text-3" />
          <text v-if="activeCount" class="search-fan__n">{{ activeCount }}</text>
        </view>
      </view>
    </view>

    <!-- 筛选 -->
    <view class="filter-row filter-row--sticky filter-row--tight">
      <!-- 选中的白胶囊是一颗、滑过去的，不是每格各自亮起来（样式见 App.vue 的 .seg-pill） -->
      <view class="seg-pill" :style="{ transform: 'translateX(' + segIndex * 100 + '%)' }" />
      <view
        v-for="t in tabs" :key="t.value"
        class="filter-chip" :class="[
          { 'filter-chip--active': status === t.value },
          t.draft ? 'filter-chip--draft' : '',
          t.draft && status === t.value ? 'filter-chip--draft-on' : '',
        ]"
        @click="switchTab(t.value)" hover-class="hv-on" :hover-stay-time="80">
        {{ t.label }}
        <!-- 角标只挂在草稿那一格：人要知道"箱底还压着几张没交的单"，其他格的数量服务端才给得出 -->
        <text v-if="t.draft && draftCount" class="filter-chip__badge">{{ draftCount }}</text>
      </view>
    </view>

    <!-- 已生效的条件（活值一行一个，各自能单独清）：
         来源有两条 —— 半页里选的、客户档案「查看全部」经 storage 带过来的，都汇到同一处显示。 -->
    <view v-if="activeCount" class="cond-row">
      <view v-if="range.from || range.to" class="cond-chip" @click="sheet = true" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="calendar" :size="14" />
        <text class="cond-chip__t ellipsis">{{ rangeText }}</text>
        <view class="cond-chip__x" @click.stop="clearRange"><Icon name="x" :size="13" /></view>
      </view>
      <view v-if="customerFilter" class="cond-chip" @click="sheet = true" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="user" :size="14" />
        <text class="cond-chip__t ellipsis">{{ customerFilter.name || customerFilter.code }}</text>
        <!-- 这条筛选可能是"选完之后才被停用的那位客户" ⇒ 筛出来那几单要看得出现在筛的是个停用客户 -->
        <StopTag kind="customer" :code="customerFilter.code || customerFilter.id" />
        <view class="cond-chip__x" @click.stop="clearCustomer"><Icon name="x" :size="13" /></view>
      </view>
    </view>

    <LoadState :loading="loading && page === 1" :error="error" :offline="offline" :cached-at="cachedAt" skeleton @retry="reload">
      <!-- 草稿箱顶部一句汇总：把"箱底压了多少、最快什么时候开始没了"摊开说，
           比只在首页待办里挂一条"N 张将过期"更靠近人能处理的地方。 -->
      <view v-if="isDraftTab && rows.length" class="draft-sum">
        <text class="draft-sum__t">共 {{ rows.length }} 条{{ activeCount ? '（已按筛选）' : '' }}{{ soonestText }}</text>
      </view>
      <view v-if="rows.length" class="list">
        <!-- ★ 套一层 view 而不是把 enter-row 直接绑到 <BillRow> 上：
             小程序端的自定义组件节点接 class 是能命中，但样式作用域容易出意外，
             垫一层普通 view 是确定的（.list 的 gap 与行高都不变）。 -->
        <view v-for="(b, i) in rows" :key="b.id" :class="[enterClass(i), { 'row-leave': leavingId === b.id }]" :style="enterStyle(i)">
          <BillRow
            :bill="b" :note="b.draftNote || ''" :actions="b.actions || []"
            @select="onRow(b)" @action="(k) => onDraftAction(b, k)"
          />
        </view>
      </view>
      <EmptyState
        v-else-if="!loading && !error"
        icon="file-text"
        :text="emptyText"
        :sub="emptySub"
      />
      <!-- 草稿是本地的，一次全给，没有"加载更多"这回事 -->
      <view v-if="!isDraftTab && hasMore && rows.length" class="load-more" @click="loadMore" hover-class="hv-on" :hover-stay-time="80">
        <text>{{ loading ? '加载中...' : '加载更多' }}</text>
        <Icon v-if="!loading" name="chevron-down" :size="14" color="primary" />
      </view>
      <view v-else-if="!isDraftTab && rows.length" class="no-more"><text>没有更多了</text></view>
      <view class="bottom-gap bottom-gap--fab" />
    </LoadState>

    <!-- 新建 -->
    <view class="fab" @click="goCreate" hover-class="hv-on" :hover-stay-time="80">
      <Icon name="plus" :size="26" color="white" />
    </view>

    <FilterSheet
      :show="sheet" kind="sales"
      :from="range.from" :to="range.to" :partner="customerFilter"
      @close="sheet = false" @apply="onApply"
    />
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { salesApi } from '../../api/salesBill'
import { config } from '../../utils/config'
import { listDrafts, removeDraft, upgradeOfflineDraft, extendDraft, draftStampText, draftNote } from '../../utils/draftBox'
import { takeBillWritten } from '../../utils/billWrites'
import { takeJumpFlag } from '../../utils/listJump'
import { calcTotal } from '../../utils/billState'
import Icon from '../../components/Icon.vue'
import BillRow from '../../components/BillRow.vue'
import StopTag from '../../components/StopTag.vue'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import FilterSheet from '../../components/FilterSheet.vue'
import { fmtDate, debounce } from '../../utils/format'
import { useEnterStagger } from '../../utils/enterStagger'
import { useRowLeave } from '../../utils/leaveRow'

/** 首屏前 8 行错峰到位；翻页/刷新/切档不重播（见 utils/enterStagger.js） */
const { armEnter, enterClass, enterStyle } = useEnterStagger()
/** 删草稿前先让那行"走掉"（见 utils/leaveRow.js） */
const { leavingId, leaveThen } = useRowLeave()

const keyword = ref('')
const status = ref('')
const list = ref([])
const drafts = ref([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const error = ref('')
/** 断网时列表回的是缓存 ⇒ 必须标出来，否则"看着是今天的单"其实是上次的快照 */
const offline = ref(false)
const cachedAt = ref(0)
// ★ 客户档案「查看全部」带来的客户筛选（switchTab 不能带参，经 storage 中转）
const customerFilter = ref(null)
/* ===== 半页筛选（日期区间 + 客户）===== */
const sheet = ref(false)
const range = ref({ from: '', to: '' })
const activeCount = computed(() =>
  ((range.value.from || range.value.to) ? 1 : 0) + (customerFilter.value ? 1 : 0))
/** 条件行上的活值：同一天只写一个日期，别显示「10-02 ~ 10-02」那种废话 */
const rangeText = computed(() => {
  const f = range.value.from, t = range.value.to
  if (f && t) return f === t ? f : f + ' ~ ' + t
  if (f) return f + ' 起'
  return '截至 ' + t
})
function onApply(p) {
  range.value = { from: p.from || '', to: p.to || '' }
  customerFilter.value = p.partner || null
  sheet.value = false
  reload()
}
function clearRange() { range.value = { from: '', to: '' }; reload() }
/**
 * 草稿的日期条件按**单据日期**判，不是按"存下的那一刻"（与采购页同一条口径）。
 * ★ 用 stamp 会造出"同一句上月、两个格两套数"：上月存的、单据日期写上月 28 号的那张
 *   在「上月」不出现、反倒出现在「本月」，清点待提交就漏。取不到才退回 stamp。
 */
function draftDateStr(d) {
  const s = String((d.form && d.form.billDate) || (d.payload && d.payload.ndate) || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fmtDate(new Date(d.stamp))
}
function inDraftRange(d) {
  const f = range.value.from, t = range.value.to
  if (!f && !t) return true
  const s = draftDateStr(d)
  if (f && s < f) return false
  if (t && s > t) return false
  return true
}

const tabs = [
  { label: '全部', value: '' },
  { label: '未审核', value: 'unapproved' },
  { label: '已审核', value: 'approved' },
  { label: '已作废', value: 'void' },
  // ★ 草稿：纯前端筛选词，服务端没有这个 state（草稿根本还没落库），见 utils/billState.js
  { label: '草稿', value: 'draft', draft: true },
]
const isDraftTab = computed(() => status.value === 'draft')
/** 滑动胶囊停在第几格（样式与"为什么用百分比而不是量 DOM"见 App.vue 的 .seg-pill） */
const segIndex = computed(() => {
  const i = tabs.findIndex((t) => t.value === status.value)
  return i < 0 ? 0 : i
})
const draftCount = computed(() => drafts.value.length)
/** 汇总句里的到期部分：>10 天不占地方，已到期的必须单独说出来（那是"再不处理就没了"） */
const soonestText = computed(() => {
  const rs = rows.value
  if (!rs.length) return ''
  const days = Math.min.apply(null, rs.map((r) => r.remain))
  if (days <= 0) return ' · 有 ' + rs.filter((r) => r.remain <= 0).length + ' 条已到期待清'
  if (days > 10) return ''
  return ' · 最快 ' + days + ' 天后开始过期'
})
/**
 * 「还有没有下一页」优先信后端给的 hasMore。
 * ★ 只按 `list.length < total` 推的话，遇到不带 total 的形状（老 Agent / 离线缓存那份旧数据）
 *   total 会退化成"本页条数"，于是几千张单被显示成"共 20 张 · 没有更多了"，翻页入口当场消失。
 */
const serverMore = ref(null)
const hasMore = computed(() => (serverMore.value === null
  ? list.value.length < total.value : serverMore.value))

/* ===== 草稿行 → 列表行 ===== */
/** 草稿里的明细（手动=表单形状；断网=提交 payload，两种键名不一样） */
function draftLines(d) {
  if (d.form) return d.form.items || []
  return ((d.payload || {}).lines) || []
}
function draftCustomerCode(d) {
  if (d.form) return d.form.customerId || ''
  const p = d.payload || {}
  return p.customer || (p.header || {}).ItemBh || ''
}
function draftCustomerLabel(d) {
  if (d.form) return d.form.customerName || d.form.customerId || ''
  return draftCustomerCode(d)
}
function toRow(d) {
  const items = draftLines(d)
  const t = calcTotal(items)
  const when = draftStampText(d.stamp)
  return {
    id: d.id,
    origin: d.origin,
    // 单号位没有单号可写，写的就是"它是什么、什么时候留下的"。
    // 「自动存于」= 退出开单那一刻系统替你留的（小程序/网页后退问不了），与人点的「存草稿」分开写。
    billNo: (d.origin !== 'manual' ? '断网待上传 · '
      : (d.auto ? '草稿 · 自动存于 ' : '草稿 · 存于 ')) + when,
    status: 'draft',
    customerName: draftCustomerLabel(d),
    // BillRow 上的停用标签按编号查表，草稿行不带上 code 就永远标不出来
    customerCode: draftCustomerCode(d),
    billDate: when,
    items, totalQty: t.totalQty, totalAmount: t.totalAmount,
    // ★ 2026-10-10：草稿行显式带 lineCount（与采购页同口径）。
    //   BillRow 本来也能从 items.length 兜出来，这里显式写是**双保险**，
    //   免得将来有人把 items 从行对象里摘掉时「N 种」悄无声息消失。
    lineCount: items.length,
    // 剩 N 天只在真的快到期时才占地方（>10 天不显示）
    draftNote: draftNote(d),
    remain: d.remainingDays,
    // ★ 2026-10-02 改了口径（用户点头）：手动草稿行上给「留下 / 删除」。
    //   以前是"进编辑页里再删"，但清一批草稿要 点开→删除→返回 三步，没人真去清；
    //   而"快过期"只提醒不处理 = 把人逼到重开一张再存一遍（还会把「存于」刷成新时间）。
    //   断网草稿是"已经决定要提交"的东西，只能上传或删除，不给编辑。
    actions: d.origin === 'manual'
      ? [{ key: 'keep', label: '留下' }, { key: 'remove', label: '删除', danger: true }]
      : [{ key: 'upload', label: '上传' }, { key: 'remove', label: '删除', danger: true }],
  }
}

const rows = computed(() => {
  if (!isDraftTab.value) return list.value
  const kw = keyword.value.trim().toLowerCase()
  const cust = customerFilter.value && customerFilter.value.code
  return drafts.value
    .filter((d) => {
      if (!inDraftRange(d)) return false
      if (cust && draftCustomerCode(d) !== cust) return false
      if (!kw) return true
      const hay = [draftCustomerLabel(d), (d.form && d.form.memo) || '',
        ...draftLines(d).map((it) => it.name || it.hpbh || '')].join(' ').toLowerCase()
      return hay.indexOf(kw) >= 0
    })
    .map(toRow)
})
const emptyText = computed(() => {
  if (isDraftTab.value) return activeCount.value ? '这个条件下没有草稿' : '没有草稿'
  if (activeCount.value) return '这个条件下没有单据'
  return keyword.value ? '没有匹配的销售单' : '暂无销售单'
})
const emptySub = computed(() => {
  if (activeCount.value) {
    // 把挡着人的条件原样说出来 —— 只写"没有数据"会让人以为单子丢了
    const bits = []
    if (range.value.from || range.value.to) bits.push(rangeText.value)
    if (customerFilter.value) bits.push(customerFilter.value.name || customerFilter.value.code)
    return '当前只看在 · ' + bits.join(' · ') + '，去掉一个再试试'
  }
  if (isDraftTab.value) return '开单页点『存草稿』即可保留未完成单据'
  return keyword.value ? '换个关键词试试' : '点击右下角新建第一张单据'
})

function refreshDrafts() { drafts.value = listDrafts('sales') }

// ★ 请求代际：搜索/切 tab 时前一次请求可能还在飞，
//   没有这个守卫就会「后到的旧响应」把新结果覆盖掉（表现为搜了没反应）。
let seq = 0

function switchTab(v) {
  if (status.value === v) return
  status.value = v
  error.value = ''
  // 草稿那一格**不发网络请求**：读的是本地桶，切过去就该立刻是准的
  if (v === 'draft') { refreshDrafts(); return }
  reload()
}
function clearKeyword() { keyword.value = ''; reload() }
function clearCustomer() { customerFilter.value = null; reload() }

/**
 * ★ 打字即搜（350ms 防抖），与客户/商品/供应商/库存四页同一套手感（2026-10-07 统一）。
 *   改造前这里只认 `@confirm`（回车）⇒ 打了字不回车列表纹丝不动，是「搜了没反应」的常见误报来源。
 *   `@confirm` 保留：回车仍要**立刻**发，不用等这 350ms。
 *   ★ 安全性由 `fetch()` 里的 `seq` 代际守卫兜住（上面那行注释就是为它写的）：
 *     防抖只是把请求推后合并，晚到的旧响应照旧会被丢弃。
 */
const onInput = debounce(reload, 350)

async function reload() {
  page.value = 1; list.value = []
  if (isDraftTab.value) { refreshDrafts(); return }
  await fetch()
}
async function loadMore() {
  if (isDraftTab.value) return
  if (loading.value || !hasMore.value) return
  page.value++; await fetch()
}
async function fetch() {
  if (isDraftTab.value) return
  const my = ++seq
  loading.value = true; error.value = ''
  const res = await salesApi.list({
    keyword: keyword.value, status: status.value,
    customer: customerFilter.value?.code || undefined,
    // ★ 日期区间：api 层已把 from/to 映射成 Agent 认的 date_from/date_to（含当天）
    from: range.value.from || undefined, to: range.value.to || undefined,
    page: page.value, pageSize: config.PAGE_SIZE,
  })
  if (my !== seq) return          // 已被更新的请求取代，丢弃这次响应
  loading.value = false
  if (res.ok) {
    const rows2 = res.data.list || []
    list.value = page.value === 1 ? rows2 : [...list.value, ...rows2]
    total.value = res.data.total ?? rows2.length
    serverMore.value = res.data.hasMore === undefined ? null : !!res.data.hasMore
    if (page.value === 1) { offline.value = !!res.offline; cachedAt.value = res.cachedAt || 0; armEnter() }
  } else if (page.value > 1) {
    // ★ 只是第 N 页没拿到 ⇒ 不许把已经加载的整屏换成错误页（十几页的翻页深度会一起丢，
    //   重试又退回第 1 页）。页码退回去，已加载的留着，只说一句这一页没拿到。
    page.value--
    uni.showToast({ title: res.message || '这一页没拿到，上面已加载的还在', icon: 'none' })
  } else {
    error.value = res.message
  }
}

function goDetail(id) { uni.navigateTo({ url: '/pages/sales/detail?id=' + id }) }
function goCreate() { uni.navigateTo({ url: '/pages/sales/edit?mode=create' }) }

function onRow(b) {
  if (!isDraftTab.value) { goDetail(b.id); return }
  if (b.origin === 'manual') {
    uni.navigateTo({ url: '/pages/sales/edit?mode=draft&draftId=' + encodeURIComponent(b.id) })
    return
  }
  // 断网草稿已经是"提交意图"，点进去编辑会造出第二份数据 ⇒ 只给摘要 + 上传
  const d = drafts.value.find((x) => x.id === b.id)
  uni.showModal({
    title: '断网时留下的待上传单',
    content: '客户：' + (b.customerName || '—') + '\n明细 ' + b.items.length + ' 行 · 合计 ¥'
      + Number(b.totalAmount || 0).toFixed(2) + '\n存于 ' + b.billDate
      + (d ? '，' + (d.origin === 'offline' ? '联网后会自动上传' : '') : ''),
    confirmText: '立即上传',
    cancelText: '关闭',
    success: (r) => { if (r.confirm) onDraftAction(b, 'upload') },
  })
}

/** 行尾动作：留下（续期）/ 上传 / 删除 */
async function onDraftAction(b, key) {
  if (key === 'keep') {
    const until = extendDraft(b.id)
    refreshDrafts()
    const d = new Date(until)
    uni.showToast({
      title: until ? '这张留到 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日' : '这条草稿已经不在了',
      icon: 'none',
    })
    return
  }
  if (key === 'remove') {
    uni.showModal({
      title: '删除这条草稿',
      content: '删掉之后本机不再保留，未提交的明细会一起没了。',
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (r) => {
        if (!r.confirm) return
        // ★ 先让那行走掉（260ms）再真删，toast 放在删完之后 ——
        //   顺序反了会出现"提示已删除、行还在那儿"。
        leaveThen(b.id, () => {
          removeDraft(b.id)
          refreshDrafts()
          uni.showToast({ title: '已删除', icon: 'success' })
        })
      },
    })
    return
  }
  if (key !== 'upload') return
  uni.showLoading({ title: '上传中', mask: true })
  const r = await upgradeOfflineDraft(b.id)
  uni.hideLoading()
  refreshDrafts()
  if (r.ok) {
    // 刚传上去的那张单要能在「全部」里看见
    markDirty()
    uni.showToast({ title: '已上传', icon: 'success' })
  } else {
    uni.showToast({ title: r.message || '上传失败', icon: 'none' })
  }
}
/** 本地刚重放了一张单 ⇒ 让服务端列表下次进页面时刷一次 */
function markDirty() {
  if (isDraftTab.value) { list.value = []; page.value = 1 }
  else reload()
}

onMounted(() => { refreshDrafts(); reload() })
let entered = false
onShow(() => {
  refreshDrafts()
  // ★ 首次进入由 onMounted 负责；此后**只有真的写过单**才整页 reload ——
  //   以前每次返回都刷，"点开详情看一眼"回来就跳回第一页、翻页位置没了（P1-4）。
  const dirty = takeBillWritten('sales')
  if (!entered) { entered = true }
  else if (!isDraftTab.value && dirty) reload()
  // ★ 首页「待审核 N 笔」跳转：通过 storage 中转，进页自动切「未审核」tab
  if (takeJumpFlag('sales_list_pending')) {
    if (status.value !== 'unapproved') switchTab('unapproved')
  }
  // ★ 首页「N 张草稿将过期」跳转：同样经 storage 中转，进页自动切「草稿」tab
  if (takeJumpFlag('sales_list_drafts')) {
    if (status.value !== 'draft') switchTab('draft')
  }
  // ★ 客户档案「查看全部」跳转：带入该客户的筛选（读一次即清，返回本页不重复触发）
  const pick = takeJumpFlag('sales_list_customer')
  if (pick && pick.code) {
    if (customerFilter.value?.code !== pick.code) {
      customerFilter.value = pick
      reload()
    }
  }
})
onPullDownRefresh(async () => { await reload(); uni.stopPullDownRefresh() })
onReachBottom(loadMore)
</script>

<style lang="scss" scoped>
.list-page { padding-bottom: 40rpx; }

/* 草稿箱顶部汇总：小灰字一行，不抢列表的地方 */
.draft-sum { padding: 20rpx $space-page 0; }
.draft-sum__t { font-size: $fs-mini; color: $color-text-3; }

/* 草稿那一格：分段控件里不再用绿色虚线框（和整条轨道打架），只把文字染绿做提示
   （它筛的是本机没提交的东西）；选中后 = 白胶囊 + 绿色加粗字。
   ★ 白胶囊那颗现在是全局那个滑动的 .seg-pill，这里**只改字色**——
     再自己画一层白底，切换瞬间会和滑过来的胶囊重影。 */
.filter-chip--draft {
  position: relative;
  color: $color-success;
}
.filter-chip--draft-on {
  color: $color-success;
  font-weight: $fw-bold;
}
/* 数量角标：橙色而不是红色 —— 草稿不是错误，是"还没办完的事" */
.filter-chip__badge {
  position: absolute; top: -6rpx; right: -6rpx;
  min-width: 32rpx; height: 32rpx; padding: 0 8rpx;
  border-radius: $radius-pill;
  background: $color-warning; color: #fff;
  font-family: $font-num; font-size: $fs-micro; line-height: 32rpx; text-align: center;
}

/* 漏斗按钮与条件行的样式在全局 App.vue 里（销售/采购两页共用一份，不各写一遍） */

</style>
