/**
 * 数据适配层
 *
 * 真实后端（V3 Agent / 云端 REST）字段与页面期望形状不一致，统一在这里转换。
 * 好处：页面只认一种字段名，后端字段变化只改这一个文件。
 *
 * 真实销售单列表项：{ bill_no, use_no, ndate, customer:{code,name}, is_auditing, bill_state, amount, qty }
 * 真实销售单详情：  { bill_no, use_no, ndate, bz_xs, customer, warehouse, is_auditing,
 *                    totals:{amount, amount_hs, qty}, lines[], editable, editable_reasons[] }
 */
import { avgMoney, mulMoney, sumMoney } from './money'

/** 未审核/已审核/已作废状态枚举（页面内部统一用字符串）
 *
 * ★★★ 2026-09-20 纠正：`is_ok`（V3 的 ISOK）**不是作废位**！
 *     ISOK=1 正式单 / ISOK=0 草稿单，两者都还是「未审核」；
 *     作废时 ISOK 置 0 并写 UserVoid + TimeVoid。
 *     旧代码只看 is_auditing，作废单会显示成「未审核」**且可编辑**。
 *     现在：优先吃后端 `status`（Agent 已按新口径收敛），
 *     老 exe 无 status 时退回「作废痕迹」判 void —— 绝不用 is_ok。
 */
export const STATUS = {
  UNAPPROVED: 'unapproved',
  APPROVED: 'approved',
  VOID: 'void',
}

/** 作废痕迹：UserVoid 有值 或 TimeVoid 非空 */
const hasVoidTrace = (raw) => {
  const uv = String(raw?.user_void ?? '').trim()
  const tv = raw?.time_void
  return uv !== '' || (tv !== undefined && tv !== null && tv !== '')
}

const toStatus = (raw) => {
  // 1) 后端新口径最优先 —— Agent 已按「作废痕迹 + IsAuditing」收敛好，
  //    直接采信，避免前端用 is_auditing 再推一遍推出不一致。
  const s = raw?.status
  if (s === STATUS.VOID || s === 'void') return STATUS.VOID
  if (s === STATUS.APPROVED || s === 'approved' || s === 'audited') return STATUS.APPROVED
  if (s === STATUS.UNAPPROVED || s === 'pending') return STATUS.UNAPPROVED
  // 2) 老 exe 没有可用的 status：按「作废痕迹」判 void（**不能看 is_ok**）
  if (hasVoidTrace(raw)) return STATUS.VOID
  if (typeof raw?.is_auditing !== 'undefined') {
    return raw.is_auditing ? STATUS.APPROVED : STATUS.UNAPPROVED
  }
  return STATUS.UNAPPROVED
}

/** 列表项：真实 {bill_no, ndate, customer, is_auditing, amount, qty} → 页面形状 */
export function toBillListItem(raw = {}) {
  if (!raw) return null
  // 已经是页面形状（mock 或已适配）则原样返回
  if (raw.billNo && !raw.bill_no) return raw
  const status = toStatus(raw)
  return {
    id: raw.bill_no || raw.id,
    billNo: raw.bill_no || raw.billNo || '',
    useNo: raw.use_no || '',
    billDate: String(raw.ndate || raw.billDate || '').slice(0, 10),
    customerCode: raw.customer?.code || raw.customerCode || '',
    customerName: raw.customer?.name || raw.customerName || '',
    status,
    totalAmount: num(raw.totals?.amount ?? raw.amount ?? raw.totalAmount),
    totalQty: num(raw.totals?.qty ?? raw.qty ?? raw.totalQty),
    // ★★ 2026-10-10 补：明细行数（「N 种」）。
    //   列表接口**不带明细数组**（性能契约）⇒ BillRow 里
    //   `items.length` 恒为 0，只有后端 `line_count` 一条路。
    //   采购侧早就透传了，销售侧漏了 ⇒ 出现「采购有几种几件、
    //   销售只有几件」的两页不一致。字段名与采购**逐字相同**。
    lineCount: num(raw.line_count ?? raw.lineCount),
    // ★ 草稿行（本地暂存）没有后端 line_count，但**有**完整 items
    //   —— 这里顺手补一次，免得页面各写一遍（销售/采购都受益）。
    //   注意只在后端没给 line_count 时才兜底，不覆盖真实值。
    ...((raw.line_count ?? raw.lineCount) === undefined && Array.isArray(raw.items)
      ? { lineCount: raw.items.length } : {}),
    // ★ 作废单恒不可改；其余沿用后端 editable，退回 is_auditing 判
    editable: status === STATUS.VOID
      ? false
      : (raw.editable !== undefined ? !!raw.editable : !raw.is_auditing),
  }
}

/**
 * 销售单列表：真实分页对象 → 页面形状
 *
 * ★ 真实响应有三种可能，都要吃下（离线缓存里可能还留着老形状的裸数组）：
 *   ① {items,total,limit,offset,hasMore} —— 2026-09-20 起的正式形状
 *   ② {list,total}                       —— 老形状
 *   ③ [...几行]                          —— 最老的裸数组（total 退化为本页条数）
 *   统一成 {list,total,hasMore}。
 *
 * ★★ 别在这个适配器上「看起来已经是页面形状就 return raw」——
 *    真实响应里的 `items` 和页面形状的 `list` 不同名，短路守卫会误判。
 */
export function toBillList(raw) {
  let arr = []
  let total = 0
  if (Array.isArray(raw)) {
    arr = raw
    total = raw.length
  } else if (raw && typeof raw === 'object') {
    arr = raw.items || raw.list || raw.rows || []
    total = Number(raw.total ?? raw.count ?? arr.length) || arr.length
  }
  const list = (Array.isArray(arr) ? arr : []).map(toBillListItem).filter(Boolean)
  return { list, total, hasMore: raw?.hasMore ?? list.length < total }
}

/** 详情：真实 {..., lines[], totals, editable_reasons} → 页面形状（含 iden_guid） */
export function toBillDetail(raw = {}) {
  if (!raw) return null
  if (raw.billNo && !raw.bill_no && Array.isArray(raw.items)) return raw
  const reasons = Array.isArray(raw.editable_reasons) ? raw.editable_reasons : []
  const status = toStatus(raw)
  const voided = status === STATUS.VOID
  return {
    id: raw.bill_no || raw.id,
    billNo: raw.bill_no || '',
    useNo: raw.use_no || '',
    billDate: String(raw.ndate || '').slice(0, 10),
    // ★★★ `ndate` = **完整时间戳**（`YYYY-MM-DD HH:mm:ss`），必须原样带出去。
    //
    // 为什么：`billDate` 是给**列表/详情展示**用的「只要日期」口径（10 位），
    // 但**改单页需要时分秒** —— 它要把原样时间回填进 date+time 两个 picker，
    // 保存时再原样写回。
    //
    // 这里原先没有这个字段，于是 `sales/edit.vue` 读到的
    // `raw.ndate || raw.billDate` **必然落到被截断的 10 位** ⇒
    // `normDateTime('2026-09-22')` → `'2026-09-22 00:00:00'` ⇒
    // **改单保存会把原单时间改成当天零点**（静默改数据）。
    //
    // ★ 第七轮修过一次这个问题，但修在**错的层**：当时在 edit.vue 里加了
    //   `normDateTime` 并注释「以前 .slice(0,10) 把时分秒截掉了」，
    //   却没发现**真正的截断发生在适配层**，而且 `toBillDetail` 是新建对象、
    //   **不保留原始 ndate** ⇒ 修复实际未生效。
    //   教训：断言「页面显示了 00:00:00 兜底串」证明不了时分秒正确 ——
    //   必须有「打开一张时间非零点的既有单，读回它的时分秒」的端到端断言。
    ndate: String(raw.ndate || raw.billDate || ''),
    customerCode: raw.customer?.code || '',
    customerName: raw.customer?.name || '',
    warehouse: raw.warehouse || '',
    // ★ 仓库中文名（CkType.Text，Agent 侧 LEFT JOIN CkType ON ck.Key_ = x.Ckbh 得到）。
    //   以前只透编码，详情页显示「101-」；现在显示「主仓库（101-）」。
    //   口径与采购侧 toPurchaseDetail 完全一致（raw.warehouse_name）。
    warehouseName: raw.warehouse_name || raw.warehouseName || '',
    memo: raw.bz_xs ?? raw.memo ?? '',
    status,
    totalAmount: num(raw.totals?.amount ?? raw.totalAmount),
    totalAmountHs: num(raw.totals?.amount_hs),
    totalQty: num(raw.totals?.qty ?? raw.totalQty),
    // ★ 作废单恒不可改；并把它并入 reasons，UI 才有可读的「已作废」原因
    editable: voided
      ? false
      : (raw.editable !== undefined ? !!raw.editable : reasons.length === 0),
    editableReasons: voided && !reasons.includes('已作废')
      ? reasons.concat(['已作废'])
      : reasons,
    // ★ 制单人 / 开单时间：服务端写入口径是 ZDR（zdrbh）= UserInsert = 'SYSTEM'，
    //   时间形如 `2026-09-20 17:05:10`（无毫秒）。详情页展示「制单人」用这两项。
    createdBy: raw.zdr || raw.created_by || raw.createdBy || '',
    createdAt: raw.time_insert || raw.created_at || raw.createdAt || '',
    items: (raw.lines || raw.items || []).map(toBillLine),
  }
}

