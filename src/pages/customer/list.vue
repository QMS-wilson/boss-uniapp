<template>
  <view class="page-flush page-flush--fixed-1 list-page">
    <!-- 搜索栏 + 漏斗（与销售单列表同一套交互）：筛选条件收在半页里，列表顶上不再占一行 -->
    <view class="search-bar search-bar--sticky">
      <view class="search-line">
        <view class="search-input">
          <Icon name="search" :size="18" color="text-3" />
          <input
            v-model="keyword" confirm-type="search"
            placeholder="搜名称 / 手机 / 编码" placeholder-class="search-input__placeholder"
            @input="onInput" @confirm="reload"
          />
          <view v-if="keyword" class="search-clear" @click="clearKeyword" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="x" :size="15" color="text-2" />
          </view>
        </view>
        <view class="search-fan" :class="{ 'search-fan--on': showStopped }" @click="sheet = true" hover-class="hv-on" :hover-stay-time="80">
          <Icon v-if="showStopped" name="filter" :size="18" color="white" />
          <Icon v-else name="filter" :size="18" color="text-3" />
          <text v-if="showStopped" class="search-fan__n">1</text>
        </view>
      </view>
    </view>

    <!-- 默认只看正常往来的客户；暂停往来的要能翻出来看（不然没法重新启用） -->
    <ArchiveFilterSheet
      :show="sheet" :stopped="showStopped" :count="stopped.n" noun="客户"
      @close="sheet = false" @apply="applyFilter"
    />

    <LoadState :loading="loading && page === 1" :error="error" :offline="offline" :cached-at="cachedAt" skeleton skeleton-variant="row" @retry="reload">
      <text v-if="stopHint" class="stop-hint">{{ stopHint }}</text>
      <view v-if="list.length" class="list">
        <view v-for="(c, i) in list" :key="c.id" class="cust-row" :class="enterClass(i)" :style="enterStyle(i)" @click="goDetail(c.id)" hover-class="hv-on" :hover-stay-time="80">
          <view class="cust-row__main">
            <view class="cust-row__title">
              <text class="cust-row__name ellipsis">{{ c.name }}</text>
              <text v-if="c.type" class="cust-row__type">{{ c.type }}</text>
              <StopTag kind="customer" :code="c.code || c.id"
                       :label="c.stopped ? (c.statusName || '暂停往来') : ''" />
            </view>
            <text class="cust-row__meta ellipsis">{{ c.contact }} {{ c.mobile || '' }}</text>
          </view>
          <view class="cust-row__amt">
            <text class="cust-row__amt-label">应收</text>
            <!-- ★ 字段名是 due，不是 receivable！
                 toCustomer() 的输出契约是 due（真实后端字段 Khdan.J_Due 也映射到 due），
                 详情页用的也是 cust.due。这里曾经写 c.receivable → 恒 undefined →
                 AmountText 回落成 0，列表里所有客户都显示 ¥0.00。 -->
            <AmountText :value="c.due" tone="danger" />
          </view>
        </view>
      </view>
      <EmptyState
        v-else-if="!loading && !error"
        icon="users"
        :text="keyword ? '没有匹配的客户' : '暂无客户'"
        :sub="emptySub"
      />
      <view v-if="loading && page > 1" class="load-more"><text>加载中...</text></view>
      <view v-else-if="hasMore && list.length" class="load-more" @click="loadMore" hover-class="hv-on" :hover-stay-time="80">
        <text>加载更多</text>
        <Icon name="chevron-down" :size="14" color="primary" />
      </view>
      <view v-else-if="list.length" class="no-more"><text>共 {{ total }} 个客户 · 没有更多了</text></view>
      <view class="bottom-gap bottom-gap--fab" />
    </LoadState>

    <view class="fab" @click="goCreate" hover-class="hv-on" :hover-stay-time="80">
      <Icon name="plus" :size="26" color="white" />
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { customerApi } from '../../api/customer'
import { config } from '../../utils/config'
import { debounce } from '../../utils/format'
import { takeBillWritten } from '../../utils/billWrites'
import AmountText from '../../components/AmountText.vue'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'
import ArchiveFilterSheet from '../../components/ArchiveFilterSheet.vue'
import { useEnterStagger } from '../../utils/enterStagger'

/** 首屏前 8 行错峰到位；翻页/刷新/切档不重播（见 utils/enterStagger.js） */
const { armEnter, enterClass, enterStyle } = useEnterStagger()

const keyword = ref('')
const list = ref([])
const page = ref(1)
const total = ref(0)
const hasMore = ref(true)
const loading = ref(false)
const error = ref('')
/** 断网时列表回的是缓存 ⇒ 必须标出来（sales/list 同款），否则旧数看着像实时 */
const offline = ref(false)
const cachedAt = ref(0)
/** 「显示已停用」：默认关。只在本页有效，不进配置 —— 开单页选客户永远不给暂停往来的。 */
const showStopped = ref(false)
/** 筛选半页开没开 */
const sheet = ref(false)
/** 接口回的停用家数（与关键字同源）：只能信后端，拿当前页猜会骗人 */
const stopped = ref({ n: 0, on: false })
const PAGE_SIZE = config.LIST_PAGE_SIZE

