# -*- coding: utf-8 -*-
"""异步任务：把耗时的 Agent op 放到后台执行，返回 taskId 供轮询。"""

import asyncio
import time
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import security

router = APIRouter()

TASKS = {}
MAX_TASKS = 200


def _check(request: Request):
    cfg = request.app.state.cfg
    client, label, claims, auth_err = security.resolve_rpc_context(
        cfg, request, {"store": request.query_params.get("store")})
    if auth_err:
        return None, JSONResponse(status_code=auth_err[0], content=auth_err[1])
    return client, None


async def _run(app, task_id, agent, op, params, timeout):
    reg = app.state.registry
    TASKS[task_id].update({"status": "running", "startedAt": time.time()})
    try:
        resp = await reg.rpc(agent, op, params or {}, timeout)
        TASKS[task_id].update({
            "status": "success" if resp.get("ok") else "failed",
            "result": resp,
        })
    except Exception as exc:  # noqa: BLE001
        TASKS[task_id].update({
            "status": "failed",
            "result": {"ok": False, "error": {"code": type(exc).__name__, "message": str(exc)}},
        })
    finally:
        TASKS[task_id]["updatedAt"] = time.time()


@router.post("/api/v1/tasks")
async def task_create(request: Request):
    client, err = _check(request)
    if err:
        return err
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    op = str(body.get("op") or "").strip()
    if not op:
        return JSONResponse(status_code=400,
                            content={"ok": False, "error": {"code": "BAD_REQUEST", "message": "缺少 op"}})
    cfg = request.app.state.cfg
    agent = str(body.get("agent") or client.get("agent") or cfg.get("default_agent") or "")
    timeout = min(max(int(body.get("timeout") or cfg.get("rpc_timeout", 60)), 5), 300)
    task_id = uuid.uuid4().hex
    TASKS[task_id] = {"taskId": task_id, "op": op, "agent": agent, "status": "pending",
                      "params": body.get("params") or {}, "createdAt": time.time(),
                      "updatedAt": time.time(), "result": None}
    if len(TASKS) > MAX_TASKS:
        for key in sorted(TASKS, key=lambda k: TASKS[k].get("createdAt", 0))[:len(TASKS) - MAX_TASKS]:
            TASKS.pop(key, None)
    asyncio.create_task(_run(request.app, task_id, agent, op, body.get("params") or {}, timeout))
    return {"ok": True, "data": {"taskId": task_id, "status": "pending", "op": op, "agent": agent}}


@router.get("/api/v1/tasks")
async def task_list(request: Request):
    _, err = _check(request)
    if err:
        return err
    limit = min(max(int(request.query_params.get("limit") or 20), 1), 100)
    items = sorted(TASKS.values(), key=lambda x: x.get("createdAt", 0), reverse=True)[:limit]
    return {"ok": True, "data": {"items": items, "count": len(items)}}


@router.get("/api/v1/tasks/{task_id}")
async def task_get(task_id: str, request: Request):
    _, err = _check(request)
    if err:
        return err
    task = TASKS.get(task_id)
    if not task:
        return JSONResponse(status_code=404,
                            content={"ok": False, "error": {"code": "TASK_NOT_FOUND", "message": "任务不存在或已过期"}})
    return {"ok": True, "data": task}
