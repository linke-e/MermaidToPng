#!/usr/bin/env node
// MermaidToPng 的本地 MCP 桥。
// 对 Agent 是一个 stdio MCP 服务器；对浏览器里的 MermaidToPng 页面是一个只监听 127.0.0.1
// 的 HTTP 服务（页面长轮询取请求、回传结果）。工具逻辑全部在页面里执行（MermaidToPng.html
// 的 window.__mtpAgent），这里只转发 + 一个通用 /file 落盘端点（根目录沙箱，纯 I/O）。
// 没有依赖，Node 18+ 可直接运行：
//
//   node mtp-mcp.mjs [--port 47870] [--root <dir>]...
//
// 配对：页面「Agent」面板里填这里给出的一次性配对码（agent 可以调用 mtp_connect 拿到它并告诉用户）。
// 配对成功后页面拿到一个随机令牌，之后每个请求都要带它；再配对会让旧令牌失效并换一个新配对码。
import { randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve as resolvePath, sep as pathSep, win32 as pathWin32 } from 'node:path';
const VERSION = '2.0.0';
const PROTOCOL_VERSION = '2025-06-18';
const POLL_WAIT_MS = 25_000;
const PAGE_TIMEOUT_MS = 45_000;
const CALL_TIMEOUT_MS = 30 * 60_000;

const argValues = (name) => {
    const values = [];
    for (let i = 0; i < process.argv.length; i++) {
        if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
    }
    return values;
};
const argValue = (name, fallback) => argValues(name)[0] ?? fallback;
const PORT = Number(argValue('--port', process.env.MTP_MCP_PORT ?? '47870'));
// --code：固定配对码（手动/脚本启动时 Agent 自选，免去抓 stderr）；--keep：stdin 关闭不退出
//（MCP stdio 未挂接的手动场景，如 `start node mtp-mcp.mjs --keep --code AB12CD`）。
const FIXED_CODE = String(argValue('--code', process.env.MTP_MCP_CODE ?? '')).trim().toUpperCase();
const KEEP_ALIVE = process.argv.includes('--keep');
const ROOTS = (argValues('--root').length
    ? argValues('--root')
    : [process.env.MTP_MCP_ROOT]).filter(Boolean).map(r => resolvePath(r));
const DEFAULT_ROOT = resolvePath(homedir(), 'Downloads');
const rootAt = (i) => ROOTS[i] ?? DEFAULT_ROOT;

const log = (...parts) => process.stderr.write(`[mtp-mcp] ${parts.join(' ')}\n`);

// ---------------------------------------------------------------------------------------------
// 页面会话

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const state = {
    code: /^[A-Z0-9]{6}$/.test(FIXED_CODE) ? FIXED_CODE : newCode(),
    token: null,
    origin: null,
    lastSeen: 0,
    tools: [],
    prompts: [],
    queue: [],
    waiting: null,
    pending: new Map(),
    nextId: 1,
};

const connected = () => Boolean(state.token) && Date.now() - state.lastSeen < PAGE_TIMEOUT_MS;

const disconnect = (reason) => {
    if (!state.token) return;
    log(`页面断开（${reason}）。新的配对码：${state.code}`);
    state.token = null;
    state.tools = [];
    state.prompts = [];
    for (const [, pending] of state.pending) pending.reject(new Error('MermaidToPng 页面断开了'));
    state.pending.clear();
    state.queue = [];
    notify('notifications/tools/list_changed');
    notify('notifications/prompts/list_changed');
};

setInterval(() => {
    if (state.token && !connected()) disconnect('超时');
}, 5_000).unref();

/** 把一个请求交给页面执行，等它回传。 */
const forward = (method, params, timeout = CALL_TIMEOUT_MS) => new Promise((resolve, reject) => {
    if (!connected()) {
        reject(new Error('MermaidToPng 页面没有连接'));
        return;
    }
    const id = state.nextId++;
    const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error('MermaidToPng 页面没有在限定时间内回应'));
    }, timeout);
    state.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
    });
    state.queue.push({ id, method, params });
    flushQueue();
});

const flushQueue = () => {
    if (!state.waiting || state.queue.length === 0) return;
    const { res, timer } = state.waiting;
    state.waiting = null;
    clearTimeout(timer);
    sendJson(res, 200, state.queue.shift());
};

// ---------------------------------------------------------------------------------------------
// HTTP（页面一侧）

const corsHeaders = (req) => {
    const origin = req.headers.origin;
    return {
        'Access-Control-Allow-Origin': origin && origin !== 'null' ? origin : 'null',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        // Chrome 访问本机地址前的预检（Private / Local Network Access）。
        'Access-Control-Allow-Private-Network': 'true',
        Vary: 'Origin',
    };
};

