/**
 * 离线缓存 + 草稿
 *   - 缓存只读数据（单据/客户/商品字典），断网可查
 *   - 草稿：断网时新建/改单暂存本地，联网后自动上传
 */
import { defineStore } from 'pinia'
import { config } from '../utils/config'
import { merchantCode, storageKey, databaseSuffix, selectedDatabase } from '../utils/merchant'
import { legacySessionMerchant } from './auth'
import { markBillWritten } from '../utils/billWrites'

// ★ 键带商户码（同 auth.js 的理由：同 origin 共享 localStorage）。
// ★ Step 4 起再带**账套**：一台主机两本账时，A 账的缓存/草稿绝不能被当成 B 账的显示或写入。
//   没点名账套时 `databaseSuffix()` 返回空串 ⇒ 键与改造前**逐字节一致**（单账套商户零影响）。
const LEGACY_DRAFT_KEY = 'jxc_drafts'   // 只用于认领旧草稿，不删裸键
const cacheBucket = () => storageKey('jxc_cache') + databaseSuffix()
const draftBucket = () => storageKey('jxc_drafts') + databaseSuffix()

export const useCacheStore = defineStore('cache', {
  state: () => ({
    data: {},     // { [cacheKey]: { value, at } }
    drafts: [],   // 待上传草稿 [{ id, type, payload, createdAt, mkt, db }]
    _flushing: false,   // 重放在飞闸（onShow 与网络恢复两个触发点几乎总是一先一后）
  }),

  actions: {
    get(key) {
      const e = this.data[key]
      return e ? e.value : null
    },
    at(key) {
      const e = this.data[key]
      return e ? e.at : 0
    },
    set(key, value) {
      this.data[key] = { value, at: Date.now() }
      // 简单 LRU：超上限删最早的
      const keys = Object.keys(this.data)
      if (keys.length > config.CACHE_LIMIT) {
        keys.sort((a, b) => this.data[a].at - this.data[b].at)
        for (let i = 0; i < keys.length - config.CACHE_LIMIT; i++) delete this.data[keys[i]]
      }
      this._persist()
    },

    /**
     * 删除单个缓存键。
     * ★ 用途：改单成功后主动作废 `sale:<billNo>` —— 否则若紧接着的详情请求
     *   走网络失败分支（`offlineOk`），会把**改之前**的缓存回给详情页，
     *   表现为「改完还是原数据」（与用户报的现象一模一样）。
     */
    remove(key) {
      if (key in this.data) {
        delete this.data[key]
        this._persist()
      }
    },

    /* ===== 草稿 ===== */
    addDraft(type, payload, url) {
      // ★ db = 存这条草稿时**正在读的那本账**（空串=默认库）。
      //   没有它，切到账套 B 之后 flushDrafts 会把 A 的单传进 B —— 那是写错账，不可逆。
      // ★ url = 当时那条请求的地址（'/sales/XK0001' 之类）。改单类草稿必须带它才能重放，
      //   因为 payload 里根本没有单号。
      const d = { id: 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                  mkt: merchantCode(), db: selectedDatabase(),
                  type, payload, url: url || '', createdAt: Date.now() }
      this.drafts.push(d)
      this._persist()
      return d
    },
    removeDraft(id) {
      this.drafts = this.drafts.filter((d) => d.id !== id)
      this._persist()
    },
    /**
     * 按 id 原地改一条草稿（草稿箱「存草稿」再存一次 = 覆盖同一条）。
     * ★ 只 patch 传进来的键，`createdAt` 由调用方**不传**来保持不动 ——
     *   草稿列表要写「存于 …」，一条被改过三次的草稿显示创建时间才对得上人的直觉。
     */
    updateDraft(id, patch) {
      const d = this.drafts.find((x) => x.id === id)
      if (!d) return null
      Object.assign(d, patch)
      this._persist()
      return d
    },
    /** 放入一条**调用方拼好**的草稿（手动草稿要带 form/savedAt 自己的形状，addDraft 给不了） */
    putDraft(d) {
      this.drafts.push(d)
      this._persist()
      return d
    },
    /** 整桶替换（pruneDrafts 剪枝用） */
    setDrafts(list) {
      this.drafts = Array.isArray(list) ? list : []
      this._persist()
    },
    getDrafts() {
      return this.drafts
    },
    hasDrafts() {
      return this.drafts.length > 0
    },

    /**
     * 重放**一条**单据草稿。flushDrafts 与草稿行上的「立即上传」共用这一份实现 ——
     * 两处各写一遍的话，迟早出现"自动传能传、手点传不了"。
     * ★ 类型白名单就是"什么会被自动提交"的唯一边界：`*.manual` 不在表内 ⇒ 半填的手动草稿
     *   永远不会被自动建单（utils/draftBox.js 的关键不变量）。
     */
    async replayDraft(d) {
      const { http } = await import('../utils/request')
      // ★ 这张表就是"什么会被自动提交"的唯一边界。`*.manual`（手动草稿）**不在表内**，
      //   所以填了一半的单子永远不会被自动建成单。加行之前先想清楚这一条。
      const put = (u) => {
        if (!u) return { id: d.id, ok: false, message: '这条草稿没记下原单号，不能猜改的是哪张单' }
        return http.put(u, d.payload)
      }
      try {
        let res
        if (d.type === 'salesbill.create') res = await http.post('/sales', d.payload)
        else if (d.type === 'salesbill.update') res = await put(d.url || '/sales/' + d.payload.id)
        else if (d.type === 'purchasebill.create') res = await http.post('/purchases', d.payload)
        else if (d.type === 'purchasebill.update') res = await put(d.url || '/purchases/' + d.payload.id)
        else return { id: d.id, ok: false, skipped: true, message: '这类草稿不参与自动上传' }
        if (res.ok) {
          this.removeDraft(d.id)
          // ★ 重放成功也要打「写过」标记：销售/采购列表是"写过才刷"，
          //   不打的话自动上传成功的那张单要等用户手动下拉或重进才出现。
          if (d.type === 'salesbill.create' || d.type === 'salesbill.update') markBillWritten('sales')
          else if (d.type === 'purchasebill.create' || d.type === 'purchasebill.update') markBillWritten('purchase')
          return { id: d.id, ok: true }
        }
        return { id: d.id, ok: false, message: res.message }
      } catch (e) {
        return { id: d.id, ok: false, message: e.message }
      }
    },

    /**
     * 联网后批量上传草稿，逐条处理冲突。
     * ★ 只自动重放**幂等窗内**的：Agent 的 client_token 记录是 30 分钟纯内存
     *   （v3agent/idem.py，进程重启即清空）。超出这个窗重放就是一次全新提交 ——
     *   若那张单当时其实已经建成，库里就多出一张。所以超窗的留在列表里，
     *   由人点「上传」：那是他看得见后果的动作，不是系统替他做的。
     */
    async flushDrafts() {
      // ★ 在飞闸：App 的 onShow 与网络恢复两个触发点几乎总是一先一后到达，
      //   不挡的话同一批草稿会并发重放两遍（正确性全押在 client_token 的内存幂等表上，
      //   Agent 重启过的话那张表是空的）。
      if (this._flushing) return []
      // ★ 离线（或网络态未知）时不空跑：不然每次回前台都发一轮注定失败的 POST，
      //   再给用户弹一条「上传失败」，纯添乱。网络恢复那个触发点自己会再来。
      const net = await new Promise((resolve) => {
        try {
          uni.getNetworkType({ success: (r) => resolve(r && r.networkType), fail: () => resolve('unknown') })
        } catch (e) { resolve('unknown') }
      })
      if (net === 'none') return []
      this._flushing = true
      try {
        const mine = merchantCode()
        const myDb = selectedDatabase()
        const IDEM_WINDOW = 25 * 60 * 1000        // 30 分钟窗，留 5 分钟余量
        const results = []
        for (const d of [...this.drafts]) {
          // ★ 两道归属过滤，缺一就可能写错账：
          //   1) 商户：少了它，A 家断网写的单子会在下次联网时传进 B 家；
          //   2) 账套：一家两本账时，A 账的草稿绝不能重放进 B 账（单号会落在错的账簿里）。
          //   归属不明的旧草稿（没有 mkt 标记）宁可留在列表里不传，也不猜。
          if (String(d.mkt || '') !== mine) continue
          if (String(d.db || '') !== myDb) continue
          if (Date.now() - Number(d.createdAt || 0) > IDEM_WINDOW) {
            results.push({
              id: d.id, ok: false, stale: true,
              message: '离线时存的这条已超过重放窗口，自动上传可能建出第二张：'
                + '请先在列表里核对有没有这张单，再点「上传」',
            })
            continue
          }
          results.push(await this.replayDraft(d))
        }
        return results
      } finally {
        this._flushing = false
      }
    },

    _persist() {
      // ★ 草稿先写、且与缓存各自独立 try：缓存桶一旦超限（小程序单键 1MB）抛错，
      //   不能把「断网建的单」的落盘一起拖死——草稿才是真正不能丢的数据。
      try {
        uni.setStorageSync(draftBucket(), this.drafts)
      } catch (e) {}
      // 缓存桶：写失败就丢最旧的再试（缓存丢了可以重新拉，反复写不进才放弃）。
      for (let i = 0; i < 3; i++) {
        try {
          uni.setStorageSync(cacheBucket(), this.data)
          return
        } catch (e) {
          const keys = Object.keys(this.data)
          if (keys.length <= 10) return
          keys.sort((a, b) => (this.data[a].at || 0) - (this.data[b].at || 0))
          const drop = Math.max(1, Math.floor(keys.length / 4))
          for (let j = 0; j < drop; j++) delete this.data[keys[j]]
        }
      }
    },
    /**
     * 换账套后重新装桶：把内存里这本的数据清掉，读目标桶。
     * ★ 不这么做的话，切完账套页面上还是上一本的数字，
     *   而 `offlineOk` 分支会持续把旧桶的缓存当成"实时数据"回给页面。
     */
    useBucket() {
      this.restore()
      return this
    },
    restore() {
      try {
        this.data = uni.getStorageSync(cacheBucket()) || {}
        this.drafts = uni.getStorageSync(draftBucket()) || []
        // 一次性认领旧裸键里的草稿：只有"那份会话确实属于本商户"才认领，
        // 认领后补上 mkt 标记；**不删**裸键（根站 `/` 还在用）。
        const want = merchantCode()
        // 认领旧裸键只在"本桶没点名账套"时做：那些草稿都产生于分账套之前，
        // 属于默认库；正在看第二本账的时候把它们捞进当前桶 = 往 B 账写 A 的单。
        const myDb = selectedDatabase()
        if (want && !myDb && !this.drafts.length && legacySessionMerchant() === want) {
          const legacy = uni.getStorageSync(LEGACY_DRAFT_KEY) || []
          if (legacy.length) {
            this.drafts = legacy.map((d) =>
              Object.assign({}, d, { mkt: d.mkt || want, db: d.db || '' }))
            this._persist()
          }
        }
      } catch (e) {}
    },
  },
})
