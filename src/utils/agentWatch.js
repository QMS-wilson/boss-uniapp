/**
 * 本地服务掉线的前台轮询 + 系统通知落地（**只在装到手机上的应用里跑**）。
 *
 * ★ 为什么 H5 和小程序不跑：它们没有"应用自己发一条系统通知"这条路 ——
 *   H5 的浏览器通知要用户逐个站点授权、标签页被关掉就没了；小程序只能提前订一次
 *   发一条。造一个在那两端空转的轮询只会费电。判据与文案在 utils/agentNotice.js，
 *   那一层三端都能测。
 *
 * ★ 这一条的天花板：只能覆盖「应用还开着（或在后台没被系统清掉）」这段时间。
 *   进程被系统杀了就没人在轮询，那需要接手机厂商的推送通道（在线推送 SDK），
 *   不是这里能补的 —— 设置页那句话就是照这个写的，别写成"永远不漏"。
 */
import { authApi } from '../api/auth'
import { useAuthStore } from '../store/auth'
import { merchantCode } from './merchant'
import {
  agentNoticeOn, decideAgentNotice, readAgentState, writeAgentState,
} from './agentNotice'

/** 90 秒：掉线这件事的时效是"分钟级"，再密就只是在替客户机数心跳 */
const POLL_MS = 90 * 1000
/** ★ 落一条失败原因：App 端没有 devtools，"没收到通知"在现场是唯一能查的证据 */
const ERR_KEY = 'jxc_last_notice_error'
/** 一台机器只为通知权限主动问一次，之后只在用户自己点开开关时才再问 */
const GUIDE_KEY = 'jxc_notice_guided'
const POST_NOTIF = 'android.permission.POST_NOTIFICATIONS'

let timer = 0
let busy = false

/** 把失败原因落到 storage：App 端没有 devtools，"没收到通知"在现场得有地方查 */
function record(text) {
  try { uni.setStorageSync(ERR_KEY, String(text).slice(0, 300)) } catch (e) { /* 留不下就算了，别把轮询带崩 */ }
}

/** 最近一次发不出去的原因（设置页那一格会把它说出来；空串 = 没失败过） */
export function lastNoticeError() {
  return String(uni.getStorageSync(ERR_KEY) || '')
}

/**
 * 系统通知权限的状态。
 * ★ Android 13 起这是运行时权限，没给的话 `uni.createPushMessage` **直接 reject**
 *   （不是"静默不发"）—— 所以要么先要到权限，要么就别发，别把 reject 吃掉当没事。
 */
export function noticeAuthState() {
  // #ifdef APP-PLUS
  try {
    const s = uni.getAppAuthorizeSetting() || {}
    return String(s.notificationAuthorized || 'unknown')
  } catch (e) {
    record('读通知权限失败：' + String((e && e.message) || e))
    return 'unknown'
  }
  // #endif
  // #ifndef APP-PLUS
  return 'other-end'
  // #endif
}

function androidAsk(then) {
  try {
    plus.android.requestPermissions([POST_NOTIF],
      () => then(noticeAuthState() === 'authorized'),
      () => then(false))
  } catch (e) {
    record('申请通知权限失败：' + String((e && e.message) || e))
    then(false)
  }
}

/**
 * 开始轮询前的一次性权限申请：只在从没问过时弹系统框。
 * 问不到不去追第二次 —— 被拒之后还能靠设置页那个开关重新问。
 */
function ensureNoticeAuth() {
  // #ifdef APP-PLUS
  if (noticeAuthState() === 'authorized') return
  if (String(uni.getStorageSync(GUIDE_KEY) || '') === 'asked') return
  uni.setStorageSync(GUIDE_KEY, 'asked')
  androidAsk(() => {})
  // #endif
}

/**
 * 用户亲手把提醒开关打开时走这里：当场要权限，系统框要不到就领他去应用的设置页。
 * @returns {Promise<boolean>} 按**读回来的权限**说话，不猜
 */
export function askNoticeAuthNow() {
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    if (noticeAuthState() === 'authorized') return resolve(true)
    androidAsk((ok) => {
      if (ok) return resolve(true)
      uni.showModal({
        title: '通知权限没打开',
        content: '提醒已经记下了，但系统不让这个应用发通知。到「应用设置 → 通知」里允许后就能收到。',
        confirmText: '去设置',
        success: (r) => {
          if (r && r.confirm) uni.openAppAuthorizeSetting({ complete: () => {} })
          resolve(false)
        },
        fail: () => resolve(false),
      })
    })
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve(false)
  // #endif
}

