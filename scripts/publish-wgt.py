# -*- coding: utf-8 -*-
"""把 App 端资源打成 **wgt 热更包**并发布（配合 `src/utils/appUpdate.js` 与云端 `/api/v1/app-release`）。

★ 为什么需要它：APK 装到客户手机上之后不会自己变，而绝大多数改动（页面/逻辑/文案）
  用 wgt 就能更 —— 只有动**原生权限、原生插件、包名/证书**时才必须重新云打包。
  没有这条链路时「发一版」等于「重打包 + 找人装机」，于是旧包调新接口那种「莫名报错」一直留着。

★ wgt 是什么：`dist/build/app/` 这个目录的 zip（manifest.json 在包内根），改扩展名 .wgt。
  DCloud 运行时按包内 manifest.json 的 **appid + version.code** 决定装不装，
  所以这里读的是**构建产物里的** manifest.json，不是 `src/manifest.json`（构建会改写它）。

★ 三条硬规矩（这是「往客户手机里塞代码」，不是发一张图片）：
  ① 下载地址必须 https —— http 上被人替换一个 wgt = 在客户机上执行任意代码；
     脚本这里拒一道，App 端 `appUpdate.js` 再拒一道。
  ② version.code 不许与现网清单相同或更小 —— 同码/小码 DCloud 会**静默不装**，
     现场表现是「客户点了更新但什么都没发生」，比报错更难查。要重发同一个码得显式加 --allow-same。
  ③ sha256 一并写进清单：App 端目前**不**校验（要校验得引一份纯 JS 摘要实现），
     但发布记录里留着，出问题能核对包有没有被换过。

用法：
    python scripts/publish-wgt.py --build ^
        --url-prefix https://v3jxc.duckdns.org/release ^
        --notes "修首页统计与打印入口" [--force] [--allow-same] [--dry-run]

依赖 paramiko + scp ⇒ 必须用带这两个包的解释器：
    C:/Users/24773/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"""
import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import time
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sshtarget  # noqa: E402
from scp import SCPClient  # noqa: E402

try:  # 控制台是 GBK，打中文会 UnicodeEncodeError
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIST = os.path.join(ROOT, "dist", "build", "app")
WGT_DIR = os.path.join(ROOT, "dist", "wgt")
RELEASE_DIR = "/var/www/jxc-h5/release"          # nginx 的 /release/ 指向这里（见 deploy.py）
MANIFEST_REMOTE = RELEASE_DIR + "/app-version.json"


def log(*a):
    print(" ".join(str(x) for x in a))


def die(msg, code=1):
    log("✗ " + msg)
    sys.exit(code)


# ---------------- 构建（可选，但判据一条都不能省） ----------------
def build_app():
    """跑 `npm run build:app`，并**证明它真跑了**。

    ★ 为什么这么啰嗦：本项目撞过两次「exit 0 + 日志空 + 产物 mtime 没动」= 根本没跑，
      以及一次「错误被 `| tail` 切掉、exit 码是 tail 的」。三条判据少一条就会把旧产物发出去。
    """
    mp = os.path.join(APP_DIST, "manifest.json")
    before = os.path.getmtime(mp) if os.path.isfile(mp) else 0
    log("· npm run build:app …")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    r = subprocess.run([npm, "run", "build:app"], cwd=ROOT, shell=False,
                       capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=1800)
    out = (r.stdout or "") + (r.stderr or "")
    if "Build failed" in out or ("ERROR" in out.upper() and "DONE" not in out):
        log(out[-2500:])
        die("构建报错（上面是尾部输出），不发")
    if "DONE" not in out:
        log(out[-1500:])
        die("构建没打出 DONE —— 当它没发生过（exit=%s）" % r.returncode)
    if not os.path.isfile(mp):
        die("构建说完成了，但没有 %s" % mp)
    if os.path.getmtime(mp) <= before:
        die("产物时间戳没动 —— 这次没重写 dist/build/app，别拿旧包发")
    log("   ✓ 构建完成，manifest.json 已更新")


def read_app_manifest():
    """从**构建产物**里拿 appid / versionName / versionCode。"""
    mp = os.path.join(APP_DIST, "manifest.json")
    if not os.path.isfile(mp):
        die("找不到 %s，先加 --build 或先跑 npm run build:app" % mp)
    d = json.load(io.open(mp, encoding="utf-8"))
    ver = d.get("version") or {}
    appid = str(d.get("id") or "")
    name = str(ver.get("name") or "")
    try:
        code = int(ver.get("code"))
    except (TypeError, ValueError):
        die("manifest.json 里 version.code 不是数字：%r" % ver.get("code"))
    if not appid or not name or code <= 0:
        die("manifest.json 缺字段：id=%r name=%r code=%r" % (appid, name, code))
    return appid, name, code


