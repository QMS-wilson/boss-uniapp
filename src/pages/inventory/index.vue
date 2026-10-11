<template>
  <view class="page-flush page-flush--fixed inv-page">
    <!-- 搜索栏 -->
    <view class="search-bar search-bar--sticky">
      <view class="search-input">
        <Icon name="search" :size="18" color="text-3" />
        <input
          v-model="keyword" confirm-type="search"
          placeholder="搜品名 / 编号 / 规格 / 拼音" placeholder-class="search-input__placeholder"
          @input="onInput" @confirm="reload"
        />
        <view v-if="keyword" class="search-clear" @click="clearKeyword" hover-class="hv-on" :hover-stay-time="80">
          <Icon name="x" :size="15" color="text-2" />
        </view>
      </view>
    </view>

    <!-- 库存状态筛选（口径与后端 flag 一致，切换即重查）
         ★ 2026-10-10 改成与销售/采购同一套分段控件（滑动胶囊），不再是另一种椭圆片。
           这一排只有 4 格 ⇒ 胶囊宽度要带 .seg-pill--4，分母跟 FLAGS 的个数同源。 -->
    <view class="filter-row filter-row--sticky filter-row--tight">
      <view class="seg-pill seg-pill--4" :style="{ transform: 'translateX(' + segIndex * 100 + '%)' }" />
      <view
        v-for="f in FLAGS" :key="f.key"
        class="filter-chip" :class="{ 'filter-chip--active': flag === f.key }"
        @click="setFlag(f.key)" hover-class="hv-on" :hover-stay-time="80">{{ f.label }}</view>
    </view>

    <LoadState :loading="loading && !rows.length" :error="error" :offline="offline" :cached-at="cachedAt" skeleton skeleton-variant="row" @retry="reload">
      <!-- 合计卡：数字全部取后端同口径全量 SQL，不是本页列表相加 -->
      <view class="stat">
        <view class="stat__cell stat__cell--hl">
          <text class="metric-label">库存金额</text>
          <text class="stat__v">¥{{ fmtMoneyGroup(total.amount) }}</text>
        </view>
        <view class="stat__cell">
          <text class="metric-label">现存数量</text>
          <text class="stat__v" :class="{ 'stat__v--neg': total.qty < 0 }">{{ fmtQty(total.qty) }}</text>
        </view>
        <view class="stat__cell">
          <text class="metric-label">记录条数</text>
          <text class="stat__v">{{ total.kinds }}<text class="stat__u">条</text></text>
        </view>
      </view>
      <!-- 一行讲完"这一屏的数是怎么分的"：改造前这里是两块（一句分解 + 一整段负库存说明），
           第一条数据之前压了 76px 全是字，而且两块说的是同一件事（2026-10-10 UI 体检 07 板）。
           现在把算法那段收进「口径」，点开才给 —— 第一次看得懂，之后天天看是噪音。
           ★ 数字全部来自后端同口径统计；分解项只在「全部」下说话，切了格就别喊 N 条为负库存。 -->
      <view v-if="flag === 'all'" class="split">
        <view class="split__l">
          <text v-if="total.negative" class="split__neg" @click="setFlag('negative')" hover-class="hv-on" :hover-stay-time="80">
            {{ total.negative }} 条为负库存</text>
          <text class="split__sum">有货 {{ total.inStock }} · 零库存 {{ total.zero }}</text>
        </view>
        <view v-if="total.negative" class="split__go" @click="negOpen = !negOpen" hover-class="hv-on" :hover-stay-time="80">
          <text>{{ negOpen ? '收起' : '口径' }}</text>
          <Icon :name="negOpen ? 'chevron-up' : 'chevron-down'" :size="13" color="danger" />
        </view>
      </view>
      <!-- 文案只讲「负库存是什么、怎么回正」，不写本账套的具体成因 ——
           成因会随补录变化，写死了就成了假话。 -->
      <text v-if="total.negative && negOpen" class="split__d">
        负库存 = 已出库的数量超过了入库的数量，通常是期初库存没录入、或进货单漏录。
        补录期初或进货单后，这里会自动回正。点上面那行「负库存」可以只筛这些条。
      </text>

      <view v-if="rows.length" class="list">
        <view v-for="(i, idx) in rows" :key="i.id" class="inv" :class="enterClass(idx)" :style="enterStyle(idx)" @click="goFlow(i)" hover-class="hv-on" :hover-stay-time="80">
          <view class="inv__main">
            <view class="inv__name-line">
              <text class="inv__name ellipsis">{{ i.name || i.productId }}</text>
              <StopTag kind="product" :code="i.productId" />
            </view>
            <text class="inv__meta ellipsis">{{ metaOf(i) }}</text>
            <view class="inv__tags">
              <text class="inv__tag">{{ i.warehouse }}</text>
              <text v-if="warnOn && isLow(i)" class="inv__tag inv__tag--warn">低于下限 {{ fmtQty(i.lowLimit) }}</text>
            </view>
          </view>
          <view class="inv__right">
            <text class="inv__qty tnum" :class="{ 'inv__qty--neg': i.qty < 0 }">
              {{ fmtQty(i.qty) }}<text class="inv__unit">{{ i.unit }}</text>
            </text>
            <text class="inv__amount tnum">¥{{ fmtMoneyGroup(i.amount) }}</text>
            <text class="inv__cost tnum">{{ i.costPrice > 0 ? '成本 ' + fmtMoney(i.costPrice) : '无成本' }}</text>
          </view>
          <view class="inv__arrow"><Icon name="chevron-right" :size="16" color="text-4" /></view>
        </view>
      </view>

      <EmptyState
        v-else-if="!loading && !error"
        icon="layers"
        :text="emptyText"
        :sub="keyword ? '换个关键词，或把上方筛选切成「全部」' : ''"
      />

      <view v-if="rows.length && truncated" class="trunc">
        <view class="trunc__line" @click="truncOpen = !truncOpen" hover-class="hv-on" :hover-stay-time="80">
          <text class="trunc__sum">本筛选共 {{ total.kinds }} 条，只显示了金额最高的前 {{ rows.length }} 条，往下拉可继续加载</text>
          <view class="trunc__toggle">
            <text>{{ truncOpen ? '收起' : '口径' }}</text>
            <Icon :name="truncOpen ? 'chevron-up' : 'chevron-down'" :size="14" color="warning" />
          </view>
        </view>
        <text v-if="truncOpen" class="trunc__detail">单次最多返回 {{ rowLimit }} 条；合计三格取的是全量，所以「列表相加 ≠ 合计」不是算错；「导出 CSV」只导本页已加载的这些行，要一次拿全量请缩小筛选条件，或到 V3 客户端导出。</text>
      </view>
      <view v-if="rows.length" class="more">
        <text v-if="loadingMore" class="more__t">加载中…</text>
        <view v-else-if="truncated" class="more__t more__t--go" @click="loadMore" hover-class="hv-on" :hover-stay-time="80">
          <text>下拉或点这里加载更多</text>
          <Icon name="chevron-down" :size="14" color="primary" />
        </view>
        <text v-else class="more__t">已全部加载（{{ rows.length }} 条）</text>
      </view>

      <view v-if="rows.length" class="btns">
        <view class="btn-ghost btns__b" @click="doExport" hover-class="hv-on" :hover-stay-time="80">
          <Icon name="file-text" :size="16" color="text-2" /><text>导出 CSV（{{ rows.length }} 条）</text>
        </view>
      </view>

      <view class="bottom-gap" />
    </LoadState>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import { inventoryApi } from '../../api/index'