function toBillLine(it = {}) {
  const qty = num(it.qty)
  const price = num(it.price)
  return {
    idenGuid: it.iden_guid || it.idenGuid || '',
    productId: it.hpbh || it.productId || '',
    name: it.name || '',
    spec: it.spec || '',
    unit: it.unit || '',
    qty,
    price,
    // ★ 后端没给折后金额时自己算：必须走 money.js（十进制精确 + 半偶），
    //   早先用 round2()=Math.round 是半进位，与库里 J_JEZK 的 quantize 口径差一分，
    //   而合计走的是 billState 的 mulMoney ⇒ 逐行相加 ≠ 合计。赠品行 J_JEZK 记 0，兜底也跟着记 0。
    amount: it.amount != null ? num(it.amount) : (it.gift ? 0 : mulMoney(qty, price)),
    priceSource: it.price_source || it.priceSource || '',
    remark: it.remark ?? '',
    // ★ 赠品位（XSMX.Gifts）。口径：单价与金额照记，**折后金额=0** ⇒ 后端给的 `amount`
    //   读的就是 J_JEZK，所以赠品行回来时 amount 是 0，界面上"行有价、合计不含"就是这么来的。
    gift: !!it.gift,
    salesHistory: it.sales_history || it.salesHistory || [],
    showHistory: false,
  }
}

/** 客户：真实 {code,name,py,category,contact,phone,tel,address,remark,price_trace,due,sale_sum} */
export function toCustomer(raw = {}) {
  if (!raw) return null
  if (raw.priceTrace !== undefined && raw.id && !raw.code) return raw
  return {
    id: raw.code || raw.id,
    code: raw.code || '',
    name: raw.name || '',
    py: raw.py || '',
    type: raw.category || raw.type || '',
    categoryCode: raw.category_code || raw.categoryCode || '',
    contact: raw.contact || '',
    // ★ phone 是「合并展示值」（SJ 优先，没有就退 Tel）；mobile 是 SJ 原值、
    //   tel 是 Tel 原值 —— 编辑页回填必须用原值字段，否则保存会把 SJ/Tel 写串。
    phone: raw.phone || raw.tel || raw.mobile || '',
    mobile: raw.phone || raw.mobile || '',
    tel: raw.tel || '',
    address: raw.address || '',
    remark: raw.remark || '',
    priceTrace: num(raw.price_trace ?? raw.priceTrace),
    priceTypeXs: num(raw.price_type_xs ?? raw.priceTypeXs),
    due: num(raw.due ?? raw.receivable),
    saleSum: num(raw.sale_sum ?? raw.cumulativeSales),
    // ★ 状态由后端给文案（正常往来 / 暂停往来），界面不许自己猜「已停用」。
    stopped: !!raw.stop,
    statusName: raw.status_name || '',
    status: raw.status || '正常',
  }
}

/**
 * 价格方案（Khdan.PriceTypeXS 取值）→ 名称。
 * ★ 2026-09-21：PriceTypeXS 0=零售价 1=批发价 2=优惠价 3=销售价3 4=销售价4
 *   5=销售价5 13=最低销价；PriceTrace 200=按价格方案、201=最近销价。
 */
export const PRICE_SCHEMES = [
  { value: 0, label: '零售价' },
  { value: 1, label: '批发价' },
  { value: 2, label: '优惠价' },
  { value: 3, label: '销售价3' },
  { value: 4, label: '销售价4' },
  { value: 5, label: '销售价5' },
  { value: 13, label: '最低销价' },
]

/** 价格方案名称：PriceTrace=201 → 最近销价；否则按 PriceTypeXS 映射 */
export function priceSchemeLabel(priceTrace, priceTypeXs) {
  if (Number(priceTrace) === 201) return '最近销价'
  const s = PRICE_SCHEMES.find((x) => x.value === Number(priceTypeXs))
  return s ? s.label : '—'
}

/**
 * 客户列表归一：{items,total,hasMore} / 裸数组 → {list,total,hasMore,offset}
 *
 * ★★ 列表项契约（页面只认这一套）：
 *      { id, code, name, py, type, contact, phone, due, saleSum, ... }
 *    「应收」的字段名是 **due**（来源 Khdan.J_Due），**不是 receivable**。
 *    2026-09-20 的 bug 就是列表页写了 `c.receivable` → 恒 undefined →
 *    AmountText 回落成 0，整列显示 ¥0.00，而接口返回的 due 一直是有值的。
 *    详情页（customer/detail.vue）用的是 cust.due，两边现在一致。
 */
export function toCustomerList(data, offset = 0) {
  let arr = []
  let total = 0
  let hasMore
  if (Array.isArray(data)) {
    arr = data
    total = data.length
  } else if (data && typeof data === 'object') {
    arr = data.items || data.list || data.rows || []
    total = Number(data.total ?? data.count ?? (offset + arr.length)) || (offset + arr.length)
    if (typeof data.hasMore === 'boolean') hasMore = data.hasMore
  }
  if (hasMore === undefined) hasMore = offset + arr.length < total
  return { list: arr.map(toCustomer).filter(Boolean), total, hasMore, offset,
    stoppedCount: Number(data && data.stoppedCount) || 0,
    showStopped: !!(data && data.showStopped) }
}

/**
 * 商品：真实 {hpbh,name,spec,py,unit,units[],sale_price,...,各属性}
 *
 * ★★ 2026-09-27 多单位改造：这里是**唯一**认识后端字段名的地方。
 *   以前 edit.vue 直接把界面上的驼峰键（baseUnit/salePriceDefault/costPrice/barcode/
 *   category/units）原样发给 Agent，而 Agent 认的是 unit/sale_price/cost_price/...
 *   ⇒ 用户点"保存成功"，条码和类别其实根本没存。这类"静默丢字段"全靠
 *   **出口/入口各一个映射函数**来根治：入口 toProduct（后端→界面），
 *   出口 fromProductForm（界面→后端）。发出去的键由 fromProductForm 白名单控制，
 *   Agent 侧对不认识的键会**直接报错**（v3agent/product.py `_assert_known_keys`）。
 */
export function toProduct(raw = {}) {
  if (!raw) return null
  if (raw.salePriceDefault !== undefined || (raw.id && !raw.hpbh)) return raw
  return {
    id: raw.hpbh || raw.id,
    hpbh: raw.hpbh || '',
    code: raw.code || raw.hpbh || '',
    barcode: raw.barcode || '',
    name: raw.name || '',
    spec: raw.spec || '',
    py: raw.py || '',
    category: raw.category || '',
    categoryCode: raw.category_code || '',
    baseUnit: raw.unit || raw.baseUnit || '',
    units: (Array.isArray(raw.units) ? raw.units : []).map(toProductUnit),
    salePriceDefault: blank0(raw.sale_price ?? raw.salePriceDefault),
    purchasePrice: blank0(raw.purchase_price),
    costPrice: blank0(raw.cost_price),
    salePrice: num(raw.sale_price),
    stock: num(raw.stock),
    // ★ 这货品在库存表里到底有没有行（0=没有 / 1=有 / undefined=老包没说）。
    //   开单页那句库存提示靠它区分"从没入过库"与"账面 0"——见 utils/stockHint.js。
    //   没带就当**未知**，绝不当 0：老 Agent 在线时不能凭空报"这货品还没有库存记录"。
    stockRecord: raw.stock_record === undefined || raw.stock_record === null
      ? undefined : num(raw.stock_record),
    stockMin: num(raw.stock_min),
    stockMax: num(raw.stock_max),
    recentSalePrice: num(raw.recent_sale_price),
    // ★ 价格清单（后端 product.get 的 prices，含各价类）原样透传。
    prices: Array.isArray(raw.prices)
      ? raw.prices.map((p) => ({ key: p.key || '', label: p.label || '', value: num(p.value) }))
      : null,
    // 价格档（驼峰，界面直接用；出口由 fromProductForm 翻回 snake_case）
    priceRetail: blank0(raw.price_retail),
    priceDiscount: blank0(raw.price_discount),
    priceSale3: blank0(raw.price_sale3),
    priceSale4: blank0(raw.price_sale4),
    priceSale5: blank0(raw.price_sale5),
    priceMember: blank0(raw.price_member),
    pricePromo: blank0(raw.price_promo),
    priceLowest: blank0(raw.price_lowest),
    priceHighest: blank0(raw.price_highest),
    rebate: blank0(raw.rebate),
    // 属性补齐（库里一直有、界面没露出的那些）
    brand: raw.brand || '',
    manufacturer: raw.manufacturer || '',
    quality: raw.quality || '',
    series: raw.series || '',
    supplier: raw.supplier || '',
    location: raw.location || '',
    remark: raw.remark || '',
    packUnit: raw.pack_unit || '',
    packSpec: raw.pack_spec || '',
    // ★ 数字档同样"0 当没填"显示：最少起订/退货期限/尺寸/折扣/积分率 这些库里默认就是 0，
    //   界面上摆一排 0，用户既看不出哪些是自己填过的，也怀疑"改了没保存"。
    minOrder: blank0(raw.min_order),
    returnDays: blank0(raw.return_days),
    weight: blank0(raw.weight),
    length: blank0(raw.length),
    width: blank0(raw.width),
    height: blank0(raw.height),
    volume: blank0(raw.volume),
    discount: blank0(raw.discount),
    shelfDays: blank0(raw.shelf_days),
    pointsRate: blank0(raw.points_rate),
    unitPiec: blank0(raw.unit_piec),
    serial: !!raw.serial,
    batch: !!raw.batch,
    wholePiece: !!raw.whole_piece,
    stopped: !!raw.stop,
    // ★ 货品状态是六档（新建货品/正常使用/商城上架/停止采购/停止销售/停止使用），
    //   文案由后端按枚举给；`stopped` 只在「停止使用」这一档为真。
    statusName: raw.status_name || '',
    stopUse: num(raw.stop_use),
    // ★ V3 口径：有业务单据的货品不能改单位倍率、不能摘单位（只能停用）。
    //   后端给 has_bills，界面据此**先把输入框锁掉**，不要等用户点保存再报错。
    hasBills: !!raw.has_bills,
    billLines: num(raw.bill_lines),
    recentSaleBill: raw.recent_sale_bill || '',
    status: raw.status || '在售',
  }
}

