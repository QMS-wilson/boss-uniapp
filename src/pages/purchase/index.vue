<template>
  <view class="page-flush page-flush--fixed list-page">
    <!-- 搜索栏 + 漏斗：与销售列表同一套（半页里装日期区间与供应商，见 components/FilterSheet.vue） -->
    <view class="search-bar search-bar--sticky">
      <view class="search-line">
        <view class="search-input">
          <Icon name="search" :size="18" color="text-3" />
          <input
            v-model="keyword" confirm-type="search"
            placeholder="搜索采购单号、供应商" placeholder-class="search-input__placeholder"
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
      <!-- 选中的白胶囊是一颗、滑过去的（样式与"为什么用百分比"见 App.vue 的 .seg-pill）。
           与销售列表同一套，两页切换手感必须一样。 -->
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
        <text v-if="t.draft && draftCount" class="filter-chip__badge">{{ draftCount }}</text>
      </view>
    </view>

    <!-- 已生效的条件：一格一个，各自能单独清 -->
    <view v-if="activeCount" class="cond-row">
      <view v-if="range.from || range.to" class="cond-chip" @click="sheet = true" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="calendar" :size="14" />
        <text class="cond-chip__t ellipsis">{{ rangeText }}</text>
        <view class="cond-chip__x" @click.stop="clearRange"><Icon name="x" :size="13" /></view>
      </view>
      <view v-if="partner" class="cond-chip" @click="sheet = true" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="truck" :size="14" />
        <text class="cond-chip__t ellipsis">{{ partner.name || partner.code }}</text>
        <StopTag kind="supplier" :code="partner.code || partner.id" />
        <view class="cond-chip__x" @click.stop="clearPartner"><Icon name="x" :size="13" /></view>
      </view>
    </view>

    <LoadState :loading="loading && page === 1" :error="error" :offline="offline" :cached-at="cachedAt" skeleton @retry="reload">
      <view v-if="isDraftTab && rows.length" class="draft-sum">
        <text class="draft-sum__t">共 {{ rows.length }} 条{{ activeCount ? '（已按筛选）' : '' }}{{ soonestText }}</text>
      </view>
      <view v-if="rows.length" class="list">
        <!-- ★ 与销售列表**同一个组件**（2026-10-10，UI 体检 03 板）：改造前这里内联了一套 .po-card，
             四行、154~177px，比销售的 124px 高出一截，两页还分叉出 12 处不同（日期色、对齐、状态标签…）。
             现在只差三个入参：名字取 supplier*、停用标签查 supplier、空名提示换个说法。
             垫一层普通 view 绑错峰/离场类，理由同销售页（小程序端组件根节点接 class 不稳）。 -->
        <view v-for="(p, i) in rows" :key="p.id" :class="[enterClass(i), { 'row-leave': leavingId === p.id }]" :style="enterStyle(i)">
          <BillRow
            :bill="p" :name="p.supplierName" :stop-code="p.supplierCode || ''"
            kind="supplier" empty-name="（未指定供应商）"
            :note="rowNote(p)" :actions="p.actions || []"
            @select="onRow(p)" @action="(k) => onDraftAction(p, k)"
          />
        </view>
      </view>
      <EmptyState
        v-else-if="!loading && !error"
        icon="truck"
        :text="emptyText" :sub="emptySub"
      />
      <view v-if="!isDraftTab && hasMore && rows.length" class="load-more" @click="loadMore" hover-class="hv-on" :hover-stay-time="80">
        <text>{{ loading ? '加载中...' : '加载更多' }}</text>
        <Icon v-if="!loading" name="chevron-down" :size="14" color="primary" />
      </view>
      <view v-else-if="!isDraftTab && rows.length" class="no-more"><text>没有更多了</text></view>
      <view class="bottom-gap bottom-gap--fab" />
    </LoadState>

    <view class="fab" @click="goCreate" hover-class="hv-on" :hover-stay-time="80">
      <Icon name="plus" :size="26" color="white" />
    </view>

    <FilterSheet
      :show="sheet" kind="purchase"
      :from="range.from" :to="range.to" :partner="partner"
      @close="sheet = false" @apply="onApply"
    />
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { purchaseApi } from '../../api/index'
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
/** 断网时列表回的是缓存 ⇒ 必须标出来（sales/list 同款），否则旧数看着像实时 */
const offline = ref(false)
const cachedAt = ref(0)

/* ===== 半页筛选（日期区间 + 供应商），与销售列表同一套 ===== */
const sheet = ref(false)
const range = ref({ from: '', to: '' })
const partner = ref(null)
const activeCount = computed(() =>
  ((range.value.from || range.value.to) ? 1 : 0) + (partner.value ? 1 : 0))
