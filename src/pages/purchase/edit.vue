<template>
  <view class="page has-action-bar has-action-bar--total">
    <LoadState :loading="loading" :error="error" @retry="load">
      <template v-if="ready">
        <!-- ★★ 单头结构**与销售开单页逐项对齐**（2026-09-22 第十轮用户需求：
             「采购开单界面应调整至与销售开单界面差不多」）：
               单号(仅 edit) → 日期(可改，含时分秒) → 供应商 → 状态(仅 edit)
             ★ 与销售页的唯一结构差异：没有「价格方案」。
               采购价没有「方案」概念 —— 它来自货品档案的进货价（Hpdan.D_JH），
               不是按客户/供应商的取价策略选列。硬塞一个选择器只会误导用户。
             沿用销售页的类名（.head-row / .head-picker / .item-card …），
             两页的视觉与手感由同一套样式保证，不用两处各调一遍。 -->
        <view class="card">
          <template v-if="mode === 'edit'">
            <view class="head-row">
              <text class="label">单号</text>
              <text class="value value--readonly">{{ form.billNo || '—' }}</text>
            </view>
          </template>
          <!-- 从草稿箱续开的：还没有单号，但"这是一张草稿、什么时候存的"要写出来 -->
          <template v-else-if="draftId">
            <view class="head-row">
              <text class="label">状态</text>
              <view class="head-draft">
                <StatusTag status="draft" />
                <text v-if="draftSavedAt" class="head-draft__at">存于 {{ draftStampText(draftSavedAt) }}</text>
              </view>
            </view>
          </template>

          <view class="head-row">
            <text class="label">日期</text>
            <view class="head-dt">
              <picker class="head-picker" mode="date" :value="datePart" :disabled="!canEdit" @change="onDatePick">
                <view class="head-picker__box">
                  <text class="head-picker__text">{{ datePart }}</text>
                  <Icon v-if="canEdit" name="calendar" :size="18" color="primary" />
                </view>
              </picker>
              <picker class="head-picker" mode="time" :value="timePart" :disabled="!canEdit" @change="onTimePick">
                <view class="head-picker__box">
                  <text class="head-picker__text">{{ timePart }}</text>
                  <Icon v-if="canEdit" name="clock" :size="18" color="primary" />
                </view>
              </picker>
            </view>
          </view>

          <view class="section-head"><text class="section-head__title">供应商</text></view>
          <view class="customer-pick" @click="openSupplierPicker" hover-class="hv-on" :hover-stay-time="80">
            <template v-if="form.supplierName">
              <view class="cust-info">
                <view class="cust-name-line">
                  <text class="cust-name ellipsis">{{ form.supplierName }}</text>
                  <StopTag kind="supplier" :code="form.supplierId" />
                </view>
                <text class="cust-meta">{{ selectedSupplier?.mobile || '' }} · 进价取货品档案</text>
              </view>
              <view v-if="canEdit" class="pick-arrow"><text>更换</text><Icon name="chevron-right" :size="20" color="primary" /></view>
            </template>
            <template v-else>
              <text class="pick-placeholder">请选择供应商</text>
              <view class="pick-arrow"><Icon name="chevron-right" :size="20" color="primary" /></view>
            </template>
          </view>
          <text class="scheme-hint">新增商品的进价默认取货品档案的进货价；无进价时回退到成本价</text>

          <template v-if="mode === 'edit'">
            <view class="head-row">
              <text class="label">状态</text>
              <StatusTag :status="form.status" />
            </view>
          </template>
        </view>

        <!-- 明细 -->
        <view class="card">
          <view class="section-head"><text class="section-head__title">明细</text></view>
          <view v-for="(it, i) in form.items" :key="i" :id="'line-' + i" class="item-card"
                :class="{ 'item-card--hl': hlIndex === i }">
            <view class="item-top">
              <!-- 品名 + 规格 合成一块「描述块」：点一下展开看全文，再点收回（收起态是默认态）。
                   与销售开单页同一套交互。★ 热区只包这一块 —— `.it-units` / `.it-del` 是
                   .item-top 的直接子元素、在热区外，所以**不需要 @click.stop**；别把热区
                   做成整个 .item-top，那样点 ✕ 会顺带收起展开态。 -->
              <view class="it-name-line" :class="{ 'it-name-line--open': openDescItem === it }"
                    @click="toggleDesc(it)" hover-class="hv-on" :hover-stay-time="80">
                <text class="it-name" :class="{ ellipsis: openDescItem !== it }">{{ it.name }}</text>
                <StopTag kind="product" :code="it.productId" />
                <!-- 规格：收起态挤在品名同行（.it-name 限宽 52%，两边都可截断）；展开态不在这渲染 -->
                <text v-if="openDescItem !== it" class="it-spec ellipsis">{{ specLine(it) }}</text>
                <Icon :name="openDescItem === it ? 'chevron-up' : 'chevron-down'" :size="14" color="text-3" />
              </view>
              <!-- ★ 单位胶囊与品名同行居右（与销售页同一套版式）：一条明细不许占满半屏 -->
              <view class="it-units">
                <text v-for="(u, ui) in it.units" :key="ui" class="uchip"
                      :class="{ 'uchip--on': it.unit === u.unit }"
                      @click="canEdit && switchUnit(it, u)">{{ u.unit }}</text>
              </view>
              <view v-if="canEdit" class="it-del" @click="removeItem(i)" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="20" color="danger" /></view>
            </view>
            <!-- 展开态才挂回这一行：规格全文独占一行 = 改造前那套「两行布局」，用户不用学新东西 -->
            <view v-if="openDescItem === it" class="it-spec-row">
              <text class="it-spec">{{ specLine(it) }}</text>
            </view>
            <view class="item-edit">
              <view class="edit-field edit-field--qty">
                <text class="edit-label">数量</text>
                <input class="edit-input tnum" type="digit" v-model="it.qty" :disabled="!canEdit" @input="recalc(it)" />
              </view>
              <view class="edit-field">
                <text class="edit-label">单价</text>
                <input class="edit-input tnum" type="digit" v-model="it.price" :disabled="!canEdit" @input="recalc(it)" />
              </view>
              <view class="edit-amt">
                <text class="amt-label">金额</text>
                <AmountText :value="it.amount" />
              </view>
            </view>
            <text v-if="it.priceSource" class="price-src">取价：{{ it.priceSource }}</text>

            <!-- 行备注（落 JHMX.BZ_JHMX）。
                 ★ 备注常驻、位置一个字没动 —— 它的位置风险（贴着 ✕）上一版被指出来了，不重蹈 -->
            <view class="item-remark">
              <text class="rm-label">备注</text>
              <input class="rm-input" v-model="it.remark" :disabled="!canEdit" placeholder="选填" />
              <!-- 赠品：点一下这一行就不计入合计（单价还留着，那是这批货的价值）。
                   与销售开单页同一颗控件、同一句口径、同一个落点。
                   ★ 放备注行而不是「数量/单价/金额」那一行：赠品挤进数量行会把单价框压到只剩
                     56px 可用，而单价 5 位整数（12345.00 需 60.2px）就溢出；
                     也不放「取价」那一行（销售页的取价在 @click 整行里，要配 @click.stop）。
                     取舍详见 docs/UI审阅-20261009.md U7-b。 -->
              <view class="gift-tg" :class="{ 'gift-tg--on': it.gift }" :id="'btn-gift-' + i"
                    @click="toggleGift(it)" hover-class="hv-on" :hover-stay-time="80">
                <Icon v-if="it.gift" name="tag" :size="14" color="white" />
                <Icon v-else name="tag" :size="14" color="text-3" />
                <text class="gift-tg__t">赠品</text>
              </view>
            </view>
          </view>

          <!-- 添加商品。★ 与销售页同一套「未选往来单位则禁用」逻辑，理由同源：
               明细单价依赖供应商（要读该供应商的默认仓 / 后续按供应商取价），
               没选供应商就加行，等于先填一个没人负责的价格，后面还得逐行改。 -->
          <view
            v-if="canEdit"
            class="add-item"
            :class="{ 'is-disabled': !form.supplierId }"
            @click="onAddItem" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="plus" :size="20" color="primary" /> 添加商品
          </view>
          <text v-if="canEdit && !form.supplierId" class="add-item-hint">先选供应商 —— 价格要按供应商档案取</text>
          <!-- 「暂无明细」只在没有别的提示占位时才说（与销售开单页同一处理，2026-10-10） -->
          <view v-if="!form.items.length && !(canEdit && !form.supplierId)" class="empty-items">暂无明细，请添加商品</view>
          <text v-if="giftCount" class="gift-note">含赠品 {{ giftCount }} 种 · {{ fmtMoney(giftAmount) }} 不计入合计</text>
          <!-- 整单备注（落 JH 单头）。合计搬进底栏后这一行留在明细卡尾，与销售页同位置。 -->
          <view class="memo-row">
            <text class="label">备注</text>
            <input class="memo-input" v-model="form.memo" :disabled="!canEdit" placeholder="选填" />
          </view>
          <!-- ★ 备注长度提示：JH.NoteCode 只有 **20 字**，超了后端会截断，
               不提示的话用户会以为整段都存进去了（sale 侧没这个限制，别照抄）。 -->
          <text v-if="memoLen > 20" class="memo-warn">
            单头备注超 20 字，超出部分不会保存（V3 列长限制）
          </text>
        </view>

        <!-- 提交。★ 合计常驻底栏，与销售开单页同一套（见 App.vue 的 .action-bar--total） -->
        <view class="action-bar action-bar--total">
          <view class="bar-total">
            <text>共 {{ form.items.length }} 种 · {{ totalQty }} 件</text>
            <view class="bar-total__amt"><text>合计</text>
              <AmountText :value="totalAmount" /></view>
          </view>
          <view class="bar-btns">
            <view class="btn-ghost action-bar__item" @click="onCancelTap" hover-class="hv-on" :hover-stay-time="80">取消</view>
            <!-- ★ 存草稿：填到一半先留住。类型是 purchasebill.manual，
                 不在 flushDrafts 的自动重放白名单里 ⇒ 半填的单不会被自动提交。 -->
            <view
              v-if="canEdit"
              id="btn-draft"
              class="btn-ghost action-bar__item"
              @click="saveDraft" hover-class="hv-on" :hover-stay-time="80">{{ draftId ? '更新草稿' : '存草稿' }}</view>
            <view
              class="btn-primary action-bar__item"
              :class="{ 'is-disabled': !canSave || saving }"
              @click="onSave" hover-class="hv-on" :hover-stay-time="80">
              {{ saving ? '提交中…' : (mode === 'create' ? '提交' : '提交修改') }}
            </view>
          </view>
        </view>
      </template>
    </LoadState>

    <!-- 供应商选择弹窗 -->
    <view v-if="showSupplierPicker" class="mask" @click="showSupplierPicker = false">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">选择供应商</text>
          <view class="picker-close" @click="showSupplierPicker = false" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="20" color="text-3" /></view>
        </view>
        <view class="picker-search">
          <view class="search-box">
            <Icon name="search" :size="20" color="text-3" />
            <input v-model="supKeyword" placeholder="搜名称/编号/联系人" @input="searchSuppliers" />
          </view>
        </view>
        <view class="picker-list">
          <view v-if="supError" class="picker-error">
            <text>{{ supError }}</text>
            <view class="picker-retry" @click="searchSuppliers" hover-class="hv-on" :hover-stay-time="80">重试</view>
          </view>
          <view v-else-if="supLoading && !supOptions.length" class="picker-empty">加载中…</view>
          <view v-else-if="!supOptions.length" class="picker-empty">没有匹配的供应商</view>
          <view v-for="s in supOptions" :key="s.id" class="picker-item" @click="pickSupplier(s)" hover-class="hv-on" :hover-stay-time="80">
            <text class="pi-name">{{ s.name }}</text>
            <text class="pi-meta">{{ s.type }} · {{ s.contact || '' }} {{ s.mobile || '' }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 商品选择弹窗 -->
    <view v-if="showProductPicker" class="mask" @click="showProductPicker = false">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">添加商品</text>
          <view class="picker-close" @click="showProductPicker = false" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="20" color="text-3" /></view>
        </view>
        <view class="picker-search">
          <view class="search-box">
            <Icon name="search" :size="20" color="text-3" />
            <input v-model="prodKeyword" placeholder="搜名称/编码" @input="searchProducts" />
          </view>
        </view>
        <view class="picker-list">
          <view v-if="prodError" class="picker-error">
            <text>{{ prodError }}</text>
            <view class="picker-retry" @click="searchProducts" hover-class="hv-on" :hover-stay-time="80">重试</view>
          </view>
          <view v-else-if="prodLoading && !prodOptions.length" class="picker-empty">加载中…</view>
          <view v-else-if="!prodOptions.length" class="picker-empty">没有匹配的商品</view>
          <!-- ★ 已在明细里的商品换底色 + 行尾报条数（与销售开单页同一套，组件共用） -->
          <view v-for="p in prodOptions" :key="p.hpbh || p.id" class="picker-item"
                :class="{ 'picker-item--in': countOf(p) > 0 }" @click="onPickProduct(p)" hover-class="hv-on" :hover-stay-time="80">
            <view class="pi-main">
              <text class="pi-name">{{ p.name }}</text>
              <text class="pi-meta">
                {{ p.spec }} · 进价 {{ refPriceText(p) }} / {{ p.baseUnit || p.unit }}
              </text>
            </view>
            <text v-if="countOf(p)" class="pi-tag">已录 {{ countOf(p) }} 行</text>
          </view>
        </view>
      </view>
    </view>

    <ThreeChoiceDialog
      :show="dupDialog"
      title="商品已录入"
      :content="dupText"
      yes-text="再加一行"
      no-text="去修改"
      cancel-text="继续挑选"
      @yes="onDupYes"
      @no="onDupNo"
      @cancel="onDupCancel"
    />

    <!-- 中途退出挽留：填到一半按返回时问一句（开关在「系统配置 → 草稿箱」，默认开着）。
         三个按钮各走一条路：存进草稿箱再退 / 一条都不留地退 / 关掉框继续填。 -->
    <ThreeChoiceDialog
      :show="askShow"
      :title="askTitle"
      :content="askContent"
      yes-text="存草稿"
      no-text="直接退出"
      cancel-text="继续填"
      @yes="onAskSave"
      @no="onAskLeave"
      @cancel="closeAsk"
    />
  </view>
</template>

<script setup>
import { ref, reactive, computed, nextTick } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { purchaseApi, supplierApi } from '../../api/index'
import { productApi } from '../../api/product'
import { useCacheStore } from '../../store/cache'
import { accountOptions, hasOp, loadAccountOptions } from '../../store/options'
import { fmtMoney, fmtQty, toast } from '../../utils/format'
import { calcTotal, checkEditable, editableReasonText } from '../../utils/billState'
import { saveManualDraft, getDraft, removeDraft, draftStampText } from '../../utils/draftBox'
import { mulMoney } from '../../utils/money'
import { useBillExitGuard } from '../../utils/billExitGuard'
import { confirmRemoveLine } from '../../utils/lineTools'
import { markBillWritten } from '../../utils/billWrites'
import StatusTag from '../../components/StatusTag.vue'
import StopTag from '../../components/StopTag.vue'
import AmountText from '../../components/AmountText.vue'
import LoadState from '../../components/LoadState.vue'
import Icon from '../../components/Icon.vue'
import ThreeChoiceDialog from '../../components/ThreeChoiceDialog.vue'

/**
 * ★★ 采购单「修改」后端未实现（2026-09-22 第十轮确认）。
 *
 * `purchaseApi.update` 直接返回 `BACKEND_NOT_AVAILABLE`（Agent 侧只有
 * `purchase.create`，没有 `purchase.update` —— 进货单的改单引擎没写）。
 *
 * 所以编辑态**必须把保存按钮禁用并把原因说出来**，不能留一个"能点但必然失败"
 * 的假按钮 —— 那正是本项目反复出现过的坏味道（点了没反应 / 报一句后端术语）。
 * ★ 这里的诚实处理是刻意的：用户看到「本版暂不支持修改采购单」比看到
 *   `BACKEND_NOT_AVAILABLE` 有用得多。
 * ★ 哪天 Agent 补了 purchase.update，把这个常量改成 true 即可（其余逻辑已就绪）。
 */
const mode = ref('create')   // create | edit
const editId = ref('')
/**
 * ★ 草稿箱来源（非空 = 从草稿继续开单）。mode 仍是 create：走建单分支、不显示单号、
 *   按钮是「提交」—— 与销售开单页同一个先例（复制模式也没多开一种 mode）。
 */
const draftId = ref('')
const draftSavedAt = ref(0)
// 本店 V3 的业务开关（capabilities.accountOptions，全应用共享一份）——
// 这里只消费「数量按单位」，判据是 `!== false`（未知就保持现状，别演成"这家不能按单位收"）
const shopOpts = ref(accountOptions())
const loading = ref(false)
const ready = ref(false)
const error = ref('')

const form = reactive({
  billNo: '', billDate: nowStr(), status: 'unapproved',
  supplierId: '', supplierName: '', memo: '', items: [],
})
const selectedSupplier = ref(null)
const notEditableReasons = ref([])

/* ===== 保存防重复提交（与销售页同一套，两页行为一致） =====
 * ★ 采购建单有完全相同的暴露面：连点保存 = 多张进货单。
 *   前端 `saving` 锁挡连点；`submitToken` 交给 Agent 侧幂等
 *   （`v3agent/idem.py`，销售/采购共用）挡「响应丢失后重试」。
 */
const saving = ref(false)
const submitToken = ref(mkSubmitToken())

function mkSubmitToken() {
  return 'pb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/**
 * 备注长度告警阈值。
 * ★ JH 的备注要写**两个**列，长度上限不同：NoteCode = nvarchar(20)、BZ_JH = nvarchar(200)。
 *   Agent 侧按最小的那个（20）截断，所以超过 20 字的部分**存不进去**。
 *   这里提前提示，避免用户以为整段都保存了。
 */
const MEMO_LIMIT = 20
const memoLen = computed(() => String(form.memo || '').length)

const canEditBase = computed(() => mode.value === 'create' || notEditableReasons.value.length === 0)
/**
 * ★ 编辑态还要叠加「本地服务发不发布这个动作」这一条。
 * ★ 必须走 ref：`hasOp` 读的是模块级变量、不参与响应式，直接写进 computed 只会在
 *   首帧算一次 —— capabilities 后到也救不回来，页面会永远停在"不支持改单"。
 */
const canUpdate = ref(false)
const canEdit = computed(() => canEditBase.value
  && (mode.value === 'create' || canUpdate.value))
const total = computed(() => calcTotal(form.items))
const totalAmount = computed(() => total.value.totalAmount)
const totalQty = computed(() => total.value.totalQty)
// 赠品那部分单列出来（件数已含在 totalQty 里、钱不在 totalAmount 里）
const giftCount = computed(() => total.value.giftCount)
const giftAmount = computed(() => total.value.giftAmount)
const canSave = computed(() => canEdit.value && form.supplierId && form.items.length > 0)

/** 提交前行级校验（与销售页同一口径）：空单价会被后端当 0 元成交并落进重放桶 */
function firstBadLine() {
  for (let i = 0; i < form.items.length; i++) {
    const it = form.items[i]
    const q = Number(it.qty)
    if (!(q > 0) || !Number.isFinite(q)) return { i, why: '数量要大于 0' }
    if (!it.gift) {
      const p = Number(it.price)
      if (String(it.price == null ? '' : it.price).trim() === '' || !Number.isFinite(p) || p < 0) {
        return { i, why: '单价要填（赠品行可以不填）' }
      }
    }
  }
  return null
}

/* ===== 中途退出挽留（与销售开单页共用 utils/billExitGuard）===== */
/**
 * ★ 判"改没改过"的快照里**只放人手填的东西**：明细的 units/baseUnit/rate 是行水合
 *   （hydrateAll，不 await）从货品档案补上来的，算进去就会在回填后凭空"变脏"。
 */
function guardSig() {
  return {
    billDate: form.billDate, supplierId: form.supplierId, memo: form.memo,
    items: form.items.map((it) => ({
      productId: it.productId, unit: it.unit, qty: it.qty, price: it.price, remark: it.remark || '',
      gift: !!it.gift,          // 勾/取消赠品是人的决定，必须算"改过"
    })),
  }
}
/** 挽留文案：条数与合计现读，不写死 */
function askText() {
  if (mode.value === 'create') {
    return {
      title: '这单还没提交',
      content: '已录 ' + form.items.length + ' 种 · 合计 ' + fmtMoney(totalAmount.value)
        + '，现在退出这些就没了。要先存进草稿箱吗？',
    }
  }
  return {
    title: '改动还没提交',
    discardContent: '这张单上改过的地方还没提交，现在退出就恢复成原来的样子。',
  }
}
const { askShow, askTitle, askContent, markClean, allowLeave, closeAsk, tryBack, onResume } = useBillExitGuard({
  ready: () => ready.value,
  editable: () => canEdit.value,
  hasContent: () => !!form.supplierId || form.items.length > 0,
  canDraft: () => mode.value === 'create',
  sig: guardSig,
  askText,
  saving: () => saving.value,
  // ★ 自动草稿要把 id 记回 draftId，否则紧接着提交成功时 removeDraft 找不到它。
  silentSave: () => {
    const id = saveManualDraft('purchase', draftFormShape(draftId.value), submitToken.value, true)
    if (id && !draftId.value) draftId.value = id
  },
})
/** 挽留框的三个动作：存了再走 / 一条都不留地走 / 关掉框留在本页 */
function onAskSave() { closeAsk(); saveDraft() }
function onAskLeave() { closeAsk(); goBack() }
/** 页内「取消」也是中途退出：过同一个判定。只拦返回键不拦取消 = 留个能绕过的洞 */
function onCancelTap() { if (!tryBack()) uni.navigateBack() }

/* ===== 弹窗 ===== */
const showSupplierPicker = ref(false)
const showProductPicker = ref(false)
const supKeyword = ref('')
const prodKeyword = ref('')
const supOptions = ref([])
const prodOptions = ref([])
const supLoading = ref(false)
const supError = ref('')
const prodLoading = ref(false)
const prodError = ref('')

async function searchSuppliers() {
  supLoading.value = true
  supError.value = ''
  const res = await supplierApi.list({ keyword: supKeyword.value, pageSize: 50 })
  supLoading.value = false
  if (res.ok) {
    supOptions.value = res.data.list || []
  } else {
    supOptions.value = []
    supError.value = res.message || '供应商列表加载失败'
  }
}
async function searchProducts() {
  prodLoading.value = true
  prodError.value = ''
  // ★ usage='purchase'：停用的和「停止采购」的货品都不进选择面板（供应商同理走默认，
  //   暂停往来的不出现 —— 单上不该出现停掉的东西）。
  const res = await productApi.list({ keyword: prodKeyword.value, pageSize: 50, usage: 'purchase' })
  prodLoading.value = false
  if (res.ok) {
    prodOptions.value = res.data.list || []
  } else {
    prodOptions.value = []
    prodError.value = res.message || '商品列表加载失败'
  }
}

/**
 * 打开弹窗时必须**主动拉一次**（不能只靠搜索框 @input）。
 * ★ 与销售页同源的问题：用户点开弹窗、还没碰搜索框时列表是空的；
 *   只要输入事件没落到这个 input 上（IME 候选、自动填充、返回本页的旧实例），
 *   弹窗就白屏。⇒ 打开时按当前关键词拉一次；已有数据且无关键词则不重复请求。
 */
function openSupplierPicker() {
  showSupplierPicker.value = true
  if (!supOptions.value.length || supKeyword.value) searchSuppliers()
}
function openProductPicker() {
  showProductPicker.value = true
  if (!prodOptions.value.length || prodKeyword.value) searchProducts()
}

/** 「添加商品」入口。★ 未选供应商时禁用（视觉）＋ 这里真拦（行为）＋ toast 说原因。 */
function onAddItem() {
  if (!form.supplierId) {
    toast('请先选择供应商，再添加商品')
    return
  }
  openProductPicker()
}

function pickSupplier(s) {
  const changed = form.supplierId !== s.id
  form.supplierId = s.id
  form.supplierName = s.name
  selectedSupplier.value = s
  showSupplierPicker.value = false
  if (!changed) return
  // ★ 换供应商后默认仓可能变（Agent 侧缺省取供应商的 Ckbh），
  //   但明细行里没有仓库字段（沿用单头默认仓），所以这里无需重算行。
}

/* 明细行 */

/** 商品在弹窗里的参考进价文案：档案进价 → 成本价 → 无 */
function refPriceText(p) {
  const jh = Number(p.purchasePrice || 0)
  if (jh > 0) return '¥' + fmtMoney(jh)
  const cost = Number(p.costPrice || 0)
  if (cost > 0) return '¥' + fmtMoney(cost) + '（成本价）'
  return '无档案价'
}

/**
 * 取默认进价 + 说明来源。
 * ★ 为什么要有「来源」：本库 48584 个商品里**只有 17 个** D_JH 非 0，
 *   绝大多数商品的档案进价是 0 ⇒ 默认单价会是 0，用户必须手填。
 *   如果不说清楚，用户会以为是页面坏了（"怎么加进来就是 0 元"）。
 *   说清楚「档案无进价，请手工填写」，他就知道这是数据现状而不是 bug。
 */
function defaultPriceOf(p) {
  const jh = Number(p.purchasePrice || 0)
  if (jh > 0) return { price: jh, source: '货品档案·进货价' }
  const cost = Number(p.costPrice || 0)
  if (cost > 0) return { price: cost, source: '货品档案·成本价' }
  return { price: 0, source: '档案无进价，请手工填写' }
}

// ---------------- 重复录入：底色 + 三按钮提示 + 定位到已录那一行（与销售开单页同一套） ----------------
/** 每个货品在本单已录几行（键 = hpbh）。★ 活值：删行、改数量都跟着变。 */
const pickedCount = computed(() => {
  const m = {}
  form.items.forEach((it) => {
    const k = String(it.productId || '')
    if (k) m[k] = (m[k] || 0) + 1
  })
  return m
})
function countOf(p) {
  return pickedCount.value[String((p && (p.hpbh || p.id)) || '')] || 0
}

const dupDialog = ref(false)
const dupPending = ref(null)
const dupText = computed(() => {
  const p = dupPending.value
  if (!p) return ''
  return `「${p.name}」在本单中已录入 ${countOf(p)} 行。`
})
const hlIndex = ref(-1)

function onPickProduct(p) {
  if (countOf(p) > 0) { dupPending.value = p; dupDialog.value = true; return }
  pickProduct(p)
}
function onDupYes() {
  dupDialog.value = false
  const p = dupPending.value
  dupPending.value = null
  if (p) pickProduct(p)
}
function onDupNo() {
  dupDialog.value = false
  showProductPicker.value = false
  const p = dupPending.value
  dupPending.value = null
  if (p) locateProduct(p.hpbh || p.id)
}
/** 取消 ＝ 什么都不做，留在商品面板继续挑 */
function onDupCancel() {
  dupDialog.value = false
  dupPending.value = null
}

/** 把第 i 行明细滚到视口垂直居中（新增一行、「否」去改已录行都用它）；量不到就不滚 */
function scrollToLineCenter(i) {
  nextTick(() => {
    setTimeout(() => {
      const q = uni.createSelectorQuery()
      q.select('#line-' + i).boundingClientRect()
      q.selectViewport().scrollOffset()
      q.exec((res) => {
        const rect = res && res[0]
        const vp = res && res[1]
        if (!rect || !vp) return
        const wh = (uni.getSystemInfoSync() || {}).windowHeight || 640
        uni.pageScrollTo({
          scrollTop: Math.max(0, rect.top + vp.scrollTop + rect.height / 2 - wh / 2),
          duration: 220,
        })
      })
    }, 60)
  })
}

/** 定位到已录那一行：滚到居中 + 高亮 1.5 秒 */
function locateProduct(key) {
  const i = form.items.findIndex((it) => String(it.productId || '') === String(key || ''))
  if (i < 0) { toast('未找到对应明细行'); return }
  hlIndex.value = i
  scrollToLineCenter(i)
  setTimeout(() => { hlIndex.value = -1 }, 1500)
}

function pickProduct(p) {
  showProductPicker.value = false
  const key = p.hpbh || p.id
  const { price, source } = defaultPriceOf(p)
  // ★ 多单位胶囊来自货品档案的 units（HpdanUnit 一单位一行）。
  //   库里只有一个单位时就一个胶囊，界面与改造前一样（不硬造"按箱收"）。
  const baseUnits = Array.isArray(p.units) && p.units.length
    ? p.units.filter((u) => u && u.unit && !u.stopped && unitRowOk(u)) : []
  const basic = baseUnits.find((u) => u.basic) || {}
  const unit = (basic.unit) || p.baseUnit || p.unit
  const hit = baseUnits.find((u) => u.unit === unit) || {}
  form.items.push(reactive({
    idenGuid: '',                        // 新增行不带 iden_guid
    productId: key,
    name: p.name,
    spec: p.spec,
    units: baseUnits,
    unit,
    rate: Number(hit.rate) || 1,
    baseUnit: basic.unit || p.baseUnit || p.unit || '',
    qty: 1,
    price,
    amount: price,
    priceSource: source,
    remark: '',
    gift: false,
  }))
  scrollToLineCenter(form.items.length - 1)   // ★ 新行落到视口中央，别让用户往上翻找
}

/**
 * 「数量按单位」明确没开 ⇒ 只给基本单位一个胶囊。
 * ★ 判据是 `!== false`：开关**不知道**（null）时保持现有行为，
 *   不能把"这次没取到配置"演成"这家只能按基本单位收"。
 */
function unitRowOk(u) {
  return shopOpts.value.billQtyByUnit !== false || !!u.basic
}
function foldQty(it) {
  const r = Number(it.rate || 1)
  return fmtQty((Number(it.qty) || 0) * (r > 0 ? r : 1))
}
/**
 * 一行规格的**完整文案**（规格 · 按X开 · 折合 N基本单位）。
 * ★ 必须收在一个函数里：这段文案现在要出现在**两个地方** —— 收起态挤在品名同行、
 *   展开态独占一行。两处各写一遍的话，哪天改了「折合」的写法（或 foldQty 的口径），
 *   必然只改一处 —— 表现就是"展开前后数字不一样"，而且不报错。
 */
function specLine(it) {
  let s = it.spec || ''
  if (it.unit) s += ` · 按${it.unit}开`
  if (it.baseUnit && Number(it.rate) > 1) s += ` · 折合 ${foldQty(it)}${it.baseUnit}`
  return s
}
/**
 * 换单位。**单价只认这个单位自己录的进价**。
 * ★★ 绝不在前端拿"基本单位进价 × 倍率"造一个价出来 —— 那是替客户编一条他没录过的进货价，
 *   单一保存，成本与应付就按这个假数走（销售页同理，那边连取价接口都不许退化成乘一下）。
 */
function switchUnit(it, u) {
  if (!u || !u.unit || it.unit === u.unit) return
  it.unit = u.unit
  it.rate = Number(u.rate) || 1
  const jp = Number(u.purchasePrice)
  if (jp > 0) {
    it.price = jp
    it.priceSource = `档案·「${u.unit}」进价`
  } else {
    it.priceSource = `「${u.unit}」没录进价，请按供应商报价填`
  }
  recalc(it)
}

/** 删行先问一句（确认框与文案在 utils/lineTools 里，销售开单页共用同一份） */
function removeItem(i) { confirmRemoveLine(form, i) }

/**
 * 品名/规格「点开看全文」：null = 全收起，否则 = 当前展开的那一条明细对象。
 * 与销售开单页同一套实现（那边注释更详细）：
 * ① 页面级 ref，不往 it 上加字段（那种字段要在 createItem 各处 + adapt.js 都初始化，
 *    漏一处就是"点了没反应"且不报错）；② 记对象引用而不是下标，删上面一行时不会张冠李戴。
 */
const openDescItem = ref(null)
function toggleDesc(it) { openDescItem.value = openDescItem.value === it ? null : it }

/**
 * 行金额 = 这一行**计入合计的钱**。赠品行回 0（库里 J_JEZK 就是 0），单价照记。
 * 口径来自 V3 桌面端实测样本，见 utils/billState.js 的 calcTotal 注释。
 */
function recalc(it) {
  if (it.gift) { it.amount = 0; return }
  it.amount = mulMoney(it.qty, it.price)
}
/** 赠品开关：只切标记 + 重算计入金额，不动单价 */
function toggleGift(it) {
  if (!canEdit.value) return
  it.gift = !it.gift
  recalc(it)
}

/* ===== 加载 ===== */
async function load() {
  if (mode.value === 'edit') {
    loading.value = true
    error.value = ''
    const res = await purchaseApi.detail(editId.value)
    loading.value = false
    if (!res.ok) { error.value = res.message; return }
    const raw = res.data || {}
    // ★ purchaseApi.detail 返回的是 toPurchaseDetail 适配后的「页面形状」：
    //   { billNo, billDate, supplierId, supplierName, memo, status, items[], editable, editableReasons }
    //   —— **不是**后端原始的 { bill_no, ndate, supplier:{code,name}, lines[] }。
    //   按原始契约读会恒 undefined ⇒ 供应商回填不上 ⇒ 保存按钮永远灰着。
    form.billNo = raw.billNo || raw.bill_no || ''
    // ★ 优先读 `ndate`（适配层带出的**完整时间戳**），只有它缺失才退回 `billDate`。
    //   `billDate` 是 10 位的展示口径 —— 用它会把时分秒丢掉，
    //   保存时变成当天 00:00:00（销售侧踩过一模一样的坑，见 adapt.js 的长注释）。
    form.billDate = normDateTime(raw.ndate || raw.billDate)
    form.status = raw.status || 'unapproved'
    form.supplierId = raw.supplierId || raw.supplier?.code || ''
    form.supplierName = raw.supplierName || raw.supplier?.name || ''
    form.memo = raw.memo ?? raw.note ?? ''
    form.items = (raw.items || raw.lines || []).map((it) => ({
      // ★ iden_guid 丢了 = 全部原行被当成「新增」。本版采购不支持改单，
      //   但字段照样保留 —— 一旦后端补上 update，这里不用再改。
      idenGuid: it.idenGuid || it.iden_guid || '',
      productId: it.productId || it.hpbh || '',
      name: it.name || '',
      spec: it.spec || '',
      unit: it.unit || '',
      // ★ 已存行的"当时倍率"来自后端（unit_rate），**不是现在档案里的倍率**：
      //   倍率是可以改的，拿现在的倍率回算历史单就是算一笔错账。
      //   档案 units 这里没有（编辑态按行不重取档案），所以已存行只出一个当前单位胶囊。
      rate: Number(it.unitRate ?? it.rate ?? 1) || 1,
      baseUnit: '',
      units: (it.unit && Number(it.unitRate ?? it.rate ?? 1) > 1)
        ? [{ unit: it.unit, rate: Number(it.unitRate ?? it.rate), basic: false }] : [],
      qty: it.qty,
      price: it.price,
      // ★ 后端没给金额才现算：走 mulMoney，与合计、与库里同一套取整（半偶）
      amount: it.amount != null ? it.amount : mulMoney(Number(it.qty || 0), Number(it.price || 0)),
      // ★ 明细备注：适配层已统一读 `remark ?? note`（第十轮）
      remark: it.remark ?? it.note ?? '',
      priceSource: '',
    }))
    // 后端给的不可改原因优先（含「已审核 / 已作废」等）
    const backendReasons = Array.isArray(raw.editableReasons) ? raw.editableReasons
      : (Array.isArray(raw.editable_reasons) ? raw.editable_reasons : null)
    if (backendReasons) {
      notEditableReasons.value = backendReasons
    } else if (raw.editable === false) {
      notEditableReasons.value = ['该单据不可修改']
    } else {
      notEditableReasons.value = checkEditable(raw).reasons
    }
    // ★ 「这台机器的服务不改进货单」这一条不在这里追加 —— 它由 onLoad 里 capabilities
    //   落定那一刻单独说（见 canUpdate）。混在这里的问题是：capabilities 常常比这张单
    //   后到，那时 notEditableReasons 还是空的，会把"其实能改"的单说成不能改。
    if (notEditableReasons.value.length) toast(editableReasonText(notEditableReasons.value))

    // 供应商下拉里带出对应项（用于「更换」弹窗的选中态）
    if (form.supplierId) {
      const sr = await supplierApi.detail(form.supplierId)
      if (sr.ok) selectedSupplier.value = sr.data
      else selectedSupplier.value = { id: form.supplierId, name: form.supplierName }
    }
    // ★ 进货单行里只有「当时用什么单位、倍率多少」，没有货品档案的多单位与基本单位，
    //   所以单位胶囊只凑得出一个、折合那半句也显示不出来。逐行水合补齐（与销售页同一套）。
    hydrateAll()
  }
  ready.value = true
  markClean()          // 到手的样子就是"没改过"，之后只有人动过才值得挽留
  searchSuppliers()
  searchProducts()
}

/* ===== 草稿箱：回填 / 存草稿 / 行水合 ===== */
/**
 * 行水合：补齐明细行的 `units / baseUnit / rate`（采购侧没有库存语义，不补 stock）。
 * ★ 品名/规格以**单据行**为准：那是收货当时的样子，货品后来改名不该改历史单。
 * ★ 商品被删/查不到就保持原行不动，别为一个下架货品把人挡在门外。
 */
async function hydrateLine(it) {
  if (!it || !it.productId) return
  if (Array.isArray(it.units) && it.units.length && it.baseUnit) return   // 手动草稿里已带齐
  const r = await productApi.detail(it.productId)
  if (!r.ok || !r.data) return
  const p = r.data
  const all = Array.isArray(p.units) ? p.units : []
  const list = all.filter((u) => u && u.unit && !u.stopped && unitRowOk(u))
  if (it.unit && !list.some((u) => u.unit === it.unit)) {
    list.unshift(all.find((u) => u && u.unit === it.unit)
      || { unit: it.unit, rate: Number(it.rate) || 1, basic: false, stopped: true })
  }
  it.units = list.length ? list : [{ unit: it.unit || p.baseUnit || '', rate: 1, basic: true, stopped: false }]
  if (!it.baseUnit) it.baseUnit = ((all.find((u) => u && u.basic) || {}).unit) || p.baseUnit || it.unit || ''
  const cur = it.units.find((u) => u.unit === it.unit)
  if (cur) it.rate = Number(cur.rate) || 1
}
/** 串行逐行（明细通常几行），不 await ⇒ 不挡表单可用 */
async function hydrateAll() {
  for (const it of form.items) {
    try { await hydrateLine(it) } catch (e) { /* 单行失败不影响别的行 */ }
  }
}

/** 表单 → 草稿形状（明细只留回填要用的键） */
function draftFormShape(id) {
  return {
    draftId: id || '',
    billDate: form.billDate, supplierId: form.supplierId, supplierName: form.supplierName,
    memo: form.memo,
    items: form.items.map((it) => ({
      idenGuid: it.idenGuid || '', productId: it.productId, name: it.name, spec: it.spec,
      unit: it.unit, units: Array.isArray(it.units) ? it.units : [],
      rate: it.rate, baseUnit: it.baseUnit || '',
      qty: it.qty, price: it.price, amount: it.amount,
      priceSource: it.priceSource || '', remark: it.remark || '',
      gift: !!it.gift,
    })),
  }
}

/** 存草稿：校验比提交宽（有供应商**或**有明细即可），空表单不值得占一个草稿位 */
function saveDraft() {
  if (!form.supplierId && !form.items.length) { toast('先选供应商或添加明细'); return }
  draftId.value = saveManualDraft('purchase', draftFormShape(draftId.value), submitToken.value)
  draftSavedAt.value = Date.now()
  toast('已存入草稿箱', 'success')
  goBack()
}

/** 从草稿箱回填：手动草稿=表单形状直读；断网草稿=提交 payload 形状，靠行水合补齐 */
async function loadDraft() {
  const d = getDraft(draftId.value)
  if (!d) {
    error.value = '这条草稿不在了（可能已过期被清，或存在另一台设备上）'
    ready.value = true
    markClean()
    return
  }
  draftSavedAt.value = d.stamp
  if (d.origin === 'manual') {
    const f = d.form || {}
    form.billNo = ''
    form.billDate = f.billDate || nowStr()
    form.status = 'unapproved'
    form.supplierId = f.supplierId || ''
    form.supplierName = f.supplierName || ''
    form.memo = f.memo || ''
    // ★ 幂等键跟着草稿走：同一张草稿反复提交（哪怕响应丢了再点）只落一张单
    if (d.submitToken) submitToken.value = d.submitToken
    form.items = (f.items || []).map((it) => reactive(Object.assign({}, it)))
  } else {
    const p = d.payload || {}
    form.billNo = ''
    form.billDate = normDateTime(p.ndate)
    form.status = 'unapproved'
    form.supplierId = p.supplier || ''
    form.supplierName = p.supplierName || ''
    form.memo = p.note || ''
    form.items = (p.lines || []).map((ln) => reactive({
      idenGuid: ln.iden_guid || '', productId: ln.hpbh || '', name: ln.name || '',
      spec: ln.spec || '', unit: ln.unit || '', units: [], rate: Number(ln.rate) || 1,
      baseUnit: '', qty: ln.qty, price: ln.price,
      // 赠品行计入合计的钱是 0（库里 J_JEZK 就是 0），与 recalc 同一条口径
      amount: ln.gift ? 0 : Number(ln.qty || 0) * Number(ln.price || 0),
      priceSource: '', remark: ln.remark || '',
      gift: !!ln.gift,
    }))
    hydrateAll()
  }
  if (form.supplierId && !form.supplierName) {
    const sr = await supplierApi.detail(form.supplierId)
    if (sr.ok) { form.supplierName = sr.data.name || ''; selectedSupplier.value = sr.data }
  }
  ready.value = true
  markClean()          // 到手的样子就是"没改过"，之后只有人动过才值得挽留
  searchSuppliers()
  searchProducts()
}

/**
 * 生成一次「表单实例」的幂等键（与销售页同一套语义）。
 * ★ 必须是**表单实例级**而不是「每次点击」：每次点击换新 token，
 *   后端就无从判断第二次点击是「重试」还是「新提交」，幂等完全失效。
 */
async function onSave() {
  if (saving.value) return                      // ① 本地锁：挡连点
  if (!canSave.value) {
    if (!canEdit.value) toast(editableReasonText(notEditableReasons.value) || '该单据不可修改')
    else if (!form.supplierId) toast('请先选择供应商')
    else toast('请先添加商品明细')
    return
  }
  const bad = firstBadLine()
  if (bad) { toast(`第 ${bad.i + 1} 行：${bad.why}`); return }
  saving.value = true
  let done = false                              // 成功后不解锁（页面正在跳走）
  try {
    if (mode.value === 'edit') {
      const res = await purchaseApi.update(editId.value, {
        header: { NDate: form.billDate, ItemBh: form.supplierId, BZ_JH: form.memo || '' },
        lines: form.items.map((it) => ({
          // ★ 带 iden_guid = 这一行是原行的延续（服务端按它做 diff：没变的一行都不重插）；
          //   不带 = 新增行。丢了它 = 整单明细被删光重插（行 id 全变、流水全换一遍）。
          ...(it.idenGuid ? { iden_guid: it.idenGuid } : {}),
          hpbh: it.productId, unit: it.unit,
          qty: Number(it.qty), price: Number(it.price), remark: it.remark || '',
          // ★ 只发 0/1，不发 true/false（断网草稿重放时 JSON 的 true 会让 SQL Server 报 8114）
          gift: it.gift ? 1 : 0,
        })),
      })
      if (res.ok) {
        done = true
        submitToken.value = mkSubmitToken()
        if (editId.value) useCacheStore().remove('purchase:' + editId.value)
        // ★ 改单同样是"写过"：不打这个标记，退回采购列表那一趟不会刷，
        //   列表上还是改之前的金额与状态（销售页两个分支共用一处打点，采购先前只在建单那支打了）。
        markBillWritten('purchase')
        toast('提交成功', 'success')
        goBack()
      } else {
        toast(res.message || '提交失败')
      }
      return
    }

    // 新建：{ supplier, lines:[{hpbh,unit,qty,price,remark?}], ndate?, warehouse?, note? }
    const payload = {
      supplier: form.supplierId,
      ndate: form.billDate,
      note: form.memo || '',
      // ★★ 幂等键：同一表单实例的所有提交复用同一个 token ——
      //   「响应超时/丢失后用户再点一次」不会在 JHMX 里多出一张单。
      client_token: submitToken.value,
      lines: form.items.map((it) => ({
        hpbh: it.productId,
        unit: it.unit,
        qty: Number(it.qty),
        price: Number(it.price),
        // ★ 明细行备注（落 JHMX.BZ_JHMX）—— 写入侧参数名是 `remark`，
        //   回读字段第十轮也已统一为 `remark`。
        remark: it.remark || '',
        // ★ 赠品位只发 0/1（true 到重放那一路会被 SQL Server 当 nvarchar 转 bit 报 8114）
        gift: it.gift ? 1 : 0,
      })),
    }
    const res = await purchaseApi.create(payload)
    if (res.ok) {
      done = true
      // ★ 单已经落库了，这一页没有"还没交的东西"⇒ 先把挽留闸门让开。
      //   建单成功走 redirectTo（不经过 goBack），不让开的话 onUnload 会以为人是被
      //   小程序/H5 后退带走的，再往草稿箱里塞一条自动草稿。
      allowLeave()
      markBillWritten('purchase')
      // ★ 提交成功（含转成待上传通道）之后，桶里那条草稿必须删 —— 留着就变成
      //   "这张单在草稿箱里还有一份"，下次点它又会建一张。
      if (draftId.value) {
        removeDraft(draftId.value)
        draftId.value = ''
        draftSavedAt.value = 0
      }
      // ★ 成功后换新 token：本表单实例已落过库，后续提交必须是**新**提交。
      submitToken.value = mkSubmitToken()
      if (res.draft) { toast(res.message || '已存为草稿'); goBack(); return }
      toast('提交成功', 'success')
      const newNo = extractBillNo(res.data)
      if (newNo) {
        // 建单后直接进详情（全新页面实例，onLoad 必然执行）；回列表看不到刚建的这张单。
        uni.redirectTo({ url: '/pages/purchase/detail?id=' + encodeURIComponent(newNo) })
        return
      }
      goBack()
    } else {
      toast(res.message || '提交失败')
    }
  } finally {
    // ★ 只有失败才解锁 —— 失败后用户当然要能重试。
    if (!done) saving.value = false
  }
}

/** 从保存响应里抠出单号（认三种形状：{bill_no} / {bill:{bill_no}} / {data:{...}}）。 */
function extractBillNo(data) {
  if (!data) return ''
  const d = data.data && typeof data.data === 'object' ? data.data : data
  return d.bill_no || d.billNo || d.no || (d.bill && (d.bill.bill_no || d.bill.billNo)) || ''
}

/**
 * 页面自己要走 ⇒ 先把挽留闸门让开。
 * ★ `uni.navigateBack()` 在 App/H5 上同样会走本页的 onBackPress —— 提交成功、
 *   存完草稿、点了「直接退出」之后再被问一遍，那就是故障不是挽留。
 */
function goBack() { allowLeave(); uni.navigateBack() }

/* ===== 日期 / 时间（YYYY-MM-DD HH:mm:ss，与销售页同口径） =====
 * ★ 为什么不能用单个 `<picker mode="date">`：它的 detail.value 只有 'YYYY-MM-DD'，
 *   时分秒拿不到；而 `<picker mode="time">` 又只有时分 ⇒ 必须两个拼装。
 * ★ 为什么必须 19 位无毫秒：与 Agent 写入口径一致（purchase.py 的 TIME_FMT），
 *   少补一次后端就存成带毫秒的样子，和存量数据形态不一致。
 * ★★ 另外一个坑：`toPurchase` 曾经把 billDate 写成 `.slice(0, 10)`，
 *   把时分秒**截掉** ⇒ 改单保存会把原单时间改成 00:00:00（静默改数据）。
 *   本页改用 normDateTime 规整，适配层也已同步修正（见 utils/adapt.js）。
 */
const datePart = computed(() => String(form.billDate || '').slice(0, 10))
const timePart = computed(() => String(form.billDate || '').slice(11, 19) || '00:00:00')

function onDatePick(e) {
  form.billDate = e.detail.value + ' ' + (timePart.value || '00:00:00')
}
function onTimePick(e) {
  form.billDate = (datePart.value || today()) + ' ' + e.detail.value
}

/** 当前时间，`YYYY-MM-DD HH:mm:ss`（无毫秒，与 Agent TIME_FMT 同口径） */
function nowStr() {
  const t = new Date(); const p = (x) => String(x).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ` +
         `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
}
function today() { return nowStr().slice(0, 10) }

/** 任意后端日期串 → `YYYY-MM-DD HH:mm:ss`（只有日期时补 00:00:00，不补毫秒）。 */
function normDateTime(v) {
  const s = String(v || '').replace('T', ' ')
  if (!s) return nowStr()
  if (s.length >= 19) return s.slice(0, 19)
  if (s.length === 10) return s + ' 00:00:00'
  return s
}

onLoad((q) => {
  // 开关不阻塞开单页首屏；没取到之前一律按"开着"渲染（取到 false 后下一次加行才收窄）
  loadAccountOptions().then((o) => {
    shopOpts.value = o
    // ★ 改单能力反过来必须**默认关**：清单里没有这个动作就是没有，
    //   猜"开着"等于给没换包的机器亮一颗必然失败的保存按钮。
    canUpdate.value = hasOp('purchase.update')
    if (canUpdate.value || (q?.mode || (q?.id ? 'edit' : 'create')) !== 'edit') return
    toast('这台机器的本地服务还不改进货单，请先更新到最新版')
  })
  // ★ 与销售页的差别：采购详情页跳转时只带 `?id=`（不带 mode），
  //   所以有 id 就必须判成编辑态，否则会当新建打开一张空单。
  mode.value = q?.mode || (q?.id ? 'edit' : 'create')
  editId.value = q?.id || ''
  // ★ 草稿续开：mode 落回 create（建单分支、按钮「提交」），只多带一个草稿桶 id
  if (q?.mode === 'draft') {
    mode.value = 'create'
    editId.value = ''
    draftId.value = q.draftId || q.id || ''
  }
  if (draftId.value) loadDraft(); else load()
})

/**
 * ★ 返回本页必须重新拉下拉数据（与销售页同源的问题）。
 *   本页会被 navigateBack 回来（选供应商/商品走的是弹窗，但
 *   「本页 → 别的页 → 返回」也会命中），而 uni-app 的 navigateBack
 *   只是弹栈，本页实例被缓存、onLoad 不会再跑 ⇒ 下拉仍是旧快照。
 *   ★ 用 entered 首帧哨兵跳过第一次（首次由 onLoad 负责），避免进页双发。
 *   ★ 重进来时**不能重置用户已填的表单**，只刷新服务端下拉数据。
 */
let entered = false
onShow(() => {
  if (!entered) { entered = true; return }
  // keep-alive 复用旧实例：把"已经走了"的状态拉回来（否则底栏永久停在"提交中…"）
  if (onResume()) saving.value = false
  searchSuppliers()
  searchProducts()
})
</script>

<style lang="scss" scoped>
/* ★ 样式与销售开单页**同一套类名与令牌**。
   需求是「采购开单界面应调整至与销售开单界面差不多」——
   视觉一致靠复用同一组类名与令牌，而不是各写一份相似的样式。
   ★ 底栏让位预留统一由全局 .has-action-bar 提供，别在这里写 padding-bottom。 */
.is-disabled { opacity: 0.5; }

/* 单头键值行 */
.head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 76rpx;
  gap: $space-inner;
}
.head-row + .head-row { border-top: 1rpx solid $color-divider; }
.head-row .label { font-size: $fs-caption; color: $color-text-2; flex: 0 0 auto; }
.head-row .value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-family: $font-num;
  font-size: $fs-body;
  font-weight: $fw-bold;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 只读文本值（编辑态的单号）：弱化但不隐形 —— 单号是信息不是操作项 */
.head-row .value--readonly {
  font-weight: $fw-normal;
  color: $color-text-2;
}

/* 日期 + 时间两个 picker 并排（uni-app 没有"日期时间"合一的 picker） */
.head-dt {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
}
.head-row :deep(.status-tag) { flex: 0 0 auto; margin-left: auto; }
/* 草稿那一行是「标签 + 存于时间」两个东西，标签不该顶到最右（与销售页同一处理） */
.head-draft { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 12rpx; }
.head-draft :deep(.status-tag) { margin-left: 0; }
.head-draft__at { font-size: $fs-mini; color: $color-text-3; }

.head-picker { display: flex; }
.head-picker__box {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-height: 76rpx;
  color: $color-primary;
}
.head-picker__text {
  font-family: $font-num;
  font-size: $fs-body;
  font-weight: $fw-bold;
  font-variant-numeric: tabular-nums;
  color: $color-text;
}
.head-picker[disabled] .head-picker__text,
.head-picker[disabled] .head-picker__box { color: $color-text-3; }

/* 取价说明（对应销售页的价格方案说明位） */
.scheme-hint {
  display: block;
  margin-top: 3rpx;
  margin-bottom: 10rpx;
  font-size: $fs-micro;
  color: $color-text-4;
  line-height: 1.5;
}

.card .section-head { margin-top: 18rpx; }

/* 供应商选择 */
/* 类名沿用销售页的 .customer-pick（见文件头那条注释），但这一行是**选供应商**。
   padding 与销售页一起改：实测 27px 是开单页点得最多的一行，低于 44px 触摸底线。 */
.customer-pick { display: flex; align-items: center; justify-content: space-between; gap: $space-inner; padding: 26rpx 0; }
.cust-info { display: flex; flex-direction: column; min-width: 0; }
.cust-name { font-size: $fs-subtitle; font-weight: $fw-bold; }
.cust-name-line { display: flex; align-items: center; gap: 10rpx; min-width: 0; }
.cust-meta { font-size: $fs-mini; color: $color-text-3; margin-top: 8rpx; }
.pick-placeholder { color: $color-text-4; font-size: $fs-body; }
.pick-arrow { display: flex; align-items: center; gap: 4rpx; color: $color-primary; font-size: $fs-caption; flex: 0 0 auto; }

/* 明细行卡片 */
.item-card {
  background: $color-bg-sunken;
  border-radius: $radius-card-sm;
  padding: 24rpx;
  margin-bottom: $space-inner;
}
.item-top { display: flex; align-items: center; justify-content: space-between; gap: $space-inner; }
/* 描述块 = 品名 + 规格 + 展开箭头，**整块**是"点开看全文"的热区（与销售页同一套版式） */
.it-name-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 16rpx; }
/* ★ max-width:52% 是「规格上移」的必要配套：不给上限，长品名会把规格整个挤成 0。
   两个 <text> 都要挂 .ellipsis（少挂一个就会看到半截文字）。 */
