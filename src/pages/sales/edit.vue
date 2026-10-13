<template>
  <view class="page has-action-bar has-action-bar--total">
    <LoadState :loading="loading" :error="error" @retry="load">
      <template v-if="ready">
        <!-- 单头 -->
        <!-- ★★ 单头 = 「单号(仅edit) + 日期 + 客户 + 价格方案」（2026-09-22 用户需求，三轮迭代）
              · 「单号」**只在编辑态显示，新增态不显示**（用户最终口径）：
                  原话「编辑页面要可以看到单号，新增页面可以不必显示」。
                ★ 为什么新增态不显示：新增时后端**还没生成单号**（保存后才由
                  No_BillID 取号器给 `XK`+8位），此时能显示的任何内容都是假的；
                  曾经写的 `form.billNo || '保存后自动生成'` 就是自造占位文案，
                  用户会误以为「可以自己填单号」——实际前端不允许自定义。
                ★ 为什么编辑态必须显示：这是一张**已存在的单**，单号是它的唯一身份，
                  用户改单时需要核对「我改的到底是哪一单」。只在详情页显示不够——
                  改单过程中就要能看到。
                  ★ 用**文本**展示，不是输入框：单号不可改（改单走 URL 的 id）。
                ★ 提交 payload 里从来没有单号字段（create 不给、update 用 URL 的 id）。
              · 「状态」只在 edit 显示 —— 新单必然是「未审核」，无信息量；
                edit 模式下状态（已审核/已作废）直接决定能不能改，藏掉会让用户失去判断依据。
              · 日期带时分秒（`YYYY-MM-DD HH:mm:ss`）—— 见下方 onDatePick/onTimePick 说明。 -->
        <view class="card">
          <template v-if="mode === 'edit'">
            <view class="head-row">
              <text class="label">单号</text>
              <text class="value value--readonly">{{ form.billNo || '—' }}</text>
            </view>
          </template>
          <!-- 从草稿箱进来的：单号还没有，但"这是一张草稿、什么时候存的"必须写出来，
               否则人分不清自己是新开一张还是在续哪一张。 -->
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

          <view class="section-head"><text class="section-head__title">客户</text></view>
          <view class="customer-pick" @click="openCustomerPicker" hover-class="hv-on" :hover-stay-time="80">
            <template v-if="form.customerName">
              <view class="cust-info">
                <view class="cust-name-line">
                  <text class="cust-name ellipsis">{{ form.customerName }}</text>
                  <StopTag kind="customer" :code="form.customerId" />
                </view>
                <text class="cust-meta">{{ selectedCustomer?.mobile || '' }} · 取价：{{ priceTraceLabel }}</text>
              </view>
              <view v-if="canEdit" class="pick-arrow"><text>更换</text><Icon name="chevron-right" :size="20" color="primary" /></view>
            </template>
            <template v-else>
              <text class="pick-placeholder">请选择客户</text>
              <view class="pick-arrow"><Icon name="chevron-right" :size="20" color="primary" /></view>
            </template>
          </view>

          <!-- 价格方案：本单取价策略，覆盖客户档案里的默认设置 -->
          <view class="head-row">
            <text class="label">价格方案</text>
            <picker class="head-picker head-picker--right" :range="schemeNames" :value="schemeIndex" :disabled="!canEdit" @change="onSchemePick">
              <view class="head-picker__box">
                <text class="head-picker__text">{{ schemeLabel }}</text>
                <Icon v-if="canEdit" name="chevron-down" :size="18" color="primary" />
              </view>
            </picker>
          </view>
          <text class="scheme-hint">{{ schemeHint }}</text>

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
                   ★ 热区只包这一块 —— `.it-units` / `.it-del` 是 .item-top 的直接子元素、在热区外，
                     所以**不需要 @click.stop**。别把热区做成整个 .item-top：那样点 ✕ 会顺带
                     收起展开态，而且这个 bug 只在"展开了某行之后再点删除"时出现，很难发现。
                   ★ 展开的是哪一行记在**页面级** openDescItem 上，不往 it 上加字段：
                     showHistory 那种行字段要在 createItem 的 4 处 + utils/adapt.js 各初始化一遍，
                     漏一处就是"点了没反应"且不报错。记对象引用（不是下标）还顺带解决了
                     "删掉上面一行后，下标平移、展开的变成别人"这个问题。 -->
              <view class="it-name-line" :class="{ 'it-name-line--open': openDescItem === it }"
                    @click="toggleDesc(it)" hover-class="hv-on" :hover-stay-time="80">
                <text class="it-name" :class="{ ellipsis: openDescItem !== it }">{{ it.name }}</text>
                <StopTag kind="product" :code="it.productId" />
                <!-- 规格：收起态挤在品名同行（.it-name 限宽 52%，两边都可截断）；展开态不在这渲染。
                     ★ 必须渲染成**单个文本节点**（specLine 拼好一整个字符串）——
                       原来写成 `{{ it.spec }}<text> · 按X开</text>`，内层 <text> 是另一个 uni-text，
                       H5 基础规则给它 `white-space:pre-line`（外层的 nowrap 管不到它）⇒
                       长品名把规格挤窄时**内层自己折成两行**，把整张卡片撑高。 -->
                <text v-if="openDescItem !== it" class="it-spec ellipsis">{{ specLine(it) }}</text>
                <Icon :name="openDescItem === it ? 'chevron-up' : 'chevron-down'" :size="14" color="text-3" />
              </view>
              <!-- 单位胶囊与品名同行居右：一条明细不许占满半屏 -->
              <view class="it-units">
                <text v-for="(u, ui) in it.units" :key="ui" class="uchip"
                      :class="{ 'uchip--on': it.unit === u.unit }"
                      @click="canEdit && switchUnit(it, u)">{{ u.unit }}</text>
              </view>
              <view v-if="canEdit" class="it-del" @click="removeItem(i)" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="20" color="danger" /></view>
            </view>
            <!-- 展开态才挂回这一行：规格全文独占一行 = 改造前那套「两行布局」，用户不用学新东西。
                 文案与收起态同一份 specLine，两处永不漂移。 -->
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
                <input class="edit-input tnum" type="digit" v-model="it.price" :disabled="!canEdit"
                       @input="recalc(it)" @blur="onPriceBlur(it)" />
              </view>
              <view class="edit-amt">
                <text class="amt-label">金额</text>
                <AmountText :value="it.amount" />
              </view>
            </view>

            <!-- 折合 / 库存 / 取价 与「最近销售」挤同一行（点右边展开历史） -->
            <view class="history-toggle" @click="toggleHistory(it)" hover-class="hv-on" :hover-stay-time="80">
              <view class="ht-left">
                <text class="ht-fold">折合 {{ foldQty(it) }}{{ it.baseUnit }}</text>
                <!-- 库存提示：四种话分开说（还差 N / 账面负数 / 没库存记录 / 够就不出声），
                     口径与文案都在 utils/stockHint.js；设置页那个开关关掉就整条不出 -->
                <text v-if="stockTip(it)" class="ht-short" :class="{
                      'ht-short--neg': stockTip(it).kind === 'negative',
                      'ht-short--info': stockTip(it).kind === 'noRecord' }">{{ stockTip(it).text }}</text>
                <text v-if="it.priceSource" class="price-src">取价：{{ priceSourceText(it.priceSource) }}</text>
                <Icon name="trending-up" :size="15" color="text-3" />
                <text class="ht-label">最近销售</text>
                <text class="ht-count">{{ it.historyLoading ? '加载中…' : (it.salesHistory?.length || 0) + ' 笔' }}</text>
              </view>
              <Icon :name="it.showHistory ? 'chevron-down' : 'chevron-right'" :size="16" color="text-3" />
            </view>
            <view v-if="it.showHistory" class="history-panel">
              <view v-if="it.historyLoading" class="history-empty">正在加载…</view>
              <view v-else-if="it.historyError" class="history-empty history-error" @click="loadHistory(it, true)" hover-class="hv-on" :hover-stay-time="80">
                {{ it.historyError }}，点击重试
              </view>
              <view v-else-if="it.salesHistory?.length" class="history-list">
                <view v-for="(h, hi) in shownHistory(it)" :key="hi" class="history-row">
                  <text class="hr-date">{{ h.billDate }}</text>
                  <text class="hr-qty">{{ h.qty }} {{ h.unit || it.unit }}</text>
                  <text class="hr-price">¥{{ fmtMoney(h.price) }}</text>
                  <view class="hr-cust-line">
                    <text class="hr-cust ellipsis">{{ h.customerName }}</text>
                    <StopTag kind="customer" :code="h.customerCode" />
                  </view>
                </view>
                <!-- 超过 3 笔才出这一行：写的是"还有几笔"这个活值，不是光一个"更多" -->
                <view v-if="it.salesHistory.length > HISTORY_PREVIEW" class="history-more"
                      :id="'btn-hist-more-' + i" @click="toggleHistoryAll(it)" hover-class="hv-on" :hover-stay-time="80">
                  <text class="hm-text">{{ it.historyAll
                    ? '收回，只看这 ' + HISTORY_PREVIEW + ' 笔'
                    : '展开全部 ' + it.salesHistory.length + ' 笔' }}</text>
                  <Icon :name="it.historyAll ? 'chevron-up' : 'chevron-down'" :size="14" color="text-3" />
                </view>
              </view>
              <view v-else class="history-empty">暂无历史销售记录</view>
            </view>

            <!-- 行备注。★ 备注常驻、位置一个字没动 —— 它的位置风险（贴着 ✕）上一版被指出来了，不重蹈 -->
            <view class="item-remark">
              <text class="rm-label">备注</text>
              <input class="rm-input" v-model="it.remark" :disabled="!canEdit" placeholder="选填" />
              <!-- 赠品：点一下这一行就不计入合计（单价还留着，那是这批货的价值）。
                   两个静态配色的节点分开写 —— 图标表按"名|色"预生成，动态 :color 只会被生成出一档。
                   ★ 放备注行而不是「数量/单价/金额」那一行：赠品挤进数量行会把单价框压到只剩 56px 可用，
                     而单价 5 位整数（12345.00 需 60.2px）就溢出；放这里单价可用 110px，数量列还能给回 64px。
                   ★ 也不放「取价/最近销售」行：那整行是 @click="toggleHistory" 的点击区，塞进来要配
                     @click.stop（漏了就是"点赠品顺带展开历史"），且只读提示里混一个可写开关。
                     取舍详见 docs/UI审阅-20261009.md U7-b。 -->
              <view class="gift-tg" :class="{ 'gift-tg--on': it.gift }" :id="'btn-gift-' + i"
                    @click="toggleGift(it)" hover-class="hv-on" :hover-stay-time="80">
                <Icon v-if="it.gift" name="tag" :size="14" color="white" />
                <Icon v-else name="tag" :size="14" color="text-3" />
                <text class="gift-tg__t">赠品</text>
              </view>
            </view>
          </view>
          <!-- 添加商品 -->
          <!-- ★★ 未选客户时禁用（2026-09-22 用户需求）。
               原因（业务 + 技术双层）：
               · 业务：明细单价完全依赖客户 —— 取价要读该客户的 PriceTrace/PriceTypeXS
                 与本单「价格方案」，没客户就**没有取价口径**，加进来只能填一个
                 不对任何人负责的价格，后面还得逐行改。
               · 技术：`pickProduct` 里 `if (form.customerId)` 才调 priceApi.resolve，
                 无客户时直接落到货品档案的默认价（`sale_price`）；`loadHistory`
                 也会因无客户而报「请先选择客户」—— 行加进来但历史面板恒报错。
               ⇒ 不是灰一个按钮了事，要在能点之前就把「为什么不能点」讲清楚。
                 点禁用态时给出 toast 提示（而不是静默无响应 —— 静默会被当成页面卡死）。 -->
          <view
            v-if="canEdit"
            class="add-item"
            :class="{ 'is-disabled': !form.customerId }"
            @click="onAddItem" hover-class="hv-on" :hover-stay-time="80">
            <Icon name="plus" :size="20" color="primary" /> 添加商品
          </view>
          <text v-if="canEdit && !form.customerId" class="add-item-hint">先选客户 —— 价格要按客户方案取</text>
          <!-- 「暂无明细」只在**没有别的提示占位**时才说：未选客户时上面那句已经把"为什么还没有行"讲清了，
               两句同屏是重复（2026-10-10 UI 体检 07 板）。查看态（canEdit=false）没有上面那句，所以照旧要显示。 -->
          <view v-if="!form.items.length && !(canEdit && !form.customerId)" class="empty-items">暂无明细，请添加商品</view>
          <!-- 赠品件数在"件"里（库存照扣），钱不在"合计"里 —— 不说清就会被当成算错。
               ★ 2026-10-10：合计搬进底栏常驻之后，这句留在明细卡尾（它解释的就是上面这些行）。 -->
          <text v-if="giftCount" class="gift-note">含赠品 {{ giftCount }} 种 · {{ fmtMoney(giftAmount) }} 不计入合计</text>
          <!-- 整单备注（落 XS.BZ_XS）。原来和「合计」同卡，合计搬进底栏后这一行留在明细卡尾：
               紧跟明细列表 ⇒ 不用加"整单"两字也不会误读成行备注。placeholder 保持「选填」。 -->
          <view class="memo-row">
            <text class="label">备注</text>
            <input class="memo-input" v-model="form.memo" :disabled="!canEdit" placeholder="选填" />
          </view>
        </view>

        <!-- 保存。★ 合计这一行常驻底栏（2026-10-10）：开单页唯一"边录边看"的数，
             放在卡片里滚到第 8 行明细就看不见了。 -->
        <view class="action-bar action-bar--total">
          <view class="bar-total">
            <text>共 {{ form.items.length }} 种 · {{ totalQty }} 件</text>
            <view class="bar-total__amt"><text>合计</text>
              <AmountText :value="totalAmount" /></view>
          </view>
          <view class="bar-btns">
            <view class="btn-ghost action-bar__item" @click="onCancelTap" hover-class="hv-on" :hover-stay-time="80">取消</view>
            <!-- ★ 存草稿：填到一半先留住，联网/断网都不会替人提交（类型是 *.manual，
                 不在 flushDrafts 的白名单里）。已提交过的单不给这个按钮（canEdit 之外还要
                 draftId 或 create 态），编辑态存成"草稿"会把人绕进两张单的歧义里。 -->
            <view
              v-if="canEdit"
              id="btn-draft"
              class="btn-ghost action-bar__item"
              @click="saveDraft" hover-class="hv-on" :hover-stay-time="80">{{ draftId ? '更新草稿' : '存草稿' }}</view>
            <!-- ★ 提交中要**看得出来**：按钮禁用 + 文案改成「提交中…」。
                 只加锁不给反馈的话，用户连点三下什么变化都没有，
                 反而更会怀疑按钮坏了、继续点（需求1 的现场就是这么来的）。 -->
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

    <!-- 客户选择弹窗 -->
    <view v-if="showCustomerPicker" class="mask" @click="showCustomerPicker = false">
      <view class="picker" @click.stop>
        <view class="picker-head">
          <text class="picker-title">选择客户</text>
          <view class="picker-close" @click="showCustomerPicker = false" hover-class="hv-on" :hover-stay-time="80"><Icon name="x" :size="20" color="text-3" /></view>
        </view>
        <view class="picker-search">
          <view class="search-box">
            <Icon name="search" :size="20" color="text-3" />
            <input v-model="custKeyword" placeholder="搜名称/手机" @input="searchCustomers" />
          </view>
        </view>
        <view class="picker-list">
          <view v-if="custError" class="picker-error">
            <text>{{ custError }}</text>
            <view class="picker-retry" @click="searchCustomers" hover-class="hv-on" :hover-stay-time="80">重试</view>
          </view>
          <view v-else-if="custLoading && !custOptions.length" class="picker-empty">加载中…</view>
          <view v-else-if="!custOptions.length" class="picker-empty">没有匹配的客户</view>
          <view v-for="c in custOptions" :key="c.id" class="picker-item" @click="pickCustomer(c)" hover-class="hv-on" :hover-stay-time="80">
            <text class="pi-name">{{ c.name }}</text>
            <text class="pi-meta">{{ c.type }} · {{ c.mobile || '' }}</text>
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
        <!-- ★ 说清列表里的价格是「按什么口径」取的：不写这句，用户无法判断
             看到的是档案价还是客户方案价（两者的差就是报价对错）。 -->
        <text class="picker-price-hint">{{ pickerPriceHint }}</text>
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
          <!-- ★ 已在明细里的商品换底色 + 行尾报条数：点之前就知道会重复，别等弹框才发现 -->
          <view v-for="p in prodOptions" :key="p.hpbh || p.id" class="picker-item"
                :class="{ 'picker-item--in': countOf(p) > 0 }" @click="onPickProduct(p)" hover-class="hv-on" :hover-stay-time="80">
            <view class="pi-main">
              <text class="pi-name">{{ p.name }}</text>
              <!-- ★ 价格口径（2026-10-10）：优先显示**按本单价格方案取到的客户价**
                   （custPrice，由 loadPickerPrices 异步补），取不到才回落到货品档案价。
                   与 pickProduct 带入明细的单价同源，避免"列表 A / 加进来 B"。 -->
              <text class="pi-meta">{{ p.spec }} · ¥{{ fmtMoney(p.custPrice ?? p.sale_price ?? p.salePriceDefault) }} / {{ p.baseUnit || p.unit }}</text>
            </view>
            <text v-if="countOf(p)" class="pi-tag">已录 {{ countOf(p) }} 行</text>
          </view>
        </view>
      </view>
    </view>

    <ThreeChoiceDialog
      :show="zeroDialog"
      title="这一行单价是 0"
      :content="zeroText"
      yes-text="记成赠品"
      :no-text="zeroNoText"
      cancel-text="先不动"
      @yes="onZeroYes"
      @no="onZeroNo"
      @cancel="onZeroCancel"
    />

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
         三个按钮各走一条路：存进草稿箱再退 / 一条都不留地退 / 关掉框继续填。
         ★ 改单态不走这个框 —— 它没有"再存一份草稿"这条路，弹的是两按钮的「放弃修改？」。 -->
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
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { salesApi } from '../../api/salesBill'
import { customerApi } from '../../api/customer'
import { productApi } from '../../api/product'
import { priceApi } from '../../api/index'
import { useCacheStore } from '../../store/cache'
import { accountOptions, loadAccountOptions } from '../../store/options'
import { fmtMoney, fmtQty, toast } from '../../utils/format'
import { calcTotal, checkEditable, editableReasonText } from '../../utils/billState'
import { PRICE_SOURCE_LABEL } from '../../utils/price'
import { PRICE_SCHEMES, billBlockReason } from '../../utils/adapt'
import { saveManualDraft, getDraft, removeDraft, draftStampText, billStockWarn,
  billZeroGift } from '../../utils/draftBox'
