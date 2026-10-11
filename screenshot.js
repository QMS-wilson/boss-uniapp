const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')

const CHROME = '/tmp/chrome-headless-shell-linux-arm64/chrome-headless-shell'
const BASE = 'http://localhost:8080'
const OUT = '/workspace/codespace/进销存-uniapp/screenshots'
fs.mkdirSync(OUT, { recursive: true })

// 移动端视口 375x812 (iPhone X 尺寸)
const VIEWPORT = { width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// 要截图的页面：通过 uni API 导航
const pages = [
  { name: '01-workbench',  nav: null,                                      wait: 3500 },
  { name: '02-sales-list', nav: "switchTab('/pages/sales/list')",          wait: 2500 },
  { name: '03-sales-detail', nav: "navigateTo('/pages/sales/detail?id=bill_001')", wait: 2500 },
  { name: '04-sales-edit', nav: "navigateTo('/pages/sales/edit')",         wait: 2500 },
  { name: '05-customer-list', nav: "switchTab('/pages/customer/list')",    wait: 2500 },
  { name: '06-customer-detail', nav: "navigateTo('/pages/customer/detail?id=cust_001')", wait: 2500 },
  { name: '07-product-list', nav: "switchTab('/pages/product/list')",      wait: 2500 },
  { name: '08-product-detail', nav: "navigateTo('/pages/product/detail?id=prod_001')", wait: 2500 },
  { name: '09-inventory', nav: "navigateTo('/pages/inventory/index')",     wait: 2500 },
  { name: '10-report',     nav: "switchTab('/pages/report/index')",        wait: 2500 },
  { name: '11-my',         nav: "switchTab('/pages/my/index')",            wait: 2500 },
  { name: '12-login',      nav: "navigateTo('/pages/login/index')",        wait: 2500 },
]

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--single-process',
    ],
  })

  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  // 拦截 console 输出用于调试
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [page error]', msg.text().slice(0, 120))
  })
  page.on('pageerror', err => console.log('  [pageerror]', err.message.slice(0, 120)))

  for (const p of pages) {
    try {
      if (p.nav === null) {
        console.log(`加载首页...`)
        await page.goto(BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 })
      } else {
        console.log(`导航: ${p.nav}`)
        await page.evaluate((code) => {
          return new Promise((resolve) => {
            const uni = window.uni || window.__uniApi
            if (!uni) { resolve('no uni'); return }
            if (code.startsWith('switchTab')) {
              const url = code.match(/'([^']+)'/)[1]
              uni.switchTab({ url, complete: () => resolve('done') })
            } else if (code.startsWith('navigateTo')) {
              const url = code.match(/'([^']+)'/)[1]
              uni.navigateTo({ url, complete: () => resolve('done') })
            }
          })
        }, p.nav)
      }
      await new Promise(r => setTimeout(r, p.wait))
      const file = path.join(OUT, p.name + '.png')
      await page.screenshot({ path: file, fullPage: false })
      console.log(`  ✓ ${p.name}.png`)
    } catch (e) {
      console.log(`  ✗ ${p.name}: ${e.message.slice(0, 100)}`)
    }
  }

  await browser.close()
  console.log('完成！截图保存在 ' + OUT)
}

run().catch(e => { console.error(e); process.exit(1) })
