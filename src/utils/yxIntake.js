/**
 * 从「用其他应用打开」把 Excel 接进来（**仅 App 端有效**，H5/小程序整段被条件编译掉）。
 *
 * 链路：
 *   微信点「用其他应用打开」→ 系统 ACTION_VIEW + content:// Uri → 拉起本 App
 *   → 拿到 Uri → **用户确认后**才读出字节 → 交给「燕秀产品处理」页解析预览。
 *
 * ==========================================================================
 * ★★★ 真机实测的三道坎（2026-10-07，全部踩过）
 *
 * ① intent-filter 必须挂在 **exported=true 的 `io.dcloud.PandoraEntry`** 上。
 *    挂在 `PandoraEntryEntryActivity`（exported=false）上会是"列表里看得见、点了没反应"。
 *
 * ② `plus.io.resolveLocalFileSystemURL` 读不了 `content://`（两条都秒失败，但不卡）。
 *    走 native.js 时**必须先 `plus.android.importClass("android.content.ContentResolver")`**，
 *    否则 `openInputStream` 在 JS 代理上不存在（实机原文：`... is not a function`）。
 *
 * ③ ★★★ **读字节绝对不能放在启动路径或后台里，也不能自动跑**：
 *    native.js 的调用是**同步**的。`FileChannel.transferFrom` / `InputStream.read()` 一旦
 *    在文件流上阻塞，**JS 线程整个停住** —— 此时任何 `setTimeout` 都不会执行，
 *    所以**加超时是没用的**。实测症状就是：App 在后台时跳转过来直接无响应；
 *    没打开过时跳转过去一直停在加载中、别的页面也点不动。
 *    ⇒ 设计上必须做到：
 *      · 启动/后台只做"记下 Uri"（纯字符串，绝不可能卡）；
 *      · **异步、非阻塞的两条路（plus.io）可以自动跑**（实测它们是秒失败，不会卡）；
 *      · **会阻塞的两条路（native.js）只在用户明确点按钮时才跑**，跑之前先把
 *        "当前在第几阶段"写进 storage —— 万一还是卡死，下次打开能看到卡在哪一步。
 * ==========================================================================
 */

/** 待处理文件：{ uri, name, buf, how, error, stages, at }。放模块变量，不进响应式系统。 */
let pending = null

/** 本轮读取各阶段的记录：[{ name, ok, ms, err }] */
let stages = []

/** 页面取走（取一次就清掉）。 */
export function takePending() {
  const p = pending
  pending = null
  return p
}
export function peekPending() { return pending }
export function clearPending() { pending = null }

/** 最近一次接收的留档（只读）。任何平台都能读。 */
export function readLastIntake() {
  try {
    const raw = uni.getStorageSync('jxc_yx_intake_last')
    if (!raw) return null
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return v && v.uri ? v : null
  } catch (e) {
    return null
  }
}

/**
 * 「上次读取卡在哪一阶段」的墓碑。
 * ★ 为什么需要它：同步原生调用把 JS 线程卡死时，什么都没法上报 ——
 *   所以**在动手之前**先把阶段名写进 storage。卡了就是这一条留在那儿。
 */
