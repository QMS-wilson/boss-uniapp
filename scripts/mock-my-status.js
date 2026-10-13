/* 「我的」页两格连接状态的效果图 —— 用**真页面**渲染，不手绘。
 *
 * 做法：本地起一个同源小服务器，静态产物 + 把 API 转发到真云端，
 * 只把 capabilities 这一个响应换成从**现网真实 payload** 改出来的几种情形
 * （agent.online / capabilities.dbStatus / 字段缺失 / 整个 capabilities 缺失 / 断网）。
 *
 * ★ 为什么不用 agent-browser 的 network route：那条 URL 是跨域的，
 *   预检 OPTIONS 与实际 GET 同址，route 会把 OPTIONS 也用我的 JSON 回掉
 *   （没有 CORS 头）⇒ 真请求根本没发出去，页面上两格全是「—」，
 *   看着像"页面坏了"，其实是门自己把请求掐了。同源代理没这个问题。
 * ★ 为什么基于真 payload 改而不是自己拼：字段形状（printers 是对象、ops 61 项、
 *   version 是 0.2.0+hash）自己拼必然拼错，拼错了截出来的图就是在骗人。
 *
 * 用法：node scripts/mock-my-status.js [--tag 修后]
 */
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { createHarness } = require('./live-harness')

const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist', 'build', 'h5')
const PORT = 5505
const REAL = { host: '149.88.75.125', port: 8000 }
const CAPS_URL = 'http://149.88.75.125:8000/api/v1'
const TAG = (process.argv.find((a, i) => process.argv[i - 1] === '--tag') || '修前')

let capsMode = 'passthrough'   // passthrough | 情形名 | abort
let realPayload = null

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }

/** 在真 payload 上只改要验的那一两处，其余原样 */
function variant() {
  const d = JSON.parse(JSON.stringify(realPayload))
  if (capsMode === 'healthy') return d
  if (capsMode === 'dberr') {
    d.data.capabilities.dbStatus = 'error'
    d.data.capabilities.dbError = '无法打开登录所请求的数据库 "shiwantongda"。登录失败。'
    return d
  }
  if (capsMode === 'oldpkg') {
    delete d.data.capabilities.dbStatus
    delete d.data.capabilities.dbError
    return d
  }
  if (capsMode === 'noprinter') {
    d.data.capabilities.printers.v3Printers = []
    d.data.capabilities.printers.defaultPrinter = ''
    return d
  }
  if (capsMode === 'offline') {
    d.data.agent.online = false
    delete d.data.capabilities
    return d
  }
  return d
}

function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath)
  if (p === '/' || !path.extname(p)) p = '/index.html'
  const fp = path.join(DIST, p)
  if (!fp.startsWith(DIST) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); return res.end('nf')
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' })
  fs.createReadStream(fp).pipe(res)
}

function proxy(req, res, urlPath) {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const headers = Object.assign({}, req.headers)
    headers.host = REAL.host + ':' + REAL.port
    const up = http.request({ host: REAL.host, port: REAL.port, path: urlPath,
      method: req.method, headers }, (ur) => {
      res.writeHead(ur.statusCode, ur.headers)
      ur.pipe(res)
    })
    up.on('error', () => { res.writeHead(502); res.end('{"ok":false}') })
    if (chunks.length) up.write(Buffer.concat(chunks))
    up.end()
  })
}

function startServer() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0]
      if (urlPath === '/api/v1/capabilities') {
        if (capsMode === 'abort') return res.socket.destroy()   // 模拟断网：连接直接断
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify(capsMode === 'passthrough' ? realPayload : variant()))
      }
      if (urlPath.indexOf('/api/') === 0) return proxy(req, res, req.url)
      return serveStatic(req, res, urlPath)
    })
    s.listen(PORT, '127.0.0.1', () => resolve(s))
  })
}

async function fetchRealCaps() {
  const pw = process.env.JXC_APP_PWD ||
    fs.readFileSync(path.join(os.homedir(), '.ssh', 'jxc_app_pw'), 'utf8').trim()
  const lg = await fetch(CAPS_URL + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Merchant': 'shiwantongda' },
    body: JSON.stringify({ provider: 'password', account: 'system', password: pw }),
  }).then((r) => r.json())
  const tok = lg.data && (lg.data.token || lg.data.accessToken)
  if (!tok) throw new Error('云端登录没给 token：' + JSON.stringify(lg).slice(0, 160))
  return fetch(CAPS_URL + '/capabilities', {
    headers: { Authorization: 'Bearer ' + tok, 'X-Merchant': 'shiwantongda' },
  }).then((r) => r.json())
}

/** 把这一屏三格实际渲染出来的文字与配色类读回来（图之外再给一份可断言的事实） */
async function readRows(h) {
  return h.ev(`(() => JSON.stringify([...document.querySelectorAll('.settings__row')].slice(0,3)
    .map(r => [r.querySelector('.settings__label').textContent.trim(),
      r.querySelector('.settings__value').textContent.trim(),
      [...r.querySelector('.settings__value').classList].filter(c => /ok|warn|muted/.test(c)).join('')])
    .map(x => x.join(' = '))))()`)
}

const CASES = [
  ['healthy', '1-都正常', '通道在、库查得通'],
  ['dberr', '2-数据异常', '通道在，客户机那侧的账套库打不开'],
  ['oldpkg', '3-老包不回字段', 'Agent 没报 dbStatus，页面不许猜'],
  ['offline', '4-Agent离线', '云端收不到自述，dbStatus 一并未知'],
  ['noprinter', '6-一台打印机都没有', '服务是通的，那台机器没装打印机（原来这句写成「未连接」）'],
]

async function main() {
  const server = await startServer()
  realPayload = await fetchRealCaps()
  const c0 = realPayload.data
  console.log(`真 payload：online=${c0.agent.online} dbStatus=${c0.capabilities && c0.capabilities.dbStatus} ` +
    `printers=${c0.capabilities && (c0.capabilities.printers.v3Printers || []).length} 台 version=${c0.agent.version}`)

  // ★ 链接末尾的商户码不能省：那是 App 认身份的唯一来源（省了就是"未设置连接"，
  //   而 API 请求本身走的是 origin + /api/v1，商户码在头里带）。
  const h = createHarness({ port: PORT, link: 'http://127.0.0.1:' + PORT + '/shiwantongda' })
  if (!h.ck(await h.login(), '登录成功')) return h.finish(server)
  await h.viewport(414, 900)

  for (const [mode, file, note] of CASES) {
    capsMode = mode
    await h.go('pages/home/index', 6000)
    await h.go('pages/my/index', 8000)
    console.log('  · ' + file + ' —— ' + note)
    console.log('      ' + JSON.stringify(await readRows(h)))
    await h.shot(`我的页状态-${TAG}-${file}.png`)
  }

  /* 断网吃缓存：先用真响应进一次（缓存落盘），再把这一个接口掐掉重进
     ⇒ 关键就看这一屏：缓存里那句 healthy 是真的，但已经是旧的 */
  capsMode = 'healthy'
  await h.go('pages/home/index', 6000)
  await h.go('pages/my/index', 8000)
  capsMode = 'abort'
  await h.go('pages/home/index', 5000)
  await h.go('pages/my/index', 9000)
  console.log('  · 5-断网吃缓存 —— 请求失败，退到上一次缓存')
  console.log('      ' + JSON.stringify(await readRows(h)))
  await h.shot(`我的页状态-${TAG}-5-断网吃缓存.png`)

  capsMode = 'passthrough'
  h.finish(server)
}

main().catch((e) => { console.log('✗ ' + ((e && e.stack) || e)); process.exit(1) })
