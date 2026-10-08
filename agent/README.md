# MermaidToPng Agent Interface: Bridge Mode

> Lets any Agent go straight from "diagram source → PNG on disk" within a session.
> **All tools execute inside the web page**; locally there is only `agent/mtp-mcp.mjs`, a pure-forwarding MCP bridge (zero dependencies, Node 18+).
> Architecture and design decisions: `../ARCHITECTURE.md` §4. **Implemented and verified end-to-end** (2026-10-06, e2e 18/18; see §4.6 of that document).

```
Agent ──stdio MCP──▶ mtp-mcp.mjs ──HTTP long-poll(127.0.0.1:47870)──▶ the web page itself
      （pure forwarding, zero tool logic）                      （all tools execute here）
```

Page side: `MermaidToPng.html` hosts the Agent panel (port + pairing code + connect); the tools
`mtp_render` / `mtp_detect` are reported by the page via `/hello` and appear dynamically in the Agent's `tools/list`.

Page entry points (either one connects to the same local bridge):

- Visit http://www.jjmermaid.xin directly (recommended, always the latest version);
- Or double-click local `MermaidToPng.html` (works over file://, zero deployment).

## Local Files
```
agent/
├── mtp-mcp.mjs           # bridge: stdio MCP ↔ 127.0.0.1 HTTP (/pair /hello /poll /reply /file /bye)
├── README.md             # this document (English)
└── Agent_README_cn.md    # this document (Chinese)
```

Tool logic, the pairing UI and PNG encoding all live inside the `MermaidToPng.html` page. No Python, no venv, no third-party dependencies.

## MCP Registration

Add to the Agent's `mcp_servers` configuration:

```json
"mermaid-to-png": {
  "command": "node",
  "args": [
    "<project dir>/agent/mtp-mcp.mjs",
    "--port", "47870",
    "--root", "<output dir>/out",
    "--root", "~/Downloads"
  ],
  "connect_timeout": 30,
  "enabled": true
}
```

Restart the Agent for the change to take effect. `--root` may be given multiple times: the `output_path` of `mtp_render` must land inside one of these directories (relative paths join the first root); if omitted, the default is `~/Downloads`. `~` is expanded by the bridge itself (an MCP client launches node directly with no shell, so a literal `~/Downloads` is still resolved to the real user directory), and missing directories are created on drop. The port can be overridden via `--port` or the `MTP_MCP_PORT` environment variable (default 47870).

## First Use

1. Open the page: visit http://www.jjmermaid.xin or double-click local `MermaidToPng.html` (keep the page open)
2. The Agent calls `mtp_connect` → returns a 6-digit pairing code + port
3. In the page's "Agent" panel (top right): enter the port (47870) + pairing code → click "Connect" (连接)
4. Once paired, `tools/list` includes `mtp_render` / `mtp_detect`; everything after that is automatic

Every page disconnect/refresh or bridge restart rotates the pairing code; Agent-side tools will report "page not connected" — call `mtp_connect` again for the new code and re-pair.

## Manual Launch (clients without MCP registration)

If the Agent has no MCP registration for this bridge and only a terminal, launch the bridge yourself (**always pass `--keep`**: the bridge exits when stdin closes by default,
and a shell background/piped launch closes stdin immediately, killing the bridge silently):

```bash
node <project dir>/agent/mtp-mcp.mjs --port 47870 --keep --code AB12CD &
curl http://127.0.0.1:47870/status
# → {"name":"mtp-mcp","version":"2.0.0","paired":false,"port":47870,"code":"AB12CD"}
```

- `--code`: fixed pairing code (6 uppercase alphanumeric chars); survives restarts; random if omitted
- `--keep`: don't exit when stdin closes; stay resident as a standalone local service (MCP stdio unavailable in this mode, HTTP only)
- `/status` returns `code` directly to non-browser requests (curl / node / Agent scripts); browser fetch cannot get it (prevents malicious pages from auto-pairing)

Once you have the code, either:

1. Tell the user to enter it in the page's Agent panel (flow above); or
2. **Send the user the parameterized link — clicking it connects instantly**: `http://www.jjmermaid.xin/?mtp=47870:AB12CD` (local files work too: `MermaidToPng.html?mtp=47870:AB12CD`).

## Agent Tools

### `mtp_render(code, output_path, mode?, scale?, transparent?, background?)`

Renders Mermaid / SVG / HTML source into a PNG written to `output_path` (relative paths join the first root).

- `mode`: `auto` (default, uses the page's syntax detection) / `mermaid` / `svg` / `html`
- `scale`: integer factor 1–3, default 2; automatically steps down beyond the Canvas limit (recorded in `warnings`)
- `transparent`: transparent background (takes precedence over `background`); `background` defaults to `#ffffff`
- Success: `{ ok:true, mode, width, height, bytes, path, elapsed_ms, warnings[] }`
- Failure: `isError` + `{ ok:false, stage, message, detail }`, `stage`∈`detect/render/export/file`, `detail` contains the raw parser error
- PNG bytes go page→bridge via `/file` straight to disk and **never enter the Agent's context** (result <4KB)

### `mtp_detect(code)`

Pure syntax detection (`detectMode` wrapper), returns `{mode}`, renders nothing.

### `mtp_connect` (built into the bridge)

Connection status; when not connected, returns the pairing code and port — just relay them to the user.

## Self-Test

1. After pairing, `mtp_render(code="graph TD; A[中文]-->B", output_path="t1.png")` → file lands inside a root, PNG magic correct
2. One example per syntax (mermaid / svg / html)
3. Bad mermaid input → `isError` with the raw error in `detail`
4. `/file` path escape (`../x.png`, absolute path outside a root) → 403
5. Page refresh → old token invalidated, new pairing code generated
6. Five consecutive calls → no leftover node processes / port occupancy

The full acceptance checklist lives in `../ARCHITECTURE.md` §4.6.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `mtp_connect` keeps saying "not connected" | Page not open / panel not paired; confirm the port is 47870 and the code hasn't expired (every disconnect rotates the code — call `mtp_connect` again for the latest) |
| Pairing code "wrong" | The bridge restarted or the page disconnected, rotating the code; call `mtp_connect` again |
| Render fails at the `render` stage | Check the parser error in `detail` and fix the source; the page's preview area shows the same error |
| 403 path outside root | `output_path` is not inside any `--root`; use a relative path or add a root to the config |
| Page in background stops responding | Background-tab throttling — keep the tab in the foreground, or keep a dedicated window |
| 47870 already in use | Switch with `--port` (update the page panel to match) |
| Manually launched bridge exits instantly | Missing `--keep`: the bridge exits when stdin closes (MCP stdio lifecycle contract); manual/scripted launches must pass `--keep` |

## Maintenance

- After changing `MermaidToPng.html`, sync `deploy/index.html` (byte-for-byte copy).
- The live site `http://www.jjmermaid.xin` serves the `deploy/` directory; the web page connects to the user's local bridge (CORS + Private Network preflight already handled).
- The `__mtpAgent` core, like `window.__mtp`, only ever gains methods — signatures never change.