/**
 * 这个货品能不能进这张单。能用回空串；不能用回状态文案（界面直接拿去说）。
 *
 * ★ 口径与 Agent 侧 `v3agent/product.py: status_clause` 必须一致，两边各写一套迟早漂：
 *   停止使用（9）哪儿都不给；停止销售（6）不给销售单；停止采购（5）不给采购单。
 * ★ 选择面板本身已经由后端过滤掉了，这个函数管的是**面板之外**的入口：
 *   货品详情页的「以此开单」、草稿续开里存的旧行 —— 那些不走搜索接口，不拦就直接带进单里。
 */
export function billBlockReason(p, usage) {
  if (!p) return ''
  const code = Number(p.stopUse || 0)
  if (code === 9) return p.statusName || '停止使用'
  if (usage === 'sale' && code === 6) return p.statusName || '停止销售'
  if (usage === 'purchase' && code === 5) return p.statusName || '停止采购'
  return ''
}

/**
 * 单位行（HpdanUnit 一行）。
 *
 * ★★ detail.vue 以前读的是 `u.ratio` / `u.salePrice`，而后端给的是 `rate` / `sale_price`
 *   ⇒ 多单位面板**永远空白或 ¥0.00**，看起来像"这货品没配多单位"。
 *   现在统一在这里翻成驼峰，界面只认驼峰。
 */
/**
 * 归一：**库里是 0 而用户其实没填的数，一律显示成空**（价格档与数字档都用它）。
 *
 * ★ 为什么不能显示 0：价目格里每一档都摆个 0，用户分不清"这档真是 0 元"还是"没填"，
 *   而界面上又写着"留空 = 这一档没定价" —— 自己打自己。
 *   空 ≠ 0 在出口也是成立的：`fromProductForm` 只发存在的键，空串不发 ⇒ 服务端不动那一列。
 *   （库存/最近销价这类**只读回显**不用它，0 就是 0。）
 */
function blank0(v) {
  const n = num(v)
  return n ? n : ''
}

export function toProductUnit(u = {}) {
  return {
    unit: u.unit || u.name || '',
    rate: num(u.rate ?? u.ratio ?? 1),
    basic: !!(u.basic || u.is_basic),
    stopped: !!(u.stop || u.stopped || u.UnitStop),
    barcode: u.barcode || '',
    // ★ 两套键名都认：后端给 snake_case，而**旧版详情页/旧草稿**里存的是驼峰
    //   （ratio/salePrice）。只认一边就会让另一边的数据静默变 0。
    salePrice: blank0(u.sale_price ?? u.salePrice),
    purchasePrice: blank0(u.purchase_price ?? u.purchasePrice),
    priceRetail: blank0(u.price_retail ?? u.priceRetail),
    priceDiscount: blank0(u.price_discount ?? u.priceDiscount),
    priceSale3: blank0(u.price_sale3 ?? u.priceSale3),
    priceSale4: blank0(u.price_sale4 ?? u.priceSale4),
    priceSale5: blank0(u.price_sale5 ?? u.priceSale5),
    priceMember: blank0(u.price_member ?? u.priceMember),
    pricePromo: blank0(u.price_promo ?? u.pricePromo),
    priceLowest: blank0(u.price_lowest ?? u.priceLowest),
    priceHighest: blank0(u.price_highest ?? u.priceHighest),
    rebate: blank0(u.rebate),
  }
}

/**
 * 界面表单 -> Agent product.save 的入参（★ 出口白名单）。
 *
 * 只发后端认识的键。界面上多余的字段（id/stock/status/价格清单…）一律不发 ——
 * 发出去会被 Agent 挡下来报错，那正是我们**想要**的：宁可当场红，也不要"保存成功但没存"。
 * @param {object} form 界面上的驼峰表单
 * @param {object} opt  { partial: 编辑时只发改动过的键 }
 */
export function fromProductForm(form = {}, opt = {}) {
  const map = {
    code: 'code', name: 'name', py: 'py', category: 'category',
    spec: 'spec', barcode: 'barcode', brand: 'brand', manufacturer: 'manufacturer',
    quality: 'quality', series: 'series', supplier: 'supplier', location: 'location',
    remark: 'remark', packUnit: 'pack_unit', packSpec: 'pack_spec',
    salePriceDefault: 'sale_price', purchasePrice: 'purchase_price', costPrice: 'cost_price',
    priceRetail: 'price_retail', priceDiscount: 'price_discount', priceSale3: 'price_sale3',
    priceSale4: 'price_sale4', priceSale5: 'price_sale5', priceMember: 'price_member',
    pricePromo: 'price_promo', priceLowest: 'price_lowest', priceHighest: 'price_highest',
    rebate: 'rebate',
    minOrder: 'min_order', returnDays: 'return_days', weight: 'weight', length: 'length',
    width: 'width', height: 'height', volume: 'volume', discount: 'discount',
    shelfDays: 'shelf_days', pointsRate: 'points_rate', unitPiec: 'unit_piec',
    stockMin: 'stock_min', stockMax: 'stock_max',
    serial: 'serial', batch: 'batch', wholePiece: 'whole_piece', stopped: 'stop',
  }
  const out = {}
  Object.keys(map).forEach((k) => {
    if (form[k] === undefined) return
    const v = form[k]
    if (typeof v === 'boolean') out[map[k]] = v ? 1 : 0
    else if (typeof v === 'number') out[map[k]] = v
    else out[map[k]] = v === null ? '' : v
  })
  if (form.baseUnit !== undefined) out.unit = String(form.baseUnit || '').trim()
  if (Array.isArray(form.units)) {
    out.units = form.units.filter((u) => u && (u.unit || u.name)).map((u) => {
      const row = {
        unit: String(u.unit || u.name || '').trim(),
        rate: num(u.rate ?? 1),
        basic: !!u.basic,
        stop: !!u.stopped,
      }
      if (u.barcode !== undefined) row.barcode = String(u.barcode || '')
      const pm = {
        salePrice: 'sale_price', purchasePrice: 'purchase_price', priceRetail: 'price_retail',
        priceDiscount: 'price_discount', priceSale3: 'price_sale3', priceSale4: 'price_sale4',
        priceSale5: 'price_sale5', priceMember: 'price_member', pricePromo: 'price_promo',
        priceLowest: 'price_lowest', priceHighest: 'price_highest', rebate: 'rebate',
      }
      // ★ 只发**界面上真带过来的档**：没发的那一档服务端不动。
      //   全发（没填的发 0）= 把客户录过的价抹成 0，子表是一列一列存的。
      Object.keys(pm).forEach((k) => {
        if (u[k] !== undefined && u[k] !== null && u[k] !== '') row[pm[k]] = num(u[k])
      })
      return row
    })
  }
  if (opt.partial) return out
  if (!out.code) delete out.code
  return out
}


/**
 * 库存状况：真实 {items:[{warehouse,productId,qty,amount,costPrice,...}], total:{...}, truncated}
 *
 * ★★ 2026-09-25：Agent 从「裸数组」换成带 total 的对象 —— 因为本账套 13,352 行
 *   一次取不完，分页后页面自己 reduce 出来的合计必然是错的。
 *   合计一律读 total（同口径全量 SQL），页面不再自算。
 */
export function toInventory(raw = {}) {
  const list = Array.isArray(raw) ? raw : (raw.items || raw.list || [])
  const items = list.map((r) => ({
    id: (r.warehouseId || r.warehouse || '') + '|' + (r.productId || r.hpbh || ''),
    warehouseId: r.warehouseId || '',
    warehouse: r.warehouse || '',
    productId: r.productId || r.hpbh || '',
    name: r.name || '',
    spec: r.spec || '',
    unit: r.unit || '',
    qty: num(r.qty),
    amount: num(r.amount),
    costPrice: num(r.costPrice),
    opening: num(r.opening),
    transit: num(r.transit),
    locked: num(r.locked),
    lowLimit: num(r.lowLimit),
  }))
  const t = raw.total || {}
  return {
    items,
    total: {
      kinds: num(t.kinds ?? items.length),
      qty: num(t.qty),
      amount: num(t.amount),
      inStock: num(t.inStock),
      negative: num(t.negative),
      zero: num(t.zero),
      costed: num(t.costed),
    },
    flag: raw.flag || 'all',
    // 合计是全量、列表只有前 rowLimit 条时，两者相加不等 ⇒ 必须标出来
    truncated: !!raw.truncated,
    rowLimit: num(raw.limit) || 200,
    offset: num(raw.offset),
  }
}

