# MermaidToPng
Mermaid / SVG / HTML to PNG converter
Render Mermaid diagrams, SVG vector graphics, HTML fragments or full web pages into high-resolution PNG images. Single file, no installation, works offline.
Online version: http://www.jjmermaid.xin

## Features
- **Three syntaxes** — paste Mermaid / SVG / HTML, all renderable and exportable; syntax is auto-detected, or you can pick a mode manually
- **Appearance settings** — upload an image as the global background with four live-adjustable parameters (fill mode / zoom / blur / mask strength; numeric inputs, no sliders); the header bar and both page top bars enable glass blur automatically; the three main headings take the image's dominant color while remaining text blends against the background via difference; all settings, including the background image, persist locally
- **Zero dependencies** — just a modern browser (Edge / Chrome / Firefox); nothing to install, no network needed, no runtime dependencies
- **Portable** — copy it to a USB stick / another computer and it just works; the minimal carry is the single `MermaidToPng.html` file
- **Flexible preview** — wheel zoom / drag to pan / WYSIWYG background color (supported in all three modes; the "Fit" and "1:1" buttons adjust the view)
- **Visual editing** — the "Edit" tab in the left pane is WYSIWYG: drag components in / click-connect edges (arrow · solid · dashed, with draggable bend points and re-pickable endpoints) / double-click to edit node text and edge labels / drag to move with 8-way resize / dashed grid guides (toggle + adjustable spacing, fills the canvas, colors adapt to the background, never exported into the PNG); grouped editing for font / color / appearance / layout, multi-select batch operations, undo/redo (Ctrl+Z/Y); the editing document can be saved as `.mte` / re-imported, and the scene auto-restores after a page refresh
- **HD export** — 1x / 2x / 3x scale factors (automatically steps down when exceeding the browser Canvas limit), optional background color or true transparency
- **Local saving** — code drafts, syntax mode and appearance settings are stored automatically in the browser (localStorage)
- **Agent interface** — any MCP Agent can go straight from "diagram source → PNG on disk": all tools execute inside the web page, and the local bridge is a pure-forwarding zero-dependency relay (see `agent/README.md`)

## Quick Start
Open the page via either entry: the online version at http://www.jjmermaid.xin, or double-click local `MermaidToPng.html` (or `MermaidToPng.bat`). Then:
1. Paste code into the Code pane on the left (top-left selector: "Auto detect / Mermaid / SVG / HTML", auto-detect by default):
   - Mermaid: `graph TD` / `sequenceDiagram` etc. (syntax reference: https://mermaid.ai/open-source/syntax/flowchart.html )
   - SVG: an `<svg>...</svg>` fragment (an `<?xml ...?>` declaration and leading comments are accepted)
   - HTML: a full `<!DOCTYPE html>` document or a `<div>`-style fragment (inline styles recommended)
2. Preview on the right: wheel zoom / drag to pan / WYSIWYG background color (the "Fit" and "1:1" buttons adjust the view)
3. Pick a scale (1x / 2x / 3x) and a background color or transparent → click "Download PNG" (下载 PNG) → the browser asks where to save
4. Visual editing (optional): click the "Edit" (编辑) tab in the left pane to enter WYSIWYG editing — drag nodes in from the "Components" group, click-connect edges, double-click to edit text; changes sync back into the Mermaid source automatically, and `Ctrl+Alt+S` saves the editing document as `.mte`

### HTML Mode Notes
- HTML without intrinsic sizes lays out at a 900px working width: it widens automatically when the content needs more room (up to 3840px), and height is always measured from the actual content; full documents with explicit width/height use their own dimensions
- Preview and export execute `<script>` tags in the pasted HTML (export captures the final state after execution) — paste trusted content only
- The export pipeline loads no external resources: inline images as base64 data URLs and keep CSS in `<style>` / `style` attributes

## Requirements
Just a modern browser (Edge / Chrome / Firefox). Nothing to install, no network, no runtime dependencies. Copy to a USB stick / another computer and it works — the minimal carry is the single `MermaidToPng.html` file.

## Files
| File | Description |
|------|------|
| `MermaidToPng.html` | Main file (mermaid library inlined; recommended for carrying/sharing) |
| `MermaidToPng.bat` | Double-click to open the main file in the default browser |
| `deploy/` | Deployment directory: `index.html` byte-identical to the main file + a copy of `mermaid.min.js` |
| `mermaid.min.js` | Official mermaid v11.4.1 UMD (for library upgrades) |
| `fetch_mermaid.py` | Upgrades the mermaid library (needs Python 3, stdlib only, optional) |
| `agent/mtp-mcp.mjs` | Agent-interface MCP bridge (optional add-on; pure forwarding + file drop, zero dependencies, Node 18+) |
| `agent/README.md` | Agent interface guide (MCP registration / pairing / troubleshooting) |
| `ARCHITECTURE.md` | Architecture document (render & export / Agent interface / editor) |
| `README_cn.md` / `ARCHITECTURE_cn.md` / `agent/Agent_README_cn.md` | Chinese versions of the three documents above |

## Agent Interface in a Nutshell
1. On the Agent side, start the bridge and call `mtp_connect` → get the port (default 47870) and a 6-digit pairing code
2. Open the page (online or local), click the "Agent" button to the left of "Appearance" (外观) in the header → enter the port + pairing code → connect
3. From then on the Agent calls `mtp_render(code, output_path)` to render Mermaid / SVG / HTML into a PNG written under the sandboxed `--root` directories

See `agent/README.md` and `ARCHITECTURE.md` §4 for details.

## Notes
- Code drafts, syntax mode and preferences live in the browser (localStorage) and do not travel with the file; on a new computer you start from the default example

## Upgrading the mermaid library
```bash
python fetch_mermaid.py      # pulls a new mermaid.min.js
```
After pulling, re-inline the new library into `MermaidToPng.html` (replace the first inline `<script>...</script>` block in the file, i.e. the block holding the mermaid library).

## Spinning Stone (One Hour)
![Stone Badge](https://stone.professorlee.work/api/stone/linke-e/MermaidToPng)
