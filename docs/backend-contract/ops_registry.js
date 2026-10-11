const OPS = {
  /* ---- 连接与状态 ---- */
  "system.ping": { cat: "连接与状态", label: "连通性测试", desc: "Agent 是否正常响应", params: {},
    help: "无参数。返回 {\"pong\": true} 说明 Agent 与数据库都正常。" },
  "agent.info": { cat: "连接与状态", label: "查看 Agent 信息", desc: "名称、版本与支持的操作", params: {},
    help: "无参数。返回 Agent 名称、版本与支持的全部 op 列表。" },

  /* ---- 销售单 ---- */
  "bill.get": { cat: "销售单", label: "查销售出库单", desc: "按系统单号查单头/明细/可否编辑", rest: "GET /api/v1/sales/{bill_no}", params: { bill_no: "XK00000039" },
    help: "参数 bill_no：V3 系统单号（XK 开头）。返回整单明细，editable=false 时会给出原因（已审核/已收款/有关联等）。" },
  "bill.list": { cat: "销售单", label: "销售单列表", desc: "按日期/客户列出单据", rest: "GET /api/v1/sales", params: { date_from: "2026-09-01", date_to: "2026-09-10", limit: 20 },
    help: "date_from/date_to 含当天；customer 客户编号（可省）；state=0 只看正常单；limit 最大条数。" },
  "salesbill.create": { cat: "销售单", label: "新建销售出库单", desc: "真实开单（未审核草稿）", rest: "POST /api/v1/sales", params: {
      customer: "K01094", note: "调试开单", warehouse: "101-",
      lines: [ { hpbh: "60108183", unit: "支", qty: 1 } ] },
    help: "customer 客户编号；lines 至少一行，hpbh/unit/qty 必填，price 可省（按客户取价）；warehouse 默认 101- 主仓库。会真实写入 V3（未审核单），提交前自动做库存流水与合计自检。" },
  "salesbill.update": { cat: "销售单", label: "修改销售出库单", desc: "改未审核单的数量/单价/明细/客户/备注", rest: "PUT /api/v1/sales/{bill_no}", params: {
      bill_no: "XK00000039", header: { BZ_XS: "调试备注" } },
    help: "只能改未审核、无收款/发货/对账/关联的单。改明细需先 bill.get 取回全部 lines（含 iden_guid），提交完整 lines 列表：改数量/单价改对应值，删行移除该行，加行用新 hpbh/unit/qty。不给 price 自动取价。" },

  /* ---- 客户 ---- */
  "customer.search": { cat: "客户", label: "客户列表/搜索", desc: "空关键字返回列表，含应收/累计销售", rest: "GET /api/v1/customers", params: { keyword: "宏利源", limit: 20 },
    help: "keyword 支持编号/名称/拼音；keyword 为空即返回客户列表。返回 code/name/category/contact/phone/address/due/sale_sum/price_trace。" },
  "customer.get": { cat: "客户", label: "客户详情", desc: "单客户档案与往来数据", rest: "GET /api/v1/customers/{code}", params: { code: "K01094" },
    help: "返回联系人、手机、电话、地址、备注、应收 J_Due、累计销售 J_SaleSUM、价格跟踪。" },
  "customer.types": { cat: "客户", label: "客户类型", desc: "KhType 客户类别", rest: "GET /api/v1/customer-types", params: {},
    help: "无参数，返回 [{code,name}]，用于新建客户时的类别选择。" },
  "customer.save": { cat: "客户", label: "新增/修改客户", desc: "真实写库", rest: "POST/PUT /api/v1/customers", params: {
      name: "调试客户", category: "K01-", contact: "张三", phone: "13800000000",
      address: "测试地址", remark: "接口调试" },
    help: "不传 code = 新增（自动生成 K 编号）；传 code = 修改。name 必填，其余可省。" },

  /* ---- 商品 ---- */
  "product.search": { cat: "商品", label: "商品列表/搜索", desc: "空关键字返回列表，含售价/库存", rest: "GET /api/v1/products", params: { keyword: "弹簧", limit: 20 },
    help: "keyword 支持编号/名称/规格/拼音；为空返回商品列表。返回 hpbh/name/spec/unit/sale_price/stock。" },
  "product.get": { cat: "商品", label: "商品详情", desc: "单位、价格与库存", rest: "GET /api/v1/products/{hpbh}", params: { hpbh: "60108183" },
    help: "返回商品基本资料、默认单位、单位列表（UnitRate/单价）、销售价 D_SJ1、进价 D_JH、成本与库存。" },
  "product.save": { cat: "商品", label: "新增/修改商品", desc: "真实写库", rest: "POST/PUT /api/v1/products", params: {
      code: "T9999001", name: "调试商品", spec: "1*1", unit: "支", sale_price: 9.9, purchase_price: 5 },
    help: "新增必须给 code；修改时 code 为商品编号。unit 会写入 HpdanUnit；BarcodeType=9 普通商品。" },

  /* ---- 库存与取价 ---- */
  "inventory.query": { cat: "库存与取价", label: "库存查询", desc: "按货品/关键字查库存（含负库存）", rest: "GET /api/v1/inventory", params: { keyword: "砂纸", limit: 20 },
    help: "hpbh（精确编号）或 keyword（模糊）二选一即可；返回仓库、现存量与批次。" },
  "price.resolve": { cat: "库存与取价", label: "客户取价", desc: "按客户价格方案取货品价格", rest: "GET /api/v1/price", params: { customer: "K01094", hpbh: "60108183", unit: "支" },
    help: "规则：PriceTrace=201 先取最近销价(Price_Kh)，无则取默认价 D_SJ1，再无则 price=0 并标记 manual。unit 可省。" },

  /* ---- 看板与报表 ---- */
  "system.dashboard": { cat: "看板与报表", label: "经营看板", desc: "本月/今日销售与应收", rest: "GET /api/v1/dashboard/summary", params: { month_start: "2026-09-01", today: "2026-09-10" },
    help: "返回 month_amount/today_amount/today_count/receivable_total；不传日期默认本月与今天。" },
  "report.sales.summary": { cat: "看板与报表", label: "销售汇总", desc: "期间销售额/单数/均价", rest: "GET /api/v1/reports/sales-summary", params: { date_from: "2026-09-01", date_to: "2026-09-10" },
    help: "可按 customer 客户编号过滤；返回 salesAmount/salesCount/averageBillAmount。" },
  "report.sales.trend": { cat: "看板与报表", label: "销售趋势", desc: "按天/月汇总", rest: "GET /api/v1/reports/sales-trend", params: { date_from: "2026-09-01", date_to: "2026-09-10", granularity: "day" },
    help: "granularity=day|month；返回 [{date,count,amount}]。" },
  "report.customer.ranking": { cat: "看板与报表", label: "客户销售排行", desc: "期间客户销售排名", rest: "GET /api/v1/reports/customer-ranking", params: { date_from: "2026-01-01", date_to: "2026-09-10", limit: 20 },
    help: "按销售金额倒序，返回 customerId/customerName/salesCount/salesAmount。" },
  "report.product.ranking": { cat: "看板与报表", label: "商品销售排行", desc: "期间商品销量/金额排名", rest: "GET /api/v1/reports/product-ranking", params: { date_from: "2026-01-01", date_to: "2026-09-10", limit: 20 },
    help: "按销售金额倒序，返回 productId/productName/spec/quantity/salesAmount。" },
  "report.receivables.summary": { cat: "看板与报表", label: "应收汇总", desc: "客户应收余额列表", rest: "GET /api/v1/reports/receivables/summary", params: { keyword: "", only_receivable: true, limit: 20 },
    help: "来自 Khdan.J_Due；only_receivable=true 只列有欠款客户；返回总额、客户数与明细。" },
  "report.customer.product.detail": { cat: "看板与报表", label: "客户货品明细", desc: "某客户期间货品汇总", rest: "GET /api/v1/reports/customer-product-detail", params: { customer: "K01094", date_from: "2026-01-01", date_to: "2026-09-10", limit: 100 },
    help: "返回该客户期间每个货品的数量、金额、单数、均价。" },
  "report.customer.statement": { cat: "看板与报表", label: "客户往来对账单", desc: "期初/销售/收款/期末 + 流水", rest: "GET /api/v1/reports/customer-statement", params: { customer: "K01094", date_from: "2026-09-01", date_to: "2026-09-10" },
    help: "期末应收取 Khdan.J_Due；当前账套无收款流水，paymentAmount=0，期初=期末-本期销售；items 为期间销售出货流水与滚动余额。" },

  /* ---- 打印 ---- */
  "print.salesbill": { cat: "打印与任务", label: "打印销售单", desc: "报文 / HTML / 调用默认打印机", rest: "POST /api/v1/print/salesbill", params: { bill_no: "XK00000039", mode: "html", copies: 1 },
    help: "mode=payload 返回文本报文；mode=html 返回按 V3 Report_FormatSet 坐标生成的 HTML；mode=system 在 Agent 所在 Windows 电脑调用默认打印机。copies 为份数。" },
  "print.format.get": { cat: "打印与任务", label: "获取V3打印格式", desc: "Report_BillList/Mapping/FormatSet", params: { bill_name: "销售出货单" },
    help: "返回该单据的纸张宽度、分页、行高、表头/明细查询 SQL、字段映射与坐标布局（Ctrl_X/Y/W/字号/区域）。bill_name 可换购/销/盘点/调拨等。" },
  "print.format.list": { cat: "打印与任务", label: "列出V3打印方案", desc: "HxSysReport 报表方案列表", params: { rpt_type: "BillXS", db: "AccMaster" },
    help: "销售出货单 rpt_type=BillXS；AccMaster 有 8 个方案、TempUpSpRpt 有 49 个方案。返回名称/默认/自定义/版本/IDENCOL/定义字节/修改时间。" },
  "print.format.def": { cat: "打印与任务", label: "取V3打印方案定义", desc: "ReportMachine 3.0 定义（可含文本）", params: { rpt_name: "销售出货单(折后价)", rpt_type: "BillXS", db: "AccMaster", include_text: true },
    help: "返回方案元数据；include_text=true 提取内部可见字段串，include_definition=true 返回解压后定义的 base64。" },
};