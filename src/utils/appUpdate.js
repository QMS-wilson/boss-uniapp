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
/**
 * ★★ 本机"已经装过哪个 wgt 码"（设备级，不分商户 —— 装的是应用资源，不是账套数据）。
 *   存在的理由：wgt 装完必须重启才生效，而 `plus.runtime.restart()` 在个别机型/系统上
 *   会**没成功也不报错**。那样下次启动 getProperty 仍回旧码 ⇒ 又判"有新版本" ⇒ 再下一载
 *   ⇒ 再挂一次「更新完成，正在重启」。用户看到的就是这句话一直挂着（2026-10-12 报的）。
 *   ⇒ 同一个目标码只自动走一次安装流程，第二次起改成一句能照着做的说明。
 */
const INSTALLED_KEY = 'jxc_wgt_installed'
function installedCode () {
  try { return Number(uni.getStorageSync(INSTALLED_KEY) || 0) } catch (e) { return 0 }
}
function markInstalled (code) {
  try { uni.setStorageSync(INSTALLED_KEY, String(code || 0)) } catch (e) { /* 记不上最多是重复提示一次 */ }
}

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
  // ★ 这个码我们**已经装过一次**却还没生效 ⇒ 不再重复下载，直接说清下一步该做什么。
  //   （重复下载的表现就是"更新完成，正在重启"挂在屏幕上，人不知道发生了什么。）
  if (installedCode() >= target) {
    uni.showModal({
      title: '更新装好了，但还没生效',
      content: '这个更新包之前已经安装过，运行时仍是旧版本。'
        + '请从最近任务里把应用上滑关掉再重新打开；若仍然不生效，需要重新安装完整版应用。',
      showCancel: false, confirmText: '知道了',
    })
    return
  }

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
      if (r.confirm) installWgt(url, target)
      else snoozed[target] = now
    },
  })
  // #endif
}

/**
 * 下载并安装 wgt，装完自己重启。失败一定说话。
 * @param {number} target 清单里那个 versionCode，装成功就记进本机（防重复下载，见 INSTALLED_KEY）
 */
function installWgt(url, target) {
  // #ifdef APP-PLUS
  uni.showLoading({ title: '下载更新…', mask: true })
  // ★★ 下载回调之后一律不再动提示：`statechanged` 会在回调前后陆续到达，
  //   原实现在这里还可能再 `showLoading({ mask: true })` 一次 ——
  //   那一层带遮罩的 loading 再没人 hide，表现就是"界面卡住、提示一直挂着、点什么都没反应"。
  let settled = false
  const tellManual = (why) => {
    uni.hideLoading()
    uni.hideToast()
    uni.showModal({
      title: '更新已装好',
      content: '需要重启才生效，但这次自动重启没成功' + (why ? '（' + why + '）' : '')
        + '。请从最近任务里把应用上滑关掉，再重新打开即可。',
      showCancel: false, confirmText: '知道了',
    })
  }
  /**
   * 真去重启。抛错、或 3 秒后还停在这一页（运行时没接受），都退成一句可照做的说明。
   *
   * ★★ 重启前先把提示清干净并**等一下下**（2026-10-12）：手机上那次"更新完成，正在重启
   *   一直挂在页面上"，服务器侧能看到应用其实重启成功、首页请求照发 ——
   *   留在屏幕上的那一帧是 Android 在进程切换时缓存的**最后一帧快照**，
   *   而那一帧恰好是我们自己把 toast 留在上面的时刻。
   *   ⇒ 重启前 hideToast/hideLoading，并留 260ms 让界面回到"没有浮层"的状态，
   *     系统缓存到的就是干净页面，不会再出现"提示挂着"的观感。
   */
  const restartOrTell = () => {
    uni.hideToast()
    uni.hideLoading()
    setTimeout(() => {
      try {
        plus.runtime.restart()
        setTimeout(() => tellManual('设备没有接受自动重启'), 3000)
      } catch (e) {
        tellManual(String((e && (e.message || e)) || '').slice(0, 60))
      }
    }, 260)
  }
  const task = plus.downloader.createDownload(
    url,
    { method: 'GET', filename: '_downloads/app-update.wgt' },
    (d, status) => {
      settled = true
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
        if (target) markInstalled(target)
        uni.hideToast()
        /* ★★ 不再"装完自动重启"（2026-10-12 现场改的）。
         *   原来这段是 showToast('更新完成，正在重启') → 900ms 后 restart()。
         *   在一台 HONOR / Android 15 上实测：包下载成功、安装回调也回来了，
         *   但 restart() 没把应用拉起来 —— 屏幕停在最后一帧（那句 toast 的画面），
         *   用户看到的就是"更新完成，正在重启一直挂在页面上"，而且没有任何出口。
         *   ⇒ 改成**问一句再重启**：重启由人点；选「稍后」也说得清"下次打开就是新版"。
         *   自动重启永远不该是唯一路径，因为它失败时人是被卡在屏幕前的。 */
        uni.showModal({
          title: '更新已装好',
          content: '重启后生效。现在重启，还是稍后自己关掉再打开？',
          confirmText: '现在重启',
          cancelText: '稍后',
          success: (r) => {
            if (!r.confirm) {
              uni.showToast({ title: '下次打开应用就是新版本', icon: 'none', duration: 2500 })
              return
            }
            restartOrTell()
          },
        })
      }, (e) => {
        uni.showToast({
          title: '安装失败：' + ((e && e.message) || '未知原因'),
          icon: 'none', duration: 3500,
        })
      })
    })
  task.addEventListener('statechanged', (t) => {
    if (settled) return
    // state 3 = 正在下载。有 totalSize 才报百分比，否则只显示"下载更新…"。
    if (t && t.state === 3 && t.totalSize > 0) {
      const p = Math.min(99, Math.round((t.downloadedSize / t.totalSize) * 100))
      uni.showLoading({ title: '下载更新 ' + p + '%', mask: true })
    }
  })
  task.start()
  // #endif
}
