/**
 * 取价逻辑（三级回退，对应会话 price.resolve）
 *   1. customer.priceTrace == 201 → 该客户该商品最近销价
 *   2. 否则 → product.salePriceDefault (D_SJ1)
 *   3. 都没有 → 0 + manual=true（需人工填）
 *
 * @returns {{ price:number, source:string, manual:boolean }}
 *   source: 'recent' | 'default' | 'manual'
 */
export function resolvePrice(customer, product, unit) {
  // 1. 最近销价
  if (customer && customer.priceTrace === 201) {
    const recent = pickUnitPrice(product, unit, 'recentSalePrice')
    if (recent != null && recent > 0) {
      return { price: recent, source: 'recent', manual: false }
    }
  }
  // 2. 默认销价
  const def = pickUnitPrice(product, unit, 'salePrice')
  if (def != null && def > 0) {
    return { price: def, source: 'default', manual: false }
  }
  // 3. 人工
  return { price: 0, source: 'manual', manual: true }
}

/** 从多单位里取指定单位的价格，回退到商品级字段 */
function pickUnitPrice(product, unit, field) {
  if (!product) return null
  if (unit && Array.isArray(product.units)) {
    const u = product.units.find((x) => x.unit === unit)
    if (u && u[field] != null) return u[field]
  }
  // 商品级回退
  if (field === 'recentSalePrice') return product.recentSalePrice
  if (field === 'salePrice') return product.salePriceDefault
  return null
}

export const PRICE_SOURCE_LABEL = {
  recent: '最近销价',
  default: '默认销价',
  manual: '需人工填',
  none: '无价格',
  // ★ 多单位：后端按客户取价取不到、退回**这个单位档案上填的售价**时走这条。
  //   没有它的话界面会直接显示原始键名 "unit"（用户看不懂，还会以为在瞎报价）。
  unit: '该单位档案价',
}
