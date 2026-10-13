<template>
  <view class="page has-action-bar">
    <view class="field-group">
      <view class="field-group__title">供应商信息</view>
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
             读回来是空串 —— 客户页同款教训（customer/edit.vue）别再踩一遍。 -->
        <input class="field__control tnum" v-model="form.phone" type="text" />
      </view>
      <view class="field">
        <text class="field__label">电话</text>
        <input class="field__control tnum" v-model="form.tel" />
      </view>
      <view class="field">
        <text class="field__label">地址</text>
        <input class="field__control" v-model="form.address" />
      </view>
    </view>

    <view class="field-group">
      <view class="field-group__title">结算信息</view>
      <view class="field">
        <text class="field__label">开户银行</text>
        <input class="field__control" v-model="form.bankName" />
      </view>
      <view class="field">
        <text class="field__label">银行账号</text>
        <input class="field__control tnum" v-model="form.bankId" />
      </view>
      <view class="field">
        <text class="field__label">备注</text>
        <input class="field__control" v-model="form.remark" />
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
import { ref, reactive } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { supplierApi } from '../../api/purchase'
import { toast } from '../../utils/format'
import { markBillWritten } from '../../utils/billWrites'
import { useBillExitGuard } from '../../utils/billExitGuard'
import Icon from '../../components/Icon.vue'

/**
 * 供应商新增/编辑（2026-09-21）。
 *
 * ★ 字段口径（对应 Gysdan 列）：phone=SJ(手机)、tel=Tel(电话)、
 *   type_code=Lbtype_Gys（类别编号，保存写回它）、remark=BZ_Gysdan。
 * ★ 编号规则：不填由后端 G+5 位自增；编辑态编号锁定（改编号 = 换主键，不做）。
 */
const mode = ref('create')
const editId = ref('')
// ★ 弱网下连点「保存」会建出两条同名供应商 —— 在飞必须挡住重入（与 customer/edit 同款）
const saving = ref(false)
const types = ref([])
const typeNames = ref([])
const form = reactive({
  name: '', code: '', type: '', typeCode: '',
  contact: '', phone: '', tel: '', address: '',
  bankName: '', bankId: '', remark: '',
})

/**
 * ★★ 中途退出挽留（2026-10-12 补，与客户档案同一套）：原先这页是裸 `navigateBack`，
 *   填了一半点取消，银行账号那些字全没了也不问一句。
 *   档案没有草稿箱 ⇒ `canDraft` 恒 false，只问「放弃修改 / 继续改」。
 */
const ready = ref(false)
const guard = useBillExitGuard({
  ready: () => ready.value,
  editable: () => true,
  hasContent: () => !!(form.name || form.code || form.contact || form.phone
    || form.tel || form.address || form.bankName || form.bankId || form.remark),
  canDraft: () => false,
  sig: () => form,
  askText: () => ({ discardContent: '离开后这些填写内容不会保存，确认放弃？' }),
  saving: () => saving.value,
})

async function load() {
  const tr = await supplierApi.types()
  if (tr.ok) { types.value = tr.data || []; typeNames.value = types.value.map((t) => t.name) }
  if (mode.value === 'edit') {
    const res = await supplierApi.detail(editId.value)
    if (res.ok) {
      const d = res.data
      form.name = d.name || ''
      form.code = d.code || editId.value
      form.type = d.type || ''
      form.typeCode = d.typeCode || ''   // ★ 保存要写回 Lbtype_Gys 编号
      form.contact = d.contact || ''
      form.phone = d.phone || ''
      form.tel = d.tel || ''
      form.address = d.address || ''
      form.bankName = d.bankName || ''
      form.bankId = d.bankId || ''
      form.remark = d.remark || ''
    }
  }
  // ★ 回填到位之后才立基线（判脏不许掺水合字段，口径同开单页）
  ready.value = true
  guard.markClean()
}
function onTypePick(e) {
  const t = types.value[e.detail.value]
  form.type = t.name; form.typeCode = t.code
}

async function onSave() {
  // ★ 静默 return 会让人以为按钮坏了（.is-disabled 只是半透明，没禁点击）
  if (saving.value) return
  if (!String(form.name || '').trim()) {
    uni.showToast({ title: '名称是必填的，先填名称', icon: 'none' })
    return
  }
  saving.value = true
  const payload = {
    name: form.name, code: form.code,
    type_code: form.typeCode,
    contact: form.contact, phone: form.phone, tel: form.tel,
    address: form.address, remark: form.remark,
    bank_name: form.bankName, bank_id: form.bankId,
  }
  const res = mode.value === 'create' ? await supplierApi.create(payload) : await supplierApi.update(editId.value, payload)
  saving.value = false
  if (res.ok) {
    guard.allowLeave()
    markBillWritten('supplier'); toast('保存成功', 'success'); goBack()
  } else toast(res.message || '保存失败')
}
/** 页内「取消」与返回键走同一个判定 */
function goBack() { if (guard.tryBack()) return; uni.navigateBack() }

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
