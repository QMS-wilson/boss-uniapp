# -*- coding: utf-8 -*-
"""本地 Agent 连接注册表与 RPC 转发。

每个客户的本地 Agent 主动连上来（hello），云端把小程序请求按 agent 名转发，
收到响应后按 msg id 匹配回给 HTTP 调用方。
"""

import asyncio
import collections
import json
import logging
import time
import uuid

log = logging.getLogger("cloud.registry")


class AgentOffline(Exception):
    pass


class AgentBadSecret(Exception):
    pass


class AgentConn:
    def __init__(self, ws, hello):
        self.ws = ws
        self.name = str(hello.get("agent") or "")
        self.version = str(hello.get("version") or "")
        self.ops = set(hello.get("ops") or [])
        self.connected_at = time.time()


class AgentRegistry:
    def __init__(self, cfg):
        self.cfg = cfg
        self.agents = {}     # name -> AgentConn
        self.pending = {}    # msg_id -> (agent_name, asyncio.Future)
        self.last_seen = {}  # name -> unix（最近上线/离线/活跃时间）
        # HTTP 轮询模式（网络对 WS 不稳定时的备选传输）
        self.http_last = {}      # name -> unix 最近一次 poll
        self.http_meta = {}      # name -> {version, ops, connected_at}
        self.http_queue = collections.defaultdict(collections.deque)  # name -> [req]
        self.http_waiters = {}   # msg_id -> (agent_name, asyncio.Future)

    def _check_secret(self, name, secret):
        agents = self.cfg["auth"].get("agents", {})
        return agents.get(name) is not None and str(agents.get(name)) == str(secret)

    async def register(self, ws, hello):
        name = str(hello.get("agent") or "").strip()
        if not self._check_secret(name, hello.get("secret") or ""):
            raise AgentBadSecret(name)
        old = self.agents.get(name)
        if old is not None and old.ws is not ws:
            try:
                await old.ws.close(code=4001, reason="replaced by new connection")
            except Exception:
                pass
        self.agents[name] = AgentConn(ws, hello)
        self.last_seen[name] = time.time()
        log.info("Agent 上线：%s v%s ops=%d", name, self.agents[name].version, len(self.agents[name].ops))
        return True

    def unregister(self, name, ws):
        cur = self.agents.get(name)
        if cur is None or cur.ws is not ws:
            return
        del self.agents[name]
        self.last_seen[name] = time.time()
        log.warning("Agent 离线：%s", name)
        # 该 Agent 在途请求全部失败，避免 HTTP 侧一直等待
        dead = [mid for mid, (an, _) in self.pending.items() if an == name]
        for mid in dead:
            _, fut = self.pending.pop(mid)
            if not fut.done():
                fut.set_exception(AgentOffline("agent offline"))

    async def disconnect(self, name):
        conn = self.agents.get(name)
        if conn is None:
            return False
        try:
            await conn.ws.close(code=4000, reason="admin disconnect")
        except Exception:
            pass
        return True

    async def handle_agent_message(self, name, ws, data):
        self.last_seen[name] = time.time()
        if data.get("type") == "ping":
            await ws.send_text(json.dumps({"type": "pong"}))
            return
        if data.get("type") != "response":
            return
        mid = str(data.get("id") or "")
        item = self.pending.get(mid)
        if item is None or item[0] != name:
            return
        _, fut = self.pending.pop(mid)
        if not fut.done():
            fut.set_result(data)

    async def rpc(self, agent_name, op, params, timeout):
        conn = self.agents.get(agent_name)
        if conn is not None:
            mid = uuid.uuid4().hex
            fut = asyncio.get_running_loop().create_future()
            self.pending[mid] = (agent_name, fut)
            try:
                await conn.ws.send_text(
                    json.dumps(
                        {"type": "request", "id": mid, "op": op, "params": params or {}},
                        ensure_ascii=False,
                    )
                )
                return await asyncio.wait_for(fut, timeout)
            except asyncio.TimeoutError:
                raise TimeoutError(f"agent {agent_name} 响应超时") from None
            finally:
                self.pending.pop(mid, None)

        # HTTP 轮询模式
        now = time.time()
        last = self.http_last.get(agent_name)
        if last is None or now - last > 25:
            raise AgentOffline(f"agent {agent_name} 不在线")
        mid = uuid.uuid4().hex
        fut = asyncio.get_running_loop().create_future()
        self.http_waiters[mid] = (agent_name, fut)
        req = {"type": "request", "id": mid, "op": op, "params": params or {}}
        self.http_queue[agent_name].append(req)
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"agent {agent_name} 响应超时") from None
        finally:
            self.http_waiters.pop(mid, None)
            try:
                q = self.http_queue.get(agent_name)
                if q:
                    q = collections.deque(x for x in q if x.get("id") != mid)
                    self.http_queue[agent_name] = q
            except Exception:
                pass

    def http_poll(self, name, version="", ops=None):
        """Agent 轮询取请求；返回 (requests, meta)。"""
        now = time.time()
        if name not in self.http_meta:
            self.http_meta[name] = {"version": version, "ops": ops or [], "connected_at": now}
        else:
            m = self.http_meta[name]
            if version:
                m["version"] = version
            if ops:
                m["ops"] = ops
        self.http_last[name] = now
        q = self.http_queue.get(name)
        out = []
        while q and len(out) < 5:
            out.append(q.popleft())
        return out

    def http_result(self, agent_name, data):
        mid = str(data.get("id") or "")
        item = self.http_waiters.get(mid)
        if item is None or item[0] != agent_name:
            return False
        _, fut = self.http_waiters.pop(mid)
        if not fut.done():
            fut.set_result(data)
        return True

    def list_online(self, age=25):
        out = {}
        for name, c in self.agents.items():
            out[name] = {
                "source": "ws", "version": c.version, "ops": sorted(c.ops),
                "connected_at": c.connected_at,
            }
        now = time.time()
        for name, ts in self.http_last.items():
            if name in out or now - ts > age:
                continue
            m = self.http_meta.get(name, {})
            out[name] = {
                "source": "http",
                "version": m.get("version", ""),
                "ops": sorted(m.get("ops") or []),
                "connected_at": m.get("connected_at", ts),
            }
        return out