/** 收发存：真实 {product, period, items:[{date,billNo,inQty,outQty,balance}], summary, truncated} */
export function toStockFlow(raw = {}) {
  const items = (raw.items || raw.list || []).map((r) => ({
    date: r.date || '',
    typeName: r.typeName || '',
    billNo: r.billNo || '',
    inQty: num(r.inQty),
    outQty: num(r.outQty),
    balance: num(r.balance),
    costPrice: num(r.costPrice),
    inAmount: num(r.inAmount),
    outAmount: num(r.outAmount),
  }))
  const s = raw.summary || {}
  return {
    product: {
      id: raw.product?.id || '',
      name: raw.product?.name || '',
      spec: raw.product?.spec || '',
      unit: raw.product?.unit || '',
    },
    period: { from: raw.period?.startDate || '', to: raw.period?.endDate || '' },
    items,
    summary: {
      rows: num(s.rows ?? items.length),
      opening: num(s.opening),
      inQty: num(s.inQty),
      outQty: num(s.outQty),
      netQty: num(s.netQty),
      closing: num(s.closing),
    },
    truncated: !!raw.truncated,
    rowLimit: num(raw.rowLimit),
  }
}

/** 报表期间：页面用 {from,to}，真实 REST 用 startDate/endDate，agent op 用 date_from/date_to */
export function toReportQuery({ from, to } = {}) {
  return { startDate: from, endDate: to }
}

/**
 * 经营看板
 *
 * 真实返回（`v3agent/master.py: dashboard`）：
 *   { month_amount, month_count, today_amount, today_count, receivable_total }
 * ★ 后端没有「待审核张数 pending」，也没有环比 monthDelta、没有应收客户数 receivableCount。
 *   这些**一律给 null 并由页面隐藏那一行** —— 不许填 0：0 会被读成"一单都没卖出钱"，
 *   而真实含义是"这个数后端没提供"。（历史事故：首页长期挂着「共 0 张销售单」「客单价 ¥0」。）
 * ★ `month_count` 是 2026-10-07 加的，**要换 Agent 包才有**：旧包上这一行就是不显示，
 *   客单价跟着不显示（分母没了不能瞎算）。
 *
 * 页面期望形状：{ monthRevenue, monthBillCount, todayRevenue, todayBills,
 *                pending, receivableTotal, receivableCount, monthDelta }
 */
export function toDashboard(raw = {}) {
  if (!raw) return null
  // 已是页面形状（mock）则原样返回
  if (raw.monthRevenue !== undefined) return raw
  const todayAmount = num(raw.today_amount ?? raw.todayAmount)
  const todayCount = num(raw.today_count ?? raw.todayCount)
  const monthAmount = num(raw.month_amount ?? raw.monthAmount)
  const has = (v) => v !== undefined && v !== null && v !== ''
  const monthCount = has(raw.month_count) ? num(raw.month_count) : null
  return {
    monthRevenue: monthAmount,
    monthBillCount: monthCount,
    // 客单价 = 本月金额 / 本月张数（与 month_amount 同一谓词那批单），取整到分半偶。
    //   张数缺失或为 0 ⇒ null（见 money.js: avgMoney 为什么不给 0）。
    avgBill: avgMoney(monthAmount, monthCount),
    // 后端没有环比数据
    monthDelta: null,
    todayRevenue: todayAmount,
    todayBills: todayCount,
    // 后端没有这个数 ⇒ null，**不许填 0**（0 会被读成"没有一张单等着审"，
    // 而真实含义是"这个数没提供"）。首页那一格因此不显示，真数由首页另发一次
    // bill.list?state=pending&limit=1 拿 total 覆盖 —— 见 pages/home/index.vue。
    // （这里曾经是 `pending: 0`，依据是一句「移动端也无审核能力」的错判；
    //   审核 op 其实一直存在，2026-10-08 复核，见 api/salesBill.js 末尾。）
    pending: null,
    receivableTotal: num(raw.receivable_total ?? raw.receivableTotal),
    // ★ 后端同样没有「有余额的客户数」（那是应收汇总接口的 customerCount）。
    //   置 0 而不是拿别的数凑，页面在 <=0 时显示中性文案「客户未结应收」。
    receivableCount: num(raw.receivable_count),
    // 标记数据完整度，页面可据此显示「—」而不是「0」
    partial: true,
  }
}

/**
 * 应收汇总
 *
 * 真实（report.receivables.summary，来自 Khdan.J_Due）：
 *   返回「总额、客户数与明细」，字段名以后端实际为准，这里做多路兼容：
 *   total / totalAmount；count / customerCount；list / items / rows
 * 页面期望：{ total, overdue, count, list[] }
 * ★ 后端不提供 overdue（逾期金额），故置 0，不编造。
 */
/**
 * 客户往来对账单
 *
 * ★ 实测线上真实响应（2026-09-19）是**嵌套**的，不是平的：
 *   {
 *     "customer": { "id":"KO1029", "name":"传承" },
 *     "period":   { "startDate":"2026-09-01", "endDate":"2026-09-19" },
 *     "summary":  { "openingBalance":0.0, "salesAmount":1554.8, "paymentAmount":0.0,
 *                   "otherReceivable":0, "otherPayable":0, "closingBalance":1554.8 },
 *     "items":    [ { "date":"2026-09-05", "type":"SALE", "typeName":"销售出货",
 *                     "billId":"XK00000001", "billNo":"XK00000001",
 *                     "description":"销售出货", "debit":137.6, "credit":0, "balance":137.6 } ]
 *   }
 *   也就是说：期末应收在 summary.closingBalance，客户名在 customer.name，
 *   明细金额分散在 debit（借/销售）与 credit（贷/收款）。
 */
export function toStatement(raw = {}) {
  if (!raw) return null
  // ★ 不要在这里做「已是页面形状就原样返回」的短路判断：
  //   后端真实响应顶层也有 summary 键，会被误判成已适配，导致
  //   customer.name 没被提到 customerName、items[].amount 没算出来。
  //   这个适配器是幂等的（重复跑结果一致），所以无条件做归一化最省事。
  const sum = raw.summary || {}
  const items = Array.isArray(raw.items) ? raw.items : []
  // 页面 reconcile.vue 直接绑 summary.xxx，所以 summary 原样保留
  const closing = num(raw.receivable ?? sum.closingBalance ?? raw.endingBalance ?? raw.J_Due)
  return {
    customerName: raw.customerName || raw.customer?.name || '',
    customerId: raw.customer?.id || raw.customerId || '',
    summary: {
      openingBalance: num(raw.openingBalance ?? sum.openingBalance),
      salesAmount: num(raw.salesAmount ?? sum.salesAmount),
      paymentAmount: num(raw.paymentAmount ?? sum.paymentAmount),
      otherReceivable: num(sum.otherReceivable),
      otherPayable: num(sum.otherPayable),
      closingBalance: closing,
    },
    // 平铺字段一并保留，方便其它地方直接用
    receivable: closing,
    openingBalance: num(raw.openingBalance ?? sum.openingBalance),
    salesAmount: num(raw.salesAmount ?? sum.salesAmount),
    paymentAmount: num(raw.paymentAmount ?? sum.paymentAmount),
    total: num(raw.total ?? sum.salesAmount),
    items: items.map((it) => ({
      date: String(it.date || it.ndate || '').slice(0, 10),
      typeName: it.typeName || it.type_name || it.billType || '销售出货',
      billNo: it.billNo || it.bill_no || '',
      description: it.description || it.remark || it.summary || '',
      debit: num(it.debit),
      credit: num(it.credit),
      amount: num(it.amount ?? it.debit ?? it.credit),
      balance: num(it.balance ?? it.runningBalance),
      // ★ 货品层只有请求 withLines=1 时才有（导出"月份对账单"那张）。
      //   quantity 是**开单时那个单位的数量**（库里 S_SLUnit），不是基本数量 S_SL：
      //   厂商那张对账单印的是 S_SL，多单位行会出「180 × 60 ≠ 900」，
      //   本版按 2026-10-08 定的口径改成开单单位数量，让同一行里「数量 × 单价 = 金额」成立。
      //   amount 是折后金额 J_JEZK（赠品行本来就是 0，"印空格"的规则在 statementExcel 里）。
      lines: (Array.isArray(it.lines) ? it.lines : []).map((l) => ({
        productId: String(l.productId || '').trim(),
        productName: l.productName || '',
        spec: l.spec || '',
        quantity: num(l.quantity),
        price: num(l.price),
        amount: num(l.amount),
        gift: !!l.gift,
        remark: l.remark || '',
      })),
    })),
    // 后端口径说明（当前账套无收款流水，期初按期末倒推）——页面会展示
    note: raw.note || '',
    // ★ 流水行数上限：明细被截断时借贷合计仍是 SQL 全量算的，
    //   不告诉用户「这是前 N 笔」就会被当成对不上账。
    truncated: !!raw.truncated,
    rowLimit: num(raw.rowLimit),
    // 货品层的截断与行数：**和上面那个是两个不同的数**，导出前必须分开提示
    linesTruncated: !!raw.linesTruncated,
    lineLimit: num(raw.lineLimit),
    lineCount: num(raw.lineCount),
  }
}

