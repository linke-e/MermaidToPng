// 在 jjmermaid 页面里执行一段 JS（argv[2] = 表达式文件路径），打印结果
const list = await fetch('http://127.0.0.1:9223/json').then(r => r.json());
const page = list.find(t => t.type === 'page' && /jjmermaid/.test(t.url));
if (!page) { console.error('PAGE_NOT_FOUND'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++mid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
});
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const expr = (await import('node:fs/promises')).readFile(process.argv[2], 'utf8');
const r = await send('Runtime.evaluate', { expression: await expr, returnByValue: true, awaitPromise: true, userGesture: true });
if (r.exceptionDetails) console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails, null, 1));
else console.log(typeof r.result?.value === 'string' ? r.result.value : JSON.stringify(r.result?.value, null, 1));
ws.close();
process.exit(0);
