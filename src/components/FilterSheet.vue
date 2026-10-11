<template>
  <!--
    列表页的筛选半页：从底部弹起，装"搜索框装不下"的条件。

    ★ 为什么是底部弹层而不是把筛选格再加几格：状态那五格已经把 375 宽的机器挤满了
      （见全局 .filter-row--tight 那条"格内不折行、整条横向可滚"的注释），
      日期区间这种"两个值 + 一排快捷档"塞进横滚条里必然看不清。
    ★ 面板里改的都是**草稿值**，点「确定」才生效 —— 边点边查会让人以为筛选在抽风
      （每改一格就闪一次列表），也让"我到底筛了什么"看不见。
    ★ 日期一律 YYYY-MM-DD、含当天（Agent 侧 date_to 是 < 次日，见 v3agent/sales.py 的 WHERE）。
  -->
  <view v-if="show" class="sheet-mask" @click="onCancel">
    <view class="sheet" @click.stop>
      <view class="sheet__head">
        <text class="sheet__title">筛选</text>
        <view class="sheet__x" @click="onCancel" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="18" color="text-3" /></view>
      </view>

      <!-- ★ 日期这一段**不能放进 scroll-view**：uni-h5 的日期弹层是 <uni-picker> 的**子节点**
           （`.uni-picker-container`，position:fixed），落在滚动容器里会被它夹住/定位基准被改，
           结果就是"点了没见着、或被半页盖住"（用户实测报的这条）。
           滚动区只装候选列表 —— 日期与搜索框是主操作，本来也不该被滚走。 -->
      <view class="sec">
        <text class="sec__t">单据日期</text>
        <view class="qk">
          <text
            v-for="q in QUICKS" :key="q.key"
            class="qk__i" :class="{ 'qk__i--on': quick === q.key }"
            @click="setQuick(q.key)"
          >{{ q.label }}</text>
        </view>
        <view class="dr">
          <picker class="dr__pk" mode="date" :value="d.from" :end="d.to || ''" @change="onFrom">
            <view class="dr__box" :class="{ 'dr__box--set': !!d.from }">
              <text class="dr__v">{{ d.from || '开始日期' }}</text>
              <Icon name="calendar" :size="15" color="text-3" />
            </view>
          </picker>
          <text class="dr__sep">至</text>
          <picker class="dr__pk" mode="date" :value="d.to" :start="d.from" @change="onTo">
            <view class="dr__box" :class="{ 'dr__box--set': !!d.to }">
              <text class="dr__v">{{ d.to || '结束日期' }}</text>
              <Icon name="calendar" :size="15" color="text-3" />
            </view>
          </picker>
        </view>
        <text v-if="d.from || d.to" class="sec__note">{{ rangeNote }}</text>
      </view>

      <view class="sec sec--pick">
        <text class="sec__t">{{ partnerLabel }}</text>
        <view v-if="d.partner" class="chosen">
          <Icon name="user" :size="15" />
          <text class="chosen__n ellipsis">{{ d.partner.name || d.partner.code }}</text>
          <!-- 筛选条件里已经选中的那位，可能是**选完之后才被停用的** ⇒ 这一格要标 -->
          <StopTag :kind="partnerKind" :code="d.partner.code || d.partner.id" />
          <view class="chosen__x" @click="d.partner = null" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="14" /></view>
        </view>
        <view v-else class="pick">
          <Icon name="search" :size="16" color="text-3" />
          <input
            v-model="kw" class="pick__i" placeholder="搜名称或编号"
            placeholder-class="pick__ph" @input="onSearchInput" @confirm="search"
          />
          <!-- 请求在飞 ⟹ 搜索框右侧一个行内小转圈。
               ★ 为什么必须有：下面那条"加载中…"的条件是 `loading && !opts.length`，
                 而**第二次**搜索时 opts 里还留着上一次的结果 ⇒ 那条不会出现，
                 用户改了关键词看到的是旧列表 = 「搜了没反应」的经典误报。 -->
          <view v-if="loading" class="inline-spin" />
        </view>
      </view>

      <scroll-view class="sheet__body" scroll-y>
        <view v-if="err" class="tip tip--bad" @click="search" hover-class="hv-on" :hover-stay-time="80">{{ err }}，点击重试</view>
        <view v-else-if="loading && !opts.length" class="tip">加载中…</view>
        <view v-else-if="d.partner" class="tip">已选一个，点右侧可换</view>
        <view v-else-if="kw && !opts.length" class="tip">没有匹配的{{ partnerLabel }}</view>
        <view v-else class="opts">
          <view v-for="o in opts" :key="o.id" class="opt" @click="choose(o)" hover-class="hv-on" :hover-stay-time="80">
            <text class="opt__n ellipsis">{{ o.name || o.id }}</text>
            <text class="opt__c">{{ o.id }}</text>
          </view>
        </view>
        <view class="sec__gap" />
      </scroll-view>

      <view class="sheet__bar">
        <view class="sheet__btn sheet__btn--ghost" @click="reset" hover-class="hv-on" :hover-stay-time="80">重置</view>
        <view class="sheet__btn sheet__btn--go" @click="apply" hover-class="hv-on" :hover-stay-time="80">
          确定<text v-if="activeCount" class="sheet__n">{{ activeCount }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { customerApi } from '../api/customer'
import { supplierApi } from '../api/index'
import { quickRange, debounce } from '../utils/format'
import Icon from './Icon.vue'
import StopTag from './StopTag.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  kind: { type: String, default: 'sales' },        // sales=客户 / purchase=供应商
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  partner: { type: Object, default: null },         // {code,name}
})
const emit = defineEmits(['close', 'apply'])

