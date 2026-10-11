<template>
  <view class="page has-action-bar">
    <!-- ============ 基本信息（顺序照录单习惯：先归类别，再写品名） ============ -->
    <view class="field-group">
      <view class="field-group__title">基本信息</view>
      <view class="field">
        <text class="field__label">类别<text v-if="codeNeedsCategory" class="field__req"> *</text></text>
        <picker class="field__control" :range="typeNames" @change="onTypePick">
          <view class="field__picker">
            <text :class="{ 'is-ph': !form.category }">{{ form.category || '请选择' }}</text>
            <Icon name="chevron-right" :size="15" color="text-4" />
          </view>
        </picker>
        <text v-if="codeNeedsCategory && mode === 'create'" class="field__note">
          本店按类别出号{{ codeRule.levels ? '（取 ' + codeRule.levels + ' 级）' : '' }}，选好类别就带出编号</text>
      </view>
      <view class="field">
        <text class="field__label">品名<text class="field__req"> *</text></text>
        <input class="field__control" v-model="form.name" placeholder="必填"
               placeholder-class="field__ph" @blur="syncPy" />
      </view>
      <view class="field">
        <text class="field__label">规格</text>
        <input class="field__control" v-model="form.spec" placeholder="选填，如 1*30"
               placeholder-class="field__ph" />
      </view>
      <view v-if="shopOpts.useBrandName !== false" class="field">
        <text class="field__label">品牌</text>
        <input class="field__control" v-model="form.brand" placeholder="选填"
               placeholder-class="field__ph" />
      </view>
      <view class="field">
        <text class="field__label">编号</text>
        <input class="field__control" v-model="form.code" :disabled="mode === 'edit'"
               :placeholder="codePlaceholder" placeholder-class="field__ph" @input="onCodeInput" />
      </view>
      <view class="field">
        <text class="field__label">助记码</text>
        <input class="field__control" v-model="form.py" placeholder="按名称自动生成"
               placeholder-class="field__ph" />
      </view>
      <view class="field">
        <text class="field__label">条码</text>
        <input class="field__control" v-model="form.barcode" placeholder="基本单位条码，选填"
               placeholder-class="field__ph" />
      </view>
    </view>

    <!-- ============ 单位（照录单习惯：一档一行，名称 + 比率 + 条码 横排） ============ -->
    <view class="field-group">
      <view class="field-group__title">
        <text>单位</text>
        <text class="field-group__sub">基本单位固定首位</text>
      </view>
      <text v-if="unitsOver" class="field__note">
        这货品有 {{ unitCount }} 档单位，手机端最多两档 —— 单位与单位价格这里只给看；
        要加减档位、改比率请回 V3 客户端（备注、成本价这些照样能改能存）
      </text>
      <!-- ★ 用 template 包一层再 v-if：Vue3 里 v-for 与 v-if 同标签时 v-if 先算，拿不到 u。
           ★ 隐藏**只是视图层的**：form.units 一个都不删，payload() 照原样发全部单位 ——
             服务端把"本次没提交 units"里的每一行当停用处理，过滤了发就是替客户悄悄停 units。 -->
      <template v-for="(u, i) in form.units" :key="i">
        <view v-if="showUnitRow(u)" class="urow" :class="{ 'urow--base': u.basic }">
          <view class="urow__no"><text>{{ i + 1 }}</text></view>
          <input class="urow__name" v-model="u.unit" :disabled="u.basic || unitsOver"
                 placeholder="单位名" placeholder-class="field__ph" />
          <input class="urow__rate tnum" type="number" v-model="u.rate"
                 :disabled="u.basic || !!u._locked || unitsOver" placeholder="比率" placeholder-class="field__ph" />
          <input class="urow__code" v-model="u.barcode" :disabled="unitsOver"
                 placeholder="条码（选填）" placeholder-class="field__ph" />
          <view class="urow__act" @click="toggle(i)" hover-class="hv-on" :hover-stay-time="80">
            <Icon :name="open === i ? 'chevron-down' : 'chevron-right'" :size="16" color="text-3" />
          </view>
        </view>
        <view v-if="showUnitRow(u) && open === i" class="urow__more">
          <view class="urow__line">
            <text class="urow__hint">{{ u.basic
              ? '基本单位是记账与库存的单位，比率固定为 1'
              : (u._locked
                ? '已产生业务单据，比率不可修改；如需变更请停用本档后新增'
                : `1 ${u.unit || '?'} 折成 ${convText(u)} ${baseName.value || '基本单位'}`) }}</text>
            <text v-if="u.stopped" class="tag tag--d">已停用</text>
          </view>
          <view class="switch-row">
            <view class="switch-row__label">
              <text>停用本档</text>
              <text class="field__note">停用后不可用于开单，历史单据不受影响</text>
            </view>
            <switch :checked="!!u.stopped" color="#1677ff" :disabled="u.basic || unitsOver"
                    @change="u.stopped = $event.detail.value" />
          </view>
          <view v-if="!u.basic && u._new" class="unit__del" @click="removeUnit(i)" hover-class="hv-on" :hover-stay-time="80">
            <text>删除本档（还没开过单，可以直接删）</text>
          </view>
          <view v-else-if="!u.basic" class="unit__del unit__del--tip">
            <text>已保存的单位仅可停用，不可删除</text>
          </view>
        </view>
      </template>

      <view v-if="multiUnitOn && form.units.length < MAX_UNITS" class="unit-add" @click="addUnit" hover-class="hv-on" :hover-stay-time="80">
        <Icon name="plus" :size="16" color="primary" />
        <text>添加换算单位</text>
      </view>
      <text class="field__note">{{ multiUnitOn
        ? ('比率为 1 时该档折算为多少基本单位，只能填整数；最多 ' + MAX_UNITS + ' 档（基本单位及一个换算单位），更多档位请在财鲸V3 客户端中录入')
        : '本店未启用多单位，仅按基本单位记账' }}</text>
    </view>

    <!-- ============ 单位价格（行 = 价格档，列 = 单位；照"每单位一套价"的真实建模摆） ============ -->
    <view class="field-group">
      <view class="field-group__title">
        <text>单位价格</text>
        <text class="field-group__sub">{{ priceCols.length }} 个单位 × {{ shownTiers.length }} 个价</text>
      </view>
      <scroll-view class="pmx" scroll-x :show-scrollbar="false">
        <view class="pmx__grid" :style="{ width: pmxWidth }">
          <view class="pmx__row pmx__row--head">
            <view class="pmx__lab"><text>价格档</text></view>
            <view v-for="(u, ui) in priceCols" :key="'h' + ui"
                  class="pmx__cell pmx__cell--head" :class="{ 'is-base': u.basic }">
              <text class="ellipsis">{{ u.unit || '未命名' }}</text>
              <text v-if="u.basic" class="pmx__tag">基本</text>
            </view>
          </view>
          <view v-for="(t, ti) in shownTiers" :key="t.key" class="pmx__row"
                :class="{ 'pmx__row--alt': ti % 2 === 1 }">
            <view class="pmx__lab"><text>{{ t.label }}</text></view>
            <view v-for="(u, ui) in priceCols" :key="t.key + '_' + ui" class="pmx__cell">
              <!-- ★★ 基本单位那一列绑的是**主表字段**（form[t.mainKey]）：
                   V3 要求基本单位行的价与主表逐列相等，两处一个数只留一个来源。
                   旧版在单位行里另给一套框、提交后被主表覆盖，症状就是「改基本单位单价不生效」。 -->
              <input v-if="u.basic" class="pmx__in tnum" type="digit" :disabled="unitsOver"
                     v-model="form[t.mainKey]" placeholder="—" placeholder-class="field__ph" />
              <input v-else class="pmx__in tnum" type="digit" :disabled="unitsOver"
                     v-model="u[t.unitKey]" placeholder="—" placeholder-class="field__ph" />
            </view>
          </view>
        </view>
      </scroll-view>
      <view class="more" @click="morePrice = !morePrice" hover-class="hv-on" :hover-stay-time="80">
        <text>{{ morePrice ? '收起价格档' : '展开更多价格档（共 ' + PRICE_TIERS.length + ' 档，已填 ' + filledTiers + ' 档）' }}</text>
        <Icon :name="morePrice ? 'chevron-up' : 'chevron-down'" :size="15" color="text-3" />
      </view>
      <text class="field__note">横着滑看全各档单位；某单位某一档留空 = 这一档没定价（不会被改成 0）</text>
      <view class="field-row">
        <view class="field field--half">
          <text class="field__label">成本价</text>
          <input class="field__control tnum" type="digit" v-model="form.costPrice" placeholder-class="field__ph" />
        </view>
        <view class="field field--half">
          <text class="field__label">最近销价</text>
          <view class="field__static">
            <text class="tnum">{{ recentText }}</text>
            <text v-if="form.recentSaleBill" class="field__note">来自 {{ form.recentSaleBill }}</text>
            <text v-else class="field__note">还没有销售记录</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ============ 采购与库存 ============ -->
    <view class="field-group">
      <view class="field-group__title">采购与库存</view>
      <view class="field">
        <text class="field__label">主供应商</text>
        <picker class="field__control" :range="supNames" @change="onSupPick">
          <view class="field__picker">
            <view class="field__pick-line">
              <text class="ellipsis" :class="{ 'is-ph': !supText }">{{ supText || '请选择' }}</text>
              <StopTag kind="supplier" :code="form.supplier" />
            </view>
            <Icon name="chevron-right" :size="15" color="text-4" />
          </view>
        </picker>
      </view>
      <view class="field-row">
        <view class="field field--half">
          <text class="field__label">最少起订</text>
          <input class="field__control tnum" type="digit" v-model="form.minOrder" placeholder-class="field__ph" />
        </view>
        <view class="field field--half">
          <text class="field__label">退货期限</text>
          <input class="field__control tnum" type="number" v-model="form.returnDays" placeholder-class="field__ph" />
          <text class="field__unit">天</text>
        </view>
      </view>
      <view class="field-row">
        <view class="field field--half">
          <text class="field__label">仓位</text>
          <input class="field__control" v-model="form.location" placeholder="选填" placeholder-class="field__ph" />
        </view>
        <view class="field field--half">
          <text class="field__label">保质期</text>
          <input class="field__control tnum" type="number" v-model="form.shelfDays" placeholder-class="field__ph" />
          <text class="field__unit">天</text>
        </view>
      </view>
      <text class="field__note">现库存 {{ fmtQty(form.stock) }}{{ baseName }}</text>
    </view>

    <!-- ============ 计量与其他 ============ -->
    <view class="field-group">
      <view class="field-group__title">计量与其他</view>
      <!-- ★ 尺寸两列一行（原来三列一行：卡片 464px 时每个输入只剩 32px，
           标签 + 数字 + 单位根本放不下，看着像坏了一格）。单位挂在值后面，标签不带括号。 -->
      <view class="field-row">
        <view class="field field--half">
          <text class="field__label">单重</text>
          <input class="field__control tnum" type="digit" v-model="form.weight" placeholder-class="field__ph" />
          <text class="field__unit">kg</text>
        </view>
        <view class="field field--half">
          <text class="field__label">长</text>
          <input class="field__control tnum" type="digit" v-model="form.length" placeholder-class="field__ph" />
          <text class="field__unit">cm</text>
        </view>
      </view>
      <view class="field-row">
        <view class="field field--half">
          <text class="field__label">宽</text>
          <input class="field__control tnum" type="digit" v-model="form.width" placeholder-class="field__ph" />
          <text class="field__unit">cm</text>
        </view>
        <view class="field field--half">
          <text class="field__label">体积</text>
          <input class="field__control tnum" type="digit" v-model="form.volume" placeholder-class="field__ph" />
          <text class="field__unit">m³</text>
        </view>
      </view>
      <view class="field-row">
        <view class="field field--half">
          <text class="field__label">货品折扣</text>
          <input class="field__control tnum" type="digit" v-model="form.discount" placeholder-class="field__ph" />
        </view>
        <view class="field field--half">
          <text class="field__label">积分率</text>
          <input class="field__control tnum" type="digit" v-model="form.pointsRate" placeholder-class="field__ph" />
        </view>
      </view>
      <view class="field">
        <text class="field__label">备注</text>
        <input class="field__control" v-model="form.remark" placeholder="选填" placeholder-class="field__ph" />
      </view>
      <!-- ★ 序列号：**只有本店 V3 开了（UseSerial = 1）才显示这个入口**。
           判据与"隐藏功能"那条相反 —— `!== true` 就藏：没开的店露出勾了也不生效的假开关，
           比少一个入口严重得多。隐藏也不动数据：form.serial 保持库里原值，diff 不会把它改掉。
      ★★ 批次（UseScpc）**整条撤掉，不做配置门控**：批次要一路做到单据选批、库存按批、
           进货登记批号，销售单那半还没实现 —— 在货品上留一个勾了没用的开关，
           等于让客户先替我们录一批他以后没法用的数据。整条链路完工时再一起放开。 -->
      <view v-if="shopOpts.useSerial === true" class="switch-row">
        <view class="switch-row__label">
          <text>记序列号</text>
          <text class="field__note">一物一号，用于质保追溯</text>
        </view>
        <switch :checked="!!form.serial" color="#1677ff" @change="form.serial = $event.detail.value" />
      </view>
      <view class="switch-row">
        <view class="switch-row__label">
          <text>停用</text>
          <text class="field__note">停用后不可用于开单，历史单据不受影响</text>
        </view>
        <switch :checked="!!form.stopped" color="#1677ff" @change="form.stopped = $event.detail.value" />
      </view>
    </view>

    <view class="action-bar">
      <view class="btn-ghost action-bar__item" @click="goBack" hover-class="hv-on" :hover-stay-time="80">取消</view>
      <view class="btn-primary action-bar__item" :class="{ 'is-disabled': saving || detailLoading || detailFailed }" @click="onSave" hover-class="hv-on" :hover-stay-time="80">
        {{ saving ? '保存中' : '保存' }}
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { productApi } from '../../api/product'
import { supplierApi } from '../../api/index'
import { accountOptions, loadAccountOptions } from '../../store/options'
import { fromProductForm, toProduct, toProductUnit } from '../../utils/adapt'
import { fmtQty, toast } from '../../utils/format'
import { markBillWritten } from '../../utils/billWrites'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'

