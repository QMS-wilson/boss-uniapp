<template>
  <view class="page">
    <view class="card">
      <view class="tip">
        <text class="tip__main" :id="'eff'">{{ effectiveShown }}</text>
        <text class="tip__sub">链接填成「服务器地址 + /商户码」两段，最后那段就是"这是哪一家"。没填之前哪一家都不会显示。</text>
        <text class="tip__sub">连不上先点「测试」，它分开告诉你：服务器通不通、商户码对不对。</text>
      </view>

      <view v-for="(s, i) in slots" :key="i" class="row">
        <text class="row__lab">连接{{ i + 1 }}</text>
        <input class="row__in" :id="'srv-in-' + i" v-model="slots[i]" type="text"
               placeholder="如 https://v3jxc.duckdns.org/shanghuming" placeholder-class="row__ph"
               @blur="onEdit(i)" />
        <view class="row__act" :id="'srv-test-' + i" :class="{ 'is-busy': testing === i }" @click="test(i)" hover-class="hv-on" :hover-stay-time="80">
          {{ testing === i ? '测试中' : '测试' }}
        </view>
        <!-- 拆出来的两段回显给用户看：他填一条链接，程序按两段理解，别让他猜程序看到了什么 -->
        <text v-if="slots[i]" class="row__split">服务器 {{ parts[i].base || '看不出来' }}
          · 商户码 {{ parts[i].merchant || (parts[i].path ? ('/' + parts[i].path + '（不像商户码）') : '没填') }}</text>
        <text v-if="ping[i]" class="row__why" :class="{ 'row__why--bad': !pingOk[i] }">{{ ping[i] }}</text>
        <text v-if="mkt[i]" class="row__why" :class="{ 'row__why--bad': !mktOk[i] }">{{ mkt[i] }}</text>
      </view>

      <view class="pick">
        <text class="pick__lab">路径</text>
        <view v-for="(s, i) in slots" :key="'p' + i" class="pick__opt" :id="'srv-pick-' + i" @click="choose(i)" hover-class="hv-on" :hover-stay-time="80">
          <view class="pick__dot" :class="{ 'is-on': active === i }"></view>
          <text>连接{{ i + 1 }}</text>
        </view>
      </view>
      <text class="row__split">现在生效的是{{ liveIdx >= 0 ? '连接' + (liveIdx + 1) : '还没配好' }}
        · 商户码 {{ liveCode || '无' }}；点「去登录」或走维护通道才会把选中的这条切过去</text>
    </view>

    <view class="btn-primary go" id="srv-go" @click="goLogin" hover-class="hv-on" :hover-stay-time="80">去登录</view>
    <text class="foot">两条是给"家里/店里一套、外网一套"准备的，切哪条都不用重装</text>

    <!-- 维护通道：装机/排查用的另一个入口，**故意做得不起眼**。
         ★ 这道口令只是遮羞帘（在前端比一下字符串），不是安全边界：真门槛是后面的
           应用账号口令。它的作用只有一个 —— 别让正常使用的人看见"还有第二条路"。 -->
    <view id="maint-entry" class="maint" @click="openMaint" hover-class="hv-on" :hover-stay-time="80">维护通道</view>

    <view v-if="maintStep" class="mask" @click="closeMaint">
      <view class="sheet" @click.stop="noop">
        <text class="sheet__t">{{ maintStep === 'pw' ? '维护通道' : '用应用账号登录' }}</text>
        <template v-if="maintStep === 'pw'">
          <input id="maint-pw" class="sheet__in" v-model="maintPw" password
                 placeholder="维护口令" placeholder-class="sheet__ph" />
        </template>
        <template v-else>
          <input id="acct-user" class="sheet__in" v-model="acct"
                 placeholder="应用账号" placeholder-class="sheet__ph" />
          <input id="acct-pw" class="sheet__in" v-model="acctPw" password
                 placeholder="口令" placeholder-class="sheet__ph" />
        </template>
        <text v-if="maintMsg" class="sheet__msg">{{ maintMsg }}</text>
        <view class="sheet__row">
          <text class="sheet__btn" @click="closeMaint">取消</text>
          <text id="maint-go" class="sheet__btn sheet__btn--go" @click="maintNext">
            {{ maintStep === 'pw' ? '进入' : (maintBusy ? '登录中…' : '登录') }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { config, parseServerLink, setServerLink, serverBase } from '../../utils/config'
import { merchantCode, suggestMerchantFromPath } from '../../utils/merchant'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../store/auth'
import { toast } from '../../utils/format'

const auth = useAuthStore()

/** 见上面注释：前端字符串比较，不是安全边界。 */
const MAINT_PW = 'Qms_admin'

const maintStep = ref('')        // '' | 'pw' | 'login'
const maintPw = ref('')
const acct = ref('')
const acctPw = ref('')
const maintMsg = ref('')
const maintBusy = ref(false)
function noop() {}

function openMaint() {
  maintStep.value = 'pw'
  maintPw.value = ''
  maintMsg.value = ''
}
function closeMaint() {
  maintStep.value = ''
  maintPw.value = ''
  acctPw.value = ''
  maintMsg.value = ''
}

async function maintNext() {
  if (maintStep.value === 'pw') {
    if (maintPw.value !== MAINT_PW) {
      maintMsg.value = '维护口令不对'
      maintPw.value = ''
      return
    }
    maintMsg.value = ''
    maintStep.value = 'login'
    return
  }
  if (!acct.value || !acctPw.value || maintBusy.value) {
    maintMsg.value = '要把账号和口令都填上'
    return
  }
  maintBusy.value = true
  maintMsg.value = ''
  // ★ 维护通道也是真发请求：先把当前选中的那条应用掉，否则会在**旧服务器**上把会话建起来
  applyLink()
  try {
    const res = await authApi.login('password', { account: acct.value, password: acctPw.value })
    if (!res.ok) {
      maintMsg.value = res.serverMessage || res.message || '登录失败'
      return
    }
    if (res.data && auth.setLogin(res.data) === false) {
      maintMsg.value = res.serverMessage || auth.tenantError || '该账号不属于当前商户入口'
      return
    }
    closeMaint()
    uni.switchTab({ url: '/pages/home/index' })
  } catch (e) {
    maintMsg.value = '登录异常：' + String((e && (e.message || e.errMsg)) || e).slice(0, 100)
  } finally {
    maintBusy.value = false
  }
}


const SLOTS_KEY = 'jxc_server_slots'
const ACTIVE_KEY = 'jxc_server_slot'

const slots = ref(['', ''])
const active = ref(0)
const testing = ref(-1)
const ping = ref(['', ''])        // 结论一：服务器通不通
const mkt = ref(['', ''])         // 结论二：商户码对不对
const pingOk = ref([false, false])
const mktOk = ref([false, false])

/** 每条链接拆出来的两段，实时显示 —— 用户填一条，程序按两段理解，别让他猜程序看到了什么 */
const parts = computed(() => slots.value.map((s) => parseServerLink(s)))
/**
 * 「选中的那条」与「现在真生效的那条」是两件事，界面上必须分开说。
 * ★ 以前只有圆点表示选中，而请求打的是已生效的链接：粘好地址、点圆点、
 *   然后走维护通道或按返回键离开 ⇒ 新地址从头到尾没生效，人却以为连的是新的。
 */
const liveCode = computed(() => merchantCode())
const liveIdx = computed(() => {
  const c = String(liveCode.value || '').toLowerCase()
  return parts.value.findIndex((p) => String(p.merchant || '').toLowerCase() === c)
})

/** 生效中的那一家。没配链接就说"未设置连接"，绝不由前端猜一家出来 */
const effectiveShown = computed(() => {
  const code = merchantCode()
  if (!code) return '未设置连接：现在哪一家都不显示'
  return '当前连的是商户「' + code + '」 · ' + serverBase()
})

function load() {
  try {
    const raw = JSON.parse(uni.getStorageSync(SLOTS_KEY) || '[]')
    // ★ 存量的两条**原样读回**，不再归一化：链接里的 /商户码 现在是有意义的身份段，
    //   旧版那句"把路径丢掉"会把用户填的商户码一起扔了。
    if (Array.isArray(raw)) slots.value = [String(raw[0] || ''), String(raw[1] || '')]
    active.value = Number(uni.getStorageSync(ACTIVE_KEY) || 0) ? 1 : 0
  } catch (e) { /* 读不到就用空的两条，别把页面卡死 */ }
  // H5 首次进来是空的：拿 URL 前缀**预填一个建议值**，但要点一下测试/去登录才算数。
  // 前缀本身不再绑定身份（小程序/App 没有 pathname，规则必须三端一样）。
  if (!slots.value[0]) {
    const sug = suggestMerchantFromPath()
    if (sug) slots.value[0] = (sameOriginHint() || 'https://v3jxc.duckdns.org') + '/' + sug
  }
}
function sameOriginHint() {
  // #ifdef H5
  try { return (window.location && window.location.origin) || '' } catch (e) { return '' }
  // #endif
  // #ifndef H5
  return ''
  // #endif
}
function save() {
  uni.setStorageSync(SLOTS_KEY, JSON.stringify(slots.value.map((x) => String(x || '').trim())))
  uni.setStorageSync(ACTIVE_KEY, String(active.value))
}
function onEdit(i) {
  ping.value[i] = ''
  mkt.value[i] = ''
  pingOk.value[i] = false
  mktOk.value[i] = false
  save()
}
function choose(i) {
  active.value = i
  save()
}

/**
 * ★ 把"选中的那条"变成"生效的那条"，并在新旧商户码不同时清掉两处会话。
 *   任何要真发请求的入口（去登录、维护通道）都必须先走这里一次 ——
 *   否则圆点选的是连接 2、请求全打在连接 1 上，输入框看着没错，人却登进了另一台。
 */
function applyLink() {
  const link = String(slots.value[active.value] || '').trim()
  const before = merchantCode()
  save()
  setServerLink(link)                 // 空 = 清掉自定义，回到"跟随当前源 + 没有商户码"
  const after = merchantCode()
  if (before !== after) auth.dropSessions(before, after)
  return { before, after }
}

/**
 * 测试：分开给两个结论 —— ① 这台服务器通不通 ② 链接里那段商户码对不对。
 * ★ 走裸 uni.request 而不是封装层 —— 封装层会带令牌、401 会去刷新、失败会存草稿，
 *   这些在"我连地址都还没填对"的阶段全是干扰，而且会把真正的原因盖掉。
 * ★★ 两条判据都必须看**响应体**，不能只看 statusCode === 200：
 *   路径带错时 nginx 的 SPA 兜底会拿 index.html 回你 200 —— 上一版就是因此报"通"，
 *   而登录 POST 过去却是 405（2026-09-28 现场）。
 * ★ 商户号对不对打的是免登录的 /auth/options：它顺带把"这家有几本账"回出来，
 *   所以"商户码对但客户机没开机"能被准确地说成后者，而不是糊成"连不上"。
 */
function test(i) {
  const p = parseServerLink(slots.value[i])
  if (!p.base) { toast('未能识别链接中的主机地址，请检查格式'); return }
  testing.value = i
  ping.value[i] = ''
  mkt.value[i] = ''
  const t0 = Date.now()
  uni.request({
    url: p.base + config.API_PREFIX + '/health',
    method: 'GET',
    timeout: 8000,
    success: (r) => {
      const b = r.data
      const isApi = r.statusCode === 200 && b && typeof b === 'object' && b.ok === true
      const isPage = typeof b === 'string' && /<html|<!doctype/i.test(String(b).slice(0, 400))
      pingOk.value[i] = !!isApi
      ping.value[i] = isApi
        ? ('服务器 通 · ' + (Date.now() - t0) + 'ms')
        : (isPage || r.statusCode === 200
            ? '服务器不通：该地址返回的是网页而非接口'
            : '服务器不通：返回 ' + r.statusCode + '（地址正确，但该端口不是本平台接口）')
      if (isApi) testMerchant(i, p)
      else { mkt.value[i] = ''; mktOk.value[i] = false; testing.value = -1 }
    },
    fail: (e) => {
      pingOk.value[i] = false
      mktOk.value[i] = false
      // 原因原样带出来：DNS 解不出 / TLS 被掐 / 明文被禁 / 超时，四种在手机上长得一样
      ping.value[i] = '服务器 不通：' + String((e && e.errMsg) || e).replace(/^request:fail\s*/, '').slice(0, 90)
      mkt.value[i] = ''
      testing.value = -1
    },
  })
}

function testMerchant(i, p) {
  if (!p.merchant) {
    mktOk.value[i] = false
    // ★ 举例一律用 `shanghuming` 这种**不存在的**短码：拿真商户号当例子，
    //   照着抄的人会连到别人家账上（2026-09-29 用户点名）。
    mkt.value[i] = p.path
      ? ('商户码 不对：「/' + p.path + '」不像商户码（应为小写字母开头的短码，如 /shanghuming）')
      : '商户码 没填：链接要填到 /商户码，例如 ' + p.base + '/shanghuming'
    testing.value = -1
    return
  }
  uni.request({
    url: p.base + config.API_PREFIX + '/auth/options',
    method: 'POST',
    timeout: 12000,
    header: { 'Content-Type': 'application/json', 'X-Merchant': p.merchant },
    data: {},
    success: (r) => {
      const b = r.data
      const ok = r.statusCode === 200 && b && typeof b === 'object' && b.ok === true
      const m = ok ? ((b.data || {}).merchant || {}) : {}
      mktOk.value[i] = !!ok
      if (ok) {
        const dbs = (m.databases || []).length
        // 客户机不在**不是商户码错**：分开说，否则人会去改一个本来就对的短码
        const off = ((b.data || {}).operators_error || {}).code === 'AGENT_OFFLINE'
        mkt.value[i] = '商户码 对：' + (m.title || m.code)
          + '（' + (dbs ? dbs + ' 个账套' : '未登记账套') + (off ? ' · 但客户机未在线' : '') + '）'
      } else {
        const err = (b && b.error) || {}
        mkt.value[i] = '商户码 不对：' + (err.message || (r.statusCode === 404 ? '没有这一家' : '回了 ' + r.statusCode))
      }
      testing.value = -1
    },
    fail: (e) => {
      mktOk.value[i] = false
      mkt.value[i] = '商户码 没验成：' + String((e && e.errMsg) || e).replace(/^request:fail\s*/, '').slice(0, 80)
      testing.value = -1
    },
  })
}

/**
 * 生效并去登录。
 * ★ 商户码变了就必须把新旧两处会话一起清掉：登录态按商户码分键存着，
 *   只清当前那份会留下另一家的令牌 —— 人把链接从 A 改到 B 再改回 A，
 *   就变成"没登录却看得见 A 的数据"（裸域名那次事故就是这个形状）。
 */
function goLogin() {
  applyLink()
  uni.reLaunch({ url: '/pages/login/index' })
}

onLoad(load)
</script>

<style lang="scss" scoped>
.page { min-height: 100vh; padding: $space-page; box-sizing: border-box; background: $color-bg; }
.card { background: $color-card; border-radius: $radius-card; padding: $space-card; }
.tip { margin-bottom: $space-card; }
.tip__main { display: block; font-size: $fs-body; font-weight: $fw-bold; }
.tip__sub { display: block; margin-top: 8rpx; font-size: $fs-mini; line-height: 1.6; color: $color-text-3; }

.row {
  display: flex;
  align-items: center;
  gap: $space-inner;
  flex-wrap: wrap;
  padding: 20rpx 0;
  border-bottom: 1rpx solid $color-divider;
}
.row:last-of-type { border-bottom: 0; }
.row__lab { flex: 0 0 auto; font-size: $fs-body; font-weight: $fw-bold; }
.row__in {
  flex: 1;
  min-width: 220rpx;
  height: 72rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  background: $color-bg-sunken;
  border-radius: $radius-input;
  font-size: $fs-body;
}
.row__ph { color: $color-text-4; }
.row__act {
  flex: 0 0 auto;
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 26rpx;
  border-radius: $radius-btn;
  background: $color-primary-bg;
  color: $color-primary-dark;
  font-size: $fs-caption;
  font-weight: $fw-bold;
}
.row__act.is-busy { opacity: 0.6; }
.row__why { flex: 1 0 100%; font-size: $fs-mini; color: $color-success; }
.row__why--bad { color: $color-danger; }
.row__split { flex: 1 0 100%; font-size: $fs-mini; color: $color-text-3; word-break: break-all; }

.pick { display: flex; align-items: center; gap: $space-card; margin-top: $space-card; }
.pick__lab { font-size: $fs-body; color: $color-text-2; }
.pick__opt { display: flex; align-items: center; gap: 10rpx; font-size: $fs-body; }
.pick__dot {
  width: 34rpx;
  height: 34rpx;
  border-radius: 50%;
  border: 2rpx solid $color-text-4;
  box-sizing: border-box;
}
.pick__dot.is-on { border-color: $color-primary; background: $color-primary; }

.go { margin-top: $space-gap; }
.foot { display: block; margin-top: 20rpx; text-align: center; font-size: $fs-mini; color: $color-text-4; }

/* 维护通道：全站最小的字号 + 最弱的颜色，正常用户看不出这是个能点的东西 */
.maint {
  margin-top: 26rpx;
  text-align: right;
  font-size: $fs-micro;
  color: $color-text-4;
  padding: 8rpx 4rpx;
  opacity: 0.75;
}

.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(15, 23, 32, 0.44);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 130;
}
.sheet {
  width: 78%;
  background: $color-card;
  border-radius: $radius-card;
  padding: 34rpx 30rpx 24rpx;
  box-sizing: border-box;
  box-shadow: $shadow-raised;
}
.sheet__t { display: block; font-size: $fs-body; font-weight: $fw-bold; margin-bottom: 20rpx; }
.sheet__in {
  height: 76rpx;
  padding: 0 20rpx;
  margin-bottom: 18rpx;
  box-sizing: border-box;
  background: $color-bg-sunken;
  border-radius: $radius-input;
  font-size: $fs-body;
}
.sheet__ph { color: $color-text-4; font-size: $fs-body; }
.sheet__msg { display: block; margin-bottom: 14rpx; font-size: $fs-mini; color: $color-danger; }
.sheet__row { display: flex; justify-content: flex-end; gap: 28rpx; padding-top: 6rpx; }
.sheet__btn { font-size: $fs-caption; color: $color-text-3; padding: 12rpx 8rpx; }
.sheet__btn--go { color: $color-primary; font-weight: $fw-bold; }
</style>
