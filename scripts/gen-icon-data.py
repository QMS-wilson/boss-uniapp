# -*- coding: utf-8 -*-
"""Icon.vue 图标 → base64 data-URI 生成器。

背景
====
小程序端不支持内联 `<svg>` 标签，也不支持 `v-html`。
原 `Icon.vue` 用 `<svg><g v-html="..."/></svg>` 渲染，产物 wxml 里
`<g>` 是空的 ⇒ 全站 106 处图标在小程序端**一个都不显示**。

方案
====
把每个 SVG 图标预编译成 `data:image/svg+xml;base64,...`，
运行时以 `background-image` 渲染（小程序的 view 支持背景图）。

颜色
====
原实现靠 CSS `currentColor` 继承父级 color；改背景图后颜色必须固化进图片。
不做「45 图标 × 11 色」全量生成（约 220 KB），只生成**实际用到的组合**。

★★★ 组合表自动推导（2026-09-22 重写）
    第一版靠手写 NEEDED 列表 —— 结果 `backfill-icon-color.py` 给 63 个站点
    补上显式 color 之后，表里少了 21 组，运行时静默回退成灰色。
    教训：**手写清单一定会漂移**。现在改成直接扫 src/ 下所有 .vue 的
    `<Icon ...>` 站点，按 (name, color) 去重后生成。
    ⇒ 改完调用点只要重跑本脚本，表自动跟上，不会再有"漏生成"。

    · 静态 `name="x" color="y"`  → 生成 (x, y)
    · 无 color                   → 生成 (x, 'text-3')（组件默认色）
    · 动态 name（三元/v-for）    → 该站点若为动态，则对**调色板全色**生成该图标
      （运行时是哪个名字无法静态得知，全量生成才安全；图标总数小，代价可接受）

用法
====
    python scripts/gen-icon-data.py            # 生成并写回 Icon.vue 的 ICON_URI
    python scripts/gen-icon-data.py --check    # 只校验，不写
"""
import argparse
import base64
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, 'src')
ICON_VUE = os.path.join(SRC, 'components', 'Icon.vue')

# ★ 调色板：与 uni.scss 的设计令牌一致。键是语义名，值是色值。
PALETTE = {
    'primary': '#1677ff',   # $color-primary
    'success': '#27a866',   # $color-success
    'warning': '#e8952f',   # $color-warning
    'danger':  '#d95745',   # $color-danger
    'violet':  '#7057d9',   # $color-violet
    'text':    '#202b3b',   # $color-text
    'text-2':  '#536175',   # $color-text-2
    'text-3':  '#8995a5',   # $color-text-3（组件默认色）
    'text-4':  '#9aa5b3',   # $color-text-4
    'white':   '#ffffff',   # 深底上的白图标
    'brown':   '#8a6a2f',   # .lock-card 专用（历史遗留硬编码色）
}

DEFAULT_COLOR = 'text-3'

# 组件里会用到但源码里不一定出现的图标（如 EmptyState 的 props 默认值）
EXTRA_ICONS = []

# ★ 包装组件：自身用 `<Icon :name="xxx">` 透传，真实图标名在**调用方**的属性里。
#   例：EmptyState 的 `icon` prop → <EmptyState icon="users" />。
#   不处理的话 running 时会静默回退成灰色（漏生成）。
PASSTHROUGH = {
    # 组件文件名 → (透传 prop 名, 该组件内 <Icon> 用的固定 color)
    'EmptyState.vue': ('icon', DEFAULT_COLOR),
}


