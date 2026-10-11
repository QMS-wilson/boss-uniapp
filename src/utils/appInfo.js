/**
 * 应用自身的信息 —— 版本必须来自**这一端自己**，不能借用本地服务(Agent)的版本号。
 *
 * ★ 为什么单独一个文件：以前「我的」页印的是 capabilities 里的 version，
 *   而那个字段是**客户机上那个 Agent** 的版本（`adapt.js: toCapabilities`），
 *   和手机上这个 App 是两码事；字段缺失时还兜一个写死的 '1.0.0'，
 *   于是无论装的是哪一版 APK，界面上永远显示 1.0.0 —— 排障时最容易被误信的一个数。
 * ★ 拿不到就返回空串，由页面显示「未获取」。**不许编一个版本号。**
 *
 * ★★ App 端一个真坑：`plus.runtime.versionCode` 是**装进 APK 里的那个基线版本**，
 *   装了 wgt 热更包之后它**不会变**（DCloud 的设计）。要拿"当前实际在跑的版本"
 *   只能异步问 `plus.runtime.getProperty(appid, cb)`。所以：
 *     · 同步的 appInfo() 在 App 端先给基线值（可能偏低），
 *     · App.vue 启动时调 refreshAppInfo() 把真值填进 runtime，
 *     · 页面一律用 computed 读，别在 setup 里取一次常量就完事。
 */
import { ref } from 'vue'

/** App 端 getProperty 回来的真值（其他端不填，永远是空） */
const runtime = ref({ version: '', code: 0 })

/** 构建时间戳 → 'YYYY-MM-DD HH:mm'（网页版没有安装包概念，用发布时刻当版本） */
function stamp(ms) {
  const d = new Date(Number(ms))
  if (!Number.isFinite(d.getTime())) return ''
  const p = (n) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * @returns {{kind: string, version: string, code: number}}
 *   kind    'app' | 'mp' | 'h5'
 *   version 给人看的版本号；'' = 这一端拿不到（页面显示「未获取」）
 *   code    数字版本位（App 才有，用来和发布清单比大小；其他端 0）
 */
export function appInfo() {
  let kind = 'h5'
  let version = ''
  let code = 0

  // #ifdef APP-PLUS
  kind = 'app'
  version = runtime.value.version || String(plus.runtime.version || '')
  code = Number(runtime.value.code || plus.runtime.versionCode || 0)
  // #endif

  // #ifdef MP-WEIXIN
  kind = 'mp'
  try {
    const mp = (wx.getAccountInfoSync() || {}).miniProgram || {}
    // 只有**发布版**才有 version；开发版/体验版为空，这时说清是哪一种，别空着让人以为坏了
    version = mp.version || (mp.envVersion ? `内部版（${mp.envVersion}）` : '')
  } catch (e) { /* 开发者工具里偶尔取不到：留空 */ }
  // #endif

  // #ifdef H5
  kind = 'h5'
  const t = typeof __BUILD_TIME__ !== 'undefined' ? Number(__BUILD_TIME__) : 0
  version = t ? `网页版 · 构建于 ${stamp(t)}` : '网页版'
  // #endif

  return { kind, version, code }
}

/**
 * App 端：问运行时"现在实际在跑的是哪一版"（装过 wgt 之后只有这个数是准的）。
 * 其他端这个调用没有意义，直接返回同步值。
 */
export function refreshAppInfo() {
  // #ifndef APP-PLUS
  return Promise.resolve(appInfo())
  // #endif
  // #ifdef APP-PLUS
  return new Promise((resolve) => {
    const fallback = () => resolve(appInfo())
    try {
      plus.runtime.getProperty(plus.runtime.appid, (info) => {
        if (info && (info.version || info.versionCode)) {
          runtime.value = {
            version: String(info.version || ''),
            code: Number(info.versionCode || 0),
          }
        }
        resolve(appInfo())
      })
    } catch (e) { fallback() }
  })
  // #endif
}

/** 一行话版本（给设置行那种窄位置用） */
export function appVersionText() {
  return appInfo().version || '未获取'
}
