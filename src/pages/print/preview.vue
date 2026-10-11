<template>
  <view class="page has-action-bar">
    <!-- 单据信息 -->
    <view class="card">
      <view class="row">
        <text class="row__label">单据</text>
        <text class="row__value text-primary">{{ billId || '未指定' }}</text>
      </view>
      <view v-if="!loading && !error" class="row row--divided">
        <text class="row__label">版式</text>
        <text class="row__value">V3 原版 · {{ pages.length }} 页 · {{ dpi }}dpi</text>
      </view>
      <!-- ★ 未内联时说明原因，别让用户以为「又坏了」 -->
      <view v-if="!loading && !error && pages.length && !inlined" class="row row--divided">
        <text class="row__label">图片模式</text>
        <text class="row__value hint-warn">联网加载（{{ (inlineKB).toFixed(0) }}KB 超出内联上限）</text>
      </view>
    </view>

    <LoadState :loading="loading" :error="error" @retry="load">
      <view v-for="p in pages" :key="p.page" class="shot">
        <view class="shot__head">
          <text class="shot__no">第 {{ p.page }} / 共 {{ pages.length }} 页</text>
          <!-- 显示图片来源便于诊断：本地文件/内联 base64 都不走网络，网络 URL 才依赖连通性 -->
          <text class="shot__size">{{ p.mode }} · {{ (p.bytes / 1024).toFixed(1) }} KB</text>
        </view>
        <!-- ★ 图片以**内联 base64** 为主：真机上 <image> 拉 http 图（明文+裸IP+非标端口）
             常被静默拦掉 —— 图空白、不报错、控制台也干净，最难查。
             @error 让我们至少能把它显示成「本页加载失败」而不是一片空白。 -->
        <image
          v-if="!p.failed"
          class="shot__img"
          :src="p.src"
          mode="widthFix"
          show-menu-by-longpress
          @error="onImgError(p)"
        />
        <view v-else class="shot__fail">
          <text class="shot__fail-t">本页图片加载失败</text>
          <text class="shot__fail-d">{{ p.failWhy || '可能原因：网络不可达 / 图片地址被拦截' }}</text>
          <view class="shot__fail-btn" @click="load" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="refresh" :size="14" color="primary" /><text>重新生成</text>
          </view>
        </view>
      </view>
      <view v-if="pages.length && !anyFailed" class="hint">
        预览与「V3 版式打印」用的是同一套版式，所见即所打。
        <text class="hint__em">长按图片可保存或转发</text>（发给店里即可出纸）。
      </view>
    </LoadState>

    <view class="action-bar">
      <view class="btn-ghost action-bar__item" @click="goBack" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="arrow-left" :size="16" color="text-2" /><text>返回</text>
      </view>
      <view class="btn-primary action-bar__item" :class="{ 'is-disabled': loading }" @click="load" hover-class="hv-on" :hover-stay-time="80">
        {{ loading ? '生成中…' : '重新生成' }}
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { printApi } from '../../api/index'
import { config } from '../../utils/config'
import LoadState from '../../components/LoadState.vue'
import Icon from '../../components/Icon.vue'

const billId = ref('')
const loading = ref(true)
const error = ref('')
const pages = ref([])
const dpi = ref(0)
const inlined = ref(true)
const inlineKB = ref(0)

const anyFailed = computed(() => pages.value.some((p) => p.failed))

/** 预览图 url 是**相对路径**（/api/v1/print/preview/xxx.png），要拼上云端基址。
 *  ★ 该路由故意不鉴权：小程序 <image> 带不了 Authorization 头，用随机文件名 + 24h TTL
 *    当一次性凭证（见云端 business.py 的 _print_cache_gc）。 */