def parse_icons(vue_src):
    """取图标 SVG body 表。

    ★ 权威源是 scripts/icon-paths.json（由 rewrite-icon-vue.py 从旧内联 SVG 版
    导出）；Icon.vue 里只剩编译后的 ICON_URI，没有 body 了。
    """
    p = os.path.join(BASE, 'scripts', 'icon-paths.json')
    if os.path.exists(p):
        import json
        return json.load(open(p, encoding='utf-8'))
    # 兜底：还能从旧内联 SVG 版解析（存在 ICON_PATHS 时）
    for pat in (r'const ICON_PATHS = \{(.*?)\n\}', r'const paths = \{(.*?)\n\}'):
        m = re.search(pat, vue_src, re.S)
        if m:
            icons = {}
            for mm in re.finditer(r"^  '?([a-z0-9-]+)'?:\s*'((?:[^'\\]|\\.)*)',?\s*$", m.group(1), re.M):
                icons[mm.group(1)] = mm.group(2)
            if icons:
                return icons
    raise SystemExit('✗ 找不到图标定义（scripts/icon-paths.json 不存在且 Icon.vue 无 ICON_PATHS）')


def scan_usages(known_icons):
    """扫全站 <Icon> 站点 → [(name, color)]；动态 name 记为 None。"""
    sites = []
    for root, _d, fs in os.walk(SRC):
        for f in fs:
            if not f.endswith('.vue') or f.endswith('.bak-svg'):
                continue
            p = os.path.join(root, f)
            s = open(p, encoding='utf-8').read()
            # ★ 必须容得下属性值里的 ">"（如 v-if="a >= b"）：用 [^>]*? 会在 ">" 处截断，
            #   整站被漏掉 ⇒ 那一格运行时静默回退成灰色，而 --check 也查不出来。
            for m in re.finditer(
                    r"<Icon\b(?:[^>'\"]|\"[^\"]*\"|'[^']*')*/>", s, re.S):
                tag = m.group(0)
                nm = re.search(r'name="([^"]+)"', tag)
                cm = re.search(r'color="([^"]+)"', tag)
                if not nm:
                    continue
                raw = nm.group(1)
                color = cm.group(1) if cm else DEFAULT_COLOR
                # 静态名：直接命中已知图标表；动态（含引号/表达式）记为 None
                name = raw if (raw in known_icons or re.fullmatch(r'[a-z0-9-]+', raw)) else None
                sites.append((name, color, os.path.relpath(p, BASE), raw))
    return sites


def build_uri(body_svg, color):
    """把 SVG body（不含 <svg> 外壳）编译成 data-URI。"""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" '
        'viewBox="0 0 24 24" fill="none" stroke="' + color + '" '
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + body_svg.replace('currentColor', color) +
        '</svg>'
    )
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode('utf-8')).decode('ascii')


def scan_passthrough(icons):
    """扫包装组件的调用方，把透传 prop 变成真实 (icon, color) 组合。

    例：EmptyState 内部是 `<Icon :name="icon" color="text-3" />`，
    调用方写 `<EmptyState icon="users" />` ⇒ 需要 ('users','text-3')。
    """
    pairs = set()
    notes = []
    for comp_file, (prop, color) in PASSTHROUGH.items():
        comp_name = comp_file[:-4]  # 去掉 .vue
        # ① 组件自身的 props 默认值
        comp_path = os.path.join(SRC, 'components', comp_file)
        if os.path.exists(comp_path):
            s = open(comp_path, encoding='utf-8').read()
            dm = re.search(prop + r":\s*\{\s*type:\s*String,\s*default:\s*'([a-z0-9-]+)'", s)
            if dm and dm.group(1) in icons:
                pairs.add((dm.group(1), color))
                notes.append('    %s props 默认值 → %s|%s' % (comp_file, dm.group(1), color))
        # ② 所有调用方传的 prop
        for root, _d, fs in os.walk(SRC):
            for f in fs:
                if not f.endswith('.vue') or f == comp_file:
                    continue
                p = os.path.join(root, f)
                s = open(p, encoding='utf-8').read()
                for m in re.finditer('<' + comp_name + r'\b[^>]*?/>', s, re.S):
                    tag = re.sub(r'\s+', ' ', m.group(0))
                    vm = re.search(prop + r'="([a-z0-9-]+)"', tag)
                    if not vm:
                        continue
                    nm = vm.group(1)
                    if nm in icons:
                        pairs.add((nm, color))
                        notes.append('    %s → %s|%s' % (os.path.relpath(p, BASE), nm, color))
    return pairs, notes


