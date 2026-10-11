/**
 * 统一请求封装
 * - 自动注入 Authorization: Bearer <accessToken> 与 X-Merchant（URL 前缀给出的商户码）
 * - 401 自动 refresh + 重试一次（refresh 走裸请求，不经拦截器，避免自循环）
 * - 403 TENANT_MISMATCH（入口前缀与令牌归属不符）→ 清登录态退回登录页
 * - 网络失败 → 读操作离线降级；写操作落草稿（需传 draftType，且只重放本商户的）
 * - 统一错误结构：真实后端为 { ok:false, error:{ code, message } }
 */
import { apiBase, config } from './config'
import { merchantCode, selectedDatabase } from './merchant'
import { useAuthStore } from '../store/auth'
import { useCacheStore } from '../store/cache'
import { mockRequest } from '../mock/router'

let _refreshing = null // 正在进行的 refresh 请求（去重）

/**
 * ★★★ 默认超时与报表超时必须分开（2026-09-22）。
 *
 *   云端给报表 op 的 RPC 超时是 180s（business.py `timeout=180`），
 *   但前端 `uni.request` 原先**一律 15s** —— 两道超时不匹配：
 *   只要本地 Agent 排队稍久（历史上单线路串行时，一次报表 3.4s，
 *   多请求叠加很容易破 15s），前端就会**先于云端**把请求砍断，
 *   表现为「转圈一会儿然后网络失败」，而云端其实还在等 Agent。
 *   ⇒ 常规请求保持 15s（快就是快，慢就该报错）；
 *     报表类请求放宽到 60s（< 云端 180s，让云端有机会回 504 而不是被前端抢占）。
 */
export const DEFAULT_TIMEOUT = 15000
export const REPORT_TIMEOUT = 60000
/**
 * ★ 写操作与打印/预览必须比云端**多等一会儿**，不能复用 15s：
 *   云端给 salesbill.create/update/audit 是 120s、打印 120s、版式预览 180s
 *   （见 进销存-云端后台源码/cloudapi/business.py）。前端先掐线并不会让服务端停下来，
 *   只会把一张**已经建成的单**显示成"离线"，然后落一条草稿等着重放 = 第二张单。
 *   所以这里各留 10s 余量。
 */
export const WRITE_TIMEOUT = 130000
export const PRINT_TIMEOUT = 190000

/**
 * 正在飞行的请求表：key → { task, cancelled }
 *
 * ★ 用途（2026-09-22）：报表查询可能跑几十秒，用户等不及会**切页/返回**。
 *   改造前这些请求会继续挂在哪儿，其回调仍会在页面已经 `onUnload` 后触发，
 *   轻则写进已销毁页面的响应式数据（告警）、重则让用户以为"页面卡死"。
 *   现在页面可在 `onUnload`/`onHide` 调 `abortByScope('report')` 主动取消，
 *   立刻释放 UI 语义（并让 uni 底层中止请求）。
 *
 * ★ 注意：uni.request 返回的是 RequestTask（有 abort()），但**H5 下**
 *   部分版本 abort 不生效；所以除了 abort，我们还用一个 `cancelled` 标记
 *   在回调里短路 —— 双保险，保证不写已卸载页面的状态。
 */
const _inflight = new Map()

export function cancelRequest(key) {
  const item = _inflight.get(key)
  if (!item) return false
  item.cancelled = true
  try {
    if (item.task && typeof item.task.abort === 'function') item.task.abort()
  } catch (e) { /* ignore */ }
  _inflight.delete(key)
  return true
}

export function cancelByScope(scope) {
  let n = 0
  for (const key of Array.from(_inflight.keys())) {
    if (key.indexOf(scope + ':') === 0) {
      if (cancelRequest(key)) n++
    }
  }
  return n
}

