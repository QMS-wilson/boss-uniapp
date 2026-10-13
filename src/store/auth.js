/**
 * 认证状态（多入口统一收敛 + 店铺为一等公民）
 *   token / refreshToken / user / stores[] / currentStoreName / permissions
 *   持久化到 uni.storage
 *
 * 真实后端登录返回（/api/v1/auth/login）：
 *   { ok:true, data:{ accessToken, refreshToken, expiresIn, tokenType,
 *     user:{ username, name, kind }, authorized, stores:[{ name, title, agent, online }] } }
 */
import { defineStore } from 'pinia'
import { config } from '../utils/config'
import { merchantCode, storageKey, selectedDatabase, setSelectedDatabase } from '../utils/merchant'

// ★ 键名带商户码（jxc_auth:yedian）。为什么必须带：同一台机器上两家是**同一个 origin**，
//   localStorage 按 origin 共享 —— 不带码就等于两家共用一份登录态。
// ★★ 必须**每次用时现算**，不能在模块加载时算一次常量：商户码现在来自设置页那条链接，
//   它会在运行期变（人在设置页改完点"去登录"）。旧写法在前缀定身份的年代不会出问题，
//   在新模型下会把新商户的令牌写进上一家的键里。
const authKey = () => storageKey('jxc_auth')
// 没配商户码时 storageKey 算出来的就是这一个裸键（旧版根站也用它存会话）
const BARE_KEY = 'jxc_auth'

