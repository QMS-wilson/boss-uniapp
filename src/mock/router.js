/**
 * Mock 路由：按 (method, url) 分发到示例数据。
 * 返回与 request.js 相同的 { ok, data } 结构，带模拟延迟。
 */
import * as D from './data.js'
import { resolvePrice } from '../utils/price'

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const ok = (data) => ({ ok: true, data, offline: false })
const fail = (code, message, detail) => ({ ok: false, code, message, detail })

let _billSeq = 57

export async function mockRequest({ url, method = 'GET', data, params = {} }) {
  await delay(200 + Math.random() * 300)

  // 去掉查询串
  const path = url.split('?')[0]
  const seg = path.split('/').filter(Boolean) // ['products'] / ['products','P001']

  try {
    return ok(await route(method, seg, { ...params, ...(data || {}) }))
  } catch (e) {
    if (e?.mockError) return fail(e.code, e.message, e.detail)
    return fail('MOCK_ERROR', e.message || 'Mock 路由错误')
  }
}

async function route(method, seg, q) {
  const [r0, r1, r2, r3] = seg

  /* ===== 认证 ===== */
  if (r0 === 'auth') {
    if (r1 === 'login') {
      // 对齐真实后端 /api/v1/auth/login 返回结构
      return {
        accessToken: 'mock-token-' + Date.now(),
        refreshToken: 'mock-refresh-' + Date.now(),
        expiresIn: 12 * 3600,
        tokenType: 'Bearer',
        user: D.users[0],
        authorized: true,
        stores: D.stores,
      }
    }
    if (r1 === 'refresh') {
      return { accessToken: 'mock-token-' + Date.now(), refreshToken: 'mock-refresh-' + Date.now(), expiresIn: 12 * 3600 }
    }
    if (r1 === 'logout') return { success: true }
    if (r1 === 'me') return { user: D.users[0], authorized: true, stores: D.stores }
  }

  if (r0 === 'capabilities') return D.capabilities

  /* ===== 商品 ===== */
  if (r0 === 'products') {
    if (method === 'POST') {
      const p = { id: 'P' + String(D.products.length + 1).padStart(3, '0'), ...q, units: q.units || [], status: '在售' }
      D.products.unshift(p); return p
    }
    if (r1) {
      if (r2 === 'sales-history') {
        const p = D.products.find((x) => x.id === r1); if (!p) throw err('NOT_FOUND', '商品不存在')
        const records = []
        D.salesBills.forEach((b) => {
          b.items.forEach((it) => {
            if (it.productId === r1) records.push({ billNo: b.billNo, billDate: b.billDate, customerName: b.customerName, qty: it.qty, price: it.price, amount: it.amount })
          })
        })
        return records.slice(0, 8)
      }
      if (method === 'PATCH') {
        const p = D.products.find((x) => x.id === r1); if (!p) throw err('NOT_FOUND', '商品不存在')
        Object.assign(p, q); return p
      }
      const p0 = D.products.find((x) => x.id === r1); if (!p0) throw err('NOT_FOUND', '商品不存在'); return p0
    }
    return paginateList(filterProducts(q), q)
  }

  /* ===== 客户 ===== */
  if (r0 === 'customers') {
    if (method === 'POST') {
      const c = { id: 'C' + String(D.customers.length + 1).padStart(3, '0'), receivable: 0, cumulativeSales: 0, status: '正常', ...q }
      D.customers.unshift(c); return c
    }
    if (r1) {
      if (method === 'PATCH') {
        const c = D.customers.find((x) => x.id === r1); if (!c) throw err('NOT_FOUND', '客户不存在')
        Object.assign(c, q); return c
      }
      const c = D.customers.find((x) => x.id === r1); if (!c) throw err('NOT_FOUND', '客户不存在')
      return { ...c, recentBills: D.salesBills.filter((b) => b.customerId === r1).slice(0, 5) }
    }
    return paginateList(filterCustomers(q), q)
  }
  if (r0 === 'customer-types') return D.customerTypes

  /* ===== 销售单 ===== */
  if (r0 === 'sales') {
    if (method === 'POST' && !r1) {
      const nb = createBill(q); D.salesBills.unshift(nb); return nb
    }
    if (r1 && r2 === 'audit') {
      const b = D.salesBills.find((x) => x.id === r1); if (!b) throw err('NOT_FOUND', '单据不存在')
      b.status = 'approved'; b.editable = false; return b
    }
    if (r1 && r2 === 'unaudit') {
      const b = D.salesBills.find((x) => x.id === r1); if (!b) throw err('NOT_FOUND', '单据不存在')
      b.status = 'unapproved'; recheckEditable(b); return b
    }
    if (r1 && (method === 'PUT' || method === 'PATCH')) {
      const b = D.salesBills.find((x) => x.id === r1); if (!b) throw err('NOT_FOUND', '单据不存在')
      if (!b.editable) throw err('BILL_NOT_EDITABLE', '单据不可修改', { status: b.status, reasons: notEditableReasons(b) })
      applyBillUpdate(b, q)
      recompute(b); recheckEditable(b); return b
    }
    if (r1) { const b0 = D.salesBills.find((x) => x.id === r1); if (!b0) throw err('NOT_FOUND', '单据不存在'); return b0 }
    return paginate(filterBills(q), q)
  }

  /* ===== 采购单（★ 后端暂无此接口，示例数据） ===== */
  if (r0 === 'purchases') {
    if (r1) {
      const p = D.purchaseBills.find((x) => x.id === r1)
      if (!p) throw err('NOT_FOUND', '采购单不存在')
      return p
    }
    return paginate(filterPurchases(q), q)
  }
  if (r0 === 'suppliers') return D.suppliers

  /* ===== 库存 ===== */
  if (r0 === 'inventory') return paginate(filterInventory(q), q)

  /* ===== 取价（对齐真实后端 GET /price） ===== */
  if (r0 === 'price') {
    const cust = D.customers.find((c) => c.id === (q.customerId || q.customer))
    const prod = D.products.find((p) => p.id === (q.productId || q.hpbh))
    return resolvePriceMock(cust, prod, q.unit)
  }

  /* ===== 应收 ===== */
  if (r0 === 'receivables') {
    if (r1 === 'summary') return D.receivablesSummary()
    return D.receivablesSummary().list
  }

  /* ===== 看板 ===== */
  if (r0 === 'dashboard') return D.dashboard()

  /* ===== 报表 =====
   * ★ 路径严格对齐线上 business.py，避免「mock 能跑、真实 404」：
   *   /reports/sales-summary          /reports/sales-trend
   *   /reports/customer-ranking       /reports/product-ranking
   *   /reports/receivables/summary    /reports/customer-statement
   *   /reports/customer-product-detail
   * 月度趋势 = sales-trend + granularity=month（后端无独立 monthly-trend）。
   */
  if (r0 === 'reports') {
    if (r1 === 'sales-summary') return D.salesSummary()
    if (r1 === 'sales-trend') {
      return (q.granularity === 'month') ? D.monthlyTrend() : D.salesTrend()
    }
    if (r1 === 'customer-ranking') return D.customerRanking(Number(q.limit) || 5)
    if (r1 === 'product-ranking') return D.productRanking(Number(q.limit) || 5)
    // 应收汇总：真实路径带斜杠
    if (r1 === 'receivables' && r2 === 'summary') return D.receivablesSummary()
    // 往来对账
    if (r1 === 'customer-statement') {
      return D.customerStatementDetail(q.customerId, q.startDate, q.endDate)
    }
    // 客户货品明细
    if (r1 === 'customer-product-detail') return D.customerProductSummary(q.customerId)
  }

  /* ===== 打印（对齐真实后端 POST /print/salesbill） ===== */
  if (r0 === 'print') {
    if (r1 === 'formats') {
      if (r2) { const f0 = D.printFormats.find((f) => f.id === r2); if (!f0) throw err('NOT_FOUND', '格式不存在'); return f0 }
      return D.printFormats.filter((f) => !q.billType || f.billType === q.billType)
    }
    if (r1 === 'printers') return D.printers
    if (r1 === 'salesbill' && method === 'POST') {
      return { ok: true, billNo: q.billNo, mode: q.mode || 'system', copies: q.copies || 1, message: '已提交到打印队列' }
    }
    if (r1 === 'sales-bills' && r2 && method === 'POST') {
      return { success: true, previewUrl: 'mock://preview/' + r2, message: '已发送至打印' }
    }
  }

  throw err('NOT_FOUND', '未实现的 Mock 路由: ' + method + ' /' + seg.join('/'))
}

