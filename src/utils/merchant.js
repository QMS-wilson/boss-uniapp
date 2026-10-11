/**
 * 商户码 = 这个入口属于哪一家。
 *
 * ★★ 唯一来源：**设置页里填进来的那条链接**（`base + /商户码`，见 utils/config.js 的
 *   parseServerLink）。2026-09-29 重定：URL 前缀**不再绑定身份**，只作为设置页的预填建议。
 *   为什么必须这么改，两条都是实测出来的，不是洁癖：
 *     · 小程序 / App 没有 pathname，靠前缀的话它们永远发不出 X-Merchant，
 *       只能吃云端"令牌只可及一家就不必点名"那条兜底 —— 等于身份由服务端猜；
 *     · 同源下 localStorage 是共享的，前缀本身拦不住任何东西：裸域名打开直接就是
 *       某一家在跑，走的是旧裸键 jxc_auth + 上面那条兜底（2026-09-29 现场）。
 *   所以：**没填链接 = 没有商户码 = 零数据**，前端不猜、云端也不许猜（resolve_merchant_hint
 *   本来就不兜底，见下面 MERCHANT_REQUIRED）。
 *
 * 云端拿这个码和**令牌里的归属**交叉校验：
 *   不符 → 403 TENANT_MISMATCH（前端必须清登录态退回登录页）
 *   未知码 → 404 MERCHANT_NOT_FOUND
 */

// ★ 带 .js 扩展名：vite 两种都认，但门脚本是 Node 直接 import 这个文件（Node ESM 不补扩展名）。
import { merchantOfLink, isMerchantCode } from './config.js'

/** 生效的商户码：只认设置页那条链接拆出来的那一段。空串 = 还没配连接 */
export function merchantCode() {
  return isMerchantCode(merchantOfLink())
}

/**
 * URL 前缀推出来的**建议值**（只给设置页预填，绝不直接生效）。
 * H5 才有；小程序/App 没有 pathname，返回空串，让人自己填。
 */
export function suggestMerchantFromPath() {
  // #ifdef H5
  try {
    const p = (window.location && window.location.pathname) || ''
    return isMerchantCode((p.split('/').filter(Boolean)[0] || ''))
  } catch (e) {
    return ''
  }
  // #endif
  // #ifndef H5
  return ''
  // #endif
}

/** 带商户码的存储键。根站（无码）沿用旧裸键，保证在线客户的本地数据不被搬家。 */
export function storageKey(base) {
  const code = merchantCode()
  return code ? base + ':' + code : base
}

/* ------------------------------------------------------------------ 当前账套
 *
 * ★ 为什么"选中的账套"存在这里，而不是 pinia store 里：
 *   请求层（X-Database）与缓存桶（jxc_cache:<码>:<库>）都要读它，
 *   而它们都**不能依赖 store**（store/auth 反过来要 import 这两个模块）。
 *   放 store 就会绕成一个循环；放这里则谁都能读、谁都不拥有。
 *   store 只负责把它镜像给界面渲染，并保证切换时两边一起改。
 *
 * ★ 空串的含义是**没有点名**，不是"默认库的名字"。
 *   所以单账套商户（绝大多数）永远存空串 ⇒ 存储键、请求头与改造前**逐字节一致**。
 *   只有真有多本账的商户才可能写出带库名的键，也就只有他们会被影响。
 *
 * ★ 键名带商户码：同 origin 下两家共用 localStorage 是实测踩过的坑（见文件头）。
 */
const DB_BASE = 'jxc_db'

export function selectedDatabase() {
  try {
    const raw = uni.getStorageSync(storageKey(DB_BASE))
    // ★ 库名保留原大小写，不 lowerCase。SQL Server 库名不分大小写、云端也已改成不分大小写
    //   比对，但前端这边一旦 lower 就会把「shiwantongdaB」显示成「shiwantongdab」——
    //   界面写的和云端登记的对不上，排查时会以为连错了账套（2026-09-29 实况门撞出来的）。
    return raw ? String(raw).trim() : ''
  } catch (e) {
    return ''
  }
}

/** 记下选中的账套；传空串就是"不点名，读默认库"。 */
export function setSelectedDatabase(name) {
  const db = String(name || '').trim()
  try {
    uni.setStorageSync(storageKey(DB_BASE), db)
  } catch (e) { /* 写不进去只是回到默认库，不影响读数据 */ }
  return db
}

/**
 * 存储键的账套后缀。**没点名时返回空串**，调用方拼出来的键与改造前相同。
 * 库名可能含中文/连字符，它们进 localStorage 键名是安全的（不会与 `:` 冲突），
 * 但仍先做一次白名单过滤：脏值会造出一个再也清不掉的键（同商户码的处理）。
 */
export function databaseSuffix() {
  const db = selectedDatabase()
  return db && /^[\w一-鿿-]{1,128}$/.test(db) ? ':' + db : ''
}
