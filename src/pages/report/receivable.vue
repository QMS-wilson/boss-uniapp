<template>
  <view class="page recv">
    <LoadState :loading="loading" :error="error" :offline="offline" :cached-at="cachedAt" @retry="load">
      <view class="hello">
        <view class="hello__l">
          <text class="hello__title">应收明细</text>
          <text class="hello__sub">{{ countLabel }} · 未结应收（按客户档案的未结金额）</text>
        </view>
        <view class="hello__stamp">
          <text class="hello__stamp-k">合计</text>
          <text class="hello__stamp-v">¥{{ fmtMoneyGroup(data.total) }}</text>
        </view>
      </view>

      <!-- 三格 -->
      <view class="tri">
        <view class="tri__c">
          <text class="metric-label">未结应收合计</text>
          <text class="tri__v">¥{{ fmtMoneyGroup(data.total) }}</text>
        </view>
        <view class="tri__c tri__c--hot">
          <text class="metric-label">90天以上</text>
          <text class="tri__v tri__v--d">¥{{ fmtMoneyGroup(b90.amount) }}</text>
          <text class="tri__n">{{ b90.customers || 0 }} 家未动单</text>
        </view>
        <view class="tri__c">
          <text class="metric-label">最大一家</text>
          <text class="tri__v">¥{{ fmtMoneyGroup(topOne.balance) }}</text>
          <text class="tri__n">{{ topOne.customerName || '—' }}</text>
          <StopTag kind="customer" :code="topOne.customerId"
                   :label="topOne.stopped ? (topOne.statusName || '暂停往来') : ''" />
        </view>
      </view>

      <!-- 账龄筛选 -->
      <view class="chips">
        <view
          class="chip" :class="{ 'chip--on': aging === '' }"
          @click="setAging('')" hover-class="hv-on" :hover-stay-time="80">全部 {{ data.count }} 家</view>
        <view
          v-for="b in data.aging" :key="b.key"
          class="chip" :class="{ 'chip--on': aging === b.key }"
          @click="setAging(b.key)" hover-class="hv-on" :hover-stay-time="80">{{ b.label }} {{ b.customers }}</view>
        <view class="chip chip--stop" :class="{ 'chip--on': showStopped }" @click="toggleStopped" hover-class="hv-on" :hover-stay-time="80">
          显示已停用
        </view>
      </view>
      <text class="chips__hint">{{ agingNote }}</text>
      <!-- ★ 合计是全量、列表默认少列几家 ⇒ 差额必须当场说出来，不然"合计比加起来大"看着像算错 -->
      <text v-if="hiddenNote" class="chips__hint chips__hint--warn">{{ hiddenNote }}</text>

      <!-- 列表 -->
      <view v-if="list.length" class="list">
        <view
          v-for="(c, i) in list" :key="c.customerId + i"
          class="row" :class="enterClass(i)" :style="enterStyle(i)" @click="goStatement(c)" hover-class="hv-on" :hover-stay-time="80">
          <view class="row__l">
            <view class="row__nm-line">
              <text class="row__nm ellipsis">{{ c.customerName }}</text>
              <StopTag kind="customer" :code="c.customerId"
                       :label="c.stopped ? (c.statusName || '暂停往来') : ''" />
            </view>
            <text class="row__meta">{{ c.customerId }} · 最后出货 {{ c.lastShipDate || '—' }}</text>
          </view>
          <view class="row__r">
            <text class="row__amt" :class="{ 'row__amt--zero': !c.balance }">¥{{ fmtMoneyGroup(c.balance) }}</text>
            <view class="badge" :class="'badge--' + badgeKind(c.daysSince)">
              {{ c.daysSince === null ? '无出货记录' : (c.daysSince <= 30 ? '30天内' : c.daysSince + ' 天未动单') }}
            </view>
          </view>
        </view>
      </view>
      <EmptyState v-else-if="!loading" icon="inbox" text="没有符合条件的客户" sub="换个账龄段或清空搜索试试" />

      <!-- 截断提示：后端有行数上限时不能说「这就是全部」 -->
      <view v-if="data.truncated" class="trunc">
        <text>共匹配 {{ data.matchedCount }} 家，当前只显示前 {{ list.length }} 家。「导出」导的是这前 {{ list.length }} 家，不是全部。</text>
      </view>

      <view class="btns">
        <view class="btn-ghost btns__b" @click="doExport" hover-class="hv-on" :hover-stay-time="80">
          <Icon name="file-text" :size="16" color="text-2" /><text>导出 CSV</text>
        </view>
        <view class="btn-primary btns__b" @click="goStatement(list[0])" hover-class="hv-on" :hover-stay-time="80"><text>给最大一家做对账单</text></view>
      </view>
      <view class="bottom-gap" />
    </LoadState>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onUnload, onPullDownRefresh } from '@dcloudio/uni-app'