const onInput = debounce(reload, 350)

function applyFilter(v) {
  sheet.value = false
  const on = !!v
  if (on === showStopped.value) return
  showStopped.value = on
  reload()
}
const stopHint = computed(() => {
  const n = Number(stopped.value.n) || 0
  if (!n) return ''
  return stopped.value.on
    ? `其中 ${n} 家是停用的，已排在最前面`
    : `另有 ${n} 家停用的没有显示，点右上角「筛选」`
})
const emptySub = computed(() => {
  if (showStopped.value) return keyword.value ? '换个关键词试试' : '点击右下角新增客户'
  return keyword.value
    ? '换个关键词试试；暂停往来的客户要点右上角「筛选」'
    : '暂停往来的客户要点右上角「筛选」'
})

/**
 * 请求代际。★ 搜索防抖窗口内若重入，reload 会被 loading 守卫静默丢掉，
 * 列表就停在旧关键词上（表现为「搜了没反应」）。用 seq 只让最新请求写回。
 */
let seq = 0

async function reload() {
  page.value = 1
  list.value = []
  hasMore.value = true
  await fetch(true)
}

/** ★ 后端已支持真分页：page ∈ 1..N → API 层换算 offset。hasMore 用后端 total 判断。 */
async function fetch(force = false) {
  if (loading.value && !force) return
  const my = ++seq
  loading.value = true
  error.value = ''
  const res = await customerApi.list({
    keyword: keyword.value,
    page: page.value,
    pageSize: PAGE_SIZE,
    showStopped: showStopped.value,
  })
  if (my !== seq) return          // 已被更新的请求取代
  loading.value = false
  if (res.ok) {
    const incoming = res.data.list || []
    list.value = page.value === 1 ? incoming : [...list.value, ...incoming]
    total.value = res.data.total || 0
    stopped.value = { n: res.data.stoppedCount || 0, on: !!res.data.showStopped }
    hasMore.value = incoming.length > 0 && res.data.hasMore !== false
    // ★ 断网时回的是缓存，必须标出来，否则旧数看着像实时
    if (page.value === 1) { offline.value = !!res.offline; cachedAt.value = res.cachedAt || 0; armEnter() }
  } else if (page.value > 1) {
    // ★ 只是第 N 页没拿到 ⇒ 不许把已加载的整屏换成错误页（purchase/index 同款口径）：
    //   页码退回去、已加载的留着，只说一句这一页没拿到。
    page.value--
    uni.showToast({ title: res.message || '这一页没拿到，上面已加载的还在', icon: 'none' })
  } else {
    error.value = res.message
    hasMore.value = false
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) return
  page.value++
  await fetch()
}
function clearKeyword() { keyword.value = ''; reload() }
function goDetail(id) { uni.navigateTo({ url: '/pages/customer/detail?id=' + id }) }
function goCreate() { uni.navigateTo({ url: '/pages/customer/edit?mode=create' }) }

onMounted(reload)
// ★ 从「新增/编辑客户」返回时必须刷新（与供应商列表同理）。
let entered = false
onShow(() => {
  if (!entered) { entered = true; return }
  if (takeBillWritten('customer')) reload()   // ★ 看过一眼不该刷回第 1 页，写过才刷
})
onPullDownRefresh(async () => { await reload(); uni.stopPullDownRefresh() })
onReachBottom(loadMore)
</script>

<style lang="scss" scoped>
.list-page { padding-bottom: 40rpx; }
.stop-hint {
  display: block; margin: 0 $space-page; padding-top: 14rpx;
  font-size: $fs-mini; color: $color-text-3;
}

.cust-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-inner;
  background: $color-card;
  border-radius: $radius-card;
  padding: 28rpx;
  box-shadow: $shadow-card;
}
.cust-row__main { flex: 1; min-width: 0; }
.cust-row__title { display: flex; align-items: center; gap: 12rpx; }
.cust-row__name { flex: 1; min-width: 0; font-size: $fs-subtitle; font-weight: $fw-bold; }
.cust-row__type {
  flex: 0 0 auto;
  font-size: $fs-micro;
  color: $color-primary;
  background: $color-primary-bg;
  padding: 4rpx 12rpx;
  border-radius: $radius-tag;
  line-height: 1.4;
}
.cust-row__meta { display: block; margin-top: 10rpx; font-size: $fs-mini; color: $color-text-3; }
.cust-row__amt { flex: 0 0 auto; text-align: right; }
.cust-row__amt-label { display: block; font-size: $fs-micro; color: $color-text-4; margin-bottom: 4rpx; }
</style>
