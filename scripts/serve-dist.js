/**
 * 本地静态服务器 —— 用于在真实构建产物上做浏览器实测。
 *
 * 为什么需要：sticky / 布局这类问题光看 CSS 猜不准，必须在真实 DOM 上量。
 *
 * ★ 两个坑：
 *   1) 产物用的是 **hash 路由**（/#/pages/login/index），不是 history 路由，
 *      所以直接请求 /pages/xxx 会 404 到 index.html 但路由不认。测试要用 #/。
 *   2) 不要用 `node -e` 内联脚本起服务 —— cwd 不对会静默返回 0 字节。
 *
 * 用法：
 *   node.exe scripts/serve-dist.js [port] [产物目录]
 *
 * ★ 产物目录可覆盖（第 3 个参数或 SERVE_DIR 环境变量），默认 dist/build/h5。
 *   做**反向对照**时要用它指向「改动前的旧构建」副本，
 *   否则只能测新产物，证明不了断言真的能抓到旧 bug。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(
  process.argv[3] || process.env.SERVE_DIR || path.join(__dirname, '..', 'dist', 'build', 'h5')
)
const PORT = Number(process.argv[2] || 5199)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('找不到产物目录:', ROOT)
  process.exit(1)
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'

  let file = path.join(ROOT, urlPath)
  // 目录或不存在 → 回 index.html（SPA 兜底）
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html')
  }

  const body = fs.readFileSync(file)
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}).listen(PORT, '127.0.0.1', () => {
  console.log('serving ' + ROOT)
  console.log('  http://127.0.0.1:' + PORT + '/#/pages/login/index')
})
