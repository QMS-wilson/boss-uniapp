<template>
  <view class="page has-action-bar">
    <LoadState :loading="loading" :error="error" skeleton skeleton-variant="detail" skeleton-pad="page" @retry="load">
      <template v-if="prod">
        <!-- 商品头部 -->
        <view class="card">
          <view class="head">
            <text class="head__name ellipsis">{{ prod.name }}</text>
            <StopTag kind="product" :code="prod.code || prod.hpbh"
                     :label="prod.statusName && prod.statusName !== '正常使用' ? prod.statusName : ''" />
          </view>
          <view class="grid">
            <view class="grid__cell">
              <text class="grid__label">编码</text>
              <text class="grid__value tnum">{{ prod.code || '—' }}</text>
            </view>
            <view class="grid__cell">
              <text class="grid__label">条码</text>
              <text class="grid__value tnum">{{ prod.barcode || '—' }}</text>
            </view>
            <view class="grid__cell">
              <text class="grid__label">规格</text>
              <text class="grid__value">{{ prod.spec || '—' }}</text>
            </view>
            <view class="grid__cell">
              <text class="grid__label">类别</text>
              <text class="grid__value">{{ prod.category || '—' }}</text>
            </view>
            <view class="grid__cell">
              <text class="grid__label">基本单位</text>
              <text class="grid__value">{{ prod.baseUnit || '—' }}</text>
            </view>
          </view>
        </view>

        <!-- 价格：默认展示前 PRICE_PREVIEW 项，其余「展开」显示 -->
        <view class="card">
          <view class="section-head">
            <text class="section-head__title">价格</text>
            <view
              v-if="priceList.length > PRICE_PREVIEW"
              class="section-head__action section-head__action--link"
              @click="showAllPrices = !showAllPrices" hover-class="hv-on" :hover-stay-time="80">
              <text>{{ showAllPrices ? '收起' : '展开全部 ' + priceList.length + ' 项' }}</text>
              <Icon v-if="showAllPrices" name="chevron-up" :size="14" color="primary" />
              <Icon v-else name="chevron-down" :size="14" color="primary" />
            </view>
          </view>
          <view v-for="p in visiblePrices" :key="p.key" class="row">
            <text class="row__label">{{ p.label }}</text>
            <AmountText :value="p.value" :unit="'/' + prod.baseUnit" tone="primary" />
          </view>

          <!-- 多单位：库里是子表（一单位一行、每单位一套价），这里只做展示 -->
          <view v-if="prod.units && prod.units.length" class="units">
            <view class="units__head">
              <text class="units__title">单位与价格</text>
              <text class="units__hint">库存那一列是折算出来的数，扣减仍按基本单位</text>
              <!-- 包装这两栏是多单位档位的从属值，V3 自己算、我们照它口径写，界面只回显不给填 -->
              <text v-if="prod.packUnit || prod.packSpec" class="units__hint">
                包装单位 {{ prod.packUnit || '—' }} · 包装规格 {{ prod.packSpec || '—' }}
              </text>
            </view>
            <view v-for="(u, ui) in prod.units" :key="u.unit || ui" class="units__row"
                  :class="{ 'units__row--stop': u.stopped }">
              <view class="units__name">
                <text>{{ u.unit }}</text>
                <text v-if="u.basic" class="tag tag--p">基本</text>
                <text v-if="u.stopped" class="tag tag--d">已停用</text>
              </view>
              <text class="units__rate tnum">{{ u.basic ? '—' : '= ' + fmtQty(u.rate) + (prod.baseUnit || '') }}</text>
              <view class="units__money">
                <text class="tnum">¥{{ fmtMoney(u.salePrice) }}</text>
                <text class="units__in tnum">进 ¥{{ fmtMoney(u.purchasePrice) }}</text>
              </view>
              <text class="units__stock tnum">{{ stockIn(u) }}</text>
            </view>
          </view>
        </view>

        <!-- 库存 -->
        <view class="card">
          <view class="section-head">
            <text class="section-head__title">库存</text>
          </view>
          <view class="stock">
            <text class="stock__label">当前库存</text>
            <view class="stock__fig">
              <text class="stock__num tnum" :class="{ 'is-neg': invQty < 0 }">{{ invQty }}</text>
              <text class="stock__unit">{{ prod.baseUnit }}</text>
            </view>
          </view>
          <view v-if="invQty < 0" class="stock__tip">
            <Icon name="alert-circle" :size="14" color="warning" />
            <text>负库存：本账套没录期初、进货单也录得少，出货已扣但入库没有来源。</text>
          </view>
        </view>

        <view class="action-bar">
          <view class="btn-ghost action-bar__item" @click="goNewBill" hover-class="hv-on" :hover-stay-time="80">以此开单</view>
          <view class="btn-primary action-bar__item" @click="goEdit" hover-class="hv-on" :hover-stay-time="80">编辑 / 改价</view>
        </view>
      </template>
    </LoadState>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { productApi } from '../../api/product'