/**
 * ★ 商户身份走 X-Merchant，店铺不再是路由依据（2026-09-26 Phase 2）。
 *
 *   改造前发的是 `X-Store`（店铺 name），实测线上唯一能通的用法是"不发送"：
 *   'shiwantongda-小程序' 这类**展示名**会 404 STORE_NOT_FOUND，中文 header 还有
 *   latin-1 解码问题（详见下面的历史注释）。更关键的是它只在"选哪家店"这一层，
 *   对"这是哪一家的入口"完全无感 —— 同一台机器上开第二家，浏览器会把第一家的
 *   登录态带过去（2026-09-26 实测：/yedian/ 直接显示了 shiwantongda 的真实单据）。
 *   现在由 URL 前缀给出商户码，云端拿它与令牌归属交叉校验，不符直接 403。
 *
 * 历史实测（2026-09-19，Agent 在线）说明为什么不要退回 X-Store：
 *   X-Store: shiwantongda-小程序 → 404 STORE_NOT_FOUND（中文 header 还被解成 'å°ç¨åº'）
 *   X-Store: shiwantongda        → 404 STORE_NOT_FOUND
 *   不带                       → 200（当时只有一家店，服务端自动定位）
 * 也就是说它从来就没真正承担过"选商户"的语义，只是没出事而已。
 */
function _header(auth) {
  const h = { 'Content-Type': 'application/json' }
  if (auth.accessToken) h['Authorization'] = 'Bearer ' + auth.accessToken
  const mkt = merchantCode()
  if (mkt) h['X-Merchant'] = mkt
  // ★ Step 4：一台主机两本账时才点名读哪本。**没选就是不发这个头**，
  //   云端走默认库 ⇒ 单账套商户（现网绝大多数）请求形状与改造前逐字节一致。
  const db = selectedDatabase()
  if (db) h['X-Database'] = db
  h['X-Request-Id'] = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
  return h
}

/**
 * 裸刷新令牌：不经过 401 拦截器，供 request 内部与 auth.maybeRefresh 共用。
 * 这是避免"刷新失败 → 401 → 再刷新"自循环的关键。
 *
 * ★ 返回值里的 `network` 不是装饰：调用方要靠它区分"服务器说这枚令牌不行"
 *   和"根本没问到服务器"。以前两者都当成网络抖动 ⇒ 账号被停/密钥变更后，
 *   客户端永远停在「网络连接失败，请稍后重试」，既不退回登录页也修不好，
 *   现场只会当成网络问题来找平台方（2026-09-26 清场演练时实地撞到过一次）。
 * @returns {Promise<{ok:boolean, data?:object, network:boolean}>}
 */
export function refreshRaw(refreshToken) {
  if (!refreshToken) return Promise.resolve({ ok: false, network: false })
  return uni.request({
    url: apiBase() + '/auth/refresh',
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    data: { refreshToken },
    timeout: 15000,
  }).then((res) => {
    const body = res.data || {}
    // 兼容 { ok, data } 与 { accessToken } 两种返回
    const data = body.data || body
    if (res.statusCode === 200 && data.accessToken) return { ok: true, data, network: false }
    // 有 HTTP 响应但没给令牌 = 服务端明确拒绝（过期/账号已停/归属不符），不该再拖着重试
    return { ok: false, network: false }
  }).catch(() => ({ ok: false, network: true }))   // 只有"没拿到响应"才算网络问题
}

/**
 * 刷新令牌的唯一入口（单飞）：401 拦截器与 auth.maybeRefresh 都必须走这里 ——
 * `_refreshing` 这把去重锁保证任意时刻至多一发 refresh 请求。以前 maybeRefresh
 * 直接裸调 refreshRaw 绕过了这把锁：onShow 静默刷新与业务请求 401 触发的刷新并发时，
 * 同一枚 refreshToken 会打两发；云端若按轮换式处理，后到的那发被拒 ⇒ 刚刷新成功的
 * 会话被误踢回登录页。
 */
