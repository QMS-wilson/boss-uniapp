<template>
  <view class="login-page">
    <!-- 顶栏：左边"这是哪家"，右边齿轮进服务器地址设置。
         ★ 左边只在**问到云端、且这家商户确实存在**时才写商户名 ——
           地址填错时写一个假名字比不写更坏（客户会以为连上了自己家）。 -->
    <view class="topbar">
      <view class="topbar__mkt" @click="onBadge" hover-class="hv-on" :hover-stay-time="80">
        <!-- 两个分支各写死 name+color：gen-icon-data.py 是按 <Icon> 站点静态扫的，
             动态三元色会让它在"不知道运行时是哪个"时只能全色生成，能静态就静态。 -->
        <Icon v-if="badgeOk" name="store" :size="16" color="primary" />
        <Icon v-else name="alert-circle" :size="16" color="warning" />
        <text class="topbar__t" :class="{ 'topbar__t--bad': !badgeOk }">{{ badgeText }}</text>
      </view>
      <view id="gear" class="topbar__gear" @click="goServer" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="settings" :size="20" color="text-3" />
      </view>
    </view>

    <view class="logo-area">
      <view class="logo">
        <Icon name="layers" :size="56" class="logo-icon" color="white" />
      </view>
      <text class="app-name">进销存</text>
      <text class="app-sub">用财鲸 V3 的操作员和口令登录</text>
    </view>

    <view class="form-card">
      <!-- ① 账套。一本也要显示：老板要知道自己这次进的是哪本，
           不然两本账数字对不上时没人会想到是"进错本了"。 -->
      <view id="pick-db" class="row" :class="{ 'row--dim': !configured || !databases.length }">
        <text class="row__lab">账套</text>
        <picker class="row__pk" mode="selector" :range="dbLabels" :value="dbIndex"
                :disabled="!configured" @change="onDb">
          <view class="row__val">
            <text class="row__v">{{ dbLabels[dbIndex] || (configured ? '读不到账套' : '未设置连接') }}</text>
            <Icon name="chevron-down" :size="16" color="text-3" />
          </view>
        </picker>
      </view>
      <text v-if="dbNote" class="row__note">{{ dbNote }}</text>

      <!-- ② 操作员。清单来自客户机（免登录那条通道）；拿不到就回落成手输，
             绝不因为"客户机没开"把人堵在门外 —— 编号+口令本来就能进。
             ★ 但"没配连接"不一样：那时连是哪家都不知道，手输也没有可校验的对象，
               所以这一态下不给输入框、只给一句去齿轮的话。 -->
      <view v-if="operators.length" id="pick-op" class="row" :class="{ 'row--dim': !configured }">
        <text class="row__lab">操作员</text>
        <picker class="row__pk" mode="selector" :range="opLabels" :value="opIndex"
                :disabled="!configured" @change="onOp">
          <view class="row__val">
            <text class="row__v">{{ opLabels[opIndex] || '请选择操作员' }}</text>
            <Icon name="chevron-down" :size="16" color="text-3" />
          </view>
        </picker>
      </view>
      <view v-else-if="configured" class="row">
        <Icon name="user" :size="20" class="row__ic" color="text-3" />
        <input id="login-user" class="row__in" v-model="operator" type="text"
               placeholder="操作员编号或姓名" placeholder-class="row__ph" />
      </view>
      <text v-if="!operators.length && opReason" class="row__note">{{ opReason }}</text>

      <view class="row" :class="{ 'row--dim': !configured }">
        <!-- ★ 这只眼睛是真开关：以前它只是行首装饰，而 eye-off 的形状人人以为能点。
               要么让它点得动，要么别放 —— 放着不放更糟。 -->
        <view class="row__ic-btn" @click.stop="showPw = !showPw">
          <Icon v-if="showPw" name="eye" :size="20" class="row__ic" color="text-3" />
          <Icon v-else name="eye-off" :size="20" class="row__ic" color="text-3" />
        </view>
        <input id="login-pw" class="row__in" v-model="password" placeholder="V3 里的口令"
               placeholder-class="row__ph" :password="!showPw" :disabled="!configured" />
      </view>

      <view id="login-go" class="btn-primary login-btn"
            :class="{ 'is-disabled': !canSubmit }" @click="onLogin" hover-class="hv-on" :hover-stay-time="80">
        {{ loading ? '登录中…' : '登 录' }}
      </view>
      <text class="hint">登录口令与财鲸V3 操作员一致；如需修改，请在财鲸V3 客户端中操作</text>
    </view>

    <text class="footer">数据主权在本地 · 多端统一接入</text>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Icon from '../../components/Icon.vue'
