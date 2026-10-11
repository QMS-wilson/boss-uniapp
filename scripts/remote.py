#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
远程运维小工具 —— 在 149.88.75.125 上执行命令 / 传文件 / 重启云端服务。

用途（本项目固定套路）：
    # 跑任意命令
    python.exe scripts/remote.py exec "systemctl status v3cloud --no-pager"

    # 把本地文件传上去（覆盖）
    python.exe scripts/remote.py put 本地路径 远程路径

    # 拉远程文件下来
    python.exe scripts/remote.py get 远程路径 本地路径

    # 重启 cloudapi（改完 /opt/v3cloud/cloudapi/*.py 后必须做）
    python.exe scripts/remote.py restart

★ 云端源码真身是 /opt/v3cloud（不是 D:/v3-wechat/cloudapi，那是副本）。
  传完 .py 后 uvicorn 不会自动重载，**必须 restart**，否则改动不生效。

★ 客户本地 Agent（v3agent）跑在客户自己的电脑上，**从这台服务器碰不到**，
  它的更新只能由客户侧重启。本脚本只管云端。
"""
import os
import sys

from scp import SCPClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sshtarget  # noqa: E402

HOST = sshtarget.HOST
USER = sshtarget.USER

# cloudapi 的真实部署目录与 systemd 单元名（实测）
CLOUD_DIR = "/opt/v3cloud"
SERVICE_CANDIDATES = ["v3cloud", "cloudapi", "v3-cloud"]


def connect():
    return sshtarget.connect()


def run(cli, cmd, timeout=180):
    return sshtarget.run(cli, cmd, timeout)


def show(code, o, e):
    if o.strip():
        print(o.strip())
    if e.strip():
        print("[stderr] " + e.strip()[:1500])
    print("[exit] %d" % code)


def find_service(cli):
    """找出 cloudapi 的 systemd 单元名。"""
    for name in SERVICE_CANDIDATES:
        code, o, _ = run(cli, "systemctl cat %s >/dev/null 2>&1 && echo YES" % name)
        if code == 0 and "YES" in o:
            return name
    # 兜底：按端口反查进程
    code, o, _ = run(cli, "ss -lntp 2>/dev/null | grep ':8000'")
    return o.strip() or ""


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    action = sys.argv[1]
    cli = connect()
    try:
        if action == "exec":
            cmd = sys.argv[2] if len(sys.argv) > 2 else ""
            if not cmd:
                print("用法: remote.py exec \"命令\"")
                return 1
            show(*run(cli, cmd))

        elif action == "put":
            local, remote = sys.argv[2], sys.argv[3]
            with SCPClient(cli.get_transport()) as scp:
                scp.put(local, remote)
            # 传完确认大小一致
            size = os.path.getsize(local)
            code, o, _ = run(cli, "stat -c %%s '%s'" % remote)
            print("上传 %s -> %s  本地 %d 字节 / 远程 %s 字节"
                  % (local, remote, size, o.strip()))

        elif action == "get":
            remote, local = sys.argv[2], sys.argv[3]
            with SCPClient(cli.get_transport()) as scp:
                scp.get(remote, local)
            print("下载 %s -> %s（%d 字节）" % (remote, local, os.path.getsize(local)))

        elif action == "restart":
            svc = find_service(cli)
            if not svc:
                print("找不到 cloudapi 服务，请手动确认进程")
                show(*run(cli, "ss -lntp | grep ':8000'"))
                return 1
            if " " in svc:  # 不是单元名，是进程行
                print("按端口找到进程：\n%s" % svc)
                print("未做重启，请人工确认服务名")
                return 1
            print("重启服务: %s" % svc)
            show(*run(cli, "systemctl restart %s && sleep 2 && systemctl is-active %s" % (svc, svc)))
            show(*run(cli, "ss -lntp 2>/dev/null | grep ':8000'"))

        elif action == "status":
            svc = find_service(cli)
            print("服务: %s" % svc)
            show(*run(cli, "systemctl status %s --no-pager 2>/dev/null | head -12" % svc))
            show(*run(cli, "ss -lntp 2>/dev/null | grep ':8000'"))

        else:
            print("未知动作: %s" % action)
            print(__doc__)
            return 1
    finally:
        cli.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