export async function refreshOnce(auth) {
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    const r = await refreshRaw(auth.refreshToken)
    if (r.ok) {
      auth.setToken(r.data.accessToken, r.data.refreshToken || auth.refreshToken, r.data.expiresIn)
      return { ok: true }
    }
    // 只有真·网络抖动才不清登录态；服务端明确拒绝时必须退回登录页
    return { ok: false, network: !!r.network }
  })()
  try {
    return await _refreshing
  } finally {
    _refreshing = null
  }
}

/**
 * @param {object} opts
 * @param {string} opts.url        资源路径（相对 /api/v1）
 * @param {string} [opts.method='GET']
 * @param {object} [opts.data]
 * @param {object} [opts.params]    查询参数
 * @param {string} [opts.cacheKey]  离线缓存键（同 key 命中缓存）
 * @param {boolean} [opts.offlineOk] 断网时允许返回缓存
 * @param {string} [opts.draftType] 写操作断网时的草稿类型，如 'salesbill.create'
 * @param {number} [opts.timeout]   自定义超时（报表类应传 REPORT_TIMEOUT）
 * @param {string} [opts.scope]     取消域，如 'report'；配合 cancelByScope 使用
 */
export async function request(opts) {
  const {
    url, method = 'GET', data, params,
    cacheKey, offlineOk = false, draftType = '',
    timeout = DEFAULT_TIMEOUT, scope = '',
  } = opts
  const auth = useAuthStore()
  const cache = useCacheStore()
  const isWrite = method !== 'GET'

  // ★ Mock 模式：直接走示例数据，不发起真实请求
  if (config.USE_MOCK) {
    try {
      const res = await mockRequest({ url, method, data, params })
      if (res.ok && cacheKey) cache.set(cacheKey, res.data)
      return res
    } catch (e) {
      return _err('MOCK_ERROR', e.message || 'Mock 错误')
    }
  }

  let fullUrl = apiBase() + url
  if (params && Object.keys(params).length) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    if (qs) fullUrl += '?' + qs
  }

  // ★ 每次请求登记一个可取消条目（同 URL 重复请求以最后一次为准）。
  //   登记时必须**顶掉并取消前一条**，且清理只删自己那一条 ——
  //   早先版本是"直接覆盖 + finally 无条件 delete"：后发的把前一条从表里挤掉，
  //   前一条回来时又把后一条的登记删了 ⇒ 仍在飞的请求谁都取消不到，
  //   页面销毁后回调照样写、还白占云端在途位。
  const flightKey = scope ? (scope + ':' + method + ':' + fullUrl) : ''
  const flight = { task: null, cancelled: false }
  if (flightKey) {
    const prev = _inflight.get(flightKey)
    if (prev) {
      prev.cancelled = true
      try { if (prev.task && prev.task.abort) prev.task.abort() } catch (e) {}
    }
    _inflight.set(flightKey, flight)
  }

  const doRequest = () => {
    const p = uni.request({
      url: fullUrl, method, header: _header(auth),
      data: method === 'GET' ? undefined : data,
      timeout,
    })
    flight.task = p
    return p
  }

  const cleanup = () => {
    if (flightKey && _inflight.get(flightKey) === flight) _inflight.delete(flightKey)
  }

  try {
    const res = await doRequest()
    // ★ 已取消：直接返回，绝不把结果写回已卸载的页面
    if (flight.cancelled) return _err('CANCELLED', '请求已取消')

    // 401 → 刷新后重试一次。**但 /auth/* 自己除外**：
    //   登录回 401 的意思是"操作员编号或口令不对"，把它当成"令牌过期去刷新"会走一趟
    //   refresh、失败后 _redirectLogin，屏幕上留下的是「登录已过期，请重新登录」——
    //   一句与真实原因无关且会把人引去改口令的话。认证接口自己说原因。
    if (res.statusCode === 401 && auth.refreshToken && url.indexOf('/auth/') !== 0) {
      const r = await refreshOnce(auth)
      if (r.ok) {
        const res2 = await doRequest()
        if (flight.cancelled) return _err('CANCELLED', '请求已取消')
        // ★ 刷新成功但新令牌仍被拒 ⇒ 会话是真没了（顶号/服务端换密钥），
        //   只回一句 TOKEN_INVALID 会让人停在页面上反复点；直接落地到登录页并说清原因。
        if (res2.statusCode === 401) {
          _redirectLogin('AUTH_EXPIRED', '登录状态已失效，请重新登录')
          return _err('AUTH_EXPIRED', '登录状态已失效，请重新登录')
        }
        return _handle(res2, { cacheKey, cache })
      }
      // 网络原因导致的刷新失败 → 不清登录态，提示重试
      if (r.network) return _err('NETWORK_ERROR', '网络连接失败，请稍后重试')
      // 刷新被服务端明确拒绝 ⇒ 会话真没了，要给一句原因，不能默默把人踢回登录页
      // （"点了没反应/突然回到登录页"现场最难归因的一种）
      _redirectLogin('AUTH_REFRESH_DENIED', '登录状态已失效（可能账号在别处登录，或服务端密钥已更换），请重新登录')
      return _err('AUTH_EXPIRED', '登录已过期，请重新登录')
    }

    return _handle(res, { cacheKey, cache })
  } catch (e) {
    if (flight.cancelled) return _err('CANCELLED', '请求已取消')
    // ★ 把底层原因带出来：App 端没有 devtools，而「网络连接失败」在手机上
    //   可能是 DNS 解不出 / TLS 握手被拒 / 超时 / 域名没进小程序白名单 —— 四种原因
    //   原来长得一模一样，现场没法判。errMsg 截断后附上，体验期它就是唯一证据。
    // ★★ 这里取的必须是 catch 的形参 `e`：`res` 声明在上面那个 try 块里，
    //   块级作用域下 catch 里根本看不见它 —— 原来写成 res 就是 ReferenceError，
    //   而这条分支**只有真连不上才会走**（HTTP 4xx/5xx 是 success 分支），
    //   所以 H5 实况门 54 项全绿也照样把它带到了现网（2026-09-29 APK 装完开屏就报
    //   「逻辑层异常：res is not defined」）。
    const why = String((e && (e.errMsg || e.message)) || '').replace(/\s+/g, ' ').slice(0, 90)
    // ★★ 本地超时 ≠ 离线：请求大概率已经出去，而云端给写/打印等的是 120s/180s，
    //   它并不会因为前端掐线就停下来。这时候落一条"提交意图"草稿，重放就是第二张单、
    //   第二次出纸。所以超时只说实话 + 让人先去列表核对，不替他留草稿。
    if (isWrite && /timeout|超时/i.test(why)) {
      return _err('SUBMIT_TIMEOUT', '这一步比预期久，页面先断开了，但服务端可能仍在执行。'
        + '请先在列表里确认这张单在不在，再决定是否重试——重复点击可能出两张。')
    }
    // 网络失败
    // 1) 写操作 → 落草稿，避免用户白填
    if (isWrite && draftType) {
      // ★ 连**请求地址**一起存：改单类草稿重放时要 PUT 回原来那张单，
      //   而 payload 里没有单号（{header, lines} 那种形状），只存 body 就会 PUT 到 /sales/undefined。
      const d = cache.addDraft(draftType, data, url)
      return {
        ok: true, offline: true, draft: true, draftId: d.id,
        message: '当前离线，已存为草稿，联网后自动上传',
      }
    }
    // 2) 读操作 → 返回缓存
    if (offlineOk && cacheKey) {
      const cached = cache.get(cacheKey)
      if (cached) {
        return { ok: true, data: cached, offline: true, cachedAt: cache.at(cacheKey) }
      }
    }
    return _err('NETWORK_ERROR', '网络连接失败，请检查网络' + (offlineOk ? '或查看离线缓存' : '')
      + (why ? '（' + why + '）' : ''))
  } finally {
    cleanup()
  }
}

