<template>
  <view class="page-flush page-flush--fixed-1 list-page">
    <!-- 搜索栏 + 漏斗（与销售单列表同一套交互）：筛选条件收在半页里，
         列表顶上不再永久占一行 —— 多出来的高度正好多显示一条货品。 -->
    <view class="search-bar search-bar--sticky">
      <view class="search-line">
        <view class="search-input">
          <Icon name="search" :size="18" color="text-3" />
          <input
            v-model="keyword" confirm-type="search"
            placeholder="搜名称 / 编码 / 条码" placeholder-class="search-input__placeholder"
            @input="onInput" @confirm="reload"
          />
          <view v-if="keyword" class="search-clear" @click="clearKeyword" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="x" :size="15" color="text-2" />
          </view>
        </view>
        <view class="search-fan" :class="{ 'search-fan--on': showStopped }" @click="sheet = true" hover-class="hv-on" :hover-stay-time="80">
          <!-- 两个静态配色各写一个节点：图标表按"名|色"预生成，动态 :color 生成器认不出来 -->
          <Icon v-if="showStopped" name="filter" :size="18" color="white" />
          <Icon v-else name="filter" :size="18" color="text-3" />
          <text v-if="showStopped" class="search-fan__n">1</text>
        </view>
      </view>
    </view>

    <!-- 默认只看能开的货品。停用的不是删了，是"平时不想看见"，
         所以要留一条能翻出来看的路（不然老板再也没法把它重新启用 —— V3 那边也找不回来了）。 -->
    <ArchiveFilterSheet
      :show="sheet" :stopped="showStopped" :count="stopped.n" noun="货品"
      @close="sheet = false" @apply="applyFilter"
    />

    <LoadState :loading="loading && page === 1" :error="error" :offline="offline" :cached-at="cachedAt" skeleton skeleton-variant="row" @retry="reload">
      <text v-if="stopHint" class="stop-hint">{{ stopHint }}</text>
      <view v-if="list.length" class="list">
        <view v-for="(p, i) in list" :key="p.id" class="prod-row" :class="enterClass(i)" :style="enterStyle(i)" @click="goDetail(p.id)" hover-class="hv-on" :hover-stay-time="80">
          <view class="prod-row__main">
            <view class="prod-row__title">
              <text class="prod-row__name ellipsis">{{ p.name }}</text>
              <!-- ★ 统一走 StopTag：这一行接口就带了六档状态，直接给它当 label（离线也准）；
                     别的页面没有这个字段，就按编号查清单。同一个组件 = 同一种长相，
                     不会出现"档案页一种标法、单据页另一种"。 -->
              <StopTag
                kind="product" :code="p.code || p.id"
                :label="p.statusName && p.statusName !== '正常使用' ? p.statusName : ''"
              />
            </view>
            <!-- 单位胶囊排在规格前面：它是"这一行按哪种单位说"的定语，
                 单独占一行会让每张卡都多出一行、列表反而更矮。 -->
            <view class="prod-row__meta">
              <view class="prod-row__units">
                <text v-for="(u, ui) in p.units" :key="ui" class="uchip"
                      :class="{ 'uchip--base': u.basic }">
                  {{ u.basic ? u.unit : u.unit + ' ' + fmtQty(u.rate) }}
                </text>
                <text v-if="!p.units || !p.units.length" class="uchip uchip--base">
                  {{ p.baseUnit || '未配单位' }}
                </text>
              </view>
              <text class="prod-row__spec ellipsis">{{ p.spec }} · {{ p.code }} · {{ p.category }}</text>
            </view>
          </view>
          <view class="prod-row__price">
            <view class="prod-row__amount-line">
              <text class="prod-row__amount tnum">¥{{ fmtMoney(p.salePriceDefault) }}</text>
              <text class="prod-row__unit">/ {{ p.baseUnit }}</text>
            </view>
            <text class="prod-row__stock tnum">库存 {{ fmtQty(p.stock) }}{{ p.baseUnit }}
              <text v-if="foldText(p)" class="prod-row__fold">≈ {{ foldText(p) }}</text>
            </text>
          </view>
        </view>
      </view>
      <EmptyState
        v-else-if="!loading && !error"
        icon="box"
        :text="keyword ? '没有匹配的商品' : '暂无商品'"
        :sub="emptySub"
      />
      <view v-if="loading && page > 1" class="load-more"><text>加载中...</text></view>
      <view v-else-if="hasMore && list.length" class="load-more" @click="loadMore" hover-class="hv-on" :hover-stay-time="80">
        <text>加载更多</text>
        <Icon name="chevron-down" :size="14" color="primary" />
      </view>
      <view v-else-if="list.length" class="no-more"><text>共 {{ total }} 个商品 · 没有更多了</text></view>
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
import { productApi } from '../../api/product'
import { config } from '../../utils/config'
import { debounce, fmtMoney, fmtQty } from '../../utils/format'
import { takeBillWritten } from '../../utils/billWrites'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'

/**
 * "库存 320 支 ≈ 32 包"里的后半句：挑**倍率最大**的那个在用单位折算。
 * ★ 这是给人看的折算，不是另一份库存（库存只有基本单位一个口径）。
 *   只有一个单位时不显示，免得每行都拖一句废话。
 */
function foldText(p) {
  const base = Number(p && p.stock) || 0
  const us = ((p && p.units) || []).filter((u) => !u.basic && !u.stopped && Number(u.rate) > 0)
  if (!us.length) return ''
  const big = us.reduce((a, b) => (Number(b.rate) > Number(a.rate) ? b : a))
  return fmtQty(base / Number(big.rate)) + big.unit
}
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
/** 「显示已停用」：默认关（停用的货品不出现在列表与开单选择面板里）。
 *  ★ 这个开关**只在本页有效**，不写进配置：它是"我要不要看一眼仓库里的死货"，
 *    不是全公司的记账口径；开单页的选择面板永远不传它。 */
