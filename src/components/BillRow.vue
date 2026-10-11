<template>
  <!-- 两行版式（2026-10-10，UI 体检 02/03 板）：
       第一行「谁 + 几件 + 多少钱」是扫列表要的三件事，
       第二行「单号 · 日期 [· 小字] + 状态」是核对用的。
       改造前三行 124px（第三行只有日期和金额，还带一条分隔线），一屏 5.8 张；采购页内联那套是 154~177px。 -->
  <view class="bill-row" @click="$emit('select')" hover-class="hv-on" :hover-stay-time="80">
    <view class="bill-row__l1">
      <view class="bill-row__name-line">
        <text class="bill-row__name ellipsis">{{ name }}</text>
        <!-- 这一单的对手现在停着 ⇒ 行上就要看出来，别等点开详情才发现"这位不能开了" -->
        <StopTag :kind="kind" :code="stopCode" />
      </view>
      <view class="bill-row__amt-line">
        <!-- 件数放在金额左边（改造前它就在客户名那一行的右侧）：
             留在第二行时「单号 · 日期 · 1 种 · 1 件」在采购页 20 行**全部**溢出 245px 可用宽，
             末尾的单据备注直接被省略号吃掉。 -->
        <text class="bill-row__qty">{{ qtyText }}</text>
        <!-- 行尾动作（草稿箱里断网待上传那类才有：留下 / 上传 / 删除）。
             U14 起就在行内、不单开一节；整行点下去是"看这张单"，动作必须各点各的 ⇒ .stop 不能省。 -->
        <text
          v-for="a in actions" :key="a.key"
          class="bill-row__act" :class="{ 'bill-row__act--danger': a.danger }"
          @click.stop="$emit('action', a.key)"
        >{{ a.label }}</text>
        <text class="bill-row__amount">¥{{ fmtMoneyGroup(bill.totalAmount) }}</text>
      </view>
    </view>
    <view class="bill-row__l2">
      <!-- ★ 每一段 <text> 都要**自己带 white-space:nowrap**：uni H5 给 uni-text 的基础规则是
           pre-line，父级 nowrap **不往子节点继承** ⇒ 只在容器上写 nowrap 时，长内容会把日期
           自己折成「2026-」/「09-20」两行、卡片凭空高 33px（2026-10-10 实测踩过，
           同一个坑 sales/edit.vue 的 it-spec 那处也记过）。
           段数保持可寻址（单号/日期/备注各自的类），是因为草稿行的单号本身就含「 · 」，
           拼成一整串就读不回"这张单的编号"了。 -->
      <view class="bill-row__meta">
        <text class="bill-row__no">{{ bill.billNo }}</text>
        <text v-if="dateShown" class="bill-row__sep">·</text>
        <text v-if="dateShown" class="bill-row__date">{{ bill.billDate }}</text>
        <template v-if="note">
          <text class="bill-row__sep">·</text>
          <text class="bill-row__note">{{ note }}</text>
        </template>
      </view>
      <StatusTag :status="bill.status" />
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import StatusTag from './StatusTag.vue'
import StopTag from './StopTag.vue'
import { fmtMoneyGroup } from '../utils/format'

const props = defineProps({
  bill: { type: Object, required: true },
  /** 元信息行末尾那点小字（草稿用它写「剩 8 天」，采购写单据备注）。不传就不占位。 */
  note: { type: String, default: '' },
  /** 行尾动作 [{ key, label, danger? }]，点了回抛 'action' + key */
  actions: { type: Array, default: () => [] },
  /**
   * 下面三个是把这张卡从"销售专用"变成"销售 / 采购共用"的入口：
   * 不传就按销售取（customerName / customerCode / kind=customer），
   * 采购页传 supplier* 那套 —— 两页版式必须逐像素一致，所以共用组件而不是各写一份。
   */
  name: { type: String, default: '' },
  stopCode: { type: String, default: '' },
  kind: { type: String, default: 'customer' },
  /** 停用标签按编号查表，所以采购也得把自己那套 code 传进来 */
  emptyName: { type: String, default: '未命名客户' },
})
defineEmits(['select', 'action'])

const name = computed(() => props.name
  || props.bill.customerName || props.bill.supplierName || props.emptyName)
const stopCode = computed(() => props.stopCode
  || props.bill.customerCode || props.bill.supplierCode || props.bill.customerId || '')

// 列表接口通常不带明细行数，做容错：有 items/lines 用长度，采购行只有 lineCount，再否则只显件数
const qtyText = computed(() => {
  const n = (props.bill.items || props.bill.lines || []).length || props.bill.lineCount || 0
  const qty = props.bill.totalQty
  if (n && qty) return `${n} 种 · ${qty} 件`
  if (n) return `${n} 种`
  return qty ? `${qty} 件` : '—'
})
/**
 * 日期段要不要显示：草稿行的「单号位」写的本来就是「草稿 · 存于 10-10 01:00」，
 * 而它的 billDate 被 toRow 赋成了**同一个串** ⇒ 并到一行后会读出「… 存于 10-10 01:00 · 10-10 01:00」
 * 这种结巴。单号里已经含日期就不再重复（三行版式时它们隔着一行，看不出来）。
 */
const dateShown = computed(() => {
  const d = props.bill.billDate
  if (!d) return false
  return !String(props.bill.billNo || '').includes(String(d))
})
</script>

<style lang="scss" scoped>
.bill-row {
  background: $color-card; border-radius: $radius-card;
  padding: 26rpx 28rpx; box-shadow: $shadow-card;
  display: flex; flex-direction: column; gap: 10rpx;
}
.bill-row__l1 { display: flex; align-items: baseline; justify-content: space-between; gap: 20rpx; }
.bill-row__name-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10rpx; }
.bill-row__name {
  min-width: 0;
  font-size: $fs-subtitle; font-weight: $fw-bold; color: $color-text;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bill-row__amt-line { flex: 0 0 auto; display: flex; align-items: center; gap: 16rpx; }
.bill-row__qty { flex: 0 0 auto; font-family: $font-num; font-size: $fs-mini; color: $color-text-3;
  font-variant-numeric: tabular-nums; }
.bill-row__amount {
  font-family: $font-num; font-size: $fs-num-lg; font-weight: $fw-heavy;
  color: $color-text; font-variant-numeric: tabular-nums;
}
.bill-row__act {
  padding: 8rpx 26rpx; border-radius: $radius-pill;
  border: 1rpx solid $color-primary-border; color: $color-primary-dark;
  font-size: $fs-mini; font-weight: $fw-bold;
}
.bill-row__act--danger { border-color: rgba($color-danger, 0.4); color: $color-danger; }

.bill-row__l2 { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.bill-row__meta {
  flex: 1; min-width: 0; display: flex; flex-wrap: nowrap; align-items: baseline; gap: 8rpx;
  font-family: $font-num; font-size: $fs-mini; color: $color-text-2;
  font-variant-numeric: tabular-nums;
}
/* nowrap 写在**每一段**上，不靠父级继承（见模板那条注释） */
.bill-row__no, .bill-row__date, .bill-row__sep, .bill-row__note { white-space: nowrap; }
.bill-row__no { flex: 0 0 auto; font-weight: $fw-bold; }
.bill-row__date { flex: 0 0 auto; }
.bill-row__sep { flex: 0 0 auto; color: $color-text-4; }
/* 备注是这一行唯一可以让位的一段：放不下就自己截，不许把单号/日期挤到折行 */
.bill-row__note { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  color: $color-text-3; }
</style>
