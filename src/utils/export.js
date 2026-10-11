/**
 * 报表导出：两条格式，各自落到三端。
 *
 * ★ 为什么两种都留着（2026-10-08 加 xlsx，但没有把 CSV 删掉）：
 *   · 「对账明细 CSV」= 一行一张单的借贷流水，零依赖、微信/Excel/备忘录都能开，
 *     小程序没有文件系统时还能整段进剪贴板 —— 这条路是**兜底**，删了就没有后备。
 *   · 「月份对账单 xlsx」= 客户要的那张厂商版式（一行一个货品、带格线与合并）。
 *     CSV 装不下版式：合并、边框、字号、列宽在 CSV 里一个都不存在。
 *   ⇒ 版式由 `utils/xlsxWrite.js` 手写 OOXML 生成（**不引 SheetJS 写**，社区版写不出样式），
 *     这一支只负责"字节落到哪儿"。
 * ★ 平台差异（三端各一条，别混）：
 *   · H5 —— Blob + a[download]；
 *   · 小程序 —— 写进本机沙箱再 openDocument（`shareFileMessage` **必须由用户手势直接触发**，
 *     我们是"点格式 → 拉数据 → 写文件"的异步链，到那一步手势早没了，调它只会报错）；
 *   · App —— plus.android 走 Java 解码写文件，再交给系统"打开方式"。
 * ★ 三条路都**不许说"已导出/已发送"**：落盘和"客户收到"是两件事，假成功比报错更坏
 *   （H5 那条的原始教训见下面 exportCsv 的注释）。
 * ★ CSV 必须带 UTF-8 BOM：Excel 按 GBK 猜编码，中文列名会全乱（客户第一次打开就废）。
 */

function toCsv(header, rows) {
  const cell = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"'
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

/**
 * @param {string} filename 文件名（不含扩展名会自动补 .csv）
 * @param {string[]} header 表头
 * @param {Array<Array<*>>} rows 数据行
 * @param {string} [tip] toast 里附加的说明
 */
export function exportCsv(filename, header, rows, tip = '') {
  const name = filename.endsWith('.csv') ? filename : filename + '.csv'
  const text = '﻿' + toCsv(header, rows || [])
  if (!rows || !rows.length) {
    uni.showToast({ title: '没有可导出的数据', icon: 'none' })
    return false
  }
  // #ifdef H5
  try {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    // ★ 别说"已导出"：微信内置浏览器与部分 Android WebView 会**静默忽略** a[download]，
    //   文件根本没落盘，而 toast 已经说了成功 —— 比报错更坏的是假成功。
    uni.showToast({ title: `正在下载 ${rows.length} 行；若没弹出文件，是这个浏览器拦了下载`, icon: 'none', duration: 3000 })
    return true
  } catch (e) {
    uni.showToast({ title: '导出失败：' + (e && e.message ? e.message : '浏览器不支持'), icon: 'none' })
    return false
  }
  // #endif
  // #ifndef H5
  uni.setClipboardData({
    data: text,
    success: () => uni.showModal({
      title: '已复制 ' + rows.length + ' 行',
      content: (tip || '内容已在剪贴板') + '，可直接粘贴到微信、备忘录或表格软件（CSV 逗号分隔）。',
      showCancel: false,
      confirmText: '知道了',
    }),
    // ★ 这些页面上没有"分享"按钮，指过去等于把人支到死路；剪贴板失败的真实原因
    //   几乎都是内容过长 ⇒ 说清下一步该干什么（缩小期间）。
    fail: () => uni.showToast({ title: '复制失败：内容可能太长，缩小日期范围后再试', icon: 'none', duration: 3000 }),
  })
  return true
  // #endif
}

/* ------------------------------------------------------------------ xlsx 落盘 */

const B64CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Uint8Array → base64。
 * ★ 不用 btoa/atob：小程序的 JS 引擎不保证有这两个全局（App 端也不），
 *   而这一支要在三端跑同一个函数。手写 20 行换"三端都能算"。
 */
export function bytesToBase64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    out += B64CH[a >> 2]
    out += B64CH[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)]
    out += b === undefined ? '=' : B64CH[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)]
    out += c === undefined ? '=' : B64CH[c & 63]
  }
  return out
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/** 客户名里真会出现 / 和 :（「中山路/李」这种写法、以及日期后缀），这些字符在 Windows/Android/微信沙箱里都会让写文件失败 */
function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
}