function absUrl(u) {
  if (!u) return ''
  if (/^https?:\/\//.test(u)) return u
  return config.BASE_URL + u
}

/**
 * 把 base64 图片落成**本地临时文件**，返回本地路径（小程序端专用）。
 *
 * ★★★ 为什么不直接把 `data:image/png;base64,...` 塞给 `<image>`：
 *   微信小程序 image 对超长 base64 的渲染**不可靠**（社区大量反馈：约 >100KB 时
 *   iOS 真机上直接不显示，且不报错）。我们单页 150dpi 的 base64 就约 94KB，正好踩线。
 *   落成本地文件后 image 读的是本地路径 —— **既无长度限制、也不走网络**，
 *   而且长按保存/转发同样可用。
 * ★ 用**固定文件名**（不含时间戳）⇒ 同一页反复预览是覆盖写，不会在用户目录里堆积垃圾。
 * ★ 条件编译：`getFileSystemManager` 是微信专有 API，H5 端不存在。
 */
function toLocalFile(base64, page) {
  // #ifdef MP-WEIXIN
  try {
    const fs = uni.getFileSystemManager()
    const path = uni.env.USER_DATA_PATH + '/v3print_p' + page + '.png'
    fs.writeFileSync(path, base64, 'base64')
    return path
  } catch (e) {
    return ''
  }
  // #endif
  // #ifndef MP-WEIXIN
  return ''
  // #endif
}

async function load() {
  if (!billId.value) { loading.value = false; error.value = '未指定单据'; return }
  loading.value = true; error.value = ''
  const res = await printApi.previewBill(billId.value)
  loading.value = false
  if (!res.ok) {
    const msg = res.message || '生成预览失败'
    // Agent 离线是**正常业务态**（云端不存业务数据），要说清楚而不是笼统报错
    error.value = /agent/i.test(msg)
      ? msg + '（请先启动客户电脑上的 V3AgentGui）'
      : msg
    return
  }
  const d = res.data || {}
  dpi.value = d.dpi || 0
  inlined.value = d.inlined !== false
  inlineKB.value = (d.inlineBytes || 0) / 1024
  pages.value = (d.images || []).map((it) => {
    // 三级兜底：本地临时文件（最稳） → 内联 base64 → 网络 URL
    let src = ''
    let mode = ''
    if (it.dataUrl) {
      const local = toLocalFile(String(it.dataUrl).split(',')[1] || '', it.page)
      if (local) { src = local; mode = '本地文件' }
      else { src = it.dataUrl; mode = '内联 base64' }
    } else {
      src = absUrl(it.url)
      mode = '网络 URL'
    }
    return { ...it, src, mode, failed: false, failWhy: '' }
  })
  if (!pages.value.length) error.value = '该单据没有可预览的页'
}

function onImgError(p) {
  p.failed = true
  // 按图片来源给出**可区分**的原因，别让用户只看到一片空白
  p.failWhy = p.mode === '网络 URL'
    ? '网络图片加载被拦截（真机对 http 图片不可靠，可能是没连上服务器）'
    : '本地图片写入失败（可能存储空间不足或权限受限）'
}

function goBack() { uni.navigateBack() }

onLoad((q) => { billId.value = q.billId || ''; load() })
</script>

<style lang="scss" scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 88rpx;
  gap: $space-inner;
}
.row--divided { border-top: 1rpx solid $color-divider; }
.row__label { font-size: $fs-caption; color: $color-text-2; flex: 0 0 auto; }
.row__value {
  font-size: $fs-body;
  font-weight: $fw-bold;
  font-variant-numeric: tabular-nums;
  text-align: right;
  flex: 1;
  min-width: 0;
}
.hint-warn { color: $color-warning; font-weight: $fw-normal; font-size: $fs-caption; }

.shot {
  margin-top: 24rpx;
  border-radius: $radius-card-sm;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
}
.shot__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 24rpx;
  border-bottom: 1rpx solid $color-divider;
}
.shot__no { font-size: $fs-mini; color: $color-text-2; font-weight: $fw-bold; }
.shot__size { font-size: $fs-mini; color: $color-text-4; }
.shot__img { display: block; width: 100%; background: #fff; }

.shot__fail {
  padding: 60rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}
.shot__fail-t { font-size: $fs-body; font-weight: $fw-bold; color: $color-text-2; }
.shot__fail-d {
  font-size: $fs-mini;
  color: $color-text-4;
  text-align: center;
  line-height: 1.6;
}
.shot__fail-btn {
  display: flex; align-items: center; justify-content: center; gap: 8rpx;
  margin-top: 8rpx;
  padding: 14rpx 40rpx;
  border-radius: $radius-pill;
  background: $color-primary-bg;
  color: $color-primary;
  font-size: $fs-caption;
  font-weight: $fw-bold;
}

.hint {
  margin-top: 20rpx;
  padding: 0 8rpx;
  font-size: $fs-mini;
  color: $color-text-4;
  line-height: 1.6;
}
.hint__em { color: $color-primary; font-weight: $fw-bold; }

.action-bar__item { flex: 1; }
.is-disabled { opacity: 0.5; }
</style>