const mode = ref('create')
const editId = ref('')
const saving = ref(false)
/** 详情还在读 / 根本没读到：这两种状态下不许保存（前者会覆盖回读到的值，后者是一张空表） */
const detailLoading = ref(false)
const detailFailed = ref(false)
const open = ref(-1)
const morePrice = ref(false)
const types = ref([])
const suppliers = ref([])
const supText = ref('')
// 本店 V3 的编号规则（每次向 Agent 取号时顺带回来的，**界面里不写死几位、取几级**）
const codeRule = ref(null)
// 本店 V3 的业务开关（capabilities.accountOptions）。★ 三态：只有明确 false 才隐藏功能，
//   null（没取到/库里没这行/同名多行值冲突）一律按"照常显示"，别把未知说成"没开"。
const shopOpts = ref(accountOptions())
const codeTouched = ref(false)   // 用户手改过编号 ⇒ 不再覆盖他填的
const codeAuto = ref(false)      // 当前显示的是自动带出的号

const blank = () => ({
  code: '', name: '', py: '', spec: '', category: '', categoryCode: '', barcode: '', brand: '',
  baseUnit: '', units: [], salePriceDefault: '', purchasePrice: '', costPrice: '',
  priceRetail: '', priceDiscount: '', priceSale3: '', priceSale4: '', priceSale5: '',
  priceMember: '', pricePromo: '', priceLowest: '', priceHighest: '', rebate: '',
  supplier: '', minOrder: '', returnDays: '', location: '', shelfDays: '',
  weight: '', length: '', width: '', volume: '', discount: '', pointsRate: '', remark: '',
  batch: false, serial: false, stopped: false, stock: 0,
})
const form = reactive(blank())

