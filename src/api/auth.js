import { http } from '../utils/request'

/**
 * 统一认证（多 provider 收敛）
 * provider: v3 | password | wechat | openid
 *
 * 真实契约（/api/v1/auth/login）：
 *   v3       → { provider:'v3', user, password }   ← 用**财鲸 V3 自己的操作员与口令**
 *              商户码走 X-Merchant（URL 前缀），云端不存口令、也不比对：
 *              它原样转给这家的本地服务，在那台机器上读 V3 的操作员表校验。
 *              失败原因码：BAD_CREDENTIAL / NO_PASSWORD / USER_STOPPED / AMBIGUOUS_NAME
 *                        / AGENT_OFFLINE / V3_LOGIN_UNAVAILABLE / RATE_LIMITED
 *              ★ 话术要看 `serverMessage`（FRIENDLY 那张表是给业务请求的，会盖掉精确原因）
 *   password → { provider:'password', account, password }   平台自建账号（运维兜底）
 *   wechat   → { provider:'wechat', code }
 *   openid   → { provider:'openid', openid }
 */
export const authApi = {
  login: (provider, creds, store) =>
    http.post('/auth/login', { provider, ...creds, store }),

  /**
   * 登录页进门前的两份清单：这家有哪几本账、那本账里有哪些操作员。
   * ★ 这条**不带令牌**（清单只存在于客户机的账套库里，拿不到令牌才要清单）。
   *   失败一律"降级"处理：拿不到清单就退回手输，绝不能因为客户机没开而进不去。
   * @returns {Promise<{ok:boolean, data?:{merchant:object, database:string,
   *                    operators:Array|null, operators_error:object|null}}>}
   */
  options: () => http.post('/auth/options', {}),

  refresh: (refreshToken) =>
    http.post('/auth/refresh', { refreshToken }),

  logout: () =>
    http.post('/auth/logout'),

  me: () =>
    http.get('/auth/me'),

  /** 微信静默登录：wx.login 取 code → 云端 code2session 换 openid */
  wechatLogin: (code, store) =>
    http.post('/auth/login', { provider: 'wechat', code, store }),
}

/** 微信端：取 code（静默无感） */
export function wxLoginCode() {
  return new Promise((resolve) => {
    uni.login({
      provider: 'weixin',
      success: (r) => resolve(r.code),
      fail: () => resolve(null),
    })
  })
}