const rangeText = computed(() => {
  const f = range.value.from, t = range.value.to
  if (f && t) return f === t ? f : f + ' ~ ' + t
  if (f) return f + ' 起'
  return '截至 ' + t
})
const emptyText = computed(() => {
  if (isDraftTab.value) return activeCount.value ? '这个条件下没有草稿' : '没有草稿'
  if (activeCount.value) return '这个条件下没有采购单'
  return keyword.value || status.value ? '没有匹配的采购单' : '暂无采购单'
})
const emptySub = computed(() => {
  if (activeCount.value) {
    const bits = []
    if (range.value.from || range.value.to) bits.push(rangeText.value)
    if (partner.value) bits.push(partner.value.name || partner.value.code)
    return '当前只看在 · ' + bits.join(' · ') + '，去掉一个再试试'
  }
  if (isDraftTab.value) return '开单页点『存草稿』即可保留未完成单据'
  return '采购单在财鲸V3 客户端里录入后会同步到这里'
})
function onApply(p) {
  range.value = { from: p.from || '', to: p.to || '' }
  partner.value = p.partner || null
  sheet.value = false
  reload()
}
function clearRange() { range.value = { from: '', to: '' }; reload() }
function clearPartner() { partner.value = null; reload() }
/**
 * 草稿的日期条件按**单据日期**判，不是按"存下的那一刻"。
 * ★ 以前用 stamp：上月存的、单据日期写上月 28 号的那张，在「上月」格里不出现、
 *   反倒出现在「本月」—— 同一句"上月"与服务端那一格两套口径，
 *   清点"上月还有哪些单没提交"就会漏。取不到单据日期才退回 stamp。
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

/**
 * ★★ 筛选口径是 V3 的**真实状态位**，不是旧版的「待确认 / 已入库」。
 *    ★★★ 2026-09-20 纠正：不是「is_ok / is_auditing 两个位」——
 *    is_ok(V3 IsOk) 只区分正式(1)/草稿(0)，**两个都算未审核**；
 *    作废靠 UserVoid(作废人)/TimeVoid(作废时间) 判（Agent 已收敛好）。
 */
const tabs = [
  { label: '全部', value: '' },
  { label: '未审核', value: 'pending' },
  { label: '已审核', value: 'audited' },
  { label: '已作废', value: 'void' },
  // ★ 草稿：纯前端筛选词，服务端没有这个 state（草稿还没落库）。
  //   与销售列表那一格同名同义，两页行为一致。
  { label: '草稿', value: 'draft', draft: true },
]
const isDraftTab = computed(() => status.value === 'draft')
/** 滑动胶囊停在第几格（与销售列表同一算法） */
const segIndex = computed(() => {
  const i = tabs.findIndex((t) => t.value === status.value)
  return i < 0 ? 0 : i
})
const draftCount = computed(() => drafts.value.length)
/** 汇总句里的到期部分：>10 天不占地方，已到期的必须单独说出来 */
const soonestText = computed(() => {
  const rs = rows.value
  if (!rs.length) return ''
  const days = Math.min.apply(null, rs.map((r) => r.remain))
  if (days <= 0) return ' · 有 ' + rs.filter((r) => r.remain <= 0).length + ' 条已到期待清'
  if (days > 10) return ''
  return ' · 最快 ' + days + ' 天后开始过期'
})
/** 「还有没有下一页」优先信后端的 hasMore（total 缺失时按长度推会把几千条说成 20 条） */
const serverMore = ref(null)
const hasMore = computed(() => (serverMore.value === null
  ? list.value.length < total.value : serverMore.value))

/**
 * 采购状态 → <BillRow>/<StatusTag> 那套词表。
 * 两边的中文标签本来就同名（未审核 / 已审核 / 已作废 / 草稿），只是键名不同：
 * 采购是 pending/audited/void（V3 真实状态位收敛来的），销售是 unapproved/approved/void。
 * ★ 不归一的话 StatusTag 会 STATUS_LABEL[status] || status ⇒ 行上直接印出英文 "pending"。
 */
const TO_TAG_STATUS = { pending: 'unapproved', audited: 'approved', void: 'void' }
/** 元信息行末尾那点小字：草稿的「剩 N 天」优先，其次才是单据备注（两者都空就不占位） */
const rowNote = (p) => [p.draftNote, p.note].filter(Boolean).join(' · ')