def make_wgt(code):
    """把 dist/build/app 打成 dist/wgt/app-<code>.wgt（zip，包内根要有 manifest.json）。"""
    if not os.path.isdir(APP_DIST):
        die("没有 %s" % APP_DIST)
    if not os.path.isfile(os.path.join(APP_DIST, "manifest.json")):
        die("包内根没有 manifest.json —— 这种包装了也不会被认")
    os.makedirs(WGT_DIR, exist_ok=True)
    local = os.path.join(WGT_DIR, "app-%d.wgt" % code)
    n = 0
    with zipfile.ZipFile(local, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, dns, fns in os.walk(APP_DIST):
            dns.sort()
            for fn in sorted(fns):
                p = os.path.join(dp, fn)
                z.write(p, os.path.relpath(p, APP_DIST).replace(os.sep, "/"))
                n += 1
    h = hashlib.sha256()
    with open(local, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    size = os.path.getsize(local)
    log("· 打包 %d 个文件 → %s（%.2f MB）" % (n, os.path.basename(local), size / 1048576.0))
    return local, h.hexdigest(), size, n


def write_manifest_local(manifest):
    os.makedirs(WGT_DIR, exist_ok=True)
    p = os.path.join(WGT_DIR, "app-version.json")
    with io.open(p, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(manifest, ensure_ascii=False, indent=1))
    return p


# ---------------- 远端 ----------------
def run(cli, cmd, timeout=120):
    _, out, err = cli.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", "ignore")
    e = err.read().decode("utf-8", "ignore")
    return out.channel.recv_exit_status(), o, e


def current_manifest(cli):
    code, o, _ = run(cli, "cat %s 2>/dev/null" % MANIFEST_REMOTE)
    if code != 0 or not o.strip():
        return None
    try:
        return json.loads(o)
    except ValueError:
        return {"wgtCode": -1, "_bad": True}     # 读不懂就别覆盖，先让人看


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true", help="先跑 npm run build:app")
    ap.add_argument("--url-prefix", default="",
                    help="wgt 的 https 访问前缀，例 https://v3jxc.duckdns.org/release")
    ap.add_argument("--notes", default="", help="弹框里给客户看的一句（别写内部术语）")
    ap.add_argument("--force", action="store_true",
                    help="客户端弹框不给「稍后」按钮（真要卡住旧版本时用）")
    ap.add_argument("--allow-same", action="store_true",
                    help="允许与现网清单同一个 versionCode 重发（默认拒绝）")
    ap.add_argument("--dry-run", action="store_true", help="只打印要做什么，不连服务器")
    a = ap.parse_args()

    prefix = (a.url_prefix or "").rstrip("/")
    if not a.dry_run:
        if not prefix:
            die("必须给 --url-prefix（wgt 的对外访问地址）。这台机器的域名/端口是你定的，脚本不猜")
        if not prefix.lower().startswith("https://"):
            die("--url-prefix 必须是 https：http 上被替换一个 wgt = 在客户机上执行任意代码")

    if a.build:
        build_app()
    appid, name, code = read_app_manifest()
    log("· 包身份 appid=%s  versionName=%s  versionCode=%d" % (appid, name, code))

    local, sha, size, nfiles = make_wgt(code)
    fname = "app-%d.wgt" % code
    url = (prefix + "/" + fname) if prefix else ("<未给url-prefix>/" + fname)

    manifest = {
        "appid": appid, "versionName": name, "versionCode": code,
        "wgtVersion": name, "wgtCode": code, "url": url,
        "sha256": sha, "size": size, "files": nfiles,
        "force": bool(a.force), "notes": a.notes or "", "t": int(time.time() * 1000),
    }

    if a.dry_run:
        log("   [dry-run] scp %s → %s/%s" % (os.path.basename(local), RELEASE_DIR, fname))
        log("   [dry-run] 写 %s = %s" % (MANIFEST_REMOTE, json.dumps(manifest, ensure_ascii=False)))
        log("✓ 演练完成（没连服务器）")
        return 0

    cli = sshtarget.connect()
    try:
        cur = current_manifest(cli)
        if cur is None:
            log("· 现网还没有过清单（第一次发布）")
        elif cur.get("_bad"):
            die("%s 不是合法 JSON —— 先人工看它，别覆盖" % MANIFEST_REMOTE)
        else:
            log("· 现网清单：versionCode=%s（%s）" % (cur.get("wgtCode"), cur.get("versionName")))
            prev = int(cur.get("wgtCode") or 0)
            if code < prev:
                die("versionCode 比现网小（%d < %d）：装了 wgt 的客户机不会降级，清单会永久不一致"
                    % (code, prev))
            if code == prev and not a.allow_same:
                die("versionCode 与现网相同（%d）：DCloud 会静默不装，客户点了没反应。"
                    "确实要重发同一个码就加 --allow-same" % code)

        run(cli, "mkdir -p %s" % RELEASE_DIR)
        with SCPClient(cli.get_transport()) as scp:
            scp.put(local, RELEASE_DIR + "/" + fname)

        # 逐字节核对：传了一半的包 = 客户机上装出半个应用
        st, o, e = run(cli, "sha256sum %s/%s" % (RELEASE_DIR, fname))
        if st != 0 or sha not in o:
            die("远端 wgt 的 sha256 与本地不一致：%s" % (o or e).strip()[:160])
        log("   ✓ wgt 已上传且 sha256 一致")

        tmp = "/tmp/jxc-app-version.json"
        with SCPClient(cli.get_transport()) as scp:
            scp.put(write_manifest_local(manifest), tmp)
        st, _, e = run(cli, "mv %s %s && test -f %s && echo WROTE"
                       % (tmp, MANIFEST_REMOTE, MANIFEST_REMOTE))
        if st != 0:
            die("清单没写进去：%s" % e.strip()[:160])
        log("   ✓ 清单已更新")

        # 两条本机探活：路由与 nginx 各是一条独立上线动作，没上线时这里会告诉我们
        _, o, _ = run(cli, "curl -s -m 8 -o /dev/null -w '%{http_code}' "
                           "http://127.0.0.1/api/v1/app-release")
        route_code = (o or "").strip()
        log("· 本机探 /api/v1/app-release → %s（404 = 云端那条路由还没上线）" % (route_code or "无响应"))
        _, o, _ = run(cli, "curl -s -m 8 -o /dev/null -w '%{http_code}' "
                           "http://127.0.0.1/release/" + fname)
        local_code = (o or "").strip()
        log("· 本机取 wgt → %s（200 才算 nginx 的 /release/ 已生效）" % (local_code or "无响应"))

        # ★★★ 拿**清单里那个对外地址**真取一次字节：
        #   `/release/x.wgt` 走新加的 location（对），但 `/商户码/release/x.wgt` 会被
        #   SPA 兜底成 index.html —— 状态码一样是 200，客户机上下载"成功"、安装才炸，
        #   报出来是一句看不懂的 plus 错误。所以前缀写错必须在发布这一刻就失败。
        _, o, _ = run(cli, "curl -sL -m 30 -o /dev/null -w '%{http_code} %{content_type} %{size_download}' "
                           + "'" + url + "'")
        parts = (o or "").split()
        good = (len(parts) >= 3 and parts[0] == "200"
                and "html" not in parts[1].lower() and abs(int(float(parts[2])) - size) <= 2048)
        if not good:
            die("清单里的地址取不到这个包：%s → %s（期望 200 + 非 html + %d 字节）。"
                "地址前缀写错（比如带了商户码）会被 SPA 兜底成 index.html，"
                "客户端下载到的是网页不是 wgt" % (url, o.strip() or "无响应", size))
        log("   ✓ 对外地址实测可下载：%s（%s）" % (url, o.strip()))

        log("\n✓ 已发布 %s（versionName=%s / code=%d）" % (fname, name, code))
        log("  客户端下一次回前台会问到（内部限流 6 小时一次，且失败不打扰）。")
        # ★ 两条提示要**按实测结果**说，不许无条件念一遍：
        #   都上线了还叫人去上线，就是在教人重复动生产。
        if (route_code or "").strip() != "200":
            log("  ★ 云端路由还没上线（刚探是 %s）：python ../进销存-云端后台源码/scripts/deploy_cloudapi.py --apply"
                % ((route_code or "").strip() or "无响应"))
        if (local_code or "").strip() != "200":
            log("  ★ nginx 的 /release/ 还没生效（刚探是 %s）："
                "python scripts/deploy.py --merchant shiwantongda --no-build（会 reload nginx）"
                % ((local_code or "").strip() or "无响应"))
    finally:
        cli.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
