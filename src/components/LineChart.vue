<template>
  <view class="chart">
    <view v-if="title || summary" class="chart__head">
      <view class="chart__meta">
        <text class="chart__title">{{ title }}</text>
        <text v-if="subtitle" class="chart__sub">{{ subtitle }}</text>
      </view>
      <view v-if="summary" class="chart__summary">
        <text class="chart__summary-label">{{ summaryLabel }}</text>
        <text class="chart__summary-value">{{ summary }}</text>
      </view>
    </view>

    <!--
      ★★★ 为什么轴标签、数值气泡全部画进 canvas，而不是用 DOM 覆盖层：
      小程序的 `<canvas canvas-id>`（旧版非 type="2d"）是**原生组件**，
      原生组件的层级永远高于页面里的普通 view，z-index 也不起作用。
      ⇒ 之前放在 canvas 之上的 `.chart__yaxis`（Y 轴金额）和 `.chart__peak`（数值气泡）
        在小程序端**被画布整个盖住**（H5 正常，所以只在手机上暴露）。
      唯一能盖在原生组件上面的只有 cover-view/cover-image，但那两者不支持任意样式排版，
      而且 H5 端行为又不一致 ⇒ 结论：**文字一律用 ctx.fillText 画进画布里**，
      DOM 只负责画布**外面**的标题、读数行和 X 轴标签。
    -->
    <view class="chart__canvas">
      <canvas
        class="line-canvas"
        :canvas-id="canvasId"
        :id="canvasId"
        :style="{ width: W + 'px', height: H + 'px' }"
        @click="onCanvasTap"
        @touchstart="onCanvasTouch"
      />
    </view>

    <!-- 读数行：在画布外面，两端表现一致；点哪个显示哪个，默认显示峰值 -->
    <view class="chart__readout" :class="{ 'chart__readout--idle': activeIdx < 0 }">
      <text class="chart__readout-date">{{ readout.date }}</text>
      <text class="chart__readout-val">{{ readout.amount }}</text>
      <text class="chart__readout-extra">{{ readout.extra }}</text>
    </view>

    <!-- X 轴标签（画布下方，不存在遮挡问题） -->
    <view class="chart__axis">
      <text v-for="(l, i) in axisLabels" :key="'l' + i" class="chart__axis-item">{{ l }}</text>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, getCurrentInstance } from 'vue'
import { fmtMoneyGroup } from '../utils/format'

const props = defineProps({
  title: { type: String, default: '销售趋势' },
  subtitle: { type: String, default: '' },
  /** 数据点：[{ label, value, bills }] */
  data: { type: Array, default: () => [] },
  summary: { type: [String, Number], default: '' },
  summaryLabel: { type: String, default: '合计' },
  /**
   * 断档标注带：[{ from, to, label }]，from/to 是 data 数组下标（闭区间）。
   * ★ 趋势按日历补零后，「连续几天没开单」在折线上只是贴底，看不出来；
   *   画一条浅色带 + 文案，才不会被读成「业绩缓慢下滑」。
   */
  gapBands: { type: Array, default: () => [] },
  /** X 轴最多显示几个标签（补零后点数变多，全画会挤成一团） */
  maxLabels: { type: Number, default: 5 },
  /** 每个点的附加读数（如「85 张单」），与 data 同序 */
  extras: { type: Array, default: () => [] },
})

const inst = getCurrentInstance()

// 画布逻辑高（宽由实测容器决定，见 W）
const H = 168
const PAD_L = 52      // 左侧留给 Y 轴刻度文字（画在画布内）
const PAD_R = 10
const PAD_T = 26      // 顶部留出气泡高度，避免峰值气泡压住折线
const PAD_B = 10
const W = ref(320)    // 兜底值；挂载后按容器真实宽度实测

// ★ canvas-id 必须唯一（同页多个图表不能撞）
const canvasId = 'lineChart-' + Math.random().toString(36).slice(2, 9)

