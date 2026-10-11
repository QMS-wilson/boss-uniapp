# 财鲸 V3 进销存 —— 移动端（uni-app）

一套代码编译到 **H5 / 微信小程序 / App**，作为财鲸 V3 进销存的**移动经营管理端**：
老板在外用手机查库存、看报表、开单改单，数据实时来自本机账套。

> **已接真实后端**（`src/utils/config.js` 的 `USE_MOCK: false`）。示例数据只在
> 历史版本里用过，现已全部下线。业务数据链路：
>
> ```
> H5 / 小程序 / App
>        │  HTTPS  /api/v1/…
>        ▼
>   云端中转 cloudapi      ← 只转发，不落库
>        │  WebSocket
>        ▼
>   客户本机 Agent         ← 直连本机 SQL Server
>        │
>        ▼
>   财鲸 V3 账套（shiwantongda / tongda …）
> ```
>
> 云端**不存任何业务数据**，客户数据始终在自己机器上。Agent 离线时业务接口返回
> `AGENT_OFFLINE`，这是**正常业务态**，前端按「服务未连接」提示，不当故障处理。

---

## 一、技术栈

| 层 | 选型 |
|---|---|
| 框架 | uni-app + Vue 3（`<script setup>`） |
| 构建 | Vite 5 + `@dcloudio/vite-plugin-uni` |
| 状态 | Pinia（`auth` 认证 / `cache` 离线缓存 / `options` 字典） |
| 样式 | SCSS + 设计令牌（`uni.scss`，构建期显式注入，见下） |
| 数据 | 真实 REST API（`src/api/`）+ 适配层（`src/utils/adapt.js`） |

---

## 二、目录结构

```
进销存-uniapp/
├── src/                          ★ 源码根（CLI 的 UNI_INPUT_DIR）
│   ├── pages.json                  路由 + tabBar（34 个页面）
│   ├── manifest.json               应用配置（含微信 appid）
│   ├── App.vue                     根组件（启动恢复登录 / 回前台检查更新）
│   ├── main.js                     入口
│   ├── uni.scss                    设计令牌（主题色/字号/间距）
│   ├── api/                        接口层（路径与参数名严格对齐线上契约）
│   │   ├── index.js                  通用接口（库存/取价/报表/能力清单…）
│   │   ├── auth.js                   登录 / 令牌
│   │   ├── customer.js               客户
│   │   ├── product.js                商品
│   │   ├── salesBill.js              销售单
│   │   ├── purchase.js               采购(进货)单 + 供应商
│   │   └── yxparts.js                已选配件
│   ├── store/                      Pinia
│   ├── utils/                      工具
│   │   ├── config.js               ★ 服务链接解析 + 商户码（身份唯一来源）
│   │   ├── request.js              鉴权注入 / 重试 / 离线回落
│   │   ├── adapt.js                后端返回 → 页面模型
│   │   ├── price.js                取价三级回退
│   │   ├── billState.js            单据状态语义
│   │   ├── billWrites.js           建单/改单写入与幂等
│   │   ├── draftBox.js             离线草稿
│   │   └── …
│   ├── components/                 共享组件（14 个）
│   ├── pages/                      页面（15 个模块）
│   │   ├── home/                   工作台
│   │   ├── sales/                  销售单：列表 / 详情 / 开单改单
│   │   ├── purchase/               采购单：列表 / 详情 / 开单改单
│   │   ├── customer/               客户：列表 / 详情 / 编辑
│   │   ├── product/                商品：列表 / 详情 / 改价
│   │   ├── supplier/               供应商：列表 / 详情 / 编辑
│   │   ├── inventory/              库存 + 出入库流水
│   │   ├── report/                 报表：汇总 / 对账 / 货品 / 应收
│   │   ├── print/                  打印：格式选择 / 预览
│   │   ├── yxparts/                已选配件 / 货品分类
│   │   ├── store/                  切换店铺
│   │   ├── settings/               连接设置（★ 填服务链接）
│   │   ├── server/                 服务状态
│   │   ├── login/                  登录
│   │   └── my/                     我的
│   └── static/tabbar/              tabBar 图标（运行时资源）
├── vite.config.js               ★ 构建配置（uni.scss 注入 + H5 版本指纹）
├── index.html                   H5 模板
├── AndroidManifest.xml          App 打包配置
├── scripts/                     构建 / 部署 / 校验工具
│   ├── deploy.py                ★ H5 部署（一份构建 + 每商户一条软链）
│   ├── check-md5-online.py         线上产物逐文件 md5 核对
│   └── toolchain.py                运行时探测（node/python）
└── docs/                        设计与审计文档
```

---

## 三、快速开始

```bash
npm install

npm run dev:h5           # H5 预览（浏览器）
npm run dev:mp-weixin    # 微信小程序（用微信开发者工具打开 dist/dev/mp-weixin）
npm run dev:app          # App（HBuilderX 或 CLI）

npm run build:h5         # 生产构建 H5
npm run build:mp-weixin  # 生产构建小程序
```

也可用 **HBuilderX** 直接打开本目录运行。

> ★ **CLI 与 HBuilderX 的 `UNI_INPUT_DIR` 差异**：CLI 指向 `src`，HBuilderX 指向**项目根**。
> 而官方插件按 `UNI_INPUT_DIR/uni.scss` 找设计令牌，找不到就**静默跳过** ⇒ HBuilderX 下
> 每个用到 `$token` 的 `<style>` 都报 `Undefined variable`。
> `vite.config.js` 里已按「候选路径」兜底注入，两个入口都成立。详见该文件注释。

