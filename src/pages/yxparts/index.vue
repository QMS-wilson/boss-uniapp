<template>
  <view class="page yxparts" :class="{ 'yxparts--bar': !!matched }">
    <!--
      ★ 2026-10-07 新增（需求）：「我的 → 燕秀产品处理」的落地页。
      ★ 第 1 步：入口 + 把文件选进来（名称/大小/格式）。
      ★ 第 2 步（2026-10-09 起，方案 A1.5）：**解析与匹配都放到电脑端的 Agent 里**。
        端上只用 `utils/yxExcel.js` 把文件摊成矩阵（不含任何业务规则）；
        表头识别/归一化/匹配用与桌面端同一份 Python 实现（`v3agent/yxparts/core.py`），
        由 `yxparts.match` 返回逐行结果 —— 前端按 13 列原样展示（与桌面一致）。
        ⇒ 两套实现漂移的风险从根上去掉；JS/Python 对拍门随之退役，
          改由 Agent 侧 scripts/verify-yx-parity.py 守。
      ★ 第 3 步（本次）：未匹配行可点亮 → `yxparts.suggest` 取候选 →
        "确定并记住"写本地记忆库、"仅本次匹配"只改这一行。**建单仍未接**。
    -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">燕秀产品处理</text>
      </view>
      <text class="intro">把客户发来的燕秀清单（.xls / .xlsx）读进来，按
        「名称 + 规格」匹配到货品编号，再生成销售单。</text>
    </view>

    <!-- ① 选择文件 -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">选择清单文件</text>
      </view>

      <view id="pick-file" class="pick" @click="pickFile" hover-class="hv-on" :hover-stay-time="80">
        <view class="pick__icon"><Icon name="file-text" :size="22" color="primary" /></view>
        <view class="pick__main">
          <text class="pick__t">{{ file ? '重新选择文件' : '选择 Excel 文件' }}</text>
          <text class="pick__d">{{ pickHint }}</text>
        </view>
        <Icon name="chevron-right" :size="16" />
      </view>

      <view v-if="file" class="file">
        <view class="file__row">
          <text class="file__k">文件</text>
          <text class="file__v">{{ file.name }}</text>
        </view>
        <view class="file__row">
          <text class="file__k">大小</text>
          <text class="file__v tnum">{{ sizeText }}</text>
        </view>
        <view class="file__row">
          <text class="file__k">格式</text>
          <text class="file__v">{{ kindText }}</text>
        </view>
      </view>

      <!-- ★ 上一次读取把 App 卡住留下的墓碑（同步原生调用卡死时，JS 什么都上报不了，
           只能靠"动手前先落盘"这一手） -->
      <view v-if="stageMarker && stageMarker.stage" class="msg msg--err">
        <text>上一次读取卡在「{{ stageMarker.stage }}」这一步（{{ fmtAt(stageMarker.at) }}），App 因此无响应。</text>
        <text>这一步不会再自动执行了，需要用下面的按钮手动重试。</text>
      </view>

      <view v-if="intake" class="msg msg--info">
        <text>来自「其他应用打开」的文件</text>
        <text v-if="intake.name !== '来自其他应用的文件'">文件名：{{ intake.name }}</text>
        <text>{{ intakeText }}</text>
        <view v-if="intakeStages.length" class="msg__stages">
          <text v-for="(s, i) in intakeStages" :key="i" class="msg__stage">
            {{ s.ok ? '✓' : '✗' }} {{ s.name }}{{ s.err ? ('：' + s.err) : '' }}{{ s.ms ? ('（' + s.ms + 'ms）') : '' }}
          </text>
        </view>
        <text class="msg__uri">{{ intake.uri }}</text>
      </view>

      <!-- 自动读失败后的手动出口：**这里会把被自动跳过的那一步也跑一遍** -->
      <view v-if="canTryHeavy" id="btn-heavy-read" class="retry" @click="heavyRead" hover-class="hv-on" :hover-stay-time="80">
        <text class="retry__t">完整重试一遍</text>
        <text class="retry__d">上面没读出来（或某一步被跳过了）。点这里把两种系统接口方式**都**再试一遍
          —— 它们直接调系统接口，万一卡住 App 会短暂无响应。</text>
      </view>
      <view v-if="intakeBusy" class="msg msg--info"><text>正在读取…</text></view>

      <!-- 「跳进来了但没取到文件」的证据：以前这一支完全静默，
           现场只能描述成"无反应、也没有报错"，查不了 -->
      <view v-if="!intake && probe && probe.action && probe.action.indexOf('MAIN') < 0" class="msg msg--warn">
        <text>上一次被其他应用拉起时，系统给的内容是：</text>
        <text class="msg__uri">action：{{ probe.action }}</text>
        <text class="msg__uri">arguments：{{ probe.args || '(空)' }}</text>
        <text class="msg__uri">data：{{ probe.data || '(空)' }}</text>
        <text v-if="probe.stream" class="msg__uri">EXTRA_STREAM：{{ probe.stream }}</text>
        <text>（没解析出文件 Uri。把这几行发过来就能定位是权限、还是微信给的形态不同。）</text>
      </view>

      <!-- 没有"本次收到"，但有历史留档 ⇒ 摆出来（真机排查时这是唯一的线索） -->
      <view v-else-if="!intake && lastIntake" class="msg msg--warn">
        <text>这台设备最近一次从其他应用收到的文件：{{ fmtAt(lastIntake.at) }}</text>
        <text>{{ lastIntake.how ? ('已读取：' + lastIntake.how + (lastIntake.size ? '，' + lastIntake.size + ' 字节' : '')) : (lastIntake.error || '当时没读到内容') }}</text>
        <text class="msg__uri">{{ lastIntake.uri }}</text>
        <!-- ★ 条件里那个 `!intake` 不能少：这一支是挂在上面"启动探测"块的 `v-else-if` 上的，
             只判 `lastIntake` 的话，**本次明明有 intake 时它也会一起渲染**
             （2026-10-07 截图里蓝橙两块同时出现就是它）。 -->
      </view>

      <view v-if="err" class="msg msg--err">
        <text>{{ err }}</text>
      </view>
      <view v-if="matching" class="msg msg--info">
        <text>正在匹配…</text>
      </view>
    </view>

    <!-- ② 匹配结果（解析 + 匹配都在电脑端的 Agent 里跑，与桌面端同一套规则） -->
    <view v-if="matching || matchErr || matched" class="card">
      <view class="section-head">
        <text class="section-head__title">匹配结果</text>
      </view>

      <view v-if="matching" class="msg msg--info">
        <text>正在匹配…（解析与匹配都在电脑端的 Agent 里跑）</text>
      </view>

      <!-- ★ 认不出表头 / 物料库为空，都要**明确说出来并给下一步**：
           Agent 回的是带错误码的 message，这里只负责翻译成人话 + 出口。 -->
      <view v-if="matchErr" class="msg msg--err">
        <text>{{ matchErr.title }}</text>
        <text v-for="(l, i) in matchErr.lines" :key="i">{{ l }}</text>
        <view v-if="matchErr.toMaintain" id="btn-goto-maintain" class="retry" @click="goMaintain" hover-class="hv-on" :hover-stay-time="80">
          <text class="retry__t">去维护客户品名</text>
          <text class="retry__d">本账套的客户品名库还是空的：先把客户的叫法铺进去，再回来匹配。</text>
        </view>
      </view>

      <view v-if="matched">
        <view class="sum">
          <view class="sum__item">
            <text class="sum__v tnum">{{ matched.stats.total }}</text>
            <text class="sum__k">清单行</text>
          </view>
          <view class="sum__item">
            <text class="sum__v tnum">{{ matched.stats.matched }}</text>
            <text class="sum__k">已匹配</text>
          </view>
          <view class="sum__item">
            <text class="sum__v tnum">{{ matched.stats.unmatched }}</text>
            <text class="sum__k">未匹配</text>
          </view>
        </view>
        <view class="molds">
          <text class="molds__k">物料库</text>
          <text class="molds__v">{{ matched.library.rows }} 条 ｜ 匹配记忆 {{ matched.library.memoryRows }} 条</text>
        </view>

        <text class="prev__t">明细（显示 {{ rowsShown.length }} / {{ matched.rows.length }} 行；未匹配的行点亮可人工确认）</text>
        <text class="prev__swipe">← 左右滑动看更多列 →</text>
        <scroll-view class="prev" scroll-x>
          <view class="prev__inner prev__inner--wide">
            <view class="prev__row prev__row--head">
              <text class="col col--pick">选</text>
              <text class="col col--seq">序号</text>
              <text class="col col--st">状态</text>
              <text class="col col--cust">客户产品名称</text>
              <text class="col col--sys">系统产品名称</text>
              <text class="col col--unit">单位</text>
              <text class="col col--qty">数量</text>
              <text class="col col--rmk">备注</text>
              <text class="col col--mold">模号</text>
              <text class="col col--name">零件名称</text>
              <text class="col col--spec">采购规格</text>
              <text class="col col--act">实际尺寸</text>
              <text class="col col--mat">材料</text>
              <text class="col col--src">匹配来源</text>
            </view>
            <view v-for="(r, i) in rowsShown" :key="i" class="prev__row"
                  :class="{ 'prev__row--tap': !r.hpbh }" @click="onRowTap(r)" hover-class="hv-on" :hover-stay-time="80">
              <view class="col col--pick">
                <view class="cb" :class="{ 'cb--on': checked[r.lineNo], 'cb--off': !r.hpbh }"
                      @click.stop="toggleRow(r)">
                  <Icon v-if="checked[r.lineNo]" name="check" :size="11" color="white" />
                </view>
              </view>
              <text class="col col--seq">{{ r.seq || '—' }}</text>
              <text class="col col--st" :class="statusClass(r.status)">{{ r.status }}</text>
              <text class="col col--cust">{{ r.customerName || '—' }}</text>
              <text class="col col--sys">{{ r.sysName || '—' }}</text>
              <text class="col col--unit">{{ r.unit || '—' }}</text>
              <text class="col col--qty">{{ r.qty }}</text>
              <text class="col col--rmk">{{ r.remark || '—' }}</text>
              <text class="col col--mold">{{ r.moldNo || '—' }}</text>
              <text class="col col--name">{{ r.name }}</text>
              <text class="col col--spec">{{ r.spec || '—' }}</text>
              <text class="col col--act">{{ r.actual || '—' }}</text>
              <text class="col col--mat">{{ r.material || '—' }}</text>
              <text class="col col--src">{{ r.source || '—' }}</text>
            </view>
          </view>
        </scroll-view>
        <text v-if="matched.rows.length > rowsShown.length" class="prev__more">
          还有 {{ matched.rows.length - rowsShown.length }} 行没显示（行数多时只画前 {{ ROWS_MAX }} 行，匹配结果不受影响）。
        </text>
      </view>
    </view>

    <!-- ②B 客户品名维护入口（本期只做骨架，导入功能下期） -->
    <view class="card">
      <view class="section-head">
        <text class="section-head__title">客户品名维护</text>
      </view>
      <text class="intro">客户怎么写、对应系统里哪个货品，都记在这一页（本账套的客户品名库）。</text>
      <view id="btn-hptype" class="pick" @click="goMaintain" hover-class="hv-on" :hover-stay-time="80">
        <view class="pick__icon"><Icon name="file-text" :size="22" color="primary" /></view>
        <view class="pick__main">
          <text class="pick__t">打开客户品名库</text>
          <text class="pick__d">看物料库现状、管理匹配记忆（导入品名下期开放）</text>
        </view>
        <Icon name="chevron-right" :size="16" />
      </view>
    </view>

    <!-- ②C 建单：勾选明细 + 选客户 → **带明细跳到开单页**，客户改完自己提交 -->
    <view v-if="matched" class="bar">
      <view id="btn-pick-customer" class="bar__cust" @click="openCustomerPicker" hover-class="hv-on" :hover-stay-time="80">
        <text class="bar__k">客户</text>
        <text class="bar__v" :class="{ 'bar__v--off': !customer }">{{ customer ? customer.name : '请选择' }}</text>
      </view>
      <text class="bar__n tnum">已选 {{ checkedRows.length }} 行</text>
      <view id="btn-create-bill" class="bar__btn" :class="{ 'bar__btn--off': !canSubmit || submitting }"
            @click="goCreateBill" hover-class="hv-on" :hover-stay-time="80">
        <text>{{ submitting ? '生成中…' : '生成单据' }}</text>
      </view>
    </view>

    <!-- 客户选择面板 -->
    <view v-if="showCustomerPicker" class="mask" @click="showCustomerPicker = false">
      <view class="sheet" @click.stop>
        <view class="section-head">
          <text class="section-head__title">选择客户</text>
        </view>
        <text class="intro">价格按这个客户的取价规则算（最近销价 → 默认销价），不在单上写死。</text>
        <view class="search">
          <input v-model="custKeyword" class="search__in" placeholder="搜名称 / 编号 / 手机"
                 confirm-type="search" @confirm="searchCustomers" />
          <view class="search__btn" @click="searchCustomers" hover-class="hv-on" :hover-stay-time="80"><text>搜索</text></view>
        </view>
        <view v-if="custLoading" class="msg msg--info"><text>正在加载…</text></view>
        <view v-else-if="custErr" class="msg msg--err"><text>{{ custErr }}</text></view>
        <scroll-view v-else class="cand-list" scroll-y>
          <view v-for="(c, i) in custOptions" :key="i" class="cand" @click="pickCustomer(c)" hover-class="hv-on" :hover-stay-time="80">
            <!-- ★ 客户名旁边要挂停用标签（全站约定：只要渲染的是档案名就该有）。
                 原来这里是 `<text class="cand__t">{{ c.name }}</text>` —— 客户名写在 text 里，
                 而 StopTag 是组件、**放不进 `<text>`**（小程序里整块不渲染且不报错），
                 所以外面必须包一层 view。 -->
            <view class="cand__row">
              <text class="cand__t">{{ c.name }}</text>
              <StopTag kind="customer" :code="c.id || c.code" />
            </view>
            <text class="cand__s">{{ c.id || c.code || '—' }}{{ c.mobile ? (' ｜ ' + c.mobile) : '' }}</text>
          </view>
          <view v-if="!custOptions.length" class="msg msg--warn"><text>没找到客户，换个关键词试试。</text></view>
        </scroll-view>
      </view>
    </view>

    <!-- 候选物料面板（未匹配行点开） -->
    <view v-if="pickRow" class="mask" @click="closeCandidates">
      <view class="sheet" @click.stop>
        <view class="section-head">
          <text class="section-head__title">选择货品：{{ pickRow.customerName }}</text>
        </view>
        <text class="intro">候选按相似度排序，与电脑端双击弹窗同一套算法。</text>
        <view v-if="candLoading" class="msg msg--info"><text>正在取候选…</text></view>
        <view v-else-if="candErr" class="msg msg--err"><text>{{ candErr }}</text></view>
        <scroll-view v-else class="cand-list" scroll-y>
          <view v-for="(c, i) in candidates" :key="i" class="cand"
                :class="{ 'cand--on': chosen && chosen.hpbh === c.hpbh }" @click="chosen = c" hover-class="hv-on" :hover-stay-time="80">
            <text class="cand__t">{{ c.hpmcKh }}{{ c.specA ? ('　' + c.specA) : '' }}</text>
            <text class="cand__s">hpbh {{ c.hpbh }} ｜ 单位 {{ c.unit }} ｜ 相似度 {{ Math.round(c.score * 100) }}%</text>
            <text class="cand__s">系统品名：{{ c.hpmc || '—' }}{{ c.specB ? (' ｜ 实际尺寸 ' + c.specB) : '' }}</text>
          </view>
          <view v-if="!candidates.length" class="msg msg--warn">
            <text>没有候选。可以先用电脑端把这条客户写法补进品名库。</text>
          </view>
        </scroll-view>
        <view class="sheet__btns">
          <view class="btn btn--ghost" @click="applyCandidate(false)" hover-class="hv-on" :hover-stay-time="80"><text>仅本次匹配</text></view>
          <view class="btn btn--primary" @click="applyCandidate(true)" hover-class="hv-on" :hover-stay-time="80"><text>确定并记住</text></view>
        </view>
      </view>
    </view>

    <view class="bottom-gap" />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { toast } from '../../utils/format'