const QUICKS = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: '7d', label: '近7天' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: '90d', label: '近90天' },
  { key: 'year', label: '本年' },
]

const d = ref({ from: '', to: '', partner: null })
const quick = ref('all')
const kw = ref('')
const opts = ref([])
const loading = ref(false)
const err = ref('')

const partnerLabel = computed(() => (props.kind === 'purchase' ? '供应商' : '客户'))
// StopTag 认的是档案种类，不是单据种类：sales 这一侧查的是客户表
const partnerKind = computed(() => (props.kind === 'purchase' ? 'supplier' : 'customer'))
const activeCount = computed(() =>
  ((d.value.from || d.value.to) ? 1 : 0) + (d.value.partner ? 1 : 0))
/** 说清"含当天"，否则"10-01 至 10-01"到底有没有今天的单会被当成 bug 报上来 */
const rangeNote = computed(() => {
  const f = d.value.from, t = d.value.to
  if (f && t) return f === t ? '只看 ' + f + ' 当天' : f + ' 至 ' + t + '（含当天）'
  if (f) return f + ' 起（含当天）'
  return '截至 ' + t + '（含当天）'
})

/** 反推当前区间命中的快捷档：手改日期后高亮要跟着落回"无"，别让「本月」亮着一个不是本月的区间 */
function matchQuick(f, t) {
  for (const q of QUICKS) {
    const r = quickRange(q.key)
    if (r.from === f && r.to === t) return q.key
  }
  return ''
}
function setQuick(key) {
  const r = quickRange(key)
  d.value.from = r.from; d.value.to = r.to
  quick.value = key
}
function onFrom(e) {
  d.value.from = e.detail.value
  quick.value = matchQuick(d.value.from, d.value.to)
}
function onTo(e) {
  d.value.to = e.detail.value
  quick.value = matchQuick(d.value.from, d.value.to)
}
function reset() {
  d.value = { from: '', to: '', partner: null }
  quick.value = 'all'
  kw.value = ''
}

/* 往来单位：面板内搜（不跳档案页）—— 跳走再回来要重开面板、状态还得自己带，
   而这里要的只是"挑一个名字"，一次请求 20 条足够。 */
let seq = 0
async function search() {
  const my = ++seq
  loading.value = true; err.value = ''
  const api = props.kind === 'purchase' ? supplierApi : customerApi
  const res = await api.list({ keyword: kw.value.trim(), pageSize: 20 })
  if (my !== seq) return
  loading.value = false
  if (res.ok) opts.value = (res.data && res.data.list) || []
  else { opts.value = []; err.value = res.message || (partnerLabel.value + '列表加载失败') }
}
/**
 * ★ 350ms 防抖（2026-10-09，与列表页那四处"打字即搜"对齐）：
 *   以前 @input 直接打请求 —— 敲「恒发电镀」四个字发四次，转圈一直闪；
 *   而列表页早就是 350ms 了，同一个动作两套手感说不过去。
 *   回车仍走 search()，立刻发、不等这 350ms（`@confirm` 那处没改）。
 */
const onSearchInput = debounce(search, 350)
function choose(o) {
  d.value.partner = { code: o.id, name: o.name || o.id }
}

watch(() => props.show, (v) => {
  if (!v) return
  d.value = { from: props.from || '', to: props.to || '', partner: props.partner || null }
  quick.value = matchQuick(d.value.from, d.value.to) || (d.value.from || d.value.to ? '' : 'all')
  kw.value = ''
  // ★ 候选列表必须一起清：以前只清搜索框、且"已选了客户"时干脆不查，
  //   于是重开半页时框是空的、下面却还是上次那个关键词的结果 ——
  //   人会把这十来条当成"全部"来挑，点错客户等于筛错单。
  opts.value = []
  search()
})

function onCancel() { emit('close') }
function apply() {
  emit('apply', { from: d.value.from, to: d.value.to, partner: d.value.partner })
}
</script>

<style lang="scss" scoped>
/* ★ z-index 必须压过 H5 的 tabBar（uni-tabbar 是 998）：
   半页是贴底的，压在 tabbar 下面就等于"确定"按钮点不到 —— 而门用 element.click() 走 DOM，
   照样"点得到"，所以这种遮挡只有截图与 elementFromPoint 抓得住（414 宽实测踩过）。
   小程序的原生 tabBar 不在 webview 里，页面内容本来就盖不到它，两边都取 1000 一致。 */