.it-name { flex: 0 1 auto; min-width: 0; max-width: 52%; font-size: $fs-body; font-weight: $fw-bold; }
/* 展开态：品名独占剩余宽度、可折多行；规格不在这渲染（挂回下面独立的 .it-spec-row） */
.it-name-line--open { align-items: flex-start; }
.it-name-line--open .it-name { flex: 1; max-width: none; white-space: normal; line-height: 1.45; }
.it-name-line--open :deep(.icon-svg) { margin-top: 8rpx; }
/* ★ 删行热区撑到 88rpx（与销售页同一口径，U6）：图标仍是 20，只是手指好点些 */
.it-del { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; color: $color-danger; min-height: 88rpx; padding: 0 12rpx; }
/* 规格那一行：**只在展开态存在**（收起态规格挤在品名同行）。
   上下边距与改造前一致（10/18rpx）—— 明细卡片的行距是被断言量着的，多一像素都会被判成布局回归。 */
.it-spec-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: $space-tight; margin: 10rpx 0 18rpx;
}
.it-spec { flex: 1 1 auto; min-width: 0; font-size: $fs-mini; color: $color-text-3; }
.gift-tg {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6rpx;
  height: 44rpx; padding: 0 16rpx; line-height: 1;
  border-radius: $radius-pill; border: 1rpx solid $color-border;
  background: $color-bg; color: $color-text-3; font-size: $fs-mini;
}
.gift-tg--on {
  background: $color-primary; border-color: $color-primary; color: #fff; font-weight: $fw-bold;
}
.gift-tg__t { line-height: 1; }
/* 单位胶囊：与销售页同一套尺寸（scoped 样式不跨组件，必须各留一份） */
.it-units { display: flex; align-items: center; gap: 8rpx; flex: none; }
.uchip { font-size: $fs-micro; line-height: 44rpx; min-width: 56rpx; text-align: center;
  padding: 0 12rpx; border-radius: $radius-tag; background: $color-bg-sunken; color: $color-text-2; }