// 只读/回显字段：它们不是 product.save 的入参，也不参与"改没改"的比较
const SKIP_KEYS = ['id', 'hpbh', 'units', 'stock', 'stockMin', 'stockMax', 'status', 'prices',
  'recentSalePrice', 'recentSaleBill', 'salePrice', 'hasBills', 'billLines']
// ★ 打开页面那一刻的快照：payload() 拿它做 diff，只发用户真改过的列（见 payload 注释）
let baseline = {}
let unitsBaseline = ''

const typeNames = computed(() => types.value.map((t) => t.name))
const supNames = computed(() => suppliers.value.map((s) => s.name))
const baseName = computed(() => {
  const b = form.units.find((u) => u.basic)
  return b ? b.unit : (form.baseUnit || '')
})
/**
 * 价格档：一行一个档，列是各档位单位。
 * `mainKey` = 界面上主表（＝基本单位）那个字段；`unitKey` = 单位行上的同档字段。
 * ★ 两键不同名是历史形状（默认销价在界面叫 salePriceDefault、子表回来叫 salePrice），
 *   映射只准写在 adapt.js 里，这里只认界面口径的键。
 */
const PRICE_TIERS = [
  { mainKey: 'salePriceDefault', unitKey: 'salePrice', label: '默认销价' },
  { mainKey: 'priceRetail', unitKey: 'priceRetail', label: '零售价' },
  { mainKey: 'priceDiscount', unitKey: 'priceDiscount', label: '销售价2' },
  { mainKey: 'priceSale3', unitKey: 'priceSale3', label: '销售价3' },
  { mainKey: 'purchasePrice', unitKey: 'purchasePrice', label: '参考进价' },
  { mainKey: 'priceMember', unitKey: 'priceMember', label: '会员价' },
  { mainKey: 'pricePromo', unitKey: 'pricePromo', label: '促销价' },
  { mainKey: 'priceSale4', unitKey: 'priceSale4', label: '销售价4' },
  { mainKey: 'priceSale5', unitKey: 'priceSale5', label: '销售价5' },
  { mainKey: 'priceLowest', unitKey: 'priceLowest', label: '最低销价' },
  { mainKey: 'priceHighest', unitKey: 'priceHighest', label: '最高销价' },
  { mainKey: 'rebate', unitKey: 'rebate', label: '返利金' },
]
const TIERS_TOP = 5              // 默认露 5 行（与录单习惯一致），其余收进「展开更多」
/**
 * 手机端一个货品最多几档单位。★ 真源在 Agent 的 `product.MAX_UNITS`，这里只是提前挡一下
 *   （免得用户填完一整屏才吃到一个报错），两边数字不一致时以服务端为准。
 */