let currentReq = null;
const sendJson = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(res.req ?? currentReq ?? { headers: {} }) });
    res.end(body === undefined ? '' : JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) {
            reject(new Error('请求体过大'));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        try {
            resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch (error) {
            reject(error);
        }
    });
    req.on('error', reject);
});

const authorized = (req) => {
    const header = req.headers.authorization ?? '';
    return Boolean(state.token) && header === `Bearer ${state.token}`;
};

// /file 根目录沙箱：resolve 后必须落在某个 --root 内（Windows 大小写不敏感前缀比对）。
const inRoots = (abs) => ROOTS.some((root) => {
    const r = resolvePath(root), p = resolvePath(abs);
    const rl = pathWin32.normalize(r).toLowerCase().replace(/[\\/]+$/, '');
    const pl = pathWin32.normalize(p).toLowerCase();
    return pl === rl || pl.startsWith(rl + pathSep) || pl.startsWith(rl + '/');
});

const server = createServer(async (req, res) => {
    currentReq = req;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
    }
    try {
        if (req.method === 'GET' && url.pathname === '/status') {
            // 浏览器发起的 fetch 必带 Origin / Sec-Fetch-Site：对这些请求不给配对码，
            // 防恶意网页自动配对；curl / node / Agent 脚本（无这些头）可直接取码。
            const site = String(req.headers['sec-fetch-site'] ?? '');
            const browserFetch = Boolean(req.headers.origin)
                || ['cross-site', 'same-site', 'same-origin'].includes(site);
            sendJson(res, 200, {
                name: 'mtp-mcp', version: VERSION, paired: connected(), port: PORT,
                ...(browserFetch ? {} : { code: state.code }),
            });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/pair') {
            const body = await readBody(req);
            if (String(body.code ?? '').trim().toUpperCase() !== state.code) {
                sendJson(res, 403, { error: '配对码不对' });
                return;
            }
            if (state.token) disconnect('被新的页面替换');
            state.token = randomBytes(24).toString('hex');
            state.origin = req.headers.origin ?? null;
            state.lastSeen = Date.now();
            state.code = newCode();
            log(`页面已配对（${state.origin ?? '未知来源'}）`);
            sendJson(res, 200, { token: state.token, version: VERSION });
            return;
        }
        if (!authorized(req)) {
            sendJson(res, 401, { error: '没有配对或令牌已失效' });
            return;
        }
        state.lastSeen = Date.now();
        if (req.method === 'POST' && url.pathname === '/hello') {
            const body = await readBody(req);
            state.tools = Array.isArray(body.tools) ? body.tools : [];
            state.prompts = Array.isArray(body.prompts) ? body.prompts : [];
            notify('notifications/tools/list_changed');
            notify('notifications/prompts/list_changed');
            sendJson(res, 200, { ok: true });
            return;
        }
        if (req.method === 'GET' && url.pathname === '/poll') {
            if (state.queue.length > 0) {
                sendJson(res, 200, state.queue.shift());
                return;
            }
            if (state.waiting) {
                // 同一时刻只保留一个长轮询。
                const previous = state.waiting;
                clearTimeout(previous.timer);
                sendJson(previous.res, 204);
            }
            const timer = setTimeout(() => {
                if (state.waiting?.res === res) state.waiting = null;
                sendJson(res, 204);
            }, POLL_WAIT_MS);
            state.waiting = { res, timer };
            req.on('close', () => {
                if (state.waiting?.res === res) {
                    clearTimeout(timer);
                    state.waiting = null;
                }
            });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/reply') {
            const body = await readBody(req);
            const pending = state.pending.get(body.id);
            if (pending) {
                state.pending.delete(body.id);
                if (body.error) pending.reject(new Error(String(body.error)));
                else pending.resolve(body.result);
            }
            sendJson(res, 200, { ok: true });
            return;
        }
        // 通用落盘端点：页面 → 磁盘的纯传输件（渲染字节不进 Agent 上下文）。不含任何渲染知识。
        if (req.method === 'POST' && url.pathname === '/file') {
            const body = await readBody(req);
            let out = String(body.path ?? '').trim();
            if (!out) {
                sendJson(res, 400, { error: 'path 为空' });
                return;
            }
            if (!/\.[A-Za-z0-9]+$/.test(out)) out += '.png';
            // 相对路径拼第一个 root（§8.4）；~ 展开；绝对路径必须 resolve 后落在某个 root 内
            const expandTilde = out.startsWith('~') ? out.replace(/^~(?=\/|\\|$)/, homedir()) : out;
            const abs = pathWin32.isAbsolute(expandTilde)
                ? resolvePath(expandTilde)
                : resolvePath(rootAt(0), expandTilde);
            if (!inRoots(abs)) {
                sendJson(res, 403, { error: 'path outside root', roots: ROOTS });
                return;
            }
            const info = await mkdir(dirname(abs), { recursive: true })
                .then(() => writeFile(abs, Buffer.from(String(body.base64 ?? ''), 'base64'), { flag: body.overwrite ? 'w' : 'wx' }))
                .then(() => null)
                .catch((error) => error);
            if (info) {
                const exists = info.code === 'EEXIST';
                sendJson(res, exists ? 409 : 500, { error: exists ? 'file exists（overwrite 未开）' : info.message });
                return;
            }
            const bytes = Buffer.from(String(body.base64 ?? ''), 'base64').length;
            log(`落盘 ${abs}（${bytes} B）`);
            sendJson(res, 200, { ok: true, path: abs, bytes });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/bye') {
            disconnect('页面主动断开');
            sendJson(res, 200, { ok: true });
            return;
        }
        sendJson(res, 404, { error: 'not found' });
    } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
});

