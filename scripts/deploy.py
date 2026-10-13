#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
进销存-uniapp H5 部署（多商户版：一份构建 + 每商户一条软链）

服务器布局（2026-09-25 起）：
    /var/www/jxc-h5/
        builds/<buildid>/                真实文件。buildid = 产物内容哈希前 12 位
        builds/<buildid>.__manifest.txt   该构建的逐文件 sha256 清单（不在可访问路径内）
        tenants/<商户码> -> ../builds/<buildid>   每商户一条软链
        current          -> builds/<buildid>      根站 `/`（无商户前缀）用哪份构建
    /var/www/jxc-h5-backups/             历史整站备份（迁移前的平铺目录也挪到这里）

★ 为什么这么改：原来每次部署 `rm -rf /var/www/jxc-h5/*` 再上传，全站有个空窗，
  而且 `/yedian/`、`/shiwantongda/` 这类前缀路径根本不存在，任意路径都被
  `try_files ... /index.html` 兜成同一份 784 字节 HTML —— 于是
  `/yedian/assets/index-xxx.js` 返回 text/html，**打开就是白屏**。
  现在切换=改一条软链（原子），回滚=把软链指回旧构建，不重新构建也不动 nginx。

用法：
    python scripts/deploy.py --merchant yedian                    # 构建 + 发到 /yedian/
    python scripts/deploy.py --merchant yedian --no-build         # 用现有 dist
    python scripts/deploy.py --merchant yedian --dry-run          # 只打印要做的事，不写远端
    python scripts/deploy.py --merchant yedian --stage            # 只上传+建链，不碰 nginx
    python scripts/deploy.py --list                               # 谁指向哪份构建
    python scripts/deploy.py --merchant yedian --rollback <buildid|previous>
    python scripts/deploy.py --check                              # 连通性与服务状态

依赖：paramiko —— 必须用带这个包的解释器：
    C:/Users/24773/.workbuddy/binaries/python/envs/default/Scripts/python.exe