const MAX_UNITS = 2

const priceCols = computed(() => form.units.filter((u) => showUnitRow(u)))
const shownTiers = computed(() => (morePrice.value ? PRICE_TIERS : PRICE_TIERS.slice(0, TIERS_TOP)))
/** 首列 168rpx + 每列 168rpx；★ 这个数必须与样式里 .pmx__lab / .pmx__cell 的宽度一致 */
const pmxWidth = computed(() => `${168 + Math.max(1, priceCols.value.length) * 168}rpx`)
const recentText = computed(() => {
  const v = Number(form.recentSalePrice || 0)
  return v > 0 ? `¥${fmtQty(v)} / ${baseName.value || '基本单位'}` : '—'
})
/** 已填了几档（按基本单位那一列数，其余列是各档自己的价，不参与这个计数） */
const filledTiers = computed(() => PRICE_TIERS.filter(
  (t) => Number(form[t.mainKey] || 0) > 0).length)
/** 本店按类别出号而还没选类别 ⇒ 类别就是必填项（不填出不了号） */
const codeNeedsCategory = computed(() => mode.value === 'create'
  && !!(codeRule.value && codeRule.value.levels) && !form.categoryCode)

// ---------------- 编号（自动带出，规则来自本店 V3 配置） ----------------
const codePlaceholder = computed(() => {
  if (mode.value === 'edit') return ''
  const r = codeRule.value
  if (!r) return '不填则自动带出'
  if (r.levels && !form.categoryCode) return '选好类别后自动带出'
  return '不填则自动带出，可改'
})
function onCodeInput(e) {
  const v = String((e && e.detail && e.detail.value) || '')
  const auto = codeRule.value ? codeRule.value.code : ''
  codeTouched.value = v !== auto
  codeAuto.value = !codeTouched.value
}
/**
 * 向 Agent 取下一个编号。★ 只问一次、不缓存，也不在前端算：
 *   规则存在 V3 配置里，技术员改完配置下一个请求就该跟着变（前端算的那份必然对不上）。
 */