export function readStageMarker() {
  try {
    const raw = uni.getStorageSync('jxc_yx_intake_stage')
    if (!raw) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (e) {
    return null
  }
}
function setStageMarker(name) {
  try {
    uni.setStorageSync('jxc_yx_intake_stage', JSON.stringify({ stage: name, at: Date.now() }))
  } catch (e) {}
}
function clearStageMarker() {
  try { uni.setStorageSync('jxc_yx_intake_stage', '') } catch (e) {}
}

/**
 * 「启动探测」留档：系统这次到底给了我们什么，**原样记下来**。
 *
 * ★★ 为什么必须有它（2026-10-07 现场）：
 *   真机反馈"用其他应用打开跳过来**无反应、也没有报错**"。
 *   而当时代码里两条路都会**静默什么都不做**：
 *     · 拿到了 Uri 但没登录 → `if (!isLoggedIn) return`，界面一点痕迹都没有；
 *     · `currentIntentUri()` 返回空 → 连 acceptUri 都不会调用。
 *   ⇒ 所以这里把 `arguments` / `Intent.action` / `Intent.data` / `EXTRA_STREAM`
 *     四个原始值全都落盘并回显。**取不到也要记**，否则"取不到"和"没被拉起"分不开。
 */
export function readProbe() {
  try {
    const raw = uni.getStorageSync('jxc_yx_intake_probe')
    if (!raw) return null
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (e) {
    return null
  }
}
function logProbe(probe) {
  try { uni.setStorageSync('jxc_yx_intake_probe', JSON.stringify(probe)) } catch (e) {}
}

/** 留档必须**不带字节**：ArrayBuffer 进 JSON 会变成 `{}`，白白撑大 storage。 */
function logIntake(rec) {
  try {
    uni.setStorageSync('jxc_yx_intake_last', JSON.stringify({
      uri: rec.uri, name: rec.name, how: rec.how || '',
      error: rec.error || '', size: rec.size || 0, at: rec.at || Date.now(),
    }))
  } catch (e) {}
}

// #ifdef APP-PLUS

/* ---------------- Uri / 文件名 ---------------- */

function extractUri(args) {
  const s = String(args || '')
  if (!s) return ''
  const m = s.match(/(content|file):\/\/[^\s"'<>]*/i)
  if (m) return m[0]
  const q = s.match(/(?:url|uri|data)=([^&\s]+)/i)
  if (q) return decodeURIComponent(q[1])
  return ''
}

/**
 * Uri 对应的文件名。
 * ★ 优先 `displayName` 查询参数 —— 微信 FileProvider 的路径尾段是一串编号，
 *   真名藏在查询串里（实测：`.../4717962721070676778_m.xls?displayName=2026019-BOM.xls`）。
 */
function nameFromUri(uri) {
  const s = String(uri || '')
  try {
    const q = s.match(/[?&]displayName=([^&]+)/i)
    if (q) {
      const n = decodeURIComponent(q[1])
      if (n) return n
    }
    const last = decodeURIComponent(s.split('?')[0].split('/').pop() || '')
    if (last) return last
  } catch (e) { /* 落到兜底名 */ }
  return '来自其他应用的文件'
}

/* ---------------- base64 → ArrayBuffer ---------------- */

function b64ToBuffer(b64) {
  const s = String(b64 || '')
  if (!s) return null
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
    return out.buffer
  } catch (e) {
    return null
  }
}
function dataUrlToBuffer(dataUrl) {
  const i = String(dataUrl || '').indexOf('base64,')
  if (i < 0) return null
  return b64ToBuffer(String(dataUrl).slice(i + 7))
}

/** 给异步阶段加超时。★ 只在 JS 线程没被卡住时有效 —— 所以阻塞阶段不靠它保命。 */
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    let done = false
    const t = setTimeout(() => {
      if (!done) { done = true; reject(new Error(label + ' 超时（' + ms + 'ms）')) }
    }, ms)
    p.then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v) } },
      (e) => { if (!done) { done = true; clearTimeout(t); reject(e) } }
    )
  })
}

/* ================= 非阻塞组（可以自动跑） ================= */

/** `plus.io`：异步回调，不会卡主线程。实测对 content:// 是秒失败。 */
function readViaPlusIo(path) {
  return new Promise((resolve, reject) => {
    try {
      plus.io.resolveLocalFileSystemURL(path, (entry) => {
        try {
          entry.file((f) => {
            try {
              const fr = new plus.io.FileReader()
              fr.onloadend = (e) => {
                const buf = dataUrlToBuffer((e.target || {}).result)
                if (buf && buf.byteLength) resolve(buf)
                else reject(new Error('FileReader 出来了但转码为空'))
              }
              fr.onerror = () => reject(new Error('FileReader 读失败'))
              fr.readAsDataURL(f)
            } catch (e) { reject(new Error('FileReader 异常：' + String((e && e.message) || e))) }
          }, (e) => reject(new Error('entry.file 回调报错：' + String((e && e.message) || e))))
        } catch (e) { reject(new Error(String((e && e.message) || e))) }
      }, (e) => reject(new Error('resolveLocalFileSystemURL 失败：' + String((e && e.message) || e || '未知'))))
    } catch (e) {
      reject(new Error('plus.io 异常：' + String((e && e.message) || e)))
    }
  })
}