import { payloadForOp } from '../../utils/yxExcel'
import { yxApi } from '../../api/yxparts'
import { customerApi } from '../../api/customer'
import { priceApi } from '../../api/index'
import { saveManualDraft } from '../../utils/draftBox'
import { takePending, readPending, readLastIntake, readStageMarker, readProbe } from '../../utils/yxIntake'
import Icon from '../../components/Icon.vue'
import StopTag from '../../components/StopTag.vue'

/**
 * 选中的文件。只存元信息用于展示。
 * ★ 原始句柄（H5 的 File / 小程序的临时路径 / App 从其他应用收到时已读好的字节）
 *   放在普通变量里，不放 ref：它们是宿主对象，塞进响应式系统只会平添麻烦
 *   （代理、深比较），没有任何收益。
 */
const file = ref(null)
let rawFile = null      // H5: File 对象
let rawPath = ''        // 小程序: tempFilePath
let rawBuf = null       // App: 从「其他应用打开」收到时直接读好的 ArrayBuffer

/** 「用其他应用打开」送来的文件（仅 App 端会有）：
 *  { uri, name, how, error } —— 即使字节没读到，**uri 本身就是"跳转成功"的证据**。 */
const intake = ref(null)

/** 最近一次接收的**留档**（storage 里那份）。
 *  ★ 为什么要它：真机上"点了没跳/跳了没反应"时，界面上一点痕迹都没有，
 *    人只能凭记忆描述。留档至少能把 Uri 和失败原因摆出来，好定位。
 *    它与 intake 的区别：intake 是本次会话内存里的活数据，这个是跨启动落盘的。 */
