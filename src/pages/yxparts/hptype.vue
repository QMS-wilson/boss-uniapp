<template>
  <view class="page hptype">
    <!--
      ★ 2026-10-09 新增（方案 P2）：客户品名库维护入口 —— **本期只做骨架**。
        能看的：本账套物料库现状（HPKhType / hpdan 行数、客户类别编号）+ 匹配记忆列表（可删）。
        下期再做：真正的"导入燕秀品名"录入界面（接口 yxparts.importCustomers 已就绪）。
      ★ 为什么先做这一页：客户品名库（HPKhType）现在是 0 行，匹配必然零命中。
        没有这一页，用户看到"全部未匹配"时没有一个能去的地方。
    -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">客户品名库</text>
      </view>
      <text class="intro">本账套里"客户怎么写 → 系统哪个货品"的对照。匹配就是拿客户单上的
        「零件名称 + 采购规格」来这张表里找。</text>
    </view>

    <view class="card">
      <view class="section-head">
        <text class="section-head__title">物料库现状</text>
      </view>
      <view v-if="loadingCaps" class="msg msg--info"><text>正在读取…</text></view>
      <view v-else-if="capsErr" class="msg msg--err"><text>{{ capsErr }}</text></view>
      <view v-else class="stat">
        <view class="stat__row">
          <text class="stat__k">本账套</text>
          <text class="stat__v">{{ caps.database || '—' }}</text>
        </view>
        <view class="stat__row">
          <text class="stat__k">客户品名（HPKhType）</text>
          <text class="stat__v" :class="{ 'stat__v--bad': !caps.hpkhTypeRows }">{{ caps.hpkhTypeRows }} 条</text>
        </view>
        <view class="stat__row">
          <text class="stat__k">货品档案（Hpdan）</text>
          <text class="stat__v">{{ caps.hpdanRows }} 条</text>
        </view>
        <view class="stat__row">
          <text class="stat__k">客户类别编号</text>
          <text class="stat__v">{{ caps.lbtypeKh || '—' }}</text>
        </view>
        <view class="stat__row">
          <text class="stat__k">匹配记忆</text>
          <text class="stat__v">{{ caps.memoryRows }} 条</text>
        </view>
      </view>
      <view v-if="caps && !caps.hpkhTypeRows" class="msg msg--warn">
        <text>客户品名库还是空的：现在是 0 行，所以任何清单都匹配不上。</text>
        <text>下期在这里做"导入燕秀品名"；在此之前，可以先用电脑端的「燕秀零件处理 → 导入燕秀品名」铺数据。</text>
      </view>
    </view>

    <!-- 导入燕秀品名：选模板 → 预检预览 → 确认写入 HPKhType -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">导入燕秀品名</text>
      </view>
      <text class="intro">模板列：货品名称 ｜ 客户品名 ｜ 采购规格 ｜ 实际尺寸。
        系统按「货品名称」去货品档案取编号/单位，再把客户的叫法写进客户品名库。</text>

      <!-- 客户类别（写库必填；触发器会校验它存在） -->
      <view class="stat__row">
        <text class="stat__k">客户类别</text>
        <view id="btn-pick-lbtype" class="lbpick" @click="showLbPicker = true" hover-class="hv-on" :hover-stay-time="80">
          <text class="lbpick__v">{{ lbtypeText }}</text>
          <Icon name="chevron-right" :size="14" />
        </view>
      </view>

      <view id="btn-import-hptype" class="pick" @click="pickFile" hover-class="hv-on" :hover-stay-time="80">
        <view class="pick__icon"><Icon name="file-text" :size="22" color="primary" /></view>
        <view class="pick__main">
          <text class="pick__t">从燕秀模板导入</text>
          <text class="pick__d">{{ file ? file.name : pickHint }}</text>
        </view>
        <Icon name="chevron-right" :size="16" />
      </view>

      <view v-if="parsing || importing" class="msg msg--info">
        <text>{{ importing ? '正在写入…' : '正在预检…' }}</text>
      </view>
      <view v-if="importErr" class="msg msg--err"><text>{{ importErr }}</text></view>

      <!-- 预检结果：先看再写（一行都不写库） -->
      <view v-if="preview">
        <view class="sum">
          <view class="sum__item">
            <text class="sum__v tnum">{{ preview.summary.total }}</text>
            <text class="sum__k">模板行</text>
          </view>
          <view class="sum__item">
            <text class="sum__v tnum">{{ preview.summary.importable }}</text>
            <text class="sum__k">可导入</text>
          </view>
          <view class="sum__item">
            <text class="sum__v tnum">{{ preview.summary.exists }}</text>
            <text class="sum__k">已存在</text>
          </view>
          <view class="sum__item">
            <text class="sum__v tnum">{{ preview.summary.failed }}</text>
            <text class="sum__k">有问题</text>
          </view>
        </view>

        <scroll-view class="prev" scroll-x>
          <view class="prev__inner prev__inner--wide">
            <view class="prev__row prev__row--head">
              <text class="col col--sys">货品名称</text>
              <text class="col col--cust">客户品名</text>
              <text class="col col--spec">采购规格</text>
              <text class="col col--act">实际尺寸</text>
              <text class="col col--code">编号</text>
              <text class="col col--unit">单位</text>
              <text class="col col--st">状态</text>
            </view>
            <view v-for="(r, i) in preview.rows" :key="i" class="prev__row">
              <text class="col col--sys">{{ r.goodsName || '—' }}</text>
              <text class="col col--cust">{{ r.custName || '—' }}</text>
              <text class="col col--spec">{{ r.spec || '—' }}</text>
              <text class="col col--act">{{ r.actual || '—' }}</text>
              <text class="col col--code">{{ r.hpbh || '—' }}</text>
              <text class="col col--unit">{{ r.unit || '—' }}</text>
              <text class="col col--st" :class="statusClass(r.status)">{{ r.status }}</text>
            </view>
          </view>
        </scroll-view>
        <text v-if="preview.summary.failed" class="prev__more">
          标"失败"的行不会写库：货品名称在货品档案里查不到，或缺少客户品名 —— 先在模板里改掉再传一次。
        </text>
        <text v-if="preview.summary.exists" class="prev__more">
          "已存在"按主键判重（客户类别 + 货品编号 + 单位）：同一货品+单位已经有记录了，
          想改客户写法请先删掉原记录。
        </text>

        <view class="btn-row">
          <view id="btn-import-confirm" class="btn btn--primary"
                :class="{ 'btn--off': !preview.summary.importable || importing }" @click="confirmImport" hover-class="hv-on" :hover-stay-time="80">
            <text>{{ importing ? '写入中…' : ('确认导入 ' + preview.summary.importable + ' 行') }}</text>
          </view>
        </view>
      </view>

      <view v-if="importResult" class="msg msg--info">
        <text>导入完成：新增 {{ importResult.inserted }} 行，已存在跳过 {{ importResult.skippedDup + importResult.skippedPk }} 行，
          失败 {{ importResult.failed.length }} 行。</text>
      </view>
      <view class="note">
        <text>模板格式与电脑端「导入燕秀品名」完全一致；写入时会走 V3 触发器校验
          （客户类别必须存在、货品+计量单位必须在档案里）。</text>
      </view>
    </view>

    <!-- 客户类别选择 -->
    <view v-if="showLbPicker" class="mask" @click="showLbPicker = false">
      <view class="sheet" @click.stop>
        <view class="section-head"><text class="section-head__title">选择客户类别</text></view>
        <scroll-view class="cand-list" scroll-y>
          <view v-for="(t, i) in lbtypes" :key="i" class="cand" @click="pickLbtype(t)" hover-class="hv-on" :hover-stay-time="80">
            <text class="cand__t">{{ t.text || t.key }}</text>
            <text class="cand__s">{{ t.key }}</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <view class="card">
      <view class="section-head">
        <text class="section-head__title">匹配记忆</text>
      </view>
      <text class="intro">人工确认过的"客户写法 → 货品编号"。重复出现的写法会自动命中这里。</text>
      <view v-if="loadingMem" class="msg msg--info"><text>正在读取…</text></view>
      <view v-else-if="memErr" class="msg msg--err"><text>{{ memErr }}</text></view>
      <view v-else-if="!memories.length" class="msg msg--warn"><text>还没有记忆。先在清单页把未匹配的行确认一次。</text></view>
      <view v-else>
        <view v-for="m in memories" :key="m.id" class="mem">
          <view class="mem__main">
            <text class="mem__t">{{ m.customer_name || '（无写法）' }}</text>
            <text class="mem__s">hpbh {{ m.code || '—' }} ｜ 单位 {{ m.unit || '—' }} ｜ 命中 {{ m.match_count }} 次</text>
            <text class="mem__s">{{ m.last_used || '' }}</text>
          </view>
          <text class="mem__del" @click="removeMemory(m)">删除</text>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="section-head">
        <text class="section-head__title">说明</text>
      </view>
      <view class="note">
        <text>· 这一页管的是本机 Agent 的本地记忆（logs/yx_matchlib.db），换手机不会丢。</text>
        <text>· 客户品名库存在业务库里（HPKhType），由客户自己维护；写入时会走 V3 的触发器校验（客户类别、货品+单位）。</text>
      </view>
    </view>

    <view class="bottom-gap" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { toast } from '../../utils/format'