server.on('error', error => {
    log(`无法监听 127.0.0.1:${PORT}：${error.message}`);
    process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
    log(`在 http://127.0.0.1:${PORT} 等待 MermaidToPng 页面。落盘根目录：${ROOTS.join(' ; ') || DEFAULT_ROOT}。配对码：${state.code}`);
});

// ---------------------------------------------------------------------------------------------
// stdio MCP（agent 一侧）

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let initialized = false;
const notify = (method, params) => {
    if (initialized) write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
};

const CONNECT_TOOL = {
    name: 'mtp_connect',
    title: '连接 MermaidToPng 页面',
    description: 'Connection status of the MermaidToPng page (Mermaid / SVG / HTML -> PNG). When not connected it returns a one-time pairing code: tell the user to open MermaidToPng.html (or the deploy page), open the "Agent" panel at the bottom-left and enter the code (port shown too). Call again to check; the page tools appear once connected.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
};

const connectStatus = () => (connected()
    ? { content: [{ type: 'text', text: `已连接 MermaidToPng 页面（${state.origin ?? '未知来源'}），可用工具 ${state.tools.length} 个。` }] }
    : { content: [{ type: 'text', text: `还没有连接。请用户打开 MermaidToPng.html，左下角「Agent」面板里填写端口 ${PORT} 和配对码 ${state.code}，然后点「连接」。` }] });

const handlers = {
    initialize: (params) => {
        initialized = true;
        return {
            protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: true }, prompts: { listChanged: true } },
            serverInfo: { name: 'mermaid-to-png', title: 'MermaidToPng 图表渲染', version: VERSION },
            instructions: 'Tools operate on the MermaidToPng page open in the user\'s browser (Mermaid / SVG / HTML -> PNG; all rendering runs in the page, PNG bytes are written to disk by the local bridge and never enter context). If no page is connected, call mtp_connect and relay the pairing code to the user. Use mtp_render to write diagram PNGs to disk; use mtp_detect to check syntax without rendering. output_path must stay inside the configured roots.',
        };
    },
    ping: () => ({}),
    'tools/list': () => ({ tools: [CONNECT_TOOL, ...(connected() ? state.tools : [])] }),
    'tools/call': async (params) => {
        if (params?.name === CONNECT_TOOL.name) return connectStatus();
        if (!connected()) {
            return { content: [{ type: 'text', text: `MermaidToPng 页面没有连接。${connectStatus().content[0].text}` }], isError: true };
        }
        try {
            return await forward('tools/call', { name: params?.name, arguments: params?.arguments ?? {} });
        } catch (error) {
            return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
    },
    'prompts/list': () => ({ prompts: connected() ? state.prompts : [] }),
    'prompts/get': async (params) => {
        if (!connected()) throw Object.assign(new Error('MermaidToPng 页面没有连接'), { code: -32002 });
        return forward('prompts/get', { name: params?.name, arguments: params?.arguments ?? {} }, 60_000);
    },
};

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try {
        message = JSON.parse(line);
    } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
    }
    if (message.id === undefined || message.id === null) return; // 通知
    const handler = handlers[message.method];
    if (!handler) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
        return;
    }
    try {
        write({ jsonrpc: '2.0', id: message.id, result: await handler(message.params) });
    } catch (error) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error instanceof Error ? error.message : String(error) } });
    }
});
rl.on('close', () => {
    if (KEEP_ALIVE) {
        log('stdin 已关闭（--keep）：以独立本地服务模式继续运行（MCP stdio 不可用，仅 HTTP）');
        return;
    }
    server.close();
    process.exit(0);
});