import { useAuthStore } from '../../store/auth'
import { authApi } from '../../api/auth'
import { toast } from '../../utils/format'
import { merchantCode, selectedDatabase, setSelectedDatabase, storageKey, databaseSuffix } from '../../utils/merchant'
import { takeJumpFlag } from '../../utils/listJump'

const auth = useAuthStore()
const loading = ref(false)

/* ---------------- 顶栏：这家是谁 ---------------- */
const badgeOk = ref(false)
const badgeText = ref('正在连接…')
/** 徽标这一枪该去哪：限流类点它是"重取一次"，配置类点它是"去齿轮"。混在一起会让人去改一个对的地址 */
const badgeRetry = ref(false)
function goServer() { uni.navigateTo({ url: '/pages/server/index' }) }
function onBadge() {
  if (badgeRetry.value) { loadOptions(); return }
  if (!badgeOk.value) goServer()
}

/**
 * ★ 配没配连接 = 有没有商户码（身份只来自设置页那条链接，见 utils/merchant.js）。
 *   没配的时候这页是**零数据态**：两个下拉摆出来但点不动、登录键按不下去，
 *   并把"去齿轮设置"这句话写在脸上 —— 不能让人对着一个空列表自己猜。
 */
/**
 * ★ 必须是 ref + 每次 onShow 重算，不能写成 `computed(() => !!merchantCode())`：
 *   merchantCode() 读的是 storage，没有任何响应式依赖 ⇒ 首算之后永不失效。
 *   后果：没配连接时进登录页 → 去齿轮填好链接 → **按返回键**回来，
 *   configured 还是 false，口令框一直 disabled，只能回齿轮再点一次「去登录」。
 */
const configured = ref(!!merchantCode())

/* ---------------- 两份清单（进门前从云端拿） ---------------- */
const databases = ref([])
const dbIndex = ref(0)
const dbNote = ref('')
const operators = ref([])
const opIndex = ref(0)
const opReason = ref('')
const operator = ref('')          // 回落成手输时用它

const dbLabels = computed(() => databases.value.map((d) => String(d)))
const opLabels = computed(() => operators.value.map(
  (o) => (o.id + ' · ' + (o.name || '（无姓名）')) + (o.stopped ? '（已停用）' : '')))
const currentDb = computed(() => dbLabels.value[dbIndex.value] || '')
const currentOp = computed(() => (operators.value[opIndex.value] || {}).id || operator.value.trim())
const canSubmit = computed(() => configured.value && !!currentOp.value && !!password.value && !loading.value)

function pickIndex(list, want) {
  const i = list.findIndex((x) => String(x) === String(want))
  return i >= 0 ? i : 0
}

/**
 * ★ 记住上次**登录成功**的操作员（2026-10-07）。
 *
 *   键 = `cfg:lastOp` + 商户码 + 账套后缀，直接复用 merchant.js 的 storageKey/databaseSuffix
 *   —— 与草稿桶（`jxc_drafts`、`jxc_cache`）是同一套约定，不另造一份拼接规则。
 *
 *   ★ **两个后缀都不能省**：同 origin 下两家商户共用 localStorage，同一台机器又可能有
 *     两本账。裸键会把 A 家的操作员带到 B 家 —— 拿 A 本的人去登 B 本，等到的是一句
 *     「口令不符」，而人根本不会想到根因是"上次记住的那个人"。
 *
 *   ★ 只记操作员编号，**绝不记口令**：口令一旦落本机存储，等于把客户机的
 *     账套口令明文摊在磁盘上，与本项目"数据主权在本地"的口径相悖。
 */
function lastOpKey() { return storageKey('cfg:lastOp') + databaseSuffix() }

function readLastOp() {
  try { return String(uni.getStorageSync(lastOpKey()) || '').trim() } catch (e) { return '' }
}
function writeLastOp(id) {
  const v = String(id || '').trim()
  if (!v) return
  try { uni.setStorageSync(lastOpKey(), v) } catch (e) { /* 写不进去只影响预选，不影响登录 */ }
}