.sheet-mask {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(21, 36, 59, 0.45);
  display: flex; align-items: flex-end;
  animation: mask-in $dur-fast $ease-out;
}
.sheet {
  width: 100%; max-height: 82vh; min-height: 40vh;
  display: flex; flex-direction: column;
  background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  animation: sheet-up $dur-panel $ease-out;
  padding-bottom: env(safe-area-inset-bottom);
}
@keyframes sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes mask-in { from { opacity: 0; } to { opacity: 1; } }

.sheet__head {
  flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
  padding: 28rpx $space-card 18rpx;
}
.sheet__title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.sheet__x { padding: 6rpx; }

/* ★ 滚动区给**自己的 max-height**，不要靠 flex:1 分剩余高度：
   .sheet 用的是 max-height（不是定高），flex 子项会先按内容撑开、容器再被夹住，
   结果候选列表直接盖到「确定」那一栏上（实况门量 elementFromPoint 抓到的就是这个）。 */
.sheet__body { flex: 0 0 auto; max-height: 30vh; }
.sec { flex: 0 0 auto; padding: 20rpx $space-card 24rpx; }
.sec--pick { padding-bottom: 16rpx; }
.sec__t { display: block; font-size: $fs-mini; color: $color-text-3; margin-bottom: 16rpx; }
.sec__note { display: block; margin-top: 14rpx; font-size: $fs-micro; color: $color-text-3; }
.sec__gap { height: 20rpx; }

/* 快捷档：与筛选条同一套胶囊语言，但换成浅底描边、选中填主色 */
.qk { display: flex; flex-wrap: wrap; gap: $space-tight; }
.qk__i {
  padding: 12rpx 22rpx; border-radius: $radius-pill;
  border: 1rpx solid $color-border; background: $color-bg;
  color: $color-text-2; font-size: $fs-mini; line-height: 1;
}
.qk__i--on { background: $color-primary; border-color: $color-primary; color: #fff; font-weight: $fw-bold; }

.dr { display: flex; align-items: center; gap: $space-tight; margin-top: 20rpx; }
.dr__pk { flex: 1 1 0; min-width: 0; }
.dr__box {
  display: flex; align-items: center; justify-content: space-between; gap: 10rpx;
  height: 76rpx; padding: 0 20rpx; box-sizing: border-box;
  border-radius: $radius-input; background: $color-bg-sunken;
}
.dr__box--set { background: $color-primary-bg; }
.dr__v { font-family: $font-num; font-size: $fs-caption; color: $color-text-3; }
.dr__box--set .dr__v { color: $color-primary-dark; font-weight: $fw-bold; }
.dr__sep { flex: 0 0 auto; font-size: $fs-mini; color: $color-text-4; }

.chosen {
  display: inline-flex; align-items: center; gap: 10rpx; max-width: 100%;
  padding: 14rpx 22rpx; border-radius: $radius-pill;
  background: rgba($color-primary, 0.1); color: $color-primary;
}
.chosen__n { max-width: 420rpx; font-size: $fs-caption; }
.chosen__x { display: flex; padding: 4rpx; opacity: 0.7; }

.pick {
  display: flex; align-items: center; gap: 12rpx;
  height: 76rpx; padding: 0 22rpx; box-sizing: border-box;
  border-radius: $radius-input; background: $color-bg-sunken;
}
.pick__i { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: $fs-body; }
.pick__ph { color: $color-text-4; font-size: $fs-body; }

.tip { padding: 26rpx 4rpx; font-size: $fs-mini; color: $color-text-4; }
.tip--bad { color: $color-danger; }
/* 滚动交给外层 scroll-view，这里不再套一层 overflow（两层滚动条嵌在一起，手机上会互相抢） */
.opts { padding: 0 $space-card; }
.opt {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  padding: 22rpx 4rpx; border-bottom: 1rpx solid $color-divider;
}
.opt__n { flex: 1; min-width: 0; font-size: $fs-body; }
.opt__c { flex: 0 0 auto; font-family: $font-num; font-size: $fs-micro; color: $color-text-4; }

.sheet__bar {
  flex: 0 0 auto; display: flex; gap: $space-tight;
  padding: 20rpx $space-card; border-top: 1rpx solid $color-divider;
}
.sheet__btn {
  flex: 1; height: 88rpx; line-height: 88rpx; text-align: center; /* U6：44px */
  border-radius: $radius-btn; font-size: $fs-body; font-weight: $fw-bold;
}
.sheet__btn--ghost { background: $color-bg-sunken; color: $color-text-2; font-weight: $fw-normal; }
.sheet__btn--go { background: $color-primary; color: #fff; }
.sheet__btn--go:active { background: $color-primary-dark; }
.sheet__n { font-family: $font-num; margin-left: 6rpx; opacity: 0.9; }
</style>