async function refreshCode() {
  if (mode.value === 'edit') return
  const r = await productApi.nextCode(form.categoryCode)
  if (!r || !r.ok) {
    // ★ 取号失败 ≠ 本店没有规则。capabilities 里带着 accountOptions.productCode，
    //   拿它兜底：否则星号消失、拦截解除，界面反过来说"不用选类别"，
    //   人填完整页空着编号提交，才被服务端用同一句话弹回来。
    codeRule.value = (shopOpts.value && shopOpts.value.productCode) || null
    if (!codeRule.value) toast('没取到本店编号规则：编号请手填，或先选类别')
    return
  }
  codeRule.value = r.data
  if (r.data.code && !codeTouched.value) {
    form.code = r.data.code
    codeAuto.value = true
  } else if (!r.data.code) {
    codeAuto.value = false
  }
}

// ---------------- 本店开了哪些业务开关（决定露不露某些入口） ----------------
const multiUnitOn = computed(() => shopOpts.value.multiUnit !== false)
/** 手机端最多两档（真源是 Agent 的 product.MAX_UNITS）；这边只是别让人白填一整屏。 */
const unitCount = computed(() => (form.units || []).filter((u) => String(u.unit || '').trim()).length)
const unitsOver = computed(() => unitCount.value > MAX_UNITS)
/**
 * ★ 从 V3 带回**三档以上**的货品：单位区与单位价格整块锁成只读。
 *   为什么不是整页只读 —— 提交只发"用户真改过的列"，动单位才会把 units 带上去；
 *   只改备注/成本价这种不碰单位的，服务端照样能存。所以别把能改的一起锁掉。
 *   ★ 锁的是输入框，**form.units 一条都不许删**：payload 的全集语义在那儿盯着。
 */
/** 单位行有没有被改动（改了才会把 units 发出去，见 payload 的 sig 判断）。 */
function unitsTouched() {
  return (form.units || []).map(unitSig).join('|') !== unitsBaseline
}
/** 未启用多单位时只把"基本单位"那一行留给用户看；其余行**照旧提交**（见模板注释）。 */
function showUnitRow(u) {
  return multiUnitOn.value || !!u.basic
}

function convText(u) {
  const r = Number(u.rate || 0)
  return r > 0 ? r : '—'
}
function syncPy() {
  if (!form.py && form.name) form.py = String(form.name).slice(0, 10)
}
function addUnit() {
  // 视图层的挡：只拦"再加一行"，绝不删改已有的单位行（提交语义与这行没关系）
  if (form.units.length >= MAX_UNITS) {
    toast('移动端最多支持两档单位（基本单位及一个换算单位），更多档位请在财鲸V3 客户端中录入')
    return
  }
  form.units.push({
    unit: '', rate: '', basic: false, stopped: false, barcode: '',
    salePrice: '', purchasePrice: '', _new: true,
  })
  open.value = form.units.length - 1
}
function toggle(i) { open.value = open.value === i ? -1 : i }
function removeUnit(i) {
  if (unitsOver.value) return          // 三档以上整块只读（见 unitsOver 的注释）
  if (form.units[i] && form.units[i].basic) return
  form.units.splice(i, 1)
  open.value = -1
}
function onTypePick(e) {
  const t = types.value[Number(e.detail.value)]
  if (!t) return
  form.category = t.name
  form.categoryCode = t.code
  // ★ 类别决定前缀 ⇒ 换类别要重新取号（没手改过才覆盖，手改过的留着）
  refreshCode()
}
function onSupPick(e) {
  const s = suppliers.value[Number(e.detail.value)]
  if (!s) return
  form.supplier = s.code
  supText.value = s.name
}

/**
 * 提交前的校验 —— 与 Agent 侧 product.py 的规则**一一对应**。
 * ★ 为什么两边都要挡：客户端挡是体验（不用等一个来回），
 *   服务端挡是真源（小程序旧版本、调试台、脚本都绕得过前端）。
 *   只挡一边迟早出问题：只挡服务端 ⇒ 用户点保存才知道；只挡客户端 ⇒ 换个入口就写坏数据。
 */