const lastIntake = ref(null)
/** 「上次读取卡在哪一阶段」的墓碑：卡死时 JS 什么都上报不了，只能靠它 */
const stageMarker = ref(null)
/** 「启动探测」：系统这次到底给了我们什么（action / arguments / data） */
const probe = ref(null)
const intakeBusy = ref(false)

function fmtAt(ts) {
  if (!ts) return ''
  const d = new Date(Number(ts))
  const p2 = (n) => (n < 10 ? '0' : '') + n
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
    + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
}

const err = ref('')
const matching = ref(false)
/** 匹配结果（Agent 的 yxparts.match 返回）。字段与桌面端 13 列一一对应。 */
const matched = ref(null)
/** 匹配失败时的人话 + 出口（{ title, lines[], toMaintain }） */
const matchErr = ref(null)

/** 手机一次最多画多少行（匹配结果本身不受影响，只是列表不一次渲染几千行） */
const ROWS_MAX = 200
const rowsShown = computed(() => (matched.value ? matched.value.rows.slice(0, ROWS_MAX) : []))

/* ---------------- 未匹配行 → 候选 → 人工确认 ---------------- */
const pickRow = ref(null)
const candidates = ref([])
const chosen = ref(null)
const candLoading = ref(false)
const candErr = ref('')