/* ================= 阻塞组（只在用户点按钮时才跑） ================= */
/**
 * ★★ 下面这些函数里的 native.js 调用都是**同步**的。文件流一旦卡住，
 *    JS 线程整个停住 —— 超时救不了。所以调用方必须先写阶段墓碑。
 */

/** 把要用到的 Java 类导入齐。**少导一个，对应方法在代理上就不存在。** */
function importJavaClasses() {
  plus.android.importClass('android.content.Context')
  plus.android.importClass('android.content.ContentResolver')
  plus.android.importClass('android.net.Uri')
  plus.android.importClass('java.io.InputStream')
  plus.android.importClass('java.io.ByteArrayOutputStream')
  plus.android.importClass('android.util.Base64')
  /**
   * ★★★ `java.nio.channels.FileChannel` 是 2026-10-07 真机报告里补上的：
   *   报错原文 `u.transferFrom is not a function`。
   *   `fis.getChannel()` 拿到的是 FileChannel 实例，而 `transferFrom` / `transferTo`
   *   声明在这个类上 —— 不导入它，JS 代理上就没有这两个方法。
   *   与 ContentResolver 那次（`openInputStream is not a function`）是**同一类坑**：
   *   **native.js 里凡是调用"别的对象返回的对象"上的方法，都要先导入声明那个方法的类。**
   */
  plus.android.importClass('java.nio.channels.FileChannel')
}

function openStream(uri) {
  const Uri = plus.android.importClass('android.net.Uri')
  const u = Uri.parse(uri)
  const resolver = plus.android.runtimeMainActivity().getContentResolver()
  let ins = null
  try {
    ins = resolver.openInputStream(u)
  } catch (e1) {
    ins = plus.android.invoke(resolver, 'openInputStream', u)
  }
  if (!ins) throw new Error('openInputStream 返回空（多为 Uri 读权限没给到）')
  return ins
}

/**
 * 快路：byte[] 一次 8KB，最后用 `android.util.Base64` 一次性编码成字符串。
 *
 * ★ 真机报告（2026-10-07）这条报的是 **"Base64 编码结果为空"、而且只用 20ms** ——
 *   1.8MB 的文件不可能 20ms 读完 ⇒ 要么 byte[] 没造出来、要么流本来就是空的，
 *   两者都会静默走完循环、拿到空数组。⇒ 这一版把**中间量逐个报出来**，
 *   让下一次的真机反馈能直接区分是哪一种。
 */
function readViaResolver(uri) {
  importJavaClasses()
  const ins = openStream(uri)

  // ① byte[] 能不能造出来 —— 本身就是个可疑点
  let chunk = null
  try {
    chunk = plus.android.newObject('byte[]', 8192)
  } catch (e) {
    throw new Error('造不出 byte[] 缓冲：' + String((e && e.message) || e))
  }
  if (!chunk) throw new Error('byte[] 缓冲是 null（newObject 没返回东西）')

  const BAOS = plus.android.importClass('java.io.ByteArrayOutputStream')
  const baos = new BAOS()

  // ② 第一次 read 的返回值 —— 能区分"流是空的/没权限"和"byte[] 不对"
  let n = 0
  try {
    n = Number(ins.read(chunk)) || 0
  } catch (e) {
    throw new Error('第一次 read 就抛错：' + String((e && e.message) || e))
  }
  if (n <= 0) {
    throw new Error('流里读不到字节（首次 read 返回 ' + n + '）—— Uri 的读权限可能没给到')
  }

  let total = n
  let guard = 0
  while (n > 0) {
    baos.write(chunk, 0, n)
    if (++guard > 300000) break          // 防死循环（≈2.3GB 上限）
    n = Number(ins.read(chunk)) || 0
    if (n > 0) total += n
  }
  ins.close()

  // ③ 读到的总量 vs byteArray 长度 —— 能看出"读了但没攒进去"
  const arr = baos.toByteArray()
  let len = 0
  try { len = Number(arr && arr.length) || 0 } catch (e) { len = 0 }
  if (!len) {
    try { len = Number(plus.android.getAttribute(arr, 'length')) || 0 } catch (e) { len = 0 }
  }
  if (!(len > 0)) throw new Error('读了 ' + total + ' 字节，但 byteArray 长度为 0')

  const Base64 = plus.android.importClass('android.util.Base64')
  const b64 = String(Base64.encodeToString(arr, 2) || '')   // 2 = NO_WRAP
  if (!b64) throw new Error('Base64 编码返回空（byteArray 长度 ' + len + '）')

  const buf = b64ToBuffer(b64)
  if (!buf || !buf.byteLength) throw new Error('Base64 解码失败（base64 长度 ' + b64.length + '）')
  return buf
}

