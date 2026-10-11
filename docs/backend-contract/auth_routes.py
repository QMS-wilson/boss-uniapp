# -*- coding: utf-8 -*-
"""多端统一认证与能力发现：/api/v1/auth/*、/api/v1/capabilities。"""

import json
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import security

router = APIRouter()

REST_ENDPOINTS = [
    "GET /api/v1/sales", "GET /api/v1/sales/{bill_no}", "POST /api/v1/sales",
    "PUT /api/v1/sales/{bill_no}",
    "GET /api/v1/customers", "GET /api/v1/customers/{code}",
    "POST /api/v1/customers", "PUT /api/v1/customers/{code}",
    "GET /api/v1/customer-types",
    "GET /api/v1/products", "GET /api/v1/products/{hpbh}",
    "POST /api/v1/products", "PUT /api/v1/products/{hpbh}",
    "GET /api/v1/price", "GET /api/v1/inventory",
    "GET /api/v1/dashboard/summary",
    "GET /api/v1/reports/sales-summary", "GET /api/v1/reports/sales-trend",
    "GET /api/v1/reports/customer-ranking", "GET /api/v1/reports/product-ranking",
    "GET /api/v1/reports/receivables/summary",
    "GET /api/v1/reports/customer-product-detail",
    "GET /api/v1/reports/customer-statement",
    "POST /api/v1/print/salesbill",
    "POST /api/v1/tasks", "GET /api/v1/tasks", "GET /api/v1/tasks/{task_id}",
    "GET /api/v1/audit-logs",
]