/* ---------------- 建单（P3）：勾选 → 选客户 → salesbill.create ---------------- */
/** { [lineNo]: true } —— 匹配成功的行默认勾上，未匹配行永远不勾（方案 6.6） */
const checked = ref({})
const customer = ref(null)          // { id, name }
const showCustomerPicker = ref(false)
const custKeyword = ref('')
const custOptions = ref([])
const custLoading = ref(false)
const custErr = ref('')
const submitting = ref(false)
/** 幂等键：同一份清单的所有提交复用同一个 token（响应丢失后重试不会多建一张单） */
const submitToken = ref(mkSubmitToken())

const checkedRows = computed(() => {
  const m = matched.value
  if (!m) return []
  return m.rows.filter((r) => checked.value[r.lineNo] && r.hpbh)
})
const canSubmit = computed(() => !!customer.value && checkedRows.value.length > 0)

/**
 * 端上先量一次体积再发：Agent 侧虽然也会判（YX_PAYLOAD_TOO_LARGE，上限 512KB），
 * 但 WS 帧在 Agent 那头有 1MiB 的接收上限 —— 真超过时是**直接断链**，
 * 用户只会看到"没反应"。所以在发之前先拦，给一句人话。
 */
const MAX_SEND_BYTES = 400 * 1024

function utf8Bytes(str) {
  let n = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}

const pickHint = computed(() => {
  // #ifdef H5
  return '支持 .xls / .xlsx，从手机文件里选'
  // #endif
  // #ifdef MP-WEIXIN
  return '支持 .xls / .xlsx，从微信聊天记录里选'
  // #endif
  // #ifndef H5 || MP-WEIXIN
  return '支持 .xls / .xlsx'
  // #endif
})

const sizeText = computed(() => {
  const n = Number(file.value?.size || 0)
  if (!n) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
})

const kindText = computed(() => {
  const ext = String(file.value?.ext || '').toLowerCase()
  if (ext === '.xls') return 'Excel 97-2003（.xls）'
  if (ext === '.xlsx') return 'Excel 工作簿（.xlsx）'
  // App 从「其他应用打开」收到的名字常常**没有扩展名**（微信的 FileProvider 给的是
  // 一串编号），这时不谎报格式，只说"按内容解析" —— SheetJS 本来就按内容认。
  if (file.value && !ext) return '未知扩展名（按内容解析）'
  return ext ? ext + '（不是 .xls/.xlsx）' : '—'
})

/** 收到来源说明：只有 App 从其他应用打开时才有 */
const intakeText = computed(() => {
  const it = intake.value
  if (!it) return ''
  if (it.how) return '已读取（' + it.how + '）'
  if (it.error) return '已试过的读取方式都没成功'
  return '文件已收到，正在尝试读取…'
})

/** 读取各阶段的成败。★ 单独摆出来：App 端没有控制台，界面是唯一的证据面。 */
const intakeStages = computed(() => {
  const it = intake.value
  return (it && it.stages) ? it.stages : []
})

/** 非阻塞的两条路都没成 ⇒ 把"会阻塞主线程"的那两条交给用户决定要不要试 */
const canTryHeavy = computed(() => {
  const it = intake.value
  return !!it && !it.how && !intakeBusy.value
})

const OK_EXT = ['.xls', '.xlsx']

function resetMatch() {
  matched.value = null
  matchErr.value = null
  checked.value = {}
  closeCandidates()
}

function setFile(name, size, source, handle, opts) {
  const n = String(name || '')
  const i = n.lastIndexOf('.')
  const ext = i >= 0 ? n.slice(i).toLowerCase() : ''
  // ★ 两条路对扩展名的态度必须不同：
  //   · 用户自己选的文件 —— 认不出 .xls/.xlsx 就**明确拦下**（他选错了，早点说）
  //   ·「用其他应用打开」送来的 —— 文件名是微信 FileProvider 给的（常是一串编号、
  //     没有扩展名），**不能按扩展名拦**，否则明明收到了也说"不是 Excel"。
  //     SheetJS 本来就按内容认格式，认不出来会报错，不会静默。
  const allowUnknown = !!(opts && opts.allowUnknownExt)
  if (!allowUnknown && OK_EXT.indexOf(ext) < 0) {
    err.value = '这个文件不是 .xls / .xlsx（选到的是「' + (ext || '无扩展名') + '」），请重新选择'
    file.value = null
    resetMatch()
    return
  }
  err.value = ''
  file.value = { name: n, size: Number(size || 0), ext }
  rawFile = (handle && handle.file) || null
  rawPath = (handle && handle.path) || ''
  rawBuf = (handle && handle.buf) || null
  resetMatch()
  matchNow()
}

/* ---------------- 读字节 → 交给 Agent 解析 + 匹配 ---------------- */

function readH5(fileObj) {
  // File.arrayBuffer() 在现代浏览器/WebView 都有；老的用 FileReader 兜底
  if (fileObj && typeof fileObj.arrayBuffer === 'function') return fileObj.arrayBuffer()
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('读文件失败'))
    fr.readAsArrayBuffer(fileObj)
  })
}

function readMp(path) {
  return new Promise((resolve, reject) => {
    // ★ 不传 encoding ⇒ 拿到 ArrayBuffer（SheetJS 要的就是它）
    uni.getFileSystemManager().readFile({
      filePath: path,
      success: (r) => resolve(r.data),
      fail: (e) => reject(new Error((e && e.errMsg) || '读文件失败')),
    })
  })
}

/**
 * 解析 + 匹配：**两步都在电脑端的 Agent 里做**。
 *
 * App 只负责"把文件摊成矩阵"（`payloadForOp`，不带任何业务规则），
 * 表头识别/归一化/匹配用的是与桌面端同一份 Python 实现
 * —— 这是 A1.5 方案的核心（见《燕秀集成方案》第 3.1、6 章）。
 *
 * 错误处理按错误码分支（第 7 章）：message 直接给用户看，另有出口的给出口。
 */