/**
 * 客户货品明细
 *
 * ★ 实测线上真实响应（2026-09-19）同样是嵌套的：
 *   { "customer":{...}, "period":{...},
 *     "summary":{ "productCount":14, "totalQuantity":647.0, "totalAmount":1554.8 },
 *     "items":[ { "productId":"11165", "productName":"砂手套900G", "spec":"",
 *                 "unit":"包", "quantity":40.0, "amount":320.0,
 *                 "billCount":1, "averagePrice":8.0 } ] }
 *   注意明细里的金额字段叫 amount（不是 salesAmount），均价叫 averagePrice。
 */
export function toCustomerProducts(raw = {}) {
  const list = Array.isArray(raw) ? raw : (raw.items || raw.list || [])
  const items = list.map((r) => ({
    productId: r.productId || r.hpbh || '',
    productName: r.productName || r.name || '',
    spec: r.spec || '',
    unit: r.unit || '',
    quantity: num(r.quantity ?? r.qty),
    amount: num(r.amount ?? r.salesAmount),
    salesAmount: num(r.amount ?? r.salesAmount),
    billCount: num(r.billCount ?? r.count),
    avgPrice: num(r.averagePrice ?? r.avgPrice),
  }))
  // summary 后端已给就用后端的，避免分页时算出来的合计与全量不符
  const sum = raw.summary || {}
  // ★ 数量与钱两套口径：数量按厂商那两位（round2 只管它），
  //   **钱一律走 money.js**（逐行已取整再相加、半偶），不再用浮点 reduce。
  const totalQuantity = sum.totalQuantity !== undefined
    ? num(sum.totalQuantity) : round2(items.reduce((s, r) => s + r.quantity, 0))
  const totalAmount = sum.totalAmount !== undefined
    ? sumMoney([sum.totalAmount]) : sumMoney(items.map((r) => r.amount))
  return {
    customerName: raw.customer?.name || '',
    summary: {
      productCount: sum.productCount !== undefined ? num(sum.productCount) : items.length,
      totalQuantity: round2(totalQuantity),
      totalAmount: sumMoney([totalAmount]),
    },
    items,
    // ★ 明细被后端 limit 截断的标记：合计是全量 SQL 算的，所以「合计 ≠ 列表相加」
    //   不是算错，是没取全。不提示就会被当成数据错误（立兴金属 2,361 种只回 200 种）。
    truncated: !!raw.truncated,
    rowLimit: num(raw.rowLimit),
    listSubtotal: sumMoney(items.map((r) => r.amount)),
  }
}

/**
 * 销售汇总：真实 {salesAmount, salesCount, averageBillAmount, salesQty} → 页面形状
 *
 * ★★★ 2026-09-22 第十轮修正「销售数量恒为 0」：
 *   后端原返回里**没有**数量字段（只有 salesAmount / salesCount / averageBillAmount），
 *   而这里读的是 `raw.totalQty` ⇒ `undefined` ⇒ `num()` 归 0 ⇒
 *   报表首页「销售数量」那一格永远显示 0（用户报障原文：
 *   「报表的销售数量模块统计数据有问题，一直都是显示0」）。
 *   ⇒ 后端已补 `salesQty`（= SUM(XS.S_SLSUM)，口径与 salesCount/salesAmount 同一 where），
 *     这里按 `salesQty → totalQty → qty` 顺序兼容读取：
 *     · `salesQty`  新契约（Agent sales_summary 输出）
 *     · `totalQty`  旧适配层曾期望的名字（保留以免别处 mock/缓存失效）
 *     · `qty`       purchase 侧的同族命名
 *   ★ 教训：**「字段名对不上」不会报错，只会静默变 0** ——
 *     凡是从接口读数值字段，都要能回答「它在真实响应里叫什么」。
 */
export function toSalesSummary(raw = {}) {
  if (!raw) return null
  if (raw.totalAmount !== undefined) return raw
  const prev = raw.previous || null
  const out = {
    totalAmount: num(raw.salesAmount),
    billCount: num(raw.salesCount),
    avgBill: num(raw.averageBillAmount),
    totalQty: num(raw.salesQty ?? raw.totalQty ?? raw.qty),
    // ★ 后端没给这两个字段时必须是 null，不能是 0：
    //   0 会被页面渲染成「活跃客户 0 家」这种**看着可信的假数字**
    //   （旧版 Agent 就没有这两个字段）。页面按 null 显示「—」。
    customerCount: raw.customerCount === undefined || raw.customerCount === null ? null : num(raw.customerCount),
    activeDays: raw.activeDays === undefined || raw.activeDays === null ? null : num(raw.activeDays),
    gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
    previous: prev ? {
      totalAmount: num(prev.salesAmount),
      billCount: num(prev.salesCount),
      avgBill: num(prev.averageBillAmount),
      totalQty: num(prev.salesQty),
      customerCount: prev.customerCount === undefined || prev.customerCount === null ? null : num(prev.customerCount),
      dateFrom: prev.dateFrom || '',
      dateTo: prev.dateTo || '',
    } : null,
  }
  // ★ compare = 与「等长紧邻上一周期」的变化率；上一周期无数据时给 null 而不是 0/-100%，
  //   否则「上月没开单」会被渲染成 +∞ 或 -100% 的假结论。
  out.compare = prev ? {
    amount: ratio(out.totalAmount, prev.salesAmount),
    avgBill: ratio(out.avgBill, prev.averageBillAmount),
    qty: ratio(out.totalQty, prev.salesQty),
    customers: out.customerCount === null || prev.customerCount === null
      ? null : out.customerCount - num(prev.customerCount),
  } : null
  return out
}

/** 变化率；分母为 0 → null（调用方按「无可比」处理） */
function ratio(cur, base) {
  const b = num(base)
  return b ? (num(cur) - b) / b : null
}

/**
 * 趋势按日补零。
 * ★ 后端 GROUP BY 只返回**有单的那些天**，直接拿去画折线会把
 *   「09/06-09/18 一单没有」画成「09/05 直接连到 09/19」——断档被抹平，
 *   图上看不出经营中断。这里按日历补齐，断档由调用方再画标注带。
 * @param {Array<{date:string,amount:number,count:number}>} items toTrend 的结果
 * @param {string} from 起始日 'YYYY-MM-DD'
 * @param {string} to   结束日 'YYYY-MM-DD'（超过今天的不补，未来不是断档）
 */
export function fillDailyTrend(items = [], from, to) {
  const norm = (s) => {
    const t = String(s || '').slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : ''
  }
  // ★ 全程按**本地日期**做字符串运算：Date.parse('T00:00:00') 是本地时区，
  //   而 toISOString() 是 UTC —— 混用会让 UTC+8 下每一天都往前偏一天。
  const pad = (x) => String(x).padStart(2, '0')
  const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const parse = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  const map = {}
  items.forEach((r) => { const d = norm(r.date); if (d) map[d] = r })
  const f = norm(from)
  let t = norm(to)
  if (!f || !t) return items.map((r) => ({ ...r }))
  const today = fmt(new Date())
  if (t > today) t = today
  const out = []
  const d = parse(f)
  const end = parse(t)
  while (d <= end) {
    const key = fmt(d)
    const hit = map[key]
    out.push({ date: key, value: num(hit && (hit.amount ?? hit.value)), bills: num(hit && hit.count) })
    d.setDate(d.getDate() + 1)
  }
  return out
}


/** 客户销售排行：真实 {customerId,customerName,salesCount,salesAmount} */
export function toCustomerRanking(raw = []) {
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    customerId: r.customerId || r.code || '',
    customerName: r.customerName || r.name || '',
    salesCount: num(r.salesCount),
    salesAmount: num(r.salesAmount),
    amount: num(r.salesAmount ?? r.amount),
  }))
}

/** 商品销售排行：真实 {productId,productName,spec,quantity,salesAmount} */
export function toProductRanking(raw = []) {
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    productId: r.productId || r.hpbh || '',
    productName: r.productName || r.name || '',
    spec: r.spec || '',
    quantity: num(r.quantity ?? r.qty),
    qty: num(r.quantity ?? r.qty),
    salesAmount: num(r.salesAmount),
    amount: num(r.salesAmount ?? r.amount),
  }))
}

/**
 * 销售趋势
 *
 * ★ 实测（2026-09-19 线上真实响应）后端返回的是**对象**不是数组：
 *     { "granularity":"day", "items":[{"date":"2026-09-05","count":62,"amount":8947.6}, ...] }
 *   而页面传进来的若是裸数组也要兼容，故两者都收。
 */
export function toTrend(raw = []) {
  const list = Array.isArray(raw) ? raw : (raw.items || raw.list || [])
  return (Array.isArray(list) ? list : []).map((r) => ({
    date: r.date || '',
    count: num(r.count),
    amount: num(r.amount),
  }))
}

/** 采购汇总：真实 {purchaseCount,purchaseAmount,purchaseQty,supplierCount} → 页面形状 */
export function toPurchaseSummary(raw = {}) {
  if (!raw) return null
  return {
    billCount: num(raw.purchaseCount),
    totalAmount: num(raw.purchaseAmount),
    totalQty: num(raw.purchaseQty),
    supplierCount: num(raw.supplierCount),
  }
}

/** 供应商排行：真实 {supplierId,supplierName,purchaseCount,purchaseAmount} */
export function toSupplierRanking(raw = []) {
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    id: r.supplierId || r.code || '',
    name: r.supplierName || r.name || '',
    count: num(r.purchaseCount),
    amount: num(r.purchaseAmount),
    value: num(r.purchaseAmount ?? r.amount),
  }))
}