import { yxApi } from '../../api/yxparts'
import { payloadForOp } from '../../utils/yxExcel'
import Icon from '../../components/Icon.vue'

const caps = ref(null)
const capsErr = ref('')
const loadingCaps = ref(false)

/* ---------------- 导入燕秀品名 ---------------- */
const lbtypes = ref([])
const lbtype = ref('')
const showLbPicker = ref(false)
const file = ref(null)          // { name, size }
let rawFile = null              // H5: File 对象
let rawPath = ''                // 小程序: tempFilePath
const parsing = ref(false)
const importing = ref(false)
const importErr = ref('')
const preview = ref(null)       // { rows, summary, lbtypeKh }
const importResult = ref(null)

const lbtypeText = computed(() => {
  const hit = lbtypes.value.find((t) => t.key === lbtype.value)
  return hit ? ((hit.text || hit.key) + '（' + hit.key + '）') : (lbtype.value || '未设置')
})

const pickHint = computed(() => {
  // #ifdef H5
  return '支持 .xls / .xlsx，从手机文件里选'
  // #endif
  // #ifdef MP-WEIXIN
  return '支持 .xls / .xlsx，从微信聊天记录里选'
  // #endif
  // #ifndef H5 || MP-WEIXIN
  return '支持 .xls / .xlsx'
  // #endif
})

