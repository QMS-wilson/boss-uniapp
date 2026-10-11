<template>
  <view class="page has-action-bar">
    <!-- ★ 两种身份共用这一页：
         · 从单据详情页进来（带 billId）= 打印那张单；
         · 从「我的 → 打印机」进来（不带 billId）= 只想看本机有几台打印机、有哪些版式。
         以前不带 billId 时也照摆「打印 / 版式预览」两颗按钮，结果是**永远灰着、点了不说话**
         —— 假入口。现在无单据就不渲染这些做不了的控件（P0-2）。 -->
    <view v-if="!statusOnly" class="card">
      <view class="row">
        <text class="row__label">单据</text>
        <text class="row__value text-primary">{{ billId }}</text>
      </view>
    </view>
    <view v-else class="card">
      <view class="card__title">本机打印</view>
      <text class="ptr-hint">下面是这台电脑上可用的打印机与 V3 里的打印版式。要打印某张单，请打开那张单，点页面底部的「打印」。</text>
    </view>

    <!-- 打印方式 -->
    <view v-if="!statusOnly" class="card">
      <view class="card__title">打印方式</view>
      <view
        v-for="m in modes" :key="m.value"
        class="opt" :class="{ 'opt--active': mode === m.value }"
        @click="mode = m.value" hover-class="hv-on" :hover-stay-time="80">
        <view class="opt__main">
          <text class="opt__name">{{ m.label }}</text>
          <text class="opt__desc">{{ m.desc }}</text>
        </view>
        <view class="opt__radio" :class="{ 'opt__radio--on': mode === m.value }">
          <Icon v-if="mode === m.value" name="check" :size="14" color="white" />
        </view>
      </view>
      <view class="row row--divided">
        <text class="row__label">打印份数</text>
        <view class="stepper">
          <view class="stepper__btn" @click="decCopies" hover-class="hv-on" :hover-stay-time="80"><text>−</text></view>
          <text class="stepper__val tnum">{{ copies }}</text>
          <view class="stepper__btn" @click="incCopies" hover-class="hv-on" :hover-stay-time="80"><text>+</text></view>
        </view>
      </view>
    </view>

    <!-- 打印机（可选；「直接打印」时才需要） -->
    <view class="card">
      <view class="card__title">打印机</view>
      <LoadState :loading="loading" :error="error" @retry="load">
        <view
          v-for="p in printers" :key="p.name"
          class="opt" :class="{ 'opt--active': !statusOnly && selectedPrinter === p.name }"
          @click="pickPrinter(p.name)" hover-class="hv-on" :hover-stay-time="80">
          <view class="opt__main">
            <text class="opt__name">{{ p.name }}</text>
            <text class="opt__desc">{{ p.isDefault ? '系统默认打印机' : '本机打印机' }}</text>
          </view>
          <view v-if="!statusOnly" class="opt__radio" :class="{ 'opt__radio--on': selectedPrinter === p.name }">
            <Icon v-if="selectedPrinter === p.name" name="check" :size="14" color="white" />
          </view>
        </view>
        <view v-if="printers.length && printerHost.matchedHost" class="ptr-hint">
          打印主机：{{ printerHost.matchedHost }}
        </view>
        <view v-if="!printers.length" class="ptr-hint">{{ emptyHint }}</view>
      </LoadState>
    </view>

    <!-- 打印格式（可选；来自 V3 报表方案 HxSysReport） -->
    <view v-if="formats.length" class="card">
      <view class="card__title">打印格式</view>
      <view
        v-for="f in formats" :key="f.name"
        class="opt" :class="{ 'opt--active': !statusOnly && selectedFormat === f.name }"
        @click="pickFormat(f.name)" hover-class="hv-on" :hover-stay-time="80">
        <view class="opt__main">
          <text class="opt__name">{{ f.name }}</text>
          <text class="opt__desc">{{ f.isDefault ? '默认格式' : (f.custom ? '自定义格式' : '系统格式') }}</text>
        </view>
        <view v-if="!statusOnly" class="opt__radio" :class="{ 'opt__radio--on': selectedFormat === f.name }">
          <Icon v-if="selectedFormat === f.name" name="check" :size="14" color="white" />
        </view>
      </view>
    </view>

    <view class="action-bar">
      <view class="btn-ghost action-bar__item" @click="goBack" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="arrow-left" :size="16" color="text-2" /><text>返回</text>
      </view>
      <template v-if="!statusOnly">
        <view class="btn-ghost action-bar__item" @click="onPreview" hover-class="hv-on" :hover-stay-time="80">
          版式预览
        </view>
        <view class="btn-primary action-bar__item action-bar__item--main" :class="{ 'is-disabled': !canPrint }" @click="onPrint" hover-class="hv-on" :hover-stay-time="80">
          {{ printing ? '发送中…' : '打印' }}
        </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { printApi, capabilityApi } from '../../api/index'
import { toast } from '../../utils/format'
import LoadState from '../../components/LoadState.vue'
import Icon from '../../components/Icon.vue'