import { receivableApi } from '../../api/index'
import { cancelByScope } from '../../utils/request'
import { fmtMoneyGroup } from '../../utils/format'
import { exportCsv } from '../../utils/export'
import LoadState from '../../components/LoadState.vue'
import EmptyState from '../../components/EmptyState.vue'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'
import { useEnterStagger } from '../../utils/enterStagger'

/** 首屏前 8 行错峰到位；翻页/刷新/切档不重播（见 utils/enterStagger.js） */
const { armEnter, enterClass, enterStyle } = useEnterStagger()

const loading = ref(true)
const error = ref('')
/** 断网时回的是缓存 ⇒ 必须标出来（与 sales/list 同款），否则旧数看着像实时 */
const offline = ref(false)
const cachedAt = ref(0)
const aging = ref('')
/** 「显示已停用」：只决定列不列暂停往来的客户。**合计一直是全量**（钱不会因为停用就消失）。 */
const showStopped = ref(false)
const data = ref({ total: 0, count: 0, aging: [], list: [], matchedCount: 0, truncated: false, agingNote: '' })

const list = computed(() => data.value.list || [])
const b90 = computed(() => (data.value.aging || []).find((b) => b.key === '90+') || { customers: 0, amount: 0 })
const topOne = computed(() => list.value[0] || {})
const countLabel = computed(() => {
  const hit = (data.value.aging || []).find((b) => b.key === aging.value)
  return hit ? `${hit.label} ${hit.customers} 家` : `${list.value.length} 家客户`
})
const agingNote = computed(() => data.value.agingNote || '')
const hiddenNote = computed(() => {
  const hid = data.value.stoppedHidden
  if (!hid || !hid.count) return ''
  return `另有 ${hid.count} 家暂停往来的客户挂着的应收（¥${fmtMoneyGroup(hid.amount)}）已计入合计，`
    + '没列在下面 —— 点「显示已停用」把它们调出来。'
})

function toggleStopped() {
  showStopped.value = !showStopped.value
  load()
}

function badgeKind(days) {
  if (days === null || days === undefined) return 'n'
  // ★ 「30 天内」用主色(操作色)会让整列都像可点，且当前账套 43 家几乎全 ≤30 天 ⇒ 100% 蓝、
  //   零区分度。正常段改中性灰，只有「30~90 天」琥珀、「90 天以上」红保留警示色。
  if (days <= 30) return 'n'
  if (days <= 90) return 'w'
  return 'd'
}

async function load() {
  loading.value = true
  error.value = ''
  const res = await receivableApi.detail({ aging: aging.value, pageSize: 300, showStopped: showStopped.value })
  loading.value = false
  if (res.ok) {
    offline.value = !!res.offline
    cachedAt.value = res.cachedAt || 0
    data.value = res.data
    armEnter()
  } else error.value = res.message || '应收明细加载失败'
}

function setAging(key) {
  if (aging.value === key) return
  aging.value = key
  load()
}

function goStatement(c) {
  if (!c || !c.customerId) return
  uni.navigateTo({
    url: `/pages/report/reconcile?customerId=${encodeURIComponent(c.customerId)}&name=${encodeURIComponent(c.customerName || '')}`,
  })
}

function doExport() {
  exportCsv(
    `应收明细_${aging.value || '全部'}_${new Date().toISOString().slice(0, 10)}`,
    ['客户编号', '客户名称', '未结应收(负=预收)', '最后出货日', '未动单天数', '账龄段'],
    list.value.map((c) => [c.customerId, c.customerName, c.balance, c.lastShipDate, c.daysSince, c.agingKey]),
  )
}

onLoad((q) => {
  if (q && q.aging) aging.value = String(q.aging)
  load()
})
// pages.json 里配了 enablePullDownRefresh 却一直没有处理器（下拉菊花收不回去）——补上
onPullDownRefresh(async () => { await load(); uni.stopPullDownRefresh() })
onUnload(() => cancelByScope('report'))
</script>