.uchip--on { background: $color-primary; color: $color-card; font-weight: $fw-bold; }

/* 两列之间的缝从 18rpx 收到 12rpx：这一行的宽度账要留给数量和单价 */
.item-edit { display: flex; align-items: flex-end; gap: 12rpx; }
.edit-field { flex: 1; min-width: 0; }
/* ★ 数量列定宽 128rpx(64px)：重量/长度开单时数量是 5 位数（12345 需 40.3px 文字宽）。
   赠品已经挪到备注行，这里的宽是省出来的 ⇒ 单价框拿到 128px（可用 110px）。
   在 .edit-field 之后声明，同特异度靠顺序覆盖 flex:1。 */
.edit-field--qty { flex: 0 0 auto; width: 128rpx; }
.edit-label, .amt-label {
  display: block;
  margin-bottom: 8rpx;
  font-size: $fs-mini;
  color: $color-text-3;
}
.edit-input {
  width: 100%;
  height: 76rpx;
  box-sizing: border-box;
  background: $color-card;
  border: 1rpx solid $color-border;
  border-radius: $radius-tag;
  padding: 0 16rpx;
  font-family: $font-num;
  font-size: $fs-body;
  font-weight: $fw-bold;
  color: $color-text;
  line-height: 76rpx;
}
.edit-input[disabled] {
  background: $color-card;
  color: $color-text-3;
  border-color: $color-divider;
}
.edit-amt {
  flex: 0 0 auto;
  min-width: 150rpx;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-top: 32rpx;
}
.edit-amt :deep(.amount) { font-family: $font-num; font-size: $fs-num-lg; }
.price-src { display: block; margin-top: 12rpx; font-size: $fs-micro; color: $color-violet; }

