# MermaidToPng Agent 接口层 ：桥模式

> 让任意 Agent 在会话内直接「图表源码 → PNG 落盘」。
> **工具全部在网页里执行**；本地只有 `agent/mtp-mcp.mjs` 一个纯转发 MCP 桥（零依赖，Node 18+）。
> 架构与设计决策见 `../ARCHITECTURE.md` §8。**已实现并实测通过**（2026-10-06，e2e 18/18，清单见 §8.8）。

```
Agent ──stdio MCP──▶ mtp-mcp.mjs ──HTTP长轮询(127.0.0.1:47870)──▶ 网页自身
      （纯转发，零工具逻辑）                      （工具全部在这执行）
```

页面侧：`MermaidToPng.html` 新增 Agent 面板（端口 + 配对码 + 连接），工具
`mtp_render` / `mtp_detect` 由页面经 `/hello` 上报，动态出现在 Agent 的 `tools/list`。

页面入口（任选其一，均连同一个本地桥）：

- 直接访问 http://www.jjmermaid.xin（推荐，始终最新版）；
- 或双击本地 `MermaidToPng.html`（file:// 可用，零部署）。

## 本地文件
```
agent/
├── mtp-mcp.mjs    # 桥：stdio MCP ↔ 127.0.0.1 HTTP（/pair /hello /poll /reply /file /bye）
└── README.md      # 本文档
```

工具逻辑、配对 UI、PNG 编码全在 `MermaidToPng.html` 页面内。无 Python、无 venv、无第三方依赖。

## MCP 注册

在 Agent 的 `mcp_servers` 配置中添加（各客户端通用，键名兼容）：

```json
"mermaid-to-png": {
  "command": "node",
  "args": [
    "<项目目录>/agent/mtp-mcp.mjs",
    "--port", "47870",
    "--root", "<输出目录>/out",
    "--root", "~/Downloads"
  ],
  "connect_timeout": 30,
  "enabled": true
}
```

改完重启 Agent 生效。`--root` 可多个：`mtp_render` 的 `output_path` 只能落在这些目录内（相对路径拼第一个 root）；不传则默认 `~/Downloads`。端口可用 `--port` 或环境变量 `MTP_MCP_PORT` 覆盖（默认 47870）。

## 首次使用

1. 打开页面：访问 http://www.jjmermaid.xin 或双击本地 `MermaidToPng.html`（页面须保持开着）
2. Agent 调用 `mtp_connect` → 返回 6 位配对码 + 端口
3. 页面右上角「Agent」面板：填端口（47870）+ 配对码 → 点「连接」
4. 配对成功后 `tools/list` 出现 `mtp_render` / `mtp_detect`，此后全程自动

每次页面断开/刷新或桥重启都会换新配对码；Agent 端工具会报「页面未连接」，重调 `mtp_connect` 取新码再配对即可。

## 手动启动（不想注册 MCP 的客户端）

Agent 没有本桥的 MCP 注册、只有终端时，自己拉起桥（**务必带 `--keep`**：桥默认随 stdin 关闭退出，
shell 后台/管道方式启动 stdin 会立刻关闭导致静默死亡）：

```bash
node <项目目录>/agent/mtp-mcp.mjs --port 47870 --keep --code AB12CD &
curl http://127.0.0.1:47870/status
# → {"name":"mtp-mcp","version":"2.0.0","paired":false,"port":47870,"code":"AB12CD"}
```

- `--code`：固定配对码（6 位大写字母数字），重启不再换码；不传则随机
- `--keep`：stdin 关闭不退出，以独立本地服务模式驻留（此模式 MCP stdio 不可用，仅 HTTP）
- `/status` 对非浏览器请求（curl / node / Agent 脚本）直接返回 `code`，浏览器 fetch 拿不到（防恶意网页自动配对）

拿到码后二选一：

1. 告诉用户在页面 Agent 面板填码连接（流程同上）；
2. **把带参链接发给用户，点开即连**：`http://www.jjmermaid.xin/?mtp=47870:AB12CD`（本地文件亦可：`MermaidToPng.html?mtp=47870:AB12CD`）。

## Agent 工具

### `mtp_render(code, output_path, mode?, scale?, transparent?, background?)`

把 Mermaid / SVG / HTML 源码渲染成 PNG 写入 `output_path`（相对路径 = 拼第一个 root）。

- `mode`：`auto`（默认，走页面语法检测）/ `mermaid` / `svg` / `html`
- `scale`：1–3 整数倍率，默认 2；超 Canvas 上限自动降倍率（降级记入 `warnings`）
- `transparent`：透明底（优先于 `background`）；`background` 默认 `#ffffff`
- 成功：`{ ok:true, mode, width, height, bytes, path, elapsed_ms, warnings[] }`
- 失败：`isError` + `{ ok:false, stage, message, detail }`，`stage`∈`detect/render/export/file`，`detail` 含原始 parser 报错
- PNG 字节经页面→桥 `/file` 直落磁盘，**不进 Agent 上下文**（结果 <4KB）

### `mtp_detect(code)`

纯语法检测（`detectMode` 包装），返回 `{mode}`，不渲染。

### `mtp_connect`（桥内置）

连接状态；未连接时返回配对码与端口，转告用户即可。

## 自测

1. 配对后 `mtp_render(code="graph TD; A[中文]-->B", output_path="t1.png")` → 文件在 root 内，PNG magic 正确
2. 三语法各跑一例（mermaid / svg / html）
3. 坏 mermaid 输入 → `isError` 且 `detail` 含原始报错
4. `/file` 越界路径（`../x.png`、root 外绝对路径）→ 403
5. 页面刷新 → 旧 token 失效，新配对码生成
6. 连续 5 次调用，无残留 node 进程 / 端口占用

完整验收清单见 `../ARCHITECTURE.md` §8.8。

## 排障

| 症状 | 处理 |
|---|---|
| `mtp_connect` 一直「未连接」 | 页面没开 / 面板没配对；确认端口填 47870、配对码未过期（每次断开换新码，重调 `mtp_connect` 拿最新的） |
| 配对码「不对」 | 桥重启或页面断开后已换新码；重调 `mtp_connect` |
| 渲染报 `render` 阶段错 | 看 `detail` 里的 parser 报错，修源码；页面预览区同时会显示同一错误 |
| 403 path outside root | `output_path` 不在 `--root` 列表内；用相对路径或去配置里加 root |
| 页面后台不动了 | 后台标签页节流——把页面标签页保持前台，或常驻一个窗口 |
| 47870 被占 | 换 `--port`（页面面板同步改） |
| 手动启动的桥秒退 | 没带 `--keep`：stdin 关闭桥即退出（MCP stdio 生命周期约定）；手动/脚本启动必须 `--keep` |

## 维护

- `MermaidToPng.html` 改动后同步 `deploy/index.html`（逐字节拷贝）。
- 线上站点 `http://www.jjmermaid.xin` 部署 `deploy/` 目录内容即可，网页版连用户本地的桥（CORS + Private Network 预检已处理）。
- `__mtpAgent` 内核与 `window.__mtp` 一样只增不改签名。