/**
 * 后端错误码 → 面向用户的中文提示
 *
 * ★ 云端是转发层，真实数据在客户本地 Agent 里。
 *   Agent 离线时所有业务接口都会回 AGENT_OFFLINE —— 这不是前端 bug，
 *   也不该把「客户本地 Agent 不在线：shiwantongda」这种内部话术直接甩给用户。
 */
const FRIENDLY = {
  AGENT_OFFLINE: '店铺数据服务未连接，请确认本地服务已启动后重试',
  AGENT_TIMEOUT: '查询超时，请缩小日期范围或稍后重试',
  CANCELLED: '请求已取消',
  OPENID_REQUIRED: '需要微信登录后才能访问',
  USER_NOT_FOUND: '该微信未开通访问权限',
  NO_ACCESS: '该微信无权访问此账套',
  TOKEN_INVALID: '登录已过期，请重新登录',
  ACCOUNT_INVALID: '账号或密码错误',
  WECHAT_NOT_CONFIGURED: '微信登录尚未开通',
  WX_LOGIN_FAILED: '微信登录失败，请重试',
  BILL_NOT_FOUND: '销售单不存在',
  BILL_NOT_EDITABLE: '该单据当前不可修改',
  PRODUCT_NOT_FOUND: '商品不存在',
  CUSTOMER_NOT_FOUND: '客户不存在',
  DB_ERROR: '数据查询失败，请稍后重试',
  // ★ 租户类（云端 Phase 2 起会回这些码）。提示必须分得清"是入口不对"还是"没开通"，
  //   否则用户只看到一个"请求失败"，然后来找平台方。
  TENANT_MISMATCH: '当前链接与登录账号不属于同一商户，已自动退出，请通过所属商户入口重新登录',
  MERCHANT_NOT_FOUND: '该商户入口尚未开通，请核对链接地址或联系平台',
  MERCHANT_REQUIRED: '该账号可访问多家商户，请从对应商户入口进入',
  MERCHANT_DISABLED: '该商户已停用，请联系平台',
  MERCHANT_UNBOUND: '该商户尚未配置访问入口，请联系平台',
  NO_MERCHANT: '该账号尚未绑定商户，请联系平台',
  TENANT_UNBOUND: '该账号尚未绑定商户，请联系平台',
  AGENT_NOT_REGISTERED: '本地服务未在平台登记，请联系平台',
  OP_NOT_PUBLISHED: '本地服务版本过旧，请升级后重试',
  // ★ 限流/在途满（Phase 5 云端闸门）。没有这两条，用户看到的是 `HTTP_429` 或原文，
  //   而实际意思只是"这家本地服务正忙，等一下就好"—— 说清楚就不用报障了。
  AGENT_BUSY: '本地服务正在处理其他请求，请稍候重试',
  RATE_LIMITED: '操作过于频繁，请稍候再试',
  // ★ 账套维度（Step 2/3/4）。四条要分开说：用户/运营听到"联系平台"得知道联系来干什么。
  DATABASE_NOT_ALLOWED: '该账套未登记至当前商户，请切换账套或联系平台核实',
  DATABASE_NOT_FOUND: '指定账套在该设备上不存在，请联系平台核对账套名称',
  DATABASE_NOT_ACCOUNT_SET: '该数据库不是有效的财鲸V3 账套（缺少业务表），请联系平台核实',
  AGENT_NO_DB_ROUTING: '本地服务版本较低，暂不支持按账套切换，请升级后重试',
}