def derive_pairs(icons):
    """扫源码推导需要的 (icon, colorKey) 组合。"""
    sites = scan_usages(icons)
    pairs = set()
    dynamic_sites = []
    unknown = []

    for name, color, rel, raw in sites:
        if color not in PALETTE:
            unknown.append((rel, raw, color))
            color = DEFAULT_COLOR
        if name is None:
            dynamic_sites.append((rel, raw, color))
            continue
        if name not in icons:
            unknown.append((rel, name, color))
            continue
        pairs.add((name, color))

    # 动态 name 的站点：这些名字无法静态得知，对调色板全色穷举
    # （动态名常见于 it.showHistory ? 'chevron-down' : 'chevron-right'）
    for rel, raw, _color in dynamic_sites:
        for cand in re.findall(r'[a-z][a-z0-9-]{2,}', raw):
            if cand in icons:
                for ck in PALETTE:
                    pairs.add((cand, ck))

    for n in EXTRA_ICONS:
        if n in icons:
            for ck in PALETTE:
                pairs.add((n, ck))

    # 包装组件透传的图标名
    pp, pp_notes = scan_passthrough(icons)
    pairs |= pp

    return pairs, dynamic_sites, unknown, sites, pp_notes


def build_block(pairs, icons):
    lines = []
    total = 0
    for name, key in sorted(pairs):
        uri = build_uri(icons[name], PALETTE[key])
        total += len(uri)
        lines.append("  '%s|%s': '%s'," % (name, key, uri))
    block = (
        "// ★ 由 scripts/gen-icon-data.py 生成，请勿手改。\n"
        "//   组合表由脚本扫 src/ 全站图标调用点自动推导，改完调用点重跑即可。\n"
        "const ICON_URI = {\n" + '\n'.join(lines) + '\n}\n'
    )
    return block, total, len(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只校验不写回')
    args = ap.parse_args()

    src = open(ICON_VUE, encoding='utf-8').read()
    icons = parse_icons(src)
    print('图标定义: %d 个' % len(icons))

    pairs, dynamic_sites, unknown, sites, pp_notes = derive_pairs(icons)
    print('<Icon> 站点: %d 个' % len(sites))
    if pp_notes:
        print('包装组件透传: %d 处' % len(pp_notes))
        for n in pp_notes:
            print(n)
    if dynamic_sites:
        print('动态 name 站点: %d 个 → 已对调色板全色穷举' % len(dynamic_sites))
        for rel, raw, _c in dynamic_sites:
            print('    %s  name=%s' % (rel, raw))
    if unknown:
        print('! 未能识别的图标引用（已按默认色处理）:')
        for rel, n, c in unknown:
            print('    %s  name=%s color=%s' % (rel, n, c))

    block, total, n = build_block(pairs, icons)
    print('生成组合: %d 组，总体积 %.1f KB' % (n, total / 1024))

    # ★ 替换范围要**连本脚本自己写在表上方的注释一起吃掉**：早期只匹配 `const ICON_URI`，
    #   于是每跑一次就在文件顶上多留一段（历史上攒过 12 段）。
    #   判据是"表上方连续 // 注释里出现过 gen-icon-data.py"，别人手写的注释不吃。
    m = re.search(r'((?:[ \t]*//[^\n]*\n)*)const ICON_URI = \{.*?\n\}', src, re.S)
    cur = m if (m and 'gen-icon-data.py' in m.group(1)) \
        else re.search(r'const ICON_URI = \{.*?\n\}', src, re.S)
    same = bool(cur) and cur.group(0) == block.rstrip('\n')

    if args.check:
        print('✓ 已是最新' if same else '! Icon.vue 里的 ICON_URI 与源码不一致，请重新生成')
        return 0

    if same:
        print('✓ 无需改动')
        return 0

    new_src = src[:cur.start()] + block.rstrip('\n') + src[cur.end():]
    open(ICON_VUE, 'w', encoding='utf-8').write(new_src)
    print('✓ 已写回 %s' % os.path.relpath(ICON_VUE, BASE))
    return 0


if __name__ == '__main__':
    sys.exit(main())