/* ============ 过滤 / 分页 ============ */
function filterProducts(q) {
  let arr = [...D.products]
  if (q.keyword) {
    const k = String(q.keyword).toLowerCase()
    arr = arr.filter((p) => p.name.toLowerCase().includes(k) || p.code.toLowerCase().includes(k))
  }
  if (q.barcode) arr = arr.filter((p) => p.barcode === q.barcode)
  if (q.category) arr = arr.filter((p) => p.category === q.category)
  return arr
}
function filterCustomers(q) {
  let arr = [...D.customers]
  if (q.keyword) {
    const k = String(q.keyword).toLowerCase()
    arr = arr.filter((c) => c.name.toLowerCase().includes(k) || c.code.toLowerCase().includes(k) || (c.mobile || '').includes(k))
  }
  if (q.type) arr = arr.filter((c) => c.type === q.type)
  return arr
}
function filterBills(q) {
  let arr = [...D.salesBills]
  if (q.status) arr = arr.filter((b) => b.status === q.status)
  if (q.customerId) arr = arr.filter((b) => b.customerId === q.customerId)
  if (q.from) arr = arr.filter((b) => b.billDate >= q.from)
  if (q.to) arr = arr.filter((b) => b.billDate <= q.to)
  if (q.keyword) {
    const k = String(q.keyword).toLowerCase()
    arr = arr.filter((b) => b.billNo.toLowerCase().includes(k) || b.customerName.toLowerCase().includes(k))
  }
  return arr.sort((a, b) => b.billDate.localeCompare(a.billDate) || b.billNo.localeCompare(a.billNo))
}
function filterInventory(q) {
  let arr = [...D.inventory]
  if (q.keyword) {
    const k = String(q.keyword).toLowerCase()
    arr = arr.filter((i) => i.name.toLowerCase().includes(k) || i.code.toLowerCase().includes(k))
  }
  if (q.warehouse) arr = arr.filter((i) => i.warehouse === q.warehouse)
  return arr
}
function filterPurchases(q) {
  let arr = [...D.purchaseBills]
  // ★ 真实接口的参数名是 `state`（pending|audited|void），
  //   而 mock 数据里的状态写的是旧的 'received'。
  //   api/purchase.js 为了兼容会同时发 state 和 status，
  //   这里统一归一化，否则 USE_MOCK=true 时「已审核」标签永远查不到数据。
  const st = q.state || q.status
  if (st) arr = arr.filter((p) => normPurchaseStatus(p.status) === st)
  if (q.supplierId) arr = arr.filter((p) => p.supplierId === q.supplierId)
  if (q.from) arr = arr.filter((p) => p.billDate >= q.from)
  if (q.to) arr = arr.filter((p) => p.billDate <= q.to)
  if (q.keyword) {
    const k = String(q.keyword).toLowerCase()
    arr = arr.filter((p) => p.billNo.toLowerCase().includes(k) || p.supplierName.toLowerCase().includes(k))
  }
  return arr.sort((a, b) => b.billDate.localeCompare(a.billDate) || b.billNo.localeCompare(a.billNo))
}