import { debounce, fmtMoney, fmtMoneyGroup, fmtQty } from '../../utils/format'
import { exportCsv } from '../../utils/export'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'
import { useEnterStagger } from '../../utils/enterStagger'

/** 首屏前 8 行错峰到位；翻页/刷新/切档不重播（见 utils/enterStagger.js） */
const { armEnter, enterClass, enterStyle } = useEnterStagger()

const FLAGS = [
  { key: 'all', label: '全部' },
  { key: 'positive', label: '有货' },
  { key: 'negative', label: '负库存' },
  { key: 'empty', label: '零库存' },
]
const PAGE = 200

const keyword = ref('')
const flag = ref('all')
const rows = ref([])
const total = ref({ kinds: 0, qty: 0, amount: 0, inStock: 0, negative: 0, zero: 0, costed: 0 })
const truncated = ref(false)
/** 截断说明默认只留一句结论，完整口径点「口径」展开 */
const truncOpen = ref(false)
/** 负库存那段算法说明同样收起来（2026-10-10 与 truncOpen 同一取向：默认不占首屏） */
const negOpen = ref(false)
/** 滑动胶囊停在第几格（分母与 FLAGS 个数同源，见 App.vue 的 .seg-pill--4） */
const segIndex = computed(() => {
  const i = FLAGS.findIndex((f) => f.key === flag.value)
  return i < 0 ? 0 : i
})
const rowLimit = ref(PAGE)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
/** 库存是"要不要补货"的判断依据，缓存值必须标出来（断网时它长得和实时一模一样） */
const offline = ref(false)
const cachedAt = ref(0)
let seq = 0