async function matchNow() {
  matching.value = true
  matchErr.value = null
  try {
    // App 从「其他应用打开」进来的那份，字节已经拿到了，直接用它
    let buf = rawBuf || null
    if (!buf) {
      // #ifdef H5
      buf = await readH5(rawFile)
      // #endif
      // #ifdef MP-WEIXIN
      buf = await readMp(rawPath)
      // #endif
    }
    // #ifndef APP-PLUS
    if (!buf) throw new Error('当前平台还没接读文件')
    // #endif

    const payload = payloadForOp(buf)
    const body = JSON.stringify(payload)
    if (utf8Bytes(body) > MAX_SEND_BYTES) {
      matchErr.value = {
        title: '这份清单太大了，没法一次传完',
        lines: ['按目前的通道，单次上限约 ' + Math.round(MAX_SEND_BYTES / 1024) + ' KB；'
          + '把清单拆成几份（或只保留这次要订的行）再传一次。',
          '（以后接了大文件通道就不需要拆了。）'],
        toMaintain: false,
      }
      matched.value = null
      return
    }
    const res = await yxApi.match(payload)
    if (!res || !res.ok) {
      matchErr.value = describeYxError(res)
      matched.value = null
      return
    }
    matched.value = res.data
    // 默认只勾"已匹配"的行；未匹配的要人工确认过、有了 hpbh 才可能被勾上
    const init = {}
    for (const r of matched.value.rows) if (r.hpbh) init[r.lineNo] = true
    checked.value = init
    submitToken.value = mkSubmitToken()   // 换了一份清单 = 换一个幂等键
  } catch (e) {
    const m = String((e && e.message) || e)
    err.value = '匹配失败：' + m
    matched.value = null
  } finally {
    matching.value = false
  }
}

/** 把 Agent 的错误信封翻成"人话 + 下一步"。 */
function describeYxError(res) {
  const errObj = (res && res.error) || {}
  const code = String(errObj.code || '')
  const msg = String(errObj.message || '匹配失败')
  const detail = errObj.detail || {}
  if (code === 'YX_HEADER_NOT_FOUND') {
    const need = (detail.needKeywords || []).join(' / ')
    return {
      title: msg,
      lines: [
        need ? ('程序认表头的条件：表头行里要同时出现 ' + need + '。') : '',
        '如果这份清单用的是别的叫法（比如"商品名称"），需要先在 Agent 侧补表头别名，不是文件坏了。',
      ].filter(Boolean),
      toMaintain: false,
    }
  }
  if (code === 'YX_ACCOUNT_SET_EMPTY') {
    return {
      title: msg,
      lines: ['本账套的 HPKhType（客户品名）还是空的，匹配一定零命中。'],
      toMaintain: true,
    }
  }
  if (code === 'YX_TOO_MANY_ROWS' || code === 'YX_PAYLOAD_TOO_LARGE') {
    return { title: msg, lines: ['把这份清单拆小一点再传一次。'], toMaintain: false }
  }
  if (code === 'YX_CELL_TOO_LONG') {
    const d = detail
    return {
      title: msg,
      lines: [d.sheet ? ('工作表：' + d.sheet) : '', d.row !== undefined ? ('行号（0 起）：' + d.row) : ''].filter(Boolean),
      toMaintain: false,
    }
  }
  if (code === 'AGENT_OFFLINE') {
    return { title: msg, lines: ['请确认电脑上的 Agent 已经启动并在线。'], toMaintain: false }
  }
  if (code === 'OP_NOT_PUBLISHED') {
    return { title: msg, lines: ['电脑端 Agent 版本较旧，升级后即可使用。'], toMaintain: false }
  }
  return { title: msg, lines: code ? ['错误码：' + code] : [], toMaintain: false }
}

/* ---------------- 未匹配行：候选 → 人工确认 ---------------- */

function statusClass(status) {
  if (status === '未匹配') return 'col--bad'
  if (status === '手动匹配') return 'col--manual'
  return 'col--ok'
}

function onRowTap(row) {
  if (!row || row.hpbh) return          // 已匹配的行不需要人工确认
  openCandidates(row)
}

async function openCandidates(row) {
  pickRow.value = row
  candidates.value = []
  chosen.value = null
  candErr.value = ''
  candLoading.value = true
  try {
    const res = await yxApi.suggest(row)
    if (res && res.ok) {
      candidates.value = (res.data && res.data.items) || []
    } else {
      candErr.value = String(((res && res.error) || {}).message || '取候选失败')
    }
  } catch (e) {
    candErr.value = String((e && e.message) || e)
  } finally {
    candLoading.value = false
  }
}

function closeCandidates() {
  pickRow.value = null
  candidates.value = []
  chosen.value = null
  candErr.value = ''
}

/** remember=true → 写记忆库（下次自动命中）；false → 只改这一行。 */
async function applyCandidate(remember) {
  const row = pickRow.value
  const c = chosen.value
  if (!row || !c) {
    toast('先选一个货品')
    return
  }
  if (remember) {
    try {
      const res = await yxApi.remember(row, c.hpbh, c.unit)
      if (!res || !res.ok) {
        toast(String(((res && res.error) || {}).message || '记住失败'))
        return
      }
    } catch (e) {
      toast('记住失败：' + String((e && e.message) || e))
      return
    }
  }
  // 就地改这一行（不重跑整个匹配，避免把用户刚确认的结果冲掉）
  Object.assign(row, {
    hpbh: c.hpbh,
    unit: c.unit,
    sysName: c.hpmc || row.sysName || '',
    status: '手动匹配',
    source: remember ? '人工确认' : '人工确认(仅本次)',
  })
  if (matched.value) matched.value.stats.unmatched = Math.max(0, matched.value.stats.unmatched - 1)
  if (matched.value) matched.value.stats.matched = (matched.value.stats.matched || 0) + 1
  // 人工确认过的行默认勾上（用户既然认了这条，就是打算建进单里）
  const nextChecked = Object.assign({}, checked.value)
  nextChecked[row.lineNo] = true
  checked.value = nextChecked
  closeCandidates()
  toast(remember ? '已记住，下次同样写法自动匹配' : '已改为该货品（仅本次）')
}

function goMaintain() {
  uni.navigateTo({ url: '/pages/yxparts/hptype' })
}

/* ---------------- 建单（P3） ---------------- */

function mkSubmitToken() {
  return 'yx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function nowStr() {
  const d = new Date()
  const p2 = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
    + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
}

/** 勾选：只有已匹配（有 hpbh）的行能勾 —— 未匹配的点它是"人工确认"那条路。 */
function toggleRow(row) {
  if (!row || !row.hpbh) return
  const next = Object.assign({}, checked.value)
  if (next[row.lineNo]) delete next[row.lineNo]
  else next[row.lineNo] = true
  checked.value = next
}

async function openCustomerPicker() {
  showCustomerPicker.value = true
  if (!custOptions.value.length) await searchCustomers()
}