const billId = ref('')
/** ★ 2026-10-10：默认值从 'system'（纯文本）改成 'layout'（V3 版式）。
 *  纯文本是"旧行为兼容用"，只发文本报文、版式和 V3 原版不一致 —— 拿它当默认，
 *  用户每打一张单都要手动切一次。V3 版式打印才是这套系统的主路径。 */
const mode = ref('layout')
const copies = ref(1)
const printing = ref(false)
const loading = ref(true)
const error = ref('')
const defaultPrinter = ref('')
const printers = ref([])
/** ★ 2026-09-23：可选打印机 / 打印格式（用户选择项，随打印请求下发） */
const selectedPrinter = ref('')
const selectedFormat = ref('')
const formats = ref([])
/** 打印机配置来源主机：{ hostName, matchedHost, note } */
const printerHost = ref({ hostName: '', matchedHost: '', note: '' })
/** true/false/null（未知）——用于区分「Agent 离线」与「在线但没配打印机」 */
const agentOnline = ref(null)

/** 空列表时不要说错话：Agent 离线 与 在线但没枚举到打印机 是两件事 */
const emptyHint = computed(() => {
  if (agentOnline.value === false) return '本地 Agent 离线，无法读取打印机'
  if (agentOnline.value === true) return '本机未检测到打印机，请到 Windows 里添加打印机'
  return '未获取到打印机信息，请确认本地 Agent 在线'
})

const modes = [
  { value: 'layout', label: 'V3 版式打印', desc: '按 V3 原版版式静默直投，不弹任何对话框' },
  { value: 'system', label: '纯文本打印', desc: '只发送文本报文（旧行为，兼容用）' },
]

const canPrint = computed(() => !!billId.value && !printing.value)

/** 只读身份：不带单据号进来（「我的 → 打印机」）时，这一页只负责"有几台打印机、有哪些版式" */
const statusOnly = computed(() => !billId.value)

/** 选择类控件在只读身份下不生效（没有"要打的那张单"，选了也没东西可下发） */
function pickPrinter(name) { if (!statusOnly.value) selectedPrinter.value = name }
function pickFormat(name) { if (!statusOnly.value) selectedFormat.value = name }

function decCopies() { if (copies.value > 1) copies.value-- }
function incCopies() { if (copies.value < 10) copies.value++ }

async function load() {
  loading.value = true; error.value = ''
  const res = await capabilityApi.get()
  loading.value = false
  if (!res.ok) { error.value = res.message; return }
  // ★★ 只认 toCapabilities 归一后的**扁平字段**。
  //    旧写法 `caps.printers.list || caps.printers.items` 恒为空：
  //    capabilities.printers 是**对象**、且 toCapabilities 已把它折算成**台数**（数字），
  //    在数字上取 .list 得到 undefined → 列表永远空 → 永远显示「0 台」
  //    （本机实有 2 台）。默认机名同样读不到，真实位置是 printers.defaultPrinter。
  //    明细在 printerList（源字段是 printerName，已归一成 name）。
  const caps = res.data || {}
  agentOnline.value = typeof caps.agentOnline === 'boolean' ? caps.agentOnline : null
  defaultPrinter.value = caps.defaultPrinter || ''
  printerHost.value = caps.printerHost || { hostName: '', matchedHost: '', note: '' }
  printers.value = Array.isArray(caps.printerList) ? caps.printerList : []
  // ★ 打印格式：capabilities.printFormats.items 归一后的扁平列表（见 toCapabilities）。
  formats.value = Array.isArray(caps.printFormatList) ? caps.printFormatList : []
  // ★ 默认选中：系统默认打印机优先，其次第一台；格式取 Agent 标的 isDefault。
  //   只在「还没选过」时回填，避免刷新把用户的主动选择冲掉。
  if (!selectedPrinter.value) {
    selectedPrinter.value = defaultPrinter.value
      || (printers.value[0] && printers.value[0].name) || ''
  }
  if (!selectedFormat.value) selectedFormat.value = caps.defaultFormat || ''
}

async function onPrint() {
  if (!canPrint.value) return
  printing.value = true
  // ★ 2026-09-23：把选中的打印机 / 打印格式一起下发（空串 = 走系统默认打印机）。
  const res = await printApi.printBill(
    billId.value, mode.value, copies.value, selectedPrinter.value, selectedFormat.value)
  printing.value = false
  if (res.ok) {
    const d = res.data || {}
    // ★ 成功话术要留"没出纸"的出路：回包只代表报文送到了客户机/打印机，
    //   缺纸卡纸这类现场问题手机上看不见。（modes 只有 layout|system，
    //   旧分支判的 'payload'/'html' 是 mode 改名前的残留死代码，已删。）
    toast(d.message || '已发送至打印机，若未出纸请检查打印机状态', 'success')
  } else {
    toast(res.message || '打印失败')
  }
}

function goBack() { uni.navigateBack() }