/* ===== 草稿行（与销售列表那套同构，只是字段名是供应商侧的） ===== */
function draftLines(d) {
  if (d.form) return d.form.items || []
  return ((d.payload || {}).lines) || []
}
function draftSupplierCode(d) {
  if (d.form) return d.form.supplierId || ''
  const p = d.payload || {}
  return p.supplier || (p.header || {}).ItemBh || ''
}
function draftSupplierLabel(d) {
  if (d.form) return d.form.supplierName || d.form.supplierId || ''
  const p = d.payload || {}
  return p.supplier || (p.header || {}).ItemBh || ''
}
function toRow(d) {
  const items = draftLines(d)
  const t = calcTotal(items)
  const when = draftStampText(d.stamp)
  return {
    id: d.id,
    origin: d.origin,
    // 「自动存于」= 退出开单那一刻系统替你留的（小程序/网页后退问不了），与人点的「存草稿」分开写
    billNo: (d.origin !== 'manual' ? '断网待上传 · '
      : (d.auto ? '草稿 · 自动存于 ' : '草稿 · 存于 ')) + when,
    status: 'draft',
    supplierName: draftSupplierLabel(d),
    // 停用标签要按编号查表，草稿行也得带上 code（卡片与服务端行走同一条模板）
    supplierCode: draftSupplierCode(d),
    lineCount: items.length,
    totalQty: t.totalQty,
    totalAmount: t.totalAmount,
    note: (d.form && d.form.memo) || (d.payload || {}).note || '',
    billDate: when,
    draftNote: draftNote(d),
    remain: d.remainingDays,
    // ★ 与销售列表同一口径（2026-10-02 改了拍板）：手动草稿行给「留下 / 删除」。
    actions: d.origin === 'manual'
      ? [{ key: 'keep', label: '留下' }, { key: 'remove', label: '删除', danger: true }]
      : [{ key: 'upload', label: '上传' }, { key: 'remove', label: '删除', danger: true }],
  }
}
const rows = computed(() => {
  // 服务端行：把状态归一成 StatusTag 认的词（草稿行 toRow 里已经是 'draft'，不用转）
  if (!isDraftTab.value) return list.value.map((p) => ({ ...p, status: TO_TAG_STATUS[p.status] || 'unapproved' }))
  const kw = keyword.value.trim().toLowerCase()
  const sup = partner.value && (partner.value.code || partner.value.id)
  return drafts.value
    .filter((d) => {
      if (!inDraftRange(d)) return false
      // ★ 与销售页同构：chip 写着某一家，草稿格就必须只列这一家的，
      //   不然"共 N 条（已按筛选）"是骗人的、也会把别家的草稿当成这一家的。
      if (sup && draftSupplierCode(d) !== sup) return false
      if (!kw) return true
      const hay = [draftSupplierLabel(d), (d.form && d.form.memo) || '',
        ...draftLines(d).map((it) => it.name || it.hpbh || '')].join(' ').toLowerCase()
      return hay.indexOf(kw) >= 0
    })
    .map(toRow)
})
function refreshDrafts() { drafts.value = listDrafts('purchase') }

function switchTab(v) {
  if (status.value === v) return
  status.value = v
  error.value = ''
  if (v === 'draft') { refreshDrafts(); return }   // 草稿读本地桶，不发网络请求
  reload()
}
function clearKeyword() { keyword.value = ''; reload() }

/**
 * ★ 打字即搜（350ms 防抖），与客户/商品/供应商/库存四页同一套手感（2026-10-07 统一）。
 *   改造前这里只认 `@confirm`（回车）⇒ 打了字不回车列表纹丝不动，是「搜了没反应」的常见误报来源。
 *   `@confirm` 保留：回车仍要**立刻**发，不用等这 350ms。
 *   ★ 安全性由下面的 `seq` 代际守卫兜住：防抖只把请求推后合并，晚到的旧响应照旧被丢弃。
 */
const onInput = debounce(reload, 350)

/**
 * ★ 请求代际守卫：连续搜索时，先发的慢响应不能覆盖后发的快响应。
 *   没有它会出现「搜了 A 又搜 B，列表停在 A」这种不可复现的错乱。
 */
let seq = 0

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
  const res = await purchaseApi.list({
    keyword: keyword.value, state: status.value,
    supplier: partner.value?.code || undefined,
    // ★ api 层把 from/to 映射成 Agent 认的 date_from/date_to（含当天）
    from: range.value.from || undefined, to: range.value.to || undefined,
    page: page.value, pageSize: config.PAGE_SIZE,
  })
  if (my !== seq) return          // 已被更新的请求取代，丢弃
  loading.value = false
  if (res.ok) {
    const rows2 = res.data.list || []
    list.value = page.value === 1 ? rows2 : [...list.value, ...rows2]
    total.value = res.data.total ?? rows2.length
    serverMore.value = res.data.hasMore === undefined ? null : !!res.data.hasMore
    if (page.value === 1) { offline.value = !!res.offline; cachedAt.value = res.cachedAt || 0; armEnter() }
  } else if (page.value > 1) {
    page.value--
    uni.showToast({ title: res.message || '这一页没拿到，上面已加载的还在', icon: 'none' })
  } else {
    error.value = res.message
  }
}