/**
 * 进登录页就拉一次清单。
 * ★ 这条通道不鉴权（清单只存在于客户机的账套库里），所以它**可能失败**：
 *   客户机没开、地址填错、商户码不存在、被限流。四种都要能继续登录，
 *   所以失败只影响"能不能选"，绝不影响"能不能输"。
 */
async function loadOptions() {
  if (!configured.value) {
    // ★ 连请求都不发：没有商户码，云端无从回答"这是哪家"，发出去只会拿到一句
    //   MERCHANT_REQUIRED，而那句是给"前缀写错了"的人看的，不是给没配置的人看的。
    badgeOk.value = false
    badgeText.value = '未设置连接'
    databases.value = []
    operators.value = []
    dbNote.value = ''
    opReason.value = '还没设置连接：点右上角齿轮，填一条「服务器地址/商户码」的链接，这页才会有数据'
    return
  }
  const res = await authApi.options()
  if (!res.ok) {
    badgeOk.value = false
    // ★ 两种"没问到"要分开写：地址不通和"地址通、这家不存在"是两件不同的事，
    //   人在设置页要改的东西也不一样（前者改主机，后者改最后那段短码）。
    //   统一一句"请设置服务器地址"会让短码写错的人去改一个本来就对的地址。
    const code = String(res.code || '')
    const codeWrong = ['MERCHANT_NOT_FOUND', 'MERCHANT_DISABLED', 'MERCHANT_REQUIRED'].indexOf(code) >= 0
    badgeRetry.value = false
    if (code === 'RATE_LIMITED' || code === 'AGENT_BUSY') {
      // ★ 限流不是配置错了：让人去齿轮改地址，改完还是登不进，只会更困惑。
      badgeText.value = '问得太频繁，点这里再试一次'
      badgeRetry.value = true
    } else if (code.indexOf('DATABASE') === 0) {
      // ★ 账套越界/改名：本地存的那份清单过期了，说"请设置服务器地址"是把人支到别处
      badgeText.value = '账套对不上，点这里重取一次'
      badgeRetry.value = true
    } else if (codeWrong) {
      badgeText.value = '商户码有误，请检查设置'
    } else {
      badgeText.value = '请设置服务器地址'
    }
    databases.value = []
    operators.value = []
    // ★ 为什么是手输也要说清楚（带原因）：这页随时可能因为"客户机没开/地址不对/
    //   选中的账套没登记"拿不到清单，一句"直接输编号就行"让人以为页面坏了。
    opReason.value = res.code === 'NETWORK_ERROR' || res.code === 'NOT_API'
      ? '连不上云端（' + (res.serverMessage || res.message || res.code) + '），点右上角齿轮设置地址；也可以直接输编号登录'
      : (res.serverMessage || res.message || '没拿到清单') + '；直接输编号或姓名登录也一样'
    return
  }
  const d = res.data || {}
  const m = d.merchant || {}
  badgeOk.value = true
  badgeRetry.value = false
  badgeText.value = m.title || m.code || merchantCode() || '本商户'
  databases.value = m.databases || []
  dbIndex.value = pickIndex(databases.value, selectedDatabase() || d.database)
  dbNote.value = databases.value.length > 1
    ? '这台主机上有 ' + databases.value.length + ' 个账套，切换账套需要重新登录（操作员与口令属于具体账套）'
    : ''
  const list = d.operators
  // ★ 上次登录用的操作员：还在清单里就预选它，不在/从没记过则退回第一个。
  const lastOp = readLastOp()
  if (Array.isArray(list) && list.length) {
    operators.value = list
    opIndex.value = lastOp ? pickIndex(operators.value.map((o) => o.id), lastOp) : 0
    opReason.value = ''
  } else {
    operators.value = []
    // 清单拿不到 ⇒ 这一行回落成手输：把上次那个编号填进去，
    // 但**只填空框**，不覆盖用户已经在打的字（loadOptions 会被 onShow 反复调）。
    if (lastOp && !operator.value) operator.value = lastOp
    const e = d.operators_error || {}
    opReason.value = e.code === 'AGENT_OFFLINE'
      ? '这台机器的本地服务没在线，输编号也能登录（口令对的才行）'
      : (e.message || '没拿到操作员清单，直接输编号或姓名')
  }
}