function postNotice(n) {
  // #ifdef APP-PLUS
  try {
    uni.createPushMessage({
      title: n.title,
      content: n.content,
      payload: n.payload,
      sound: 'system',
      cover: false,      // 不盖掉上一条：两次掉线之间可能夹着别的提醒
      success: () => record(''),   // 发出去了就把旧失败抹掉，别让一次老故障一直挂着当现状
      fail: (e) => record('发通知失败：' + String((e && (e.errMsg || e.message)) || e)),
    })
  } catch (e) {
    record('发通知异常：' + String((e && (e.message || e)) || e))
  }
  // #endif
}

/**
 * 当场发一条测试通知（设置页把开关翻开时走这里）。
 * ★ 为什么要有这一条：真等一次本地服务掉线才能验"通知到底发得出去吗"，
 *   装机现场没人等得起；而这条 API 在打包后的机器上到底通不通，只有真机知道。
 *   所以翻开开关那一刻就发一条，成不成当场说清 —— 文案刻意不像真掉线，免得被当成事故。
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export function sendTestNotice() {
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    const done = (ok, reason) => resolve(ok ? { ok: true } : { ok: false, reason: reason || '没说明原因' })
    try {
      uni.createPushMessage({
        title: '通知已经打开',
        content: '收到这条就说明提醒发得出来，本地服务掉线时会是同一条路径的通知栏消息。',
        payload: JSON.stringify({ kind: 'agent-notice-test', at: Date.now() }),
        sound: 'system',
        cover: false,
        success: () => { record(''); done(true) },
        fail: (e) => {
          const why = String((e && (e.errMsg || e.message)) || e)
          record('试发通知失败：' + why)
          done(false, why)
        },
      })
    } catch (e) {
      const why = String((e && (e.message || e)) || e)
      record('试发通知异常：' + why)
      done(false, why)
    }
  })
  // #endif
  // #ifndef APP-PLUS
  return Promise.resolve({ ok: false, reason: '这一端没有系统通知' })
  // #endif
}

async function poll() {
  // #ifdef APP-PLUS
  if (busy) return
  busy = true
  try {
    const auth = useAuthStore()
    // 没登录、没配那家商户的入口 = 本来就没有数据，不该有任何"掉线"可判
    if (!auth.isLoggedIn || !merchantCode()) return
    if (!agentNoticeOn()) return
    const res = await authApi.me()
    // 连不上云端 / 吃的是离线缓存 ⇒ 这条不可信，判据层会原样留着上次状态
    if (!res || !res.ok || res.offline) return
    const list = ((res.data || {}).stores) || []
    if (!list.length) return
    const cur = list.filter((x) => x && x.name === auth.currentStoreName)[0] || list[0]
    const prev = readAgentState(cur.name)
    // ★ 云端给的两个时刻是 unix **秒**，判据那边一律用毫秒 —— 换算只许出现在这一处。
    //   0 = 云端没带（旧云端、或那一路没有成对事件），判据会自动退回"我采到过在线才算"。
    // ★ "现在"也取云端那一头的（server_now）：新鲜度是「云端说的离线时刻」减「现在」，
    //   两头不同表的话，客户机没对时就会把通知整段吃掉且不报错。
    const now = Number((res.data || {}).server_now) * 1000 || Date.now()
    const r = decideAgentNotice(prev, {
      online: cur.online, store: cur.name, title: cur.title || cur.name, at: now,
      lastOnlineAt: Number(cur.last_online_at) * 1000 || 0,
      lastOfflineAt: Number(cur.last_offline_at) * 1000 || 0,
    }, now)
    if (r.state !== prev) writeAgentState(cur.name, r.state)
    if (r.action === 'down') postNotice(r.notice)
  } catch (e) {
    record('掉线轮询异常：' + String((e && (e.message || e.errMsg)) || e))
  } finally {
    busy = false
  }
  // #endif
}

export function startAgentWatch() {
  // #ifdef APP-PLUS
  if (timer) return
  ensureNoticeAuth()
  poll()                          // 回前台先判一次，别等满一个周期
  timer = setInterval(poll, POLL_MS)
  // #endif
}

export function stopAgentWatch() {
  if (timer) { clearInterval(timer); timer = 0 }
}
