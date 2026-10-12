#!/usr/bin/env python3
"""MermaidToPng 构建校验与部署同步（纯标准库，零第三方依赖）。

用法:
  python scripts/build.py --check   构建校验（deploy 一致性 / 发布污染 / 依赖标记）
  python scripts/build.py --sync    把主文件与 mermaid.min.js 同步到 deploy/ 并自动校验

校验项（--check）:
  ① MermaidToPng.html 与 deploy/index.html 字节一致
  ② mermaid.min.js 与 deploy/mermaid.min.js 字节一致
  ③ 主文件不含发布污染标记（'impeccable-live'、'src="http://localhost:'）
  ④ 主文件含 '__esbuild_esm_mermaid'，且根目录 mermaid.min.js 存在、非空

退出码: 0=通过  1=校验未通过  2=用法错误
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN_HTML = ROOT / "MermaidToPng.html"
MAIN_JS = ROOT / "mermaid.min.js"
DEPLOY_DIR = ROOT / "deploy"
DEPLOY_HTML = DEPLOY_DIR / "index.html"
DEPLOY_JS = DEPLOY_DIR / "mermaid.min.js"

# ③ 发布污染检测：本地调试/其他项目混入的标记，出现即说明发布面被污染。
POLLUTION_MARKS = ('impeccable-live', 'src="http://localhost:')
# ④ 依赖完整性：主文件内联的 mermaid esm 构建标记。
ESM_MARK = "__esbuild_esm_mermaid"

USAGE = """用法:
  python scripts/build.py --check   构建校验（deploy 一致性 / 发布污染 / 依赖标记）
  python scripts/build.py --sync    同步主文件与 mermaid.min.js 到 deploy/ 并自动校验

校验项:
  1. MermaidToPng.html 与 deploy/index.html 字节一致
  2. mermaid.min.js 与 deploy/mermaid.min.js 字节一致
  3. 主文件不含发布污染标记（'impeccable-live'、'src="http://localhost:'）
  4. 主文件含 '__esbuild_esm_mermaid'，且根目录 mermaid.min.js 存在、非空

退出码: 0=通过  1=校验未通过  2=用法错误
"""


def run_check() -> bool:
    """执行 ①—④ 校验；任一不满足打印中文原因返回 False，全过打印「构建校验通过」返回 True。"""
    problems: list[str] = []
    main_bytes: bytes | None = None
    js_bytes: bytes | None = None

    # ① 主文件与 deploy/index.html 字节一致
    if not MAIN_HTML.is_file():
        problems.append("① 主文件 MermaidToPng.html 缺失")
    else:
        main_bytes = MAIN_HTML.read_bytes()
        if not DEPLOY_HTML.is_file():
            problems.append("① deploy/index.html 缺失，无法与主文件比对")
        else:
            deploy_html = DEPLOY_HTML.read_bytes()
            if deploy_html != main_bytes:
                problems.append(
                    f"① MermaidToPng.html 与 deploy/index.html 字节不一致"
                    f"（主文件 {len(main_bytes)} B，deploy/index.html {len(deploy_html)} B）；"
                    f"如确以主文件为准请跑 --sync"
                )

    # ② mermaid.min.js 与 deploy/mermaid.min.js 字节一致
    if not MAIN_JS.is_file():
        problems.append("② 根目录 mermaid.min.js 缺失")
    else:
        js_bytes = MAIN_JS.read_bytes()
        if not DEPLOY_JS.is_file():
            problems.append("② deploy/mermaid.min.js 缺失，无法与根目录文件比对")
        else:
            deploy_js = DEPLOY_JS.read_bytes()
            if deploy_js != js_bytes:
                problems.append(
                    f"② mermaid.min.js 与 deploy/mermaid.min.js 字节不一致"
                    f"（根目录 {len(js_bytes)} B，deploy/mermaid.min.js {len(deploy_js)} B）；"
                    f"如确以根目录为准请跑 --sync"
                )

    # ③ 发布污染检测（在主文件文本里搜标记）
    main_text: str | None = None
    if main_bytes is None:
        problems.append("③ 主文件缺失，无法做发布污染检测（已在①报失败）")
    else:
        main_text = main_bytes.decode("utf-8", errors="replace")
        for mark in POLLUTION_MARKS:
            if mark in main_text:
                problems.append(f"③ 主文件含发布污染标记 {mark!r}")

    # ④ 内联 mermaid 标记 + 根目录 mermaid.min.js 存在且非空
    if main_text is None:
        problems.append("④ 主文件缺失，无法检测 '__esbuild_esm_mermaid'（已在①报失败）")
    elif ESM_MARK not in main_text:
        problems.append(f"④ 主文件不含 {ESM_MARK!r}（内联 mermaid 构建缺失？）")
    if js_bytes is None:
        pass  # 缺失已在②报过，不重复计数
    elif len(js_bytes) == 0:
        problems.append("④ 根目录 mermaid.min.js 为空文件")

    if problems:
        print("构建校验未通过:")
        for item in problems:
            print(f"  - {item}")
        return False
    print("构建校验通过")
    return True


def run_sync() -> bool:
    """把主文件与 mermaid.min.js 复制到 deploy/（shutil.copyfile），打印前后字节数，再自动校验。"""
    if not MAIN_HTML.is_file():
        print(f"同步失败: 主文件缺失 {MAIN_HTML.relative_to(ROOT).as_posix()}")
        return False
    if not MAIN_JS.is_file():
        print(f"同步失败: 根目录 mermaid.min.js 缺失")
        return False
    DEPLOY_DIR.mkdir(parents=True, exist_ok=True)
    for src, dst in ((MAIN_HTML, DEPLOY_HTML), (MAIN_JS, DEPLOY_JS)):
        before = dst.stat().st_size if dst.is_file() else None
        shutil.copyfile(src, dst)
        after = dst.stat().st_size
        prev = f"{before} B" if before is not None else "（无旧文件）"
        print(
            f"同步 {src.name} -> {dst.relative_to(ROOT).as_posix()}: "
            f"{after} B（同步前 {prev}，同步后 {after} B）"
        )
    return run_check()


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(argv) != 2:
        print(USAGE)
        return 2
    if argv[1] == "--check":
        return 0 if run_check() else 1
    if argv[1] == "--sync":
        return 0 if run_sync() else 1
    print(USAGE)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