/**
 * 稳路：把 `content://` 的流**原样拷进沙箱**，再用 `plus.io` 读那个真文件。
 *
 * ★ 为什么这条路最被看好（2026-10-07 真机报告）：
 *   它上次已经走到 `fis.getChannel()` 才报错（`transferFrom is not a function`），
 *   说明前面的 `openFileDescriptor` 与 `getStatSize()` **都是通的** ——
 *   只差把 `java.nio.channels.FileChannel` 这个类导入。
 *   而且它**完全不依赖 `newObject('byte[]')`**（那正是另一条路的可疑点）。
 *
 * ★ 字节数用 `getStatSize()` 的**确切值**，不传"一个大数" —— 确切值才能保证这次调用有界。
 * ★ 拷完读沙箱文件时**首选 `plus.io`**（对真实文件它走得最熟），失败才退 Java 逐块读。
 */
function readViaCopyToSandbox(uri) {
  let fis = null, fos = null, pfd = null
  try {
    importJavaClasses()
    plus.android.importClass('android.os.ParcelFileDescriptor')
    plus.android.importClass('java.io.FileInputStream')
    plus.android.importClass('java.io.FileOutputStream')

    const Uri = plus.android.importClass('android.net.Uri')
    const u = Uri.parse(uri)
    const resolver = plus.android.runtimeMainActivity().getContentResolver()
    pfd = plus.android.invoke(resolver, 'openFileDescriptor', u, 'r')
    if (!pfd) throw new Error('openFileDescriptor 返回空')

    let size = 0
    try { size = Number(pfd.getStatSize()) || 0 } catch (e) { size = 0 }
    if (!(size > 0)) throw new Error('拿不到文件大小，这条路的边界就不确定，放弃')

    const javaPath = String(plus.io.convertLocalFileSystemURL('_doc/yx_intake_tmp.xls')).replace(/^file:\/\//, '')
    const FileInputStream = plus.android.importClass('java.io.FileInputStream')
    fis = new FileInputStream(pfd.getFileDescriptor())
    const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
    fos = new FileOutputStream(javaPath)

    const src = fis.getChannel()
    const dst = fos.getChannel()
    // ★ transferTo / transferFrom 都行；两条都试，因为 native.js 对"哪个类导入了才认哪个方法"
    //   很挑剔。确切字节数 ⇒ 这次调用是有界的。
    let moved = 0
    try {
      moved = Number(dst.transferFrom(src, 0, size)) || 0
    } catch (e1) {
      moved = Number(src.transferTo(0, size, dst)) || 0
    }
    try { dst.close() } catch (e) {}
    try { src.close() } catch (e) {}
    try { fis.close() } catch (e) {}
    try { fos.close() } catch (e) {}
    try { pfd.close() } catch (e) {}
    if (!(moved > 0)) throw new Error('搬了 0 字节（源流是空的？）')

    /**
     * ★ 拷完之后读沙箱文件，**首选 `plus.io`**（对真实文件它是走得最熟的路），
     *   而不是再用 Java 逐块读 —— 后者依赖 `newObject('byte[]')`，
     *   那个在真机上正是"ContentResolver+Base64 返回空"的可疑点（见 readViaResolver 的注释）。
     */
    return readViaPlusIo('_doc/yx_intake_tmp.xls').catch(() => readSandboxSync(javaPath))
  } catch (e) {
    try { if (fis) fis.close() } catch (x) {}
    try { if (fos) fos.close() } catch (x) {}
    try { if (pfd) pfd.close() } catch (x) {}
    throw new Error(String((e && e.message) || e))
  }
}

/** 沙箱里的真文件：用 Java 直接读，避免再依赖 plus.io 的回调时序 */
function readSandboxSync(javaPath) {
  const FileInputStream = plus.android.importClass('java.io.FileInputStream')
  const BAOS = plus.android.importClass('java.io.ByteArrayOutputStream')
  plus.android.importClass('java.io.InputStream')
  const fis = new FileInputStream(javaPath)
  const baos = new BAOS()
  const chunk = plus.android.newObject('byte[]', 8192)
  let n = fis.read(chunk)
  let guard = 0
  while (n > 0) {
    baos.write(chunk, 0, n)
    if (++guard > 300000) break
    n = fis.read(chunk)
  }
  fis.close()
  const arr = baos.toByteArray()
  const Base64 = plus.android.importClass('android.util.Base64')
  const b64 = Base64.encodeToString(arr, 2)
  const buf = b64ToBuffer(b64)
  if (!buf || !buf.byteLength) throw new Error('沙箱文件读出来是空')
  return buf
}

// #endif
/* ★ 上面这一段 `#ifdef APP-PLUS` 结束时点很关键：凡是用到 `plus.*` / native.js 的辅助函数
 *   都必须在里面；而 `readPending` 必须**在外面**（H5 也要能 import 到它，见下面的注释）。
 *   条件编译是**按块整体剥离**的，嵌套守卫不会"留下里面那一小块"。 */

/* ---------------- 对外的读取入口 ---------------- */

/**
 * 读一阶段。
 *
 * @param {string} uri
 * @param {{ includeBlocking?: boolean, skipStage?: string }} opts
 *   includeBlocking —— 是否连"会阻塞主线程"的两条一起跑
 *   skipStage       —— 跳过某一步（自动跑时把上次卡死的那步跳过；手动重试时传空）
 * @returns {Promise<{ok:boolean, buf:ArrayBuffer|null, how:string, error:string, stages:Array}>}
 *
 * ★★ 这个函数**必须两端都"有"**，但**只能声明一次** —— 两条要求同时满足的写法只有一个：
 *    把唯一的声明放在**最外层 `#ifdef APP-PLUS` 之外**，平台差异塞进**函数体内**。
 *    踩过的三次（每次都是"构建"或"语法门"其中一支红）：
 *      · 整段写在 `#ifdef APP-PLUS` 里 ⇒ H5 剥掉后**命名导出不存在** ⇒
 *        H5 构建报 `"readPending" is not exported by "src/utils/yxIntake.js"`；
 *      · 改成"两处各声明一份（`#ifdef` 一份 + `#ifndef` 一份）" ⇒ 构建过了，但
 *        **`check-syntax` 报 `Identifier 'readPending' has already been declared`**
 *        —— 它不剥条件编译，看见两份就说重名；
 *      · 把 `#ifdef` 放在**函数声明外面**、`#endif` 落在**函数体里面** ⇒
 *        H5 剥掉后剩下一个孤立的 `}`，**语法错误**。
 *    ⇒ 记住这个形状：声明在外、`#ifndef` 提前返回、`#ifdef` 包住实现。
 */
export async function readPending(uri, opts) {
  // #ifndef APP-PLUS
  return { ok: false, buf: null, how: '', error: '只有 App 端支持从其他应用接收文件', stages: [] }
  // #endif
  // #ifdef APP-PLUS
  const includeBlocking = !!(opts && opts.includeBlocking)
  const skipStage = String((opts && opts.skipStage) || '')
  const want = String(uri || (pending && pending.uri) || '')
  if (!want) return { ok: false, buf: null, how: '', error: '没有待处理的文件', stages: [] }

  stages = []

  /**
   * 非阻塞组：异步 + 3 秒超时，绝不会把主线程卡住。
   * ★ 只留"原样"这一条 —— 真机两次实测它都是「路径不存在」，
   *   说明 `plus.io` 根本不支持 `content://`。那条"去查询串"是我当初的猜测，同样证伪，删掉。
   *   （保留它是因为成本只有 12ms，且它是最"标准"的写法，将来换系统版本有可能能用。）
   */
  const asyncTries = [
    ['plus.io', () => withTimeout(readViaPlusIo(want), 3000, 'plus.io')],
  ]
  /**
   * 阻塞组：同步原生调用，**先写墓碑再动手**。
   * ★ 顺序按"已验证可用"排（2026-10-07 真机：点按钮后这条路读成功了）：
   *   「拷贝到沙箱再读」走到 `getChannel()` 说明 openFileDescriptor/getStatSize 都通，
   *   而且它**不依赖 `newObject('byte[]')`**（那正是另一条路的可疑点）。
   */
  const blockingTries = [
    ['拷贝到沙箱再读', () => readViaCopyToSandbox(want)],
    ['ContentResolver+Base64', () => readViaResolver(want)],
  ]

  const tries = (includeBlocking ? asyncTries.concat(blockingTries) : asyncTries)
    .filter((t) => t[0] !== skipStage)
  if (!tries.length) {
    return { ok: false, buf: null, how: '', error: '可用的读取方式都被跳过了', stages: [] }
  }
  const base = pending && pending.uri === want ? pending : { uri: want, name: nameFromUri(want), at: Date.now() }

  for (const [name, fn] of tries) {
    const t0 = Date.now()
    setStageMarker(name)                 // ★ 动手之前先落墓碑：卡死也留证据
    try {
      const buf = await fn()
      if (buf && buf.byteLength) {
        stages.push({ name, ok: true, ms: Date.now() - t0, err: '' })
        clearStageMarker()
        pending = Object.assign({}, base, { buf, how: name, size: buf.byteLength, stages: stages.slice(), error: '' })
        logIntake(pending)
        return { ok: true, buf, how: name, error: '', stages: stages.slice() }
      }
      stages.push({ name, ok: false, ms: Date.now() - t0, err: '返回空' })
    } catch (e) {
      stages.push({ name, ok: false, ms: Date.now() - t0, err: String((e && e.message) || e) })
    }
  }
  clearStageMarker()
  const error = stages.map((s) => s.name + '→' + (s.ok ? '成功' : s.err)).join('；')
  pending = Object.assign({}, base, { buf: null, how: '', stages: stages.slice(), error })
  logIntake(pending)
  return { ok: false, buf: null, how: '', error, stages: stages.slice() }
  // #endif
}

// #ifdef APP-PLUS

/* ---------------- 接管启动/新 Intent ---------------- */

/**
 * 探测这次"被文件拉起来"的**原始信息**：四个来源全取，取不到的**留空串**。
 * ★ "取不到"本身就是结论（说明系统没把 Uri 给我们），所以必须如实记，不能当没发生。
 *   四个来源：`arguments` / `Intent.action` / `Intent.data` / `EXTRA_STREAM`。
 */
function probeLaunch() {
  const p = { args: '', action: '', data: '', stream: '', uri: '', instance: '', at: Date.now() }

  // ① DCloud 会把 intent 的 data 塞进 plus.runtime.arguments
  try {
    const a = plus.runtime && plus.runtime.arguments
    p.args = (a === null || a === undefined) ? '' : String(a)
  } catch (e) {
    p.args = '(取 arguments 抛错：' + String((e && e.message) || e) + ')'
  }

  // ② 直接问当前 Activity 的 Intent
  try {
    plus.android.importClass('android.content.Intent')
    const main = plus.android.runtimeMainActivity()
    try { p.instance = String(main) } catch (e) { p.instance = '' }   // 形如 io.dcloud.Xxx@ab12cd
    const it = main.getIntent()
    if (!it) {
      p.data = '(getIntent 返回 null)'
    } else {
      try { p.action = String(it.getAction() || '') } catch (e) { p.action = '(getAction 抛错)' }
      try { p.data = String(it.getDataString() || '') } catch (e) {
        p.data = '(getDataString 抛错：' + String((e && e.message) || e) + ')'
      }
      // 长按「分享/发送到」走 ACTION_SEND，Uri 在 EXTRA_STREAM 里、data 是空的
      try {
        const ex = it.getParcelableExtra('android.intent.extra.STREAM')
        if (ex) p.stream = String(ex)
      } catch (e) { /* 没有就算了 */ }
    }
  } catch (e) {
    p.data = '(问 Intent 抛错：' + String((e && e.message) || e) + ')'
  }

  p.uri = extractUri(p.data) || extractUri(p.stream) || extractUri(p.args)
  return p
}

/**
 * 这次的 intent 像不像"从别的应用打开文件"。
 *
 * ★★ 只认 action —— 别看 `arguments`：
 *   DCloud 在**正常启动**时也会往 `plus.runtime.arguments` 里塞东西
 *   （实测值是 `{"startfrom":"101"}`）。上一版拿"args 非空"当过判据，
 *   结果**每次点图标开 App 都弹一遍诊断框**（2026-10-07 截图里那个）。
 *   正常启动的 action 是 `android.intent.action.MAIN`，从文件打开是 VIEW / SEND。
 */
function looksLikeFileIntent(p) {
  const a = String(p.action || '')
  return a === 'android.intent.action.VIEW'
    || a === 'android.intent.action.SEND'
    || a === 'android.intent.action.SEND_MULTIPLE'
}

/** 同一份意图会从"事件"和"回前台"两条通道各来一次 ⇒ 用签名 + 时间窗去重 */
let lastSig = ''
let lastSigAt = 0
function signature(p) {
  return [p.action, p.data || p.stream || p.args, p.instance].join('|')
}

/**
 * ★★★ 这里只做"记下 Uri"，**绝不读字节**。
 *   理由见文件头 ③：同步原生读取一旦卡住，会把整个 App 冻住，
 *   而启动路径和后台是最不该出现这种情况的地方（实测就是这两个场景出的事）。
 */
function acceptUri(uri, onFile) {
  if (!uri) return false
  const name = nameFromUri(uri)
  pending = {
    uri, name, buf: null, how: '', error: '',
    stages: [], size: 0, at: Date.now(),
  }
  logIntake(pending)
  if (typeof onFile === 'function') onFile()
  return true
}

/**
 * 探测一次并按结果分派。
 * ★ 导出出来是为了让 App.vue 的 `onShow` 也能调 —— 那是**不依赖任何事件**的兜底：
 *   实测社区里"应用已在后台运行时收不到参数"的常见原因就是事件名/事件通道不对，
 *   而"回到前台"这件事本身是一定会发生的。
 * @param {{ onFile?: () => void, onProbe?: (p:object) => void }} handlers
 */
export function probeIntake(handlers) {
  const onFile = handlers && handlers.onFile
  const onProbe = handlers && handlers.onProbe

  let p = null
  try {
    p = probeLaunch()
  } catch (e) {
    p = { args: '', action: '', data: '(探测整体抛错：' + String((e && e.message) || e) + ')', stream: '', uri: '', instance: '', at: Date.now() }
  }
  logProbe(p)

  const sig = signature(p)
  const now = Date.now()
  // ★ 去重窗口 5 秒：同一份意图经两条通道先后到达时只处理一次；
  //   而几分钟后用户再打开同一个文件（签名相同）仍会被正常处理。
  if (sig === lastSig && now - lastSigAt < 5000) return
  lastSig = sig
  lastSigAt = now

  if (p.uri) { acceptUri(p.uri, onFile); return }
  if (looksLikeFileIntent(p) && typeof onProbe === 'function') onProbe(p)
}

/**
 * 冷启动时应用被文件拉起。
 * @param {{ onFile?: () => void, onProbe?: (p:object) => void }} handlers
 */
export function initIntake(handlers) {
  // ★ 推迟一点再问：onLaunch 阶段 plus 运行时可能还没完全就绪，
  //   而 getIntent() 会一直留在 Activity 上，晚问不丢信息。
  setTimeout(() => probeIntake(handlers), 600)

  /**
   * 应用已经在后台/前台时被再次拉起 —— 靠 `newintent` 事件。
   *
   * ★★★ 事件名**必须全小写 `newintent`**（2026-10-07 真机实测才定位到）：
   *   HTML5+ 官方 Events 常量表里写的是 `"newintent"`，
   *   本包 `classes.dex` 里 `newintent` 也是紧挨着 `Intent`/`BaseActivity.updateParam`
   *   的那个事件名。上一版写的是 `'newIntent'` ⇒ **监听了一个永远不会派发的事件名**，
   *   于是"App 已在后台时从微信跳进来"完全无反应、也无报错。
   *   两个名字都注册一遍，纯属不花钱的保险。
   */
  try {
    if (plus.globalEvent && plus.globalEvent.addEventListener) {
      plus.globalEvent.addEventListener('newintent', () => probeIntake(handlers))
      plus.globalEvent.addEventListener('newIntent', () => probeIntake(handlers))
    }
  } catch (e) { /* 老版本没有这个通道：还有 App.onShow 那条兜底 */ }
}

// #endif
