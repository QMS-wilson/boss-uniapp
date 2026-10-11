# -*- coding: utf-8 -*-
"""业务 REST 接口层：按 API 文档把 RPC op 包装成 /api/v1/... 业务接口。

鉴权与 /api/v1/rpc 一致：Authorization: Bearer <店铺token> + X-Openid。
返回统一 envelope：{"ok": true, "data": ..., "op": ..., "agent": ...}。
"""

import json
import os

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .registry import AgentOffline
from . import security

router = APIRouter()


def _bearer(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else ""


def _client_by_token(cfg, token):
    return next((c for c in cfg["auth"].get("clients", []) if c.get("token") == token), None)


def _user_by_openid(cfg, openid):
    return next((u for u in cfg["auth"].get("users", []) if u.get("openid") == openid), None)


def _auth_error(cfg, client, openid):
    access = client.get("access", "guest")
    if access == "auth":
        if not openid:
            return (401, {"ok": False, "error": {"code": "OPENID_REQUIRED", "message": "该客户端需要微信登录"}})
        user = _user_by_openid(cfg, openid)
        if user is None:
            return (403, {"ok": False, "error": {"code": "USER_NOT_FOUND", "message": "该微信未开通访问权限"}})
        if not (user.get("all_clients") or client["name"] in user.get("clients", [])):
            return (403, {"ok": False, "error": {"code": "NO_ACCESS", "message": "该微信无权访问此账套"}})
    elif cfg["auth"].get("require_openid") and not openid:
        return (401, {"ok": False, "error": {"code": "OPENID_REQUIRED", "message": "请先微信登录"}})
    return None


async def _rpc(request: Request, op: str, params: dict = None, timeout: int = 60):
    cfg = request.app.state.cfg
    reg = request.app.state.registry
    hint = {"store": request.query_params.get("store")}
    client, label, claims, auth_err = security.resolve_rpc_context(cfg, request, hint)
    if auth_err:
        return JSONResponse(status_code=auth_err[0], content=auth_err[1])
    agent = str(client.get("agent") or cfg.get("default_agent") or "").strip()
    try:
        resp = await reg.rpc(agent, op, params or {}, timeout)
    except AgentOffline:
        return JSONResponse(status_code=502, content={
            "ok": False, "error": {"code": "AGENT_OFFLINE", "message": "客户本地 Agent 不在线：" + agent}})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=502, content={
            "ok": False, "error": {"code": "INTERNAL", "message": str(exc)}})
    if resp.get("ok") is False:
        code = (resp.get("error") or {}).get("code")
        status = 502 if code == "INTERNAL" else 400
        return JSONResponse(status_code=status, content=resp)
    return {"ok": True, "data": resp.get("data"), "op": op, "agent": agent}