function statusClass(status) {
  if (status === '可导入' || status === '已导入') return 'col--ok'
  if (status === '已存在') return 'col--manual'
  return 'col--bad'
}

function pickLbtype(t) {
  lbtype.value = t.key
  showLbPicker.value = false
  if (preview.value) preview.value = null      // 换类别要重新预检
}

/* 选文件：H5 用原生 input（uni-app 的 <input> 不支持 type=file），小程序用 chooseMessageFile */
function pickFile() {
  importErr.value = ''
  importResult.value = null
  // #ifdef H5
  try {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.xls,.xlsx'
    el.style.display = 'none'
    el.onchange = (e) => {
      const f = e && e.target && e.target.files && e.target.files[0]
      if (f) readH5(f)
      if (el.parentNode) document.body.removeChild(el)
    }
    document.body.appendChild(el)
    el.click()
  } catch (e) {
    importErr.value = '打不开文件选择器：' + String((e && e.message) || e)
  }
  return
  // #endif
  // #ifdef MP-WEIXIN
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['xls', 'xlsx'],
    success: (res) => {
      const f = (res.tempFiles || [])[0]
      if (f) readMp(f)
    },
    fail: (e) => {
      const msg = String((e && e.errMsg) || '')
      if (msg.indexOf('cancel') >= 0) return
      importErr.value = '选择文件失败：' + msg
    },
  })
  return
  // #endif
  // #ifndef H5 || MP-WEIXIN
  toast('当前平台暂不支持选择文件')
  // #endif
}

async function readH5(f) {
  try {
    const buf = typeof f.arrayBuffer === 'function' ? await f.arrayBuffer() : null
    if (!buf) throw new Error('读文件失败')
    await runPreview(f.name, f.size, buf)
  } catch (e) {
    importErr.value = String((e && e.message) || e)
  }
}

async function readMp(f) {
  try {
    const buf = await new Promise((resolve, reject) => {
      uni.getFileSystemManager().readFile({
        filePath: f.path,
        success: (r) => resolve(r.data),
        fail: (e) => reject(new Error((e && e.errMsg) || '读文件失败')),
      })
    })
    await runPreview(f.name, f.size, buf)
  } catch (e) {
    importErr.value = String((e && e.message) || e)
  }
}

