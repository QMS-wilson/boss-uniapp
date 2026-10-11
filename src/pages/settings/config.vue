<template>
  <view class="page config">
    <!--
      ★ 2026-09-23 新增（需求）：「我的 → 系统 → 系统配置」的落地页。
      ★ 2026-09-25 补上第一项配置：库存预警开关（需求：「先不做预警，
        预警要做成系统配置项，决定是否启用」）。
      ★ 2026-09-27 加了第二卡「账套能力」：读的是 V3 账套配置（capabilities.accountOptions），
        只读、不提供开关。批次管理那一行同日撤下（整条批次链路未完工）。
      本机那部分存在 uni storage，不同设备各自生效 —— 是显示偏好，不该写进 V3。
    -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">库存</text>
      </view>
      <view class="row">
        <view class="row__main">
          <text class="row__label">库存下限预警</text>
          <text class="row__desc">开启后，「库存」页对现存量低于该货品下限的记录标橙色。</text>
        </view>
        <!-- 自绘开关：uni-app 的 <switch> 在 H5 端渲染成纯 div（没有 input、
             也不回写 checked 属性），线上没法验收它到底开没开 —— 换自绘后
             「开/关」就是 .tg--on 一个类，DOM 上直接可读。 -->
        <view class="tg" :class="{ 'tg--on': warnOn }" @click="toggle" hover-class="hv-on" :hover-stay-time="80">
          <view class="tg__dot" />
        </view>
      </view>
      <view class="row">
        <view class="row__main">
          <text class="row__label">开单时提示库存不够</text>
          <text class="row__desc">开着：销售单明细那一行会标出「还差几支（账面几支）」，
            没入过库的写「这货品还没有库存记录」。</text>
        </view>
        <view class="tg" :class="{ 'tg--on': stockWarn }" @click="toggleStockWarn" hover-class="hv-on" :hover-stay-time="80">
          <view class="tg__dot" />
        </view>
      </view>
      <view class="row">
        <view class="row__main">
          <text class="row__label">单价 0 元的明细必须记赠品</text>
          <text class="row__desc">开着：销售单上单价填 0 的行要先标成「赠品」才让提交。
            关着：也照旧问一句，但你可以选「就按 0 元」继续提交。</text>
        </view>
        <view class="tg" :class="{ 'tg--on': zeroGift }" @click="toggleZeroGift" hover-class="hv-on" :hover-stay-time="80">
          <view class="tg__dot" />
        </view>
      </view>
    </view>

    <!--
      ★ 2026-09-29 草稿箱：手动草稿只存本机（按 商户码 + 账套 分桶），到期自动清。
        天数是**本机偏好**，与库存预警同理 —— 不写进 V3，也不跨设备同步。
    -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">草稿箱</text>
      </view>
      <view class="row">
        <view class="row__main">
          <text class="row__label">退出开单时询问是否存草稿</text>
          <text class="row__desc">开着：销售/采购单填到一半退出会问一句。关掉：不再问，也不会替你留。</text>
        </view>
        <view class="tg" :class="{ 'tg--on': exitAsk }" @click="toggleExitAsk" hover-class="hv-on" :hover-stay-time="80">
          <view class="tg__dot" />
        </view>
      </view>
      <view class="row">
        <view class="row__main">
          <text class="row__label">草稿保留天数</text>
          <text class="row__desc">超过这个天数的草稿会在下次打开应用时自动清掉，未到期的一律保留。</text>
        </view>
        <picker class="row__pk" mode="selector" :range="ttlLabels" :value="ttlIndex" @change="onTtl">
          <view class="picker-val">
            <text class="picker-val__t">{{ ttlLabels[ttlIndex] }}</text>
            <Icon name="chevron-down" :size="16" />
          </view>
        </picker>
      </view>
    </view>

    <!--
      ★ 2026-10-05 提醒这一卡：只有装到手机上的应用才有"系统通知"这回事，
        所以整卡在 H5 / 小程序里不出现（留着就是一格点了没反应的开关）。
        关掉时不再发通知，但应用里的连接状态照旧看得见。
    -->
    <!-- #ifdef APP-PLUS -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">提醒</text>
      </view>
      <view class="row">
        <view class="row__main">
          <text class="row__label">本地服务掉线时通知我</text>
          <text class="row__desc">开着：原来连着的那台机器上的本地服务连不上了，通知栏会出现一条「本地服务已断开」，写着是哪家、什么时候发现的。</text>
        </view>
        <view class="tg" :class="{ 'tg--on': noticeOn }" @click="toggleNotice" hover-class="hv-on" :hover-stay-time="80">
          <view class="tg__dot" />
        </view>
      </view>
    </view>
    <!-- #endif -->

    <!--
      ★ 2026-09-27：这些是**账套能力**，真源在财鲸 V3 的「系统配置 → 业务开关」
        （UseSerial 等）。这一卡**只读**：我们这边再造一个可写的开关 = 两份配置各读一半，
        迟早出现"这里显示开了、V3 里其实没开"。货品资料页按同一份数据决定显不显示录入项。
    -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">账套能力（读自 V3 系统配置）</text>
      </view>
      <view v-for="it in abilityRows" :key="it.label" class="row">
        <view class="row__main">
          <text class="row__label">{{ it.label }}</text>
          <text class="row__desc">{{ it.desc }}</text>
        </view>
        <text class="st" :class="it.value === true ? 'st--on' : (it.value === false ? '' : 'st--unk')">
          {{ it.value === true ? '已开启' : (it.value === false ? '未开启' : '未读到') }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { toast } from '../../utils/format'
import { accountOptions, loadAccountOptions } from '../../store/options'
import Icon from '../../components/Icon.vue'
import { DRAFT_TTL_OPTIONS, draftTtlDays, setDraftTtlDays, pruneDrafts,
  billExitAsk, setBillExitAsk, billStockWarn, setBillStockWarn,
  billZeroGift, setBillZeroGift } from '../../utils/draftBox'
// #ifdef APP-PLUS
import { agentNoticeOn, setAgentNotice } from '../../utils/agentNotice'
import { askNoticeAuthNow, sendTestNotice } from '../../utils/agentWatch'
// #endif

/** ★ 键与 utils/billExitGuard 共用：默认**开**（draftBox 里写的是「只有 false 才算关」） */
const exitAsk = ref(true)

/** ★ 键与 pages/inventory/index.vue 共用：值只有 true 才算开（缺省即关） */
const KEY = 'cfg:stockWarn'

const warnOn = ref(false)
/** 开单明细那句库存提示（★ 2026-10-10 用户改为**默认关**；与上面「库存下限预警」是两码事，别混） */
const stockWarn = ref(false)
/** 单价 0 元是否必须记赠品（★ 2026-10-10 用户改为**默认开**：判法是 `!== false`，与 stockWarn 相反） */
const zeroGift = ref(true)
// #ifdef APP-PLUS
/** 本地服务掉线的系统通知（**默认开**，判法与 billExitAsk 一致：只有存了 false 才算关） */
const noticeOn = ref(true)
// #endif
const opts = ref(accountOptions())

const ttlLabels = computed(() => DRAFT_TTL_OPTIONS.map((d) => d + ' 天'))
const ttlIndex = ref(0)
function pickTtlIndex() {
  const cur = draftTtlDays()
  const i = DRAFT_TTL_OPTIONS.indexOf(cur)
  // 库里存着一个不在档位上的天数（手改过 storage）：显示成最接近的一档，别显示空白
  ttlIndex.value = i >= 0 ? i : DRAFT_TTL_OPTIONS.findIndex((d) => d >= cur)
}

function onTtl(e) {
  const i = Number(e.detail.value)
  ttlIndex.value = i
  const days = setDraftTtlDays(DRAFT_TTL_OPTIONS[i])
  // 改小天数就当场生效：等到下次启动才清，人会以为没改上
  const dropped = pruneDrafts()
  toast('草稿保留 ' + days + ' 天' + (dropped ? '，已清掉 ' + dropped + ' 条过期的' : ''))
}

const abilityRows = computed(() => [
  // ★ 批次管理这一行**先撤**（2026-09-27 用户点名）：整条批次链路（进货登记批号、
  //   单据选批、库存按批）没完工，这里露出"已开启/未开启"只会让人以为开了就能用。
  //   Agent 仍回传 useBatch（真源在读，零成本），完工时把这一行放回来即可。
  { label: '序列号管理', value: opts.value.useSerial,
    desc: '一物一号用于质保追溯；开启后货品资料出现「记序列号」。' },
])

function toggle() {
  const on = !warnOn.value
  warnOn.value = on
  uni.setStorageSync(KEY, on)
  toast(on ? '已开启库存下限预警' : '已关闭库存下限预警')
}

function toggleExitAsk() {
  // ★ 先把界面上这一格翻过来，再落盘、再按**读回来的值**说话：
  //   滑块停在原位人会以为没点上，连点两下就翻回去了。
  exitAsk.value = !exitAsk.value
  toast(setBillExitAsk(exitAsk.value)
    ? '退出开单时会问一句要不要留草稿'
    : '退出开单不再问，也不会替你留草稿')
}

/** 开单时的库存提示：跟上面同一个路子（先翻界面、再落盘、再按读回来的值说话） */
function toggleStockWarn() {
  stockWarn.value = !stockWarn.value
  toast(setBillStockWarn(stockWarn.value)
    ? '开单明细会标出库存差多少'
    : '开单明细不再提示库存（件数、合计、提交都不受影响）')
}

/** 单价 0 元是否必须记赠品（★ 2026-10-10 用户改为默认开；这个开关只决定"不记赠品让不让提交"） */
function toggleZeroGift() {
  zeroGift.value = !zeroGift.value
  toast(setBillZeroGift(zeroGift.value)
    ? '0 元的明细行必须记成赠品才能提交'
    : '0 元的明细行会问一句，但可以按 0 元提交')
}

// #ifdef APP-PLUS
/**
 * 掉线提醒：翻开这一格就当场把两件事验完 —— 通知权限给没给、通知真发得出去吗。
 * ★ 不等一次真掉线才晓得通不通（装机现场没人等得起）。
 */
function toggleNotice() {
  noticeOn.value = !noticeOn.value
  if (!setAgentNotice(noticeOn.value)) {
    toast('本地服务掉线时不再发通知')
    return
  }
  askNoticeAuthNow().then((granted) => {
    if (!granted) {
      toast('提醒开着，但还没允许这个应用发通知，到设置里允许后恢复')
      return
    }
    sendTestNotice().then((r) => {
      // 结果只走 toast：灰色说明框已按用户要求全部撤掉（2026-10-10），
      // 失败原因没必要再存一份到界面上。
      toast(r.ok ? '已开，通知栏刚发了一条，划开看看' : '提醒开着，但这条没发出去：' + r.reason,
        r.ok ? 'success' : 'none')
    })
  })
}
// #endif

onShow(async () => {
  warnOn.value = uni.getStorageSync(KEY) === true
  exitAsk.value = billExitAsk()
  stockWarn.value = billStockWarn()
  zeroGift.value = billZeroGift()
  // #ifdef APP-PLUS
  noticeOn.value = agentNoticeOn()
  // #endif
  pickTtlIndex()
  opts.value = await loadAccountOptions(true)   // 强制重取：V3 里刚改过开关要能看见
})
</script>

<style lang="scss" scoped>
.config { padding-top: 24rpx; }
.row {
  display: flex; align-items: center; gap: $space-card;
  padding: 26rpx 0;
  border-bottom: 1rpx solid $color-divider;
}
.row__main { flex: 1; min-width: 0; }
.row__label { font-size: $fs-body; font-weight: $fw-bold; }
.row__desc { display: block; margin-top: 8rpx; font-size: $fs-mini; color: $color-text-3; line-height: 1.6; }

/* 天数选择器：与单据页「期间」那格的浅底写法一致，别在这里再造一套灰 */
.row__pk { flex: 0 0 auto; }
.picker-val {
  display: flex; align-items: center; gap: 8rpx;
  padding: 12rpx 20rpx; border-radius: $radius-input; background: $color-bg;
}
.picker-val__t { font-size: $fs-caption; color: $color-text-2; }

/* 自绘开关 */
.tg {
  position: relative;
  flex: 0 0 auto; width: 88rpx; height: 52rpx;
  border-radius: $radius-pill; background: $color-border;
  padding: 4rpx; display: flex; align-items: center;
  transition: background-color $dur-fast $ease-out;
}
/* U6：视觉 52rpx 不变，透明 ::after 上下各外扩 18rpx，把触控热区撑到 88rpx(44px) */
.tg::after {
  content: '';
  position: absolute;
  left: 0; right: 0;
  top: -18rpx; bottom: -18rpx;
}
.tg__dot {
  width: 44rpx; height: 44rpx; border-radius: 50%;
  background: #fff; box-shadow: 0 2rpx 6rpx rgba(21, 36, 59, 0.2);
  transition: transform $dur-fast $ease-out;
}
.tg--on { background: $color-primary; }
.tg--on .tg__dot { transform: translateX(36rpx); }
/* 账套能力的状态：只读，所以是文字而不是开关（避免看着能点） */
.st { flex: 0 0 auto; font-size: $fs-mini; color: $color-text-3; }
.st--on { color: $color-primary-dark; font-weight: $fw-bold; }
.st--unk { color: $color-text-4; }
/* .note（灰色说明框）已按用户要求全部撤掉（2026-10-10）——
   页面上不再有这类说明块，样式一并删除，避免留一段永远不被用到的死样式。 */
</style>
