# -*- coding: utf-8 -*-
"""从 `static/icon/app-1024.png` 重切 Android 应用图标全套尺寸。

★ 为什么放**项目根**的 static/ 而不是 src/static/：HBuilderX 云打包按**项目根**解析
  manifest 里的 `icons.android.*` 路径。图标曾经放 src/static/icon/，
  `cli pack` 连报 4 次「文件不存在」就退（那 4 次正是它校验的 hdpi/xhdpi/xxhdpi/xxxhdpi）。
  应用图标不是运行期资源（页面里没人引用它），所以只留根这一份，别在 src 下再存一份。

用法：
    python scripts/make-app-icons.py            # 重切 6 个尺寸
    python scripts/make-app-icons.py --src 路径  # 换源图（例如 logo 定稿后）
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "static", "icon")
SIZES = [("ldpi", 36), ("mdpi", 48), ("hdpi", 72),
         ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ap = argparse.ArgumentParser()
ap.add_argument("--src", default=os.path.join(OUT, "app-1024.png"))
a = ap.parse_args()

if not os.path.isfile(a.src):
    print("✗ 没有源图：%s" % a.src)
    raise SystemExit(1)
from PIL import Image     # noqa: E402

im = Image.open(a.src)
if im.size[0] != im.size[1]:
    print("✗ 源图必须是正方形，现在 %s" % (im.size,))
    raise SystemExit(1)
im = im.convert("RGB")
os.makedirs(OUT, exist_ok=True)
for name, sz in SIZES:
    im.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT, "android-%s.png" % name))
    print("  ✓ android-%s.png  %d×%d" % (name, sz, sz))
print("源图 %s（%d×%d）→ %d 个尺寸，目录 %s"
      % (os.path.basename(a.src), im.size[0], im.size[1], len(SIZES), OUT))
