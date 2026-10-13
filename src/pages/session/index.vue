<template>
  <view class="page session">
    <!-- 统计 -->
    <view class="stat">
      <view class="stat__cell">
        <text class="metric-label">在线</text>
        <text class="stat__v">{{ data.online }}<text class="stat__u">人</text></text>
      </view>
      <view class="stat__cell">
        <text class="metric-label">会话总数</text>
        <text class="stat__v">{{ data.total }}<text class="stat__u">条</text></text>
      </view>
    </view>
    <!-- ★ 把判据说清楚：不写清楚的话，用户看到"离线"会以为人已经退出了 -->
    <text class="hint">「在线」＝最近 5 分钟内有操作。离线的人可能只是没动手机，不代表已退出。</text>

    <LoadState :loading="loading && !rows.length" :error="error" skeleton skeleton-variant="row" @retry="reload">
      <view v-if="!rows.length" class="empty">
        <text class="empty__t">当前没有登录会话</text>
        <text class="empty__s">有人用 App 登录后会出现在这里</text>
      </view>

      <view v-else class="card list">
        <view
          v-for="it in rows"
          :key="it.jti"
          class="row"
          hover-class="hv-on"
          :hover-stay-time="80"
          @click="onRow(it)"
        >
          <view class="row__dot" :class="dotCls(it)" />
          <view class="row__main">
            <view class="row__line">
              <text class="row__name">{{ it.name }}</text>
              <text class="row__kind">{{ it.kind }}</text>
            </view>
            <view class="row__line">
              <!-- ★ 账套放前面（2026-10-14）：每本账有自己的操作员集合，
                   要先看清"哪本账"，再看是哪个操作员、什么设备 -->
              <text class="row__db">{{ it.database || '默认账套' }}</text>
              <text class="row__device">{{ it.device }}</text>
            </view>
            <view class="row__line">
              <text class="row__sub">{{ it.ip }}　·　{{ idleText(it) }}</text>
            </view>
          </view>
          <Icon name="chevron-right" :size="16" color="text-4" />
        </view>
      </view>
    </LoadState>

    <!-- 动作面板：自定义底部面板，替掉原生 showActionSheet（2026-10-14 美化）
         ★ 为什么不用 showActionSheet：它是系统原生列表，长相跟上面那个确认弹窗
           完全两回事；而且只能给一行文字，摆不下"这个人是谁、哪本账、什么设备"。
         ★ 两个动作的层级差（可恢复 / 不可逆）在**图标底色 + 副标题**上体现，
           不靠颜色深浅去猜。 -->
    <view v-if="sheet" class="mask mask--bottom" @click="closeSheet">
      <view class="action" @click.stop="noop">
        <view class="action__head">
          <view class="action__badge">{{ initial(sheet) }}</view>
          <view class="action__meta">
            <view class="action__line">
              <text class="action__name">{{ sheet.name }}</text>
              <text class="action__db">{{ sheet.database || '默认账套' }}</text>
            </view>
            <text class="action__sub">{{ sheet.device }}　·　{{ sheet.ip }}</text>
          </view>
        </view>

        <view v-if="!sheet.revoked" class="action__item" hover-class="hv-on"
              :hover-stay-time="80" @click="pick('one')">
          <view class="action__ico is-warn"><Icon name="logout" :size="17" /></view>
          <view class="action__main">
            <text class="action__t">踢出这条会话</text>
            <text class="action__d">只断这一台设备，可恢复</text>
          </view>
          <Icon name="chevron-right" :size="15" color="text-4" />
        </view>

        <view class="action__item" hover-class="hv-on" :hover-stay-time="80"
              @click="pick('all')">
          <view class="action__ico is-danger"><Icon name="alert-circle" :size="17" /></view>
          <view class="action__main">
            <text class="action__t">踢出该账号全部设备</text>
            <text class="action__d">他所有设备立刻掉线，需重新登录</text>
          </view>
          <Icon name="chevron-right" :size="15" color="text-4" />
        </view>

        <view class="action__cancel" hover-class="hv-on" :hover-stay-time="80"
              @click="closeSheet">取消</view>
      </view>
    </view>

    <!-- 确认弹窗：自定义，不用 uni.showModal（2026-10-14 美化）
         ★ 为什么自己画：showModal 只有一行文字，而"踢人"这个动作最要紧的是
           **让操作者看清楚他踢的是谁** —— 账号、哪本账、什么设备、从哪个 IP。
           原生弹窗摆不下这些，也做不出"轻/重"两级视觉区分。
         ★ 视觉沿用「服务器」页那套 .mask / .sheet，全站弹窗一个长相。 -->
    <view v-if="dlg" class="mask" @click="closeDlg">
      <view class="sheet" @click.stop="noop">
        <view class="sheet__head">
          <view class="sheet__ico" :class="'is-' + (dlg.tone || 'warn')">
            <Icon :name="dlg.icon || 'logout'" :size="22" />
          </view>
          <view class="sheet__headmain">
            <text class="sheet__t">{{ dlg.title }}</text>
            <text class="sheet__sub">{{ dlg.sub }}</text>
          </view>
        </view>

        <!-- 被操作的对象：一张小卡，把"踢谁"说清楚 -->
        <view v-if="dlg.who" class="who">
          <view class="who__line">
            <text class="who__name">{{ dlg.who }}</text>
            <text v-if="dlg.db" class="who__db">{{ dlg.db }}</text>
          </view>
          <text v-if="dlg.meta" class="who__meta">{{ dlg.meta }}</text>
        </view>

        <text v-if="dlg.note" class="sheet__note">{{ dlg.note }}</text>

        <view class="sheet__acts">
          <view v-if="!dlg.onlyOk" class="sheet__btn" @click="closeDlg">取消</view>
          <view class="sheet__btn sheet__btn--go" :class="'is-' + (dlg.tone || 'warn')"
                @click="dlgGo">{{ dlg.okText || '确定' }}</view>
        </view>
      </view>
    </view>

    <view class="bottom-gap" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { sessionApi } from '../../api/session'
