/**
 * 示例数据（Mock）
 * 商品名取自会话真实场景：进口砂纸、定做弹簧等。
 * 含多店、未审核/已审核、负库存、应收、取价策略等演示态。
 */

const today = new Date()
const d = (offset) => {
  const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
  const p = (x) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

/* ============ 店铺 ============
 * 对齐真实后端 /api/v1/auth/login 返回的 stores 结构：
 * { name, title, agent, online }  —— X-Store 头传 name
 */
export const stores = [
  { name: 'shiwantongda-小程序', title: '石湾同达总店', agent: 'shiwantongda', online: true },
  { name: 'shiwantongda-分店', title: '石湾同达分店', agent: 'shiwantongda', online: true },
]

/* ============ 用户 ============ */
export const users = [
  { id: 'U001', name: '陈老板', role: 'owner' },
]

/* ============ 客户类别 ============ */
export const customerTypes = [
  { id: 'T1', name: '批发客户' },
  { id: 'T2', name: '零售客户' },
  { id: 'T3', name: '工程客户' },
  { id: 'T4', name: 'VIP客户' },
]

/* ============ 商品 ============ */
export const products = [
  { id: 'P001', code: 'SP320', barcode: '6901234500001', name: '进口砂纸320', spec: '230×280mm', category: '砂纸类', baseUnit: '张',
    units: [{ unit: '张', ratio: 1, salePrice: 1.50, purchasePrice: 0.80 }, { unit: '包', ratio: 50, salePrice: 70, purchasePrice: 38 }],
    salePriceDefault: 1.50, purchasePrice: 0.80, costPrice: 0.85, barcodeType: 9, status: '在售', recentSalePrice: 1.40 },
  { id: 'P002', code: 'SP600', barcode: '6901234500002', name: '进口砂纸600', spec: '230×280mm', category: '砂纸类', baseUnit: '张',
    units: [{ unit: '张', ratio: 1, salePrice: 2.00, purchasePrice: 1.10 }],
    salePriceDefault: 2.00, purchasePrice: 1.10, costPrice: 1.15, barcodeType: 9, status: '在售', recentSalePrice: 1.90 },
  { id: 'P003', code: 'TH2935', barcode: '6901234500003', name: '定做弹簧29*35', spec: '29×35mm', category: '弹簧类', baseUnit: '支',
    units: [{ unit: '支', ratio: 1, salePrice: 3.50, purchasePrice: 2.00 }],
    salePriceDefault: 3.50, purchasePrice: 2.00, costPrice: 2.10, barcodeType: 9, status: '在售', recentSalePrice: 3.50 },
  { id: 'P004', code: 'TH4050', barcode: '6901234500004', name: '定做弹簧40*50', spec: '40×50mm', category: '弹簧类', baseUnit: '支',
    units: [{ unit: '支', ratio: 1, salePrice: 5.00, purchasePrice: 3.00 }],
    salePriceDefault: 5.00, purchasePrice: 3.00, costPrice: 3.10, barcodeType: 9, status: '在售', recentSalePrice: 4.80 },
  { id: 'P005', code: 'BJ100', barcode: '6901234500005', name: '不锈钢边角100', spec: '100cm', category: '五金类', baseUnit: '条',
    units: [{ unit: '条', ratio: 1, salePrice: 25.00, purchasePrice: 18.00 }],
    salePriceDefault: 25.00, purchasePrice: 18.00, costPrice: 18.50, barcodeType: 9, status: '在售', recentSalePrice: 24.00 },
  { id: 'P006', code: 'GM002', barcode: '6901234500006', name: '高密度海绵002', spec: '50×50×5cm', category: '海绵类', baseUnit: '块',
    units: [{ unit: '块', ratio: 1, salePrice: 12.00, purchasePrice: 7.00 }],
    salePriceDefault: 12.00, purchasePrice: 7.00, costPrice: 7.20, barcodeType: 9, status: '在售', recentSalePrice: 11.50 },
  { id: 'P007', code: 'MZ001', barcode: '6901234500007', name: '实木木板001', spec: '120×60×2cm', category: '板材类', baseUnit: '块',
    units: [{ unit: '块', ratio: 1, salePrice: 85.00, purchasePrice: 60.00 }],
    salePriceDefault: 85.00, purchasePrice: 60.00, costPrice: 62.00, barcodeType: 9, status: '在售', recentSalePrice: 82.00 },
  { id: 'P008', code: 'SL005', barcode: '6901234500008', name: '塑料封边条005', spec: '宽22mm', category: '配件类', baseUnit: '米',
    units: [{ unit: '米', ratio: 1, salePrice: 2.50, purchasePrice: 1.20 }],
    salePriceDefault: 2.50, purchasePrice: 1.20, costPrice: 1.30, barcodeType: 9, status: '在售', recentSalePrice: 2.50 },
  { id: 'P009', code: 'GL002', barcode: '6901234500009', name: '万能胶002', spec: '500ml', category: '辅料类', baseUnit: '瓶',
    units: [{ unit: '瓶', ratio: 1, salePrice: 18.00, purchasePrice: 11.00 }],
    salePriceDefault: 18.00, purchasePrice: 11.00, costPrice: 11.50, barcodeType: 9, status: '在售', recentSalePrice: 17.00 },
  { id: 'P010', code: 'KD030', barcode: '6901234500010', name: '定制卡扣030', spec: '30mm', category: '配件类', baseUnit: '个',
    units: [{ unit: '个', ratio: 1, salePrice: 0.80, purchasePrice: 0.30 }],
    salePriceDefault: 0.80, purchasePrice: 0.30, costPrice: 0.32, barcodeType: 9, status: '在售', recentSalePrice: 0.75 },
  { id: 'P011', code: 'BV015', barcode: '6901234500011', name: '包边条015', spec: '宽15mm', category: '配件类', baseUnit: '米',
    units: [{ unit: '米', ratio: 1, salePrice: 3.00, purchasePrice: 1.50 }],
    salePriceDefault: 3.00, purchasePrice: 1.50, costPrice: 1.55, barcodeType: 9, status: '在售', recentSalePrice: 2.90 },
  { id: 'P012', code: 'JG050', barcode: '6901234500012', name: '角铁支架050', spec: '50×50mm', category: '五金类', baseUnit: '个',
    units: [{ unit: '个', ratio: 1, salePrice: 8.00, purchasePrice: 4.50 }],
    salePriceDefault: 8.00, purchasePrice: 4.50, costPrice: 4.60, barcodeType: 9, status: '停售', recentSalePrice: 7.50 },
]

/* ============ 客户 ============ */
export const customers = [
  { id: 'C001', code: 'KH001', name: '顺德家具厂', type: '批发客户', typeId: 'T1', contact: '黄生', phone: '0757-28812001', mobile: '13800138001', address: '佛山市顺德区龙江镇', priceTrace: 201, receivable: 12580.50, cumulativeSales: 286500.00, status: '正常' },
  { id: 'C002', code: 'KH002', name: '南海装饰公司', type: '工程客户', typeId: 'T3', contact: '李小姐', phone: '0757-86612002', mobile: '13800138002', address: '佛山市南海区桂城', priceTrace: 0, receivable: 8200.00, cumulativeSales: 158000.00, status: '正常' },
  { id: 'C003', code: 'KH003', name: '广州恒达家居', type: 'VIP客户', typeId: 'T4', contact: '张总', phone: '020-87654321', mobile: '13900139003', address: '广州市番禺区大石', priceTrace: 201, receivable: 0, cumulativeSales: 520000.00, status: '正常' },
  { id: 'C004', code: 'KH004', name: '禅城老王五金店', type: '零售客户', typeId: 'T2', contact: '王叔', phone: '0757-82312004', mobile: '13700137004', address: '佛山市禅城区祖庙路', priceTrace: 0, receivable: 350.00, cumulativeSales: 28600.00, status: '正常' },
  { id: 'C005', code: 'KH005', name: '中山板芙家具', type: '批发客户', typeId: 'T1', contact: '刘生', phone: '0760-88612005', mobile: '13600136005', address: '中山市板芙镇', priceTrace: 201, receivable: 6780.00, cumulativeSales: 198000.00, status: '正常' },
  { id: 'C006', code: 'KH006', name: '东莞大岭山木业', type: '工程客户', typeId: 'T3', contact: '陈工', phone: '0769-85612006', mobile: '13500135006', address: '东莞市大岭山镇', priceTrace: 0, receivable: 15200.00, cumulativeSales: 365000.00, status: '正常' },
  { id: 'C007', code: 'KH007', name: '江门新会沙发厂', type: '批发客户', typeId: 'T1', contact: '赵生', phone: '0750-66612007', mobile: '13400134007', address: '江门市新会区会城', priceTrace: 201, receivable: 4200.00, cumulativeSales: 132000.00, status: '正常' },
  { id: 'C008', code: 'KH008', name: '肇庆端州装修队', type: '零售客户', typeId: 'T2', contact: '周师傅', phone: '0758-22312008', mobile: '13300133008', address: '肇庆市端州区', priceTrace: 0, receivable: 0, cumulativeSales: 18500.00, status: '正常' },
]

/* ============ 销售单 ============ */
function bill(id, billNo, dayOffset, custId, status, items, memo = '', flags = {}) {
  const cust = customers.find((c) => c.id === custId)
  let totalAmount = 0, totalQty = 0
  const fullItems = items.map(([pid, qty, price]) => {
    const p = products.find((x) => x.id === pid)
    const amt = Math.round(qty * price * 100) / 100
    totalAmount += amt; totalQty += qty
    return { productId: pid, name: p.name, spec: p.spec, unit: p.baseUnit, qty, price, amount: amt, barcode: p.barcode }
  })
  return {
    id, billNo, billDate: d(dayOffset), customerId: custId, customerName: cust.name,
    status, memo, items: fullItems,
    totalAmount: Math.round(totalAmount * 100) / 100, totalQty,
    editable: status === 'unapproved' && !flags.hasPayment && !flags.hasShipment && !flags.hasReconcile && !flags.hasLinkage,
    hasPayment: !!flags.hasPayment, hasShipment: !!flags.hasShipment,
    hasReconcile: !!flags.hasReconcile, hasLinkage: !!flags.hasLinkage,
    createdBy: '陈老板', createdAt: d(dayOffset) + ' 09:30',
  }
}

export const salesBills = [
  bill('B001', 'XK00000056', 0,  'C001', 'unapproved', [['P001', 200, 1.40], ['P003', 15, 3.50]], '加急出货'),
  bill('B002', 'XK00000055', 0,  'C003', 'approved',   [['P007', 6, 82.00], ['P006', 10, 11.50]], '', { hasPayment: true }),
  bill('B003', 'XK00000054', -1, 'C005', 'approved',   [['P003', 80, 3.50], ['P004', 30, 4.80]]),
  bill('B004', 'XK00000053', -1, 'C002', 'unapproved', [['P005', 12, 24.00], ['P012', 20, 7.50]], '工程用'),
  bill('B005', 'XK00000052', -2, 'C006', 'approved',   [['P007', 10, 82.00], ['P008', 100, 2.50]], '', { hasShipment: true }),
  bill('B006', 'XK00000051', -2, 'C001', 'approved',   [['P001', 500, 1.40], ['P002', 200, 1.90]], '', { hasPayment: true, hasReconcile: true }),
  bill('B007', 'XK00000050', -3, 'C007', 'unapproved', [['P006', 20, 11.50]]),
  bill('B008', 'XK00000049', -3, 'C004', 'approved',   [['P010', 200, 0.75], ['P008', 30, 2.50]]),
  bill('B009', 'XK00000048', -4, 'C003', 'approved',   [['P003', 100, 3.50], ['P004', 50, 4.80], ['P005', 8, 24.00]], 'VIP客户'),
  bill('B010', 'XK00000047', -5, 'C005', 'approved',   [['P001', 300, 1.40]]),
  bill('B011', 'XK00000046', -6, 'C002', 'approved',   [['P011', 200, 2.90], ['P009', 10, 17.00]], '', { hasLinkage: true }),
  bill('B012', 'XK00000045', -7, 'C006', 'approved',   [['P007', 4, 82.00]]),
  bill('B013', 'XK00000044', -8, 'C001', 'approved',   [['P003', 60, 3.50], ['P006', 15, 11.50]]),
  bill('B014', 'XK00000043', -9, 'C008', 'unapproved', [['P010', 100, 0.75]]),
  bill('B015', 'XK00000042', -10,'C007', 'approved',   [['P006', 25, 11.50], ['P008', 80, 2.50]]),
]

/* ============ 库存（含负库存演示） ============ */
export const inventory = products.map((p) => ({
  productId: p.id, code: p.code, name: p.name, spec: p.spec, unit: p.baseUnit,
  qty: Math.round((Math.sin(p.id.charCodeAt(2) * 1.3) * 300 + 150)),
  warehouse: '主仓库',
})).map((it, i) => {
  // 制造两个负库存
  if (i === 1) it.qty = -25
  if (i === 9) it.qty = -8
  return it
})

/* ============ 看板 ============ */
export function dashboard() {
  const monthBills = salesBills // 简化：全算当月
  const monthRevenue = monthBills.reduce((s, b) => s + b.totalAmount, 0)
  const todayList = salesBills.filter((b) => b.billDate === d(0))
  const todayBills = todayList.length
  const todayRevenue = Math.round(todayList.reduce((s, b) => s + b.totalAmount, 0) * 100) / 100
  const pending = salesBills.filter((b) => b.status === 'unapproved').length
  const pendingAmount = Math.round(
    salesBills.filter((b) => b.status === 'unapproved').reduce((s, b) => s + b.totalAmount, 0) * 100
  ) / 100
  const debtors = customers.filter((c) => c.receivable > 0)
  const receivableTotal = Math.round(debtors.reduce((s, c) => s + c.receivable, 0) * 100) / 100
  return {
    monthRevenue: Math.round(monthRevenue * 100) / 100,
    monthBillCount: monthBills.length,
    monthDelta: 18.6,          // 环比上月（示例）
    todayRevenue,
    todayBills,
    pending,
    pendingAmount,
    receivableTotal,
    receivableCount: debtors.length,
    avgBill: Math.round((monthRevenue / monthBills.length) * 100) / 100,
  }
}

/* ============ 报表 ============ */
export function salesSummary() {
  const total = salesBills.reduce((s, b) => s + b.totalAmount, 0)
  return {
    totalAmount: Math.round(total * 100) / 100,
    billCount: salesBills.length,
    avgBill: Math.round((total / salesBills.length) * 100) / 100,
    totalQty: salesBills.reduce((s, b) => s + b.totalQty, 0),
  }
}

export function salesTrend() {
  // 近 7 天趋势
  const arr = []
  for (let i = -6; i <= 0; i++) {
    const day = d(i)
    const bs = salesBills.filter((b) => b.billDate === day)
    arr.push({ date: day, amount: Math.round(bs.reduce((s, b) => s + b.totalAmount, 0) * 100) / 100, count: bs.length })
  }
  return arr
}

export function customerRanking(limit = 5) {
  return [...customers]
    .sort((a, b) => b.cumulativeSales - a.cumulativeSales)
    .slice(0, limit)
    .map((c, i) => ({ rank: i + 1, customerId: c.id, customerName: c.name, amount: c.cumulativeSales }))
}

export function productRanking(limit = 5) {
  const map = {}
  salesBills.forEach((b) => b.items.forEach((it) => {
    map[it.name] = (map[it.name] || 0) + it.amount
  }))
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, amount], i) => ({ rank: i + 1, productName: name, amount: Math.round(amount * 100) / 100 }))
}

