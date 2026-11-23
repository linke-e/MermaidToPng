"""Download pele global bundle -> MermaidToPng/pele.min.js (proxy + mirror fallbacks)."""
import urllib.request
import tarfile
import io
import os
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pele.min.js")
PROXY = "http://127.0.0.1:7897"
PKG = "pele", "1.13.0", "dist/pele.global.js"


def from_tgz(data):
    """npmmirror CDN 只放整包 tgz：内存解包取 dist/pele.global.js"""
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as t:
        for m in t.getmembers():
            if m.name.endswith(PKG[2]) and m.isfile():
                return t.extractfile(m).read()
    raise ValueError(f"{PKG[2]} not found in tgz")


SOURCES = [
    # 直连源：显式空代理（环境变量里的失效 HTTP_PROXY 会劫持“直连”，WinError 10061 实测）
    ("npmmirror-cdn-tgz", f"https://cdn.npmmirror.com/packages/{PKG[0]}/{PKG[1]}/{PKG[0]}-{PKG[1]}.tgz", None, from_tgz),
    ("gcore-jsdelivr", f"https://gcore.jsdelivr.net/npm/{PKG[0]}@{PKG[1]}/{PKG[2]}", None, None),
    ("jsdelivr-proxy", f"https://cdn.jsdelivr.net/npm/{PKG[0]}@{PKG[1]}/{PKG[2]}", PROXY, None),
    ("unpkg-proxy", f"https://unpkg.com/{PKG[0]}@{PKG[1]}/{PKG[2]}", PROXY, None),
]

ok = False
for name, url, proxy, post in SOURCES:
    try:
        print(f"try [{name}] {url} ...", flush=True)
        handlers = [urllib.request.ProxyHandler({})] if proxy is None else [
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        ]
        opener = urllib.request.build_opener(*handlers)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with opener.open(req, timeout=60) as resp:
            data = resp.read()
        if post:
            data = post(data)
        if len(data) < 100_000 or b"pele" not in data[:2_000_000]:
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