/** 毛利：真实 {salesAmount,costAmount,grossProfit,grossMargin} → 页面形状 */
export function toProfit(raw = {}) {
  if (!raw) return null
  const src = raw.sources || {}
  return {
    salesAmount: num(raw.salesAmount),
    costAmount: num(raw.costAmount),
    grossProfit: num(raw.grossProfit),
    grossMargin: num(raw.grossMargin),
    // ★ available=false 时**不要显示毛利数字**：成本来源不足会让毛利率虚高到 99%+。
    //   后端按「在售货品里有采购均价的占比 ≥0.6」判定，页面只认这个布尔值。
    available: raw.available !== undefined ? !!raw.available : true,
    costCoverage: num(raw.costCoverage),
    costedProducts: num(raw.costedProducts),
    soldProducts: num(raw.soldProducts),
    sources: {
      purchaseAvgPrice: src.purchaseAvgPrice || {},
      detailCost: src.detailCost || {},
      masterCostPrice: src.masterCostPrice || {},
      purchaseBills: src.purchaseBills || {},
    },
    note: raw.note || '',
  }
}

/**
 * 应收汇总 + 账龄。
 *
 * ★ 实测后端字段是 receivable / advance，**不是 balance**：
 *     {"customerId":"KO1029","customerName":"传承","receivable":1554.8,"advance":0.0,
 *      "lastShipDate":"2026-09-05","daysSince":19,"agingKey":"0-30"}
 * ★★ 这里**不再有 `overdue`**（2026-09-24）：旧写法读 `raw.overdue` —— 后端从来没有这个
 *   字段（当前账套 XSSK/KHXSSK 无收款流水，无法按单据核销算逾期），
 *   ⇒ 恒 0 ⇒ 报表页「应收逾期 ¥X」那条提醒**永远不显示**（假提醒）。
 *   现在改成有真实口径的 `aging`（按客户最后一张出货单距今天数分段）。
 */
export function toReceivables(raw = {}) {
  if (!raw) return null
  if (raw.count !== undefined && raw.list !== undefined) return raw
  const items = raw.list || raw.items || raw.rows || []
  return {
    total: num(raw.totalReceivable ?? raw.total ?? raw.receivableTotal),
    count: num(raw.customerCount ?? raw.count ?? items.length),
    aging: (Array.isArray(raw.aging) ? raw.aging : []).map((b) => ({
      key: b.key || '', label: b.label || '', customers: num(b.customers), amount: num(b.amount),
    })),
    agingTotal: num(raw.agingTotal),
    agingNote: raw.agingNote || '',
    matchedCount: num(raw.matchedCount ?? items.length),
    truncated: !!raw.truncated,
    // ★ 合计是全量（含暂停往来），列表默认只列正常往来 ⇒ 后端把差额交出来，
    //   界面才能说清"另有 N 家 ¥X 已计入合计"，不然页面合计永远比列出来的加起来大。
    stoppedHidden: raw.stoppedHidden ? { count: num(raw.stoppedHidden.count), amount: num(raw.stoppedHidden.amount) } : null,
    showStopped: !!raw.showStopped,
    list: (Array.isArray(items) ? items : []).map((r) => ({
      customerId: r.customerId || r.code || '',
      customerName: r.customerName || r.name || '',
      py: r.py || '',
      balance: num(r.receivable ?? r.balance ?? r.due ?? r.amount),
      advance: num(r.advance),
      lastShipDate: r.lastShipDate || '',
      daysSince: r.daysSince === null || r.daysSince === undefined ? null : num(r.daysSince),
      agingKey: r.agingKey || '',
      stopped: !!r.stopped,
      statusName: r.statusName || '',
    })),
  }
}

/* ============================================================================
 * 采购（V3 里叫「进货单」JH）/ 供应商（Gysdan）
 * ============================================================================
 *
 * ★★ 这段是 2026-09-20 新加的。此前采购/供应商**根本没有后端接口**
 *    （`/api/v1/purchases` 404），页面读 `src/mock/data.js` 的 CG0000002x
 *    示例单，供应商是「佛山磨料磨具厂」之类的虚构数据。
 *    现在 Agent 的 `purchase.*` / `supplier.*` op 与云端路由都通了，
 *    这里负责把**真实响应**拍成页面形状。
 *
 * 真实响应（已实测）：
 *   列表 GET /purchases
 *     { items:[{ bill_no, ndate, supplier:{code,name}, warehouse, warehouse_name,
 *                amount, amount_hs, qty, is_auditing, is_ok, status,
 *                line_count, note }], total, limit, offset, hasMore }
 *   详情 GET /purchases/{bill_no}
 *     { bill_no, use_no, ndate, supplier:{code,name}, warehouse, warehouse_name,
 *       status, is_auditing, is_ok, note, fkfs, totals:{amount,amount_hs,qty,
 *       line_count,zk,paid}, lines:[{ iden_guid, hpbh, name, spec, unit,
 *       unit_rate, qty, price, amount, amount_hs, note, gift, batch }],
 *       editable, editable_reasons, created_by, created_at }
 *
 * ★ 状态口径（V3 真实状态位收敛成三个枚举）：
 * ★★★ 2026-09-20 纠正：`is_ok`（V3 里的 IsOk）**不是作废位**！
 *     IsOk=1 → 正式单，未审核
 *     IsOk=0 → 草稿单，未审核
 *     作废   → IsOk 置 0，并写 UserVoid(作废人) + TimeVoid(作废时间)
 *   即草稿与作废**都是 IsOk=0**，只能靠 UserVoid/TimeVoid 区分。
 *   旧的 `if (raw.is_ok === false) return VOID` 会把草稿单显示成「已作废」。
 *   ★ 现在**优先读后端给的 `status` 字段**（Agent 已按新口径收敛好，
 *     与 /purchases?state= 的筛选口径完全一致）；仅在老 exe 没给 status 时，
 *     才回退到 is_auditing / is_draft / 作废痕迹 自行推断。
 *   ★★ 页面原先把状态叫「已入库 / 待确认」——那是 mock 编的概念，
 *      V3 的 JH 里**没有**这个语义（没有入库标志位）。已改为真实口径。
 *      mock 里的 'received' 保留兼容映射到 audited，便于 USE_MOCK 调试。
 */

export const PURCHASE_STATUS = {
  PENDING: 'pending',
  AUDITED: 'audited',
  VOID: 'void',
}

const PURCHASE_STATUS_LABEL = {
  pending: '未审核',
  audited: '已审核',
  void: '已作废',
}

export const purchaseStatusLabel = (s) => PURCHASE_STATUS_LABEL[s] || '未审核'

/** 状态归一：优先吃后端 status；老 exe 无 status 时按状态位兜底推断 */
export function purchaseStatus(raw = {}) {
  // 1) 后端新口径：/purchases 的 status 已经正确收敛（推荐路径）
  const s = raw.status
  if (s === 'received') return PURCHASE_STATUS.AUDITED // mock 兼容
  if (s === PURCHASE_STATUS.AUDITED || s === PURCHASE_STATUS.VOID
      || s === PURCHASE_STATUS.PENDING) {
    return s
  }
  // 2) 老 exe 没有 status：用「作废痕迹」判 void，**不能**用 is_ok
  const uv = String(raw.user_void || '').trim()
  const tv = raw.time_void
  if (uv !== '' || (tv !== undefined && tv !== null && tv !== '')) {
    return PURCHASE_STATUS.VOID
  }
  if (raw.is_draft === true) return PURCHASE_STATUS.PENDING
  if (raw.is_auditing !== undefined && raw.is_auditing !== null) {
    return raw.is_auditing ? PURCHASE_STATUS.AUDITED : PURCHASE_STATUS.PENDING
  }
  return PURCHASE_STATUS.PENDING
}

/** 采购单列表项：真实 → 页面形状 */
export function toPurchase(raw = {}) {
  if (!raw) return null
  const no = raw.bill_no || raw.billNo || ''
  return {
    id: no || raw.id,
    billNo: no,
    useNo: raw.use_no || raw.useNo || '',
    billDate: String(raw.ndate || raw.billDate || '').slice(0, 10),
    // ★ `ndate` = 完整时间戳，供**改单页**回填到 date+time 双 picker（见 toBillDetail 的长注释）。
    //   不带上它，采购改单页读到的就是被截成 10 位的 billDate ⇒ 保存时时间变 00:00:00。
    ndate: String(raw.ndate || raw.billDate || ''),
    supplierId: raw.supplier?.code || raw.supplierId || '',
    supplierCode: raw.supplier?.code || raw.supplierCode || '',
    supplierName: raw.supplier?.name || raw.supplierName || '',
    warehouse: raw.warehouse || '',
    warehouseName: raw.warehouse_name || raw.warehouseName || '',
    status: purchaseStatus(raw),
    totalAmount: num(raw.amount ?? raw.totalAmount),
    totalAmountHs: num(raw.amount_hs ?? raw.totalAmountHs),
    totalQty: num(raw.qty ?? raw.totalQty),
    // ★ 列表接口只给行数（line_count），不给 items 数组 —— 不要假装有 items
    lineCount: num(raw.line_count ?? raw.lineCount
      ?? (Array.isArray(raw.items) ? raw.items.length : 0)),
    note: raw.note ?? raw.memo ?? '',
    isAuditing: raw.is_auditing,
    editable: raw.editable,
  }
}