/** 读文件 → 矩阵（App 只做这一步）→ 交 Agent 预检 */
async function runPreview(name, size, buf) {
  file.value = { name: String(name || ''), size: Number(size || 0) }
  preview.value = null
  parsing.value = true
  importErr.value = ''
  try {
    const res = await yxApi.importPreview(payloadForOp(buf), lbtype.value)
    if (!res || !res.ok) {
      const err = (res && res.error) || {}
      importErr.value = String(err.message || '预检失败')
      if (err.detail && err.detail.lbtypes) lbtypes.value = err.detail.lbtypes
      return
    }
    preview.value = res.data
    if (res.data.lbtypes && res.data.lbtypes.length) lbtypes.value = res.data.lbtypes
    if (res.data.lbtypeKh) lbtype.value = res.data.lbtypeKh
  } catch (e) {
    importErr.value = String((e && e.message) || e)
  } finally {
    parsing.value = false
  }
}

/** 确认导入（真正写库；失败行不写，部分失败不算错） */
async function confirmImport() {
  if (importing.value || !preview.value || !preview.value.summary.importable) return
  importing.value = true
  importErr.value = ''
  try {
    // 用同一份矩阵重放一次（dryRun=false）；文件字节不留在内存里，改从预检结果重建入参
    const rows = preview.value.rows.map((r) => ({
      goodsName: r.goodsName, custName: r.custName, spec: r.spec, actual: r.actual,
    }))
    const res = await yxApi.importApply(rows, lbtype.value)
    if (!res || !res.ok) {
      importErr.value = String(((res && res.error) || {}).message || '导入失败')
      return
    }
    importResult.value = res.data
    preview.value = null
    toast('导入完成：新增 ' + res.data.inserted + ' 行')
    loadCaps()
    loadMemories()
  } catch (e) {
    importErr.value = String((e && e.message) || e)
  } finally {
    importing.value = false
  }
}
const memories = ref([])
const memErr = ref('')
const loadingMem = ref(false)

async function loadCaps() {
  loadingCaps.value = true
  capsErr.value = ''
  try {
    const res = await yxApi.capabilities()
    if (res && res.ok) {
      caps.value = res.data || {}
      if (Array.isArray(res.data.lbtypes) && res.data.lbtypes.length) {
        lbtypes.value = res.data.lbtypes
      }
      if (!lbtype.value && res.data.lbtypeKh) lbtype.value = res.data.lbtypeKh
    }
    else capsErr.value = String(((res && res.error) || {}).message || '读取失败')
  } catch (e) {
    capsErr.value = String((e && e.message) || e)
  } finally {
    loadingCaps.value = false
  }
}

async function loadMemories() {
  loadingMem.value = true
  memErr.value = ''
  try {
    const res = await yxApi.memoryList()
    if (res && res.ok) memories.value = ((res.data || {}).items) || []
    else memErr.value = String(((res && res.error) || {}).message || '读取失败')
  } catch (e) {
    memErr.value = String((e && e.message) || e)
  } finally {
    loadingMem.value = false
  }
}

async function removeMemory(m) {
  const r = await new Promise((resolve) => {
    uni.showModal({
      title: '删除这条记忆？',
      content: m.customer_name || '',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    })
  })
  if (!r) return
  try {
    const res = await yxApi.memoryDelete(m.id)
    if (res && res.ok) {
      toast('已删除')
      loadMemories()
      loadCaps()
    } else {
      toast(String(((res && res.error) || {}).message || '删除失败'))
    }
  } catch (e) {
    toast('删除失败：' + String((e && e.message) || e))
  }
}

onShow(() => {
  loadCaps()
  loadMemories()
})
</script>

<style lang="scss" scoped>
.hptype { padding-bottom: 40rpx; }

.intro {
  display: block;
  font-size: $fs-caption;
  line-height: 1.7;
  color: $color-text-2;
}

.stat { padding-top: 6rpx; }
.stat__row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16rpx 0; border-bottom: 1rpx solid $color-divider;
}
.stat__row:last-child { border-bottom: 0; }
.stat__k { font-size: $fs-caption; color: $color-text-3; }
.stat__v { font-size: $fs-caption; color: $color-text; }
.stat__v--bad { color: $color-danger; font-weight: $fw-bold; }