const values = computed(() => props.data.map((d) => Number(d.value ?? d.amount ?? 0)))
const labels = computed(() => props.data.map((d) => d.label ?? d.month ?? ''))

/**
 * 刻度取整：峰值 → (step, max)，保证 0/step/2step/3step 都是**整数级好读的数**。
 * ★ 原来直接用「峰值 ÷ 3」当刻度，会出现 8,947.60 / 5,965.07 这种刻度，
 *   读图时还要心算，等于没有刻度。
 */
const scale = computed(() => {
  const peak = Math.max(...values.value, 0)
  if (peak <= 0) return { max: 1, step: 1 }
  const raw = peak / 3
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
  return { max: step * 3, step }
})

function tickText(v) {
  if (v >= 10000) return (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + '万'
  return String(Math.round(v))
}

const innerW = computed(() => W.value - PAD_L - PAD_R)
const innerH = computed(() => H - PAD_T - PAD_B)

/** 数据点归一化到逻辑坐标 */
const points = computed(() => {
  const n = values.value.length
  if (!n) return []
  const peakVal = Math.max(...values.value)
  const peakIdx = values.value.indexOf(peakVal)
  return values.value.map((v, i) => {
    const x = n === 1 ? PAD_L + innerW.value / 2 : PAD_L + (i / (n - 1)) * innerW.value
    const y = PAD_T + innerH.value * (1 - Math.min(v / scale.value.max, 1))
    return { x, y, value: v, highlight: i === peakIdx && i !== activeIdx.value }
  })
})

/** X 轴只画 maxLabels 个（均匀取样，首尾必留） */
const axisLabels = computed(() => {
  const ls = labels.value
  const n = ls.length
  const want = Math.max(2, props.maxLabels || 5)
  if (n <= want) return ls
  const step = (n - 1) / (want - 1)
  const out = []
  for (let i = 0; i < want; i++) out.push(ls[Math.round(i * step)] ?? '')
  return out
})

// ★ 选中态：-1 = 未选，此时读数与气泡都落在峰值上
const activeIdx = ref(-1)
const shownIdx = computed(() => {
  if (!props.data.length) return -1
  if (activeIdx.value >= 0) return activeIdx.value
  const vs = values.value
  return vs.indexOf(Math.max(...vs))
})
const readout = computed(() => {
  const i = shownIdx.value
  if (i < 0) return { date: '—', amount: '—', extra: '' }
  const v = values.value[i] || 0
  // 未选中时读数落在峰值上，明确标出来，用户才知道这不是自己点的
  const tag = activeIdx.value < 0 ? '峰值' : ''
  return {
    date: labels.value[i] || '',
    amount: '¥' + fmtMoneyGroup(v),
    extra: [tag, props.extras[i]].filter(Boolean).join(' · '),
  }
})
watch(() => props.data, () => { activeIdx.value = -1 })

/**
 * ★★★ canvas 绘制的第二个参数必须是 **mp 组件实例**，不能是 Vue 内部实例（2026-09-22 读运行时源码定位）。
 *   · 经典小程序构建里 uni 没有包装 createCanvasContext，直接透传给 wx.createCanvasContext，
 *     微信文档要求「在自定义组件下，第二个参数传入组件实例 this」；
 *   · uni-app 把 mp 组件实例挂在 Vue 实例的 ctx.$scope 上，而 getCurrentInstance() 拿到的是 Vue 内部实例；
 *   · H5 端 `inst.proxy.$scope` 恒为 undefined ⇒ `|| inst` 让 H5 行为不变。
 */
const canvasOwner = (inst && inst.proxy && inst.proxy.$scope) || inst

/** 容器实测宽度：让画布真正铺满卡片（原来写死 320px，宽屏机型右侧留一大块白）。 */
function measure() {
  try {
    const q = uni.createSelectorQuery()
    const scoped = q.in ? q.in(canvasOwner) : q
    scoped.select('.chart__canvas').boundingClientRect((r) => {
      const w = r && Math.round(r.width)
      if (w && w > 120 && Math.abs(w - W.value) > 1) {
        W.value = w
        nextTick(draw)
      }
    }).exec()
  } catch (e) { /* 取不到宽度就沿用兜底值，图形仍然完整 */ }
}

function roundRect(ctx, x, y, w, h, r) {
  // 小程序旧 canvas 没有 roundRect/arcTo 的稳定实现 ⇒ 用「大矩形 + 四角补色」近似，
  // 视觉上足够干净，且不会因 API 缺失而整块不画。
  ctx.fillRect(x, y, w, h)
}

function draw() {
  const ctx = uni.createCanvasContext(canvasId, canvasOwner)
  if (!ctx) return

  ctx.clearRect(0, 0, W.value, H)
  const pts = points.value
  const bottom = H - PAD_B
  const max = scale.value.max

  // ① 网格线 + Y 轴刻度（★ 文字画在画布内：DOM 标签在小程序会被原生 canvas 盖住）
  ctx.setFontSize(9)
  for (let i = 0; i <= 3; i++) {
    const v = scale.value.step * i
    const y = PAD_T + innerH.value * (1 - v / max)
    ctx.beginPath()
    ctx.setStrokeStyle(i === 0 ? '#e1e6ed' : '#edf0f3')
    ctx.setLineWidth(1)
    ctx.moveTo(PAD_L, y)
    ctx.lineTo(W.value - PAD_R, y)
    ctx.stroke()
    ctx.setFillStyle('#8995a5')
    ctx.setTextAlign('right')
    ctx.fillText(tickText(v), PAD_L - 8, y + 3.5)
  }
  ctx.setTextAlign('left')

  // ② 断档带（画在网格之上、折线之下）
  ;(props.gapBands || []).forEach((b, k) => {
    const p1 = pts[b.from]
    const p2 = pts[b.to]
    if (!p1 || !p2) return
    const x0 = Math.min(p1.x, p2.x)
    const w = Math.max(2, Math.abs(p2.x - p1.x))
    ctx.setFillStyle('rgba(232, 149, 47, 0.10)')
    ctx.fillRect(x0, PAD_T, w, innerH.value)
    if (b.label && w > 52 && k === 0) {
      ctx.setFontSize(9)
      ctx.setFillStyle('#c9761f')
      ctx.setTextAlign('center')
      ctx.fillText(b.label, x0 + w / 2, PAD_T - 8)
      ctx.setTextAlign('left')
    }
  })

  if (pts.length) {
    // ③ 面积填充（渐变 0.16 → 0）
    if (pts.length >= 2) {
      const grad = ctx.createLinearGradient(0, PAD_T, 0, bottom)
      grad.addColorStop(0, 'rgba(22, 119, 255, 0.16)')
      grad.addColorStop(1, 'rgba(22, 119, 255, 0)')
      ctx.beginPath()
      ctx.setFillStyle(grad)
      ctx.moveTo(pts[0].x, bottom)
      pts.forEach((p) => { ctx.lineTo(p.x, p.y) })
      ctx.lineTo(pts[pts.length - 1].x, bottom)
      ctx.closePath()
      ctx.fill()
    }

    // ④ 选中点竖向参考线
    const si = shownIdx.value
    if (activeIdx.value >= 0 && pts[si]) {
      ctx.beginPath()
      ctx.setStrokeStyle('#c8ddff')
      ctx.setLineWidth(1)
      ctx.moveTo(pts[si].x, PAD_T)
      ctx.lineTo(pts[si].x, bottom)
      ctx.stroke()
    }

    // ⑤ 折线
    if (pts.length >= 2) {
      ctx.beginPath()
      ctx.setStrokeStyle('#1677ff')
      ctx.setLineWidth(2.2)
      ctx.setLineCap('round')
      ctx.setLineJoin('round')
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y) })
      ctx.stroke()
    }

    // ⑥ 数据点：只画峰值/选中两个，其余不画（补零后一排贴底小圆点只会添乱）
    const mark = (p, big) => {
      ctx.beginPath()
      ctx.setFillStyle('#ffffff')
      ctx.arc(p.x, p.y, big ? 4.5 : 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.setStrokeStyle('#1677ff')
      ctx.setLineWidth(big ? 3 : 2.4)
      ctx.arc(p.x, p.y, big ? 4.5 : 4, 0, Math.PI * 2)
      ctx.stroke()
    }
    pts.forEach((p, i) => {
      if (i === si) mark(p, true)
      else if (p.highlight) mark(p, false)
    })

    // ⑦ 数值气泡（★ 画在画布里，且贴边/贴顶自动翻转，绝不与折线重叠）
    if (pts[si]) {
      const p = pts[si]
      const txt = (labels.value[si] || '') + '  ¥' + fmtMoneyGroup(p.value)
      let tw = txt.length * 6.2
      try {
        if (ctx.measureText) tw = ctx.measureText(txt).width || tw
      } catch (e) { /* 用估算宽度兜底 */ }
      const bw = Math.min(tw + 16, W.value - PAD_L - 4)
      const bh = 22
      let bx = p.x - bw / 2
      if (bx < PAD_L) bx = PAD_L
      if (bx + bw > W.value - PAD_R) bx = W.value - PAD_R - bw
      let by = p.y - bh - 10
      if (by < 2) by = p.y + 12          // 顶部放不下就翻到点下方
      ctx.setFillStyle('rgba(32, 43, 59, 0.92)')
      roundRect(ctx, bx, by, bw, bh, 6)
      ctx.setFontSize(10)
      ctx.setFillStyle('#ffffff')
      ctx.setTextAlign('center')
      ctx.fillText(txt, bx + bw / 2, by + 15)
      ctx.setTextAlign('left')
    }
  }

  ctx.draw()
}