import { mulMoney } from '../../utils/money'
import { stockHint } from '../../utils/stockHint'
import { useBillExitGuard } from '../../utils/billExitGuard'
import { confirmRemoveLine } from '../../utils/lineTools'
import { markBillWritten } from '../../utils/billWrites'
import StatusTag from '../../components/StatusTag.vue'
import StopTag from '../../components/StopTag.vue'
import AmountText from '../../components/AmountText.vue'
import LoadState from '../../components/LoadState.vue'
import Icon from '../../components/Icon.vue'
import ThreeChoiceDialog from '../../components/ThreeChoiceDialog.vue'

const mode = ref('create')   // create | edit
// 本店 V3 的业务开关（capabilities.accountOptions，全应用共享一份）
const shopOpts = ref(accountOptions())
/**
 * 明细行给不给"按单位开"的胶囊。
 * ★ 判据是 `!== false`：开关**不知道**（null，比如这次 capabilities 没取到）时保持现有行为，
 *   不能把"没取到"演成"这家没开" —— 那会让能按单位开的客户突然只能按个开。
 */
function unitRowOk(u) {
  return shopOpts.value.billQtyByUnit !== false || !!u.basic
}
const editId = ref('')
const copyFromId = ref('')   // ★ 复制来源单号：非空 = 「复制」模式（本质是带初始数据的新增，mode 仍是 create）
/**
 * ★ 「以此开单」（商品详情带过来）：先按这个编号加一行明细，再自动弹客户面板。
 *   与复制模式同一个先例 —— mode 仍是 create，只是多带一个商品编号。
 *   吃完一次就清空：onShow 重进本页（选完客户回来也算）不许再加第二行。
 */
const seedProductId = ref('')
const seedPending = ref(false)
/**
 * ★ 草稿箱来源（非空 = 从草稿继续开单）。与复制模式同一个先例：
 *   **mode 仍是 create**（走建单分支、不显示单号、按钮是「提交」），只多带一个桶里的 id。
 *   这样 draft 不必变成第四种 mode 去改散在各处 `mode === 'create'` 的判断。
 */
const draftId = ref('')
const draftSavedAt = ref(0)  // 标题区写「存于 …」用，不参与提交
const loading = ref(false)
const ready = ref(false)
/** 库存提示开不开（设置页那张卡上的开关；每次 onShow 重读，改了不用重进页面） */
const stockWarnOn = ref(billStockWarn())
const error = ref('')

/**
 * ★★ 需求1（第九轮）：保存防重复提交的两道闸。
 *
 *   症状：「新增单据时，多次点击保存，会导致多次提交产生重复单据」。
 *   原实现的 `onSave` 里**没有任何在飞状态判断** —— 每点一次就发一次
 *   `POST /api/v1/sales`，点三下就在库里建三张单。
 *
 *   两道闸各挡一类：
 *     ① `saving` 本地锁  → 挡「连点」（最常见，不用等网络往返就能挡）；
 *     ② `submitToken`   → 挡「响应丢失后重试」：请求已经到 Agent、
 *        单据已经插库，但回程超时/断网，用户看到失败提示又点了一次。
 *        这种本地锁**挡不住**（第一次的 Promise 已经结束了），
 *        只能靠服务端按 token 去重。
 */
const saving = ref(false)
/** 一次「表单实例」共用一个幂等键；保存成功后换新（见 onSave 成功分支）。 */
const submitToken = ref(mkSubmitToken())

const form = reactive({
  billNo: '', billDate: nowStr(), status: 'unapproved',
  customerId: '', customerName: '', memo: '', items: [],
  // ★ 本单价格方案（2026-09-22 新增）。
  //   priceTrace / priceTypeXs 这对字段与客户档案同义：
  //     priceTrace=201 → 最近销价（查 Price_Kh）；=200 → 按 priceTypeXs 选价格列。
  //   ★★ 需求（第九轮）：「销售单新增/修改时，价格方案应默认取客户资料的价格方案」。
  //     所以这个初值只是**选定客户之前的占位**，一旦拿到客户档案就会被覆盖：
  //       · 新增：选客户（pickCustomer）→ 取该客户 PriceTrace/PriceTypeXS；
  //       · 修改：load() 拿到客户详情后 → 同样覆盖（改动单页也是"默认取客户档案"）。
  //     实测本库 126 个客户中 125 个 PriceTrace=201（最近销价），
  //     所以占位值写成 200/1（批发价）在界面上只是**一瞬**，不必强求准确。
  priceTrace: 200, priceTypeXs: 1,
})
const selectedCustomer = ref(null)
const notEditableReasons = ref([])

/* ===== 价格方案 ===== */
/** 7 个价格类型 + 1 个「最近销价」，与客户档案页同一套选项 */
const schemeNames = [...PRICE_SCHEMES.map((s) => s.label), '最近销价']
const schemeIndex = computed(() => {
  if (Number(form.priceTrace) === 201) return schemeNames.length - 1
  const idx = PRICE_SCHEMES.findIndex((s) => s.value === Number(form.priceTypeXs))
  return idx >= 0 ? idx : 1
})
const schemeLabel = computed(() => schemeNames[schemeIndex.value] || '批发价')
const schemeHint = computed(() => {
  if (!form.customerId) return '选客户后自动取该客户档案里的价格方案'
  return '本单新增商品将按「' + schemeLabel.value + '」取价'
})
/**
 * 商品面板的价格口径说明。三种状态：
 *   · 没选客户 → 只能是货品档案价（且此时「添加商品」本来就是禁用的）
 *   · 选了客户 → 列表价 = 按本单方案取的客户价，注明方案名
 */
