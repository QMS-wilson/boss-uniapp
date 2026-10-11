# -*- coding: utf-8 -*-
"""FastAPI 应用：HTTP RPC（给小程序）+ WebSocket（接本地 Agent）。"""

import asyncio
import json
import logging
import os
import time
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .admin import router as admin_router
from .auth_routes import router as auth_router
from .business import router as business_router
from . import security
from .tasks import router as tasks_router
from .registry import AgentBadSecret, AgentOffline, AgentRegistry

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

log = logging.getLogger("cloud.server")


def _audit(cfg, entry):
    d = cfg.get("log_dir") or "logs"
    os.makedirs(d, exist_ok=True)
    try:
        with open(os.path.join(d, "audit.jsonl"), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001 审计失败不阻断业务
        pass


def _client_by_token(cfg, token):
    for c in cfg["auth"].get("clients", []):
        if c.get("token") == token:
            return c
    return None


def _bearer_token(request):
    auth = request.headers.get("authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else ""


def _user_by_openid(cfg, openid):
    return next((u for u in cfg["auth"].get("users", []) if u.get("openid") == openid), None)


def _client_auth_error(cfg, client, openid):
    """校验 openid 是否允许访问该客户端；通过返回 None，否则 (http_status, payload)。"""
    access = client.get("access", "guest")
    if access == "auth":
        user = _user_by_openid(cfg, openid) if openid else None
        if not openid:
            return (401, {"ok": False, "error": {"code": "OPENID_REQUIRED",
                                                 "message": "该客户端需要微信登录"}})
        if user is None:
            return (403, {"ok": False, "error": {"code": "USER_NOT_FOUND",
                                                 "message": "该微信未开通访问权限，请联系管理员绑定"}})
        if not (user.get("all_clients") or client["name"] in user.get("clients", [])):
            return (403, {"ok": False, "error": {"code": "NO_ACCESS",
                                                 "message": "该微信无权访问此账套"}})
    elif cfg["auth"].get("require_openid") and not openid:
        return (401, {"ok": False, "error": {"code": "OPENID_REQUIRED",
                                             "message": "请先微信登录"}})
    return None


def _record_login(app, client_label, openid):
    if openid:
        app.state.recent_logins[openid] = {"client": client_label, "openid": openid,
                                           "ts": time.time()}


def _client_online(cfg, reg, client):
    return (client.get("agent") or "") in reg.list_online()


def _wechat_code2session(appid, secret, code):
    try:
        url = "https://api.weixin.qq.com/sns/jscode2session?" + urlencode({
            "appid": appid, "secret": secret, "js_code": code,
            "grant_type": "authorization_code",
        })
        with urlopen(url, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 微信接口异常统一回结构化错误
        return {"errcode": -1, "errmsg": "请求微信接口失败：" + str(exc)}


def create_app(cfg):
    app = FastAPI(title="V3 云端 API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    reg = AgentRegistry(cfg)
    app.state.cfg = cfg
    app.state.registry = reg
    app.state.recent_logins = {}

    @app.get("/admin", include_in_schema=False)
    async def admin_page():
        return FileResponse(os.path.join(BASE_DIR, "web", "admin.html"))

    app.include_router(admin_router, prefix="/api/admin")
    app.include_router(auth_router)
    app.include_router(business_router)
    app.include_router(tasks_router)

    @app.get("/api/v1/health")
    async def health():
        return {
            "ok": True,
            "agents": {
                name: {"online": True, "source": info["source"], "version": info["version"], "ops": info["ops"]}
                for name, info in reg.list_online().items()
            },
        }

    @app.get("/api/v1/agents")
    async def agents():
        return {
            "agents": [
                {"name": name, "online": True, "source": info["source"],
                 "version": info["version"], "ops": info["ops"]}
                for name, info in sorted(reg.list_online().items())
            ]
        }

    @app.post("/api/v1/wechat/login")
    async def wechat_login(request: Request):
        """小程序 wx.login 的 code → openid（静默，无授权弹窗）。"""
        token = _bearer_token(request)
        client = _client_by_token(cfg, token)
        portal = token and token == cfg["auth"].get("portal_token")
        if client is None and not portal:
            return JSONResponse({"ok": False, "error": {"code": "UNAUTHORIZED",
                                                        "message": "无效令牌"}}, status_code=401)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"ok": False, "error": {"code": "BAD_REQUEST",
                                                        "message": "请求体不是 JSON"}}, status_code=400)
        code = str(body.get("code") or "").strip()
        if not code:
            return JSONResponse({"ok": False, "error": {"code": "BAD_REQUEST",
                                                        "message": "缺少 wx.login 的 code"}}, status_code=400)
        wc = cfg.get("wechat", {})
        appid, secret = str(wc.get("appid") or ""), str(wc.get("secret") or "")
        missing = []
        if not wc.get("enabled"):
            missing.append("未启用微信登录")
        if not appid:
            missing.append("缺 AppID")
        if not secret:
            missing.append("缺 AppSecret")
        if missing:
            return JSONResponse({"ok": False, "error": {"code": "WECHAT_NOT_CONFIGURED",
                                                        "message": "云端微信登录配置不完整（" + "、".join(missing) + "），请在后台「系统设置」补充"}},
                                status_code=503)
        data = await asyncio.to_thread(_wechat_code2session, appid, secret, code)
        errcode = data.get("errcode")
        if errcode:
            return JSONResponse(
                {"ok": False, "error": {"code": "WX_LOGIN_FAILED",
                                        "message": "微信登录失败（%s）：%s" % (errcode, data.get("errmsg", ""))}},
                status_code=400,
            )
        openid = str(data.get("openid") or "").strip()
        if not openid:
            return JSONResponse({"ok": False, "error": {"code": "WX_LOGIN_FAILED",
                                                        "message": "微信未返回 openid"}}, status_code=502)
        _record_login(app, "入口登录", openid)
        _audit(cfg, {"ts": time.time(), "client": "入口登录", "agent": "",
                     "op": "wechat.login", "ok": True, "code": None})
        return {"ok": True, "openid": openid}

    @app.get("/api/v1/me")
    async def me(request: Request):
        """按 openid 查询该老板可访问的店铺列表（0 家=未绑定）。"""
        token = _bearer_token(request)
        client = _client_by_token(cfg, token)
        portal = token and token == cfg["auth"].get("portal_token")
        if client is None and not portal:
            return JSONResponse({"ok": False, "error": {"code": "UNAUTHORIZED",
                                                        "message": "无效令牌"}}, status_code=401)
        openid = (request.headers.get("x-openid") or "").strip()
        if not openid:
            return JSONResponse({"ok": False, "error": {"code": "OPENID_REQUIRED",
                                                        "message": "缺少 X-Openid，请先微信登录"}}, status_code=401)
        label = "入口" if portal else (client.get("name") or "客户端")
        _record_login(app, label, openid)
        user = _user_by_openid(cfg, openid)
        stores = []
        if user:
            clients = cfg["auth"].get("clients", [])
            picks = clients if user.get("all_clients") else [
                c for c in clients if c.get("name") in user.get("clients", [])]
            for c in picks:
                stores.append({
                    "name": c.get("name"),
                    "title": c.get("title") or c.get("name"),
                    "agent": c.get("agent", ""),
                    "access": c.get("access", "guest"),
                    "token": c.get("token", ""),
                    "online": _client_online(cfg, reg, c),
                })
        _audit(cfg, {"ts": time.time(), "client": label, "agent": "",
                     "op": "me", "ok": True, "code": None,
                     "note": "openid=%s 店铺数=%d" % (openid, len(stores))})
        return {"ok": True, "openid": openid,
                "name": user.get("name") if user else "",
                "authorized": bool(user and stores),
                "stores": stores}

    @app.post("/agent/poll")
    async def agent_poll(request: Request):
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"ok": False, "error": "bad json"}, status_code=400)
        name = str(body.get("agent") or "").strip()
        if reg.cfg["auth"].get("agents", {}).get(name) != str(body.get("secret") or ""):
            return JSONResponse({"ok": False, "error": "bad secret"}, status_code=403)
        requests = reg.http_poll(
            name,
            version=str(body.get("version") or ""),
            ops=body.get("ops"),
        )
        return {"ok": True, "requests": requests}

    @app.post("/agent/result")
    async def agent_result(request: Request):
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"ok": False, "error": "bad json"}, status_code=400)
        name = str(body.get("agent") or "").strip()
        if reg.cfg["auth"].get("agents", {}).get(name) != str(body.get("secret") or ""):
            return JSONResponse({"ok": False, "error": "bad secret"}, status_code=403)
        reg.http_result(name, body.get("response") or {})
        return {"ok": True}

    @app.post("/api/v1/rpc")
    async def rpc(request: Request):
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"ok": False, "error": {"code": "BAD_REQUEST", "message": "请求体不是 JSON"}}, status_code=400)
        client, label, claims, auth_err = security.resolve_rpc_context(cfg, request, body)
        if auth_err:
            return JSONResponse(status_code=auth_err[0], content=auth_err[1])
        openid = (request.headers.get("x-openid") or "").strip()
        if client.get("name"):
            _record_login(app, label or client["name"], openid or str((claims or {}).get("sub") or ""))
        op = str(body.get("op") or "").strip()
        if not op:
            return JSONResponse({"ok": False, "error": {"code": "BAD_REQUEST", "message": "缺少 op"}}, status_code=400)
        agent_name = str(body.get("agent") or client.get("agent") or cfg.get("default_agent") or "").strip()
        timeout = min(max(int(body.get("timeout") or cfg.get("rpc_timeout", 60)), 5), 300)
        ts = time.time()
        try:
            resp = await reg.rpc(agent_name, op, body.get("params") or {}, timeout)
            ok = bool(resp.get("ok"))
            status = 200 if ok else 502 if resp.get("error", {}).get("code") == "INTERNAL" else 400
            resp["agent"] = agent_name
            _audit(cfg, {"ts": ts, "client": client.get("name"), "agent": agent_name,
                         "op": op, "ok": ok, "code": resp.get("error", {}).get("code")})
            return JSONResponse(resp, status_code=status)
        except AgentOffline:
            return JSONResponse(
                {"ok": False, "error": {"code": "AGENT_OFFLINE", "message": f"客户本地 Agent 不在线：{agent_name}"}},
                status_code=503,
            )
        except TimeoutError:
            return JSONResponse(
                {"ok": False, "error": {"code": "TIMEOUT", "message": f"Agent 响应超时：{agent_name}"}},
                status_code=504,
            )

    @app.websocket("/ws/agent")
    async def ws_agent(ws: WebSocket):
        await ws.accept()
        name = None
        try:
            while True:
                text = await ws.receive_text()
                try:
                    data = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "hello":
                    if name is not None:
                        continue
                    try:
                        await reg.register(ws, data)
                    except AgentBadSecret:
                        await ws.close(code=4001, reason="bad secret")
                        return
                    name = str(data.get("agent") or "")
                    continue
                if name is None:
                    continue
                await reg.handle_agent_message(name, ws, data)
        except WebSocketDisconnect:
            pass
        finally:
            if name:
                reg.unregister(name, ws)

    return app