async function searchCustomers() {
  custLoading.value = true
  custErr.value = ''
  try {
    const res = await customerApi.list({ keyword: custKeyword.value, pageSize: 50 })
    if (res && res.ok) {
      custOptions.value = (res.data && (res.data.list || res.data.items)) || []
    } else {
      custOptions.value = []
      custErr.value = String(((res && res.error) || {}).message || '客户列表加载失败')
    }
  } catch (e) {
    custOptions.value = []
    custErr.value = String((e && e.message) || e)
  } finally {
    custLoading.value = false
  }
}

function pickCustomer(c) {
  // 价格方案一并留着：跳开单页时要按这个客户的方案逐行取价
  customer.value = {
    id: c.id || c.code || '',
    name: c.name || '',
    priceTrace: c.priceTrace,
    priceTypeXs: c.priceTypeXs,
  }
  showCustomerPicker.value = false
}

/**
 * 生成单据 = **带着明细跳到开单页**，由客户核对/修改后自己提交。
 *
 * ★ 为什么不再直接调 salesbill.create（2026-10-09 按用户要求改）：
 *   燕秀清单只给「名称+规格+数量」，**没有价**。直接建单等于把系统取价当既成事实；
 *   改成"跳开单页预填"之后，客户可以改数量、改单价、加删行，再点提交 ——
 *   与在开单页从零开单是同一条路，决定权也在人。
 *
 * ★ 走**草稿箱**交接，而不是塞 URL 参数：
 *   `saveManualDraft` + `/pages/sales/edit?mode=draft&draftId=…` 是开单页**已有**的
 *   "草稿续开"入口（`onLoad` 里 `mode === 'draft'` 那条分支）。好处：明细再多也不撑 URL，
 *   而且幂等键（submitToken）跟着草稿走 —— 客户在开单页反复点提交也只落一张单。
 *
 * ★ 价格：先在燕秀页按所选客户的**取价方案**逐行取一次价（`priceApi.resolve`），
 *   跳过去时单价是齐的（能过开单页"单价要填"那道校验）；取不到价的行**留空**，
 *   由客户在开单页补 —— 绝不替他填个 0 元当成交价。
 */
async function goCreateBill() {
  if (submitting.value) return
  if (!customer.value) {
    toast('请先选择客户')
    return
  }
  const rows = checkedRows.value
  if (!rows.length) {
    toast('至少勾选一行已匹配的明细')
    return
  }
  const bad = rows.find((r) => !(Number(r.qty) > 0))
  if (bad) {
    toast('第 ' + bad.lineNo + ' 行数量是 0，请先在原表补上数量')
    return
  }
  submitting.value = true
  try {
    const pt = customer.value.priceTrace
    const px = customer.value.priceTypeXs
    let unpriced = 0
    const items = []
    for (const r of rows) {
      let price = ''
      let priceSource = ''
      try {
        const pr = await priceApi.resolve(customer.value.id, r.hpbh, r.unit || '', {
          priceTrace: pt, priceTypeXs: px,
        })
        if (pr && pr.ok && pr.data && pr.data.price != null) {
          price = pr.data.price
          priceSource = pr.data.source || ''
        } else {
          unpriced++
        }
      } catch (e) {
        unpriced++
      }
      items.push({
        idenGuid: '', productId: r.hpbh, name: r.sysName || r.name, spec: r.spec || '',
        unit: r.unit || '', units: [], rate: 1, baseUnit: '', stock: 0,
        qty: Number(r.qty) || 1, price, amount: '', priceSource,
        remark: r.remark || '', gift: false,
      })
    }
    const molds = Array.from(new Set(rows.map((r) => r.moldNo).filter(Boolean)))
    const memo = '燕秀清单 ' + ((file.value && file.value.name) || '')
      + (molds.length ? ('（模号 ' + molds.join('/') + '）') : '')
    const draftForm = {
      draftId: '',
      billDate: nowStr(),
      customerId: customer.value.id,
      customerName: customer.value.name || '',
      memo,
      priceTrace: pt,
      priceTypeXs: px,
      items,
    }
    const draftId = saveManualDraft('sales', draftForm, submitToken.value, false)
    if (unpriced) toast('有 ' + unpriced + ' 行没取到价，到开单页补一下单价')
    uni.navigateTo({
      url: '/pages/sales/edit?mode=draft&draftId=' + encodeURIComponent(draftId),
    })
  } catch (e) {
    toast('打开开单页失败：' + String((e && e.message) || e))
  } finally {
    submitting.value = false
  }
}

/* ---------------- 选文件（分平台） ---------------- */

// #ifdef H5
/**
 * H5 只能靠**真的原生 `<input type="file">`**：uni-app 的 `<input>` 在 H5 端编译成
 * uni-input，不支持 type="file"（模板里写 `<input type="file">` 会被吃掉）。
 * 所以这里运行时 createElement 造一个、点它、读完就移除。
 */
function pickH5() {
  try {
    const el = document.createElement('input')
    el.type = 'file'
    el.accept = '.xls,.xlsx'
    el.style.display = 'none'
    el.onchange = (e) => {
      const f = e && e.target && e.target.files && e.target.files[0]
      if (f) setFile(f.name, f.size, '手机文件', { file: f })
      if (el.parentNode) document.body.removeChild(el)
    }
    document.body.appendChild(el)
    el.click()
  } catch (e) {
    err.value = '打不开文件选择器：' + String((e && e.message) || e)
  }
}
// #endif

// #ifdef MP-WEIXIN
/** 小程序只能从**聊天记录**里选文件 —— 客户发的清单正好就在聊天里。 */
function pickMp() {
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['xls', 'xlsx'],
    success: (res) => {
      const f = (res.tempFiles || [])[0]
      if (f) setFile(f.name, f.size, '微信聊天文件', { path: f.path })
    },
    fail: (e) => {
      // ★ 用户主动取消不算错，别弹错
      const msg = String((e && e.errMsg) || '')
      if (msg.indexOf('cancel') >= 0) return
      err.value = '选择文件失败：' + msg
    },
  })
}
// #endif

/* ---------------- 「用其他应用打开」送进来的文件（仅 App 端会有） ---------------- */
/**
 * 自动读：**连会阻塞主线程的两条一起跑**（2026-10-07 真机已验证那条路读得成功）。
 *
 * ★ 之前的取舍是"自动只跑不会卡的 plus.io，阻塞的两条等用户点" —— 那是**在还没验证
 *   阻塞路是否真的会卡**时的保守选择。真机实测：plus.io 必然失败（路径不存在），
 *   而点按钮后阻塞路**读成功了、也没卡** ⇒ 保守的那一步变成了"每次都要手点一下"，
 *   白牺牲体验。现在改成自动跑全套。
 * ★ 仍然保留两道路障：
 *   ① 上次卡死过的那一步（阶段墓碑）自动跳过，不再自动踩第二遍；
 *   ② 失败后仍有「完整重试」按钮（手动跑时连被跳过的那步也跑）。
 * ★ 先让出一帧再开始跑：native.js 是同步调用，一旦开始 JS 线程就停住，
 *   「正在读取…」只有在开始之前渲染出来才看得见。
 */