const pickerPriceHint = computed(() => {
  if (!form.customerId) return '未选客户 · 显示货品档案价'
  return '按当前方案「' + schemeLabel.value + '」取价'
})

/**
 * 从客户档案抽出价格方案（需求2 的「默认值」来源）。
 * ★ 与客户档案页（customer/edit.vue）读的是同一对字段：
 *   PriceTrace 201=最近销价 / 200=按 PriceTypeXS 选价格列。
 * ★ `?? 1` 兜底：老接口若没给 price_type_xs，用 1（批发价）而不是 0（零售价）——
 *   零售价通常是最低的那个，误选它会让报价偏低；批发价更接近默认销售口径。
 */
function schemeFromCustomer(c) {
  return {
    priceTrace: Number(c && c.priceTrace) === 201 ? 201 : 200,
    priceTypeXs: Number((c && c.priceTypeXs) ?? 1),
  }
}
function setScheme(pt, px) {
  form.priceTrace = Number(pt)
  form.priceTypeXs = Number(px)
}

/**
 * ★★ 表头价格方案变动的**唯一入口**（需求2 第二半）。
 *
 *   需求原文：
 *   「当表头价格方案发生变动时，如未添加商品，则后续新增产品应按表头价格方案走，
 *     如已添加产品，则弹出提示：产品价格是否跟随变动。是则变更产品价格为对应方案价格，
 *     否则保持原来价格。该情况适用于手动更改表头价格方案，或是更换价格方案不同的客户。」
 *
 *   ⇒ 两条分支：
 *     · 明细为空 → **静默**改（没有任何已添加的价格需要保护，后续新增自然按新方案取价）；
 *     · 明细非空 → **必须问**，不能替用户决定（他可能已经逐行手工调过价，
 *       直接重取会把他改过的价格冲掉，而且不报错 —— 那是最难发现的一类数据损坏）。
 *
 *   ★ 为什么用手动 `uni.showModal` 而不是自己写弹窗：这是**阻塞式确认**语义
 *     （必须得到"跟随/不跟随"的答案才能继续），showModal 在 H5/小程序两端行为一致；
 *     且按钮文案可自定义为「跟随变动 / 不跟随」，比「确定/取消」不会歧义。
 *
 * @param {number} pt   新的 priceTrace
 * @param {number} px   新的 priceTypeXs
 * @param {string} why  变动来源说明（进提示文案，便于用户理解为何被问）
 */
async function changeScheme(pt, px, why) {
  const changed = Number(pt) !== Number(form.priceTrace)
    || Number(px) !== Number(form.priceTypeXs)
  // ★ 先落表头：无论用户后面选"跟随"还是"不跟随"，
  //   表头方案都已经是新的了（不跟随 = 只保护已有行的价格，不影响后续新增行）。
  setScheme(pt, px)
  // ★ 表头方案变了，商品面板列表里已取到的价就**全部作废**：
  //   清掉 custPrice 并重取（面板此时可能正开着，用户下一眼就要看到新方案的价）。
  //   注意这跟下面「是否跟随」的询问是两件事 —— 那个管的是**已添加明细行**，
  //   这个管的是**面板列表**，不重取就是列表与明细两个口径并存。
  //   ★ 只在方案**真的变了**时重取：否则每选一次客户（哪怕方案相同）都白发 50 次取价。
  if (changed) resetPickerPrices()
  if (!changed) return
  if (!form.items.length) return          // 未添加商品 → 静默生效
  const follow = await askFollowPrice(why)
  if (follow) await repriceAll()
  else toast('已保留原商品价格')
}

/** 丢弃面板里已取到的客户价并重取（换客户 / 换方案时调用）。 */
function resetPickerPrices() {
  pickerPriceBatch++                      // 让仍在飞的上一批响应作废
  for (const p of prodOptions.value) { if (p) delete p.custPrice }
  if (prodOptions.value.length) loadPickerPrices()
}

/** 询问「产品价格是否跟随变动」。返回 Promise<boolean>（true = 跟随）。 */
function askFollowPrice(why) {
  const n = form.items.length
  return new Promise((resolve) => {
    uni.showModal({
      title: '产品价格是否跟随变动',
      content: `价格方案已改为「${schemeLabel.value}」`
        + (why ? `（${why}）` : '')
        + `。已添加的 ${n} 个商品是否按新方案重新取价？\n`
        + '选择「不跟随」将保持这些商品现在的价格不变。',
      confirmText: '跟随变动',
      cancelText: '不跟随',
      success: (r) => resolve(!!(r && r.confirm)),
      // 弹窗失败（极端环境）时**不**自动改价 —— 宁可保持原价，也不静默覆盖用户填过的价
      fail: () => resolve(false),
    })
  })
}

/**
 * 按当前表头价格方案，重新给**所有已添加明细**取价。
 * ★ 逐个 await 而不是并发：Agent 侧取价要 JOIN 价格表，串行更稳、也让
 *   「取到几个」的进度可预期；明细通常只有几行。
 * ★ 取价失败的行**保持原价**（不写 0/NaN），并在最后如实告知成功了几行。
 */
async function repriceAll() {
  if (!form.customerId) return 0
  const pt = form.priceTrace
  const px = form.priceTypeXs
  let ok = 0
  let fail = 0
  for (const it of form.items) {
    const r = await priceApi.resolve(form.customerId, it.productId, it.unit, {
      priceTrace: pt, priceTypeXs: px,
    })
    if (r.ok && r.data && r.data.price != null) {
      it.price = r.data.price
      if (r.data.source) it.priceSource = r.data.source
      recalc(it)
      ok++
    } else {
      fail++
    }
  }
  if (!ok && fail) toast('新方案下未能取到价格，已保留原价格')
  else if (fail) toast(`已按「${schemeLabel.value}」更新 ${ok} 项，${fail} 项未取到价格`)
  else toast(`已按「${schemeLabel.value}」更新 ${ok} 项商品价格`)
  return ok
}

function onSchemePick(e) {
  const idx = Number(e.detail.value)
  if (idx === schemeNames.length - 1) {
    // 「最近销价」只看 PriceTrace，priceTypeXs 保持不动（此时它不参与取价）
    changeScheme(201, form.priceTypeXs, '手动调整')
  } else {
    changeScheme(200, PRICE_SCHEMES[idx].value, '手动调整')
  }
}

const canEdit = computed(() => mode.value === 'create' || notEditableReasons.value.length === 0)
const priceTraceLabel = computed(() => selectedCustomer.value?.priceTrace === 201 ? '最近销价' : '默认销价')
const total = computed(() => calcTotal(form.items))
const totalAmount = computed(() => total.value.totalAmount)
const totalQty = computed(() => total.value.totalQty)
// 赠品那部分单列出来（件数已含在 totalQty 里、钱不在 totalAmount 里）
const giftCount = computed(() => total.value.giftCount)
const giftAmount = computed(() => total.value.giftAmount)
const canSave = computed(() => canEdit.value && form.customerId && form.items.length > 0)

/**
 * 提交前的行级校验。返回第一个不合格行的 {i, why}，全合格返回 null。
 * ★ 为什么必须挡在本地：单价留空时 `Number('')=0` 会被后端当成"这行 0 元"照落库；
 *   断网时这条"提交意图"还会落进草稿桶，冷启动重放就真建出一张 0 元单。
 */
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
      // ★ 开着「0 元必须记赠品」时，0 元 + 没标赠品 = 不放行（输入时已经问过一次，
      //   这里兜的是"问了没答 / 先不动 / 后来又把赠品标去掉"这三种漏口）
      if (p === 0 && billZeroGift()) {
        return { i, why: '单价 0 元的行要记成赠品，或把单价改成实际成交价' }
      }
    }
  }
  return null
}

/* ===== 中途退出挽留（销售/采购两页共用 utils/billExitGuard）===== */
/**
 * ★ 判"改没改过"的快照里**只放人手填的东西**：
 *   明细的 units/baseUnit/rate/stock 是行水合（hydrateAll，不 await）从商品档案补上来的，
 *   把它们算进去就会在回填后凭空"变脏"，人什么都没做却被问一句。
 */
function guardSig() {
  return {
    billDate: form.billDate, customerId: form.customerId, memo: form.memo,
    priceTrace: form.priceTrace, priceTypeXs: form.priceTypeXs,
    items: form.items.map((it) => ({
      productId: it.productId, unit: it.unit, qty: it.qty, price: it.price, remark: it.remark || '',
      gift: !!it.gift,          // 勾/取消赠品是人的决定，必须算"改过"
    })),
  }
}
/** 挽留文案：条数与合计现读，不写死（写死的那句"确定要退出吗"没人看得进去） */
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
  hasContent: () => !!form.customerId || form.items.length > 0,
  canDraft: () => mode.value === 'create',
  sig: guardSig,
  askText,
  saving: () => saving.value,
  // ★ 自动存的草稿要把 id 记回 draftId：不然紧接着提交成功时
  //   removeDraft(draftId) 找不到它，单建好了却留一条幽灵草稿。
  silentSave: () => {
    const id = saveManualDraft('sales', draftFormShape(draftId.value), submitToken.value, true)
    if (id && !draftId.value) draftId.value = id
  },
})
/** 挽留框的三个动作：存了再走 / 一条不留地走 / 关掉框留在本页 */
function onAskSave() { closeAsk(); saveDraft() }
function onAskLeave() { closeAsk(); goBack() }
/** 页内「取消」也是中途退出：过同一个判定。只拦返回键不拦取消 = 留个能绕过的洞 */
function onCancelTap() { if (!tryBack()) uni.navigateBack() }

/* ===== 弹窗 ===== */
const showCustomerPicker = ref(false)
const showProductPicker = ref(false)
const custKeyword = ref('')
const prodKeyword = ref('')
const custOptions = ref([])
const prodOptions = ref([])
// ★ 弹窗选项的加载态 / 错误态。
//   原来只有一行 `if (res.ok) custOptions.value = res.data.list || []`：
//   请求失败就**静默留空** —— 弹窗一片空白，既没有提示也没有重试按钮，
//   用户看到的效果与「搜索无结果」完全一样，无法区分「网断了」和「真没有」。
const custLoading = ref(false)
const custError = ref('')
const prodLoading = ref(false)
const prodError = ref('')
const itemHistory = {}   // { hpbh: [历史销售记录] }

async function searchCustomers() {
  custLoading.value = true
  custError.value = ''
  const res = await customerApi.list({ keyword: custKeyword.value, pageSize: 50 })
  custLoading.value = false
  if (res.ok) {
    custOptions.value = res.data.list || []
  } else {
    custOptions.value = []
    custError.value = res.message || '客户列表加载失败'
  }
}
async function searchProducts() {
  prodLoading.value = true
  prodError.value = ''
  // ★ usage='sale'：停用的和「停止销售」的货品都不进选择面板（Agent 侧这条压过
  //   show_stopped，所以这里没有"显示已停用"的出口 —— 单上不该出现停掉的东西）。
  const res = await productApi.list({ keyword: prodKeyword.value, pageSize: 50, usage: 'sale' })
  prodLoading.value = false
  if (res.ok) {
    prodOptions.value = res.data.list || []
    // ★ 拉到货品后立刻按**本单价格方案**给这些行取价（异步补价，不阻塞列表）。
    loadPickerPrices()
  } else {
    prodOptions.value = []
    prodError.value = res.message || '商品列表加载失败'
  }
}

/** 每次取价的批次标识：方案/客户一变就 +1，让上一批的迟到响应自动作废。 */
let pickerPriceBatch = 0

