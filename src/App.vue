<script setup>
import { onLaunch, onShow, onHide, onError, onUnhandledRejection } from '@dcloudio/uni-app'
import { useAuthStore } from './store/auth'
import { useCacheStore } from './store/cache'
import { merchantCode } from './utils/merchant'
import { authApi } from './api/auth'
import { config } from './utils/config'
import { pruneDrafts } from './utils/draftBox'
// #ifdef APP-PLUS
import { startAgentWatch, stopAgentWatch } from './utils/agentWatch'
import { initIntake, probeIntake } from './utils/yxIntake'
import { refreshAppInfo } from './utils/appInfo'
import { checkAppUpdate } from './utils/appUpdate'

/**
 * 「用其他应用打开」的两个回调，做成一份、两处共用：
 *   · `initIntake`（冷启动 + `newintent` 事件）
 *   · `App.onShow`（**不依赖任何事件**的兜底）
 *
 * ★★ 为什么要两处：真机实测"App 已在后台时从微信跳进来完全无反应"，
 *    根因是事件名写成了 `newIntent`（官方常量是**全小写 `newintent`**）。
 *    事件名这种东西错了不报错、只是永远不触发 —— 所以除了改对名字，
 *    再补一条"回到前台就重新探测"的路：**回到前台是一定会发生的**，不依赖事件通道。
 *
 * ★★ 两个回调都必须"出声"：上一版这里 `if (!isLoggedIn) return` 直接静默返回，
 *    现场表现就是"跳转过来了、无反应、也没有报错" —— 人根本不知道发生了什么。
 */
function yxIntakeHandlers() {
  return {
    onFile: () => {
      const auth = useAuthStore()
      if (!auth.isLoggedIn) {
        uni.showModal({
          title: '收到了一个文件',
          content: '文件已记下，但当前还没登录。\n登录后进「我的 → 燕秀产品处理」就能继续处理。',
          showCancel: false,
          confirmText: '知道了',
        })
        return
      }
      setTimeout(() => {
        // ★ 不带 query：文件是通过 yxIntake 的模块级 pending 交接的（页面 onShow 取走），
        //   传 `?intake=1` 而页面不读，会被 check-nav-links 判成「参数被无视」。
        // ★ 跳转失败也要出声：以前 try/catch 一吞，界面还是"无反应"。
        try {
          uni.navigateTo({
            url: '/pages/yxparts/index',
            fail: (e) => uni.showModal({
              title: '打开「燕秀产品处理」失败',
              content: String((e && e.errMsg) || e),
              showCancel: false,
            }),
          })
        } catch (e) {
          uni.showModal({
            title: '打开「燕秀产品处理」失败',
            content: String((e && e.message) || e),
            showCancel: false,
          })
        }
      }, 300)
    },
    // 「跳进来了，但系统没把文件 Uri 给我们」——这一支以前完全静默，最难查
    onProbe: (p) => {
      uni.showModal({
        title: '跳转进来了，但没取到文件',
        content: 'action：' + (p.action || '(空)')
          + '\narguments：' + (p.args || '(空)')
          + '\ndata：' + (p.data || '(空)'),
        showCancel: false,
        confirmText: '知道了',
      })
    },
  }
}
// #endif

/**
 * ★ 体验期现场证据：App 端没有 devtools，逻辑层抛异常的表现就是"点了没反应"
 *   （登录按钮变回原样、什么提示都没有 —— 2026-09-28 安卓包上撞到的就是这个形状）。
 *   所以把最近一次错误落到 storage 并当场弹出来；H5 有控制台，同样一条不亏。
 */
function surfaceCrash(where, e) {
  const msg = String((e && (e.message || e.errMsg)) || e || '未知')
  const text = where + '：' + msg.slice(0, 200)
  try { uni.setStorageSync('jxc_last_error', text) } catch (x) { /* 存不下也要弹 */ }
  uni.showModal({ title: '应用运行异常（' + where + '）', content: text, showCancel: false })
}
onError((e) => surfaceCrash('逻辑层', e))
onUnhandledRejection((e) => surfaceCrash('未处理的 Promise', (e && e.reason) || e))

/* ============ 版本升级提示 ============ */
// #ifdef MP-WEIXIN
/** 小程序官方更新管理器：新包下载好问一声是否重启（不强制，手头的事做完再更）。 */
function setupMpUpdate() {
  try {
    if (!uni.canIUse('getUpdateManager')) return
    const um = uni.getUpdateManager()
    um.onUpdateReady(() => {
      uni.showModal({
        title: '更新提示',
        content: '新版本已经准备好，是否重启应用？',
        confirmText: '立即重启',
        success: (r) => { if (r.confirm) um.applyUpdate() },
      })
    })
    // onUpdateFailed 不弹：多半是网络瞬断，下次启动自然再走一遍
  } catch (e) {}
}
// #endif

// #ifdef H5
/**
 * H5：deploy 每次发布都会带新的构建时间戳（vite 插件同时写入 dist/version.json
 * 与运行时 __BUILD_TIME__，见 vite.config.js）。回前台时静默比对（≥10 分钟一次），
 * 不一致说明服务器已是新版本 —— 旧标签页跑旧代码调新接口，是"莫名报错"的常见来源。
 */