async def _body(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:  # noqa: BLE001
        return {}


def _q(request: Request, key: str, default=None):
    v = request.query_params.get(key)
    return default if v in (None, "") else v


# ---------------- 销售单 ----------------
@router.get("/api/v1/sales")
async def sales_list(request: Request):
    params = {
        "date_from": _q(request, "date_from"), "date_to": _q(request, "date_to"),
        "customer": _q(request, "customer"), "state": _q(request, "state"),
        "limit": _q(request, "limit", 100),
    }
    return await _rpc(request, "bill.list", params)


@router.get("/api/v1/sales/{bill_no}")
async def sales_detail(bill_no: str, request: Request):
    return await _rpc(request, "bill.get", {"bill_no": bill_no})


@router.post("/api/v1/sales")
async def sales_create(request: Request):
    return await _rpc(request, "salesbill.create", await _body(request), timeout=120)


@router.put("/api/v1/sales/{bill_no}")
async def sales_update(bill_no: str, request: Request):
    body = await _body(request)
    body["bill_no"] = bill_no
    return await _rpc(request, "salesbill.update", body, timeout=120)


# ---------------- 客户 ----------------
@router.get("/api/v1/customers")
async def customers(request: Request):
    params = {"keyword": _q(request, "keyword", ""), "limit": _q(request, "limit", 120)}
    return await _rpc(request, "customer.search", params)


@router.get("/api/v1/customers/{code}")
async def customer_detail(code: str, request: Request):
    return await _rpc(request, "customer.get", {"code": code})


@router.post("/api/v1/customers")
async def customer_create(request: Request):
    return await _rpc(request, "customer.save", await _body(request), timeout=120)


@router.put("/api/v1/customers/{code}")
async def customer_update(code: str, request: Request):
    body = await _body(request)
    body["code"] = code
    return await _rpc(request, "customer.save", body, timeout=120)


@router.get("/api/v1/customer-types")
async def customer_types(request: Request):
    return await _rpc(request, "customer.types", {})


# ---------------- 商品 ----------------
@router.get("/api/v1/products")
async def products(request: Request):
    params = {"keyword": _q(request, "keyword", ""), "limit": _q(request, "limit", 120)}
    return await _rpc(request, "product.search", params)


@router.get("/api/v1/products/{hpbh}")
async def product_detail(hpbh: str, request: Request):
    return await _rpc(request, "product.get", {"hpbh": hpbh})


@router.post("/api/v1/products")
async def product_create(request: Request):
    return await _rpc(request, "product.save", await _body(request), timeout=120)


@router.put("/api/v1/products/{hpbh}")
async def product_update(hpbh: str, request: Request):
    body = await _body(request)
    body["code"] = hpbh
    return await _rpc(request, "product.save", body, timeout=120)


# ---------------- 价格 / 库存 ----------------
@router.get("/api/v1/price")
async def price(request: Request):
    params = {"customer": _q(request, "customerId"), "hpbh": _q(request, "productId"),
              "unit": _q(request, "unit", "")}
    return await _rpc(request, "price.resolve", params)


@router.get("/api/v1/inventory")
async def inventory(request: Request):
    params = {"keyword": _q(request, "keyword", ""), "hpbh": _q(request, "productId"),
              "limit": _q(request, "limit", 200)}
    return await _rpc(request, "inventory.query", params)


# ---------------- 看板 / 报表 ----------------
@router.get("/api/v1/dashboard/summary")
async def dashboard(request: Request):
    params = {"month_start": _q(request, "month_start"), "today": _q(request, "today")}
    return await _rpc(request, "system.dashboard", params)


@router.get("/api/v1/reports/sales-summary")
async def sales_summary(request: Request):
    params = {"date_from": _q(request, "startDate"), "date_to": _q(request, "endDate"),
              "customer": _q(request, "customerId")}
    return await _rpc(request, "report.sales.summary", params)


@router.get("/api/v1/reports/sales-trend")
async def sales_trend(request: Request):
    params = {"date_from": _q(request, "startDate"), "date_to": _q(request, "endDate"),
              "granularity": _q(request, "granularity", "day")}
    return await _rpc(request, "report.sales.trend", params)


@router.get("/api/v1/reports/customer-ranking")
async def customer_ranking(request: Request):
    params = {"date_from": _q(request, "startDate"), "date_to": _q(request, "endDate"),
              "limit": _q(request, "limit", 20)}
    return await _rpc(request, "report.customer.ranking", params)


@router.get("/api/v1/reports/product-ranking")
async def product_ranking(request: Request):
    params = {"date_from": _q(request, "startDate"), "date_to": _q(request, "endDate"),
              "limit": _q(request, "limit", 20)}
    return await _rpc(request, "report.product.ranking", params)


@router.get("/api/v1/reports/receivables/summary")
async def receivables(request: Request):
    params = {"keyword": _q(request, "keyword", ""),
              "only_receivable": _q(request, "onlyReceivable", "true") not in ("false", "0", False),
              "limit": _q(request, "pageSize", 50)}
    return await _rpc(request, "report.receivables.summary", params)


@router.get("/api/v1/reports/customer-product-detail")
async def customer_product_detail(request: Request):
    params = {"customer": _q(request, "customerId"), "date_from": _q(request, "startDate"),
              "date_to": _q(request, "endDate"), "limit": _q(request, "limit", 200)}
    return await _rpc(request, "report.customer.product.detail", params)


@router.get("/api/v1/reports/customer-statement")
async def customer_statement(request: Request):
    params = {"customer": _q(request, "customerId"), "date_from": _q(request, "startDate"),
              "date_to": _q(request, "endDate")}
    return await _rpc(request, "report.customer.statement", params)


# ---------------- 打印 ----------------
@router.post("/api/v1/print/salesbill")
async def print_salesbill(request: Request):
    body = await _body(request)
    params = {"bill_no": body.get("bill_no") or body.get("billNo"),
              "mode": body.get("mode") or "system",
              "copies": body.get("copies") or 1}
    return await _rpc(request, "print.salesbill", params, timeout=120)


# ---------------- 审计日志 ----------------
@router.get("/api/v1/audit-logs")
async def audit_logs(request: Request):
    cfg = request.app.state.cfg
    client = _client_by_token(cfg, _bearer(request))
    if client is None:
        return JSONResponse(status_code=401,
                            content={"ok": False, "error": {"code": "UNAUTHORIZED", "message": "无效令牌"}})
    page = max(int(_q(request, "page", 1) or 1), 1)
    size = min(max(int(_q(request, "pageSize", 20) or 20), 1), 200)
    entries = []
    path = os.path.join(cfg.get("log_dir") or "logs", "audit.jsonl")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                try:
                    entries.append(json.loads(line))
                except Exception:  # noqa: BLE001
                    continue
    action = str(_q(request, "action", "") or "").lower()
    if action:
        entries = [e for e in entries if action in str(e.get("op") or "").lower()]
    entries = list(reversed(entries))
    total = len(entries)
    start = (page - 1) * size
    return {"ok": True, "data": {
        "items": [{"id": str(i), "time": e.get("ts"), "action": e.get("op"),
                   "operator": e.get("client"), "agent": e.get("agent"),
                   "result": "SUCCESS" if e.get("ok") else "FAIL", "note": e.get("note", "")}
                  for i, e in enumerate(entries[start:start + size], start + 1)],
        "pagination": {"page": page, "pageSize": size, "total": total,
                       "hasMore": start + size < total},
    }}