async function onDb(e) {
  dbIndex.value = Number(e.detail.value) || 0
  // ★ 选完就落盘：请求层的 X-Database 读的是这里，不落就会"界面写着 B、请求带着 A"
  setSelectedDatabase(currentDb.value)
  opIndex.value = 0
  // ★ 操作员清单是**按账套**读的（auth.v3users 打在这本库上）：换账套不重取，
  //   下拉里就还是上一本的人，拿着 A 本的人去登 B 本只会拿到口令不符。
  await loadOptions()
}
function onOp(e) {
  opIndex.value = Number(e.detail.value) || 0
  const o = operators.value[opIndex.value]
  if (o && o.stopped) {
    toast('操作员「' + (o.name || o.id) + '」已停用，暂无法登录移动端')
  }
}

const password = ref('')
const showPw = ref(false)

/*
 * 哪些失败必须**弹窗**：那几句话是要人去 V3 或去客户机上做一件事的，
 * 3 秒 toast 读不完，读不完就等于没说。话术来自云端与本地服务，前端不改写。
 */
const MODAL_CODES = ['NO_PASSWORD', 'USER_STOPPED', 'AMBIGUOUS_NAME', 'V3_LOGIN_UNAVAILABLE',
  'AGENT_OFFLINE', 'AGENT_TIMEOUT', 'MERCHANT_REQUIRED', 'MERCHANT_NOT_FOUND',
  'DATABASE_NOT_ALLOWED', 'DATABASE_NOT_FOUND', 'NOT_API']

function _why(res) {
  return res.serverMessage || res.message || '登录失败'
}

function showFail(res) {
  const why = _why(res)
  if (MODAL_CODES.indexOf(res.code) >= 0) {
    uni.showModal({ title: '登录没有成功', content: why, showCancel: false, confirmText: '知道了' })
    return
  }
  toast(why)
}

async function onLogin() {
  if (!canSubmit.value) return
  if (operators.value[opIndex.value] && operators.value[opIndex.value].stopped) {
    toast('该操作员已停用，请在财鲸V3 中恢复后再试，或更换其他操作员')
    return
  }
  loading.value = true
  try {
    const res = await authApi.login('v3', {
      user: currentOp.value, password: password.value, database: currentDb.value,
    })
    if (!res.ok) { showFail(res); return }
    // ★ setLogin 返回 false = 登录本身成功，但这个 URL 前缀不属于该商户。
    //   此时绝不能把令牌落盘，也不能 goHome()。
    if (res.data && auth.setLogin(res.data) === false) {
      toast(res.serverMessage || auth.tenantError || '该账号不属于当前商户入口')
      return
    }
    // ★ 必须写在 setLogin 之后：它内部刚把 selectedDatabase 落成"这次实际进的账套"，
    //   而 lastOpKey() 的账套后缀正是读它 ⇒ 写进去的键与下次进来读的键必然一致。
    writeLastOp(currentOp.value)
    toast('欢迎，' + ((res.data.user || {}).name || currentOp.value), 'success')
    goHome()
  } catch (e) {
    // App 端没有 devtools，"点了没反应"必须是可见的
    toast('登录出现异常，请重试（' + String((e && (e.message || e.errMsg)) || e).slice(0, 120) + '）')
  } finally {
    loading.value = false
  }
}

/**
 * 登录后落在哪：被「会话失效」踢下来时记的那一页优先（见 utils/request.js 的 _rememberReturnPage），
 * 其余情况照旧回首页。
 * ★ 用 reLaunch 而不是 navigateTo：登录页是栈底，回跳目标可能是详情页也可能是 tabBar 页，
 *   reLaunch 两种都走得通，且不会留下一条"登录页还在栈里"的尾巴。
 * ★ 十分钟之内的才算：隔了一夜再登录还把人扔回昨天那张单，看着像页面坏了。
 */
function goHome() {
  const back = takeJumpFlag('login_return')
  const path = back && back.path
  const fresh = back && Number(back.at) && (Date.now() - Number(back.at) < 10 * 60 * 1000)
  if (fresh && typeof path === 'string' && path.indexOf('/pages/') === 0) {
    uni.reLaunch({ url: path })
    return
  }
  uni.switchTab({ url: '/pages/home/index' })
}

