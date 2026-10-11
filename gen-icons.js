// 生成 tabBar 图标 PNG（81x81 RGBA），无需第三方库
const fs = require('fs')
const zlib = require('zlib')
const path = require('path')

const W = 81, H = 81, CX = 40, CY = 40

// 形状判定：返回 true 表示该像素属于图标
const shapes = {
  home: (x, y) => {
    // 屋顶三角
    if (y >= 18 && y <= 38 && Math.abs(x - CX) <= (38 - y)) return true
    // 屋身方块
    if (y >= 38 && y <= 62 && x >= 24 && x <= 56) return true
    return false
  },
  bill: (x, y) => {
    // 文档外框
    if (x >= 24 && x <= 56 && y >= 16 && y <= 64) {
      if (x <= 26 || x >= 54 || y <= 16 || y >= 62) return true // 边框
      // 内部横线
      if ((y === 28 || y === 38 || y === 48) && x >= 30 && x <= 50) return true
    }
    return false
  },
  customer: (x, y) => {
    const d1 = Math.hypot(x - CX, y - 30)
    if (d1 <= 12) return true // 头
    const d2 = Math.hypot(x - CX, y - 66)
    if (d2 <= 22 && y <= 66) return true // 肩
    return false
  },
  product: (x, y) => {
    // 菱形
    if (Math.abs(x - CX) + Math.abs(y - CY) <= 24) return true
    return false
  },
  my: (x, y) => {
    const d1 = Math.hypot(x - CX, y - 30)
    if (d1 <= 13) return true
    const d2 = Math.hypot(x - CX, y - 64)
    if (d2 <= 20 && y <= 64) return true
    return false
  },
}

function crc32(buf) {
  let c, table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function makePng(shapeFn, [r, g, b]) {
  // 原始像素数据，每行前加 filter=0
  const raw = Buffer.alloc((W * 4 + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0 // filter
    for (let x = 0; x < W; x++) {
      const on = shapeFn(x, y)
      const o = y * (W * 4 + 1) + 1 + x * 4
      raw[o] = on ? r : 0
      raw[o + 1] = on ? g : 0
      raw[o + 2] = on ? b : 0
      raw[o + 3] = on ? 255 : 0
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0 // 8-bit RGBA
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const gray = [156, 163, 175]  // #9ca3af
const blue = [79, 109, 245]   // #4f6df5
const dir = path.join(__dirname, 'static', 'tabbar')
fs.mkdirSync(dir, { recursive: true })

for (const [name, fn] of Object.entries(shapes)) {
  fs.writeFileSync(path.join(dir, `${name}.png`), makePng(fn, gray))
  fs.writeFileSync(path.join(dir, `${name}-on.png`), makePng(fn, blue))
  console.log('generated', name)
}
console.log('done')
