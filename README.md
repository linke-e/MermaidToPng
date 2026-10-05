# MermaidToPng
Mermaid 代码转 PNG 图片工具（便携版）
将 Mermaid 图表代码渲染为高清 PNG 图片，单文件、免安装、离线可用。
## 特性
- **零依赖** —— 只需一个现代浏览器（Edge / Chrome / Firefox），无需安装、无需联网、无任何运行时依赖
- **便携** —— 拷到 U 盘 / 其他电脑均可直接使用，最省事只带 `MermaidToPng-standalone.html` 一个文件
- **灵活预览** —— 滚轮缩放 / 拖拽移动 / 双击适应窗口 / 底色所见即所得
- **高清导出** —— 支持 1x / 2x / 3x 倍率，可选底色或真透明 PNG
- **本地保存** —— 代码草稿和偏好自动存在浏览器本地（localStorage）
## 快速使用
双击 `MermaidToPng-standalone.html`（或 `MermaidToPng.bat`）即可打开，然后：
1. 左侧 Code 页粘贴 Mermaid 代码
   （语法参考：https://mermaid.ai/open-source/syntax/flowchart.html ）
2. 右侧预览：滚轮缩放 / 拖拽移动 / 双击适应窗口 / 底色所见即所得
3. 选倍率（1x / 2x / 3x）、底色或透明底 → 点「下载 PNG」→ 浏览器弹出保存位置
## 环境要求
只需一个现代浏览器（Edge / Chrome / Firefox）。无需安装、无需联网、无任何运行时依赖。拷到 U 盘 / 其他电脑均可直接用——最省事只带 `MermaidToPng-standalone.html` 一个文件。
## 文件说明
| 文件 | 说明 |
|------|------|
| `MermaidToPng-standalone.html` | 单文件版（mermaid 库已内置，推荐携带/分享） |
| `MermaidToPng.bat` | 双击用默认浏览器打开单文件版 |
| `Mermaid.html` + `mermaid.min.js` | 开发版（库与页面分离，便于升级 mermaid） |
| `fetch_mermaid.py` | 升级 mermaid 库（需 Python 3，仅标准库，可选） |
| `build_portable.py` | 重新生成单文件版与便携 zip（需 Python 3，仅标准库） |
| `ARCHITECTURE.md` | 架构文档 |
| `sample-output.png` | 导出效果样例 |
## 注意事项
 代码草稿和偏好存在浏览器本地（localStorage），不跟随文件走，换电脑从默认示例开始
## 升级 mermaid 库
```bash
python fetch_mermaid.py      # 拉取新版 mermaid.min.js
python build_portable.py     # 重新生成单文件版与 zip
```