loadOptions()

/**
 * 从齿轮页按返回键回来时，这一页的实例还活着（keep-alive）：
 * 重读一次链接，链接变了或清单还是空的就重取两份清单。
 */
let shown = false
onShow(() => {
  const now = !!merchantCode()
  const changed = now !== configured.value
  configured.value = now
  if (!shown) { shown = true; return }        // 首帧上面那次 loadOptions 已经负责了
  if (changed || !databases.value.length) loadOptions()
})
</script>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 48rpx 48rpx;
  box-sizing: border-box;
  background: linear-gradient(180deg, $color-primary-bg 0%, $color-bg 42%);
}

/* 顶栏 */
.topbar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* ★ 这页是 navigationStyle:custom —— 内容从屏幕 y=0 开始。
     H5 没有状态栏所以看不出来，App 上顶栏会和手机状态栏叠在一起（2026-09-29 装机第一次开屏就是）。
     --status-bar-height 由 uni 注入：H5 是 0、App/小程序是真实状态栏高度，所以不用分平台写两份。 */
  padding: calc(26rpx + var(--status-bar-height, 0px)) 0 6rpx;
}
.topbar__mkt { display: flex; align-items: center; gap: 10rpx; padding: 10rpx 4rpx; }
.topbar__t { font-size: $fs-caption; color: $color-primary; font-weight: $fw-bold; }
.topbar__t--bad { color: $color-warning; }
.topbar__gear { padding: 10rpx 12rpx; }

.logo-area { display: flex; flex-direction: column; align-items: center; margin: 26rpx 0 44rpx; }
.logo {
  width: 136rpx;
  height: 136rpx;
  border-radius: $radius-card;
  background: linear-gradient(135deg, $color-primary 0%, $color-primary-light 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: $shadow-primary;
}
.logo-icon { color: #fff; }
.app-name { font-size: 46rpx; font-weight: $fw-heavy; margin-top: 26rpx; color: $color-text; letter-spacing: 2rpx; }
.app-sub { font-size: $fs-caption; color: $color-text-3; margin-top: 10rpx; }

.form-card {
  width: 100%;
  background: $color-card;
  border-radius: $radius-card;
  padding: 40rpx;
  box-sizing: border-box;
  box-shadow: $shadow-raised;
}

/* 一行一项：账套 / 操作员 / 口令 */
.row {
  display: flex;
  align-items: center;
  background: $color-bg-sunken;
  border-radius: $radius-input;
  padding: 0 24rpx;
  margin-bottom: 24rpx;
}
.row--dim { opacity: 0.7; }
.row__lab { flex: 0 0 auto; font-size: $fs-caption; color: $color-text-3; margin-right: 20rpx; }
.row__ic { color: $color-text-3; margin-right: 16rpx; flex: 0 0 auto; }
/* 眼睛做成可点：外扩命中区，靠负 margin 把图标顶回与其它行同一条线上 */
.row__ic-btn {
  display: flex; align-items: center;
  padding: 10rpx; margin-left: -10rpx; margin-right: 6rpx;
  flex: 0 0 auto;
}
.row__ic-btn .row__ic { margin-right: 0; }
.row__pk { flex: 1; min-width: 0; }
.row__val { display: flex; align-items: center; justify-content: space-between; padding: 26rpx 0; }
.row__v { font-size: $fs-body; color: $color-text; flex: 1; min-width: 0; }
.row__in {
  flex: 1;
  min-width: 0;
  padding: 26rpx 0;
  font-size: $fs-body;
  color: $color-text;
}
.row__ph { color: $color-text-4; font-size: $fs-body; }
.row__note {
  display: block;
  margin: -12rpx 4rpx 22rpx;
  font-size: $fs-mini;
  line-height: 1.6;
  color: $color-text-3;
}

.login-btn { width: 100%; margin-top: 16rpx; }
.is-disabled { opacity: 0.5; }
.hint { display: block; text-align: center; margin-top: 22rpx; font-size: $fs-mini; line-height: 1.7; color: $color-text-4; }
.footer { margin-top: auto; padding-top: 60rpx; font-size: $fs-mini; color: $color-text-4; }
</style>