/**
 * ★ 延时补测的 handle 必须留着：
 *   这一枪 260ms 后才跑，而用户完全可能在这 260ms 内就退出报表页（返回/切页）。
 *   不清理的话，组件已卸载、`.chart__canvas` 已不在，`measure()` 仍会去
 *   createSelectorQuery 取一个不存在的节点；长会话里反复进出报表页会一直累积。
 */
let measureTimer = null

onMounted(() => {
  nextTick(() => { measure(); draw() })
  // 容器宽度可能在首帧布局后才稳定，再补一次
  measureTimer = setTimeout(measure, 260)
})
onUnmounted(() => {
  if (measureTimer) { clearTimeout(measureTimer); measureTimer = null }
})
watch([points, scale, shownIdx, () => props.gapBands], () => { nextTick(draw) }, { deep: true })

/**
 * ★★★ 一次手势只能生效一次（2026-09-25 修「点完松手就弹回初始位置」）：
 *   触屏上浏览器/小程序都会在一次轻点后**补发一次 click**，而 click 与 touchstart
 *   分属两个宏任务 —— 原来用 `setTimeout(..., 0)` 复位去重标记，
 *   标记在 click 到达前就已经被清掉了 ⇒ touchstart 选中、click 又把它 toggle 回去，
 *   看起来就是「松手自动回到初始位置」。
 *   现在：① H5 端 touch 直接不处理（H5 的 Touch.x 是**视口坐标**不是画布坐标，
 *            差一个 rect.left，本来就会点歪；而 H5 必定补发 click，交给它）；
 *        ② 小程序端只认 touchstart（Touch.x 相对画布左上角，坐标系与绘制一致），
 *            并用时间窗挡掉随后补发的 tap。
 */