/** 采购单列表：兼容分页对象 / 裸数组 / {list|rows|items} */
export function toPurchaseList(data = {}, offset = 0) {
  let arr = []
  let total = 0
  let hasMore
  if (Array.isArray(data)) {
    arr = data
    total = data.length
  } else if (data && typeof data === 'object') {
    arr = data.items || data.list || data.rows || []
    total = Number(data.total ?? data.count ?? (offset + arr.length)) || (offset + arr.length)
    if (typeof data.hasMore === 'boolean') hasMore = data.hasMore
  }
  if (hasMore === undefined) hasMore = offset + arr.length < total
  return { list: arr.map(toPurchase).filter(Boolean), total, hasMore, offset }
}

function toPurchaseLine(it = {}) {
  const qty = num(it.qty)
  const price = num(it.price)
  return {
    idenGuid: it.iden_guid || it.idenGuid || '',
    productId: it.hpbh || it.productId || '',
    name: it.name || '',
    spec: it.spec || '',
    unit: it.unit || '',
    unitRate: num(it.unit_rate ?? it.unitRate),
    qty,
    price,
    // ★ 后端没给折后金额时自己算：必须走 money.js（十进制精确 + 半偶），
    //   早先用 round2()=Math.round 是半进位，与库里 J_JEZK 的 quantize 口径差一分，
    //   而合计走的是 billState 的 mulMoney ⇒ 逐行相加 ≠ 合计。赠品行 J_JEZK 记 0，兜底也跟着记 0。
    amount: it.amount != null ? num(it.amount) : (it.gift ? 0 : mulMoney(qty, price)),
    amountHs: num(it.amount_hs ?? it.amountHs),
    priceJh: num(it.price_jh ?? it.priceJh),
    // ★★ 明细行备注：统一读 **`remark`**（第十轮）。Agent 侧 `_map_line` 原先叫
    //   `note`，而**写入参数名是 `remark`** —— 一读一写两个名字，
    //   结果是「备注填了回读不到」。现在后端已统一输出 `remark`，
    //   这里兼容 `remark ?? note`（老缓存 / mock 数据仍能取到）。
    //   ★ 列本身一直是 `JHMX.BZ_JHMX` 没变。
    remark: it.remark ?? it.note ?? '',
    gift: !!it.gift,
    batch: it.batch || '',
  }
}

/** 采购单详情：真实 → 页面形状（含 items 与可否修改） */
export function toPurchaseDetail(raw = {}) {
  if (!raw) return null
  const base = toPurchase(raw)
  const lines = raw.lines || raw.items || []
  const totals = raw.totals || {}
  const reasons = Array.isArray(raw.editable_reasons)
    ? raw.editable_reasons
    : (Array.isArray(raw.editableReasons) ? raw.editableReasons : [])
  return {
    ...base,
    memo: raw.note ?? raw.memo ?? '',
    fkfs: raw.fkfs || '',
    // 真实字段名是 created_by / created_at
    createdBy: raw.created_by || raw.createdBy || '',
    createdAt: String(raw.created_at || raw.createdAt || ''),
    printCount: num(raw.print_count ?? raw.printCount),
    editable: raw.editable !== undefined ? !!raw.editable : reasons.length === 0,
    editableReasons: reasons,
    totalAmount: num(totals.amount ?? raw.amount ?? base.totalAmount),
    totalAmountHs: num(totals.amount_hs ?? raw.amount_hs ?? base.totalAmountHs),
    totalQty: num(totals.qty ?? raw.qty ?? base.totalQty),
    totalZk: num(totals.zk),
    paid: num(totals.paid),
    lineCount: num(totals.line_count ?? lines.length),
    items: lines.map(toPurchaseLine),
  }
}

/** 供应商：真实 {code,name,py,type(GysType.Text),type_code(Lbtype_Gys),contact,phone(SJ),tel,address,due,advance} */
export function toSupplier(raw = {}) {
  if (!raw) return null
  const code = raw.code || raw.itembh || ''
  return {
    id: code || raw.id,
    code,
    name: raw.name || raw.itemmc || '',
    py: raw.py || '',
    // ★ type=类别名称（GysType.Text）；type_code=Lbtype_Gys 原值（编辑保存写回）
    type: raw.type || raw.gys_type || '',
    typeCode: raw.type_code || raw.typeCode || '',
    contact: raw.contact || raw.lxr || '',
    phone: raw.phone || raw.sj || '',
    tel: raw.tel || '',
    address: raw.address || '',
    remark: raw.remark || '',
    bankName: raw.bank_name || '',
    bankId: raw.bank_id || '',
    due: num(raw.due),
    advance: num(raw.advance),
    stopUse: !!raw.stop_use,
    stopped: !!raw.stop,
    statusName: raw.status_name || '',
  }
}

/** 供应商列表：同样兼容分页对象 / 裸数组 */
export function toSupplierList(data = {}, offset = 0) {
  let arr = []
  let total = 0
  let hasMore
  if (Array.isArray(data)) {
    arr = data
    total = data.length
  } else if (data && typeof data === 'object') {
    arr = data.items || data.list || data.rows || []
    total = Number(data.total ?? data.count ?? (offset + arr.length)) || (offset + arr.length)
    if (typeof data.hasMore === 'boolean') hasMore = data.hasMore
  }
  if (hasMore === undefined) hasMore = offset + arr.length < total
  return { list: arr.map(toSupplier).filter(Boolean), total, hasMore, offset,
    stoppedCount: Number(data && data.stoppedCount) || 0,
    showStopped: !!(data && data.showStopped) }
}

/** 供应商进货价历史：真实 {hpbh,name,spec,unit,price,price_tax,last_bill_no} */
export function toSupplierPrices(raw = []) {
  return (Array.isArray(raw) ? raw : []).map((r) => ({
    productId: r.hpbh || r.productId || '',
    name: r.name || '',
    spec: r.spec || '',
    unit: r.unit || '',
    price: num(r.price),
    priceTax: num(r.price_tax),
    lastBillNo: r.last_bill_no || '',
    updatedAt: String(r.updated_at || ''),
  }))
}

/**
 * 某货品的最近销售明细行 → 页面形状（新增销售单的「最近销售」面板）
 *
 * ★★ 真实来源是 `GET /products/{hpbh}/sales-history`（Agent 直查 XSMX 明细表）。
 *    **不要**改回用销售单列表（`GET /sales`）反查 —— 列表项里没有 detail 行，
 *    那个做法恒返回空数组，页面永远显示「暂无历史销售记录」。
 *
 * 兼容三种输入：{hpbh,items:[...]} / 裸数组 / mock 的页面形状（billDate/…）。
 */
export function toSalesHistory(raw) {
  let arr = []
  if (Array.isArray(raw)) arr = raw
  else if (raw && typeof raw === 'object') arr = raw.items || raw.list || raw.rows || []
  return arr.map((r) => ({
    billNo: r.bill_no || r.billNo || '',
    useNo: r.use_no || r.useNo || '',
    billDate: String(r.ndate || r.billDate || '').slice(0, 10),
    customerCode: r.customer?.code || r.customerCode || '',
    customerName: r.customer?.name || r.customerName || '',
    unit: r.unit || '',
    qty: num(r.qty),
    price: num(r.price),
    amount: num(r.amount),
  }))
}