function applyPending() {
  const p = takePending()
  lastIntake.value = readLastIntake()
  stageMarker.value = readStageMarker()
  probe.value = readProbe()
  if (!p) return
  intake.value = { uri: p.uri, name: p.name, how: '', error: '', stages: [], size: 0 }
  autoRead(p.uri)
}

async function autoRead(uri) {
  if (!uri) return
  intakeBusy.value = true
  await new Promise((r) => setTimeout(r, 80))     // 让「正在读取…」先画出来
  try {
    const skip = (stageMarker.value && stageMarker.value.stage) || ''
    const r = await readPending(uri, { includeBlocking: true, skipStage: skip })
    applyReadResult(r)
  } catch (e) {
    intake.value = Object.assign({}, intake.value, { error: String((e && e.message) || e) })
  } finally {
    intakeBusy.value = false
  }
}

/** 手动「完整重试」：连上次卡住、被自动跳过的那一步也跑 */
async function heavyRead() {
  const uri = intake.value && intake.value.uri
  if (!uri) return
  intakeBusy.value = true
  await new Promise((r) => setTimeout(r, 80))
  try {
    const r = await readPending(uri, { includeBlocking: true, skipStage: '' })
    applyReadResult(r)
    if (!r.ok) toast('这几种方式都没读出来，见下面的阶段报告')
  } catch (e) {
    intake.value = Object.assign({}, intake.value, { error: String((e && e.message) || e) })
  } finally {
    intakeBusy.value = false
  }
}

function applyReadResult(r) {
  intake.value = Object.assign({}, intake.value, {
    how: r.how || '',
    error: r.error || '',
    stages: r.stages || [],
  })
  stageMarker.value = readStageMarker()
  // ★ 读完要**刷新留档快照**：`lastIntake` 是 applyPending 那一刻取的，
  //   不刷新就一直显示"当时没读到内容"，明明这次成功了 —— 自己误导自己。
  lastIntake.value = readLastIntake()
  if (r.ok && r.buf) {
    // 名字可能没有扩展名（微信 FileProvider 给编号），所以放行扩展名检查
    setFile(intake.value.name, r.buf.byteLength, '其他应用打开', { buf: r.buf }, { allowUnknownExt: true })
  }
}

/** 用 onShow 而不是 onMounted：从别的应用跳进来时页面可能是复用的，
 *  而且 App 冷启动那次「我的 → 燕秀产品处理」也是 onShow 才走到。 */
onShow(applyPending)

function pickFile() {
  err.value = ''
  // #ifdef H5
  pickH5()
  return
  // #endif
  // #ifdef MP-WEIXIN
  pickMp()
  return
  // #endif
  // #ifndef H5 || MP-WEIXIN
  toast('当前平台暂不支持选择文件')
  // #endif
}
</script>

<style lang="scss" scoped>
.yxparts { padding-bottom: 40rpx; }

.intro {
  display: block;
  font-size: $fs-caption;
  line-height: 1.7;
  color: $color-text-2;
}

/* 选择区 */
.pick {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 26rpx 0;
  border-bottom: 1rpx solid $color-divider;
}
.pick__icon {
  width: 72rpx; height: 72rpx; flex: 0 0 auto;
  border-radius: $radius-icon;
  background: $color-primary-bg; color: $color-primary;
  display: flex; align-items: center; justify-content: center;
}
.pick__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pick__t { font-size: $fs-body; font-weight: $fw-bold; color: $color-text; }
.pick__d { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.pick > :deep(.icon-svg) { color: $color-text-4; flex: 0 0 auto; }

/* 文件信息 */
.file { padding-top: 8rpx; }
.file__row { display: flex; align-items: flex-start; gap: 20rpx; padding: 12rpx 0; }
.file__k { flex: 0 0 auto; width: 96rpx; font-size: $fs-caption; color: $color-text-3; }
.file__v {
  flex: 1; min-width: 0; font-size: $fs-caption; color: $color-text;
  word-break: break-all;
}

/* 提示块 */
.msg {
  margin-top: 16rpx;
  padding: 18rpx 20rpx;
  border-radius: $radius-card-sm;
  font-size: $fs-mini;
  line-height: 1.7;
}
.msg--err { background: $color-danger-bg; color: $color-danger; }
.msg--warn { background: $color-warning-bg; color: $color-warning; }
.msg--info { background: $color-primary-bg; color: $color-primary; }
.msg > text { display: block; }
.msg > text + text { margin-top: 8rpx; }

.msg__uri {
  font-size: $fs-micro;
  color: $color-text-4;
  word-break: break-all;
}
.msg__stages { margin-top: 4rpx; }
.msg__stage {
  display: block;
  font-size: $fs-micro;
  line-height: 1.7;
  color: $color-text-3;
  word-break: break-all;
}

/* 「还要试其他读取方式」——刻意做成次级按钮 + 说明，
   因为点下去有可能让 App 短暂无响应，得让人知道自己在点的是什么 */
.retry {
  margin-top: 16rpx;
  padding: 20rpx 22rpx;
  border-radius: $radius-card-sm;
  border: 1rpx solid $color-primary-border;
  background: $color-card;
}
.retry__t { display: block; font-size: $fs-caption; font-weight: $fw-bold; color: $color-primary; }
.retry__d { display: block; margin-top: 8rpx; font-size: $fs-micro; line-height: 1.7; color: $color-text-3; }

/* 汇总三格 */
.sum { display: flex; padding: 6rpx 0 10rpx; }
.sum__item {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 6rpx;
  position: relative;
}
.sum__item + .sum__item::before {
  content: ''; position: absolute; left: 0; top: 6rpx; bottom: 6rpx;
  width: 1rpx; background: $color-divider;
}
.sum__v {
  font-family: $font-num; font-size: 40rpx; font-weight: $fw-heavy;
  color: $color-text; font-variant-numeric: tabular-nums;
}
.sum__k { font-size: $fs-micro; color: $color-text-3; }

/* 工作表清单 */
.sheets { margin-top: 8rpx; }
.sheets__item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12rpx 0; border-bottom: 1rpx solid $color-divider;
}
.sheets__item:last-child { border-bottom: 0; }
.sheets__n { font-size: $fs-caption; color: $color-text-2; }
.sheets__c { font-size: $fs-mini; color: $color-text-3; }