import { inventoryApi } from '../../api/index'
import { fmtMoney, fmtQty, toast } from '../../utils/format'
import AmountText from '../../components/AmountText.vue'
import LoadState from '../../components/LoadState.vue'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'

const id = ref('')
const prod = ref(null)
const invQty = ref(0)
const loading = ref(true)
const error = ref('')

/* ------------------------------------------------------------------ 价格
 * ★★ 2026-09-23 需求：把 V3 的各价类都完善进页面，默认展示 4 项、可展开。
 *   价格清单以后端 `prices` 为准（Agent product.get 已返回 10 项：
 *   默认销价/最近销价/进价/成本价 + 零售价/优惠价/销售价3/4/5/最低销价）。
 *   后端没给 `prices`（老 exe）时，回退成原来那 4 项 —— 保证不因后端版本而白屏。
 */
const PRICE_PREVIEW = 4
const showAllPrices = ref(false)
const priceList = computed(() => {
  const raw = prod.value?.prices
  if (Array.isArray(raw) && raw.length) return raw
  const p = prod.value || {}
  return [
    { key: 'sale_price', label: '默认销价', value: p.salePriceDefault || 0 },
    { key: 'recent_sale_price', label: '最近销价', value: p.recentSalePrice || 0 },
    { key: 'purchase_price', label: '进价', value: p.purchasePrice || 0 },
    { key: 'cost_price', label: '成本价', value: p.costPrice || 0 },
  ]
})
const visiblePrices = computed(() => (showAllPrices.value
  ? priceList.value
  : priceList.value.slice(0, PRICE_PREVIEW)))

/**
 * 该单位下的折算库存。
 * ★ 库存只有基本单位一个口径（Inventory 按基本单位记），这里 `库存 ÷ 倍率`
 *   只是**给人看的折算**，不是"这个单位还有独立的一份库存" —— 所以文案带着单位名、
 *   表头也写明了是折算。倍率坏了（0/负/非数）时宁可显示 — 也不要显示一个假数。
 */
function stockIn(u) {
  const base = Number((prod.value && prod.value.stock) || 0)
  const rate = Number(u && u.rate)
  const name = (u && u.unit) || ''
  if (!(rate > 0)) return '—'
  return fmtQty(base / rate) + name
}

async function load() {
  loading.value = true; error.value = ''
  // ★ 按编号查库存（不是拉全量再 find）：tongda 那套账有 1.3 万条库存记录，
  //   全量取不完，find 就会偶发漏掉 → 现存量显示 0。
  const [pRes, iRes] = await Promise.all([
    productApi.detail(id.value), inventoryApi.list({ productId: id.value }),
  ])
  loading.value = false
  if (pRes.ok) prod.value = pRes.data
  else { error.value = pRes.message; return }
  if (iRes.ok) invQty.value = iRes.data.total.qty
}
function goEdit() { uni.navigateTo({ url: '/pages/product/edit?mode=edit&id=' + id.value }) }
/**
 * 「以此开单」：带着这个商品进开单页，进去后自动弹客户面板。
 * ★ 顺序是"先带行、后选客户"（不是先弹客户再进页）：客户面板本来就长在开单页里，
 *   抽成公共组件要动取价与「是否跟随变动」那一整串逻辑，不值这一趟。
 * ★ 只在这张单还没有客户时才自动弹（seedPending 在开单页里管），从别处回来不重复弹。
 */
function goNewBill() {
  uni.navigateTo({
    url: '/pages/sales/edit?mode=create&fromProduct=' + encodeURIComponent(id.value) + '&pickCustomer=1',
  })
}

