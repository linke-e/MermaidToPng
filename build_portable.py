"""Build portable artifacts for MermaidToPng (stdlib only, Python 3.8+).

1. MermaidToPng-standalone.html — Mermaid.html with mermaid.min.js inlined
   (single file, works anywhere, no sibling files needed)
2. MermaidToPng-portable.zip    — everything needed to carry the tool around
"""
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
HTML = ROOT / "Mermaid.html"
LIB = ROOT / "mermaid.min.js"
STANDALONE = ROOT / "MermaidToPng-standalone.html"
ZIP = ROOT / "MermaidToPng-portable.zip"

SCRIPT_TAG = '<script src="./mermaid.min.js"></script>'

# zip 内清单（缺文件自动跳过并提示）
ZIP_FILES = [
    "MermaidToPng-standalone.html",
    "MermaidToPng.bat",
    "Mermaid.html",
    "mermaid.min.js",
    "fetch_mermaid.py",
    "build_portable.py",
    "使用说明.txt",
    "ARCHITECTURE.md",
    "sample-output.png",
]


def build_standalone() -> None:
    html = HTML.read_text(encoding="utf-8")
    if SCRIPT_TAG not in html:
        sys.exit(f"ERROR: script tag not found in {HTML.name}: {SCRIPT_TAG!r}")
    lib = LIB.read_text(encoding="utf-8")
    # 转义 JS 内的 </script，防止 HTML 解析器提前终止内联 <script> 块。
    # 该串在 JS 里只可能出现在字符串字面量中，\/ 与 / 语义相同，替换安全。
    lib = lib.replace("</script", "<\\/script")
    out = html.replace(SCRIPT_TAG, "<script>\n" + lib + "\n</script>")
    STANDALONE.write_text(out, encoding="utf-8")
    print(f"standalone: {STANDALONE.name}  {STANDALONE.stat().st_size:,} bytes")


def make_zip() -> None:
    if ZIP.exists():
        ZIP.unlink()
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in ZIP_FILES:
            p = ROOT / name
            if p.exists():
                z.write(p, arcname=f"MermaidToPng/{name}")
            else:
                print(f"  skip (missing): {name}")
    print(f"zip:        {ZIP.name}  {ZIP.stat().st_size:,} bytes")


if __name__ == "__main__":
    build_standalone()
    make_zip()
