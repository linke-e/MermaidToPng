# MermaidToPng
Mermaid / SVG / HTML 代码转 PNG 图片工具
将 Mermaid 图表、SVG 矢量图、HTML 片段或完整网页渲染为高清 PNG，单文件、免安装、离线可用。
线上版 http://www.jjmermaid.xin
## 特性
- **三语法支持** —— 粘贴 Mermaid / SVG / HTML 均可渲染导出，语法自动识别，也可手动指定模式
- **外观设置** —— 上传图片设为全局背景，填充方式 / 缩放 / 模糊 / 遮罩强度四参数实时可调（数字输入，无滑块）；标题栏与两个页面顶部栏自动启用玻璃模糊；三个主标题取图片主色，其余文字与背景图差值混合；设置含背景图一并持久化到本地
- **零依赖** —— 只需一个现代浏览器（Edge / Chrome / Firefox），无需安装、无需联网、无任何运行时依赖
- **便携** —— 拷到 U 盘 / 其他电脑均可直接使用，最省事只带 `MermaidToPng.html` 一个文件
- **灵活预览** —— 滚轮缩放 / 拖拽移动 / 底色所见即所得（三种模式均支持；「适应」「1:1」按钮调整视图）
- **可视化编辑** —— 左栏「编辑」Tab 所见即所得：组件拖入 / 点选连线（箭头·实线·虚线，可拖弯折、改端点）/ 双击改文字与边标注 / 拖拽移动与 8 向缩放 / 行列虚线辅助线（滑块开关 + 间距可调，铺满画布，配色自适应底色，不进入导出 PNG）；字体 / 颜色 / 外观 / 布局分组编辑，多选批量操作，撤销重做（Ctrl+Z/Y）；编辑文档可存为 `.mte` / 导入，刷新自动恢复现场
- **高清导出** —— 支持 1x / 2x / 3x 倍率（超浏览器 Canvas 上限自动降倍率），可选底色或真透明 PNG
- **本地保存** —— 代码草稿、语法模式、外观设置自动存在浏览器本地（localStorage）
- **Agent 接口** —— 任意 MCP Agent 可直接「图表源码 → PNG 落盘」：工具全在网页里执行，本地桥纯转发零依赖（详见 `agent/README.md`）
## 快速使用
打开页面后操作（任选入口）：线上版 http://www.jjmermaid.xin，或双击本地 `MermaidToPng.html`（或 `MermaidToPng.bat`）。然后：
1. 左侧 Code 页粘贴代码（左上角可选「自动检测 / Mermaid / SVG / HTML」，默认自动识别）：
   - Mermaid：`graph TD` / `sequenceDiagram` 等（语法参考：https://mermaid.ai/open-source/syntax/flowchart.html ）
   - SVG：`<svg>...</svg>` 片段（可带 `<?xml ...?>` 声明与注释前缀）
   - HTML：完整 `<!DOCTYPE html>` 文档或 `<div>` 等片段（建议内联样式）
2. 右侧预览：滚轮缩放 / 拖拽移动 / 底色所见即所得（「适应」「1:1」按钮调整视图）
3. 选倍率（1x / 2x / 3x）、底色或透明底 → 点「下载 PNG」→ 浏览器弹出保存位置
4. 可视化编辑（可选）：点左栏「编辑」Tab 进入所见即所得编辑——从「组件」分组拖入节点、点选连线、双击改文字；改动自动同步回 Mermaid 源码，`Ctrl+Alt+S` 把编辑文档存为 `.mte`
### HTML 模式说明
- 没有自然尺寸的 HTML 以工作宽 900px 布局：内容想更宽则自动放宽（上限 3840px），高度始终按内容实测；自带显式宽高的完整文档按文档自身尺寸
- 预览与导出会执行 HTML 中的 `<script>`（导出截取执行后的最终画面），请粘贴可信内容
- 导出管线不加载外部资源：图片请用 base64 data URL 内联，CSS 写在 `<style>` / `style` 属性里
## 环境要求
只需一个现代浏览器（Edge / Chrome / Firefox）。无需安装、无需联网、无任何运行时依赖。拷到 U 盘 / 其他电脑均可直接用——最省事只带 `MermaidToPng.html` 一个文件。
## 文件说明
| 文件 | 说明 |
|------|------|
| `MermaidToPng.html` | 主文件（mermaid 库已内置，推荐携带/分享） |
| `MermaidToPng.bat` | 双击用默认浏览器打开主文件 |
| `deploy/` | 部署目录：`index.html` 与主文件逐字节同步 + `mermaid.min.js` 库副本 |
| `mermaid.min.js` | mermaid v11.4.1 官方 UMD（升级库时用） |
| `fetch_mermaid.py` | 升级 mermaid 库（需 Python 3，仅标准库，可选） |
| `agent/mtp-mcp.mjs` | Agent 接口层 MCP 桥（可选增强；纯转发 + 落盘，零依赖 Node 18+） |
| `agent/README.md` | Agent 接口层说明（MCP 注册 / 配对 / 排障） |
| `ARCHITECTURE.md` | 架构文档（渲染导出 / Agent 接口层 / 编辑层） |
## Agent 接口速览
1. Agent 侧启动桥并调 `mtp_connect` → 得到端口（默认 47870）与 6 位配对码
2. 打开页面（线上或本地），点 header「外观」左侧的「Agent」按钮 → 填端口 + 配对码 → 连接
3. 此后 Agent 调 `mtp_render(code, output_path)` 即可把 Mermaid / SVG / HTML 渲染成 PNG 写入指定目录（`--root` 沙箱内）

详见 `agent/README.md` 与 `ARCHITECTURE.md` §4。
## 注意事项
- 代码草稿、语法模式和偏好存在浏览器本地（localStorage），不跟随文件走，换电脑从默认示例开始
## 升级 mermaid 库
```bash
python fetch_mermaid.py      # 拉取新版 mermaid.min.js
```
拉取后需将新库重新内联进 `MermaidToPng.html`（替换文件中第一个 `<script>...</script>` 内联块，即 mermaid 库所在块）。
## 石墩子旋转一小时
![Stone Badge](https://stone.professorlee.work/api/stone/linke-e/MermaidToPng)