<style lang="scss" scoped>
.recv { padding-bottom: 40rpx; }

.hello { margin-bottom: $space-gap; display: flex; align-items: flex-start; justify-content: space-between; gap: 16rpx; }
.hello__l { flex: 1; min-width: 0; }
.hello__title { display: block; font-size: 44rpx; font-weight: $fw-heavy; letter-spacing: -1rpx; }
.hello__sub { display: block; font-size: $fs-mini; color: $color-text-3; margin-top: 8rpx; }
.hello__stamp { flex: 0 0 auto; text-align: right; padding-top: 6rpx; }
.hello__stamp-k { display: block; font-size: $fs-micro; color: $color-text-4; }
.hello__stamp-v { display: block; font-family: $font-num; font-size: $fs-caption; color: $color-text-2; font-weight: $fw-bold; margin-top: 4rpx; }

.tri { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: $space-inner; }
.tri__c {
  background: $color-card; border-radius: $radius-card; padding: 22rpx 20rpx;
  box-shadow: $shadow-card; display: flex; flex-direction: column;
}
.tri__c--hot { background: $color-danger-bg; box-shadow: none; }
.tri__v {
  font-family: $font-num; font-size: 28rpx; font-weight: $fw-heavy;
  margin-top: 10rpx; font-variant-numeric: tabular-nums;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tri__v--d { color: $color-danger; }
.tri__n { font-size: $fs-micro; color: $color-text-3; margin-top: 6rpx; }

.chips { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: $space-gap; }
.chip {
  font-size: $fs-mini; color: $color-text-2; background: $color-card;
  border-radius: $radius-pill; padding: 10rpx 24rpx; box-shadow: $shadow-card;
}
.chip--on { background: $color-primary; color: #fff; font-weight: $fw-bold; }
/* 「显示已停用」与账龄那几格不是一类东西（那是选段、这是选要不要看停用），
   所以给它一圈虚线边区分开，免得看着像第二个账龄段。
   ★ 两条规则特异性相同，谁写在后面谁赢 —— 早先 .chip--stop 写在 .chip--on 后面，
     结果**点亮了背景还是灰的**（截图才发现：开关明明生效了，看着像没按）。
     开启态必须用 .chip--stop.chip--on 两条类名压一层，才盖得住。 */
.chip--stop { border: 1rpx dashed $color-border; background: $color-bg-sunken; }
.chip--stop.chip--on {
  background: $color-primary; color: #fff; font-weight: $fw-bold; border-style: solid;
}
.chips__hint { display: block; margin-top: 14rpx; font-size: $fs-micro; color: $color-text-4; line-height: 1.6; }
.chips__hint--warn { color: $color-warning; }

.list { margin-top: $space-gap; background: $color-card; border-radius: $radius-card; box-shadow: $shadow-card; padding: 0 28rpx; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 20rpx; padding: 26rpx 0; border-bottom: 1rpx solid $color-divider; }
.row:last-child { border-bottom: 0; }
.row__l { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.row__nm { font-size: $fs-body; font-weight: $fw-bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row__nm-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.row__meta { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; font-variant-numeric: tabular-nums; }
.row__r { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; }
.row__amt { font-family: $font-num; font-size: $fs-body; font-weight: $fw-heavy; font-variant-numeric: tabular-nums; }
/* 零应收不制造假警报：淡灰、不加粗（0 不是风险，红/重都是噪音） */
.row__amt--zero { color: $color-text-3; font-weight: $fw-normal; }
.badge { font-size: $fs-micro; font-weight: $fw-bold; border-radius: 8rpx; padding: 3rpx 12rpx; margin-top: 8rpx; }
.badge--i { background: $color-primary-bg; color: $color-primary; }
.badge--w { background: $color-warning-bg; color: $color-warning; }
.badge--d { background: $color-danger-soft-bg; color: $color-danger; }
.badge--n { background: $color-bg-sunken; color: $color-text-3; }

.trunc { margin-top: $space-inner; padding: 18rpx 24rpx; background: $color-warning-bg; border-radius: $radius-card-sm; font-size: $fs-mini; color: $color-warning-text; }

.btns { display: flex; gap: 16rpx; margin-top: $space-gap; }
.btns__b { flex: 1; height: 88rpx; }
.bottom-gap { height: 40rpx; }
</style>