.pick {
  display: flex; align-items: center; gap: 20rpx;
  padding: 26rpx 0; border-bottom: 1rpx solid $color-divider;
}
.pick__icon {
  width: 72rpx; height: 72rpx; flex: 0 0 auto;
  border-radius: $radius-icon;
  background: $color-primary-bg; color: $color-primary;
  display: flex; align-items: center; justify-content: center;
}
.pick__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pick__t { font-size: $fs-body; font-weight: $fw-bold; color: $color-text; }
.pick__d { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }

.mem {
  display: flex; align-items: center; gap: 16rpx;
  padding: 18rpx 0; border-bottom: 1rpx solid $color-divider;
}
.mem:last-child { border-bottom: 0; }
.mem__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.mem__t { font-size: $fs-caption; color: $color-text; }
.mem__s { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.mem__del { flex: 0 0 auto; font-size: $fs-mini; color: $color-danger; padding: 8rpx 12rpx; }

.msg {
  margin-top: 16rpx; padding: 18rpx 20rpx;
  border-radius: $radius-card-sm; font-size: $fs-mini; line-height: 1.7;
}
.msg--err { background: $color-danger-bg; color: $color-danger; }
.msg--warn { background: $color-warning-bg; color: $color-warning; }
.msg--info { background: $color-primary-bg; color: $color-primary; }
.msg > text { display: block; }
.msg > text + text { margin-top: 8rpx; }

.note {
  margin-top: 14rpx; font-size: $fs-mini;
  color: $color-text-3; line-height: 1.7;
}
.note > text { display: block; }

/* 客户类别选择行 */
.lbpick { display: flex; align-items: center; gap: 8rpx; }
.lbpick__v { font-size: $fs-caption; color: $color-primary; }

/* 预检统计 */
.sum { display: flex; padding: 6rpx 0 10rpx; }
.sum__item { flex: 1; display: flex; flex-direction: column; align-items: center; }
.sum__v { font-size: 32rpx; font-weight: $fw-bold; color: $color-text; }
.sum__k { font-size: $fs-micro; color: $color-text-3; margin-top: 4rpx; }

/* 预检表格（横向滚动） */
.prev {
  width: 100%; margin-top: 8rpx;
  border: 1rpx solid $color-divider; border-radius: $radius-card-sm;
}
.prev__inner { display: inline-block; min-width: 100%; }
.prev__inner--wide { min-width: 1500rpx; }
.prev__row {
  display: flex; align-items: center; padding: 16rpx 12rpx;
  border-bottom: 1rpx solid $color-divider;
}
.prev__row:last-child { border-bottom: 0; }
.prev__row--head .col { color: $color-text-3; font-size: $fs-micro; }
.col { font-size: $fs-mini; color: $color-text; padding: 0 10rpx; }
.col--sys { width: 280rpx; flex: 0 0 auto; }
.col--cust { width: 220rpx; flex: 0 0 auto; }
.col--spec { width: 200rpx; flex: 0 0 auto; }
.col--act { width: 180rpx; flex: 0 0 auto; }
.col--code { width: 200rpx; flex: 0 0 auto; }
.col--unit { width: 90rpx; flex: 0 0 auto; }
.col--st { width: 140rpx; flex: 0 0 auto; font-weight: $fw-bold; }
.col--ok { color: $color-success; }
.col--manual { color: $color-primary; }
.col--bad { color: $color-danger; }
.prev__more {
  display: block; margin-top: 12rpx;
  font-size: $fs-mini; color: $color-text-3; line-height: 1.7;
}

/* 按钮 */
.btn-row { display: flex; gap: 16rpx; margin-top: 20rpx; }
.btn {
  flex: 1; height: 84rpx; border-radius: $radius-btn;
  display: flex; align-items: center; justify-content: center;
}
.btn > text { font-size: $fs-body; }
.btn--primary { background: $color-primary; }
.btn--primary > text { color: #fff; font-weight: $fw-bold; }
.btn--off { background: $color-primary-border; }

/* 底部弹层（客户类别选择） */
.mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: flex-end; z-index: 99;
}
.sheet {
  width: 100%; max-height: 70vh; background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  padding: 24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
}
.cand-list { max-height: 50vh; margin-top: 12rpx; }
.cand {
  padding: 18rpx 16rpx; border-bottom: 1rpx solid $color-divider;
  display: flex; flex-direction: column;
}
.cand__t { font-size: $fs-body; color: $color-text; font-weight: $fw-bold; }
.cand__s { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }

.bottom-gap { height: 40rpx; }
</style>