/**
 * ★★★ 面板列表的「价格」必须与**加进单据后的单价**同口径。
 *
 *   背景：`product.search` 只给货品档案价（`sale_price` = Hpdan.D_SJ1 默认销价），
 *   它与「按客户价格方案取出来的价」是两回事 ——
 *   列表显示 A、点进去变成 B，用户会以为页面算错。
 *
 *   做法：对已返回的这批货品逐行调 `priceApi.resolve`（与本单 `pickProduct`
 *   **同一个接口、同一套参数**：customerId + priceTrace + priceTypeXs），
 *   把结果写到 `p.custPrice`，模板优先显示它、取不到再回退档案价。
 *
 *   ★ 为什么不并发全发：Agent 侧每次取价都要 JOIN 价格表，50 行同时打过去
 *     会把唯一那条 RPC 连接压出超时（错误还长得像"Agent 离线"）。
 *     这里限流 **4 路**，够快也不会把连接打爆。
 *   ★ 为什么不逐行 await 串行：50 行 × 单次往返会很慢，面板看着像卡死。
 *   ★ 取价失败的行**保持 undefined**（模板回落到档案价），绝不写 0 ——
 *     写 0 会让列表显示出"¥0.00"这种看起来像真实价格的假数据。
 */
async function loadPickerPrices() {
  const batch = ++pickerPriceBatch
  const cid = form.customerId
  if (!cid) return                       // 没客户就没有取价口径，老老实实显示档案价
  const pt = form.priceTrace
  const px = form.priceTypeXs
  const rows = prodOptions.value.slice()
  const CONC = 4
  let cursor = 0
  async function worker() {
    while (cursor < rows.length) {
      const p = rows[cursor++]
      // 批次失效（用户又搜索了 / 换了客户或方案）⇒ 立刻停手，别拿旧价覆盖新列表
      if (batch !== pickerPriceBatch) return
      const key = p.hpbh || p.id
      if (!key) continue
      const r = await priceApi.resolve(cid, key, p.baseUnit || p.unit, {
        priceTrace: pt, priceTypeXs: px,
      })
      if (batch !== pickerPriceBatch) return
      if (r.ok && r.data && r.data.price != null) p.custPrice = r.data.price
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, rows.length) }, worker))
}

/**
 * ★ 打开选择弹窗。必须**主动拉一次**，不能只靠搜索框的 @input。
 *
 *   原实现里两个弹窗的列表完全依赖 `<input @input="searchXxx">`：
 *   用户点开弹窗、还没碰搜索框时，列表是**空的**（custOptions 初始为 []）。
 *   正常输入法打字会触发 input ⇒ 看起来能用；
 *   但只要输入事件没落到这个 input 上（I ME 候选框、程序置值、自动填充、
 *   以及任何 navigateBack 回到本页后的旧实例），弹窗就直接白屏。
 *   ⇒ 打开弹窗时先按当前关键词拉一次；重开时若已有数据则不重复请求
 *     （保「返回不重新拉」的手感，但至少保证不会是空的）。
 */
function openCustomerPicker() {
  showCustomerPicker.value = true
  if (!custOptions.value.length || custKeyword.value) searchCustomers()
}
function openProductPicker() {
  showProductPicker.value = true
  if (!prodOptions.value.length || prodKeyword.value) searchProducts()
  // ★ 缓存命中的分支：列表不重新请求，但**价格必须按当前客户/方案重取** ——
  //   否则换了客户或改了价格方案后再开面板，看到的是上一套方案的 custPrice。
  else loadPickerPrices()
}

/**
 * ★★★ 「添加商品」入口（2026-09-22 用户需求：未选客户时禁用）。
 *
 *   模板上的禁用只是**视觉**（`.is-disabled` 降透明度），uni-app 里
 *   `<view @click hover-class="hv-on" :hover-stay-time="80">` 没有原生 disabled —— 光加样式照样能点。
 *   所以真正的拦截必须在这里做，并且：
 *     ① 给出明确原因（toast），不能静默 return（静默＝用户以为页面卡了）；
 *     ② **不打开弹窗**（打开了也会因无客户而取不到价、历史面板恒报错）。
 *   ★ 顺序很重要：先判客户，再开弹窗；反过来会出现「弹窗开着、
 *     选了商品却没有价格口径」的中间态。
 */
function onAddItem() {
  if (!form.customerId) {
    toast('请先选择客户，再添加商品')
    return
  }
  openProductPicker()
}
async function pickCustomer(c) {
  const changed = form.customerId !== c.id
  form.customerId = c.id; form.customerName = c.name
  selectedCustomer.value = c; showCustomerPicker.value = false
  if (!changed) return
  // ★ 换客户后「最近销售」口径全变（该客户该产品），缓存与已展示的历史必须作废，
  //   否则旧客户的历史会原样留在面板里，看着像新客户的成交价。
  if (form.items.length) {
    for (const k of Object.keys(itemHistory)) delete itemHistory[k]
    form.items.forEach((it) => {
      it.salesHistory = []
      it.historyError = ''
      loadHistory(it, true)
    })
  }
  // ★★ 需求2：换客户 = 表头价格方案跟着换成该客户档案里的方案。
  //   ★ 为什么不再像以前那样「用户手动改过就不覆盖」：
  //     需求原文明确把「更换价格方案不同的客户」列为要触发方案联动的场景之一，
  //     而且不能静默 —— 已加明细时会弹「产品价格是否跟随变动」让用户定夺。
  //     有了这个明示的确认框，覆盖就不存在「悄悄改掉用户选择」的问题了。
  const next = schemeFromCustomer(c)
  // ★ 「以此开单」进来的那张单，第一次选客户时**静默**按该客户方案重取价：
  //   行是系统带进来的、价格来自商品默认价，不是用户自己定的 ——
  //   这时弹「产品价格是否跟随变动」等于把系统带来的账算到用户头上，问他也没意义。
  if (seedPending.value) {
    seedPending.value = false
    setScheme(next.priceTrace, next.priceTypeXs)
    await repriceAll()
    return
  }
  await changeScheme(next.priceTrace, next.priceTypeXs, '更换客户')
}
// ---------------- 重复录入：底色 + 三按钮提示 + 定位到已录那一行 ----------------
/** 每个货品在本单已录几行（键 = hpbh）。★ 活值：删行、改数量都跟着变，不是打开时算一次。 */
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
const dupPending = ref(null)          // 弹框里等用户拍板的那个商品
const dupText = computed(() => {
  const p = dupPending.value
  if (!p) return ''
  return `「${p.name}」在本单中已录入 ${countOf(p)} 行。`
})
const hlIndex = ref(-1)               // 正在高亮的明细行下标

function onPickProduct(p) {
  if (countOf(p) > 0) { dupPending.value = p; dupDialog.value = true; return }
  pickProduct(p)
}
function onDupYes() {
  dupDialog.value = false
  const p = dupPending.value
  dupPending.value = null
  if (p) pickProduct(p)               // pickProduct 自己会关掉商品面板
}
function onDupNo() {
  dupDialog.value = false
  showProductPicker.value = false
  const p = dupPending.value
  dupPending.value = null
  if (p) locateProduct(p.hpbh || p.id)
}
/** 取消 ＝ 什么都不做，留在商品面板继续挑（这就是它和「否」的区别） */
function onDupCancel() {
  dupDialog.value = false
  dupPending.value = null
}

/**
 * 「单价填成 0」这一格子的指引（开关在「系统配置 → 开单明细」，默认关）。
 *
 * ★ 为什么在 blur（离开输入框）时才问，而不是边打字边问：0 / 0.5 / 12.07 都要经过 0，
 *   打字过程中判会吵个不停，而且会把人刚要改的值当成结论。
 * ★ 为什么"空着"不在这里问：空单价是还没填，提交时另有拦截（firstBadLine）；
 *   这里只管**明确填了 0** 这一种。
 * ★ 一行只问一次（_zeroAsked）：选完「就按 0 元」再点进这点出去，不该再弹第二遍。
 *   这个标记不进 guardSig，所以不会因此把单子判成"改过了"。
 */
const zeroDialog = ref(false)
const zeroLine = ref(null)
const zeroForced = ref(false)
const zeroNoText = computed(() => (zeroForced.value ? '返回改单价' : '就按 0 元'))
const zeroText = computed(() => {
  const it = zeroLine.value
  if (!it) return ''
  const base = `「${it.name || '这一行'}」单价填的是 0。`
  return zeroForced.value
    ? base + '这一版要求 0 元的行记成赠品：件数照扣库存、金额不计进合计。'
    : base + '记成赠品就不计金额（件数照扣库存）；确实要按 0 元成交，选「就按 0 元」。'
})

function onPriceBlur(it) {
  if (!canEdit.value) return
  const raw = String(it.price == null ? '' : it.price).trim()
  if (raw === '') return
  const p = Number(raw)
  if (!Number.isFinite(p) || p !== 0 || it.gift || it._zeroAsked) return
  zeroForced.value = billZeroGift()
  zeroLine.value = it
  zeroDialog.value = true
}
function onZeroYes() {
  const it = zeroLine.value
  zeroDialog.value = false; zeroLine.value = null
  if (!it) return
  it.gift = true
  it._zeroAsked = true
  recalc(it)
  toast('这一行按赠品记：不计金额，件数照扣库存')
}
function onZeroNo() {
  const it = zeroLine.value
  zeroDialog.value = false; zeroLine.value = null
  if (!it) return
  if (zeroForced.value) { toast('0 元的行要记赠品，或把单价改成实际成交价'); return }
  it._zeroAsked = true
  toast('按 0 元记这一行（合计里是 0）')
}
/** 「先不动」= 关掉框留在原处，单价还是 0；下次离开输入框会再问一次 */
function onZeroCancel() { zeroDialog.value = false; zeroLine.value = null }

/**
 * 「以此开单」带进来的那一行：拉商品档案 → 走**与面板选品完全同一条**加行路（pickProduct）。
 * ★ 不在这里自己拼一行：拼出来的行缺 units/baseUnit/rate，单位胶囊与折合是空的
 *   （多单位那一轮已经修过一次，别再开第二个口子）。
 * ★ 加完再 markClean()：这一行是系统带进来的、不是人填的 ——
 *   什么都没动就按返回，不该被挽留拦一句"这单还没提交"。
 * ★ 这条路**绕过选择面板**（面板那侧由后端过滤），所以状态要在这里自己拦一遍：
 *   停用的、停止销售的货品不能从详情页「以此开单」带进单里。
 */
async function applySeed() {
  const id = seedProductId.value
  if (!id) return
  seedProductId.value = ''
  const r = await productApi.detail(id)
  if (!r.ok || !r.data) { toast(r.message || '这个商品打不开，请回商品页重试'); return }
  const blocked = billBlockReason(r.data, 'sale')
  if (blocked) {
    toast('「' + (r.data.name || id) + '」' + blocked + '，不能开单')
    if (seedPending.value) openCustomerPicker()
    return
  }
  await pickProduct(r.data)
  markClean()
  if (seedPending.value) openCustomerPicker()
}

/**
 * 把第 i 行明细滚到视口垂直居中。新增一行、以及「否」去改已录行时都用它。
 * ★ 行是 push 之后才渲染的：nextTick 之后仍可能差一帧，留 60ms 再量；
 *   量不到（节点还没出来）就**不滚**，宁可不动也别把页面弹到顶。
 */
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

/**
 * 定位到已录那一行：滚到居中 + 高亮 1.5 秒。
 */
function locateProduct(key) {
  const i = form.items.findIndex((it) => String(it.productId || '') === String(key || ''))
  if (i < 0) { toast('未找到对应明细行'); return }
  hlIndex.value = i
  scrollToLineCenter(i)
  setTimeout(() => { hlIndex.value = -1 }, 1500)
}

