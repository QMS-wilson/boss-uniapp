# 后端契约参考（只读）

这些文件是从线上服务器 `/opt/v3cloud/cloudapi/` 下载的**云端 API 源码副本**，
用于确认前端调用的**真实**路径、参数名与返回字段。

## 为什么要存这份

线上接口的 OpenAPI（`/openapi.json`）里所有业务路由都是空的 `{}` schema
（FastAPI 用的是裸 `Request` 对象，没有 pydantic 模型），
所以**唯一可信的契约来源就是源码本身**。

另外 `D:\进销存老板端\财鲸V3移动经营管理端 API 接口文档 V1.md`
是**设计稿**，字段名与线上实现不一致，不要照它写代码。

## 各文件作用

| 文件 | 作用 |
|---|---|
| `business.py` | **最权威**。所有 REST 路径、query 参数名、RPC op 映射 |
| `ops_registry.js` | 从线上 `admin.html` 提取的 `OPS` 注册表，含**返回字段名** |
| `auth_routes.py` | 登录/刷新/登出的请求与响应结构 |
| `server.py` | CORS 配置（`allow_origins=["*"]`）、路由挂载 |
| `registry.py` | Agent RPC 转发机制（`AGENT_OFFLINE` 的来源） |
| `config.py` | 云端配置结构与默认值 |

## 关键结论

- 云端是**纯转发层**，自身不存业务数据；真实数据在客户本地 Agent 里。
- 成功 `{"ok":true,"data":...}`／失败 `{"ok":false,"error":{"code","message"}}`
- 报表用 `startDate`/`endDate`；销售列表用 `date_from`/`date_to`。
- 后端**没有**审核/反审核，**没有**采购/供应商。
- 看板只返回 `month_amount/today_amount/today_count/receivable_total`。

> 这些文件仅作参考，不参与构建。后端升级后需重新拉取比对。