/** ★ 「库存预警」是系统配置项，默认关。
 *    关掉是对的：本账套 48,585 个货品里 0 个录了下限（Hpdan.kcsx/kcxx 全为 0），
 *    任何阈值判定都是凭空造规则。开着时只对真录了下限的行标色。
 *    键与 pages/settings/config.vue 共用。 */
const warnOn = ref(false)

const emptyText = computed(() => {
  if (keyword.value) return '没有匹配的商品'
  return flag.value === 'all' ? '暂无库存数据' : '该筛选下没有记录'
})

/** 规格在真库里大多为空，直接拼会剩下「 · 编号 123」这种残缺行 */
function metaOf(i) {
  return [i.spec, '编号 ' + i.productId].filter(Boolean).join(' · ')
}
function isLow(i) {
  return i.lowLimit > 0 && i.qty < i.lowLimit
}

const onInput = debounce(() => reload(), 350)

async function fetchPage(offset) {
  return inventoryApi.list({
    keyword: keyword.value.trim(), flag: flag.value, limit: PAGE, offset,
  })
}

async function reload() {
  const my = ++seq
  loading.value = true; error.value = ''
  const res = await fetchPage(0)
  // ★ 代际守卫：敲完搜索 350ms 才发、切筛选又是立刻发，两条响应回来的顺序不保证。
  //   没有这一道，后到的旧响应会把新条件的 rows/合计/truncated 整个盖回去。
  if (my !== seq) return
  loading.value = false
  if (res.ok) {
    rows.value = res.data.items
    total.value = res.data.total
    truncated.value = res.data.truncated
    rowLimit.value = res.data.rowLimit
    offline.value = !!res.offline
    cachedAt.value = res.cachedAt || 0
    armEnter()
  } else error.value = res.message
}

async function loadMore() {
  // ★ 还要挡在 reload 期间：不然旧条件的第 200 行会 concat 到新条件的结果后面，
  //   并把 truncated 覆盖回旧值（看起来"能翻"，实际混进了别家的数）。
  if (loadingMore.value || loading.value || !truncated.value) return
  const my = seq
  loadingMore.value = true
  const res = await fetchPage(rows.value.length)
  if (my !== seq) { loadingMore.value = false; return }
  loadingMore.value = false
  if (res.ok) {
    // 后端按金额降序 + offset 分页，直接续在尾巴上；合计仍取后端全量值
    rows.value = rows.value.concat(res.data.items)
    truncated.value = res.data.truncated
  } else uni.showToast({ title: res.message || '加载失败', icon: 'none' })
}

function setFlag(k) {
  if (flag.value === k) return
  flag.value = k
  reload()
}
function clearKeyword() { keyword.value = ''; reload() }

function doExport() {
  exportCsv(
    `库存状况_${flag.value}_${keyword.value.trim() || '全部'}`,
    ['仓库', '货品编号', '品名', '规格', '单位', '现存数', '成本均价', '库存金额', '下限'],
    rows.value.map((i) => [i.warehouse, i.productId, i.name, i.spec, i.unit, i.qty, i.costPrice, i.amount, i.lowLimit]),
  )
}

function goFlow(i) {
  uni.navigateTo({
    url: `/pages/inventory/flow?id=${encodeURIComponent(i.productId)}`
      + `&name=${encodeURIComponent(i.name || '')}&spec=${encodeURIComponent(i.spec || '')}`
      + `&qty=${i.qty}&unit=${encodeURIComponent(i.unit || '')}`,
  })
}

onMounted(reload)
// 从「系统配置」回来时重新读预警开关
onShow(() => { warnOn.value = uni.getStorageSync('cfg:stockWarn') === true })
onReachBottom(loadMore)
onPullDownRefresh(async () => { await reload(); uni.stopPullDownRefresh() })
</script>

<style lang="scss" scoped>
.inv-page { padding-bottom: 40rpx; }

