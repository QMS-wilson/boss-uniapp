import { http } from '../utils/request'

/**
 * 成员（在线会话）接口（2026-10-12）
 *
 *   GET  /sessions           当前商户范围内的登录会话
 *   POST /sessions/revoke    { jti } 踢这一条；{ username } 踢该账号全部
 *
 * ★ 权限与范围都由**云端**裁决（`sessions.view` / `sessions.kick` + 自己那家商户），
 *   前端只负责调用。所以这里不传商户码 —— 传了也越不出去。
 * ★★ 刻意**不做离线缓存**（不传 cacheKey / offlineOk）：会话是实时状态，
 *   拿上一次的缓存显示"谁在线"就是给假确定性 —— 这个项目反复踩过这一类
 *   （「我的」页那个假「已连接」就是缓存翻出来的旧数据）。
 */
export const sessionApi = {
  list: async () => {
    const res = await http.get('/sessions')
    if (res.ok) res.data = toSessionList(res.data)
    return res
  },

  /**
   * 踢出。两种粒度**必须分开传参**，不要合成一个"踢"：
   *   revoke({ jti })            只断这一台设备（精确）
   *   revoke({ username })       他所有设备一起断（粗暴但一次干净）
   */
  revoke: (payload) => http.post('/sessions/revoke', payload),
}

/** 把云端返回归一成页面要的扁平行。字段名以云端为准，缺的给空值，不猜。 */
export function toSessionList(raw) {
  const d = (raw && (raw.data || raw)) || {}
  const rows = Array.isArray(d.sessions) ? d.sessions : []
  const list = rows.map((r) => {
    const sub = String((r && r.sub) || '')
    // sub 形如 account:laoban / v3:tongda:0001 / wx:openid
    let user = sub
    if (sub.indexOf('account:') === 0) user = sub.slice(8)
    else if (sub.indexOf('v3:') === 0) user = sub.split(':')[2] || sub
    else if (sub.indexOf('wx:') === 0) user = sub.slice(3)
    const kinds = { app: 'App 账号', v3: 'V3 操作员', wechat: '微信' }
    return {
      jti: String((r && r.jti) || ''),
      sub,                       // 完整主体（account:… / v3:<商户>:<编号>）—— 踢"全部"要用它
      user,
      name: String((r && r.name) || '') || user,
      kind: kinds[(r && r.kind) || ''] || (r && r.kind) || '—',
      merchant: String((r && r.mkt) || '') || ((r && r.mkts) || []).join('、') || '—',
      ip: String((r && r.ip) || '') || '—',
      loginAt: Number((r && r.login_at) || 0),
      idleSec: Number((r && r.idle_sec) || 0),
      online: !!(r && r.online),
      revoked: !!(r && r.revoked),
      // 设备 / 端（服务端解析好的，三处页面共用一份口径）
      brand: String((r && r.brand) || ''),
      model: String((r && r.model) || ''),
      client: String((r && r.client) || ''),
      platform: String((r && r.platform) || ''),
      // ★ 账套（2026-10-14）：每本账有自己的操作员集合，不显示就答不出
      //   "这个操作员此刻在哪本账上"。空串 = 该商户没登记账套清单。
      database: String((r && r.database) || ''),
      device: [r && r.brand, r && r.model, r && r.client].filter(Boolean).join(' · ')
        || (r && r.platform) || '—',
    }
  })
  return {
    list,
    total: list.length,
    online: list.filter((x) => x.online).length,
    perms: (d.perms || []).slice(),
  }
}