function normPurchaseStatus(s) {
  if (s === 'received') return 'audited'
  if (s === 'audited' || s === 'void') return s
  return 'pending'
}
/**
 * 商品/客户的 mock 分页 —— 对齐真实后端的新契约：
 *   入参 limit + offset（同时容忍 page/pageSize 的老写法）
 *   出参 {items, total, limit, offset, hasMore}
 * ★ 真实后端 product.search / customer.search 就是这么返回的，
 *   mock 必须一致，否则 USE_MOCK=true 时页面逻辑会走偏。
 */
function paginateList(arr, q) {
  const size = Number(q.limit ?? q.pageSize) || 20
  const offset = q.offset !== undefined
    ? Math.max(0, Number(q.offset) || 0)
    : Math.max(0, ((Number(q.page) || 1) - 1) * size)
  const items = arr.slice(offset, offset + size)
  return {
    items,
    total: arr.length,
    limit: size,
    offset,
    hasMore: offset + items.length < arr.length,
  }
}

/** 老的分页形状（销售单等仍按 {list,total,page,pageSize} 返回，保持不变） */
function paginate(arr, q) {
  const page = Number(q.page) || 1, size = Number(q.pageSize) || 20
  const start = (page - 1) * size
  return { list: arr.slice(start, start + size), total: arr.length, page, pageSize: size }
}

/* ============ 取价（三级回退） ============
 * ★ 复用 utils/price.js 的单一实现，避免与页面取价结果不一致。
 * 补充 rate / recent 字段以对齐真实后端 price.resolve 返回结构。
 */
function resolvePriceMock(cust, prod, unit) {
  if (!prod) throw err('NOT_FOUND', '商品不存在')
  const r = resolvePrice(cust, prod, unit)
  // 换算率：从多单位档案取，缺省 1
  let rate = 1
  if (unit && Array.isArray(prod.units)) {
    const u = prod.units.find((x) => x.unit === unit)
    if (u && u.ratio) rate = u.ratio
  }
  return {
    price: r.price,
    source: r.source,
    unit: unit || prod.baseUnit,
    rate,
    recent: r.source === 'recent' ? (prod.recentSaleRef || null) : null,
    manual: r.manual,
  }
}