.molds { display: flex; gap: 16rpx; padding: 12rpx 0; }
.molds__k { flex: 0 0 auto; width: 96rpx; font-size: $fs-caption; color: $color-text-3; }
.molds__v { flex: 1; min-width: 0; font-size: $fs-caption; color: $color-text; word-break: break-all; }

/* 预览表 */
.prev__t {
  display: block;
  margin: 18rpx 0 6rpx;
  font-size: $fs-mini;
  color: $color-text-3;
}
/* U12：宽表在手机上要横滑，给一句显式提示，别让人以为只有四列 */
.prev__swipe {
  display: block;
  margin-bottom: 10rpx;
  text-align: right;
  font-size: $fs-micro;
  color: $color-primary;
}
.prev {
  width: 100%;
  background: $color-bg;
  border-radius: $radius-card-sm;
}
.prev__inner { display: inline-block; min-width: 100%; }
.prev__row {
  display: flex;
  align-items: center;
  padding: 14rpx 0;
  border-bottom: 1rpx solid $color-divider;
}
.prev__row:last-child { border-bottom: 0; }
.prev__row--head .col { color: $color-text-3; font-size: $fs-micro; }
.col { font-size: $fs-mini; color: $color-text; padding: 0 10rpx; }
.col--name { width: 200rpx; flex: 0 0 auto; }
.col--spec { width: 240rpx; flex: 0 0 auto; }
.col--act { width: 180rpx; flex: 0 0 auto; }
.col--qty { width: 90rpx; flex: 0 0 auto; text-align: right; }
.col--rmk { width: 240rpx; flex: 0 0 auto; color: $color-text-3; }

/* 13 列版（与桌面端一致）：序号/状态在前，客户与系统品名给宽一点 */
.prev__inner--wide { min-width: 2300rpx; }
.col--pick { width: 80rpx; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
.cb {
  width: 34rpx; height: 34rpx; border-radius: 8rpx;
  border: 2rpx solid $color-primary-border; background: $color-card;
  display: flex; align-items: center; justify-content: center;
}
.cb--on { background: $color-primary; border-color: $color-primary; }
.cb--off { border-color: $color-divider; background: $color-divider; opacity: 0.5; }
.col--seq { width: 80rpx; flex: 0 0 auto; }
.col--st { width: 130rpx; flex: 0 0 auto; font-weight: $fw-bold; }
.col--cust { width: 300rpx; flex: 0 0 auto; }
.col--sys { width: 280rpx; flex: 0 0 auto; }
.col--unit { width: 90rpx; flex: 0 0 auto; }
.col--mold { width: 180rpx; flex: 0 0 auto; }
.col--mat { width: 120rpx; flex: 0 0 auto; }
.col--src { width: 220rpx; flex: 0 0 auto; color: $color-text-3; }

/* 状态配色与桌面一致：未匹配红 / 手动蓝 / 其余（自动、记忆）绿 */
.col--bad { color: $color-danger; }
.col--manual { color: $color-primary; }
.col--ok { color: $color-success; }
.prev__row--tap { background: $color-danger-bg; }

/* 候选面板 */
.mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex; align-items: flex-end; z-index: 99;
}
.sheet {
  width: 100%; max-height: 76vh;
  background: $color-card;
  border-radius: $radius-card $radius-card 0 0;
  padding: 24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  display: flex; flex-direction: column;
}
.cand-list { max-height: 46vh; margin-top: 12rpx; }
.cand {
  padding: 18rpx 16rpx;
  border-bottom: 1rpx solid $color-divider;
  display: flex; flex-direction: column;
}
.cand--on { background: $color-primary-bg; border-radius: $radius-card-sm; }
.cand__row { display: flex; align-items: center; gap: 10rpx; flex-wrap: wrap; }
.cand__t { font-size: $fs-body; color: $color-text; font-weight: $fw-bold; }
.cand__s { font-size: $fs-mini; color: $color-text-3; margin-top: 6rpx; }
.sheet__btns { display: flex; gap: 16rpx; margin-top: 20rpx; }
.btn {
  flex: 1; height: 84rpx; border-radius: $radius-btn;
  display: flex; align-items: center; justify-content: center;
  font-size: $fs-body;
}
.btn--ghost { border: 1rpx solid $color-primary-border; color: $color-primary; background: $color-card; }
.btn--primary { background: $color-primary; color: #fff; font-weight: $fw-bold; }

/* 建单条：固定在底部（列表再长也够得着），并给页面留出等高的空档 */
.yxparts--bar { padding-bottom: 200rpx; }
.bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  display: flex; align-items: center; gap: 16rpx;
  padding: 18rpx 24rpx calc(18rpx + env(safe-area-inset-bottom));
  background: $color-card; border-top: 1rpx solid $color-divider;
}
.bar__cust { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.bar__k { font-size: $fs-micro; color: $color-text-3; }
.bar__v {
  font-size: $fs-caption; color: $color-text; margin-top: 4rpx;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.bar__v--off { color: $color-danger; }
.bar__n { flex: 0 0 auto; font-size: $fs-mini; color: $color-text-3; }
.bar__btn {
  flex: 0 0 auto; height: 76rpx; padding: 0 32rpx; border-radius: $radius-btn;
  background: $color-primary; display: flex; align-items: center; justify-content: center;
}
.bar__btn > text { color: #fff; font-size: $fs-caption; font-weight: $fw-bold; }
.bar__btn--off { background: $color-primary-border; }

/* 客户搜索 */
.search { display: flex; align-items: center; gap: 12rpx; margin-top: 14rpx; }
.search__in {
  flex: 1; height: 72rpx; padding: 0 20rpx; border-radius: $radius-input;
  background: $color-bg-sunken; font-size: $fs-caption; color: $color-text;
}
.search__btn {
  flex: 0 0 auto; height: 72rpx; padding: 0 24rpx; border-radius: $radius-btn;
  border: 1rpx solid $color-primary-border; color: $color-primary;
  display: flex; align-items: center;
}
.search__btn > text { font-size: $fs-caption; }

.prev__more {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-micro;
  line-height: 1.7;
  color: $color-text-4;
}

/* 「接入进度」那一卡已整体删除（2026-10-10 用户拍板），配套的 step / note 样式一起清掉 */

.bottom-gap { height: 40rpx; }
</style>