/* 行备注 */
.item-remark { display: flex; align-items: center; gap: 16rpx; margin-top: 14rpx; }
.rm-label { flex: 0 0 auto; font-size: $fs-mini; color: $color-text-3; }
.rm-input {
  flex: 1;
  min-width: 0;
  background: $color-card;
  border-radius: $radius-tag;
  padding: 12rpx 16rpx;
  font-size: $fs-caption;
}

/* 添加商品 */
.add-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 24rpx;
  margin-top: 4rpx;
  color: $color-primary;
  font-size: $fs-caption;
  font-weight: $fw-bold;
  border: 2rpx dashed $color-primary-border;
  border-radius: $radius-card-sm;
  background: $color-primary-bg;
}
.add-item.is-disabled {
  color: $color-text-4;
  border-color: $color-border;
  background: $color-bg-sunken;
}
.add-item-hint {
  display: block;
  margin-top: 12rpx;
  text-align: center;
  font-size: $fs-mini;
  color: $color-text-4;
}
.empty-items { text-align: center; padding: 24rpx; color: $color-text-4; font-size: $fs-caption; }

/* 备注（整单）——现在在明细卡尾部，上面压一道分隔线；合计已搬进底栏（与销售页同一处理） */
.memo-row {
  display: flex; align-items: center; gap: $space-inner;
  margin-top: $space-inner; padding: 24rpx 0;
  border-top: 1rpx solid $color-divider;
}
.memo-row .label { flex: 0 0 auto; font-size: $fs-body; color: $color-text-2; }
.memo-input { flex: 1; min-width: 0; font-size: $fs-body; color: $color-text; }
/* 单头备注超 20 字会存不进去（JH.NoteCode 限制），提前告警 */
.memo-warn { display: block; margin-top: 10rpx; font-size: $fs-micro; color: $color-danger; }
.gift-note {
  display: block; margin-top: 12rpx; text-align: center;
  font-size: $fs-micro; color: $color-warning;
}

