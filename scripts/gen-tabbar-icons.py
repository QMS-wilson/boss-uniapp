"""生成 tabBar 图标：与 Icon.vue 同源的线性图标，统一 2x 输出（81x81 逻辑像素）。

uni-app 的 tabBar 只接受本地图片，不能内联 SVG，所以这里把同一套图标路径
离屏绘制成 PNG。线条只用圆头描边，与 App 内的 Icon 组件视觉一致。
"""
import os
import re
from PIL import Image, ImageDraw

OUT = r"D:\重构\进销存-uniapp\src\static\tabbar"
SIZE = 81          # 逻辑 27px @3x
STROKE = 1.9       # 以 24 viewBox 为单位

OFF = (137, 149, 165)   # 未选中 #8995a5
ON = (22, 119, 255)     # 选中  #1677ff


# 图标定义：每个元素是 ('path', d) / ('circle', cx, cy, r) / ('rect', x,y,w,h,rx)
ICONS = {
    "home": [
        ("path", "M3 9.5 12 2.6l9 6.9V20a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 20Z"),
        ("path", "M9.2 21.6v-7.4h5.6v7.4"),
    ],
    "sales": [
        # 单据轮廓：直边矩形，避免斜折角与内部横线在高密度下糊在一起
        ("path", "M5 4.6A2 2 0 0 1 7 2.6h6.4l5.6 5.6V19.4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"),
        ("path", "M13.4 2.6v5.6H19"),
        ("path", "M8.4 12.6h7.2"),
        ("path", "M8.4 16.6h5"),
    ],
    "report": [
        ("path", "M4.2 20.4V11.6"),
        ("path", "M9.8 20.4V4.2"),
        ("path", "M15.4 20.4v-6.6"),
        ("path", "M21 20.4H3"),
    ],
    "purchase": [
        ("path", "M13.6 18.4V6.2a2 2 0 0 0-2-2H4.4a2 2 0 0 0-2 2v10.6a1.6 1.6 0 0 0 1.6 1.6h2"),
        ("path", "M14.6 18.4H9"),
        ("path", "M18.6 18.4h2a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-.2-.6l-3.4-4.3a1 1 0 0 0-.8-.4h-3.6"),
        ("circle", 6.8, 18.6, 1.9),
        ("circle", 16.6, 18.6, 1.9),
    ],
    "mine": [
        ("circle", 12, 7.6, 3.7),
        ("path", "M4.8 21c0-3.9 3.2-6.6 7.2-6.6s7.2 2.7 7.2 6.6"),
    ],
}


def tokenize_path(d):
    """把 SVG path 的 d 拆成命令 + 数值。仅支持图标用到的 M/L/H/V/C/S/A/Z 子集。"""
    return re.findall(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?", d)


def parse_subpaths(d, scale, ox, oy):
    """将简化 path 解析为折线点列。只处理 M/L/H/V/C/Z 及小写相对坐标。"""
    tokens = tokenize_path(d)
    i = 0
    cx = cy = 0.0
    sx = sy = 0.0
    subpaths = []
    pts = []
    cmd = None
    last_ctrl = None

    def flush():
        nonlocal pts
        if len(pts) > 1:
            subpaths.append(pts)
        pts = []

    while i < len(tokens):
        t = tokens[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                if pts:
                    pts.append((sx, sy))
                    flush()
                cx, cy = sx, sy
                continue
            if i >= len(tokens):
                break
        num = lambda k: float(tokens[i + k])

        if cmd in "Mm":
            x, y = num(0), num(1)
            i += 2
            if cmd == "m":
                x, y = cx + x, cy + y
            flush()
            cx, cy = x, y
            sx, sy = x, y
            pts = [(cx, cy)]
            cmd = "L" if cmd == "M" else "l"
            last_ctrl = None
        elif cmd in "Ll":
            x, y = num(0), num(1)
            i += 2
            if cmd == "l":
                x, y = cx + x, cy + y
            cx, cy = x, y
            pts.append((cx, cy))
            last_ctrl = None
        elif cmd in "Hh":
            x = num(0); i += 1
            if cmd == "h":
                x = cx + x
            cx = x
            pts.append((cx, cy))
            last_ctrl = None
        elif cmd in "Vv":
            y = num(0); i += 1
            if cmd == "v":
                y = cy + y
            cy = y
            pts.append((cx, cy))
            last_ctrl = None
        elif cmd in "CcSs":
            if cmd in "Cc":
                x1, y1, x2, y2, x, y = (num(k) for k in range(6))
                i += 6
                if cmd == "c":
                    x1, y1 = cx + x1, cy + y1
                    x2, y2 = cx + x2, cy + y2
                    x, y = cx + x, cy + y
            else:
                # S/s：第一控制点由上一控制点镜像得到
                x2, y2, x, y = (num(k) for k in range(4))
                i += 4
                if cmd == "s":
                    x2, y2 = cx + x2, cy + y2
                    x, y = cx + x, cy + y
                if last_ctrl is None:
                    x1, y1 = cx, cy
                else:
                    x1, y1 = 2 * cx - last_ctrl[0], 2 * cy - last_ctrl[1]
            last_ctrl = (x2, y2)
            # 三次贝塞尔采样
            for s in range(1, 13):
                u = s / 12
                v = 1 - u
                px = v**3 * cx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u**3 * x
                py = v**3 * cy + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u**3 * y
                pts.append((px, py))
            cx, cy = x, y
        else:
            i += 1

    flush()
    return [[(ox + x * scale, oy + y * scale) for (x, y) in sp] for sp in subpaths]


def render(name, color):
    """4x 超采样绘制后缩小，得到平滑的圆头线条。"""
    ss = 4
    W = SIZE * ss
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    scale = W / 24.0
    lw = max(2, round(STROKE * scale))

    for el in ICONS[name]:
        if el[0] == "path":
            for sp in parse_subpaths(el[1], scale, 0, 0):
                if len(sp) > 1:
                    draw.line(sp, fill=color + (255,), width=lw, joint="curve")
                    # 圆头补点
                    for p in (sp[0], sp[-1]):
                        r = lw / 2
                        draw.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=color + (255,))
        elif el[0] == "circle":
            _, cxx, cyy, r = el
            n = 96
            box = [(cxx*scale - r*scale, cyy*scale - r*scale),
                   (cxx*scale + r*scale, cyy*scale + r*scale)]
            draw.ellipse(box, outline=color + (255,), width=lw)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in ICONS:
        render(name, OFF).save(os.path.join(OUT, f"{name}.png"))
        render(name, ON).save(os.path.join(OUT, f"{name}-on.png"))
        print("ok", name)


if __name__ == "__main__":
    main()
