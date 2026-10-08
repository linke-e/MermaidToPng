"""Download mermaid UMD bundle -> MermaidToPng/mermaid.min.js (proxy + mirror fallbacks)."""
import urllib.request
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mermaid.min.js")
PROXY = "http://127.0.0.1:7897"

SOURCES = [
    ("npmmirror-direct", "https://registry.npmmirror.com/mermaid/11.4.1/files/dist/mermaid.min.js", None),
    ("jsdelivr-proxy", "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js", PROXY),
    ("unpkg-proxy", "https://unpkg.com/mermaid@11.4.1/dist/mermaid.min.js", PROXY),
]

opener_direct = urllib.request.build_opener()
opener_proxy = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY})
)

ok = False
for name, url, proxy in SOURCES:
    opener = opener_proxy if proxy else opener_direct
    try:
        print(f"try [{name}] {url} ...", flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with opener.open(req, timeout=60) as resp:
            data = resp.read()
        if len(data) < 100_000 or b"mermaid" not in data[:2_000_000]:
            print(f"  suspicious size={len(data)}, skip")
            continue
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "wb") as f:
            f.write(data)
        print(f"OK [{name}] saved {len(data)} bytes -> {OUT}")
        ok = True
        break
    except Exception as e:
        print(f"  FAIL: {type(e).__name__}: {e}")

sys.exit(0 if ok else 1)