/** 旧裸键 jxc_auth 里那份会话属于哪家（只用于**迁移草稿**的判断，不再用于登录态） */
export function legacySessionMerchant() {
  try {
    const raw = uni.getStorageSync(BARE_KEY)
    const first = ((raw && raw.stores) || [])[0] || {}
    return String(first.agent || '').trim().toLowerCase()
  } catch (e) {
    return ''
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    user: null,              // { username, name, kind }
    stores: [],              // 可访问店铺 [{ name, title, agent, online }]
    currentStoreName: '',    // 展示用：当前店铺名（Phase 2 起不再是路由依据）
    // ★ Step 4：这家商户有哪几本账 + 当前读哪本（空串=默认库=不点名）。
    //   merchants 来自登录响应（云端 merchants[] 带 databases/database_default/served_databases）。
    merchants: [],
    currentDatabase: '',
    permissions: [],
    tenantError: '',         // 本入口与登录归属不符时的提示（登录页显示）
  }),

  getters: {
    isLoggedIn: (s) => !!s.accessToken,
    currentStore: (s) => s.stores.find((x) => x.name === s.currentStoreName) || null,
    hasMultiStore: (s) => s.stores.length > 1,
    /** 本入口那家商户（商户码 == URL 前缀） */
    currentMerchant: (s) => {
      const want = merchantCode()
      return (s.merchants || []).find((m) => String(m.code || '') === want) || null
    },
    /** 这家被允许读的账套清单（没登记就是空数组 ⇒ 界面不出现"选账套"这个东西） */
    databases: (s) => {
      const m = (s.merchants || []).find((x) => String(x.code || '') === merchantCode())
      return ((m && m.databases) || []).map((d) => String(d))
    },
    hasMultiDatabase: (s) => {
      const m = (s.merchants || []).find((x) => String(x.code || '') === merchantCode())
      return ((m && m.databases) || []).length > 1
    },
    isExpired: (s) => s.expiresAt > 0 && Date.now() > s.expiresAt,
    /**
     * ★ 这次会话是不是"某本账里的一个操作员"（provider=v3 登录签的）。
     *   这类身份是**按账套记的**：人是那本库 UserInfo 里的一行，口令也是那本库的。
     *   所以切账套不能像平台账号那样"换个数据源继续用" —— 那会得到
     *   「人是 A 本的、数字是 B 本的」，正是本项目反复出事的那类静默错。
     */
    isV3Operator: (s) => String((s.user || {}).kind || '') === 'v3',
    needRefresh: (s) => s.expiresAt > 0 && Date.now() > s.expiresAt - config.REFRESH_THRESHOLD,
    /**
     * ★ 只读模式：后端 stores[].access === 'guest'
     *   实测 shiwang 返回 access:'guest'，云端按 guest 授权时业务接口可能拒绝写操作。
     *   这里不猜测行为，只把它作为一个可展示的标记，由页面决定是否禁用写入口。
     */
    readOnly: (s) => {
      const cur = s.stores.find((x) => x.name === s.currentStoreName)
      return !!cur && cur.access === 'guest'
    },
    storeOnline: (s) => {
      const cur = s.stores.find((x) => x.name === s.currentStoreName)
      return cur ? cur.online !== false : false
    },
    /**
     * 能不能进「成员管理」（看/踢在线会话）。
     *
     * ★ 权限位由云端登录响应带回来；云端接口**还会再校验一次** ——
     *   所以这里只决定"显不显示入口"，不作为安全边界（改前端也无法越权）。
     * ★ 用 indexOf 不用 includes：小程序基础库对 includes 的支持更晚，indexOf 最省心。
     */
    canManageSessions: (s) => (s.permissions || []).indexOf('sessions.view') >= 0,
  },

  actions: {
    /** 登录成功后写入（适配真实返回结构） */
    setLogin(data) {
      const want = merchantCode()
      const got = String(data.merchant || '')
      if (want && got && want !== got) {
        // ★ 不能落盘：一旦把别家的令牌写进 jxc_auth:<want>，这个入口以后每次都带着
        //   别人的身份去请求。宁可退回登录页说清楚，也不"先登进来再说"。
        this.clear()
        this.tenantError = '这个入口属于商户「' + want + '」，该账号无权进入'
        return false
      }
      this.tenantError = ''
      this.accessToken = data.accessToken
      this.refreshToken = data.refreshToken || this.refreshToken
      // 真实返回 expiresIn（秒）；兼容 expiresAt 时间戳
      this.expiresAt = data.expiresAt || (data.expiresIn
        ? Date.now() + data.expiresIn * 1000
        : Date.now() + 12 * 3600 * 1000)
      this.user = data.user || null
      this.stores = data.stores || []
      // 默认选第一个店
      if (!this.currentStoreName && this.stores.length) {
        this.currentStoreName = this.stores[0].name
      }
      // ★ 2026-10-12：云端给的是 `accountPerms`（不是 `permissions`），
      //   而且字段名刻意与 V3 操作员的 `perms`（那是个权限字典）分开 ——
      //   所以这里两个名字都要认，只改一处就是"界面入口永不出现"。
      this.permissions = data.accountPerms || data.permissions || []
      this.merchants = data.merchants || []
      // ★ 选中的账套必须还在清单里，否则清成"不点名"。
      //   平台方把第二本撤掉之后，客户端里那个残留选择会让每个请求都带一个越界的
      //   X-Database ⇒ 全站 403，而现象看着像"服务坏了"。宁可回默认库。
      this.currentDatabase = this._sanitizedDatabase()
      setSelectedDatabase(this.currentDatabase)
      this._persist()
      return true
    },

    setToken(accessToken, refreshToken, expiresIn) {
      this.accessToken = accessToken
      if (refreshToken) this.refreshToken = refreshToken
      this.expiresAt = expiresIn
        ? Date.now() + expiresIn * 1000
        : Date.now() + 12 * 3600 * 1000
      this._persist()
    },

    switchStore(storeName) {
      this.currentStoreName = storeName
      this._persist()
    },

    /**
     * 存储里那个选择是否还成立；不成立就回落到"这家第一本"。
     *
     * ★ 为什么多本时**连默认那本也要点名**（`''` 只留给单本/无清单的商户）：
     *   不点名 = 让客户机按它自己 `config.sql.database` 决定读哪本。技术员在主机上
     *   做过一次"热切换"之后，那本默认已经悄悄换人了 —— 手机上写着"当前账套 A"、
     *   读的却是 B，这是进销存里最坏的一类错（看着正常）。点名之后读到的就一定是
     *   屏幕上那一本；客户机没放行这本时会响亮地回 `DATABASE_NOT_ALLOWED`。
     *   单本商户仍然不点名 ⇒ 现网那份行为与改造前逐字节一致。
     */
    _sanitizedDatabase() {
      const db = selectedDatabase()
      const list = this.databases || []
      if (!list.length) return ''            // 这家没登记清单 ⇒ 不许带名字去请求
      if (list.length === 1) return ''       // 单本：没什么可选，保持与改造前一致
      return list.indexOf(db) >= 0 ? db : list[0]
    },

    /**
     * 切到账套 name（'' = 回到默认那本）。返回是否真的换了。
     * ★ 三件事必须一起做完，少一件就是"看着切了、数字还是上一本"：
     *   1) 写存储（请求层与缓存桶都从这里取值）；
     *   2) 换缓存桶（否则 offlineOk 会拿旧桶缓存当实时数据回给页面）；
     *   3) 落盘登录态（重启/刷新后还在同一本上）。
     */
    switchDatabase(name) {
      const list = this.databases || []
      let want = String(name || '').trim()
      // ★ 比对可以不分大小写，**落盘必须用清单里的原名**：SQL Server 的库名区分大小写，
      //   而 databaseSuffix() 与 X-Database 都吃原值 —— lower 过一次就会切不动、
      //   还会把 "shiwantongdaB" 显示成小写那本（utils/merchant.js 里同一条警告）。
      if (want && list.length && list.indexOf(want) < 0) {
        const hit = list.find((x) => String(x).toLowerCase() === want.toLowerCase())
        if (!hit) return false
        want = hit
      }
      // 多本时"回到默认"落成第一本的名字，而不是空串（见 _sanitizedDatabase）
      if (!want && list.length > 1) want = list[0]
      if (list.length < 2) want = ''
      this.currentDatabase = want
      setSelectedDatabase(want)
      this._persist()
      this._dropTenantMemory()
      return true
    },

    /**
     * ★ 身份或账套一换，**内存里那份按身份分键的状态必须一起丢掉**。
     *   桶键（jxc_cache:<码>:<库>）只在 restore 时读，而 reLaunch 不重建 JS 上下文：
     *   不清的话断网兜底会把上一家的单据回给这一家的页面，
     *   且任何一次 cache.set 都会把这包旧数据落盘进**新商户的桶**里（污染是持久的）。
     *   业务开关同理（它是账套级的）。
     */
    _dropTenantMemory() {
      import('./cache').then(({ useCacheStore }) => useCacheStore().useBucket())
      import('./options').then((m) => m.resetAccountOptions && m.resetAccountOptions())
    },

    clear() {
      this.accessToken = ''
      this.refreshToken = ''
      this.expiresAt = 0
      this.user = null
      this.stores = []
      this.currentStoreName = ''
      this.permissions = []
      this.tenantError = ''
      this.merchants = []
      this.currentDatabase = ''
      setSelectedDatabase('')
      try { uni.removeStorageSync(authKey()) } catch (e) {}
      this._dropTenantMemory()
    },

    /**
     * 商户码变了 ⇒ 把**新旧两处**会话都清掉。
     * ★ 为什么两处：登录态是按商户码分键存的，只清"当前这一个"会留下另一家的令牌 ——
     *   人把链接从 A 改成 B 又改回 A，那份旧令牌还在，直接就是"没登录却看得见数据"。
     *   裸键也一起清：2026-09-29 裸域名打开直接是某一家，走的就是它。
     */
    dropSessions(...codes) {
      const keys = [BARE_KEY]
      codes.forEach((c) => { if (c) keys.push('jxc_auth:' + c) })
      keys.forEach((k) => { try { uni.removeStorageSync(k) } catch (e) {} })
      this.accessToken = ''
      this.refreshToken = ''
      this.expiresAt = 0
      this.user = null
      this.stores = []
      this.currentStoreName = ''
      this.permissions = []
      this.merchants = []
      this.currentDatabase = ''
      setSelectedDatabase('')
      this._dropTenantMemory()
    },

    /**
     * 从本地恢复。
     * ★★ 没配商户码就**一律不认**任何本地会话（2026-09-29 拍板的零数据规则的落点）：
     *   身份只来自设置页那条链接，没有链接就没有"这是哪家"，此时任何一份令牌都不该被恢复。
     *   旧做法是"必要时认下旧裸键那份本来就属于本商户的会话"，现在这条已经删掉 ——
     *   那个判断依赖"前缀=身份"，而前缀不再算身份，留着就等于给裸域名开后门。
     */
    restore() {
      if (!merchantCode()) return          // 零数据：不恢复、不删（人填回链接就该还在）
      try {
        const raw = uni.getStorageSync(authKey())
        if (raw) {
          Object.assign(this, raw)
          this.merchants = raw.merchants || []
          this.currentDatabase = this._sanitizedDatabase()
          setSelectedDatabase(this.currentDatabase)
        }
      } catch (e) {}
    },

    /**
     * 距过期 < 阈值则静默刷新。
     * ★ 必须走 request 内部的同一把单飞锁（refreshOnce）——以前这里裸调 refreshRaw，
     *   onShow 静默刷新与业务请求 401 触发的刷新并发时，同一枚 refreshToken 打两发；
     *   云端若轮换式处理，后到的那发被拒 ⇒ 刚刷新成功的会话被误踢回登录页。
     */
    async maybeRefresh() {
      if (!this.refreshToken || !this.needRefresh) return
      try {
        const { refreshOnce } = await import('../utils/request')
        await refreshOnce(this)
      } catch (e) {}
    },

    _persist() {
      try {
        uni.setStorageSync(authKey(), {
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          expiresAt: this.expiresAt,
          user: this.user,
          stores: this.stores,
          currentStoreName: this.currentStoreName,
          permissions: this.permissions,
          merchants: this.merchants,
          currentDatabase: this.currentDatabase,
        })
      } catch (e) {}
    },
  },
})