/* 合计三格 */
.stat {
  display: grid; grid-template-columns: 1.3fr 1fr 1fr; gap: $space-inner;
  padding: $space-inner $space-page 0;
}
.stat__cell {
  background: $color-card; border-radius: $radius-card;
  padding: 24rpx 20rpx; box-shadow: $shadow-card;
  display: flex; flex-direction: column; min-width: 0;
}
.stat__cell--hl { background: $color-primary-bg; box-shadow: none; }
.stat__v {
  font-family: $font-num; font-size: $fs-num-lg; font-weight: $fw-heavy; color: $color-text;
  margin-top: 8rpx; font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.stat__u { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-3; margin-left: 4rpx; }
.stat__v--neg { color: $color-danger; }
/* 分解行（改造前是「一句分解 + 一整段负库存说明」两块）
 * 整行 88rpx = 44px 触控下限；「N 条为负库存」可点 ⇒ 直接筛这一类。 */
.split {
  display: flex; align-items: center; justify-content: space-between; gap: $space-inner;
  min-height: 88rpx; padding: 14rpx $space-page;
  margin: 0 $space-page; border-radius: $radius-card-sm;
  background: $color-danger-bg;
}
.split__l { display: flex; align-items: baseline; gap: 12rpx; min-width: 0; flex: 1; }
.split__neg {
  flex: 0 0 auto; font-size: $fs-caption; font-weight: $fw-bold; color: $color-danger;
}
.split__sum { font-size: $fs-mini; color: $color-text-3; }
.split__go {
  flex: 0 0 auto; display: flex; align-items: center; gap: 2rpx;
  font-size: $fs-mini; font-weight: $fw-bold; color: $color-danger;
}
.split__d {
  display: block; margin: 10rpx $space-page 0; padding: 0 4rpx;
  font-size: $fs-mini; color: #96402f; line-height: 1.7;
}

/* 行 */
.inv {
  display: flex; align-items: center; gap: 16rpx;
  background: $color-card; border-radius: $radius-card;
  padding: 26rpx 24rpx; box-shadow: $shadow-card;
}
.inv__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.inv__name {
  font-size: $fs-body; font-weight: $fw-bold; color: $color-text;
}
.inv__name-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.inv__meta {
  font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx;
}
.inv__tags { display: flex; align-items: center; gap: 10rpx; margin-top: 12rpx; flex-wrap: wrap; }
.inv__tag {
  font-size: $fs-micro; color: $color-text-2; background: $color-bg-sunken;
  border-radius: $radius-tag; padding: 4rpx 12rpx;
}
.inv__tag--warn { color: $color-warning; background: $color-warning-bg; }
.inv__right { flex: 0 0 auto; text-align: right; display: flex; flex-direction: column; }
.inv__qty {
  font-family: $font-num; font-size: 38rpx; font-weight: $fw-heavy; line-height: 1.1;
  color: $color-text; font-variant-numeric: tabular-nums;
}
.inv__qty--neg { color: $color-danger; }
.inv__unit { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-4; margin-left: 4rpx; }
.inv__amount {
  font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold; color: $color-text;
  margin-top: 8rpx; font-variant-numeric: tabular-nums;
}
.inv__cost {
  font-family: $font-num; font-size: $fs-micro; color: $color-text-4;
  margin-top: 4rpx; font-variant-numeric: tabular-nums;
}
.inv__arrow { flex: 0 0 auto; }

/* 截断说明 / 加载更多 / 底部按钮 */
.trunc {
  margin: $space-inner $space-page 0; padding: 20rpx 24rpx;
  background: $color-warning-bg; border-radius: $radius-card-sm;
  font-size: $fs-mini; color: $color-warning-text; line-height: 1.7;
}
.trunc__line { display: flex; align-items: center; gap: 12rpx; }
.trunc__sum { flex: 1; min-width: 0; }
.trunc__toggle {
  flex: 0 0 auto; display: flex; align-items: center; gap: 4rpx;
  font-size: $fs-micro; opacity: .85;
}
.trunc__detail { display: block; margin-top: 10rpx; }
.more { text-align: center; padding: 26rpx 0 0; }
.more__t { font-size: $fs-caption; color: $color-text-4; }
.more__t--go {
  display: flex; align-items: center; justify-content: center; gap: 6rpx;
  color: $color-primary;
}
.btns { padding: $space-gap $space-page 0; }
.btns__b { height: 88rpx; }
</style>