import Icon from '../../components/Icon.vue'
import LoadState from '../../components/LoadState.vue'

const rows = ref([])
const data = ref({ total: 0, online: 0 })
const loading = ref(false)
const error = ref('')

async function reload() {
  loading.value = true
  error.value = ''
  const res = await sessionApi.list()
  loading.value = false
  if (res.ok) {
    rows.value = res.data.list || []
    data.value = res.data
  } else {
    // ★ 读不到就清空，别留着上一次的列表 —— 拿旧数据当"现在谁在线"就是假确定性
    rows.value = []
    data.value = { total: 0, online: 0 }
    error.value = res.message || '会话列表加载失败'
  }
}

/* ---------------- 动作面板 ---------------- */
//
// ★ 替代原生 showActionSheet：一是长相跟确认弹窗不是一回事，二是它只能给一行文字。
//   这里先把"这个人是谁"摆出来（首字头像 + 姓名 + 账套 + 设备），
//   再让操作者选踢一条还是踢全部。

const sheet = ref(null)

function closeSheet() { sheet.value = null }

/** 首字头像（跟「我的」页那张账号卡同一个做法） */
function initial(it) {
  const n = String((it && (it.name || it.user)) || '?')
  return n.slice(0, 1)
}

/** 面板里选了某个动作：**先关面板、再开确认弹窗** —— 两层不会叠在一起 */
function pick(kind) {
  const it = sheet.value
  sheet.value = null
  if (!it) return
  if (kind === 'one') kickOne(it)
  else kickAll(it)
}

/** 点一行 → 弹出动作面板（不再用原生 actionSheet）。 */
function onRow(it) {
  sheet.value = it
}

/* ---------------- 确认弹窗 ---------------- */
//
// ★ 弹窗只用**一份**状态（dlg）：标题 / 副标题 / 被操作对象 / 说明 / 轻重 / 按钮文案。
//   三个场景（踢这条、踢全部、踢失败）共用同一套壳，长相一致、加场景也不用再抄一遍。
// ★ tone 分两级：warn（橙·可恢复）与 danger（红·不可逆）。
//   "踢出这条"只是断一台设备 ⇒ warn；"踢全部"会让所有设备掉线 ⇒ danger。

const dlg = ref(null)

function noop() {}
function closeDlg() { dlg.value = null }
function dlgGo() {
  const fn = dlg.value && dlg.value.go
  dlg.value = null
  if (typeof fn === 'function') fn()
}

/** 被操作对象那一行的副信息（账套 · 设备 · IP），空的一律不拼 */
function subLine(it) {
  return [it.database || '默认账套', it.device, it.ip].filter(Boolean).join('　·　')
}

function kickOne(it) {
  dlg.value = {
    icon: 'logout',
    tone: 'warn',
    title: '踢出这条会话？',
    sub: '只断这一台设备，可恢复',
    who: it.name,
    db: it.database || '默认账套',
    meta: subLine(it),
    note: '该账号在其他设备上的登录不受影响，他还能继续用。',
    okText: '踢出这一台',
    go: () => doRevoke({ jti: it.jti }, '已踢出该会话'),
  }
}