/* 弹窗 */
/* .mask 样式与入场动画统一在 App.vue 全局（2026-10-08 收拢） */
.picker {
  width: 100%;
  max-height: 80vh;
  background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $space-card;
  border-bottom: 1rpx solid $color-divider;
}
.picker-title { font-size: $fs-subtitle; font-weight: $fw-bold; }
.picker-close { display: flex; align-items: center; justify-content: center; color: $color-text-3; }
.picker-search { padding: $space-inner $space-card; }
.search-box {
  display: flex;
  align-items: center;
  gap: 14rpx;
  height: 80rpx;
  padding: 0 28rpx;
  border-radius: $radius-pill;
  background: $color-bg-sunken;
  color: $color-text-3;
  box-sizing: border-box;
}
.search-box input { flex: 1; min-width: 0; background: transparent; font-size: $fs-body; color: $color-text; }
/* 列表滚动：用普通视图 + 显式滚动约束（scroll-view 在 max-height 弹窗里拿不到确定高度） */
.picker-list {
  flex: 1;
  min-height: 0;
  max-height: 56vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0 $space-card;
  box-sizing: border-box;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: $space-inner;
  padding: 26rpx 0;
  border-bottom: 1rpx solid $color-divider;
}
.picker-item:last-child { border-bottom: 0; }
/* 已入明细的商品换底色：左右吃掉列表内边距，否则底色铺不满像没对齐。
   ★★ 写长边，别写 `margin: 0 -$space-card` —— sass 会把它当减法算成四边全负，
     上下各吃 36rpx 把相邻行拽到一起（销售页真机截图红过一次）。 */