function num(v) {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
/**
 * ★ 只准用于**数量**（对齐厂商的两位小数）。钱不许用它：
 *   `Math.round` 是半进位，而库里 J_JEZK 是 `Decimal.quantize`（半偶），
 *   前端合计走 utils/money.js ⇒ 拿它算钱会出现"逐行相加 ≠ 合计"的一分钱差。
 */
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * 能力与连接状态（「我的」页消费）
 *
 * ★★ 真实响应是**嵌套**的，页面原先按 mock 的平铺形状读，导致四个字段全为
 *    undefined —— 结果「数据连接状态」永远显示「连接异常」、「Agent 连接状态」
 *    永远显示「离线」，即使 Agent 确实在线（2026-09-20 实测确认）。
 *
 * 真实 `GET /api/v1/capabilities` 形状：
 *   {
 *     "client": { "label":"app:account:shiwang", "kind":"app" },
 *     "agent":  { "name":"shiwantongda", "online":true,
 *                 "version":"0.1.0", "ops":[ ...29 个... ] },
 *     "rest":   [ "GET /api/v1/sales", ... ],
 *     "capabilities": { "name":..., "version":"0.1.0", "ops":[...],
 *                       "printers":[...], "printFormats":{...},
 *                       "dbStatus":"healthy", "dbError":null }
 *   }
 *
 * ★ 在线状态的真实路径是 data.agent.online，**不是**平铺的 agentOnline。
 * ★ dbStatus 由 Agent 端独立探活返回（'healthy' | 'error'）；
 *   老版本 Agent 不返回该字段时，退化为「用 agent.online 推断」并标记
 *   dbStatusKnown=false，页面据此显示中性文案而不是假报「数据正常」。
 *
 * 页面期望：{ agentOnline, dbStatus, dbStatusKnown, dbError, printers,
 *             printerList, defaultPrinter, printerHost, version, ops, restCount }
 *
 * ★ printers 是**台数**（数字）；打印机明细在 printerList，默认机名在 defaultPrinter。
 *   打印页不要再写 `caps.printers.list` —— 那是数字，取属性恒为 undefined。
 */
/**
 * 本店 V3 业务开关（capabilities.accountOptions）→ 页面形状。**三态**，别塌成布尔。
 * 界面用 `xxx === false` 才隐藏；null 一律按"照常显示"处理（详见 store/options.js）。
 */
export function toAccountOptions(src) {
  const s = (v) => (v === true ? true : (v === false ? false : null))
  const o = src && typeof src === 'object' ? src : null
  const pc = o && o.productCode && typeof o.productCode === 'object' ? o.productCode : null
  return {
    known: !!o,
    multiUnit: o ? s(o.multiUnit) : null,
    multiUnitPackage: o ? s(o.multiUnitPackage) : null,
    billQtyByUnit: o ? s(o.billQtyByUnit) : null,
    useBrandName: o ? s(o.useBrandName) : null,
    // ★ 能力开关：判据是 `=== true` 才显示（与"只有 false 才隐藏"相反，见 store/options.js）
    useBatch: o ? s(o.useBatch) : null,
    useSerial: o ? s(o.useSerial) : null,
    ambiguous: (o && Array.isArray(o.ambiguous)) ? o.ambiguous : [],
    // 编号规则原样带回（档位/取几级/补零位数），界面只显示、**不参与算号**
    productCode: pc ? {
      serialType: num(pc.serial_type), levels: num(pc.levels),
      serialLen: num(pc.serial_len), autobh: pc.autobh === true,
      ambiguous: Array.isArray(pc.ambiguous) ? pc.ambiguous : [],
    } : null,
  }
}

export function toCapabilities(raw = {}, ok = true, offline = false) {
  if (!raw) return null
  // 已是页面形状（mock）则原样返回
  if (raw.agentOnline !== undefined || raw.dbStatusKnown !== undefined) return raw

  const agent = raw.agent || {}
  const caps = raw.capabilities || {}

  const agentOnline = agent.online === true

  // ★ dbStatus：优先用后端探活结果；老 Agent 没这个字段时不假装知道
  let dbStatus
  let dbStatusKnown
  if (typeof caps.dbStatus === 'string' && caps.dbStatus) {
    dbStatus = caps.dbStatus === 'healthy' ? 'healthy' : 'error'
    dbStatusKnown = true
  } else if (typeof raw.dbStatus === 'string' && raw.dbStatus) {
    dbStatus = raw.dbStatus === 'healthy' ? 'healthy' : 'error'
    dbStatusKnown = true
  } else {
    // 后端未提供：退化为按 Agent 在线推断，但明确标记「不确定」
    dbStatus = agentOnline ? 'healthy' : 'error'
    dbStatusKnown = false
  }

  // ★★ printers 的真实形状是**对象**，不是数组：
  //   { hostName, matchedHost, note, defaultPrinter,
  //     v3Printers: [{ hostName, printerName, copies, knife }] }
  //   mock 里 printers 是**数字**（台数）。
  //
  //   ★ 2026-09-20 回归：本轮只把 printers 折算成了「台数」，
  //     而打印页按 `caps.printers.list || .items` 去取数组 ——
  //     printers 是数字，取不到属性 → 列表恒为空 → 永远显示「0 台」
  //     （本机实有 2 台）。默认机名同样读不到（真实位置是 printers.defaultPrinter）。
  //
  //   → 约定：`printers` 继续是**台数**（「我的」页显示「N 台可用」），
  //           列表与默认机名另给扁平字段 printerList / defaultPrinter / printerHost。
  //
  //   ★★ 另一个坑：v3Printers 里的字段叫 **printerName**，不是 name。
  //      即使把数组原样透下去，页面 `p.name || p` 也会渲染出 `[object Object]`。
  //      所以这里必须归一成 name。
  const printersRaw = caps.printers ?? raw.printers ?? []

  /** 统一成 [{ name, hostName, copies, knife, isDefault }] */
  let printerList = []
  let defaultPrinter = ''
  let printerHost = { hostName: '', matchedHost: '', note: '' }

  if (Array.isArray(printersRaw)) {
    // mock / 旧形状：[{ id, name, isDefault }]
    printerList = printersRaw
      .map((p) => {
        if (p && typeof p === 'object') {
          return { ...p, name: String(p.name || p.printerName || '') }
        }
        return { name: String(p == null ? '' : p) }
      })
      .filter((p) => !!p.name)
    const dft = printerList.filter((p) => p.isDefault)[0]
    defaultPrinter = String((dft && dft.name) || '')
  } else if (printersRaw && typeof printersRaw === 'object') {
    defaultPrinter = String(printersRaw.defaultPrinter || printersRaw.default || '')
    printerHost = {
      hostName: String(printersRaw.hostName || ''),
      matchedHost: String(printersRaw.matchedHost || printersRaw.hostName || ''),
      note: String(printersRaw.note || ''),
    }
    const arr = Array.isArray(printersRaw.v3Printers) ? printersRaw.v3Printers : []
    const dflt = defaultPrinter.toLowerCase()
    printerList = arr
      .map((p) => {
        const name = String((p && (p.printerName || p.name)) || '')
        return {
          name,
          hostName: String((p && p.hostName) || ''),
          copies: num(p && p.copies),
          knife: !!(p && p.knife),
          isDefault: !!dflt && name.toLowerCase() === dflt,
        }
      })
      .filter((p) => !!p.name)
  }

  // 兜底：数组形状没标 isDefault，但对象形状的 defaultPrinter 为空时，
  // 用列表里的 isDefault 反推一次。
  if (!defaultPrinter) {
    const d2 = printerList.filter((p) => p.isDefault)[0]
    defaultPrinter = String((d2 && d2.name) || '')
  }

  // 台数：优先用归一后的列表长度；纯数字形状（mock）则照原值。
  const printers = printerList.length || num(printersRaw)

  // ★★ 打印格式（2026-09-23 需求）：打印页要能「选打印格式」。
  //   Agent capabilities.printFormats 形状：
  //     { source, rptType, count, items: [{ name, isDefault, sysRpt, custom, verName, ... }] }
  //   老版本 / mock 可能是数组或缺失 ⇒ 一律兜底成空数组，页面据此隐藏「打印格式」区块。
  const formatsRaw = caps.printFormats ?? raw.printFormats ?? {}
  let printFormatList = []
  if (Array.isArray(formatsRaw)) {
    printFormatList = formatsRaw
      .map((f) => ({ name: String((f && (f.name || f.rptName)) || ''), isDefault: !!(f && f.isDefault) }))
      .filter((f) => !!f.name)
  } else if (formatsRaw && typeof formatsRaw === 'object') {
    const arr = Array.isArray(formatsRaw.items) ? formatsRaw.items : []
    printFormatList = arr
      .map((f) => ({
        name: String((f && (f.name || f.rptName)) || ''),
        isDefault: !!(f && f.isDefault),
        sysRpt: !!(f && f.sysRpt),
        custom: !!(f && f.custom),
        verName: String((f && f.verName) || ''),
        editTime: String((f && f.editTime) || ''),
      }))
      .filter((f) => !!f.name)
  }
  const fmtDefault = printFormatList.filter((f) => f.isDefault)[0]
  const defaultFormat = String((fmtDefault && fmtDefault.name) || '')

  const ops = agent.ops ?? caps.ops ?? raw.ops ?? []
  const rest = raw.rest ?? []

  return {
    agentOnline,
    dbStatus,
    dbStatusKnown,
    dbError: caps.dbError ?? raw.dbError ?? null,
    printers,
    printerList,
    defaultPrinter,
    printerHost,
    // ★ 2026-09-23：打印格式列表 + 默认格式（打印页选「打印格式」用）
    printFormatList,
    defaultFormat,
    // ★ 这一条是**本地服务(Agent)自己的版本**，不是这个 App 的版本 —— 所以改名成
    //   agentVersion，并且**拿不到就留空**：旧写法兜一个 '1.0.0'，「我的」页把它印成
    //   "移动经营管理端 版本 1.0.0"，等于凭空造了一个永远不变的版本号（P0-3）。
    agentVersion: agent.version || caps.version || raw.version || '',
    ops: Array.isArray(ops) ? ops.length : num(ops),
    // ★ 光有台数没法按能力裁界面：`ops` 是数量，`opList` 才是那份清单。
    //   「后端有没有这个动作」必须问清单，不能问数量 —— 数量对得上不代表有这一条，
    //   而且加一个 op 就涨一，谁也不会去看数字变了多少。
    //   老 Agent 不回 ops 时这里是空数组 ⇒ 页面按「不知道」处理（隐藏写入口，不假装能写）。
    opList: Array.isArray(ops) ? ops.map((x) => String(x)) : [],
    restCount: Array.isArray(rest) ? rest.length : num(rest),
    // 接口本身返回 ok=false 时（极少），也要让页面知道数据不可信
    reliable: ok !== false,
    // ★ 这一份是**断网时从离线缓存翻出来的**：连接状态、打印机台数都是旧时刻的快照，
    //   页面只准说「状态未知」，不准拿它说「已连接」（2026-10-05 现场：本地服务早停了，
    //   「我的」页一直挂着已连接 —— 一半原因是这个缓存没被标出来）。
    stale: !!offline,
    // ★ 本店 V3 的业务开关（多单位/品牌/单位开单/编号规则）——三态，见 toAccountOptions
    accountOptions: toAccountOptions(caps.accountOptions ?? raw.accountOptions),
  }
}