onLoad((q) => { id.value = q.id; load() })
// ★ 从「修改商品资料」返回时必须刷新（与客户/供应商详情同理）。
let entered = false
onShow(() => {
  if (!entered) { entered = true; return }
  if (id.value) load()
})
</script>

<style lang="scss" scoped>
.head { display: flex; align-items: center; gap: 16rpx; margin-bottom: 24rpx; }
.head__name { flex: 1; min-width: 0; font-size: 40rpx; font-weight: $fw-heavy; }
.head__stop {
  flex: 0 0 auto;
  font-size: $fs-micro;
  color: $color-text-3;
  background: $color-bg-sunken;
  padding: 4rpx 12rpx;
  border-radius: $radius-tag;
}

/* 属性栅格 */
.grid {
  display: flex;
  flex-wrap: wrap;
  border-top: 1rpx solid $color-divider;
  padding-top: 20rpx;
}
.grid__cell { width: 50%; padding: 10rpx 0; min-width: 0; }
.grid__label { display: block; font-size: $fs-mini; color: $color-text-3; }
.grid__value {
  display: block;
  margin-top: 6rpx;
  font-size: $fs-caption;
  color: $color-text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 键值行 */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 84rpx;
  border-bottom: 1rpx solid $color-divider;
  gap: $space-inner;
}
.row:last-child { border-bottom: 0; }
.row__label { font-size: $fs-body; color: $color-text-2; flex: 0 0 auto; }
.row__value {
  font-family: $font-num;
  font-size: $fs-num-lg;
  font-weight: $fw-bold;
  color: $color-text;
}

/* 「展开全部 N 项 / 收起」是能点的，跟隔壁那些灰色说明文字同一个颜色就会被当成注解 */
.section-head__action--link { color: $color-primary; }

/* 多单位 */
.units { margin-top: 20rpx; padding-top: 20rpx; border-top: 1rpx solid $color-divider; }
.units__head { display: flex; flex-direction: column; gap: 4rpx; margin-bottom: 12rpx; }
.units__title { font-size: $fs-mini; color: $color-text-3; }
.units__hint { font-size: $fs-micro; color: $color-text-4; line-height: 1.5; }
.units__row {
  display: flex;
  align-items: center;
  gap: $space-inner;
  padding: 12rpx 0;
  border-bottom: 1rpx solid $color-divider;
}
.units__row:last-child { border-bottom: 0; }
.units__row--stop { opacity: 0.5; }
.units__name { display: flex; align-items: center; gap: 8rpx; flex: 0 0 150rpx;
  font-size: $fs-body; font-weight: $fw-bold; }
.units__rate { font-family: $font-num; font-size: $fs-mini; color: $color-text-2; flex: 0 0 130rpx; }
.units__money { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 2rpx; }
.units__money text:first-child { font-family: $font-num; font-size: $fs-caption; font-weight: $fw-bold; color: $color-primary; }
.units__in { font-family: $font-num; font-size: $fs-micro; color: $color-text-3; }
.units__stock { font-family: $font-num; font-size: $fs-mini; color: $color-text-2; flex: 0 0 auto; }
.tag { font-size: $fs-micro; padding: 2rpx 10rpx; border-radius: $radius-tag; background: $color-bg-sunken; color: $color-text-2; }
.tag--p { background: $color-primary-bg; color: $color-primary-dark; }
.tag--d { background: $color-danger-bg; color: $color-danger; }

/* 库存 */
.stock { display: flex; align-items: baseline; justify-content: space-between; padding: 12rpx 0; }
.stock__label { font-size: $fs-body; color: $color-text-2; }
.stock__fig { display: flex; align-items: baseline; gap: 8rpx; }
.stock__num {
  font-family: $font-num;
  font-size: 52rpx;
  font-weight: $fw-heavy;
  color: $color-text;
  line-height: 1.1;
}
.stock__num.is-neg { color: $color-danger; }
.stock__unit { font-size: $fs-mini; color: $color-text-4; }
.stock__tip {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 12rpx;
  padding: 14rpx 18rpx;
  border-radius: $radius-card-sm;
  background: $color-warning-bg;
  font-size: $fs-mini;
  color: $color-warning;
}

.action-bar__item { flex: 1; }
</style>