let lastVersionCheck = 0
async function checkH5Update() {
  const now = Date.now()
  if (now - lastVersionCheck < 10 * 60 * 1000) return
  lastVersionCheck = now
  try {
    const res = await fetch('version.json?t=' + now, { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json()
    const mine = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''
    if (mine && data && data.t && Number(data.t) !== Number(mine)) {
      lastVersionCheck = 0    // 关掉弹窗后允许再查：万一又发了一版
      uni.showModal({
        title: '发现新版本',
        content: '系统已发布新版本，刷新页面即可生效。',
        confirmText: '立即刷新',
        showCancel: false,
        success: () => { location.reload() },
      })
    }
  } catch (e) { /* 本地 dev 没有 version.json，当没有这回事 */ }
}
// #endif

onLaunch(async () => {
  const auth = useAuthStore()
  const cache = useCacheStore()

  // #ifdef APP-PLUS
  /**
   * ★「用其他应用打开」把 Excel 接进来（2026-10-07）。
   *   这一枪要**尽早**挂上：晚于登录判断的话，被文件拉起时那段 awaits 会先跑完，
   *   冷启动的启动参数可能已经被消费掉。
   *
   * ★★ 两个回调都必须"出声"：上一版这里 `if (!isLoggedIn) return` 直接静默返回，
   *    现场表现就是**"跳转过来了、无反应、也没有报错"** —— 人根本不知道发生了什么。
   */
  initIntake(yxIntakeHandlers())
  // #endif

  auth.restore()           // 必须先于 cache.restore()：cache 的桶键要读「当前账套」，
                           //   而那个值由 auth 校验过（清单里没这本就清成默认）才可用
  cache.restore()          // ★ 以前没人调用过：离线缓存与草稿其实从没回填过
  pruneDrafts()            // 草稿箱按配置天数剪枝（改小天数后，超期的下次启动就没了）
  // ★ 本入口与已存会话归属对不上 → 清掉再走登录页。键已经带商户码，正常不会撞上；
  //   这一步防的是"旧版本残留在同一台机器上的别家会话"，宁可多退一次登录，
  //   也不能带着别家身份进本商户的界面（2026-09-26 实测过的那种串号）。
  const want = merchantCode()
  const got = String(((auth.stores || [])[0] || {}).agent || '').trim().toLowerCase()
  if (want && got && want !== got) {
    auth.clear()
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  if (!auth.isLoggedIn) {
    // Mock 模式自动登录，直接进首页预览
    if (config.USE_MOCK) {
      const res = await authApi.login('password', { account: 'demo', password: 'demo' })
      if (res.ok) auth.setLogin(res.data)
    } else {
      uni.reLaunch({ url: '/pages/login/index' })
    }
    return
  }
  if (cache.hasDrafts()) cache.flushDrafts()   // 只重放本商户 + 本账套的草稿（两道归属过滤）
  // 版本升级提示（各自按端编译）
  // #ifdef MP-WEIXIN
  setupMpUpdate()
  // #endif
  // #ifdef H5
  checkH5Update()
  // #endif
  // ★ 网络恢复这一枪：断网提交时界面说的是"联网后自动上传"，而进程常驻（H5/小程序/App
  //   都不一定被杀）时冷启动那一枪永远不会再来 ⇒ 这句话以前是假的。
  try {
    uni.onNetworkStatusChange((r) => {
      if (r && r.isConnected && cache.hasDrafts()) reportFlush(cache.flushDrafts())
    })
  } catch (e) { /* 老基础库没这个 API：少一次自动传，不影响正确性 */ }
})

/**
 * 重放结果里"要人看一眼"的那部分说出来。
 * ★ 只报第一次见到的那条，否则每次回前台都弹一句同样的话。
 */
const warned = {}
function reportFlush(p) {
  Promise.resolve(p).then((rs) => {
    const bad = (rs || []).filter((x) => x && !x.ok && !x.skipped)
    bad.forEach((x) => {
      if (warned[x.id]) return
      warned[x.id] = 1
      uni.showToast({ title: x.message || '有离线单没能自动上传，请到草稿里看一眼', icon: 'none', duration: 3500 })
    })
  }).catch(() => {})
}

onShow(() => {
  // 回前台时静默刷新 token（若快过期）
  const auth = useAuthStore()
  if (auth.isLoggedIn) auth.maybeRefresh()
  // ★ 回前台也补一次重放：手机从后台切回来往往就是网络刚恢复的那一刻，
  //   比等冷启动靠谱（进程不杀就永远不冷启动）。超窗的那批由 cache 自己挡着。
  const cache = useCacheStore()
  if (auth.isLoggedIn && cache.hasDrafts()) reportFlush(cache.flushDrafts())
  // #ifdef H5
  checkH5Update()
  // #endif
  // 本地服务掉线提醒：只有装到手机上的应用有"系统通知"这回事，其他两端整段不编译进来
  // #ifdef APP-PLUS
  startAgentWatch()
  // ★ 版本这件事要**先问运行时再显示**：`plus.runtime.versionCode` 永远是 APK 的基线，
  //   装过 wgt 之后只有 getProperty 才是"现在在跑的这版"。（「我的 → 关于」读的就是它）
  refreshAppInfo()
  // 发现新版本（wgt 热更）：内部限流 6 小时，且任何一步不满足都不弹框，
  //   免得正在开单的人被一个弹窗打断 —— 这条是"旧包调新接口莫名报错"的解药。
  checkAppUpdate()
  // ★ 回到前台就重新探测一次 intent —— **不依赖 `newintent` 事件通道**的兜底。
  //   实测"App 已在后台时从微信跳进来无反应"就是事件名写错导致的，
  //   而"回到前台"这件事本身一定会发生，所以这条能兜住。
  //   （普通回前台不会误报：`looksLikeFileIntent` 只认 VIEW/SEND，且 5 秒内同签名会去重。）
  probeIntake(yxIntakeHandlers())
  // #endif
})

/** ★ 退后台就停轮询：省电，也别在人不看的时候攒一堆状态变化 */
// #ifdef APP-PLUS
onHide(() => stopAgentWatch())
// #endif
</script>

<style lang="scss">
/* ============================================================
   全局基础样式（老板端视觉规范）
   ============================================================ */
page {
  background-color: $color-bg;
  color: $color-text;
  font-size: $fs-body;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* ============ 布局工具类 ============ */
.flex { display: flex; }
.flex-center { display: flex; align-items: center; justify-content: center; }
.flex-between { display: flex; align-items: center; justify-content: space-between; }
.flex-col { display: flex; flex-direction: column; }
.flex-1 { flex: 1; min-width: 0; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tnum { font-variant-numeric: tabular-nums; }

/* ============ 文字语义色 ============ */
.text-danger { color: $color-danger; }
.text-success { color: $color-success; }
.text-warning { color: $color-warning; }
.text-primary { color: $color-primary; }
.text-muted { color: $color-text-2; }
.text-faint { color: $color-text-3; }
.fw-bold { font-weight: $fw-bold; }

/* ============ 页面容器 ============ */
.page {
  min-height: 100vh;
  padding: $space-page;
  box-sizing: border-box;
}
/* 列表类页面：顶部/搜索栏通栏，内容再单独补边距 */
.page-flush {
  min-height: 100vh;
  padding: 0 0 $space-page;
  box-sizing: border-box;
}

/* ============ 卡片 ============ */
.card {
  background: $color-card;
  border-radius: $radius-card;
  padding: $space-card;
  box-shadow: $shadow-card;
}
.card + .card { margin-top: $space-gap; }

/* 区块标题行：左标题 + 右操作 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: $space-gap 0 $space-inner;
}
.section-head__title {
  font-size: $fs-subtitle;
  font-weight: $fw-bold;
  color: $color-text;
}
.section-head__action {
  display: flex;
  align-items: center;
  gap: 2rpx;
  font-size: $fs-caption;
  color: $color-text-3;
}

/* ============ 指标数字（金额可读性核心） ============ */
.metric-value {
  font-family: $font-num;
  font-size: $fs-metric;
  font-weight: $fw-heavy;
  color: $color-text;
  letter-spacing: -0.5rpx;
  font-variant-numeric: tabular-nums;
}
.metric-label {
  font-size: $fs-caption;
  color: $color-text-2;
}
.metric-note {
  font-size: $fs-mini;
  color: $color-text-3;
}

/* ============ 主按钮 ============ */
.btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  height: 96rpx;
  border-radius: $radius-btn;
  background: $color-primary;
  color: #fff;
  font-size: $fs-body;
  font-weight: $fw-bold;
  border: 0;
  line-height: 1;
  box-shadow: $shadow-primary;
}
.btn-primary:active { background: $color-primary-dark; }
.btn-primary[disabled] { opacity: 0.5; }

.btn-ghost {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  height: 88rpx;
  border-radius: $radius-btn;
  background: $color-card;
  border: 1rpx solid $color-border;
  color: $color-text-2;
  font-size: $fs-body;
  line-height: 1;
}

/* 底部固定操作条 */
.action-bar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  padding: $actionbar-pad $space-page calc(#{$actionbar-pad} + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 -2rpx 20rpx rgba(21, 36, 59, 0.06);
  z-index: 40;
  display: flex;
  gap: $space-tight;
}
/* 给固定操作条让位（全站唯一的「底栏预留」来源）
 *
 * ★★ 为什么带 !important？
 *   页面里任何一条 scoped 规则（编译成 .page[data-v-x]，优先级 0,2,0）
 *   都能压过这条全局单类规则（0,1,0），而且**不会有任何报错**——
 *   2026-09-20「新增销售单」底部被按钮盖住就是这个原因：
 *   sales/edit.vue 里一句多余的 `.page { padding: $space-page; }`
 *   把 200rpx 的预留静默换成了 36rpx。
 *   预留量是全站统一约定，不允许被页面局部规则覆盖，所以显式加权。
 *
 * ★ 数值来自 uni.scss 里定义的底栏令牌（底栏真实高度 + 呼吸余量 + 安全区），
 *   底栏改高时改令牌，不要在这里写死数字。
 *   改完跑 scripts/check-bottom-clearance-live.js 复验。
 */
.has-action-bar {
  padding-bottom: calc(#{$actionbar-height} + #{$actionbar-gap} + env(safe-area-inset-bottom)) !important;
}
/* 带「合计」行的底栏（开单页，2026-10-10 UI 体检 07 板）
 *
 * 开单页边录边看的数就是合计，放在卡片里滚到第 8 行明细就看不见了 ⇒ 搬进底栏常驻。
 * 多出来那一行只加在这一组类上，详情/改单那些页面的预留高度不跟着变。
 * ★ $actionbar-total 与下面两条必须一起维护，改完跑 check-bottom-clearance-live.js。
 */
.action-bar--total { flex-direction: column; }
.action-bar--total .bar-btns { display: flex; gap: $space-tight; }
.bar-total {
  display: flex; align-items: baseline; justify-content: space-between; gap: $space-inner;
  min-height: $actionbar-total;
  font-size: $fs-caption; color: $color-text-2;
}
.bar-total__amt {
  /* ★ 字号/数字字体放在**容器**上让它继承，不要给 <AmountText> 传 class：
       它的 scoped `.amount` 与页面传进去的类优先级打平（都是 0,2,0），
       谁生效取决于样式表顺序 ⇒ 实测字号根本没吃进去。
       它自己只定 color/font-weight/tabular-nums，不碰 font-size。 */
  display: flex; align-items: baseline; gap: 12rpx;
  font-family: $font-num; font-size: $fs-num-lg; font-variant-numeric: tabular-nums;
}
.bar-total__amt > text:first-child { font-size: $fs-caption; font-weight: $fw-normal; color: $color-text-2; }
.has-action-bar--total {
  padding-bottom: calc(#{$actionbar-height} + #{$actionbar-total} + #{$actionbar-gap}
    + env(safe-area-inset-bottom)) !important;
}

/* ============ 列表页固定头部 ============
 *
 * ★ 为什么是 fixed 而不是 sticky？
 *
 * sticky 的语义是「先跟着流走，碰到 top 再钉住」——
 * 元素从初始位置移动到 top 的这段距离**必然会动**。
 * 实测（真实页面 + 真实编译产物）销售列表：
 *     滚动 0   → 搜索栏 top = 44   （标题栏正下方）
 *     滚动 30  → 搜索栏 top = 14   ← 正在往上跑
 *     滚动 80  → 搜索栏 top = 0    ← 才钉住
 * 所以「搜索框会跟随滑动、被滑到标题位置」是 sticky 的固有行为，不是 bug，
 * 靠调 top 数值治不好。
 *
 * 需求是「和标题栏一样纹丝不动」→ 只能用 fixed。
 * 锚点用官方的 --window-top（uni-app H5 自带的导航栏高度变量，
 * 实测值 calc(44px + 0px)，与 uni-page-head 实际高度一致）；
 * 小程序端该变量同样由官方注入，无需为端差异写死数值。
 *
 * 两个位置的约定（页面无需关心具体像素）：
 *   搜索栏 = --window-top
 *   筛选条 = --window-top + $searchbar-height
 *
 * ★ 内容补偿：fixed 会让元素脱离文档流，列表顶部要留出这两块的高度，
 *   否则首条数据会被盖住。用 .page-flush--fixed 一次性补足，
 *   高度正好等于「搜索栏 + 筛选条」= $searchbar-height * 2。
 */

.search-bar {
  padding: 16rpx $space-page;
  background: $color-card;
}
.search-input {
  display: flex;
  align-items: center;
  gap: 14rpx;
  height: 80rpx;
  padding: 0 28rpx;
  border-radius: $radius-pill;
  background: $color-bg-sunken;
  color: $color-text-3;
  box-sizing: border-box;
}
.search-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: $fs-body;
  color: $color-text;
}
.search-input__placeholder { color: $color-text-4; font-size: $fs-body; }
/* 清空按钮
   ★ U6：触控热区撑到 88rpx(44px)，灰底圆视觉仍 34rpx(17px) ——
     透明 padding 外扩 + 负 margin 拉回布局，不挤输入框。 */
.search-clear {
  flex: 0 0 auto;
  width: 34rpx;
  height: 34rpx;
  padding: 27rpx;
  margin: -27rpx;
  border-radius: 50%;
  background: rgba(137, 149, 165, 0.24);
  background-clip: content-box;
  display: flex;
  align-items: center;
  justify-content: center;
  color: $color-text-2;
}
/* ★★ 日期/时间选择器的弹层必须压过我们自己的半页浮层（.sheet-mask 是 1000）。
   uni-h5 的 `.uni-picker-container` 只给到 999 ⇒ 在筛选半页里点日期，弹层被压在白面板底下，
   看着就是"点了没反应 / 被半页遮住"（用户连报两次，第一次我只修了滚动容器、没修层级）。
   取 1200：压过半页(1000)、tabBar(998) 与三按钮框(120)。框架注入的类，只能在这里盖一层。 */
.uni-picker-container { z-index: 1200 !important; }

/* 列表页搜索行：搜索框 + 漏斗。漏斗是"还有别的条件在这儿"的入口，
   宽度固定不跟着搜索框缩 —— 375 宽的机器上先被挤扁的一定是它。 */
.search-line { display: flex; align-items: center; gap: 14rpx; }
.search-line .search-input { flex: 1 1 auto; min-width: 0; }
/* 88rpx = 44px @375：原来是 80rpx(40px)，实测低于触摸底线，
   而它是销售/采购/商品/客户/库存五个列表页唯一的「打开筛选」入口。 */
.search-fan {
  flex: 0 0 auto; width: 88rpx; height: 88rpx;
  display: flex; align-items: center; justify-content: center; gap: 4rpx;
  border-radius: $radius-pill; background: $color-bg-sunken;
}
.search-fan--on { background: $color-primary; }
.search-fan__n { font-family: $font-num; font-size: $fs-mini; color: #fff; line-height: 1; }

/* 已生效的条件行：跟着页面滚（固定的只有搜索栏与状态条），
   一格一个条件、各自带 ✕ —— 清掉一个不许把另一个也带走。销售/采购两页共用。 */
.cond-row { display: flex; flex-wrap: wrap; gap: $space-tight; padding: 16rpx $space-page 0; }
.cond-chip {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  max-width: 100%;
  padding: 10rpx 20rpx;
  border-radius: $radius-pill;
  background: rgba($color-primary, 0.1);
  color: $color-primary;
  font-size: $fs-mini;
}
.cond-chip__t { max-width: 360rpx; }
.cond-chip__x { display: flex; padding: 4rpx; opacity: 0.7; }

/* 列表页搜索栏：固定在标题栏正下方，完全不动 */
.search-bar--sticky {
  position: fixed;
  left: 0;
  right: 0;
  top: var(--window-top, 44px);
  z-index: 29;
}
/* 筛选条：紧贴搜索栏下沿，同样固定 */
.filter-row--sticky {
  position: fixed;
  left: 0;
  right: 0;
  top: calc(var(--window-top, 44px) + #{$searchbar-height});
  z-index: 28;
}
/* 内容补偿：给固定的搜索栏 + 筛选条让位，避免首条被盖住 */
.page-flush--fixed { padding-top: calc(#{$searchbar-height} * 2); }
/* 只有搜索栏、没有筛选条的页面，少让一条的高度 */
.page-flush--fixed-1 { padding-top: #{$searchbar-height}; }

/* 加载更多 / 没有更多 */
.load-more, .no-more {
  text-align: center;
  padding: 30rpx 0;
  font-size: $fs-caption;
  color: $color-text-4;
}
.load-more {
  display: flex; align-items: center; justify-content: center; gap: 6rpx;
  color: $color-primary;
}
.bottom-gap { height: 60rpx; }
/* ★ 有悬浮新建按钮(FAB)的列表页：底部预留要够高，否则滚到底时最后一行右侧的
   金额/库存仍被 FAB 压住（FAB 覆盖距底约 75~131px，60rpx 只让到 85px）。
   加到 fab-size + 60rpx ≈ 86px 才能把最后一行完全滚出覆盖区。 */
.bottom-gap--fab { height: calc(#{$fab-size} + 60rpx); }

/* ============ 筛选条 ============ */
.filter-row {
  display: flex;
  gap: $space-inner;
  padding: $space-inner $space-page;
  background: $color-bg;
}
.filter-chip {
  height: 88rpx; /* U6：44px 触控下限 */
  padding: 0 30rpx;
  border-radius: $radius-pill;
  background: $color-card;
  border: 1rpx solid $color-border;
  color: $color-text-2;
  font-size: $fs-caption;
  display: flex;
  align-items: center;
  line-height: 1;
}
.filter-chip--active {
  background: $color-primary;
  border-color: $color-primary;
  color: #fff;
  font-weight: $fw-bold;
}
/* 筛选格数到第五个（销售/采购多了「草稿」那格）之后，375 宽的机器上 5 个胶囊放不下。
   U18：改成等宽分段控件 —— 5 格均分整行、一眼看全，不再横向滚。
   2026-10-09 按方案截图定稿视觉：整条 = 浅灰底($color-bg-sunken)大圆角轨道、项间无缝；
   选中项 = 白胶囊 + 蓝色加粗字；未选中项透明底纯文字（去掉独立白胶囊的描边/阴影）。
   ★ 轨道自身 padding 8rpx，草稿角标探出量相应收到 6rpx，保证不越过 row 上/右边缘。 */
.filter-row--tight {
  gap: 0;
  margin: 8rpx $space-page;
  padding: 8rpx;
  background: $color-bg-sunken;
  border-radius: $radius-pill;
}
.filter-row--tight .filter-chip {
  flex: 1 1 0;
  min-width: 0;
  justify-content: center;
  padding: 0 8rpx;
  white-space: nowrap;
  background: transparent;
  border: 0;
  /* 文字要压在滑动胶囊上面：胶囊是绝对定位的，默认会盖住普通流里的内容，
     所以两边都提上来并按 DOM 顺序分先后（指示器写在格子前面）。
     不用 z-index:-1 那种"负层级"技巧 —— 微信那边对负 z-index 的绘制顺序不稳。 */
  position: relative;
  z-index: 1;
}
/* ★ 选中态不再自己画白胶囊 —— 那颗白的是下面那个滑动的指示器，这里只管字。
     留着背景的话切换瞬间会出现"两层白"的重影，而且旧格子淡出比胶囊滑走慢半拍。 */
.filter-row--tight .filter-chip--active {
  background: transparent;
  border: 0;
  color: $color-primary;
  box-shadow: none;
}
/* ============ 分段控件的滑动胶囊（2026-10-09）============
 * 分段控件项间无缝、等宽，选中项**整颗滑过去**比"原地换色"更能说清
 * "这是同一颗东西换了一格"，而不是"两格各自变了样"。
 *
 * ★ 位置用 translateX(第几格 × 100%) 算，**不量 DOM**：
 *   五格 `flex:1 1 0` 且 `gap:0` ⇒ 每格宽度天然等分，百分比就是精确值。
 *   转屏、改字号、以后加到六格都不用改代码，也不用等布局稳定后再量一次。
 * ★ 宽度要减掉轨道自己的左右 padding（各 8rpx），否则第五颗会探出轨道右沿。
 * ★ 不用 CSS 自定义属性传下标（`--seg-i`）：小程序会把 :style 对象再过一遍 wxss，
 *   自定义属性不一定透得过去；写成普通 transform 字符串三端都稳。
 * ★ 轨道本身已经是定位祖先（`--sticky` 给了 fixed），这里不再补 position。
 */
.seg-pill {
  position: absolute;
  top: 8rpx;
  bottom: 8rpx;
  left: 8rpx;
  width: calc((100% - 16rpx) / 5);
  border-radius: $radius-pill;
  background: $color-card;
  box-shadow: $shadow-card;
  transition: transform $dur-panel $ease-out;
  /* 它只是个影子，不许吃掉格子的点击，也不许被当成第五/第六个 .filter-chip 量到 */
  pointer-events: none;
}
/* 库存页那一排只有 4 格（全部/有货/负库存/零库存），宽度得按 4 等分算。
   ★ 分母必须和该页 .filter-chip 的**个数**同源：写死 5 的话第 4 格会滑出轨道外。 */
.seg-pill--4 { width: calc((100% - 16rpx) / 4); }

/* ============ 列表 ============ */
.list {
  padding: $space-inner $space-page 0;
  display: flex;
  flex-direction: column;
  gap: $space-inner;
}

/* ============ 悬浮新建按钮 ============ */
.fab {
  position: fixed;
  right: $space-page;
  bottom: calc(#{$tabbar-height} + 40rpx + env(safe-area-inset-bottom));
  width: $fab-size;
  height: $fab-size;
  border-radius: 50%;
  background: $color-primary;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  box-shadow: $shadow-primary;
  z-index: 35;
}
.fab:active { background: $color-primary-dark; }

/* ============ 触摸反馈（2026-10-08）============
 * 全站 193 个可点的 <view> 以前只有 8 处 `:active`，而 `:active` 挂在 view 上
 * 小程序端基本不触发 ⇒ 手机上点下去**没有任何回应**，只能等页面自己变。
 * 走 `hover-class` 是因为它是三端唯一都认的机制（uni-h5 自己也实现了 hoverProps）。
 *
 * ★ 这里**故意不加 transition**：hover-class 是"按下才挂上、抬起就摘掉"的类，
 *   把 transition 和属性写在同一个类上，挂上的一瞬间没有旧值可比、摘掉时类已经没了
 *   ⇒ 两头都不会补间，等于白写。要平滑就得给元素常驻一个类，那是 193 处 × 两个属性的代价。
 *   按下反馈本来就是"越即时越像真的"，抬起后靠 `:hover-stay-time="80"` 留 80ms 收尾。
 * ★ 只改 opacity 与 transform，**不改 background**：改背景会和"选中态/危险态"那套配色
 *   打架（档案页 .chip--stop 那次是"生效了但脸还是灰的"，同一类问题）。
 * ★ 必须配 `:hover-stay-time="80"`：uni 默认 400ms，松手后按下态还要挂 0.4 秒，
 *   开单页一天点几百次，那 0.4 秒就是"发黏"。
 */
.hv-on {
  opacity: $tap-press-opacity;
  transform: scale($tap-press-scale);
}
/* 整行/整卡这种"宽度撑满"的可点块，缩放会露出左右被裁的一丝 ⇒ 只压亮度 */
.hv-on--flat { opacity: $tap-press-opacity; transform: none; }
/* 遮罩本身**不要**挂 hover-class：它撑满全屏，挂上去等于整屏闪一下，
   而且它的高亮区域就是"点空白关掉"这个动作本身，不需要额外反馈。 */

/* ============ 列表首屏错峰入场（2026-10-09）============
 * 配合 utils/enterStagger.js：类名 + animationDelay 都由那个组合式函数给，
 * 本类只负责"从哪来"——12rpx 的位移 + 淡入，160ms。位移刻意很小：
 * 大了会像"卡片在飞"，工具型 app 只要"到位感"。
 *
 * ★★ 填充模式必须是 `backwards`，**不能是 forwards / both**：
 *   `animation-fill-mode` 在层叠里的优先级高于普通声明，一旦写了 forwards，
 *   动画结束后 transform / opacity 会被**永久钉死在终态**，
 *   而 .hv-on（按下反馈）改的正是这两个属性 ⇒ 那一行的点击反馈从此失效，
 *   且不报错、只在真机上"感觉点不动"。backwards 只补延迟期、结束即交还控制权。
 *
 * ★ 位移在行元素上、不在容器上：行元素内部没有 fixed 后代，动它就安全。
 */
.enter-row {
  animation: row-in $dur-fast $ease-out backwards;
}
@keyframes row-in {
  from { opacity: 0; transform: translateY(12rpx); }
  to { opacity: 1; transform: none; }
}

/* ============ 状态变更脉冲（2026-10-09）============
 * 审核 / 反审 / 作废成功之后，状态标签要**自己说一句"我变了"**：
 * 现在只剩一条 toast，标签是从黄字直接换成绿字，人回头再看根本分不清
 * 是"这次操作生效了"还是"页面重新拉了一次"。
 *
 * ★ 放全局、不放在 StatusTag 的 scoped 里：这是"全站只有一种长相"的动作语言，
 *   定义一处、要用的时候挂类即可（目前唯一使用方是销售单详情；采购侧没有审核操作，
 *   不涉及；将来别的状态位要播同一个脉冲时，不必去翻哪个组件里抄过一份）。
 * ★ 类名由 JS 加/摘（见 StatusTag.vue 的 pulse prop），**不常驻**——
 *   常驻 transform 会成为后代 fixed 的包含块，这个坑上面 .enter-row 那条注释里写过。
 */
.tag-pulse { animation: tag-pulse 460ms $ease-spring; }
@keyframes tag-pulse {
  0% { transform: scale(1); }
  45% { transform: scale(1.10); }
  100% { transform: scale(1); }
}

/* ============ 行退场（2026-10-09）============
 * 删草稿这类"破坏性操作"以前是**行凭空消失**、下面的行瞬间上移 ——
 * 人分不清是"删掉了"还是"列表出问题了"。先让它走掉，再真删。
 * 这条终于用上了 $ease-in（退场曲线）：进场用 $ease-out（快进慢停），
 * 退场就该反过来 —— 慢起快出，看着像"被抽走"。
 *
 * ★★ 这里必须用 `forwards`，和 .enter-row 的 `backwards` **正好相反**：
 *   .enter-row 结束后要把控制权交还（否则压死 .hv-on 按下反馈）；
 *   而 .row-leave 结束后元素马上要被移除，需要它**保持隐藏** ——
 *   写 backwards 的话动画一结束、数据还没删，行会"闪回"一下再消失。
 * ★ 位移只有 16rpx 向左：够看出"往左走了"，又不会像被甩出去。
 * ★ 时序由 JS 控（utils/leaveRow.js）：动画 240ms，JS 260ms 后才真删。
 */
.row-leave {
  animation: row-out $dur-panel $ease-in forwards;
  pointer-events: none;
}
@keyframes row-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateX(-16rpx) scale(.98); }
}

/* ============ 空态淡入（2026-10-09）============
 * 空态是"数据到了、这条没有"，它和内容一样属于**结果**，
 * 硬切出来容易被读成"页面出问题了"。只淡 opacity、不带位移 ——
 * 空态和 .action-bar（fixed）同处 LoadState 的插槽内，带 transform 会造包含块。
 */
.fade-in { animation: fade-in $dur-fast $ease-out; }
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ============ 行内小转圈（2026-10-09）============
 * 给"请求正在飞"用的一次性指示（半页筛选里的搜索，以及将来其它行内请求）。
 * ★ 定义在全局而不是各组件 scoped 里：scoped 的 @keyframes 会被重命名、跨不了组件边界，
 *   各写一份就会出现"同样是转圈、尺寸和颜色不一样"。
 * ★ **不进 prefers-reduced-motion 归零**：转圈是**进度指示**不是装饰动效 ——
 *   把它停掉，用户看到的是一个"卡住不动的圆圈"，比没有更糟。
 *   （骨架屏的呼吸归零是另一回事：静态灰条照样能占位、能表意。）
 */
.inline-spin {
  width: 24rpx; height: 24rpx; flex: 0 0 auto;
  border-radius: 50%;
  border: 3rpx solid $color-border;
  border-top-color: $color-primary;
  animation: inline-spin $dur-spin linear infinite;
}
@keyframes inline-spin { to { transform: rotate(360deg); } }

/* ============ 半页弹层（2026-10-08 收拢）============
 * 以前 4 个页面各抄了一份**逐字相同**的 `.mask` 规则，而且 11 个弹层里 10 个
 * 是 `v-if` 瞬间出现、瞬间消失 —— 东西凭空冒出来，是"质感"里最容易被看见的缺失。
 * 统一放这里，页面里那份删掉（scoped 的 [data-v] 特异性更高，不删这份不生效）。
 *
 * ★ 只做**入场**，退场仍是瞬时，两个原因都是实测出来的约束、不是偷懒：
 *   ① 改 `v-show` 才能播退场，但已关闭的面板会留在 DOM 里，
 *     `.mask .picker-item` 的计数会把它们算进去 —— 三处实况门依赖这个计数
 *     （采购改单门就是靠它区分"弹窗没开"和"开了但没候选"）；
 *   ② `<transition>` 的 leave 在小程序端不支持（没有 DOM 可以加类）。
 *   要补退场，得先把那三处门的计数改成"只数当前可见的那个 mask"。
 */
.mask {
  position: fixed; inset: 0;
  background: rgba(21, 36, 59, 0.5);
  z-index: 100;
  display: flex; align-items: flex-end;
  animation: mask-in $dur-fast $ease-out;
}
.mask-panel {
  width: 100%;
  background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: panel-up $dur-panel $ease-out;
}
/* ★ 面板的入场挂在"子元素类名"上，而不是给 11 处模板各加一个 class：
     面板类一共就这两种（.picker 7 处 / .sheet 4 处），
     改 11 处模板的代价和风险（漏一处、或碰坏 scoped 选择器）都比这条规则大。
     三个组件（FilterSheet / ArchiveFilterSheet / ThreeChoiceDialog）用的是自己的
     .sheet-mask / .af-mask / .dlg-mask 类名，够不到这里，各自在组件内补了同样的动画。 */
.mask > .picker, .mask > .sheet {
  animation: panel-up $dur-panel $ease-out;
}
.mask > .dlg { animation: dlg-pop $dur-fast $ease-out; }
@keyframes mask-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes panel-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
@keyframes dlg-pop {
  from { opacity: 0; transform: scale(.94); }
  to { opacity: 1; transform: scale(1); }
}
/* ★ 系统"减少动效"打开时全部归零（H5/App 的 webview 认这条；小程序不认也无害）。
     补药、扫码这类页面本身没有动效，不受影响。 */
@media (prefers-reduced-motion: reduce) {
  .mask, .mask-panel,
  .mask > .picker, .mask > .sheet, .mask > .dlg { animation: none; transition: none; }
  /* 滑动胶囊归零的是**位移过渡**，不是它本身 —— 它一停，选中态就没人画了。
     和上面 .inline-spin 那条同一个道理：指示性的东西不能关。 */
  .seg-pill { transition: none; }
  .hv-on, .hv-on--flat { transform: none; opacity: 1; }
  /* 列表入场、状态脉冲、行退场、空态淡入一起归零：前三个只去掉位移/缩放，
     元素本身照常显示 —— 别写成 display:none 那一类。
     ★ .row-leave 也一样：动画没了照样靠 JS 的 260ms 删掉那行，只是看不见过程。 */
  .enter-row, .tag-pulse, .row-leave, .fade-in { animation: none; }
}

/* ============ 表单 ============ */
.field-group {
  background: $color-card;
  border-radius: $radius-card;
  padding: 8rpx $space-card;
  box-shadow: $shadow-card;
}
.field-group + .field-group { margin-top: $space-gap; }
.field-group__title {
  font-size: $fs-caption;
  font-weight: $fw-bold;
  color: $color-text-3;
  padding: 24rpx 0 8rpx;
}
.field {
  display: flex;
  align-items: center;
  min-height: 92rpx;
  border-bottom: 1rpx solid $color-divider;
  gap: $space-inner;
}
.field:last-child { border-bottom: 0; }
.field__label {
  flex: 0 0 auto;
  width: 168rpx;
  font-size: $fs-body;
  color: $color-text-2;
}
.field__control {
  flex: 1;
  min-width: 0;
}
.field input, .field textarea {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: $fs-body;
  color: $color-text;
  box-sizing: border-box;
}
.field--stack {
  flex-direction: column;
  align-items: stretch;
  padding: 22rpx 0;
}
.field--stack textarea {
  min-height: 130rpx;
  margin-top: 12rpx;
  line-height: 1.6;
}

/* ============ 提示信息 ============ */
.form-message {
  margin-top: $space-inner;
  color: $color-danger;
  font-size: $fs-caption;
  text-align: center;
}

/* ============ 安全区 ============ */
.safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
}

/* ============ U9 宽屏版心（仅 H5 电脑浏览器，>750px 时收窄居中）============
   手机上无变化；电脑上把内容与固定的搜索栏/筛选条/底部操作条收进 750px 居中，
   FAB 按 750px 容器右缘定位。弹层遮罩(.mask / sheet / dialog)保持满屏、不收窄。 */
@media (min-width: 751px) {
  .page,
  .page-flush {
    max-width: 750px;
    margin-left: auto;
    margin-right: auto;
  }
  .search-bar--sticky,
  .filter-row--sticky,
  .action-bar {
    max-width: 750px;
    margin-left: auto;
    margin-right: auto;
  }
  /* 375px = 750px 版心一半，18px = $space-page（36rpx）；算出 FAB 距视口右缘的落点 */
  .fab {
    right: calc(50vw - 375px + 18px);
  }
  /* 原生 tabbar：一并收进 750px 版心 */
  uni-tabbar,
  .uni-tabbar-bottom {
    max-width: 750px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