function validate() {
  if (!String(form.name || '').trim()) return '名称是必填的'
  // ★ 编号可以留空（保存时按本店规则自动带出）；只有"规则按类别出号 + 还没选类别"才拦，
  //   因为那种情况下服务端也只能报同一句 —— 提前挡在这里，别让人填完一整页才被弹回。
  if (mode.value === 'create' && !String(form.code || '').trim()
      && codeRule.value && codeRule.value.levels && !form.categoryCode) {
    return '本店按类别给货品编号：先选类别，或自己填一个编号'
  }
  const units = form.units.filter((u) => String(u.unit || '').trim())
  if (!units.length) return '至少需要一个基本单位'
  if (units.length !== form.units.length) return '存在未命名的单位，请填写或删除该行'
  const seen = {}
  for (const u of units) {
    const k = String(u.unit).trim().toLowerCase()
    if (seen[k]) return `单位名重复：「${u.unit}」`
    seen[k] = true
    if (String(u.unit).trim().length > 20) return `单位名过长：「${u.unit}」上限 20 字`
  }
  const basics = units.filter((u) => u.basic)
  if (basics.length !== 1) return basics.length
    ? `基本单位只能有一个，现在标了 ${basics.length} 个`
    : '必须指定一个基本单位'
  // ★ 与 Agent 的 product.MAX_UNITS 同一条规矩，这边只是别让人白填一整屏。
  //   只在**这次真的要把 units 发出去**时拦（改动过单位/单位价）—— 提交发的是"改过的列"，
  //   三档货品光改备注不该连存都存不了（单位区已经被整块锁住，正常路径走不到这里）。
  if (units.length > MAX_UNITS && unitsTouched()) {
    return `移动端最多 ${MAX_UNITS} 档单位（基本单位及一个换算单位），当前 ${units.length} 档；`
      + '更多档位请在财鲸V3 客户端中录入'
  }
  for (const u of units) {
    if (u.basic) continue
    // ★ 没被改动、也没露在界面上的档位（未启用多单位时只露基本单位那一行）不该拦一次
    //   无关的保存：那一行看不见也删不掉，报「比率须大于 0」等于把人锁在页面上存不回去。
    if (!u._new && !unitsTouched()) continue
    const r = Number(u.rate)
    if (!(r > 0)) return `单位「${u.unit}」比率须大于 0`
    if (!Number.isInteger(r)) {
      return `单位「${u.unit}」的比率要填整数：1 ${u.unit} 等于几${baseName.value || '基本单位'}`
    }
    if (r > 9999999) return `单位「${u.unit}」比率过大（上限 9999999）`
  }
  return ''
}

function payload() {
  // ★ 只发**用户真正改过的字段**。V3 的 TRI_A_Hpdan 是按列保护的：
  //   只要 SET 里出现成本价/售价/核算方法这类列，且该货品有业务单据，就直接 raiserror 拒掉 ——
  //   哪怕值没变、哪怕用户这次只是想停用一个个单位。而卖过一单之后 V3 自己会动成本价，
  //   整包回发就等于每次都去碰那些保护列。**用户意图只有界面知道**，服务端 diff 只是兜底。
  const f = {}
  Object.keys(form).forEach((k) => {
    if (SKIP_KEYS.indexOf(k) >= 0) return
    const now = form[k]
    const was = baseline[k]
    const same = (typeof now === 'number' || typeof was === 'number')
      ? (Number(now) || 0) === (Number(was) || 0)
      : String(now == null ? '' : now) === String(was == null ? '' : was)
    if (!same) f[k] = now
  })
  if (mode.value === 'create') {
    f.name = form.name
    // ★ 编号留空就**不发**这个键：让服务端按本店规则出号（界面不兜底造号，两边一份规则必漂）
    const c = String(form.code || '').trim()
    if (c) f.code = c
    else delete f.code
  } else {
    // ★ 修改时名称与助记码**照发**，不参与"只发改过的字段"：
    //   它们不在 V3 的按列保护名单里（受保护的是成本价/售价/类别/规格/单位那几组），
    //   少发这一列反而会被还没换包的老 Agent 顶成「商品名称不能为空」
    //   （2026-09-27 线上就是这个形状）。diff 的目的是**别碰受保护的列**，不是能少发就少发。
    f.name = form.name
    const py = String(form.py || '').trim()
    if (py) f.py = py
  }
  const sig = (form.units || []).map(unitSig).join('|')
  if (sig !== unitsBaseline || mode.value === 'create') {
    // ★ units 是"全集"语义：要发就发全部现存单位（少一个 = 想摘掉它，服务端会拦）
    f.units = (form.units || []).filter((u) => String(u.unit || '').trim()).map((u) => {
      const row = {
        unit: String(u.unit).trim(),
        rate: u.basic ? 1 : Number(u.rate || 0),
        basic: !!u.basic,
        stopped: !!u.stopped,
        barcode: u.barcode || '',
      }
      // ★★ 每一档价格**只发真被改过的**。没改的档不发 = 服务端不动它；
      //   全发（包括没填的 = 0）等于替客户把他录过的价抹成 0 ——
      //   子表是一列一列存的，"没发"和"发 0"完全不是一回事。
      const k = String(u.unit).trim().toLowerCase()
      const base = unitsPriceBase[k] || null
      PRICE_TIERS.forEach((t) => {
        const now = Number(u[t.unitKey] || 0)
        if (base === null) { if (now > 0) row[t.unitKey] = now }
        else if (now !== Number(base[t.unitKey] || 0)) row[t.unitKey] = now
      })
      return row
    })
  }
  if (f.categoryCode) { f.category = f.categoryCode; delete f.categoryCode }
  // ★ 这里**不自己拼后端字段名**：units 也用界面口径（驼峰），
  //   统一交给 fromProductForm 翻译。两处各写一套键名就是上次静默丢字段的根因。
  return fromProductForm(f)
}