async function pickProduct(p) {
  showProductPicker.value = false
  const key = p.hpbh || p.id
  // 取价：真实后端 GET /price 返回 {price, source, unit, rate, recent, manual}
  // ★ 带上本单的「价格方案」（priceTrace / priceTypeXs）——
  //   不传的话 Agent 只会按客户档案取价，页面上选的方案形同虚设。
  let price = p.sale_price ?? p.salePriceDefault ?? 0
  let source = 'default'
  if (form.customerId) {
    const r = await priceApi.resolve(form.customerId, key, p.baseUnit || p.unit, {
      priceTrace: form.priceTrace,
      priceTypeXs: form.priceTypeXs,
    })
    if (r.ok) { price = r.data.price; source = r.data.source }
  }
  // ★ 先把明细行推进去（不等历史），历史异步拉取。
  //   否则接口一慢，用户点了商品却半天不出行，像是没反应。
  const ck = historyKey(key, form.customerId)
  const baseUnits = Array.isArray(p.units) && p.units.length
    ? p.units.filter((u) => u && u.unit && !u.stopped && unitRowOk(u)) : []
  const item = reactive({
    idenGuid: '',                                   // 新增行不带 iden_guid
    productId: key,
    name: p.name,
    spec: p.spec,
    unit: p.baseUnit || p.unit,
    // ★ 多单位：胶囊与倍率来自后端 units（HpdanUnit 一单位一行）。
    //   库里只有一个单位时就一行胶囊，界面与改造前一样（不硬造"按箱卖"）。
    units: baseUnits.length ? baseUnits
      : [{ unit: p.baseUnit || p.unit || '', rate: 1, basic: true, stopped: false,
           salePrice: Number(p.salePriceDefault || price || 0) }],
    rate: 1,
    baseUnit: (baseUnits.find((u) => u.basic) || {}).unit || p.baseUnit || p.unit || '',
    stock: Number(p.stock || 0),
    // 0/1/undefined 三态，别写成 `|| 0`（那会把"老包没说"当成"从没入过库"）
    stockRecord: p.stockRecord,
    qty: 1, price, amount: price,
    priceSource: source,
    remark: '',
    gift: false,
    salesHistory: itemHistory[ck] || [],
    historyLoading: false,
    historyError: '',
    showHistory: false,
  })
  form.items.push(item)
  scrollToLineCenter(form.items.length - 1)   // ★ 新行落到视口中央，别让用户往上翻找
  loadHistory(item)
}

/**
 * 换单位：单价、折合数量、库存够不够要**一起**变。
 * ★ 单价优先问后端按该单位取价（库里每单位有自己的价），
 *   取不到才退回单位档案上填的售价 —— **绝不在前端拿基本价 × 倍率伪造价格**。
 */
async function switchUnit(it, u) {
  if (!u || !u.unit || it.unit === u.unit) return
  it.unit = u.unit
  it.rate = Number(u.rate) || 1
  let done = false
  if (form.customerId) {
    const r = await priceApi.resolve(form.customerId, it.productId, u.unit, {
      priceTrace: form.priceTrace, priceTypeXs: form.priceTypeXs,
    })
    if (r && r.ok && r.data) {
      it.price = r.data.price
      it.priceSource = r.data.source
      done = true
    }
  }
  if (!done && Number(u.salePrice) > 0) {
    it.price = u.salePrice
    it.priceSource = 'unit'
    done = true
  }
  // ★ 换单位后取不到这一档的价，就必须把**旧单位的价清掉**：留着等于按
  //   "1 箱 = 1 个的价"成交，而且来源标签还写着上一档的"最近销价"，人没有任何线索去核对。
  if (!done) { it.price = ''; it.priceSource = 'manual' }
  recalc(it)
}

/** 折成基本单位的数量（库存与成本按这个口径比） */
function foldQty(it) {
  const r = Number(it.rate || 1)
  return fmtQty((Number(it.qty) || 0) * (r > 0 ? r : 1))
}

/**
 * 这一行的库存提示（话怎么说、算哪个口径全在 `utils/stockHint.js`，那边能被 Node 门真调）。
 * ★ 开关每次现读：设置页关掉之后回到这张单不用重进。
 */
function stockTip(it) {
  return stockHint(it, { on: stockWarnOn.value })
}

/**
 * 拉取某行货品的「该客户该货品」的最近销售记录。
 * ★ 必须走 productApi.salesHistory（专用接口），不能靠销售单列表反查 ——
 *   列表项不含明细行。详见 api/product.js 的注释。
 * ★★ **必须带 customer**：业务语义是「这张单卖给这个客户，上次卖给他多少钱」
 *    —— 只取当前客户的历史，别人的成交价对本单没有参考意义（还可能误导报价）。
 *    接口按 XS.ItemBh（单头客户）过滤；不传 customer 会拿到**所有客户**的记录。
 * ★ 缓存 key 必须含客户：换客户后同一货品的口径完全不同，
 *   只按 hpbh 缓存会把上一个客户的历史**串给新客户**（静默错数据）。
 * ★ 加 loading 标记：接口失败/进行中时，页面不能显示「0 笔 / 暂无记录」，
 *   那会让人误以为「这个货品真的没卖过」，从而把「没拉到」当成「真的没有」。
 */
function historyKey(productId, customerId) {
  return String(productId || '') + '|' + String(customerId || '')
}

async function loadHistory(item, force = false) {
  const key = item.productId
  if (!key) return
  // ★ 没选客户时无从过滤，直接提示而不是拉全量（全量＝错口径）
  if (!form.customerId) {
    item.salesHistory = []
    item.historyLoading = false
    item.historyError = '请先选择客户'
    return
  }
  const ck = historyKey(key, form.customerId)
  if (itemHistory[ck] && !force) { item.salesHistory = itemHistory[ck]; return }
  item.historyError = ''
  item.historyLoading = true
  const hr = await productApi.salesHistory(key, { customer: form.customerId })
  item.historyLoading = false
  if (hr.ok) {
    itemHistory[ck] = hr.data || []
    item.salesHistory = itemHistory[ck]
  } else {
    item.historyError = hr.message || '加载失败'
  }
}

/** 删行先问一句（确认框与文案在 utils/lineTools 里，采购开单页共用同一份） */
function removeItem(i) { confirmRemoveLine(form, i) }
function toggleHistory(it) {
  it.showHistory = !it.showHistory
  // 展开时按需拉取（新建行在 pickProduct 里已拉过，这里靠缓存短路）
  if (it.showHistory && !it.salesHistory?.length && !it.historyLoading && !it.historyError) {
    loadHistory(it)
  }
  if (!it.showHistory) it.historyAll = false   // 关掉面板就把"全部"收回，下次进来还是那 3 笔
}
/** ★ 历史面板默认只露 3 笔：一屏装得下，也不会把下面的备注/加行按钮顶走；
 *   其余的要点「展开全部 N 笔」才放出来（再点收回）。 */
const HISTORY_PREVIEW = 3
function shownHistory(it) {
  const list = it.salesHistory || []
  return it.historyAll ? list : list.slice(0, HISTORY_PREVIEW)
}
function toggleHistoryAll(it) { it.historyAll = !it.historyAll }

/**
 * 品名/规格「点开看全文」：null = 全收起，否则 = 当前展开的那一条明细对象。
 * ★ 两个刻意的选择：
 *   ① 页面级一个 ref，**不往 it 上加字段** —— showHistory 这种行字段得在 createItem 的
 *      4 处 + utils/adapt.js 各初始化一遍，漏一处就是"点了没反应"而且不报错。
 *      页面级 ref 还天然互斥：一次只展开一行，不会连点几行把屏幕撑爆。
 *   ② 记**对象引用**而不是下标 —— 删掉上面一行之后下标会平移，用下标就会出现
 *      "展开的变成了别人的行"。记引用没有这个问题，也不用在 removeItem 里补清理。
 *      （改单回填 / 重载会把 items 换成新对象，这时比较自然为 false ⇒ 自动全收起，是对的。）
 */
const openDescItem = ref(null)
function toggleDesc(it) { openDescItem.value = openDescItem.value === it ? null : it }

/**
 * 一行规格的**完整文案**（规格 · 按X开）。
 * ★ 必须收在一个函数里：这段文案现在出现在**两个地方** —— 收起态挤在品名同行、
 *   展开态独占一行。两处各写一遍的话，哪天改了写法必然只改一处，
 *   表现就是"展开前后的规格不一样"，而且不报错。
 * ★ 而且要拼成**一个字符串**再渲染：写成 `{{ it.spec }}<text> · 按X开</text>` 的话，
 *   内层 <text> 是另一个 uni-text，H5 基础规则 `uni-text{white-space:pre-line}` 管到它身上，
 *   外层的 nowrap 管不到 ⇒ 收起态被挤窄时内层自己折成两行把卡片撑高（实测踩过）。
 */
function specLine(it) {
  let s = it.spec || ''
  if (it.unit) s += ` · 按${it.unit}开`
  return s
}

/**
 * 行金额 = 这一行**计入合计的钱**。
 * ★ 赠品行回 0：库里对应的是 `J_JEZK`（折后金额）被清零，单价 `D_DJ` 与金额 `J_JE` 照记
 *   —— 口径来自 V3 桌面端实测样本（见 utils/billState.js 的 calcTotal 注释），
 *   所以界面上"行上 0.00、单价还在"与详情页、与单头应收三者是同一个数。
 */
function recalc(it) {
  if (it.gift) { it.amount = 0; return }
  it.amount = mulMoney(it.qty, it.price)
}
/** 赠品开关：只切标记 + 重算这一行的计入金额，**不动单价**（单价是这批货的价值） */
function toggleGift(it) {
  if (!canEdit.value) return
  it.gift = !it.gift
  recalc(it)
}
function priceSourceText(s) { return PRICE_SOURCE_LABEL[s] || s }

/* ===== 加载 ===== */
async function load() {
  // ★ 复制模式本质是「带初始数据的新增」：mode 仍是 create，只是 copyFromId 非空时
  //   先拉原单数据预填表单（billNo 留空、日期当天、明细 idenGuid 清空 —— 都是新单）。
  const sourceId = mode.value === 'edit' ? editId.value : copyFromId.value
  if (sourceId) {
    const isCopy = !!copyFromId.value
    loading.value = true; error.value = ''
    const res = await salesApi.detail(sourceId)
    loading.value = false
    if (!res.ok) { error.value = res.message; return }
    const raw = res.data || {}
    // ★★★ salesApi.detail 返回的是 toBillDetail 适配后的「页面形状」：
    //   { billNo, billDate, customerCode, customerName, memo, status, items[],
    //     editable, editableReasons, ... }，**不是**后端原始的
    //   { bill_no, ndate, customer:{code,name}, lines[], editable_reasons }。
    //   旧代码按原始契约读：customer?.code 恒 undefined → customerId 恒空 →
    //   canSave 恒 false → 「保存修改」按钮看着能点、点了没反应（2026-09-21 修）。
    // ★ 复制：新单，billNo 留空（保存时自动取号）；日期用「今天」，不是原单日期。
    form.billNo = isCopy ? '' : (raw.bill_no || raw.billNo || '')
    // ★ 日期带时分秒：后端 `ndate` 是 `YYYY-MM-DD HH:mm:ss`，以前 `.slice(0,10)`
    //   把时分秒**截掉**了 —— 改单保存会把原单时间改成当天 00:00:00（静默改数据）。
    //   现在用 normDateTime 规整成 19 位（只有日期时补 00:00:00，不补毫秒）。
    form.billDate = isCopy ? nowStr() : normDateTime(raw.ndate || raw.billDate)
    form.status = isCopy ? 'unapproved' : (raw.status || 'unapproved')
    form.customerId = raw.customer?.code || raw.customerCode || raw.customerId || ''
    form.customerName = raw.customer?.name || raw.customerName || ''
    form.memo = raw.bz_xs ?? raw.memo ?? ''
    form.items = (raw.lines || raw.items || []).map((it) => ({
      // 行字段兼容两种形状：原始 iden_guid/hpbh、适配后 idenGuid/productId。
      // ★ iden_guid 丢了 = 全部原行被当成「新增」，update 会删光原行重插 —— 必须兜底。
      // ★ 复制模式：明细是「新行」，idenGuid 必须清空（带着原行 id 会被误认成改单）。
      idenGuid: isCopy ? '' : (it.iden_guid || it.idenGuid || ''),
      productId: it.hpbh || it.productId || '',
      name: it.name || '',
      spec: it.spec || '',
      unit: it.unit || '',
      qty: it.qty,
      price: it.price,
      // ★ 后端没给折后金额才现算：走 mulMoney（半偶、与库里同一口径），
      //   赠品行记 0（J_JEZK 本来就不计钱），不再留一个"不取整的裸乘法"给合计对不上。
      amount: it.amount != null ? it.amount : (it.gift ? 0 : mulMoney(Number(it.qty || 0), Number(it.price || 0))),
      priceSource: it.price_source || it.priceSource || '',
      remark: it.remark ?? '',
      gift: !!it.gift,
      salesHistory: [],
      historyLoading: false,
      historyError: '',
      showHistory: false,
    }))

    // 优先使用后端返回的不可改原因（原始 editable_reasons / 适配后 editableReasons）
    // ★ 复制模式不套原单的「不可改」判断 —— 新单永远可改（即使原单已审核/作废）。
    if (!isCopy) {
      const backendReasons = Array.isArray(raw.editable_reasons)
        ? raw.editable_reasons
        : (Array.isArray(raw.editableReasons) ? raw.editableReasons : null)
      if (backendReasons) {
        notEditableReasons.value = backendReasons
      } else if (raw.editable === false) {
        notEditableReasons.value = ['该单据不可修改']
      } else {
        const { reasons } = checkEditable(raw)
        notEditableReasons.value = reasons
      }
      if (notEditableReasons.value.length) toast(editableReasonText(notEditableReasons.value))
    }

    // 取客户
    if (form.customerId) {
      const cr = await customerApi.detail(form.customerId)
      if (cr.ok) {
        selectedCustomer.value = cr.data
        // ★★ 需求2：「销售单**新增/修改**时，价格方案应默认取客户资料的价格方案」。
        //   XS 表**没有价格方案列**（方案不落库，只在建单/取价那一次生效），
        //   所以改单页唯一能"默认"的来源就是客户档案。
        //   ★ 这里直接 setScheme、**不走 changeScheme** —— 不能弹「是否跟随变动」：
        //     明细虽有行，但用户此刻只是「打开这张单」，并没有做出任何方案变更动作。
        //     弹框会让他以为系统擅自改了方案（而且他无从判断原方案是什么，
        //     因为库里根本没存过）。
        const s = schemeFromCustomer(cr.data)
        setScheme(s.priceTrace, s.priceTypeXs)
      }
    }
    // ★ 明细行的「最近销售」= 该客户该货品的历史，必须在客户拿定之后再拉。
    //   以前只在「新加商品」时拉，改单进来的原行恒显示 0 笔。
    form.items.forEach((it) => loadHistory(it))
    // ★ 销售单详情里**没有**单位胶囊/库存/基本单位（那些属于商品档案），逐行水合补齐。
    //   不补的话编辑一张已提交的单：单位胶囊是空的、库存差不显示（用户确认的既有 bug）。
    hydrateAll()
  }
  ready.value = true
  markClean()          // 到手的样子就是"没改过"，之后只有人动过才值得挽留
  searchCustomers(); searchProducts()
  applySeed()          // 「以此开单」带的商品行 + 自动弹客户面板（不 await，别挡首屏）
}