/** 版式预览：跳到预览页（由它去调 /print/salesbill/preview 拿图）*/
function onPreview() {
  if (!billId.value) return
  uni.navigateTo({ url: '/pages/print/preview?billId=' + encodeURIComponent(billId.value) })
}

onLoad((q) => {
  billId.value = q.billId || ''
  // 标题跟着身份走：从「我的」进来的是"本机打印机"这块配置，不是"打印这张单"。
  if (!billId.value) uni.setNavigationBarTitle({ title: '本机打印机' })
  load()
})
</script>

<style lang="scss" scoped>
.card__title {
  font-size: $fs-caption;
  font-weight: $fw-bold;
  color: $color-text-3;
  margin-bottom: 6rpx;
}

/* 通用键值行 */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  gap: $space-inner;
}
.row--divided { border-top: 1rpx solid $color-divider; }
.row__label { font-size: $fs-caption; color: $color-text-2; flex: 0 0 auto; }
/* ★ 份数行：步进器收小到 32px 之后，这行**用回默认的 space-between**
   （label 顶左、步进器顶右，是表单里「标签—控件」的标准摆法）。
   上一版把它改成 flex-start + label 撑开是为了掩盖"控件太大"，现在控件小了，
   撑开反而让 label 和控件之间多出一道空隙 ⇒ 撤掉。 */
.row__value {
  font-size: $fs-body;
  font-weight: $fw-bold;
  font-variant-numeric: tabular-nums;
  text-align: right;
  flex: 1;
  min-width: 0;
}

/* 打印方式选项 */
.opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-inner;
  padding: 22rpx 20rpx;
  margin: 0 -#{$space-inner};
  border-radius: $radius-card-sm;
  border-bottom: 1rpx solid $color-divider;
}
.opt:last-of-type { border-bottom: 0; }
.opt--active { background: $color-primary-bg; border-bottom-color: transparent; }
.opt__main { flex: 1; min-width: 0; }
.opt__name { display: block; font-size: $fs-body; font-weight: $fw-bold; }
.opt--active .opt__name { color: $color-primary; }
.opt__desc { display: block; margin-top: 8rpx; font-size: $fs-mini; color: $color-text-3; }
.opt__radio {
  flex: 0 0 auto;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid $color-border;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.opt__radio--on { background: $color-primary; border-color: $color-primary; }

/* 份数步进器
 * ★★ 2026-10-10 第二次修（用户：「还是太大了，− + 按钮太高，改小一点」）
 *   上一版把三个控件连成一体、并保持 88rpx(44px) 触控下限 —— 用户反馈**按钮太高**，
 *   整行被撑得又厚又挤，和上一行「纯文本打印」贴在一起。
 *   这行的定位是**表单里的一个轻量调节项**，不是主操作按钮 ⇒ 按 40px 的
 *   iOS 表单步进器惯例收小：整条 64rpx(32px)，按钮 64rpx 见方，数字格 64rpx 宽。
 *   ★ 为什么敢低于 44px：它是**成对出现的步进器**（± 相邻、误点可逆、无破坏性），
 *     且同一行没有其它可点目标需要区分；WCAG 2.5.8 对这类"邻近且可逆"的控件
 *     给出 24px 的 AA 下限 —— 32px 满足，且和 App 内其它表单控件密度一致。
 *   ★ 真要在意触控，用 padding 扩热区而不是把可见块撑大（本例上下各留 11px 由
 *     .row 的 min-height 吸收，不会挤到相邻行）。 */
.stepper {
  display: flex;
  align-items: center;
  height: 64rpx;
  border-radius: $radius-tag;
  background: $color-bg-sunken;
  overflow: hidden;
  flex: 0 0 auto;
}
.stepper__btn {
  width: 64rpx;
  height: 64rpx;
  color: $color-primary;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  line-height: 1;
}
.stepper__btn:active { background: $color-primary-bg; }
.stepper__val {
  font-family: $font-num;
  font-size: $fs-body;
  font-weight: $fw-heavy;
  min-width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $color-card;
  /* 数字格左右各一条分隔线，把「– | 1 | +」三段切开 */
  border-left: 1rpx solid $color-border;
  border-right: 1rpx solid $color-border;
}

/* 打印机列表 */
.ptr {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 18rpx 0;
  border-top: 1rpx solid $color-divider;
  color: $color-text-3;
}
.ptr__name { font-size: $fs-caption; color: $color-text-2; flex: 1; min-width: 0; }
.ptr__tag {
  flex: 0 0 auto;
  padding: 2rpx 12rpx;
  border-radius: $radius-pill;
  background: $color-primary-bg;
  color: $color-primary;
  font-size: $fs-mini;
  font-weight: $fw-bold;
}
.ptr-hint { padding: 18rpx 0; font-size: $fs-mini; color: $color-text-4; line-height: 1.5; }
.ptr-hint--warn { color: $color-warning; }

/* 底部操作条内的按钮 */
.action-bar__item { flex: 1; }
.action-bar__item--main { flex: 1.4; }
.is-disabled { opacity: 0.5; }
</style>