/** 单位行的"变了没有"：名称/比率/停用/条码 + **全部价格档**（少算一档就会漏发） */
function unitSig(u) {
  const bits = [u.unit, u.basic ? 1 : 0, Number(u.rate) || 0, u.stopped ? 1 : 0,
    u.barcode || '']
  PRICE_TIERS.forEach((t) => bits.push(Number(u[t.unitKey] || 0)))
  return bits.join(',')
}
/** 打开页面那一刻每档单位的价：payload 拿它逐档 diff（只发真改过的档） */
let unitsPriceBase = {}
function snapshotUnitPrices(list) {
  unitsPriceBase = {};
  (list || []).forEach((u) => {
    const k = String(u.unit || '').trim().toLowerCase()
    if (!k) return
    const row = {}
    PRICE_TIERS.forEach((t) => { row[t.unitKey] = Number(u[t.unitKey] || 0) })
    unitsPriceBase[k] = row
  })
}

async function load() {
  const [tr, sr, op] = await Promise.all([
    productApi.types(),
    supplierApi.list({ pageSize: 200 }),
    loadAccountOptions(),
  ])
  shopOpts.value = op
  if (tr && tr.ok) types.value = tr.data || []
  if (sr && sr.ok) {
    const d = sr.data || {}
    const list = d.list || d.items || (Array.isArray(d) ? d : [])
    suppliers.value = list.map((s) => ({ code: s.code || s.id, name: s.name || s.supplierName }))
  }
  if (mode.value !== 'edit' || !editId.value) {
    if (!form.units.length) {
      form.units = [{ unit: '个', rate: 1, basic: true, stopped: false, barcode: '', salePrice: '', purchasePrice: '' }]
      form.baseUnit = '个'
    }
    refreshCode()      // 新增页一打开就先取规则（有没有类别都能取到，见 nextCode）
    return
  }
  detailLoading.value = true
  const res = await productApi.detail(editId.value)
  if (!res.ok) {
    // ★ 读不到资料就别留一张**空白但可编辑**的表：在那上面点保存只会报
    //   "至少需要一个基本单位"，与真实原因（这货品没读到/已被别处删）毫无关系。
    toast(res.message || '没读到这个货品')
    detailFailed.value = true
    setTimeout(() => { if (detailFailed.value) uni.navigateBack() }, 1600)
    return
  }
  const p = toProduct(res.data || {})
  const typed = { name: String(form.name || '').trim(), code: String(form.code || '').trim() }
  Object.assign(form, p)
  // ★ 详情回来时不许覆盖人已经打进去的字（Agent 慢的时候他会先动名称/编号，
  //   整表一盖就是"存了个寂寞"，而 baseline 也跟着变成新值，连"改过"都判不出来）
  if (typed.name) form.name = typed.name
  if (typed.code) form.code = typed.code
  detailLoading.value = false
  // ★ 已有业务单据 ⇒ 现存单位的倍率锁死（后端也会拒，这里先别让人白填）
  form.units = (p.units || []).map((u) => ({
    ...toProductUnit(u), _new: false, _locked: !!p.hasBills,
  }))
  baseline = Object.assign({}, p)
  unitsBaseline = form.units.map(unitSig).join('|')
  snapshotUnitPrices(form.units)   // 逐档 diff 的基准（没改的档不发，见 payload 注释）
  supText.value = p.supplier || ''
  const hit = suppliers.value.find((s) => s.code === p.supplier)
  if (hit) supText.value = hit.name
}

async function onSave() {
  if (saving.value || detailLoading.value || detailFailed.value) return
  const err = validate()
  if (err) { toast(err); return }
  saving.value = true
  const body = payload()
  const res = mode.value === 'create'
    ? await productApi.create(body)
    : await productApi.update(editId.value, body)
  saving.value = false
  if (res.ok) {
    markBillWritten('product')   // 列表页据此决定要不要刷（看一眼不该刷回第 1 页）
    // ★ 自动带出的号在保存响应里回来 —— 提示写的是**真正存进去的那个号**，
    //   不是界面当初显示的那一个（中间可能已被占用/规则刚被人改过）。
    const saved = String((res.data || {}).code || '')
    toast(saved && codeAuto.value ? `已建好，编号 ${saved}` : '保存成功', 'success')
    setTimeout(goBack, 400)
  }
  else toast(res.message || '保存失败')
}
function goBack() { uni.navigateBack() }

onLoad((q) => {
  editId.value = q.id || q.code || q.hpbh || ''
  mode.value = q.mode || (editId.value ? 'edit' : 'create')
  load()
})
</script>

<style lang="scss" scoped>
.field__ph { color: $color-text-4; font-size: $fs-body; }
/* ★ 本页标签列比全局窄：编号 14 位、条码 13 位，168rpx 的标签会把值挤断。
     scoped 选择器带 [data-v-*]，权重高于 App.vue 里的全局 .field__label。 */
.field__label { width: 128rpx; }
/* 单位挂在值后面：kg / cm / 天 —— 标签里不带括号就不会折行撑高 */
.field__unit { flex: 0 0 auto; font-size: $fs-mini; color: $color-text-3; margin-left: 4rpx; }
.field__req { color: $color-danger; }
.field__note { display: block; font-size: $fs-micro; color: $color-text-3; margin-top: $space-tight; line-height: 1.5; }
.is-locked { background: $color-bg-sunken; color: $color-text-2; }
.field-row { display: flex; gap: $space-inner; }
.field--half { flex: 1; min-width: 0; }
.field__picker { display: flex; align-items: center; justify-content: space-between; gap: $space-inner; font-size: $fs-body; }
.field__pick-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10rpx; }
.field__picker .is-ph { color: $color-text-4; }

