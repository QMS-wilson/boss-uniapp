/**
 * 运行时配置
 *
 * ★★ 商户身份的唯一来源（2026-09-29 重定）：**设置页里填进来的那条链接**。
 *   链接结构 = `base`（协议+主机+端口） + `/商户码`（第一段路径）。
 *   打开裸域名、装 App、开小程序 —— 都应该是**零数据**，只有填过链接才拿到那一家数据。
 *   URL 前缀**不再绑定身份**（它只用来给设置页预填一个建议值），因为：
 *     · 小程序/App 根本没有 pathname，靠前缀的话它们永远只能吃云端的兜底规则；
 *     · 同源下 localStorage 是共享的，"换个前缀就是换一家"拦不住旧令牌（2026-09-29 现场：
 *       裸域名打开直接是某一家，走的是旧裸键 jxc_auth + 云端"只可及一家就不必点名"）。
 */
const SERVER_KEY = 'jxc_server_base'          // 已废弃为写入目标，只用来认旧值（见 serverBase）
const LINK_KEY = 'jxc_server_link'            // ★ 用户填的那条链接原样（含 /商户码）
const MERCHANT_KEY = 'jxc_merchant'           // ★ 从链接拆出来的商户码

/** 与 merchant.js 判 URL 段用的是同一套字符集（要进 nginx 正则与 URL 前缀） */
const CODE_RE = /^[a-z][a-z0-9-]{1,29}$/
// 这些段不是商户码。★ `api` 必须在里面：有人会把接口地址整段粘进来
//   （`http://host/api/v1`），把它当商户码的话界面会报"没有叫 api 的商户"，
//   而真话是"你没带商户码"—— 一句之差，人会不会去改对的那部分就不同了。
const NOT_A_CODE = ['', 'h5', 'web', 'index', 'static', 'assets', 'api']

/**
 * ★ 接口地址一律**跟页面同源**（H5），不写死。
 *
 *   写死踩过：用 `https://v3jxc.duckdns.org/<码>/` 打开页面时，登录请求打的是
 *   `http://149.88.75.125:8000` —— 浏览器按「混合内容」直接掐掉，而页面给出的是一句
 *   「网络连接失败，请检查网络」，跟网络一点关系都没有（2026-09-26 实操撞的就是这个）。
 *   同源还顺手免掉 CORS，并且 `http://IP`（老书签）与 `https://域名` 一套代码两种入口都成立，
 *   前提是 nginx 两边都反代了 `/api/v1`（真源在 uniapp/scripts/deploy.py 的模板里）。
 *
 *   只有两种情况退回"包内默认值"：
 *     · 本地 dev/预览（localhost、127.0.0.1、带非标准端口的预览服务）—— 那些端口后面没有反代；
 *     · 小程序 / App —— 它们没有 origin 可推。
 *   另外设置页可以覆盖（将来换备案域名时 App 不用重打包，见 serverBase() 第一条）。
 */
function packagedDefault() {
  // #ifdef H5
  return 'http://149.88.75.125:8000'      // 只给本地开发/预览兜底
  // #endif
  // #ifndef H5
  return 'https://v3jxc.duckdns.org'      // 小程序 / App 的包内默认（必须是 https）
  // #endif
}

function sameOriginBase() {
  // #ifdef H5
  try {
    const o = (window.location && window.location.origin) || ''
    const m = /^(https?):\/\/([^:/]+)(?::(\d+))?$/.exec(o)
    if (!m) return ''
    const host = m[2]
    const port = m[3]
    // 带非标准端口 = 本地 vite / serve-dist 预览，那些端口后面没有 nginx 反代 ⇒ 不许走同源
    if (port && port !== '80' && port !== '443') return ''
    if (host === 'localhost' || /^127\./.test(host) || host === '0.0.0.0') return ''
    return m[1] + '://' + host + (port ? ':' + port : '')
  } catch (e) {
    return ''
  }
  // #endif
  // #ifndef H5
  return ''
  // #endif
}

/**
 * 把"用户粘贴进来的地址"归一成接口基址：**只保留协议+主机+端口，路径一律丢掉**。
 *
 * ★ 为什么必须有这一层（2026-09-28 现场：登录报"请求失败，405"）：
 *   客户粘的就是他平时打开的那条链接 `http://149.88.75.125/shiwantongda/`，
 *   而 `/api/v1` 挂在**站点根**上（nginx 只反代 `location ^~ /api/v1/`）。
 *   带着商户前缀去请求，nginx 按 SPA 那条 `try_files … /$c3/index.html` 兜底：
 *   GET 回 200（首页 HTML）、POST 直接 405 —— 于是一边"测试=通"，一边登录死活不通。
 *   规则放在一处（这里），设置页与运行期都走它，不然是两处各写一份、迟早漂。
 */
/** 一段路径到底算不算商户码 —— 唯一实现，设置页/登录页/前缀建议都走它，免得两处各写一份漂掉 */
export function isMerchantCode(seg) {
  const code = String(seg || '').trim().toLowerCase()
  if (!code || NOT_A_CODE.indexOf(code) >= 0) return ''
  return CODE_RE.test(code) ? code : ''
}