/**
 * 把 xlsx 字节落成文件并交给用户。
 * @param {string} filename 含或不含 .xlsx 都行
 * @param {Uint8Array} bytes buildXlsx() 的产物
 * @param {string} [desc] toast 里补一句活值说明（比如「含 7 行货品」）
 * @returns {boolean} 是否**发起了**落盘（不代表客户已收到 —— 三端都只说"到这一步成了"）
 */
export function saveWorkbook(filename, bytes, desc = '') {
  const name = safeName(filename.endsWith('.xlsx') ? filename : filename + '.xlsx')
  if (!bytes || !bytes.length) {
    uni.showToast({ title: '没有可导出的数据', icon: 'none' })
    return false
  }
  const kb = Math.round(bytes.length / 1024)
  const tail = desc ? '　' + desc : ''

  // #ifdef H5
  try {
    const blob = new Blob([toArrayBuffer(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    uni.showToast({
      title: `正在下载 ${name}（${kb} KB）；若没弹出文件，是这个浏览器拦了下载`,
      icon: 'none', duration: 3500,
    })
    return true
  } catch (e) {
    uni.showToast({ title: '导出失败：' + (e && e.message ? e.message : '浏览器不支持'), icon: 'none' })
    return false
  }
  // #endif

  // #ifdef MP-WEIXIN
  try {
    const dir = (typeof wx !== 'undefined' && wx.env && wx.env.USER_DATA_PATH) || ''
    if (!dir) throw new Error('拿不到本机可写目录（USER_DATA_PATH）')
    const fp = dir + '/' + name
    uni.getFileSystemManager().writeFile({
      filePath: fp,
      data: toArrayBuffer(bytes),
      success: () => {
        // ★ openDocument 而不是 shareFileMessage：后者必须由用户手势**直接**触发，
        //   而这里是"点格式 → 拉明细 → 写字节"的异步链，走到这一步手势早就没了。
        //   showMenu:true 让预览页右上角菜单里有「发送给朋友/收藏」，那才是发给客户的那一步。
        uni.openDocument({
          filePath: fp, fileType: 'xlsx', showMenu: true,
          success: () => uni.showToast({
            title: `已生成 ${name}（${kb} KB），点右上角「⋯」可转发给客户${tail}`, icon: 'none', duration: 3500,
          }),
          // 文件已经在手机里，只是这个机型没让直接预览 ⇒ 说清东西在不在，别报"导出失败"
          fail: () => uni.showModal({
            title: '文件已生成，但这台机器没能直接打开它',
            content: `${name}（${kb} KB）已写入小程序本地文件${tail}。可在「我的-文件管理」或用微信「文件传输助手」转发后打开。`,
            showCancel: false, confirmText: '知道了',
          }),
        })
      },
      fail: (e) => uni.showToast({
        title: '存成文件失败：' + ((e && e.errMsg) || '本机不允许写入'), icon: 'none', duration: 3000,
      }),
    })
    return true
  } catch (e) {
    uni.showToast({ title: '导出失败：' + (e && e.message ? e.message : e), icon: 'none' })
    return false
  }
  // #endif

  // #ifdef APP-PLUS
  try {
    // ★ 写文件走 Java，不走 plus.io 的 FileWriter：后者在真机上对二进制路径的时序
    //   不可靠（同 utils/yxIntake.js 里那条"plus.io 读 content:// 必然失败"的实测同源）。
    //   Base64.decode 产出的 byte[] 由 Java 自己创建，绕开 newObject('byte[]') 那个可疑点。
    const rel = '_doc/' + name
    const javaPath = String(plus.io.convertLocalFileSystemURL(rel)).replace(/^file:\/\/?/, '')
    const Base64 = plus.android.importClass('android.util.Base64')
    const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
    const arr = Base64.decode(bytesToBase64(bytes), 0)
    const fos = new FileOutputStream(javaPath)
    fos.write(arr)
    fos.close()
    // 交给系统「打开方式」：在里面选微信/WPS/邮件 —— 这一跳之后才算发出去
    plus.runtime.openFile(rel, {}, (e) => uni.showModal({
      title: '文件已生成，但没能唤起打开方式',
      content: `${name}（${kb} KB）在这台手机的 ${javaPath}${tail}。可以从文件管理里找到它再转发。`,
      showCancel: false, confirmText: '知道了',
    }))
    return true
  } catch (e) {
    uni.showToast({
      title: '这台设备没能写出文件：' + (e && e.message ? e.message : e), icon: 'none', duration: 3000,
    })
    return false
  }
  // #endif
}