let lastTouchAt = 0

/** 把「画布内 x（逻辑像素）」落到最近的数据点上。 */
function applyTapX(rawX) {
  const logicalX = Math.max(0, Math.min(W.value, rawX))
  let nearest = 0
  let minDist = Infinity
  points.value.forEach((p, i) => {
    const d = Math.abs(p.x - logicalX)
    if (d < minDist) { minDist = d; nearest = i }
  })
  activeIdx.value = activeIdx.value === nearest ? -1 : nearest
  nextTick(draw)
}

function onCanvasTouch(e) {
  // #ifdef H5
  return
  // #endif
  const t = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0])
  if (!t || typeof t.x !== 'number' || !Number.isFinite(t.x)) return
  lastTouchAt = Date.now()
  applyTapX(t.x)
}

/**
 * 整图点击 → 就近命中数据点（H5 主路径：鼠标与触屏都收敛到这一个事件）。
 * ★ 坐标用 clientX − canvas 自身 rect 换算：不能拿外层容器宽度算，
 *   外层 .chart__canvas 会被 CSS 撑到整页宽，而画布宽度是实测的 W。
 */
function onCanvasTap(e) {
  if (!points.value.length) return
  if (Date.now() - lastTouchAt < 800) return   // 触屏补发的幽灵 click

  let baseRect = null
  try {
    if (typeof document !== 'undefined') {
      const cv = document.querySelector('canvas.uni-canvas-canvas')
        || document.querySelector('.line-canvas canvas')
        || document.querySelector('canvas')
      if (cv && cv.getBoundingClientRect) baseRect = cv.getBoundingClientRect()
    }
  } catch (err) { /* 下面还有 offsetX 兜底 */ }

  let x = null
  if (e) {
    let clientX = null
    const t = e.touches && e.touches.length ? e.touches[0] : null
    if (t && typeof t.clientX === 'number') clientX = t.clientX
    else if (typeof e.clientX === 'number' && Number.isFinite(e.clientX)) clientX = e.clientX
    if (clientX !== null && baseRect && baseRect.width > 0) {
      x = (clientX - baseRect.left) * (W.value / baseRect.width)
    } else if (typeof e.offsetX === 'number' && Number.isFinite(e.offsetX)) {
      x = e.offsetX
    }
  }
  if (x === null || !Number.isFinite(x)) return
  applyTapX(x)
}