function kickAll(it) {
  dlg.value = {
    icon: 'alert-circle',
    tone: 'danger',
    title: '踢出该账号的全部设备？',
    sub: '所有设备立刻掉线',
    who: it.name,
    db: it.database || '默认账套',
    meta: subLine(it),
    note: '他手上所有设备都会掉线，需要重新登录。\n'
        + '账号本身不受影响 —— 之后还能正常登录。',
    okText: '全部踢出',
    go: () => doRevoke({ subject: it.sub }, '已踢出该账号全部会话'),
  }
}

async function doRevoke(payload, okText) {
  uni.showLoading({ title: '处理中…', mask: true })
  const res = await sessionApi.revoke(payload)
  uni.hideLoading()
  if (res.ok) {
    uni.showToast({ title: okText, icon: 'none' })
    reload()
  } else {
    // ★ 失败要给原因（没权限 / 超范围 / 网络），不要静默 —— 静默会被当成"点了没用"。
    //   也用同一个弹窗壳：只有一个"知道了"，tone 走 danger。
    dlg.value = {
      icon: 'alert-circle',
      tone: 'danger',
      title: '没能踢出去',
      sub: '服务端拒绝了这次操作',
      note: res.message || '请稍后重试。',
      okText: '知道了',
      onlyOk: true,
    }
  }
}

function dotCls(it) {
  if (it.revoked) return 'is-off'
  return it.online ? 'is-on' : 'is-idle'
}

function idleText(it) {
  if (it.revoked) return '已被踢出'
  const s = it.idleSec
  if (s < 60) return s + ' 秒前活跃'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前活跃'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前活跃'
  return Math.floor(s / 86400) + ' 天前活跃'
}

onShow(reload)
onPullDownRefresh(async () => {
  await reload()
  uni.stopPullDownRefresh()
})
</script>

<style lang="scss" scoped>
.session { padding-top: $space-gap; }

.stat { display: flex; background: $color-card; border-radius: $radius-card; box-shadow: $shadow-card; }
.stat__cell {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center;
  gap: 10rpx; padding: 24rpx 0; position: relative;
}
.stat__cell + .stat__cell::before {
  content: ''; position: absolute; left: 0; top: 20rpx; bottom: 20rpx;
  width: 1rpx; background: $color-divider;
}
.stat__v {
  font-family: $font-num; font-size: 40rpx; font-weight: $fw-heavy;
  color: $color-text; font-variant-numeric: tabular-nums;
}
.stat__u { font-size: $fs-micro; font-weight: $fw-normal; color: $color-text-3; margin-left: 4rpx; }

.hint {
  display: block; font-size: $fs-mini; color: $color-text-3;
  margin: $space-inner 4rpx $space-gap; line-height: 1.6;
}

.list { padding: 0 $space-card; }
.row {
  display: flex; align-items: center; gap: 18rpx;
  min-height: 112rpx; border-bottom: 1rpx solid $color-divider;
}
.row:last-child { border-bottom: 0; }
.row__dot {
  width: 14rpx; height: 14rpx; border-radius: 50%; flex: 0 0 auto;
  background: $color-text-4;
}
.row__dot.is-on { background: $color-success; }
.row__dot.is-idle { background: $color-warning; }
.row__dot.is-off { background: $color-text-4; }

.row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8rpx; }
.row__line { display: flex; align-items: center; gap: 12rpx; }
.row__name {
  font-size: $fs-body; font-weight: $fw-bold; color: $color-text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;
}
.row__kind {
  font-size: $fs-micro; color: $color-text-3;
  border: 1rpx solid $color-divider; border-radius: 6rpx; padding: 0 10rpx;
}
.row__device { font-size: $fs-mini; color: $color-text-2; font-weight: $fw-bold; }
.row__db {
  font-size: $fs-micro; color: $color-primary-dark; background: $color-primary-bg;
  border-radius: 6rpx; padding: 2rpx 12rpx; margin-right: 12rpx; flex: 0 0 auto;
}
.row__sub { font-size: $fs-mini; color: $color-text-3; }

.empty {
  display: flex; flex-direction: column; align-items: center; gap: 10rpx;
  padding: 120rpx 0;
}
.empty__t { font-size: $fs-subtitle; color: $color-text-2; }
.empty__s { font-size: $fs-mini; color: $color-text-4; }

/* ---------------- 确认弹窗 ----------------
 * ★ 沿用「服务器」页那套 .mask / .sheet —— 全站弹窗一个长相。
 * ★ 比原生 showModal 多出来的只有三样：**图标**（一眼分清轻重）、
 *   **被操作对象卡**（踢谁、哪本账、什么设备、哪个 IP）、**两级色**（可恢复/不可逆）。
 */
.mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(15, 23, 32, 0.44);
  display: flex; align-items: center; justify-content: center;
  z-index: 130;
}
.sheet {
  width: 82%; background: $color-card; border-radius: $radius-card;
  padding: 36rpx 32rpx 22rpx; box-sizing: border-box; box-shadow: $shadow-raised;
}
.sheet__head { display: flex; align-items: flex-start; gap: 18rpx; }
.sheet__ico {
  width: 64rpx; height: 64rpx; border-radius: $radius-icon; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.sheet__ico.is-warn { background: #fff7ed; color: $color-warning; }
.sheet__ico.is-danger { background: #fef2f2; color: $color-danger; }
.sheet__headmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.sheet__t { font-size: $fs-subtitle; font-weight: $fw-bold; color: $color-text; }
.sheet__sub { font-size: $fs-mini; color: $color-text-3; }

.who {
  margin-top: 22rpx; padding: 20rpx 22rpx;
  background: $color-bg-sunken; border-radius: $radius-input;
  display: flex; flex-direction: column; gap: 10rpx;
}
.who__line { display: flex; align-items: center; gap: 12rpx; }
.who__name {
  font-size: $fs-body; font-weight: $fw-bold; color: $color-text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;
}
.who__db {
  font-size: $fs-micro; color: $color-primary-dark; background: $color-primary-bg;
  border-radius: 6rpx; padding: 2rpx 12rpx; flex: 0 0 auto;
}
.who__meta { font-size: $fs-mini; color: $color-text-3; word-break: break-all; line-height: 1.5; }

.sheet__note {
  display: block; margin-top: 20rpx; font-size: $fs-mini;
  color: $color-text-2; line-height: 1.65;
}

.sheet__acts { display: flex; justify-content: flex-end; gap: 16rpx; margin-top: 30rpx; }
.sheet__btn {
  font-size: $fs-caption; color: $color-text-2;
  padding: 16rpx 30rpx; border-radius: $radius-btn;
}
.sheet__btn--go { color: #fff; font-weight: $fw-bold; }
.sheet__btn--go.is-warn { background: $color-warning; }
.sheet__btn--go.is-danger { background: $color-danger; }

/* ---------------- 动作面板（点账号时弹出） ----------------
 * ★ `.mask--bottom` 把遮罩的居中对齐改成贴底 —— "从下往上"是移动端动作面板的
 *   既有语感，做成居中人会以为是又一个弹窗。
 * ★ 两个动作的轻重靠**图标底色 + 副标题**说明，不靠颜色深浅让人猜。 */
.mask--bottom { align-items: flex-end; }
.action {
  width: 100%; background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  padding: 0 0 20rpx; box-sizing: border-box; box-shadow: $shadow-raised;
}
.action__head {
  display: flex; align-items: center; gap: 18rpx;
  padding: 26rpx 32rpx 24rpx; border-bottom: 1rpx solid $color-divider;
}
.action__badge {
  width: 76rpx; height: 76rpx; border-radius: $radius-icon; flex: 0 0 auto;
  background: $color-primary; color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 32rpx; font-weight: $fw-heavy;
}
.action__meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8rpx; }
.action__line { display: flex; align-items: center; gap: 12rpx; }
.action__name {
  font-size: $fs-subtitle; font-weight: $fw-bold; color: $color-text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;
}
.action__db {
  font-size: $fs-micro; color: $color-primary-dark; background: $color-primary-bg;
  border-radius: 6rpx; padding: 2rpx 12rpx; flex: 0 0 auto;
}
.action__sub { font-size: $fs-mini; color: $color-text-3; }

.action__item {
  display: flex; align-items: center; gap: 18rpx;
  padding: 24rpx 32rpx; border-bottom: 1rpx solid $color-divider;
}
.action__ico {
  width: 64rpx; height: 64rpx; border-radius: $radius-icon; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
}
.action__ico.is-warn { background: #fff7ed; color: $color-warning; }
.action__ico.is-danger { background: #fef2f2; color: $color-danger; }
.action__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.action__t { font-size: $fs-body; font-weight: $fw-bold; color: $color-text; }
.action__d { font-size: $fs-mini; color: $color-text-3; }

.action__cancel {
  margin: 18rpx 32rpx 0; text-align: center;
  font-size: $fs-body; color: $color-text-2;
  padding: 22rpx 0; border-radius: $radius-btn; background: $color-bg-sunken;
}

.bottom-gap { height: 40rpx; }
</style>
