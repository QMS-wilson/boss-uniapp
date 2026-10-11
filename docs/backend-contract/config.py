# -*- coding: utf-8 -*-
"""云端配置加载（默认 cloud_config.json，可用 CLOUD_CONFIG 覆盖）。"""

import json
import os


DEFAULTS = {
    "server": {"host": "127.0.0.1", "port": 8000},
    "auth": {
        # 小程序入口令牌：只用于 wechat/login 与 /me，可展示所有店名并做老板登录
        "portal_token": "",
        # 小程序/客户端令牌（上线前必须更换；openid 绑定后续接入）
        # access: guest=通用访客（免 openid）；auth=仅授权老板(users)可用
        "clients": [{"token": "dev-token-001", "name": "dev-client", "agent": "shiwantongda", "access": "guest"}],
        # 各客户本地 Agent 的注册密钥，必须与 v3agent config.json 的 agent.secret 一致
        "agents": {"shiwantongda": "change-me"},
        # 后台管理页登录密码
        "admin": {"password": "admin123"},
        # 老板用户：openid → 可访问客户端；all_clients=true 表示全部(通用)
        "users": [],
        # true 时连通用访客客户端也要求带 openid（微信登录就绪后开启）
        "require_openid": False,
        # App/多端账号（账号密码登录）：[{username,name,salt,password_hash,iterations,stores[],all_stores,disabled}]
        "accounts": [],
        # 多端 access/refresh token 签名密钥（首次运行自动生成并写回配置）
        "token_secret": "",
        "access_ttl": 43200,      # access token 12 小时
        "refresh_ttl": 2592000,   # refresh token 30 天
        # 开发期允许直接用 openid 换取多端令牌（正式环境建议关闭）
        "allow_openid_login": True,
    },
    # 微信小程序登录（code → openid），secret 只存服务器
    "wechat": {"appid": "", "secret": "", "enabled": False},
    "default_agent": "shiwantongda",
    "rpc_timeout": 60,
    "log_dir": "logs",
}


def load(path=None):
    path = path or os.environ.get("CLOUD_CONFIG") or "cloud_config.json"
    cfg = json.loads(json.dumps(DEFAULTS))
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        for section in ("server", "auth", "wechat", "default_agent", "rpc_timeout", "log_dir"):
            if section in data:
                cfg[section] = data[section]
    try:
        cfg["_path"] = os.path.abspath(path)
    except Exception:  # noqa: BLE001
        cfg["_path"] = path
    return cfg


def save(cfg, path=None):
    """把运行期配置写回文件（后台改设置、自动生成 token_secret、账号变动时调用）。"""
    path = path or cfg.get("_path") or os.environ.get("CLOUD_CONFIG") or "cloud_config.json"
    data = {
        "server": cfg["server"],
        "auth": cfg["auth"],
        "wechat": cfg.get("wechat", {"appid": "", "secret": "", "enabled": False}),
        "default_agent": cfg["default_agent"],
        "rpc_timeout": cfg["rpc_timeout"],
        "log_dir": cfg["log_dir"],
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