"""
import argparse
import base64
import hashlib
import io
import os
import posixpath
import re
import shlex
import subprocess
import sys
import tarfile
import time

try:  # 控制台是 GBK，打 ✓ 会 UnicodeEncodeError
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sshtarget  # noqa: E402

# ---------------- 线上坐标 ----------------
HOST = sshtarget.HOST
USER = sshtarget.USER
PORT = 80
# 云端 v3cloud 自己的解释器（回写 h5_state.json 用它，venv 里什么依赖都不需要）
CLOUD_PY = "/opt/v3cloud/venv/bin/python"

# 站点根：nginx 以 nginx 用户跑，读不了 /root，所以放 /var/www。
# /root/jxc-h5 是同一份的 bind mount（fstab），两个路径等价，仅用于提示。
WEB_ROOT = "/var/www/jxc-h5"
BUILDS = WEB_ROOT + "/builds"
TENANTS = WEB_ROOT + "/tenants"
CURRENT = WEB_ROOT + "/current"
BACKUP_ROOT = "/var/www/jxc-h5-backups"
NGINX_CONF = "/etc/nginx/conf.d/jxc-h5.conf"
SERVICE_NAME = "nginx"

ROOT_MERCHANT = "shiwantongda"   # 根站 `/` 归属的商户（老用户书签都是裸 IP）
KEEP_BUILDS = 5                  # 保留几份构建（被任何软链引用的永不删）
STALE_JS_BYTES = 100 * 1024      # 主 JS 小于这个体积就是拿到了 HTML 兜底页

# 商户码要进 nginx 正则与 URL，字符集收紧（首字符必须是字母）；
# 这些名字已被根站占用，不能再作商户码
MERCHANT_RE = re.compile(r"^[a-z][a-z0-9-]{1,29}$")
RESERVED = {"assets", "static", "index", "favicon", "robots", "builds",
            "tenants", "current", "api", "admin", "logs", "nginx"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist", "build", "h5")


def _resolve_node():
    """找到可用的 node 可执行文件。

    ★ 原来这里写死 `...\\node\\versions\\22.22.2-3\\node.exe`（2026-10-07 就是被它绊住的）：
      托管运行时升级成 22.22.2-6 之后，那条路径不存在，`subprocess.run` 抛
      `FileNotFoundError: [WinError 2]` —— 报错堆栈指向 subprocess，看起来像"构建失败"，
      实际是**工具链路径过期**。写死版本号迟早会再撞一次，所以改成按优先级解析。
        env NODE  >  PATH 上的 node  > 托管目录里版本号最大的一个
    """
    env_node = os.environ.get("NODE")
    if env_node and os.path.exists(env_node):
        return env_node
    from shutil import which
    on_path = which("node")
    if on_path:
        return on_path
    base = os.path.join(os.path.expanduser("~"), ".workbuddy", "binaries", "node", "versions")
    cands = []
    for d in os.listdir(base) if os.path.isdir(base) else []:
        exe = os.path.join(base, d, "node.exe")
        if os.path.exists(exe):
            cands.append((d, exe))
    # 版本号按数字段排序取最大；'current' 之类的软链名排最后
    cands.sort(key=lambda kv: [int(x) for x in re.findall(r"\d+", kv[0])] or [-1])
    return cands[-1][1] if cands else "node"


NODE = _resolve_node()

DRY = False


def log(msg):
    print(msg, flush=True)


def step(msg):
    log("\n" + "=" * 56)
    log("  " + msg)
    log("=" * 56)


# ---------------- SSH ----------------
_CONN = {"cli": None}


def _alive(cli):
    return cli is not None and cli.get_transport() is not None and cli.get_transport().is_active()


def connect():
    """进程内复用同一条 SSH 连接；已经断了就换一条新的。"""
    if _alive(_CONN["cli"]):
        return _CONN["cli"]
    _CONN["cli"] = sshtarget.connect()
    return _CONN["cli"]


def run(cli, cmd, timeout=300, quiet=True):
    """远程命令（dry-run 也照跑，用来取现状）。连接被掐就重连重试一次。

    ★ 为什么要有这段：2026-10-12 深夜这条链（开发机 → 149.88.75.125:22）
      在半路复位两次（WinError 10054 / 发完等不到 confirm），
      但同一时刻几 KB 的小命令全通 —— 坏的是"持续大字节流"，不是连接本身。
      所以对症的是**命令级重连 + 上传分块**（见 put_file_chunked），
      而不是"整场发布失败后让人再跑一遍"。
    """
    for attempt in (0, 1):
        c = cli if (attempt == 0 and _alive(cli)) else connect()
        try:
            _, out, err = c.exec_command(cmd, timeout=timeout)
            o = out.read().decode("utf-8", "ignore")
            e = err.read().decode("utf-8", "ignore")
            code = out.channel.recv_exit_status()
        except Exception as ex:
            if attempt:
                raise
            log("   ! 连接断了(%s)，重连后重试这一条命令" % type(ex).__name__)
            continue
        _CONN["cli"] = c
        break
    if not quiet and o.strip():
        for line in o.strip().split("\n")[:60]:
            log("   " + line)
    if code != 0 and e.strip() and not quiet:
        log("   [stderr] " + e.strip()[:800])
    return code, o, e


def write_remote(cli, cmd, note, timeout=300):
    """会改远端状态的命令。--dry-run 时只打印。"""
    if DRY:
        log("   [dry-run] " + note)
        return 0, "", ""
    code, o, e = run(cli, cmd, timeout=timeout)
    if code != 0:
        log("   ✗ %s（exit %d）%s" % (note, code, (e or o).strip()[:400]))
    return code, o, e


def put_text(cli, path, text, note):
    """写远端文本文件：先落 .new 再 mv，避免中途出现半份文件"""
    b64 = base64.b64encode(text.encode("utf-8")).decode()
    tmp = path + ".new"
    code, _, _ = write_remote(
        cli, f"printf %s '{b64}' | base64 -d > {tmp} && mv -f {tmp} {path} && echo WROTE", note)
    return code == 0


def remote_size(cli, path):
    """远端文件当前字节数；文件不存在返回 -1。"""
    code, o, _ = run(cli, f"wc -c < {path} 2>/dev/null || echo -1")
    try:
        return int(o.strip().split()[-1])
    except (ValueError, IndexError):
        return -1


def put_file_chunked(cli, local_path, remote_path, chunk=12288, tries=4):
    """分块 base64 追加上传一份本地文件，每块落地后拿远端字节数对一次数。

    ★ 为什么不用 scp（2026-10-12 深夜）：`SCPClient.put` 连着死在**半路**两次，
      一次 WinError 10054 连接复位、一次发完了等不到 confirm 超时；
      而同一时刻同一台机上几 KB 的 exec 命令全通（nginx 配置就是那时候写进去的）。
      坏的是"一条通道上持续大块写"，不是连接本身 ⇒ 把一次 404KB 的写拆成
      几十条 12KB 的小命令，每条都走 run() 的重连逻辑。
    ★ 掉线那一块不许"接着猜"：字节数对不上就把 .b64 截回上一个已知好长度
      （`head -c`）再重发这一块；整份文件最后比一次 sha256，
      对不上直接 False —— 绝不拿半成品去解压。
    """
    raw = open(local_path, "rb").read()
    b64 = base64.b64encode(raw).decode()
    parts = [b64[i:i + chunk] for i in range(0, len(b64), chunk)]
    staging = remote_path + ".b64"
    code, _, _ = run(cli, f": > {staging} && echo OPEN_OK")
    if code != 0:
        log("   ✗ 建临时文件失败")
        return False
    good = 0
    for i, part in enumerate(parts):
        expect = good + len(part)
        for attempt in range(tries):
            run(cli, "printf %%s '%s' >> %s" % (part, staging))
            if remote_size(cli, staging) == expect:
                good = expect
                break
            log("   ! 第 %d/%d 块没对上（期望 %d），截回好长度重发"
                % (i + 1, len(parts), expect))
            run(cli, "head -c %d %s > %s.cut && mv -f %s.cut %s"
                       % (good, staging, staging, staging, staging))
        else:
            log("   ✗ 第 %d/%d 块重传 %d 次仍失败，放弃本次上传" % (i + 1, len(parts), tries))
            run(cli, f"rm -f {staging}")
            return False
        if (i + 1) % 10 == 0 or i + 1 == len(parts):
            log("   已传 %d KB / %d KB" % (good * 3 // 4 // 1024, len(raw) // 1024))
    code, o, _ = run(cli, "base64 -d %s > %s && rm -f %s && sha256sum %s | cut -d' ' -f1"
                          % (staging, remote_path, staging, remote_path))
    if code != 0:
        log("   ✗ 解码失败 " + o.strip()[:200])
        return False
    want = hashlib.sha256(raw).hexdigest()
    if o.strip() != want:
        log("   ✗ 整份 sha256 不符 期望 %s 实得 %s" % (want[:12], o.strip()[:12]))
        run(cli, f"rm -f {remote_path}")
        return False
    log("   ✓ 分块上传完成，整份 sha256 一致")
    return True




# ---------------- 本地构建 ----------------
def build():
    step("本地构建")
    cli_js = os.path.join(ROOT, "node_modules", "@dcloudio",
                          "vite-plugin-uni", "bin", "uni.js")
    if not os.path.exists(cli_js):
        log("   ✗ 找不到 uni.js，请先 npm install")
        return False
    log("   执行 uni build ...")
    log("   node = " + NODE)
    # ★ 超时给到 30 分钟：安全沙箱里跑 vite 偶发极慢（实测同一条命令
    #   直跑 13 秒、经此脚本卡过 600 秒），600s 会误报构建失败。
    try:
        # ★ encoding 必须显式给：控制台默认 GBK，vite 输出里的中文/符号会让
        #   capture 的读线程直接 UnicodeDecodeError（表现为"构建失败"，其实构好的产物是好的）
        r = subprocess.run([NODE, cli_js, "build"], cwd=ROOT, shell=False,
                           capture_output=True, text=True, timeout=1800,
                           encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        log("   ✗ 构建超时（1800s）—— 建议先手动跑一次 uni build，再用 --no-build 上传")
        return False
    except OSError as e:
        # ★ node 可执行文件不在（路径过期/未安装）会抛 FileNotFoundError，
        #   原来没接住 ⇒ 脚本以原生堆栈崩在 subprocess 里，看着像"构建失败"，
        #   实际与产物无关（2026-10-07 就是这么浪费了一轮）。
        log("   ✗ 无法启动 node（%s）: %s" % (NODE, e))
        log("     装一个 node，或设环境变量 NODE=<node.exe 绝对路径> 后重试")
        return False
    for line in (r.stdout or "").strip().split("\n")[-6:]:
        log("   " + line)
    if r.returncode != 0 or "Build complete" not in (r.stdout or ""):
        log("   ✗ 构建失败")
        if r.stderr:
            log("   " + r.stderr.strip()[:1200])
        return False
    log("   ✓ 构建成功")
    return True


def sanity_check_dist():
    """上传前先自查产物：新主色必须在，已删组件不能残留"""
    step("产物自查")
    if not os.path.isdir(DIST):
        log("   ✗ 找不到 " + DIST)
        return False
    files = [os.path.join(b, n) for b, _, ns in os.walk(DIST) for n in ns]
    if not any(f.endswith("index.html") for f in files):
        log("   ✗ 产物里没有 index.html")
        return False
    css = [f for f in files if f.endswith(".css")]
    has_new = any("#1677ff" in io.open(f, encoding="utf-8", errors="ignore").read().lower()
                  for f in css)
    log(f"   文件数: {len(files)}   CSS: {len(css)}")
    log(f"   含新主色 #1677ff: {'是' if has_new else '否'}")
    if not has_new:
        log("   ✗ 产物不含新主色，可能构建未生效")
        return False
    stale = [f for f in files if any(
        k in os.path.basename(f) for k in ("StatCard", "FilterTabs", "SectionCard", "workbench"))]
    if stale:
        log(f"   ✗ 发现已删除组件的残留: {[os.path.basename(x) for x in stale][:6]}")
        return False
    log("   ✓ 产物自查通过")
    return True


# ---------------- 产物指纹 ----------------
def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def local_manifest():
    """{相对路径: sha256} + 一个覆盖全树的 digest（内容不变 → id 不变）"""
    step("计算产物指纹")
    files = {}
    total = 0
    for base, _, names in os.walk(DIST):
        for n in names:
            p = os.path.join(base, n)
            rel = os.path.relpath(p, DIST).replace(os.sep, "/")
            files[rel] = sha256_file(p)
            total += os.path.getsize(p)
    joined = "\n".join("%s %s" % (k, files[k]) for k in sorted(files))
    digest = hashlib.sha256(joined.encode()).hexdigest()
    log(f"   文件 {len(files)} 个 / {total/1024/1024:.2f} MB / 指纹 {digest[:12]}")
    return files, digest[:12], total


def manifest_text(files, build_id, total):
    lines = ["# build %s  files %d  bytes %d" % (build_id, len(files), total)]
    lines += ["%s %s" % (files[k], k) for k in sorted(files)]
    return "\n".join(lines) + "\n"


def parse_manifest(text):
    files = {}
    for line in text.split("\n"):
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and re.match(r"^[0-9a-f]{64}$", parts[0]):
            files[parts[1]] = parts[0]
    return files


def remote_manifest(cli, build_id):
    code, o, _ = run(cli, f"cat {BUILDS}/{build_id}.__manifest.txt 2>/dev/null")
    return parse_manifest(o) if code == 0 and o.strip() else None


def remote_build_ids(cli):
    """[(buildid, mtime)] 按时间倒序。只认 12 位十六进制的目录。"""
    code, o, _ = run(cli, f"find {BUILDS} -mindepth 1 -maxdepth 1 -type d "
                          "-printf '%T@ %f\\n' 2>/dev/null")
    out = []
    for line in o.split("\n"):
        parts = line.split()
        if len(parts) == 2 and re.match(r"^[0-9a-f]{12}$", parts[1]):
            out.append((parts[1], float(parts[0])))
    return sorted(out, key=lambda x: -x[1])


# ---------------- 上传一份构建 ----------------
def ensure_layout(cli):
    step("服务器布局")
    for d, why in ((BUILDS, "构建目录"), (TENANTS, "商户软链目录"), (BACKUP_ROOT, "备份根目录")):
        write_remote(cli, f"mkdir -p {d} && chown root:nginx {d} 2>/dev/null; "
                          f"chmod 755 {d}", f"确保 {d} 存在（{why}）")
    code, o, _ = run(cli, f"test -e {WEB_ROOT}/index.html && echo FLAT || echo MIGRATED")
    if o.strip() == "FLAT":
        log("   ! 仍是旧的平铺布局，本次部署会把它挪进备份后再切换根站")
    else:
        log("   布局已是 builds/+tenants/")
    return o.strip() == "FLAT"


def make_tarball(build_id):
    tar_path = os.path.join(ROOT, "dist", "_deploy_h5_%s.tar.gz" % build_id)
    with tarfile.open(tar_path, "w:gz") as tf:
        for name in os.listdir(DIST):
            tf.add(os.path.join(DIST, name), arcname=name)
    log(f"   已打包 {os.path.basename(tar_path)} ({os.path.getsize(tar_path)/1024:.0f} KB)")
    return tar_path


def upload_build(cli, files, build_id, total):
    dest = posixpath.join(BUILDS, build_id)
    if remote_manifest(cli, build_id) == files:
        log(f"   ✓ builds/{build_id} 已存在且逐文件一致 → 跳过上传")
        return True
    tmp = posixpath.join(BUILDS, ".tmp-%s-%d" % (build_id, int(time.time())))
    tar_path = make_tarball(build_id)
    remote_tar = f"/tmp/_deploy_h5_{build_id}.tar.gz"
    log(f"   上传 {os.path.getsize(tar_path)/1024:.0f} KB 到 {tmp} ...")
    if DRY:
        log("   [dry-run] 分块上传 + 解压 + 逐文件 sha256 校验 + 落位 builds/%s" % build_id)
        os.remove(tar_path)
        return True
    if not put_file_chunked(cli, tar_path, remote_tar):
        return False
    os.remove(tar_path)
    code, _, _ = write_remote(
        cli, f"rm -rf {tmp}; mkdir -p {tmp} && tar -xzf {remote_tar} -C {tmp} "
             f"&& rm -f {remote_tar} && echo EXTRACT_OK", f"解压到 {tmp}")
    if code != 0:
        return False

    # 逐文件 sha256 比对：数量一致不等于内容一致（历史上真踩过传了一半）
    _, o, _ = run(cli, f"cd {tmp} && find . -type f -print0 | xargs -0 sha256sum")
    got = {}
    for line in o.split("\n"):
        parts = line.strip().split(None, 1)
        if len(parts) == 2:
            got[parts[1].lstrip("./")] = parts[0]
    miss = sorted(k for k in files if k not in got)
    diff = sorted(k for k in files if k in got and got[k] != files[k])
    extra = sorted(k for k in got if k not in files)
    if miss or diff or extra:
        log(f"   ✗ 解压结果与本地不符 缺{len(miss)} 异{len(diff)} 多{len(extra)}"
            f" 例:{(miss + diff + extra)[:5]}")
        write_remote(cli, f"rm -rf {tmp}", f"清理失败暂存 {tmp}")
        return False
    log(f"   ✓ 逐文件 sha256 全部一致（{len(got)} 个文件）")

    write_remote(cli, f"chown -R root:nginx {tmp} 2>/dev/null; "
                      f"find {tmp} -type d -exec chmod 755 {{}} \\; ; "
                      f"find {tmp} -type f -exec chmod 644 {{}} \\; ; echo PERM_OK",
                 "nginx 用户可读权限")
    put_text(cli, posixpath.join(BUILDS, "%s.__manifest.txt" % build_id),
             manifest_text(files, build_id, total), f"写清单 {build_id}.__manifest.txt")
    code, _, _ = write_remote(
        cli, f"test ! -e {dest} && mv {tmp} {dest} && echo PLACED",
        f"落位 {tmp} -> {dest}")
    return code == 0


# ---------------- 软链切换 ----------------
def link_target(cli, path):
    code, o, _ = run(cli, f"readlink {path} 2>/dev/null")
    return o.strip()


def switch_link(cli, path, rel_target):
    """原子换链：先建临时软链再 mv -T 覆盖（直接 ln -sfn 有个 unlink 空窗）"""
    tmp = path + ".__swap"
    code, _, _ = write_remote(
        cli, f"cd {posixpath.dirname(path)} && rm -f {posixpath.basename(tmp)} "
             f"&& ln -s {rel_target} {posixpath.basename(tmp)} "
             f"&& mv -Tf {posixpath.basename(tmp)} {posixpath.basename(path)} && echo SWAPPED",
        f"{path} -> {rel_target}")
    if code != 0:
        return False
    if not DRY:
        got = link_target(cli, path)
        if got != rel_target:
            log(f"   ✗ 换链后 readlink={got!r} 期望 {rel_target!r}")
            return False
    return True


def referenced_builds(cli):
    refs = set()
    _, o, _ = run(cli, f"for l in {TENANTS}/*; do test -L $l && readlink $l; done; "
                       f"test -L {CURRENT} && readlink {CURRENT}")
    for line in o.split("\n"):
        m = re.search(r"builds/([0-9a-f]{12})", line.strip())
        if m:
            refs.add(m.group(1))
    return refs


def prune_builds(cli, keep):
    """删多余构建。★★ 两条规矩都是这次踩出来的，别改回去：
      1) `remote_build_ids` 是**新→旧**，而 `ids[keep:]` 那种"从头部取"的写法
         会先删掉刚被接替的那一份 —— 也就是**唯一的回滚位**，
         留着 09-26 那些没用的旧包。2026-09-27 发 H5 时就把 `4408e794b895` 这么烧了，
         `--rollback previous` 当场只能退到前天那份。
      2) 所以：**最新那份"未被引用"的构建 = 回滚位，保留策略再紧也不许删它**；
         要删从最旧的开始删。
    """
    refs = referenced_builds(cli)
    ids = remote_build_ids(cli)                      # [(id, mtime)] 新→旧
    log(f"   现存构建 {len(ids)} 份，被引用 {sorted(refs)}")
    unref = [b for b, _ in ids if b not in refs]
    rollback_slot = unref[:1]                        # 最新那份未引用的，留着能回滚
    candidates = list(reversed(unref[len(rollback_slot):]))   # 其余的，旧→新
    doomed = candidates[: max(0, len(ids) - keep)]
    for b in doomed:
        write_remote(cli, f"rm -rf {BUILDS}/{b} {BUILDS}/{b}.__manifest.txt",
                     f"清理旧构建 {b}")
    if doomed:
        log("   已清理: " + ", ".join(doomed))
    if rollback_slot:
        log(f"   回滚位保留: {rollback_slot[0]}（--rollback {rollback_slot[0]} 可退回去）")
    write_remote(cli, f"find {BUILDS} -maxdepth 1 -name '.tmp-*' -mtime -1 -prune "
                      f"-o -maxdepth 1 -name '.tmp-*' -exec rm -rf {{}} \\; ; echo CLEAN",
                 "清理超期暂存目录")


# ---------------- nginx ----------------
DOMAIN = os.environ.get("JXC_DOMAIN", "v3jxc.duckdns.org")
TLS_DIR = "/etc/nginx/ssl/v3jxc"
API_UPSTREAM = "http://127.0.0.1:8000"


def tls_state(cli):
    """证书在不在、过没过期 —— 决定这份配置里带不带 443 那一块。

    ★ 为什么"没证书就不写 443"而不是写上去让 nginx 报错：
      证书被误删/续期失败时，下一次部署如果照写 443，`nginx -t` 会失败 ⇒
      整份配置回滚、连**静态站**都发不出去。少一个 https 入口是可以接受的降级，
      把发布链路一起带死不行。
    """
    code, out, _ = run(cli, "test -f %s/fullchain.pem -a -f %s/privkey.pem "
                            "&& openssl x509 -checkend 0 -noout -in %s/fullchain.pem "
                            ">/dev/null 2>&1 && echo READY || echo MISSING"
                        % (TLS_DIR, TLS_DIR, TLS_DIR))
    return "READY" in (out or "")


def _static_body():
    """静态站那套 location（80 与 443 共用一份，绝不抄两遍）。

    ★ 三条硬约束（都源自 2026-09-25 的白屏事故）：
      1) 商户的 assets 找不到就 =404，绝不能回落到 index.html（那会让 .js 变成 text/html）；
      2) SPA 兜底只兜到**本商户**的 index.html，未知商户码直接 404，绝不兜到别家；
      3) `/码`（缺尾斜杠）必须 301 到 `/码/`：index.html 里引的是相对 `./assets/…`，
         缺斜杠时基准目录变成上一层，资源又落回根站 → 换一种形式继续白屏。
    """
    return """
    # ---- 根站：裸 IP 无商户前缀，走 current 这条链（与改造前一致）----
    # ★ ^~ 是为了让 /assets/、/static/ 不被下面的商户正则抢走：
    #   否则 /assets/x.js 会被当成「商户 assets 下的资源」而去 tenants/ 里找 → 404。
    location ^~ /assets/ {
        root %(webroot)s/current;
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # 产物里 tabBar 图标是绝对路径 /static/tabbar/*.png（uni 从 pages.json 原样带出，
    # 不随 base:"./" 变相对），所以根站这份必须一直在，商户页的图标才拿得到。
    location ^~ /static/ {
        root %(webroot)s/current;
        expires 7d;
        add_header Cache-Control "public";
        try_files $uri =404;
    }

    # App 端 wgt 热更包（`scripts/publish-wgt.py` 传上来）。
    #   ★ 为什么单独一个目录而不是塞进 builds/：builds/<id> 是**内容寻址、只读**的一份前端产物，
    #     而 wgt 是"当前可更新的这一版"，它要跨构建稳定存在；放进 builds/ 会让下一次发布把它一起换掉。
    #   root 指 webroot 本身（不是 current），所以 /release/app-113.wgt → <webroot>/release/app-113.wgt。
    #   不给 expires：清单里换了新文件名自然就是新地址，旧文件留着是为了回滚。
    location ^~ /release/ {
        root %(webroot)s;
        try_files $uri =404;
    }

    # 根站交付应用本体，但**零数据由应用自己保证**（2026-09-29 重定）。
    #   这里曾一度改成"回一份『这个地址不带商户码』的说明页"，随即撤掉：
    #   商户身份的唯一来源已经改成"设置页里填的那条链接"（URL 前缀不再绑定身份），
    #   所以裸域名打开本来就该是登录页 + 「未设置连接」，而不是一页 nginx 文案 ——
    #   人到了该填的地方，比读到一段解释更有用。
    #   ★ 上面两条 ^~ /assets/ 与 ^~ /static/ 必须继续供：商户页的 chunk 与 tabBar 图标
    #     都从根站这一份取（产物里图标是绝对路径），摘掉它们会把商户页一起弄坏。
    location / {
        root %(webroot)s/current;
        try_files $uri $uri/ /index.html =404;
    }

    # ACME http-01：必须放在下面那条 `~ /\\.` 的 deny 之前并由 ^~ 抢先匹配，
    # 否则 /.well-known/… 被 deny ⇒ 证书永远签不下来（这条是踩过的坑）。
    location ^~ /.well-known/acme-challenge/ {
        root %(webroot)s;
        try_files $uri =404;
    }

    # 隐藏文件先 deny，否则会被下面的商户正则块接走（try_files 兜成 index.html）
    location ~ /\\. { deny all; }

    # ---- 商户前缀：/<商户码>/... ----
    location ~ "^/(?<c1>[a-z0-9_-]+)$" {
        return 301 /$c1/;
    }

    location ~ "^/(?<c2>[a-z0-9_-]+)/(?:assets|static)/" {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # 最后一个参数 =404 是关键：它让"该商户目录的 index.html 不存在"（=未知商户码）
    # 直接 404，而不是兜到根站或别家去。
    #
    # ★ 但**带扩展名的资源**要单独一条挡在前面（2026-10-12）：`/商户码/release/x.wgt`
    #   这种路径不存在时会被下面那条兜成 `/$c3/index.html` ⇒ **200 + 一段 HTML**。
    #   App 端下载 wgt 时拿到的就是这种"看着成功、其实是个网页"的响应，
    #   表现是安装失败或装了个空包，比直接 404 难查十倍。
    #   ★ 这里必须写成 `.*\\.[A-Za-z0-9]+$` 而不是 `[^/]*\\.[A-Za-z0-9]+$`：
    #     后者只挡**一层**路径，`/shiwantongda/release/x.wgt`（两层）实测照样兜成 200 HTML，
    #     而 wgt 的真实地址恰恰就是带 `release/` 这一层的 —— 写错等于没修。
    #     锚在 `$` 上，所以 `/shiwantongda/sales/detail`（路由末段无点）不受影响。
    location ~ "^/[a-z0-9_-]+/.*\\.[A-Za-z0-9]+$" {
        try_files $uri =404;
    }

    location ~ "^/(?<c3>[a-z0-9_-]+)/" {
        try_files $uri $uri/ /$c3/index.html =404;
    }
""" % {"webroot": WEB_ROOT}


def _api_body(admin=False):
    """把云端 API 与 Agent 的 ws 反代到本机 8000。

    ★ `admin=False`（http 那条）只放 `/api/v1` 与 `/ws`，**不放 `/api/admin`**：
      后台那一页现在是明文直出凭据的，只让它走 https。业务口两边都给，
      这样 H5 端 `BASE_URL` 可以统一取"当前 origin"（http://IP 和 https://域名
      同一条规则），少一个"这个环境要特殊配"的分支 —— 分支越少，串环境事故越少。
    """
    head = """
    # ★ 必须 `^~`：下面商户前缀那条正则 `^/([a-z0-9_-]+)/` 会把 `/api/v1/...` 也匹配走
    #   （"api" 正好长得像商户码），非 ^~ 的前缀块会被正则抢掉 ⇒ 接口全变 404。
    #   2026-09-26 加反代时就是这么撞上的，与 /assets 那条同一个坑。
    location ^~ /api/v1/ {
        proxy_pass %s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 8m;
        # 报表那条链云端给的是 180s；read_timeout 必须比它大，
        # 否则 nginx 先掐，客户看到的是 502 而不是云端的 504 + 那句"查询超时了"。
        proxy_connect_timeout 10s;
        proxy_read_timeout 240s;
        proxy_send_timeout 240s;
    }

    # 客户机 Agent 的长连接（将来 relay_url 换成 wss://<域名>/ws/agent 就走这里）
    location ^~ /ws/ {
        proxy_pass %s;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
""" % (API_UPSTREAM, API_UPSTREAM)
    if not admin:
        return head
    return head + """
    location ^~ /api/admin/ {
        proxy_pass %s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 240s;
    }
""" % API_UPSTREAM


def render_nginx(tls=False):
    """一份配置里三块：域名 80（跳 https + 接 ACME）、域名 443（全站 + 全量 API）、
    裸 IP 80（default_server，老书签不能变）。静态 location 只有一份。"""
    head = ("# 由 进销存-uniapp/scripts/deploy.py 生成，请勿手改（改了会被下次部署覆盖）\n"
            "# 多商户布局： root 指向 tenants/<商户码> -> ../builds/<buildid>\n")
    domain80 = """
server {
    listen 80;
    server_name %(domain)s;

    # ACME 要能拿到（不能先 301 走）
    location ^~ /.well-known/acme-challenge/ {
        root %(webroot)s;
        try_files $uri =404;
    }
    location / { return 301 https://$host$request_uri; }
}
""" % {"domain": DOMAIN, "webroot": WEB_ROOT}
    server443 = """
server {
    listen 443 ssl;
    server_name %(domain)s;

    ssl_certificate     %(tlsdir)s/fullchain.pem;
    ssl_certificate_key %(tlsdir)s/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:JXC:10m;
    ssl_session_timeout 30m;

    root %(tenants)s;
    index index.html;
    access_log /var/log/nginx/jxc-h5-tls.access.log;
    error_log  /var/log/nginx/jxc-h5-tls.error.log;
    gzip on;
    gzip_min_length 1k;
    gzip_comp_level 5;
    gzip_types text/plain text/css application/json application/javascript
               text/javascript image/svg+xml;
    gzip_vary on;
%(static)s%(api)s}
""" % {"domain": DOMAIN, "tlsdir": TLS_DIR, "tenants": TENANTS,
           "static": _static_body(), "api": _api_body(admin=True)}
    ip80 = """
server {
    listen %(port)s default_server;
    server_name _;

    root %(tenants)s;
    index index.html;

    access_log /var/log/nginx/jxc-h5.access.log;
    error_log  /var/log/nginx/jxc-h5.error.log;

    gzip on;
    gzip_min_length 1k;
    gzip_comp_level 5;
    gzip_types text/plain text/css application/json
               application/javascript text/javascript
               application/x-javascript image/svg+xml;
    gzip_vary on;
%(static)s%(api)s}
""" % {"port": PORT, "tenants": TENANTS, "static": _static_body(),
           "api": _api_body(admin=False)}
    return head + ip80 + (domain80 + server443 if tls else "")


def nginx_test_rendered(cli, conf_text):
    """
    把待写的配置塞进一份独立的最小配置里跑 `nginx -t -c`，
    只在 /tmp 下建临时目录、跑完即删 —— 不碰 /etc/nginx、不 reload。
    ★ 为什么必须单独做：--dry-run 时若只跑现行配置的 nginx -t，等于拿旧配置
      给新模板背书（假成功）。
    """
    b64 = base64.b64encode(conf_text.encode("utf-8")).decode()
    inner = ("pid $D/nginx.pid;\n"
             "events {}\n"
             "http {\n"
             "  include /etc/nginx/mime.types;\n"
             "  default_type application/octet-stream;\n"
             "  access_log $D/access.log;\n"
             "  include $D/conf.d/*.conf;\n"
             "}\n")
    # 两份文件都走 base64：内层配置里带 $D 和花括号，塞进 shell 引号里迟早出事
    b64inner = base64.b64encode(inner.replace("$D", "/TMPPID").encode()).decode()
    cmd = ("D=$(mktemp -d /tmp/jxc-nginx-dry.XXXXXX) && "
           f"mkdir -p $D/conf.d && printf %s '{b64}' | base64 -d > $D/conf.d/jxc-h5.conf && "
           f"printf %s '{b64inner}' | base64 -d | sed \"s|/TMPPID|$D|g\" > $D/nginx.conf && "
           "nginx -t -c $D/nginx.conf 2>&1; RC=$?; rm -rf $D; exit $RC")
    code, o, e = run(cli, cmd)
    out = (o + e).strip()
    return code == 0 and "successful" in out, out


def setup_nginx(cli):
    step("nginx 站点配置")
    code, o, _ = run(cli, "which nginx && nginx -v 2>&1")
    if code != 0:
        log("   ✗ 未检测到 nginx（本项目不会自动装，请先人工确认）")
        return False
    log("   " + o.strip().replace("\n", " / "))

    tls = tls_state(cli)
    log("   证书：%s" % ("已就绪 → 配置里带 443 与 https 入口" if tls
                        else "还没签/已过期 → 只写 80（签完再跑一次就会带上 443，不会把发布卡死）"))
    want = render_nginx(tls=tls)
    _, have, _ = run(cli, f"cat {NGINX_CONF} 2>/dev/null")
    if have == want:
        log("   配置未变化 → 不重写、不 reload")
        return True
    # 先在独立最小配置里验一遍新模板：不通过就绝不碰 /etc/nginx
    ok_t, out = nginx_test_rendered(cli, want)
    log("   新模板独立语法校验: " + ("通过 ✓" if ok_t else "失败 ✗"))
    if not ok_t:
        log("   " + out[:900])
        return False
    if DRY:
        log("   [dry-run] 将要写入的配置全文：")
        for line in want.split("\n"):
            log("   | " + line)
        log("   [dry-run] 不写 /etc/nginx、不 reload")
        return True
    ts = time.strftime("%Y%m%d-%H%M%S")
    if have.strip():
        write_remote(cli, f"cp -a {NGINX_CONF} {NGINX_CONF}.bak-{ts} && echo BACKUP_OK",
                     f"备份现有配置到 {NGINX_CONF}.bak-{ts}")
    if not put_text(cli, NGINX_CONF, want, f"写入 {NGINX_CONF}"):
        return False
    code, o, _ = run(cli, "nginx -t 2>&1")
    if "successful" not in o:
        log("   ✗ 配置校验失败，还原旧配置且不 reload：")
        log("   " + o[:600])
        write_remote(cli, f"cp -a {NGINX_CONF}.bak-{ts} {NGINX_CONF}", "还原 nginx 配置")
        return False
    log("   配置语法校验通过 ✓")
    run(cli, "systemctl enable nginx 2>/dev/null")
    code, _, _ = write_remote(cli, "systemctl reload nginx 2>&1 || systemctl restart nginx 2>&1",
                              "reload nginx")
    time.sleep(1 if not DRY else 0)
    _, o, _ = run(cli, f"systemctl is-active {SERVICE_NAME}")
    log("   nginx 状态: " + o.strip())
    if o.strip() != "active":
        run(cli, "tail -20 /var/log/nginx/jxc-h5.error.log 2>/dev/null", quiet=False)
        return False
    _, o, _ = run(cli, f"systemctl is-enabled {SERVICE_NAME}")
    log("   开机自启: " + o.strip())
    return True


# ---------------- 校验 ----------------
def curl_headers(cli, url):
    """在服务器本机 curl（绕开本机出口 IP 被云端防火墙拦的情况），返回响应头 dict"""
    _, o, _ = run(cli, f"curl -sI -m 10 '{url}' | tr -d '\\r'")
    status, h = "", {}
    for line in o.split("\n"):
        if line.startswith("HTTP/"):
            parts = line.split()
            if len(parts) > 1:
                status = parts[1]
        elif ":" in line:
            k, v = line.split(":", 1)
            h[k.strip().lower()] = v.strip()
    h["status"] = status
    h["length"] = int(h.get("content-length", "") or 0)
    h["type"] = h.get("content-type", "")
    return h


def verify_prefix(cli, prefix, label):
    """
    白屏判据（2026-09-25 事故的直接反证）：
      页面 HTML 引来的每个 .js 都必须真的是 application/javascript 且体积够大；
      一旦拿到 text/html，说明该路径没落进商户目录、被兜底成了 index.html。
    """
    base = f"http://127.0.0.1:{PORT}{prefix}"
    _, html, _ = run(cli, f"curl -s -m 10 '{base}'")
    assets = re.findall(r'(?:src|href)="(\./[^"]+)"', html)
    log(f"   {label} {prefix}  HTML {len(html)}B  页内资源 {len(assets)} 个")
    ok = 'id="app"' in html and bool(assets)
    if not ok:
        log("     ✗ 首页里没有 #app 或没有任何 ./assets 引用")
    for a in assets:
        # a 形如 ./assets/x.js，去掉 "./" 再拼到本前缀下（拼错会造出 //assets 双斜杠，
        # 那就落到别的 location 块里，测出来的东西不是浏览器拿到的东西）
        url = f"http://127.0.0.1:{PORT}{prefix}{a[2:]}"
        h = curl_headers(cli, url)
        bad = (h["status"] != "200"
               or (a.endswith(".js") and ("javascript" not in h["type"]
                                         or h["length"] < STALE_JS_BYTES))
               or (a.endswith(".css") and "text/css" not in h["type"]))
        log(f"     {'✗' if bad else '✓'} {prefix}{a[2:]}  "
            f"{h['status']} {h['type']} {h['length']}B")
        ok = ok and not bad
    return ok


def url_path(loc):
    """`return 301 /码/` 时 nginx 给的 Location 是**绝对 URL**（http://host/码/），
    所以要取路径部分再比，直接比字符串会把对的判成错的。"""
    if "://" in loc:
        rest = loc.split("://", 1)[1]
        loc = "/" + rest.split("/", 1)[1] if "/" in rest else "/"
    return loc


def verify_serving(cli, merchant, check_root):
    step("线上校验（服务器本机 curl）")
    if DRY:
        log("   [dry-run] 还没真发布，跳过校验（发布后跑 check-deploy-matrix.py）")
        return True
    ok = True
    if check_root:
        ok &= verify_prefix(cli, "/", "根站")
        # 根站的 /static/ 必须一直在：产物里 tabBar 图标是绝对路径 /static/tabbar/*.png
        h = curl_headers(cli, f"http://127.0.0.1:{PORT}/static/tabbar/home.png")
        good = h["status"] == "200" and "image" in h["type"]
        log(f"     {'✓' if good else '✗'} 根站 /static/tabbar/home.png  "
            f"{h['status']} {h['type']} {h['length']}B（商户页也靠它取图标）")
        ok &= good
    ok &= verify_prefix(cli, "/" + merchant + "/", "商户站")
    h = curl_headers(cli, f"http://127.0.0.1:{PORT}/__not-a-tenant__/")
    good = h["status"] == "404"
    log(f"     {'✓' if good else '✗'} 未知商户码 /__not-a-tenant__/ -> {h['status']}（期望 404）")
    ok &= good
    h = curl_headers(cli, f"http://127.0.0.1:{PORT}/" + merchant)
    loc = url_path(h.get("location", ""))
    good = h["status"] in ("301", "302") and loc.rstrip("/") == "/" + merchant
    log(f"     {'✓' if good else '✗'} 缺尾斜杠 /{merchant} -> {h['status']} {loc}"
        f"（期望 301 到 /{merchant}/）")
    ok &= good
    return ok


# ---------------- 平铺布局迁移 ----------------
def stash_flat_leftovers(cli):
    """新链已生效并校验通过后，把无用的平铺文件挪进备份（不删，可回退）"""
    code, o, _ = run(cli, f"test -e {WEB_ROOT}/index.html && echo FLAT || echo NONE")
    if o.strip() != "FLAT":
        return
    ts = time.strftime("%Y%m%d-%H%M%S")
    bak = posixpath.join(BACKUP_ROOT, "legacy-flat-" + ts)
    write_remote(cli, f"mkdir -p {bak} && "
                      f"mv {WEB_ROOT}/index.html {WEB_ROOT}/assets {WEB_ROOT}/static {bak}/ 2>/dev/null; "
                      f"echo STASHED",
                 f"平铺残留移入 {bak}（迁移前的整站，可回退）")
    run(cli, f"cd {BACKUP_ROOT} && ls -1dt */ 2>/dev/null | tail -n +{KEEP_BUILDS*2+1} "
             f"| xargs -r rm -rf")
    if not DRY:
        log("   ✓ 平铺布局已收进备份")


# ---------------- 子命令 ----------------
def do_list(cli, keep):
    step("当前发布矩阵")
    ids = remote_build_ids(cli)
    log("  构建（%d 份，保留上限 %d）：" % (len(ids), keep))
    for b, mt in ids:
        size = run(cli, f"du -sk {BUILDS}/{b} 2>/dev/null | cut -f1")[1].strip()
        log(f"    {b}   {size} KB   {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(mt))}")
    log("  软链：")
    code, o, _ = run(cli, f"ls -l {TENANTS} 2>/dev/null | tail -n +2")
    for line in o.split("\n"):
        parts = line.split("->")
        if len(parts) == 2:
            name = parts[0].split()[-1]
            log(f"    /{name:<16} -> {parts[1].strip().split('/')[-1]}")
    tgt = link_target(cli, CURRENT)
    log(f"    /  (根站)      -> {tgt.split('/')[-1] if tgt else '（无 current 链）'}")
    for b, _ in ids:
        m = remote_manifest(cli, b)
        if m:
            log(f"    {b}: {len(m)} 个文件")
    _, o, _ = run(cli, f"test -e {WEB_ROOT}/index.html && echo FLAT || echo NONE")
    if o.strip() == "FLAT":
        log("  ! 站点根目录还有平铺残留（index.html/assets/static），"
            "说明尚未完成迁移或 nginx 未切换")
    return 0


_H5_STATE_SNAPSHOT = r'''
import json, os, time
ROOT = "/var/www/jxc-h5"
LOGD = "/opt/v3cloud/logs"
OUT = os.path.join(LOGD, "h5_state.json")
base = "http://%s" % os.environ.get("JXC_H5_BASE", "")
tenants = {}
tdir = os.path.join(ROOT, "tenants")
try:
    for name in sorted(os.listdir(tdir)):
        p = os.path.join(tdir, name)
        if not os.path.islink(p):
            continue
        tgt = os.path.realpath(p)
        tenants[name] = {"build_id": os.path.basename(tgt), "url": "/%s/" % name,
                         "linked_at": int(os.path.getmtime(p) * 1000) / 1000.0}
except OSError:
    pass
try:
    current = os.path.basename(os.path.realpath(os.path.join(ROOT, "current")))
except OSError:
    current = ""
try:
    builds = sorted(os.listdir(os.path.join(ROOT, "builds")))
except OSError:
    builds = []
data = {"updated_at": time.time(), "current": current, "tenants": tenants,
        "builds": builds, "base_url": base, "written_by": "uniapp/scripts/deploy.py"}
os.makedirs(LOGD, exist_ok=True)
tmp = OUT + ".tmp"
with open(tmp, "w", encoding="utf-8") as fh:
    fh.write(json.dumps(data, ensure_ascii=False, indent=1))
os.replace(tmp, OUT)
os.chmod(OUT, 0o644)
print("h5_state: current=%s tenants=%s builds=%d" % (
    current, ",".join(sorted(tenants)) or "-", len(builds)))
'''


def write_h5_state(cli):
    """B4：把"谁指向哪份构建"回写进云端 logs/h5_state.json。

    ★ 为什么由发布脚本写、而不是让云端自己去问 nginx：后台那个只读看板一旦依赖
      "带凭据的 SSH 通道"或"nginx 可用"，就会在**最需要看状态的时刻**（发布出问题时）
      什么都看不见。发布脚本本来就知道真相，顺手原子落一份即可；
      云端只读这份快照，超过 24 小时没更新就标"可能已过期"。
    """
    b64 = base64.b64encode(_H5_STATE_SNAPSHOT.encode("utf-8")).decode("ascii")
    cmd = ("JXC_H5_BASE=%s sh -c 'echo %s | base64 -d > /tmp/jxc_h5_state.py && "
           "%s /tmp/jxc_h5_state.py && rm -f /tmp/jxc_h5_state.py'"
           % (shlex.quote("http://%s" % HOST), b64, CLOUD_PY))
    code, o, e = write_remote(cli, cmd, "回写 h5_state.json（云端后台只读它）")
    if code != 0:
        log("   ! h5_state.json 回写失败（不影响本次发布，后台会显示「最后一次已知状态」）：%s"
            % (e.strip()[:200] or o.strip()[:200]))
    else:
        log("   ✓ " + o.strip().split("\n")[-1])
    return code == 0


def resolve_target(cli, merchant, rollback):
    """--rollback 时返回已存在构建的相对链接目标，否则返回本次要发布的构建"""
    ids = [b for b, _ in remote_build_ids(cli)]
    if rollback == "previous":
        cur = link_target(cli, posixpath.join(TENANTS, merchant) if merchant else CURRENT)
        cur_id = re.search(r"([0-9a-f]{12})", cur)
        cur_id = cur_id.group(1) if cur_id else ""
        cand = [b for b in ids if b != cur_id]
        if not cand:
            log("   ✗ 找不到可回退的旧构建（现存 %s）" % ids)
            return None
        return cand[0]
    if rollback not in ids:
        log(f"   ✗ 构建 {rollback} 不存在。现存: {ids or '（无）'}")
        return None
    return rollback


def main():
    global DRY
    ap = argparse.ArgumentParser(description="H5 多商户发布（一份构建 + 每商户软链）")
    ap.add_argument("--merchant", help="商户码，如 yedian。发布/回滚时必填")
    ap.add_argument("--build-id", help="指定构建号（默认按产物内容哈希自动生成）")
    ap.add_argument("--retention", type=int, default=KEEP_BUILDS, help="保留几份构建")
    ap.add_argument("--rollback", metavar="BUILDID|previous",
                    help="把商户链指回已有构建（不重新构建、不上传）")
    ap.add_argument("--list", action="store_true", help="打印当前发布矩阵后退出")
    ap.add_argument("--dry-run", action="store_true", help="只打印要做的远端改动")
    ap.add_argument("--no-build", action="store_true", help="跳过本地构建")
    ap.add_argument("--no-current", action="store_true",
                    help="只发商户前缀，不动根站 `/`（默认：发的就是根站商户时同步 current）")
    ap.add_argument("--stage", action="store_true",
                    help="只上传构建 + 建软链，不改 nginx 配置也不 reload"
                    "（现网此刻零变化，验证过再不带 --stage 跑第二遍）")
    ap.add_argument("--unpublish", action="store_true",
                    help="下线某个商户前缀：只删 tenants/<码> 这条软链，立刻回到 404。"
                         "构建与根站都不动（Phase 2 的身份隔离没落地前，新商户先不放出来）")
    ap.add_argument("--check", action="store_true", help="只做连通性与状态检查")
    ap.add_argument("--sync-state", action="store_true",
                    help="只把发布矩阵回写成云端 logs/h5_state.json（后台「监控」页读它），不发布不改 nginx")
    ap.add_argument("--nginx-only", action="store_true",
                    help="只按模板写/校验/reload nginx 配置（签完证书、续完证书、改了 location 之后用）；"
                         "不构建、不上传、不动任何软链")
    ap.add_argument("--force", action="store_true", help="即使产物自查告警也继续（谨慎）")
    args = ap.parse_args()

    DRY = args.dry_run
    cli = connect()
    log(f"✓ SSH 连接 {USER}@{HOST}" + ("   [dry-run]" if DRY else ""))
    try:
        if args.list:
            return do_list(cli, args.retention)
        if args.sync_state:
            # 只把"谁指向哪份构建"回写给云端后台，不发布、不碰 nginx
            step("回写发布状态（不发布）")
            return 0 if write_h5_state(cli) else 1
        if args.nginx_only:
            # 证书刚签好/刚续期的时候，要的就是这一步：只换 nginx 配置。
            step("nginx 站点配置（只改配置，不发布）")
            if not setup_nginx(cli):
                return 1
            run(cli, f"curl -4 -s -o /dev/null -m 12 -w '本机 80  = %{{http_code}}\\n' "
                     f"http://127.0.0.1/", quiet=False)
            run(cli, f"curl -k4 -s -o /dev/null -m 12 -w '本机 443 = %{{http_code}}\\n' "
                     f"https://127.0.0.1/", quiet=False)
            return 0
        if args.check:
            run(cli, f"systemctl status {SERVICE_NAME} --no-pager 2>/dev/null | head -8",
                quiet=False)
            run(cli, f"curl -sI -m 8 -o /dev/null -w 'HTTP %{{http_code}}\\n' "
                     f"http://127.0.0.1:{PORT}/", quiet=False)
            run(cli, f"ls -l {TENANTS} {CURRENT} 2>&1 | head -20", quiet=False)
            return 0

        if not args.merchant:
            log("✗ 必须带 --merchant <商户码>（或用 --list / --check）")
            return 1
        if not MERCHANT_RE.match(args.merchant):
            log(f"✗ 商户码不合法: {args.merchant!r}（要求 {MERCHANT_RE.pattern}）")
            return 1
        if args.merchant in RESERVED:
            log(f"✗ 商户码 {args.merchant} 与根站路径冲突（会遮蔽 /{args.merchant}/），换一个")
            return 1

        if args.unpublish:
            step("下线商户前缀（只删一条软链）")
            link = posixpath.join(TENANTS, args.merchant)
            _, o, _ = run(cli, f"test -L {link} && readlink {link} || echo MISSING")
            log(f"   现状: {link} -> {o.strip()}")
            if o.strip() == "MISSING":
                log("   本来就没有这条链，no-op")
                return 0
            write_remote(cli, f"rm -f {link} && echo UNPUBLISHED", f"删除 {link}")
            if DRY:
                log("   [dry-run] 没真删，跳过下线后的 404 复测")
                return 0
            h = curl_headers(cli, f"http://127.0.0.1:{PORT}/{args.merchant}/")
            oku = h["status"] == "404"
            log(f"   {'✓' if oku else '✗'} 下线后 /{args.merchant}/ -> {h['status']}（期望 404）")
            write_h5_state(cli)     # 链没了也要让后台立刻看到"这条前缀未发布"
            log("   builds/ 里的构建、current 根站链、nginx 配置都没动 ——"
                "要重新放出来，跑一次不带 --unpublish 的命令即可")
            return 0 if oku else 2

        step("目标")
        log(f"   商户码  : {args.merchant}  →  URL http://{HOST}:{PORT}/{args.merchant}/")
        log(f"   布局    : {BUILDS}/<buildid>  ←  {TENANTS}/{args.merchant}")
        flat = ensure_layout(cli)
        # 迁移那一次必须同时建 current，否则新 nginx 配置一上来根站就空了
        want_current = args.merchant == ROOT_MERCHANT or flat
        if args.no_current:
            want_current = False
        if flat and not want_current:
            log("   ✗ 站点还是平铺布局，--no-current 会让根站 `/` 无处可指，拒绝继续")
            return 1
        if want_current:
            log(f"   根  站  : 同步把 {CURRENT} 指向本次构建")

        if args.rollback:
            build_id = resolve_target(cli, args.merchant, args.rollback)
            if not build_id:
                return 1
            step("回滚（只改软链）")
            if not switch_link(cli, posixpath.join(TENANTS, args.merchant),
                               f"../builds/{build_id}"):
                return 1
            if want_current and not switch_link(cli, CURRENT, f"builds/{build_id}"):
                return 1
            log(f"   ✓ {args.merchant} 已指向 {build_id}")
        else:
            if not args.no_build:
                if not build():
                    return 1
            if not sanity_check_dist():
                if not args.force:
                    return 1
                log("   ! 产物自查未过，--force 继续")
            files, digest, total = local_manifest()
            build_id = args.build_id or digest
            step("上传并切链")
            log(f"   build-id: {build_id}（内容哈希 {digest}）")
            if not upload_build(cli, files, build_id, total):
                log("   ✗ 上传/校验失败，未改动任何软链")
                return 1
            if not switch_link(cli, posixpath.join(TENANTS, args.merchant),
                               f"../builds/{build_id}"):
                return 1
            log(f"   ✓ {TENANTS}/{args.merchant} -> ../builds/{build_id}")
            if want_current:
                if not switch_link(cli, CURRENT, f"builds/{build_id}"):
                    return 1
                log(f"   ✓ 根站 {CURRENT} -> builds/{build_id}")

        if args.stage:
            step("stage 完成（没碰 nginx）")
            write_h5_state(cli)
            log(f"   已就位: {BUILDS}/{build_id}  {TENANTS}/{args.merchant}  "
                f"{CURRENT} -> {(link_target(cli, CURRENT) or '未建').split('/')[-1]}")
            log("   现网此刻仍由**旧配置**服务，商户前缀还没生效（旧配置也没有商户块）。")
            log(f"   确认无误后不带 --stage 再跑一次同一条命令，那次只做 nginx 配置 + reload。")
            return 0

        if not setup_nginx(cli):
            log("   ✗ nginx 配置未就绪，软链已就位但站点可能仍是旧配置")
            return 2
        ok = verify_serving(cli, args.merchant, want_current)
        if ok:
            stash_flat_leftovers(cli)
            prune_builds(cli, args.retention)
        # 成功也好、校验没过也好，链现在指向哪份构建都是既成事实 —— 后台要看到真相
        write_h5_state(cli)
        log("\n" + "=" * 56)
        log(f"  {'部署完成 ✓' if ok else '完成但有校验未通过 ✗'}")
        log(f"  商户站: http://{HOST}:{PORT}/{args.merchant}/")
        root_id = (link_target(cli, CURRENT) or "").split("/")[-1]
        log(f"  根  站: http://{HOST}:{PORT}/  （{CURRENT} -> {root_id or '未建'}）")
        if root_id and root_id != build_id:
            log(f"  ! 根站构建 {root_id} 与本次 {build_id} 不是同一份。一份共享构建的"
                f"预期是各家同步，要么补发 --merchant {ROOT_MERCHANT}，"
                f"要么就是故意留着旧版")
        log("  下一步: python scripts/check-deploy-matrix.py --merchants "
            + args.merchant)
        log("=" * 56)
        return 0 if ok else 2
    finally:
        cli.close()


if __name__ == "__main__":
    sys.exit(main())