.picker-item--in {
  background: $color-primary-bg;
  margin-left: -$space-card;
  margin-right: -$space-card;
  padding: 26rpx $space-card;
  border-radius: $radius-tag;
  border-bottom: 0;
}
.pi-main { flex: 1; min-width: 0; }
.pi-name { font-size: $fs-body; font-weight: $fw-bold; }
.pi-meta { display: block; margin-top: 8rpx; font-size: $fs-mini; color: $color-text-3; }
.pi-tag {
  flex: 0 0 auto;
  padding: 4rpx 12rpx;
  border-radius: $radius-tag;
  background: $color-primary;
  color: #fff;
  font-size: $fs-micro;
}
/* 定位到已录那一行：底色 + 内描边；1.5 秒后 JS 撤掉 class，靠 transition 淡回去 */
.item-card--hl {
  background: $color-primary-bg;
  box-shadow: inset 0 0 0 2rpx $color-primary-border;
  transition: background $dur-linger $ease-out, box-shadow $dur-linger $ease-out;
}

/* 弹窗空态 / 加载态 / 错误态（加载失败不能说成"搜不到"） */
.picker-empty {
  padding: 60rpx 0;
  text-align: center;
  font-size: $fs-caption;
  color: $color-text-3;
}
.picker-error {
  padding: 48rpx 0;
  text-align: center;
  font-size: $fs-caption;
  color: $color-danger;
}
.picker-retry {
  display: inline-block;
  margin-top: 20rpx;
  padding: 10rpx 40rpx;
  border: 1rpx solid $color-primary;
  border-radius: $radius-pill;
  font-size: $fs-caption;
  color: $color-primary;
}

.action-bar__item { flex: 1; }
</style>