function goDetail(id) { uni.navigateTo({ url: '/pages/purchase/detail?id=' + id }) }
function goCreate() { uni.navigateTo({ url: '/pages/purchase/edit?mode=create' }) }

function onRow(p) {
  if (!isDraftTab.value) { goDetail(p.id); return }
  if (p.origin === 'manual') {
    uni.navigateTo({ url: '/pages/purchase/edit?mode=draft&draftId=' + encodeURIComponent(p.id) })
    return
  }
  uni.showModal({
    title: '断网时留下的待上传单',
    content: '供应商：' + (p.supplierName || '—') + '\n明细 ' + p.lineCount + ' 行 · 合计 ¥'
      + Number(p.totalAmount || 0).toFixed(2) + '\n存于 ' + p.billDate + '，联网后会自动上传',
    confirmText: '立即上传',
    cancelText: '关闭',
    success: (r) => { if (r.confirm) onDraftAction(p, 'upload') },
  })
}

async function onDraftAction(p, key) {
  if (key === 'keep') {
    const until = extendDraft(p.id)
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
        // ★ 先让那行走掉（260ms）再真删，toast 放在删完之后（见 utils/leaveRow.js）
        leaveThen(p.id, () => {
          removeDraft(p.id)
          refreshDrafts()
          uni.showToast({ title: '已删除', icon: 'success' })
        })
      },
    })
    return
  }
  if (key !== 'upload') return
  uni.showLoading({ title: '上传中', mask: true })
  const r = await upgradeOfflineDraft(p.id)
  uni.hideLoading()
  refreshDrafts()
  if (r.ok) {
    // 刚传上去的那张单要能在「全部」里看见：草稿 tab 下把服务端列表标脏，切回去重取
    list.value = []; page.value = 1
    uni.showToast({ title: '已上传', icon: 'success' })
  } else {
    uni.showToast({ title: r.message || '上传失败', icon: 'none' })
  }
}

onMounted(() => { refreshDrafts(); reload() })
// ★ 从「新建/修改采购单」返回时必须刷新（tabBar 页返回也会触发 onShow）。
//   但**只有真写过单**才整页刷 —— 点开一张单看一眼返回就跳回第一页，翻页位置没了。
let entered = false
onShow(() => {
  refreshDrafts()
  const dirty = takeBillWritten('purchase')
  // ★ 首页那条「N 张采购草稿将过期」经 storage 中转跳进来 ⇒ 直接落在草稿那一格。
  //   放在 `entered` 判定**之前**：本页第一次被 switchTab 打开时 entered 还是 false，
  //   排在后面就等于"人带着意图来了、这一格却没切"。
  if (takeJumpFlag('purchase_list_drafts')) {
    if (status.value !== 'draft') switchTab('draft')
  }
  if (!entered) { entered = true; return }
  if (!isDraftTab.value && dirty) reload()
})
onPullDownRefresh(async () => { await reload(); uni.stopPullDownRefresh() })
onReachBottom(loadMore)
</script>

<style lang="scss" scoped>
.list-page { padding-bottom: 40rpx; }

/* 草稿箱顶部汇总（与销售列表同一句写法） */
.draft-sum { padding: 20rpx $space-page 0; }
.draft-sum__t { font-size: $fs-mini; color: $color-text-3; }

/* 草稿那一格：与销售列表同一套写法 —— 分段控件里去虚线框，只染绿字；选中 = 白胶囊绿字 */
.filter-chip--draft {
  position: relative;
  color: $color-success;
}
.filter-chip--draft-on {
  /* 白胶囊交给全局那颗滑动的 .seg-pill，这里只改字色；
     再画一层白底会在切换瞬间和滑过来的胶囊重影。 */
  color: $color-success;
  font-weight: $fw-bold;
}
.filter-chip__badge {
  position: absolute; top: -6rpx; right: -6rpx;
  min-width: 32rpx; height: 32rpx; padding: 0 8rpx;
  border-radius: $radius-pill;
  background: $color-warning; color: #fff;
  font-family: $font-num; font-size: $fs-micro; line-height: 32rpx; text-align: center;
}

/* 采购单卡与状态标签的样式已删（2026-10-10）：这一页改用 components/BillRow.vue，
   版式与销售列表同一份，不再各写一套。 */
</style>