/**
 * 把设置页填进来的**整条链接**拆成两段：base 只到协议+主机+端口，第一段路径就是商户码。
 *
 * ★ 为什么不是"把路径丢掉"（旧做法）：客户粘的就是他平时打开的那条
 *   `http://149.88.75.125/shiwantongda/`，而 `/api/v1` 挂在站点根上，带着路径去请求
 *   会被 nginx 的 SPA 兜底接住 —— GET 回 200 一份 HTML、POST 直接 405（2026-09-28 现场）。
 *   旧做法是"把路径扔了保命"，代价是**那个人家的商户码本来是有用的**，扔了就等于
 *   每次都要再问一遍"你是哪家"。现在改成拆开：路径不进请求地址，但留下来当身份。
 * ★ 裸 IP/域名补 `http://`：用户口径是"http 还是 https 只是个形式，别为这个卡人"。
 * ★ 拆不出商户码时**不猜**：返回空串，由界面明说"还没设置连接"，绝不由前端替用户决定一家。
 */
export function parseServerLink(raw) {
  let s = String(raw || '').trim()
  if (!s) return { base: '', merchant: '', path: '' }
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  s = s.replace(/\/+$/, '')
  const m = /^(https?:\/\/[^/]+)(?:\/([^/?#]+))?/i.exec(s)
  if (!m) return { base: '', merchant: '', path: '' }
  const seg = String(m[2] || '').trim()
  return { base: m[1], merchant: isMerchantCode(seg), path: seg.toLowerCase() }
}

/** 当前生效的那条链接（原样，用于把设置页显示回用户填的东西） */
export function serverLink() {
  try { return String(uni.getStorageSync(LINK_KEY) || '').trim() } catch (e) { return '' }
}

/** 设置页写入口：传空串 = 清掉自定义，回到"跟随当前源/包内默认"且**没有商户码** */
export function setServerLink(raw) {
  const v = String(raw || '').trim()
  const parts = parseServerLink(v)
  try {
    if (v) {
      uni.setStorageSync(LINK_KEY, v)
      if (parts.merchant) uni.setStorageSync(MERCHANT_KEY, parts.merchant)
      else uni.removeStorageSync(MERCHANT_KEY)
      // 旧键不再作为写入目标，但清掉它：留着会让"到底以哪个为准"变成两处各说一遍
      uni.removeStorageSync(SERVER_KEY)
    } else {
      uni.removeStorageSync(LINK_KEY)
      uni.removeStorageSync(MERCHANT_KEY)
      uni.removeStorageSync(SERVER_KEY)
    }
  } catch (e) { /* 存储写不进去就是没配好，界面会显示成"未设置连接"，不会假装连上了 */ }
  return parts
}

/** 接口基址：只取链接的 base 段，**路径一律不带**（带了就是 405 那个坑） */
export function serverBase() {
  const p = parseServerLink(serverLink())
  if (p.base) return p.base
  // 没填链接时：H5 跟页面同源，小程序/App 用包内默认。这只解决"打到哪"，不给商户身份。
  return sameOriginBase() || packagedDefault()
}

/** ★ 商户码：身份的唯一来源。空串就是"还没配连接"，界面据此走零数据态 */
export function merchantOfLink() {
  return parseServerLink(serverLink()).merchant
}

export const config = {
  // 云端统一 API 基址（★ 见上面 serverBase()：H5 跟页面同源，不写死）
  // ★ 真实数据链路：H5/App -> nginx(/api/v1) -> cloudapi -> 客户本地 Agent -> 该商户账套
  //   Agent 离线时业务接口会返回 AGENT_OFFLINE，属于正常的业务态，不是前端故障。
  // ★ 2026-09-23 曾临时用 Cloudflare 快隧道的随机 https 域名；2026-09-26 起换成
  //   固定动态域名 v3jxc.duckdns.org（真证书、自动续期），别再往这里塞随机域名。
  get BASE_URL () { return serverBase() },
  API_PREFIX: '/api/v1',

  // ★ 已接入真实接口（路径与参数名严格按照线上 business.py 契约）
  //   采购/供应商已于 2026-09-20 接通真实后端（Agent 的 purchase.*/supplier.*
  //   op + 云端 /purchases、/suppliers 路由），示例数据全部下线。
  USE_MOCK: false,

  // 令牌有效期阈值
  REFRESH_THRESHOLD: 10 * 60 * 1000,

  // 分页
  // ★ PAGE_SIZE：非无限滚动场景的默认条数（销售单列表等）
  // ★ LIST_PAGE_SIZE：商品/客户这类「几千~几万条主数据」的无限滚动每页条数。
  //   后端 product.search / customer.search 已支持 limit+offset 真分页，
  //   上限 min(limit, 500)，越界会被夹到 500。
  PAGE_SIZE: 20,
  LIST_PAGE_SIZE: 120,

  // 离线缓存上限
  CACHE_LIMIT: 200,
}

export const apiBase = () => config.BASE_URL + config.API_PREFIX