def _wechat_code2session(appid, secret, code):
    try:
        url = "https://api.weixin.qq.com/sns/jscode2session?" + urlencode({
            "appid": appid, "secret": secret, "js_code": code,
            "grant_type": "authorization_code",
        })
        with urlopen(url, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {"errcode": -1, "errmsg": "请求微信接口失败：" + str(exc)}


async def _body(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:  # noqa: BLE001
        return {}


@router.post("/api/v1/auth/login")
async def login(request: Request):
    cfg = request.app.state.cfg
    reg = request.app.state.registry
    body = await _body(request)
    provider = str(body.get("provider") or "").strip().lower()
    if not provider:
        if body.get("code"):
            provider = "wechat"
        elif body.get("openid"):
            provider = "openid"
        else:
            provider = "password"

    if provider == "password":
        account = security.find_account(cfg, body.get("account") or body.get("username"))
        if not account or account.get("disabled"):
            return JSONResponse(status_code=401, content={
                "ok": False, "error": {"code": "ACCOUNT_INVALID", "message": "账号或密码错误"}})
        if not security.verify_password(str(body.get("password") or ""), account):
            return JSONResponse(status_code=401, content={
                "ok": False, "error": {"code": "ACCOUNT_INVALID", "message": "账号或密码错误"}})
        stores = security.stores_for(cfg, reg, account.get("stores"), account.get("all_stores"))
        tokens = security.issue_token_pair(
            cfg, "account:" + account["username"], account.get("name") or account["username"],
            [c["name"] for c in stores] if not account.get("all_stores") else [], account.get("all_stores"), "app")
        return {"ok": True, "data": {
            **tokens,
            "user": {"username": account["username"], "name": account.get("name") or account["username"], "kind": "app"},
            "authorized": bool(stores), "stores": stores,
        }}

    if provider in ("wechat", "openid"):
        if provider == "openid":
            if cfg["auth"].get("allow_openid_login", True) is False:
                return JSONResponse(status_code=403, content={
                    "ok": False, "error": {"code": "OPENID_LOGIN_DISABLED", "message": "当前环境不允许 openid 直接登录"}})
            openid = str(body.get("openid") or "").strip()
            if not openid:
                return JSONResponse(status_code=400, content={
                    "ok": False, "error": {"code": "BAD_REQUEST", "message": "缺少 openid"}})
        else:
            wc = cfg.get("wechat", {})
            missing = []
            if not wc.get("enabled"):
                missing.append("未启用微信登录")
            if not wc.get("appid"):
                missing.append("缺 AppID")
            if not wc.get("secret"):
                missing.append("缺 AppSecret")
            if missing:
                return JSONResponse(status_code=503, content={
                    "ok": False, "error": {"code": "WECHAT_NOT_CONFIGURED",
                                           "message": "云端微信登录配置不完整（" + "、".join(missing) + "）"}})
            code = str(body.get("code") or "").strip()
            if not code:
                return JSONResponse(status_code=400, content={
                    "ok": False, "error": {"code": "BAD_REQUEST", "message": "缺少 wx.login 的 code"}})
            data = _wechat_code2session(str(wc.get("appid")), str(wc.get("secret")), code)
            if data.get("errcode"):
                return JSONResponse(status_code=400, content={
                    "ok": False, "error": {"code": "WX_LOGIN_FAILED",
                                           "message": "微信登录失败（%s）：%s" % (data.get("errcode"), data.get("errmsg", ""))}})
            openid = str(data.get("openid") or "").strip()
            if not openid:
                return JSONResponse(status_code=502, content={
                    "ok": False, "error": {"code": "WX_LOGIN_FAILED", "message": "微信未返回 openid"}})
        user = security.user_by_openid(cfg, openid)
        names = (user or {}).get("clients") or []
        all_stores = bool((user or {}).get("all_clients"))
        stores = security.stores_for(cfg, reg, names, all_stores) if user else []
        tokens = security.issue_token_pair(
            cfg, "wx:" + openid, (user or {}).get("name") or "", names, all_stores, "wechat")
        return {"ok": True, "data": {
            **tokens,
            "user": {"openid": openid, "name": (user or {}).get("name") or "", "kind": "wechat"},
            "authorized": bool(stores), "stores": stores,
        }}

    return JSONResponse(status_code=400, content={
        "ok": False, "error": {"code": "BAD_PROVIDER", "message": "不支持的登录方式：" + provider}})


@router.post("/api/v1/auth/refresh")
async def refresh(request: Request):
    cfg = request.app.state.cfg
    reg = request.app.state.registry
    body = await _body(request)
    token = str(body.get("refreshToken") or security.bearer(request))
    claims = security.verify_token(cfg, token, "refresh")
    if not claims:
        return JSONResponse(status_code=401, content={
            "ok": False, "error": {"code": "TOKEN_INVALID", "message": "refreshToken 无效或已过期"}})
    stores = security.stores_for(cfg, reg, claims.get("stores"), claims.get("all"))
    tokens = security.issue_token_pair(cfg, claims.get("sub"), claims.get("name"),
                                       claims.get("stores") or [], claims.get("all"), claims.get("kind") or "app")
    return {"ok": True, "data": {**tokens, "authorized": bool(stores), "stores": stores}}


@router.post("/api/v1/auth/logout")
async def logout(request: Request):
    return {"ok": True, "data": {"message": "已退出（客户端请丢弃本地令牌）"}}


@router.get("/api/v1/auth/me")
async def me(request: Request):
    cfg = request.app.state.cfg
    reg = request.app.state.registry
    claims = security.verify_token(cfg, security.bearer(request), "access")
    if not claims:
        return JSONResponse(status_code=401, content={
            "ok": False, "error": {"code": "TOKEN_INVALID", "message": "accessToken 无效或已过期"}})
    stores = security.stores_for(cfg, reg, claims.get("stores"), claims.get("all"))
    return {"ok": True, "data": {
        "user": {"subject": claims.get("sub"), "name": claims.get("name"), "kind": claims.get("kind")},
        "authorized": bool(stores), "stores": stores,
    }}


@router.get("/api/v1/capabilities")
async def capabilities(request: Request):
    cfg = request.app.state.cfg
    reg = request.app.state.registry
    client, label, claims, error = security.resolve_rpc_context(cfg, request)
    if error:
        return JSONResponse(status_code=error[0], content=error[1])
    agent = str(client.get("agent") or cfg.get("default_agent") or "")
    info = reg.list_online().get(agent) or {}
    data = {
        "client": {"label": label, "kind": (claims or {}).get("kind") or "legacy"},
        "agent": {"name": agent, "online": bool(info),
                  "version": info.get("version"), "ops": sorted(info.get("ops") or [])},
        "rest": REST_ENDPOINTS,
    }
    try:
        resp = await reg.rpc(agent, "agent.capabilities", {}, 15)
        if resp.get("ok"):
            data["capabilities"] = resp.get("data")
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "data": data}