/* ===== 草稿箱：回填 / 存草稿 / 行水合 ===== */
/**
 * 行水合：把明细行缺的 `units / baseUnit / rate / stock` 补回来。
 *
 * ★ 为什么必须有：单据详情与断网草稿 payload 里都只有「这一行成交时是什么」（品名/规格/
 *   单位/数量/单价），而单位胶囊、折合库存要的是**商品档案**里的多单位与现存量。
 *   以前 load() 直接映射就丢了这四样 ⇒ 编辑已提交单据时单位区是空的（用户确认）。
 * ★ 品名/规格以**单据行**为准，不覆盖 —— 那是成交当时的样子，商品后来改名不该改历史单。
 * ★ 商品被删/查不到就保持原行不动：编辑一张老单不该被一个下架商品挡住。
 */
async function hydrateLine(it) {
  if (!it || !it.productId) return
  if (Array.isArray(it.units) && it.units.length && it.baseUnit) return   // 手动草稿里已带齐
  const r = await productApi.detail(it.productId)
  if (!r.ok || !r.data) return
  const p = r.data
  const all = Array.isArray(p.units) ? p.units : []
  const list = all.filter((u) => u && u.unit && !u.stopped && unitRowOk(u))
  // 这一行用的单位可能已被停用/被筛掉：留着它，否则胶囊行点不出当前单位
  if (it.unit && !list.some((u) => u.unit === it.unit)) {
    list.unshift(all.find((u) => u && u.unit === it.unit)
      || { unit: it.unit, rate: Number(it.rate) || 1, basic: false, stopped: true })
  }
  it.units = list.length ? list : [{
    unit: it.unit || p.baseUnit || '', rate: 1, basic: true, stopped: false,
    salePrice: Number(p.salePriceDefault || 0),
  }]
  if (!it.baseUnit) it.baseUnit = ((all.find((u) => u && u.basic) || {}).unit) || p.baseUnit || it.unit || ''
  const cur = it.units.find((u) => u.unit === it.unit)
  if (cur) it.rate = Number(cur.rate) || 1
  it.stock = Number(p.stock || 0)
  // 档案刚刷出来时以档案为准；老包没说这个键 ⇒ 明确落回"未知"，不留上一次的旧值
  it.stockRecord = p.stockRecord
}
/** 串行逐行：明细通常几行，与 repriceAll 同样的并发克制；不 await，不挡表单可用 */
async function hydrateAll() {
  for (const it of form.items) {
    try { await hydrateLine(it) } catch (e) { /* 单行水合失败不影响别的行 */ }
  }
}

/** 表单 → 草稿形状。明细只留界面回填要用的键；`salesHistory` 不存（展开时按需重拉）。 */
function draftFormShape(id) {
  return {
    draftId: id || '',
    billDate: form.billDate, customerId: form.customerId, customerName: form.customerName,
    memo: form.memo, priceTrace: form.priceTrace, priceTypeXs: form.priceTypeXs,
    items: form.items.map((it) => ({
      idenGuid: it.idenGuid || '', productId: it.productId, name: it.name, spec: it.spec,
      unit: it.unit, units: Array.isArray(it.units) ? it.units : [],
      rate: it.rate, baseUnit: it.baseUnit || '', stock: Number(it.stock || 0),
      // 三态照存（草稿回来时那句提示不至于变味；展开历史时会按档案重刷）
      stockRecord: it.stockRecord,
      qty: it.qty, price: it.price, amount: it.amount,
      priceSource: it.priceSource || '', remark: it.remark || '',
      gift: !!it.gift,
    })),
  }
}

/**
 * 存草稿。校验比提交宽（有客户**或**有明细就行），空表单不值得占一个草稿位。
 * ★ 提交仍走 onSave 的全量校验，这里不动它 —— 存草稿不是提交的前置步骤。
 */
function saveDraft() {
  if (!form.customerId && !form.items.length) { toast('先选客户或添加明细'); return }
  draftId.value = saveManualDraft('sales', draftFormShape(draftId.value), submitToken.value)
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
    // 草稿没落库 ⇒ 没有单号；日期沿用存的那一刻，不重置成"现在"
    form.billNo = ''
    form.billDate = f.billDate || nowStr()
    form.status = 'unapproved'
    form.customerId = f.customerId || ''
    form.customerName = f.customerName || ''
    form.memo = f.memo || ''
    // ★ 价格方案沿用草稿里存的那一份，**不**被客户档案覆盖：
    //   人在存草稿之前可能已经把方案调过了，回填又跳回档案值等于擅自改他的选择。
    if (f.priceTrace != null) form.priceTrace = f.priceTrace
    if (f.priceTypeXs != null) form.priceTypeXs = f.priceTypeXs
    // ★ 幂等键跟着草稿走：同一张草稿反复提交（哪怕响应丢了再点）只落一张单
    if (d.submitToken) submitToken.value = d.submitToken
    form.items = (f.items || []).map((it) => reactive(Object.assign({
      salesHistory: [], historyLoading: false, historyError: '', showHistory: false,
    }, it)))
  } else {
    const p = d.payload || {}
    form.billNo = ''
    form.billDate = normDateTime(p.ndate)
    form.status = 'unapproved'
    form.customerId = p.customer || ''
    form.customerName = p.customerName || ''
    form.memo = p.note || ''
    if (p.price_trace != null) form.priceTrace = p.price_trace
    if (p.price_type_xs != null) form.priceTypeXs = p.price_type_xs
    form.items = (p.lines || []).map((ln) => reactive({
      idenGuid: ln.iden_guid || '', productId: ln.hpbh || '', name: ln.name || '',
      spec: ln.spec || '', unit: ln.unit || '', units: [], rate: Number(ln.rate) || 1,
      baseUnit: '', stock: 0,
      qty: ln.qty, price: ln.price,
      // 赠品行计入合计的钱是 0（库里 J_JEZK 就是 0），与 recalc 同一条口径
      amount: ln.gift ? 0 : Number(ln.qty || 0) * Number(ln.price || 0),
      priceSource: ln.price_source || ln.priceSource || '', remark: ln.remark || '',
      gift: !!ln.gift,
      salesHistory: [], historyLoading: false, historyError: '', showHistory: false,
    }))
    hydrateAll()
  }
  if (form.customerId) {
    const cr = await customerApi.detail(form.customerId)
    if (cr.ok) {
      selectedCustomer.value = cr.data
      if (!form.customerName) form.customerName = cr.data.name || ''
    }
  }
  form.items.forEach((it) => loadHistory(it))
  ready.value = true
  markClean()          // 到手的样子就是"没改过"，之后只有人动过才值得挽留
  searchCustomers(); searchProducts()
}