export function receivablesSummary() {
  const list = customers.filter((c) => c.receivable > 0).map((c) => ({
    customerId: c.id, customerName: c.name, balance: c.receivable, overdue: c.receivable > 10000 ? c.receivable * 0.3 : 0,
  }))
  return {
    total: Math.round(list.reduce((s, r) => s + r.balance, 0) * 100) / 100,
    overdue: Math.round(list.reduce((s, r) => s + r.overdue, 0) * 100) / 100,
    count: list.length,
    list,
  }
}

/* ============ 报表增强（首页/报表页图表用） ============ */

/** 近 12 个月销售额，用于月度趋势（示例数据） */
export function monthlyTrend() {
  const out = []
  const now = new Date()
  // 用一个稳定的波形，避免每次刷新数值跳变
  const wave = [0.62, 0.71, 0.58, 0.83, 0.76, 0.91, 0.68, 0.87, 0.95, 0.79, 0.88, 1.0]
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const p = (x) => String(x).padStart(2, '0')
    out.push({
      month: `${dt.getFullYear()}-${p(dt.getMonth() + 1)}`,
      label: `${dt.getMonth() + 1}月`,
      amount: Math.round(186000 * wave[11 - i]),
    })
  }
  return out
}

/** 客户货品明细汇总（按商品聚合） */
export function customerProductSummary(customerId) {
  const bills = salesBills.filter((b) => !customerId || b.customerId === customerId)
  const map = {}
  bills.forEach((b) => b.items.forEach((it) => {
    const k = it.productId
    if (!map[k]) {
      map[k] = { productId: k, productName: it.name, spec: it.spec, unit: it.unit, quantity: 0, amount: 0, billCount: 0 }
    }
    map[k].quantity += it.qty
    map[k].amount += it.amount
    map[k].billCount += 1
  }))
  const items = Object.values(map)
    .map((x) => ({ ...x, amount: Math.round(x.amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)
  return {
    summary: {
      productCount: items.length,
      totalQuantity: items.reduce((s, x) => s + x.quantity, 0),
      totalAmount: Math.round(items.reduce((s, x) => s + x.amount, 0) * 100) / 100,
    },
    items,
  }
}

/** 往来对账：期初 / 本期销售 / 本期收款 / 期末 + 流水 */
export function customerStatementDetail(customerId, from, to) {
  const cust = customers.find((c) => c.id === customerId) || {}
  const inRange = salesBills.filter(
    (b) => b.customerId === customerId && (!from || b.billDate >= from) && (!to || b.billDate <= to)
  )
  const salesAmount = Math.round(inRange.reduce((s, b) => s + b.totalAmount, 0) * 100) / 100
  // 示例：按销售额的 70% 模拟已收款
  const paymentAmount = Math.round(salesAmount * 0.7 * 100) / 100
  const closingBalance = cust.receivable || 0
  const openingBalance = Math.round((closingBalance - salesAmount + paymentAmount) * 100) / 100

  const items = []
  inRange
    .slice()
    .sort((a, b) => a.billDate.localeCompare(b.billDate))
    .forEach((b) => {
      items.push({
        billNo: b.billNo, date: b.billDate, typeName: '销售出库',
        description: `${b.customerName} · ${b.items.length} 种商品`,
        debit: b.totalAmount, credit: 0,
      })
    })

  // 期末余额自后向前回推，保证余额列自洽
  let running = closingBalance
  const revItems = items.slice().reverse().map((it) => {
    const row = { ...it, balance: Math.round(running * 100) / 100 }
    running = running - it.debit + it.credit
    return row
  })

  return {
    customerName: cust.name,
    summary: { openingBalance, salesAmount, paymentAmount, closingBalance },
    items: revItems.reverse(),
  }
}

/* ============ 供应商（后端未提供采购接口，此处为示例数据） ============ */
export const suppliers = [
  { id: 'S001', name: '佛山磨料磨具厂', contact: '梁生', phone: '0757-83221001', address: '佛山市南海区狮山镇' },
  { id: 'S002', name: '东莞弹簧五金', contact: '吴小姐', phone: '0769-86112002', address: '东莞市长安镇' },
  { id: 'S003', name: '中山不锈钢材料', contact: '郑生', phone: '0760-88773003', address: '中山市小榄镇' },
  { id: 'S004', name: '广州化工辅料商行', contact: '冯经理', phone: '020-81334004', address: '广州市白云区' },
]

/* ============ 采购单（★ 后端无采购接口，全部为示例数据） ============ */
function purchase(id, billNo, dayOffset, supId, status, items, memo = '') {
  const sup = suppliers.find((s) => s.id === supId)
  let totalAmount = 0, totalQty = 0
  const fullItems = items.map(([pid, qty, price]) => {
    const p = products.find((x) => x.id === pid)
    const amt = Math.round(qty * price * 100) / 100
    totalAmount += amt; totalQty += qty
    return { productId: pid, name: p.name, spec: p.spec, unit: p.baseUnit, qty, price, amount: amt }
  })
  return {
    id, billNo, billDate: d(dayOffset), supplierId: supId, supplierName: sup.name,
    status, memo, items: fullItems,
    totalAmount: Math.round(totalAmount * 100) / 100, totalQty,
    warehouse: '主仓库', createdBy: '陈老板', createdAt: d(dayOffset) + ' 10:15',
  }
}

export const purchaseBills = [
  purchase('PO01', 'CG00000031', 0,   'S001', 'pending',  [['P001', 2000, 0.80], ['P002', 1000, 1.10]], '月初备货'),
  purchase('PO02', 'CG00000030', -1,  'S002', 'received', [['P003', 500, 2.00], ['P004', 300, 3.00]]),
  purchase('PO03', 'CG00000029', -2,  'S003', 'received', [['P005', 60, 18.00], ['P012', 100, 4.50]], '工程补料'),
  purchase('PO04', 'CG00000028', -3,  'S001', 'pending',  [['P006', 200, 7.00]]),
  purchase('PO05', 'CG00000027', -4,  'S004', 'received', [['P009', 80, 11.00], ['P008', 500, 1.20]]),
  purchase('PO06', 'CG00000026', -5,  'S002', 'received', [['P003', 800, 2.00]]),
  purchase('PO07', 'CG00000025', -7,  'S003', 'pending',  [['P007', 40, 60.00]], '大板预计周内到货'),
  purchase('PO08', 'CG00000024', -9,  'S001', 'received', [['P001', 3000, 0.78], ['P010', 2000, 0.30]]),
]

/* ============ 打印 ============ */
export const printFormats = [
  { id: 'F1', name: '销售出货单(四联)', billType: 'sales', desc: 'A4竖版 白红蓝黄四联' },
  { id: 'F2', name: '条码打印(86*32双列)1365', billType: 'sales', desc: '96×32mm双列 Code128' },
  { id: 'F3', name: '销售出货(批量打印)', billType: 'sales', desc: '批量出库汇总' },
  { id: 'F4', name: '销售出货单(右边打印第一联第二联)', billType: 'sales', desc: 'A4竖版右侧竖排双联' },
  { id: 'F5', name: '销售出货单(折后价)', billType: 'sales', desc: '显示折后价' },
  { id: 'F6', name: '送货标签', billType: 'sales', desc: '送货标签贴纸' },
]

export const printers = [
  { id: 'PR1', name: 'HP LaserJet Pro M404 (默认)', isDefault: true },
  { id: 'PR2', name: 'Brother QL-820NWB 标签机', isDefault: false },
]

/* ============ 能力 ============ */
export const capabilities = {
  agentOnline: true,
  ops: 29,
  rest: true,
  // ★ printers 是**台数**；打印页读的是 printerList / defaultPrinter。
  //   形状与 toCapabilities 归一后的结果一致（真实 Agent 的字段叫 printerName）。
  printers: printers.length,
  printerList: printers.map((p) => ({
    name: p.name,
    hostName: 'MOCK-PC',
    copies: 0,
    knife: false,
    isDefault: !!p.isDefault,
  })),
  defaultPrinter: (printers.filter((p) => p.isDefault)[0] || {}).name || '',
  printerHost: { hostName: 'MOCK-PC', matchedHost: 'MOCK-PC', note: '' },
  billFormats: printFormats.length,
  dbStatus: 'healthy',
  version: '1.0.0-mock',
}