.field-group__title { display: flex; align-items: baseline; justify-content: space-between; }
.field-group__sub { font-size: $fs-micro; color: $color-text-3; font-weight: $fw-normal; }

/* ---- 单位（一档一行：名称 + 比率 + 条码 横排） ---- */
.urow { display: flex; align-items: center; gap: $space-tight; padding: 14rpx 0;
  border-bottom: 1rpx solid $color-divider; }
.urow--base { border-bottom: 1rpx solid $color-primary-border; }
.urow__no { width: 40rpx; flex: none; text-align: center; font-size: $fs-micro; color: $color-text-3; }
.urow--base .urow__no { color: $color-primary-dark; font-weight: $fw-bold; }
/* ★★ uni-input 自带 `height: 1.4em`（实测 26px）：给它加**上下 padding** 会把内容区压成 9px，
     字被上下裁掉（手机上就是"输入框里内容看不见"）。要撑高只能定 height + line-height。 */
.urow__name, .urow__rate, .urow__code { box-sizing: border-box; height: 60rpx; line-height: 60rpx;
  background: $color-bg-sunken; border-radius: $radius-tag; padding: 0 14rpx;
  color: $color-text; font-size: $fs-caption; }
.urow__name { width: 136rpx; flex: none; font-weight: $fw-bold; }
.urow__rate { width: 104rpx; flex: none; text-align: right; }
.urow__code { flex: 1; min-width: 0; color: $color-text-2; }
.urow__act { width: 44rpx; flex: none; display: flex; align-items: center; justify-content: center; }
.urow__more { background: $color-bg-sunken; border-radius: $radius-card-sm;
  padding: 14rpx $space-inner; margin: 10rpx 0 14rpx; }
.urow__line { display: flex; align-items: center; justify-content: space-between; gap: $space-inner; }
.urow__hint { flex: 1; min-width: 0; font-size: $fs-mini; color: $color-text-2; line-height: 1.45; }
.unit__del { padding: 14rpx 0 0; font-size: $fs-mini; color: $color-danger; }
.unit__del--tip { color: $color-text-3; font-size: $fs-micro; }
.unit-add { display: flex; align-items: center; justify-content: center; gap: $space-tight;
  padding: $space-inner; border: 1rpx dashed $color-primary-border; border-radius: $radius-card-sm;
  color: $color-primary-dark; font-size: $fs-caption; font-weight: $fw-bold; margin-top: $space-inner; }
/* ---- 单位价格矩阵（行=价格档，列=单位；横向可滚） ---- */
/* ★ lab 与 cell 的宽度**必须与 pmxWidth 的算法一致**（上一版按 190rpx 算，
     但 padding 没算进 box-sizing ⇒ 实际每列 210rpx，第三列被裁一半）。 */
.pmx { width: 100%; }
.pmx__grid { display: flex; flex-direction: column; }
.pmx__row { display: flex; align-items: center; min-height: 84rpx; }
.pmx__row--head { min-height: 64rpx; border-bottom: 1rpx solid $color-border; }
.pmx__row--alt { background: $color-bg-sunken; border-radius: $radius-tag; }
.pmx__lab { width: 168rpx; flex: none; box-sizing: border-box; padding: 0 $space-tight;
  font-size: $fs-caption; color: $color-text-2; }
.pmx__cell { width: 168rpx; flex: none; box-sizing: border-box; padding: 8rpx 8rpx; }
.pmx__cell--head { padding-bottom: 0; display: flex; flex-direction: row; align-items: baseline;
  gap: 6rpx; font-size: $fs-caption; font-weight: $fw-bold; color: $color-text; }
.pmx__cell--head.is-base { color: $color-primary-dark; }
.pmx__tag { font-size: $fs-micro; color: $color-primary-dark; font-weight: $fw-normal; }
.pmx__in { width: 100%; box-sizing: border-box; background: $color-card;
  border: 1rpx solid $color-border; border-radius: $radius-tag;
  height: 60rpx; line-height: 60rpx; padding: 0 14rpx;
  font-size: $fs-caption; color: $color-text; text-align: right; }
.field__static { display: flex; flex-direction: column; gap: 2rpx; padding: 10rpx 0; font-size: $fs-body; }
.tag { font-size: $fs-micro; padding: 2rpx 10rpx; border-radius: $radius-tag; background: $color-bg-sunken; color: $color-text-2; }
.tag--p { background: $color-primary-bg; color: $color-primary-dark; }
.tag--d { background: $color-danger-bg; color: $color-danger; }

/* ---- 折叠 / 开关行 ---- */
.more { display: flex; align-items: center; justify-content: space-between;
  padding: $space-inner 0; border-top: 1px dashed $color-border; font-size: $fs-mini; color: $color-text-2; }
.switch-row { display: flex; align-items: center; justify-content: space-between; gap: $space-inner;
  padding: $space-inner 0; border-top: 1px solid $color-divider; }
.switch-row__label { flex: 1; min-width: 0; font-size: $fs-body; }
.switch-row__label .field__note { margin-top: 2rpx; }
.action-bar__item { flex: 1; }
.is-disabled { opacity: 0.5; }
</style>