defineExpose({ draw, measure })
</script>

<style lang="scss" scoped>
.chart { padding: 30rpx 28rpx 22rpx; }

.chart__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20rpx; }
.chart__meta { min-width: 0; }
.chart__title { display: block; font-size: $fs-subtitle; font-weight: $fw-bold; color: $color-text; }
.chart__sub { display: block; font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.chart__summary { text-align: right; flex: 0 0 auto; }
.chart__summary-label { display: block; font-size: $fs-micro; color: $color-text-3; }
.chart__summary-value {
  display: block; font-family: $font-num; font-size: $fs-subtitle; font-weight: $fw-heavy;
  color: $color-text; margin-top: 4rpx; font-variant-numeric: tabular-nums;
}

/* 画布容器：撑满卡片宽度，canvas 自身按实测宽度绘制 */
.chart__canvas { position: relative; margin-top: 18rpx; width: 100%; overflow: hidden; }
.line-canvas { display: block; }

/* 读数行（画布外，两端一致，不会被原生组件遮挡） */
.chart__readout {
  display: flex; align-items: baseline; gap: 14rpx;
  margin-top: 16rpx; padding: 14rpx 18rpx;
  background: $color-primary-bg; border-radius: $radius-card-sm;
}
.chart__readout--idle { background: $color-bg; }
.chart__readout-date { font-size: $fs-mini; color: $color-text-2; font-variant-numeric: tabular-nums; }
.chart__readout-val {
  font-family: $font-num; font-size: $fs-subtitle; font-weight: $fw-heavy; color: $color-primary;
  font-variant-numeric: tabular-nums;
}
.chart__readout-extra { flex: 1; text-align: right; font-size: $fs-micro; color: $color-text-3; }

.chart__axis { display: flex; justify-content: space-between; margin-top: 10rpx; }
.chart__axis-item { font-size: $fs-micro; color: $color-text-4; font-variant-numeric: tabular-nums; }
</style>