---

## 四、★ 商户身份：设置页里填的那条链接

这是本端最重要的一条设计，也是最容易踩坑的地方。

**身份的唯一来源 = 设置页里填进来的链接**（形如 `https://v3jxc.duckdns.org/shiwantongda/`）：

- 链接被拆成两段：`base`（协议+主机+端口）与**第一段路径（商户码）**；
- `base` 只用于拼接口地址，**路径一律不带**；
- 商户码单独存起来当身份，随请求带上。

**为什么不能带着路径去请求**（2026-09-28 现场）：客户粘的就是平时打开的那条
`http://host/shiwantongda/`，而 `/api/v1` 挂在站点根上，带路径会被 nginx 的 SPA
兜底接住 —— `GET` 回 200 一份 HTML、`POST` 直接 **405**。于是一边「测试=通」、
一边登录死活不通。规则收敛在 `utils/config.js` 一处，设置页与运行期共用。

**接口地址默认跟页面同源**（H5），不写死。写死会导致用域名打开时登录请求打到 IP 上，
被浏览器按**混合内容**掐掉，页面却报「网络连接失败」——与网络毫无关系。
只有本地预览（localhost / 非标准端口）与小程序/App 才退回包内默认值。

---

## 五、核心业务特性

| 特性 | 说明 |
|---|---|
| **改单防冲突** | 打开改单页时记录单据 `revision`（内容指纹），保存时带上；与他人改动不符即被后端拒（`BILL_CONFLICT`），提示「这张单已被他人修改，请重新打开」，避免覆盖对方改动 |
| **取价三级回退** | 客户价格策略（`PriceTrace=201`）→ 最近销价 → 默认销价 → 0 待人工，`utils/price.js` |
| **多店切换** | 店铺为一等公民，登录返回可访问店铺列表，请求按店隔离 |
| **离线缓存 + 草稿** | 断网可看缓存、暂存草稿，联网后自动上传 |
| **负库存** | 库存页红色标注负数，允许负库存开单 |
| **打印** | 格式列表 + 打印机选择，图片化预览（移动端 `<image>` 拉图不能带鉴权头，走一次性随机文件名） |
| **H5 热更新提示** | 构建期注入 `__BUILD_TIME__`，回前台与 `version.json` 比对，不一致提示刷新 |

---

## 六、构建与部署（H5）

```bash
# 部署某个商户（构建 + 上传 + 切链）
python scripts/deploy.py --merchant shiwantongda

# 只上传、不重新构建
python scripts/deploy.py --merchant shiwantongda --no-build

# 预演（只打印，不写远端）
python scripts/deploy.py --merchant shiwantongda --dry-run

# 查看谁指向哪份构建 / 回滚
python scripts/deploy.py --list
python scripts/deploy.py --merchant shiwantongda --rollback previous
```

服务器布局：`/var/www/jxc-h5/builds/<构建哈希>/` 存真实文件，
`tenants/<商户码>` 是**软链**。切换 = 改一条软链（原子操作），回滚不重新构建。

> `scripts/toolchain.py` 用于探测本机 node/python（**不写死版本号**）。

---

## 七、接后端约定

所有接口在 **`/api/v1/`** 前缀下，统一 envelope：

```json
{ "ok": true, "data": { "items": [], "total": 0 } }
{ "ok": false, "error": { "code": "AGENT_OFFLINE", "message": "…" } }
```

★ 业务字段在 **`data`** 里；`ok:false` 时看 `error.code`。鉴权用
`Authorization: Bearer <accessToken>`（`utils/request.js` 自动注入并续期）。

**常见错误码**

| code | 含义 | 前端处理 |
|---|---|---|
| `AGENT_OFFLINE` | 客户本机 Agent 未运行 | 正常业务态，提示「本地服务未连接」 |
| `AGENT_BUSY` | 本地服务正忙（并发闸门） | 按 `Retry-After` 提示稍后重试 |
| `RATE_LIMITED` | 请求过于密集 | 同上 |
| `BILL_CONFLICT` | 单据已被他人修改 | 提示重新打开该单 |
| `V3_LOGIN_UNAVAILABLE` | 账套不支持/登录被拒 | 提示换账套或核对账号 |

---

## 八、开发约定（踩坑沉淀）

- **小程序不支持内联 `<svg>` / `v-html`** ⇒ 图标走 data-URI 背景，颜色须烧进图片。
- **`<text>` 内只支持 `<text>`** ⇒ 自定义组件放进 `<text>` 会**整块不渲染且不报错**。
- **逻辑层没有 DOM** ⇒ `rAF/document/window/localStorage` 全不存在，需探测后降级。
- **改小程序代码后**跑 `python scripts/check-mp-compat.py`。
- **字段名对不上不会报错，只会静默变 0** ⇒ 新增字段必须四层链路都带（接口→适配→模型→视图）。
- **列表「N 种」必须后端算** ⇒ 列表接口为性能不带明细数组，前端不能用 `items.length`。

---

## 九、隐私与安全

- 本仓库**不含**任何密钥与生产凭据；服务链接由使用者在设置页填写并仅存本地。
- 生产部署的 SSH / 服务配置**不在本仓库**。
