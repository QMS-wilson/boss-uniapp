<template>
  <view class="page has-action-bar">
    <view class="field-group">
      <view class="field-group__title">客户信息</view>
      <view class="field">
        <text class="field__label">名称</text>
        <input class="field__control" v-model="form.name" placeholder="必填" placeholder-class="field__ph" />
      </view>
      <view class="field">
        <text class="field__label">编码</text>
        <input class="field__control" v-model="form.code" :disabled="mode === 'edit'" placeholder="选填，自动生成" placeholder-class="field__ph" />
      </view>
      <view class="field">
        <text class="field__label">类别</text>
        <picker class="field__control" :range="typeNames" @change="onTypePick">
          <view class="field__picker">
            <text class="field__picker-text" :class="{ 'is-ph': !form.type }">{{ form.type || '请选择' }}</text>
            <Icon name="chevron-down" :size="18" color="text" />
          </view>
        </picker>
      </view>
      <view class="field">
        <text class="field__label">联系人</text>
        <input class="field__control" v-model="form.contact" />
      </view>
      <view class="field">
        <text class="field__label">手机</text>
        <!-- ★ 不用 type="number"：号码里的 +86、前导 0、分隔符都会让数字输入框把值判成非法，
             读回来是空串 —— 等于悄悄吃掉人填的号码。 -->
        <input class="field__control tnum" v-model="form.mobile" type="text" />
      </view>
      <view class="field">
        <text class="field__label">电话</text>
        <input class="field__control tnum" v-model="form.phone" />
      </view>
      <view class="field">
        <text class="field__label">地址</text>
        <input class="field__control" v-model="form.address" />
      </view>
      <view class="field">
        <text class="field__label">价格方案</text>
        <picker class="field__control" :range="schemeNames" :value="schemeIndex" @change="onSchemePick">
          <view class="field__picker">
            <text class="field__picker-text">{{ currentSchemeLabel }}</text>
            <Icon name="chevron-down" :size="18" color="text" />
          </view>
        </picker>
      </view>
    </view>

    <view class="action-bar">
      <view class="btn-ghost action-bar__item" @click="goBack" hover-class="hv-on" :hover-stay-time="80">取消</view>
      <view class="btn-primary action-bar__item" :class="{ 'is-disabled': saving || !form.name }" @click="onSave" hover-class="hv-on" :hover-stay-time="80">
        {{ saving ? '保存中' : '保存' }}
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { customerApi } from '../../api/customer'
import { toast } from '../../utils/format'
import { PRICE_SCHEMES } from '../../utils/adapt'
import { markBillWritten } from '../../utils/billWrites'
import Icon from '../../components/Icon.vue'

const mode = ref('create')
const editId = ref('')
// ★ 写请求走云端→Agent 要数秒，弱网下连点「保存」会建出两条同名客户 —— 在飞必须挡住重入
const saving = ref(false)
const types = ref([])
const typeNames = ref([])
// ★ 字段口径（对应 Khdan）：mobile=SJ(手机)、phone=Tel(电话)。
//   提交时 phone→SJ、tel→Tel（save_customer 就是读这两个键），
//   不要把适配层合并展示用的 phone 直接当 Tel 用。
const form = reactive({ name: '', code: '', type: '', typeId: '', contact: '', mobile: '', phone: '', address: '', remark: '', priceTrace: 200, priceTypeXs: 0 })

/** 价格方案：7 个按价格类型 + 1 个最近销价 */
const schemeNames = [...PRICE_SCHEMES.map((s) => s.label), '最近销价']
const schemeIndex = computed(() => {
  if (form.priceTrace === 201) return schemeNames.length - 1
  const idx = PRICE_SCHEMES.findIndex((s) => s.value === Number(form.priceTypeXs))
  return idx >= 0 ? idx : 0
})
const currentSchemeLabel = computed(() => schemeNames[schemeIndex.value] || '零售价')

async function load() {
  const tr = await customerApi.types()
  if (tr.ok) { types.value = tr.data; typeNames.value = tr.data.map((t) => t.name) }
  if (mode.value === 'edit') {
    const res = await customerApi.detail(editId.value)
    if (res.ok) {
      const d = res.data
      form.name = d.name || ''
      form.code = d.code || ''
      form.type = d.type || ''
      // ★ 类别保存要写回编号（LbType_Kh）
      form.typeId = d.categoryCode || ''
      form.contact = d.contact || ''
      // ★★ 手机←mobile(SJ 原值)、电话←tel(Tel 原值)。
      //   d.phone 是「合并展示值」（SJ 优先，没有才退 Tel），拿它回填电话框，
      //   下一次保存就会把手机号写进 Tel —— 座机号丢了，且界面上再也看不见原值。
      //   （utils/adapt.js 的 toCustomer 早就写明"编辑页回填必须用原值字段"。）
      form.mobile = d.mobile || ''
      form.phone = d.tel || ''
      form.address = d.address || ''
      form.remark = d.remark || ''
      if (d.priceTrace != null) form.priceTrace = d.priceTrace
      if (d.priceTypeXs != null) form.priceTypeXs = d.priceTypeXs
    }
  }
}
function onTypePick(e) {
  const t = types.value[e.detail.value]
  form.type = t.name; form.typeId = t.code
}
function onSchemePick(e) {
  const idx = Number(e.detail.value)
  if (idx === schemeNames.length - 1) {
    form.priceTrace = 201           // 最近销价
  } else {
    form.priceTrace = 200
    form.priceTypeXs = PRICE_SCHEMES[idx].value
  }
}

async function onSave() {
  // ★ 不能静默 return：按钮只是半透明（.is-disabled 没禁点击），点了没反应看着就像"按钮坏了"
  if (saving.value) return
  if (!String(form.name || '').trim()) { toast('名称是必填的，先填名称'); return }
  saving.value = true
  // phone→SJ(手机)、tel→Tel(电话)：save_customer 按这两个键写库
  const payload = {
    name: form.name, code: form.code,
    category: form.typeId, contact: form.contact,
    phone: form.mobile, tel: form.phone,
    address: form.address, remark: form.remark,
    price_trace: form.priceTrace, price_type_xs: form.priceTypeXs,
  }
  const res = mode.value === 'create' ? await customerApi.create(payload) : await customerApi.update(editId.value, payload)
  saving.value = false
  if (res.ok) { markBillWritten('customer'); toast('保存成功', 'success'); goBack() }
  else toast(res.message || '保存失败')
}
function goBack() { uni.navigateBack() }

// ★ 详情页跳过来带的是 ?mode=edit&code=xxx（历史上只带了 code，这里按有 id 就算编辑兜底）
onLoad((q) => {
  editId.value = q.id || q.code || ''
  mode.value = q.mode || (editId.value ? 'edit' : 'create')
  load()
})
</script>

<style lang="scss" scoped>
.field__ph { color: $color-text-4; font-size: $fs-body; }
.field__picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-inner;
  font-size: $fs-body;
  color: $color-text;
}
.field__picker-text { flex: 1; min-width: 0; }
.field__picker-text.is-ph { color: $color-text-4; }
.action-bar__item { flex: 1; }
.is-disabled { opacity: 0.5; }
</style>