// 只有"入口与身份不符"才值得清登录态：登录态本身是好的，只是不属于这条路，
// 留着它后面每个请求都会 403。而"未开通/已停用"是地址或服务状态问题，
// 把人登出去反而毁了另一家的正常会话。
const KICK_TO_LOGIN = ['TENANT_MISMATCH']

function _handle(res, { cacheKey, cache }) {
  const body = res.data || {}
  // ★ 先挡"回的是网页不是接口"：地址里多带了 /商户码 时，nginx 的 SPA 兜底会把
  //   index.html 交回来 —— GET 是 200（以前会被当成成功数据吃掉），POST 是 405。
  //   这两种都比"网络坏了"更难猜，所以直接说清是地址的问题（2026-09-28 现场）。
  if (typeof body === 'string' && /<html|<!doctype/i.test(body.slice(0, 400))) {
    // ★ 只有 2xx 才可能是"地址写错了被 SPA 兜底成首页"（GET 回 200、POST 回 405）。
    //   502/504 也回一段 HTML，那是网关或服务在重启 —— 判成 NOT_API 会让人去改一个
    //   本来就对的链接，越改越坏（2026-10-04 审计抓的）。
    if (res.statusCode === 200 || res.statusCode === 405) {
      return _err('NOT_API', '该地址返回的是网页而非接口。链接格式应为「主机/商户码」，'
        + '无需附加 /api/v1 等路径')
    }
    return _err('GATEWAY_HTML', '服务暂时不可用（网关返回了错误页），通常是后端正在重启，'
      + `稍后重试即可（HTTP ${res.statusCode}）`)
  }
  if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
    // 真实后端为 { ok, data }；兼容直接返回 data 的情况
    const payload = body.ok === true && 'data' in body ? body.data : body
    if (cacheKey) cache.set(cacheKey, payload)
    return { ok: true, data: payload, offline: false }
  }
  // 业务错误：真实结构 { ok:false, error:{ code, message } }
  const errObj = body.error || {}
  const code = errObj.code || body.code || `HTTP_${res.statusCode}`
  const message = FRIENDLY[code] || errObj.message || body.message || '操作失败，请稍后重试'
  if (KICK_TO_LOGIN.indexOf(code) >= 0) _redirectLogin(code, message)
  // ★ `serverMessage` 单独留一份原文：FRIENDLY 是按"业务请求"的话术表，
  //   登录这类需要精确分流的原因（NO_PASSWORD / RATE_LIMITED…）会被它盖掉。
  //   调用方想显示"服务端原话"时读这个键，不要去改 FRIENDLY（改了会影响全站）。
  return _err(code, message, errObj.detail || body.detail, errObj.message)
}