/* ============ 单据辅助 ============ */
function createBill(q) {
  const cust = D.customers.find((c) => c.id === q.customerId) || {}
  const items = (q.items || []).map((it) => {
    const p = D.products.find((x) => x.id === it.productId) || {}
    const amt = Math.round((it.qty * it.price) * 100) / 100
    return { productId: it.productId, name: p.name || it.name, spec: p.spec || it.spec, unit: it.unit || p.baseUnit, qty: it.qty, price: it.price, amount: amt, barcode: p.barcode }
  })
  const totalAmount = Math.round(items.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0)
  const id = 'B' + String(D.salesBills.length + 1).padStart(3, '0')
  const billNo = 'XK' + String(_billSeq++).padStart(8, '0')
  const today = new Date(); const p = (x) => String(x).padStart(2, '0')
  const billDate = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  return {
    id, billNo, billDate, customerId: q.customerId, customerName: cust.name,
    status: 'unapproved', memo: q.memo || '', items, totalAmount, totalQty,
    editable: true, hasPayment: false, hasShipment: false, hasReconcile: false, hasLinkage: false,
    createdBy: '陈老板', createdAt: billDate + ' ' + p(today.getHours()) + ':' + p(today.getMinutes()),
  }
}
function recompute(b) {
  b.totalAmount = Math.round(b.items.reduce((s, it) => s + (it.qty * it.price), 0) * 100) / 100
  b.totalQty = b.items.reduce((s, it) => s + Number(it.qty || 0), 0)
}

/**
 * 应用销售单修改。
 * ★ 对齐真实后端 salesbill.update 的语义：提交的是「最终完整行集合」——
 *   带 iden_guid 的行保留/修改，不带的算新增，原单有但未提交的行会被删除。
 * 这里同时兼容页面直接传 items 的旧写法。
 */
function applyBillUpdate(b, q) {
  // 表头字段
  const header = q.header || {}
  if (q.billDate || header.NDate) b.billDate = q.billDate || header.NDate
  if (q.customerId || header.ItemBh) {
    b.customerId = q.customerId || header.ItemBh
    const c = D.customers.find((x) => x.id === b.customerId)
    if (c) b.customerName = c.name
  }
  if (q.memo !== undefined || header.BZ_XS !== undefined) {
    b.memo = q.memo !== undefined ? q.memo : header.BZ_XS
  }

  // 明细行：后端 schema（lines + hpbh/iden_guid）与页面 schema（items + productId）都支持
  const incoming = q.lines || q.items
  if (Array.isArray(incoming)) {
    const oldById = {}
    b.items.forEach((it) => { if (it.idenGuid) oldById[it.idenGuid] = it })

    b.items = incoming.map((line) => {
      const pid = line.hpbh || line.productId
      const p = D.products.find((x) => x.id === pid) || {}
      const prev = line.iden_guid && oldById[line.iden_guid] ? oldById[line.iden_guid] : {}
      const qty = Number(line.qty || 0)
      const price = Number(line.price ?? prev.price ?? p.salePriceDefault ?? 0)
      return {
        idenGuid: line.iden_guid || prev.idenGuid || 'G' + Date.now() + Math.random().toString(36).slice(2, 7),
        productId: pid,
        name: prev.name || p.name || line.name || pid,
        spec: prev.spec || p.spec || line.spec || '',
        unit: line.unit || prev.unit || p.baseUnit || '',
        qty, price,
        amount: Math.round(qty * price * 100) / 100,
        barcode: p.barcode,
      }
    })
    recheckEditable(b)
  }
}
function notEditableReasons(b) {
  const r = []
  if (b.status === 'approved') r.push('单据已审核')
  if (b.hasPayment) r.push('已关联收款')
  if (b.hasShipment) r.push('已发货')
  if (b.hasReconcile) r.push('已对账')
  if (b.hasLinkage) r.push('已关联其他单据')
  return r
}
function recheckEditable(b) {
  b.editable = b.status === 'unapproved' && !b.hasPayment && !b.hasShipment && !b.hasReconcile && !b.hasLinkage
}

/* ============ 报表辅助 ============ */
function customerStatement(q) {
  const bills = D.salesBills.filter((b) => b.customerId === q.customerId && (!q.from || b.billDate >= q.from) && (!q.to || b.billDate <= q.to))
  const cust = D.customers.find((c) => c.id === q.customerId) || {}
  return {
    customerName: cust.name, receivable: cust.receivable,
    bills: bills.map((b) => ({ billNo: b.billNo, billDate: b.billDate, amount: b.totalAmount, paid: 0, unpaid: b.totalAmount })),
    total: Math.round(bills.reduce((s, b) => s + b.totalAmount, 0) * 100) / 100,
  }
}
function customerProductDetail(q) {
  const bills = D.salesBills.filter((b) => b.customerId === q.customerId)
  const rows = []
  bills.forEach((b) => b.items.forEach((it) => rows.push({ billNo: b.billNo, billDate: b.billDate, productName: it.name, qty: it.qty, price: it.price, amount: it.amount })))
  return rows
}

/* ============ 错误辅助 ============ */
function err(code, message, detail) {
  const e = new Error(message); e.mockError = true; e.code = code; e.detail = detail; return e
}