const showStopped = ref(false)
/** 筛选半页开没开 */
const sheet = ref(false)
/** 接口回的停用条数（与关键字同源）：开关开着要说"排在最前面"，关着要说"另有 N 条没显示"。
 *  ★ 这个数只能来自后端 —— 前端拿当前页去猜会骗人：一页 120 条，停用的在第 400 页时猜是 0。 */
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
/** 空列表的话要说清"可能是被这一档筛掉了"，否则搜一个停用的货品只会得到"没有匹配的商品"，
 *  人就以为档案里没有这个东西。 */
const emptySub = computed(() => {
  if (showStopped.value) return keyword.value ? '换个关键词试试' : '点击右下角新增商品'
  return keyword.value
    ? '换个关键词试试；停用的货品要点右上角「筛选」'
    : '停用的货品要点右上角「筛选」'
})
const stopHint = computed(() => {
  const n = Number(stopped.value.n) || 0
  if (!n) return ''
  return stopped.value.on
    ? `其中 ${n} 条是停用的，已排在最前面`
    : `另有 ${n} 条停用的货品没有显示，点右上角「筛选」`
})

/**
 * 请求代际。★ 为什么需要它：
 * 搜索框输入防抖 350ms，若用户在前一次请求飞行中又改了关键词，
 * reload() 会被 fetch() 的 loading 守卫**静默丢掉**，
 * 于是列表停留在旧关键词的结果上 —— 表现为「搜了没反应」。
 * 用自增的 seq 标记代际，只有最新一代的响应才允许写回状态。
 */
let seq = 0

async function reload() {
  page.value = 1
  list.value = []
  hasMore.value = true
  await fetch(true)
}

/**
 * 拉取一页。★ 后端已支持真分页：传 page ∈ 1..N，API 层换算成 offset。
 * hasMore 用后端给的 total 判断，不再靠 list.length 猜。
 * @param {boolean} force 重载（第一页）时允许打断进行中的请求
 */
async function fetch(force = false) {
  if (loading.value && !force) return
  const my = ++seq
  loading.value = true
  error.value = ''
  const res = await productApi.list({
    keyword: keyword.value,
    page: page.value,
    pageSize: PAGE_SIZE,
    showStopped: showStopped.value,
  })
  // 已被更新的请求取代 → 丢弃本次结果，别覆盖新数据
  if (my !== seq) return
  loading.value = false
  if (res.ok) {
    const incoming = res.data.list || []
    list.value = page.value === 1 ? incoming : [...list.value, ...incoming]
    total.value = res.data.total || 0
    stopped.value = { n: res.data.stoppedCount || 0, on: !!res.data.showStopped }
    // 后端给 hasMore 就用；同时兜一层「本页空 = 到底」
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
function goDetail(id) { uni.navigateTo({ url: '/pages/product/detail?id=' + id }) }
function goCreate() { uni.navigateTo({ url: '/pages/product/edit?mode=create' }) }

onMounted(reload)
let entered = false
// ★ 与单据列表同一口径：**真写过才刷**（新建/改档/停用会在编辑页打标记）。
//   以前每次 onShow 无条件 reload：翻十几页后点进详情看一眼，返回就清空整屏并跳回第 1 页，
//   滚动位置却还在深处 ⇒ 看着像"数据没了"。
onShow(() => {
  if (!entered) { entered = true; return }
  if (takeBillWritten('product')) reload()
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

.prod-row {
  display: flex;
  /* ★ 顶部对齐：右侧第一行是价格，居中会把价格压到「品名下面那条线」上，
     看着就是错开的（2026-09-29 用户点的就是这条）。 */
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-inner;
  background: $color-card;
  border-radius: $radius-card;
  padding: 28rpx;
  box-shadow: $shadow-card;
}
.prod-row__main { flex: 1; min-width: 0; }
.prod-row__title { display: flex; align-items: center; gap: 12rpx; }
.prod-row__name { flex: 1; min-width: 0; font-size: $fs-subtitle; font-weight: $fw-bold; }
.prod-row__meta { display: flex; align-items: center; gap: 8rpx; min-width: 0; margin-top: 10rpx; }
.prod-row__spec { flex: 1; min-width: 0; font-size: $fs-mini; color: $color-text-3; }
/* 单位胶囊（整组跟着规格那一行走，蓝底那个是基本单位） */
.prod-row__units { display: flex; flex-wrap: wrap; gap: 8rpx; flex: 0 0 auto; }
.uchip { font-size: $fs-micro; line-height: 32rpx; padding: 0 12rpx; border-radius: $radius-tag;
  background: $color-bg-sunken; color: $color-text-2; }
.uchip--base { background: $color-primary-bg; color: $color-primary-dark; font-weight: $fw-bold; }
.prod-row__stock { display: block; margin-top: 10rpx; font-size: $fs-mini; color: $color-text-3; }
.prod-row__fold { color: $color-text-2; margin-left: 8rpx; }
.prod-row__price {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.prod-row__amount-line { display: flex; align-items: baseline; gap: 4rpx; }
.prod-row__amount {
  font-family: $font-num;
  font-size: $fs-num-lg;
  font-weight: $fw-heavy;
  color: $color-primary;
  line-height: 1.2;
}
.prod-row__unit { font-size: $fs-micro; color: $color-text-4; }
</style>