function _err(code, message, detail, serverMessage) {
  return { ok: false, code, message, detail, serverMessage: serverMessage || '', error: new Error(message) }
}

function _redirectLogin(code, message) {
  const auth = useAuthStore()
  auth.clear()
  if (code) {
    uni.showToast({ title: message || FRIENDLY[code] || '请重新登录', icon: 'none', duration: 3000 })
  }
  uni.reLaunch({ url: '/pages/login/index' })
}

/* ============ 便捷方法 ============ */
/**
 * ★ 写操作默认等 WRITE_TIMEOUT（130s），不再复用 15s：云端给建单/审核/存档案的是 120s，
 *   前端先掐线并不会让服务端停下来，只会把**已经做成的事**显示成"离线"，
 *   然后落一条草稿等着重放 = 第二张单。真断网是连接层立刻失败，不会白等这 130 秒。
 *   要单独收紧的调用方传 `extra.timeout` 覆盖即可。
 */
export const http = {
  get:    (url, params, extra = {}) => request({ url, method: 'GET', params, ...extra }),
  post:   (url, data, extra = {})   => request({ url, method: 'POST', data, timeout: WRITE_TIMEOUT, ...extra }),
  put:    (url, data, extra = {})   => request({ url, method: 'PUT', data, timeout: WRITE_TIMEOUT, ...extra }),
  patch:  (url, data, extra = {})   => request({ url, method: 'PATCH', data, timeout: WRITE_TIMEOUT, ...extra }),
  delete: (url, extra = {})         => request({ url, method: 'DELETE', timeout: WRITE_TIMEOUT, ...extra }),
}

/**
 * ★ 报表专用便捷方法（2026-09-22）：自动带 60s 超时 + scope='report'。
 *   报表天然慢，用常规 15s 会误杀；带上 scope 后页面可一键取消。
 */
export const reportHttp = {
  get: (url, params, extra = {}) => request({
    url, method: 'GET', params,
    timeout: REPORT_TIMEOUT, scope: 'report', ...extra,
  }),
}
