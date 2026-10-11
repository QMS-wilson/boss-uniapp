/**
 * App 端「发现新版本」—— 走 **wgt 热更**。
 *
 * ★ 为什么只有 App 端要写这一套：H5 靠 `version.json` + 刷新（App.vue: checkH5Update），
 *   小程序有官方 `getUpdateManager`，而装到手机上的 APK **不会自己变**。
 *   旧包调新接口正是"莫名报错"最常见的来源（现场表现：别人能用，他的报错）。
 *   改 UI/改逻辑用 wgt 就能更（不用重打包）；只有动原生权限、原生插件、
 *   manifest 里的包名/证书时才必须重新出 APK（见 docs 与项目记忆）。
 *
 * ★ 清单从哪来：`GET /api/v1/app-release` —— 走的是**这个端已经在用的云端地址**
 *   （`utils/config.js: apiBase()`，里面含商户码前缀），所以这里不新增任何硬编码域名。
 *   文件本身由 `scripts/publish-wgt.py` 上传，云端只转发不解释。
 *
 * ★★ 三条铁律（都是"往客户手机里塞代码"这件事的风险面）：
 *   ① 只装 **https** 地址：http 上被人替换一个 wgt = 在客户机上执行任意代码。
 *      发布脚本那边也会拒绝写过 http 的清单，这里再挡一道。
 *   ② 拿不到自己当前版本（`plus.runtime.getProperty` 没回来）就**不比较**，
 *      不拿 0 当版本号 —— 那会让每一次发布都"有新版本"。
 *   ③ 下载失败/安装失败必须**说出来**：静默失败的表现就是"点了没反应"。
 */
import { http } from './request'
import { refreshAppInfo } from './appInfo'

const CHECK_TTL = 6 * 60 * 60 * 1000     // 自动检查最多 6 小时一次（回前台会反复触发）
let lastCheck = 0
const snoozed = {}                       // 用户点过「稍后」的版本位：本次运行不再弹（不写进配置）

/** 比对清单与本机版本，需要时弹更新框。任何一步不满足都安静退出（不打扰正在开单的人）。 */
export async function checkAppUpdate() {
  // #ifdef APP-PLUS
  const now = Date.now()
  if (now - lastCheck < CHECK_TTL) return
  lastCheck = now

  const mine = await refreshAppInfo()
  if (!mine || !mine.code) return

  const res = await http.get('/app-release', null, { timeout: 8000 })
  // 404 = 这台服务器还没发布过 wgt；网络抖动 = 下一次回前台再查。两种都不该弹框吓人。
  if (!res || !res.ok || !res.data) return

  const d = res.data
  const target = Number(d.wgtCode || d.versionCode || 0)
  const url = String(d.url || '')
  if (!target || target <= mine.code) return
  if (snoozed[target]) return
  if (!/^https:\/\//i.test(url)) return

  const name = String(d.versionName || d.wgtVersion || target)
  const force = !!d.force
  uni.showModal({
    title: '发现新版本 ' + name,
    content: (d.notes ? d.notes + '\n' : '')
      + (force ? '这个版本必须更新后才能继续使用。' : '更新完会自动重启，通常几十秒。'),
    confirmText: '立即更新',
    cancelText: '稍后',
    // ★ 强制更新时**不给取消按钮**：早先的写法是"取消就退出应用"，
    //   那等于让一个弹窗把人手上没存的单据丢掉。
    showCancel: !force,
    success: (r) => {
      if (r.confirm) installWgt(url)
      else snoozed[target] = now
    },
  })
  // #endif
}

/** 下载并安装 wgt，装完自己重启。失败一定说话。 */
function installWgt(url) {
  // #ifdef APP-PLUS
  uni.showLoading({ title: '下载更新…', mask: true })
  const task = plus.downloader.createDownload(
    url,
    { method: 'GET', filename: '_downloads/app-update.wgt' },
    (d, status) => {
      uni.hideLoading()
      if (!d || status !== 200) {
        uni.showToast({
          title: '下载失败（' + (status || '网络中断') + '），请稍后再试',
          icon: 'none', duration: 3000,
        })
        return
      }
      // ★ `force: true` 是给 DCloud 的安装器看的：它自己也会比一次版本号，
      //   而我们比的是 getProperty 的真值 —— 不带 force 时它会以"版本没变"为由
      //   **静默拒绝**（不回调失败），表现就是"下载完了但什么都没发生"。
      plus.runtime.install(d.filename, { force: true }, () => {
        uni.showToast({ title: '更新完成，正在重启', icon: 'none' })
        setTimeout(() => plus.runtime.restart(), 900)
      }, (e) => {
        uni.showToast({
          title: '安装失败：' + ((e && e.message) || '未知原因'),
          icon: 'none', duration: 3500,
        })
      })
    })
  task.addEventListener('statechanged', (t) => {
    // state 3 = 正在下载。有 totalSize 才报百分比，否则只显示"下载更新…"。
    if (t && t.state === 3 && t.totalSize > 0) {
      const p = Math.min(99, Math.round((t.downloadedSize / t.totalSize) * 100))
      uni.showLoading({ title: '下载更新 ' + p + '%', mask: true })
    }
  })
  task.start()
  // #endif
}