async function onSave() {
  // ★★★ 第一道闸：本地「保存中」锁（需求1）。
  //   症状（用户报障原文）：「在真机测试中，发现新增单据时，多次点击保存，
  //   会导致多次提交产生重复单据」。
  //   原实现没有任何在飞状态判断 —— 每点一次就发一次 POST /sales，点三下建三张单。
  //   ★ 为什么必须有这一道、而不是只靠后端幂等：连点是最常见的重复来源，
  //     挡在本地最省事也最快（后端的往返要几百毫秒，足够用户点第二下）。
  if (saving.value) return
  if (!canSave.value) {
    // ★ 之前是静默 return —— 按钮看着能点、点了没反应，像「按钮坏了」。
    //   现在被拦时把原因说出来。
    if (!canEdit.value) toast(editableReasonText(notEditableReasons.value) || '该单据不可修改')
    else if (!form.customerId) toast('请先选择客户')
    else toast('请先添加商品明细')
    return
  }
  const bad = firstBadLine()
  if (bad) { toast(`第 ${bad.i + 1} 行：${bad.why}`); return }
  saving.value = true
  // ★ 保存成功后**不复位** saving：此刻页面正在跳走（redirectTo / navigateBack），
  //   复位了那几百毫秒的空窗期里再点一下 = 又建一张单。
  let done = false
  try {
    let res
    if (mode.value === 'create') {
      // 真实契约：{ customer: 客户编号, lines:[{hpbh,unit,qty,price,remark?}], ndate?, warehouse?, note? }
      // ★ 带上价格方案：只对未给价的行生效（本页每行都已有价，属「双保险」——
      //   万一某行价格为 0/空，Agent 侧按本单方案取价而不是客户档案）。
      const payload = {
        customer: form.customerId,
        ndate: form.billDate,
        note: form.memo || '',
        price_trace: form.priceTrace,
        price_type_xs: form.priceTypeXs,
        // ★★ 幂等键（需求1 的第二道闸）：
        //   同一「表单实例」的所有提交复用同一个 token —— 于是
        //   「响应超时/丢失后用户再点一次」不会在库里多出一张单，
        //   Agent 会把第一次那张单原样回给他。见 v3agent/sales.py 的「建单幂等」。
        //   ★ 只在 create 带：改单走 PUT（按单号覆盖），本身就是幂等的。
        client_token: submitToken.value,
        lines: form.items.map((it) => ({
          hpbh: it.productId,
          unit: it.unit,
          qty: Number(it.qty),
          price: Number(it.price),
          // ★ 赠品位只发 0/1 整数，不发 true/false：断网草稿重放时 payload 是从 JSON
          //   原样发过去的，`true` 到 pymssql 那里会被 SQL Server 判成 nvarchar→bit 转换错(8114)。
          gift: it.gift ? 1 : 0,
          // ★ 明细行备注（落 XSMX.BZ_XSMX）—— 之前漏传，后端又没写这一列，
          //   所以备注一直是「填了也没用」。
          remark: it.remark || '',
        })),
      }
      res = await salesApi.create(payload)
    } else {
      // 改单契约：{ header, lines }，lines 必须是最终完整明细
      // ★ 带 iden_guid = 保留/修改原行；不带 = 新增行；未提交的原行会被删除
      const payload = {
        header: {
          NDate: form.billDate,
          ItemBh: form.customerId,
          BZ_XS: form.memo || '',
        },
        lines: form.items.map((it) => {
          const line = {
            hpbh: it.productId,
            unit: it.unit,
            qty: Number(it.qty),
            price: Number(it.price),
            // ★ 改单也必须带赠品位：后端把"没带这一键"当成**不动它**（编辑语义），
            //   所以只勾不改别的字段时，不带上来就 = 勾了个寂寞 —— 取消已有赠品行也取消不掉。
            //   与建单同一条口径：只发 0/1 整数，不发 true/false。
            gift: it.gift ? 1 : 0,
            // ★ 明细行备注也要提交，否则改备注等于没改
            remark: it.remark || '',
          }
          if (it.idenGuid) line.iden_guid = it.idenGuid
          return line
        }),
      }
      res = await salesApi.update(editId.value, payload)
    }

    if (res.ok) {
      // ★ 单已经落库了，这一页没有"还没交的东西"⇒ 先把挽留闸门让开。
      //   建单成功走的是 redirectTo（不经过 goBack），不让开的话 onUnload 会以为
      //   人是被小程序/H5 后退带走的，再往草稿箱里塞一条自动草稿。
      allowLeave()
      // ★ 告诉销售列表"这趟真写过"，返回列表才整页刷（看一眼详情返回不该把人翻到的页码刷掉）
      markBillWritten('sales')
      // ★ 草稿的去留：提交成功之后桶里那条必须删 —— 留着就变成"这张单在草稿箱里还有一份"，
      //   下次点它又会建一张。断网提交（res.draft）也算成功：数据已经进了自动重放队列，
      //   手动草稿再留一份就是双份意图。
      if (draftId.value && mode.value === 'create') {
        removeDraft(draftId.value)
        draftId.value = ''
        draftSavedAt.value = 0
      }
      // ★ 成功后换一把新 token：本表单实例已经落过库了，若后续（同一页面未销毁）
      //   再发生一次提交，它必须是一个**新的**提交，不能被旧 token 命中去重。
      submitToken.value = mkSubmitToken()
      if (res.draft) { done = true; toast(res.message || '已存为草稿'); goBack(); return }
      // ★ 主动作废详情缓存：改了单，缓存的旧详情立刻失效。
      //   否则详情页刷新若走到 `offlineOk` 的缓存兜底分支，会把改之前的数据回显。
      if (mode.value === 'edit' && editId.value) useCacheStore().remove('sale:' + editId.value)
      toast('提交成功', 'success')
      // ★★ 保存后必须让「销售单详情」重新拉数据。
      //   以前一律 `navigateBack()`：退回详情页时页面是缓存的，而详情页只有
      //   onLoad —— 不会重新请求，于是仍显示改之前的单头与明细（用户反馈的原话：
      //   「保存修改返回销售单详情时应自动刷新，否则还是会显示原数据」）。
      //   · 改单：退回上一页（详情），由详情页新增的 onShow 兜底刷新 ——
      //     保留「详情 → 修改 → 返回详情」的导航层级，不破坏导航栈。
      //   · 建单：上一页是列表，退回列表看不到刚建的这张单；
      //     所以直接 redirectTo 到新单详情（全新页面实例，onLoad 必然执行）。
      const newNo = extractBillNo(res.data)
      done = true
      if (mode.value === 'create' && newNo) {
        uni.redirectTo({ url: '/pages/sales/detail?id=' + encodeURIComponent(newNo) })
        return
      }
      goBack()
    } else {
      // 409 BILL_NOT_EDITABLE：把后端给的具体原因展示出来
      const detail = res.detail && (res.detail.reasons || res.detail)
      const extra = Array.isArray(detail) && detail.length ? '：' + detail.join('、') : ''
      toast((res.message || '提交失败') + extra)
    }
  } finally {
    // ★ 只有**失败**才解锁：失败后用户当然要能重试。
    //   成功路径保持锁定（页面正在跳走，见上面 done 的说明）。
    if (!done) saving.value = false
  }
}

/**
 * 生成一次「表单实例」的幂等键。
 * ★ 为什么是「表单实例」而不是「每次点击」：
 *   如果每次点击都换新 token，那后端就无从判断第二次点击是「重试」还是「新提交」，
 *   幂等完全失效。同一个 token 覆盖「同一份表单内容的所有提交尝试」才有意义。
 * ★ 为什么不用 uuid 库：项目没引，Math.random + 时间戳足够 —— 它只需要在本页面
 *   实例范围内不重复，不是全局唯一标识。
 */
function mkSubmitToken() {
  return 'sb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/**
 * 从保存响应里抠出单号。
 * ★ 三种形状都要认（否则详情页拿不到 id，白跳一趟）：
 *   create → 原始 get_bill 形状 { bill_no }
 *   update → { changed, bill: { bill_no } }
 *   适配后 / 未来包装 → { billNo } 或 { data: {...} }
 */
function extractBillNo(data) {
  if (!data) return ''
  const d = data.data && typeof data.data === 'object' ? data.data : data
  return d.bill_no || d.billNo || d.no || (d.bill && (d.bill.bill_no || d.bill.billNo)) || ''
}

/**
 * 页面自己要走 ⇒ 先把挽留闸门让开。
 * ★ 不让开的话，`uni.navigateBack()` 在 App/H5 上同样会走本页的 onBackPress ——
 *   提交成功、存完草稿、点了「直接退出」之后再被问一遍，那就是故障不是挽留。
 */
function goBack() { allowLeave(); uni.navigateBack() }

/* ===== 日期 / 时间（YYYY-MM-DD HH:mm:ss）=====

 * ★★ 2026-09-22 用户要求：日期要带时分秒，格式 `YYYY-MM-DD HH:mm:ss`。
 *
 *   为什么**不能**用 `<picker mode="date">` 了：
 *     该模式的 `detail.value` 只有 `'YYYY-MM-DD'`，时分秒拿不到；
 *     而 uni-app 的 `<picker mode="time">` 又只有时分。
 *   ⇒ 改成两个 picker（date + time）拼装，用户既能选日期也能选时间。
 *
 *   ★ 为什么必须是**无毫秒**的 19 位字符串：
 *     与 Agent 写入口径一致（sales.py 头部常量 TIME_FMT = "%Y-%m-%d %H:%M:%S"，
 *     且注释明确「不要用 GETDATE()」——GETDATE() 带 3 位毫秒，与桌面端/历史数据形态不符）。
 *     这里少补一次，后端就会存成带毫秒的样子，和存量 36604 行不一致。
 */
const datePart = computed(() => String(form.billDate || '').slice(0, 10))
const timePart = computed(() => String(form.billDate || '').slice(11, 19) || '00:00:00')

/** 日期选择：date picker 的 value 是 'YYYY-MM-DD' */
function onDatePick(e) {
  form.billDate = e.detail.value + ' ' + (timePart.value || '00:00:00')
}
/** 时间选择：time picker 的 value 是 'HH:mm:ss' */
function onTimePick(e) {
  form.billDate = (datePart.value || today()) + ' ' + e.detail.value
}

/** 当前时间，`YYYY-MM-DD HH:mm:ss`（无毫秒，与 Agent TIME_FMT 同口径） */
function nowStr() {
  const t = new Date(); const p = (x) => String(x).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ` +
         `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
}
/** 仅日期部分（date picker 需要这个形状） */
function today() {
  return nowStr().slice(0, 10)
}

/**
 * 把任意后端返回的日期串规整成 `YYYY-MM-DD HH:mm:ss`。
 * ★ 兼容三种真实形状：
 *   '2026-09-20 16:37:59'（标准）/ '2026-09-20T16:37:59'（ISO）/ '2026-09-20'（只有日期）
 *   只有日期时补 `00:00:00`；**不补毫秒**（见上面口径说明）。
 */
function normDateTime(v) {
  const s = String(v || '').replace('T', ' ')
  if (!s) return nowStr()
  if (s.length >= 19) return s.slice(0, 19)
  if (s.length === 10) return s + ' 00:00:00'
  return s
}

onLoad((q) => {
  const m = q.mode || 'create'
  if (m === 'copy') {
    // ★ 复制 = 「带初始数据的新增」：mode 保持 create（保存走 create 分支、按钮文案「保存」），
    //   copyFromId 记录来源单号，load() 据此预填客户/明细/备注（billNo 留空、日期当天）。
    mode.value = 'create'
    copyFromId.value = q.from || q.id || ''
  } else if (m === 'draft') {
    // ★ 草稿续开：mode 同样是 create（建单分支、不显示单号、按钮是「提交」），
    //   只多带一个草稿桶 id —— 与复制模式同一个先例，不再新增第四种 mode 去改各处判断。
    mode.value = 'create'
    draftId.value = q.draftId || q.id || ''
  } else {
    mode.value = m
    editId.value = q.id || ''
  }
  // 「以此开单」（商品详情带过来）：种子行 + 自动弹客户面板。
  //   ★ 必须在 load() 之前落好这两个值 —— applySeed 是 load() 尾部调的，
  //     排在后面就变成"看 await 什么时候回来"的竞态写法。
  //   ★ 只认 fromProduct 这一个键（`from` 已经被复制模式占了，两个都叫 from 迟早撞车）。
  if (q.fromProduct && !draftId.value && !copyFromId.value && !q.id) {
    seedProductId.value = String(q.fromProduct)
    if (q.pickCustomer) seedPending.value = true
  }
  if (draftId.value) loadDraft(); else load()
  // 开关不阻塞开单页首屏（capabilities 里带着打印机与动作清单，等它 = 白屏多几百毫秒）；
  // 没取到之前一律按"开着"渲染，取到 false 之后的下一次加行才收窄 —— 不会挡住已开的单。
  loadAccountOptions().then((o) => { shopOpts.value = o })
})

/**
 * ★★★ 返回本页必须重新拉数据（2026-09-23）。
 *
 *   这个页面**同时承担「新增」和「修改」两个入口**，是本轮需求 1 的现场：
 *     详情页 →「修改」→ 本页改完 → 保存 → navigateBack 回详情。
 *   但本页自己也是会被 navigateBack 回来的目标：
 *     本页 →「选客户/选商品」→（别的页面）→ 回来，
 *     以及任何「进本页 → 跳走 → 返回」的路径。
 *   uni-app 下 navigateBack 只是**弹出栈顶**，本页实例被缓存，
 *   `onLoad` 不会再跑 ⇒ 页面仍挂着离开前的 custOptions / prodOptions /
 *   明细状态。实测：二次进入本页 Resource Timing **一条 api 请求都没有**，
 *   客户弹窗里的选项还是上一次的旧快照（列表若已在别处被改过就对不上了）。
 *
 *   这里用 entered 首帧哨兵跳过第一次（首次由 onLoad 负责），
 *   避免 onLoad + onShow 在进页瞬间双发请求。
 *   ★ 注意：重进来时不能重置用户已经填好的表单（mode 保持、form 不动），
 *     只刷新「来自服务端的下拉数据」—— 重置表单会白丢用户的输入。
 */
let entered = false
onShow(() => {
  stockWarnOn.value = billStockWarn()   // 设置页可能刚被改过
  if (!entered) { entered = true; return }
  // ★ keep-alive 复用旧实例（H5 后退再进来）时，把"已经走了"的状态拉回来，
  //   否则底栏永远停在"提交中…"、挽留闸门也永久失效。
  if (onResume()) saving.value = false
  searchCustomers()
  searchProducts()
})
</script>

<style lang="scss" scoped>
/* ★ 这里原来有一句 `.page { padding: $space-page; }`（与全局 .page 完全重复）。
 *   它编译成 .page[data-v-x]，优先级(0,2,0) 压过全局 .has-action-bar (0,1,0)，
 *   把底栏让位预留从 200rpx 静默改回 36rpx —— 新增销售单的底部被按钮盖住就是这个原因。
 *   已删除；全局 .page 已提供同样的内边距。别再把它加回来。 */
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
/* ★ 只读文本值（编辑态的单号）—— 复用 .value 的排版，但视觉弱化。
   为什么弱化：单号是**信息**不是操作项，不该和可点选择器抢注意力；
   但也不能灰到看不见（用户就是要核对它）。所以降字重、降层级色，
   保持等宽数字（`.value` 已带 tabular-nums）便于逐位比对。
   ★ 用 <text> 而非 <input>：单号不可改（改单靠 URL 的 id），
     给输入框会误导用户「这里能编辑」。 */
.head-row .value--readonly {
  font-weight: $fw-normal;
  color: $color-text-2;
}

/* ★ 日期 + 时间两个 picker 并排（2026-09-22）。
   uni-app 没有「日期时间」合一的 picker：mode="date" 只给 YYYY-MM-DD、
   mode="time" 只给 HH:mm:ss ⇒ 必须两个拼装，见 onDatePick / onTimePick。 */
.head-dt {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
}
/* 状态标签不要被 flex 拉伸，也不参与空间分配 */
.head-row :deep(.status-tag) { flex: 0 0 auto; margin-left: auto; }
/* 草稿那一行是「标签 + 存于时间」两个东西，标签不该顶到最右 */
.head-draft { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 12rpx; }
.head-draft :deep(.status-tag) { margin-left: 0; }
.head-draft__at { font-size: $fs-mini; color: $color-text-3; }

/* ★ 日期 / 时间 / 价格方案的可点选择器（2026-09-22）。
   与 .head-row .value 保持同一视觉（右对齐、等宽数字、加粗），
   但多一个图标暗示「可点」。
   ★ flex 不再写 1 —— 日期行现在是两个 picker 并排在 .head-dt 里，
     每个只占内容宽；价格方案行是单个 picker 但由父容器 .head-row 撑开。 */
.head-picker { display: flex; }
/* 单行右侧的选择器（价格方案）：撑满剩余宽度并右对齐 */
.head-picker--right { flex: 1; min-width: 0; justify-content: flex-end; }
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
/* 不可编辑时箭头不显示、文字退回次级色，避免「看着能点其实不能」 */
.head-picker[disabled] .head-picker__text,
.head-picker[disabled] .head-picker__box { color: $color-text-3; }

/* 价格方案下方的说明：讲清「这个选择会怎么影响取价」 */
.scheme-hint {
  display: block;
  margin-top: 3rpx;
  margin-bottom: 10rpx;
  font-size: $fs-micro;
  color: $color-text-4;
  line-height: 1.5;
}

/* 客户区块在合并卡片内的分隔（原来客户是独立卡片，有卡片间距兜底） */
.card .section-head { margin-top: 18rpx; }

/* 客户选择 */
/* padding 8rpx/4rpx → 26rpx 上下：这一行实测只有 27px 高，而它是开单页点得最多的一行
   （2026-10-10 UI 体检 07 板，目标 ≥44px）。 */
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
/* 描述块 = 品名 + 规格 + 展开箭头，**整块**是"点开看全文"的热区。
   gap 取 16rpx（不是原来的 10rpx）：品名与规格之间要有一眼能分开的缝，
   而这条缝加上箭头 14px 会直接从品名/规格的可用宽里扣（真机内宽只有 ~207px）。 */
.it-name-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 16rpx; }
/* ★ max-width:52% 是「规格上移」的必要配套，不是可选项：不给上限，长品名会把规格整个挤成 0，
   两个 <text> 都要挂 .ellipsis（少挂一个就会看到半截文字）。 */
.it-name { flex: 0 1 auto; min-width: 0; max-width: 52%; font-size: $fs-body; font-weight: $fw-bold; }
/* 展开态：品名独占剩余宽度、可折多行；规格不在这渲染（挂回下面独立的 .it-spec-row） */
.it-name-line--open { align-items: flex-start; }
.it-name-line--open .it-name {
  flex: 1; max-width: none; white-space: normal; line-height: 1.45;
}
/* 箭头第一行对齐品名：展开后品名可能折 3 行，图标跟着"跑到中间"会看不出是哪个元素的开合 */
.it-name-line--open :deep(.icon-svg) { margin-top: 8rpx; }
/* ★ 删行是**不可撤销的单个目标**（删完这行内容就没了），热区按 U6 的 88rpx 下限撑开；
   图标本身仍是 20，不跟着变大（视觉密度不动，只是手指好点些）。 */
.it-del { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; color: $color-danger; min-height: 88rpx; padding: 0 12rpx; }
/* 规格：收起态挤在品名同行（flex:1 让它吃掉余宽 ⇒ 箭头自然靠右对齐，每行位置都一样，
   不会因为品名长短而左右跳）；展开态它是 .it-spec-row 的唯一子元素，独占一整行。
   ★ 上下边距与改造前的 `.it-spec` 完全一致（10/18rpx）—— 行距断言量的是相邻明细卡片的
     `rect.top - 上一张.bottom` 必须为 0，这里多一像素都会被判成布局回归。 */
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
/* 单位胶囊（与品名同行居右） */
.it-units { display: flex; align-items: center; gap: 8rpx; flex: none; }
.uchip { font-size: $fs-micro; line-height: 44rpx; min-width: 56rpx; text-align: center;
  padding: 0 14rpx; border-radius: $radius-tag; background: $color-bg-sunken; color: $color-text-2; }
.uchip--on { background: $color-primary; color: $color-card; font-weight: $fw-bold; }
.ht-fold { font-size: $fs-micro; color: $color-text-2; }
.ht-short { font-size: $fs-micro; color: $color-danger; font-weight: $fw-bold; }
/* 账面是负数：那不是"欠货"，是库存数字本身不对 —— 用警示色，别用红得发紫的"缺货"色 */
.ht-short--neg { color: $color-warning; font-weight: $fw-bold; }
/* 这货品从没入过库：只是陈述，不该吓人，等于是个资料提示 */
.ht-short--info { color: $color-text-3; font-weight: $fw-normal; }

/* 两列之间的缝从 18rpx 收到 12rpx：这一行的宽度账要留给数量和单价，缝不是要花钱的地方 */
.item-edit { display: flex; align-items: flex-end; gap: 12rpx; }
.edit-field { flex: 1; min-width: 0; }
/* ★ 数量列定宽 128rpx(64px)：重量/长度开单时数量是 5 位数（12345 需 40.3px 文字宽），
   让 f2 那种 flex:1 均分会在长单价下把它压到装不下。赠品已经挪走，这里的宽是省出来的。
   ⇒ 单价框因此拿到 128px（可用 110px），12345.00 甚至 156000.00 都放得下。
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
  /* 与输入框的值区基线对齐 */
  padding-top: 32rpx;
}
.edit-amt :deep(.amount) { font-family: $font-num; font-size: $fs-num-lg; }
.price-src { display: block; margin-top: 12rpx; font-size: $fs-micro; color: $color-violet; }

/* 最近销售记录 */
.history-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
  padding: 14rpx 18rpx;
  border-radius: $radius-tag;
  background: $color-card;
  color: $color-text-3;
}
.ht-left { display: flex; align-items: center; flex-wrap: wrap; gap: 10rpx; flex: 1; min-width: 0; }
.ht-label { font-size: $fs-mini; }
.ht-count { font-size: $fs-mini; font-weight: $fw-bold; color: $color-primary; }
.history-panel { background: $color-card; border-radius: $radius-tag; padding: 6rpx 18rpx; margin-top: 10rpx; }
.history-list { display: flex; flex-direction: column; }
.history-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 0;
  border-bottom: 1rpx solid $color-divider;
  font-family: $font-num;
}
.history-row:last-child { border-bottom: 0; }
.hr-date { width: 140rpx; flex: 0 0 auto; font-size: $fs-mini; color: $color-text-3; font-variant-numeric: tabular-nums; }
.hr-qty { width: 100rpx; flex: 0 0 auto; font-size: $fs-mini; color: $color-text; font-variant-numeric: tabular-nums; }
.hr-price { width: 120rpx; flex: 0 0 auto; font-size: $fs-mini; font-weight: $fw-bold; color: $color-danger; font-variant-numeric: tabular-nums; }
.hr-cust { flex: 1; min-width: 0; font-size: $fs-mini; color: $color-text-3; }
.hr-cust-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10rpx; }
/* 展开/收回那一行：它不是数据行，所以不套 .history-row 那套列宽；上面一条分隔线把它和记录分开 */
.history-more {
  display: flex; align-items: center; justify-content: center; gap: 6rpx;
  padding: 14rpx 0 4rpx; margin-top: 2rpx; border-top: 1rpx solid $color-divider;
  font-size: $fs-mini; color: $color-text-3;
}
.hm-text { line-height: 1.4; }
.history-empty { padding: 20rpx 0; text-align: center; font-size: $fs-mini; color: $color-text-4; }

/* 行备注 + 赠品开关。gap 16rpx(8px)：赠品是独立开关，不能贴着输入框被看成"备注的一部分" */
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
/* ★ 未选客户时的禁用态（2026-09-22）。
   用灰色虚线边框 + 灰底替代主色，一眼可辨「现在不能点」；
   但仍保留 @click（见 onAddItem）—— 点了要 toast 说原因，不能静默。 */
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

/* 备注（整单，落 XS.BZ_XS）——现在在明细卡尾部，上面压一道分隔线与"添加商品"分开 */
.memo-row {
  display: flex; align-items: center; gap: $space-inner;
  margin-top: $space-inner; padding: 24rpx 0;
  border-top: 1rpx solid $color-divider;
}
.memo-row .label { flex: 0 0 auto; font-size: $fs-body; color: $color-text-2; }
.memo-input { flex: 1; min-width: 0; font-size: $fs-body; color: $color-text; }
/* 赠品那句用警示色：它解释的是"为什么行上有钱、合计里没有"（合计已搬进底栏，这句留在明细卡尾） */
.gift-note {
  display: block; margin-top: 12rpx; text-align: center;
  font-size: $fs-micro; color: $color-warning;
}

/* 弹窗 */
/* .mask 的样式与入场动画统一在 App.vue 全局（2026-10-08 收拢，这里以前抄了一份逐字相同的） */
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
/* 价格口径说明：贴着头部下方，颜色弱化（是说明而非标题） */
.picker-price-hint {
  display: block;
  padding: 0 $space-card $space-inner;
  font-size: $fs-mini;
  color: $color-text-3;
}
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
/* ★ 选择列表滚动（2026-09-21）：原来是 scroll-view，在 max-height 弹窗里
 *   拿不到确定高度 → 内容被裁掉且无法滚动。改成普通视图 + 显式滚动约束，
 *   搜索框固定在弹窗头部，只有列表区域滚动。 */
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
/* 已入明细的商品换底色。左右吃掉列表内边距（.picker-list 是 0 $space-card），
   否则底色铺不满，看着像一行没对齐的色块而不是"这一整行已经录过了"。
   ★★ 必须写长边：`margin: 0 -$space-card` 会被 sass 当**减法**算成 -36rpx（四边全负），
     上下各吃 36rpx，相邻行被拽到一起 = 整列错位（2026-09-27 真机截图就是这么红的）。 */
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
/* 定位到已录那一行：底色 + 内描边；1.5 秒后 JS 撤掉 class，靠 transition 自己淡回去 */
.item-card--hl {
  background: $color-primary-bg;
  box-shadow: inset 0 0 0 2rpx $color-primary-border;
  transition: background $dur-linger $ease-out, box-shadow $dur-linger $ease-out;
}

/* ★ 弹窗的空态 / 加载态 / 错误态。
 *   以前加载失败就是一片空白，与「搜不到」长得一模一样 ——
 *   用户没有任何线索判断是网络问题还是真的没有这个客户。 */
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
