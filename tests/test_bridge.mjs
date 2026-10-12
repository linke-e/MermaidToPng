#!/usr/bin/env node
// MermaidToPng 本地桥（agent/mtp-mcp.mjs）的回归测试。零依赖，Node 18+。
//
// 用法:
//   node tests/test_bridge.mjs                # MTP_STRICT=1（默认）全量运行（含安全加固类 strict 用例）
//   MTP_STRICT=0 node tests/test_bridge.mjs   # 降级运行：跳过安全加固类 strict 用例
//
// MTP_STRICT 机制（降级开关）：三项安全加固用例标注 strict=true——
//   ① 伪造 Host 头应 403（用例 2）
//   ② 配对连续失败限速，第 6 次正确码应 429（用例 5）
//   ③ /file 的 base64 解码上限，>32MB 应 413（用例 6）
// MTP_STRICT=1（默认）全量跑；MTP_STRICT=0 时跳过 strict 用例、其余仍全跑，
// 退出码只取决于非 strict 用例——供桥再次改动的过渡期降级使用。
// 现状（2026-10-12）：桥已实现三项加固（hostAllowed / pairGuard / MAX_DECODED），
// 默认全量应全绿；若加固回退导致 strict 用例失败，可临时 MTP_STRICT=0 降级并单独排查。
//
// 每个用例组独立 spawn 一个桥进程：随机空闲端口（net 临时 server 探测后关闭）、
// --root 用 fs.mkdtemp(os.tmpdir())、--code 固定配对码；stdio 保持管道
// （stdin 不关桥就不退出），测完 kill 进程并清理临时目录。HTTP 调用走 node:http
// request（伪造 Host 头是 fetch 不支持的场景）。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_ENTRY = join(REPO_ROOT, 'agent', 'mtp-mcp.mjs');
const STRICT = process.env.MTP_STRICT !== '0';
const FIXED_CODE = 'AB12CD'; // 桥的固定配对码：6 位 [A-Z0-9]
const WRONG_CODE = 'ZZZZZZ';
const SMALL_B64 = Buffer.from('hello mtp bridge\n').toString('base64');

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------------------------------------------------------------------------------------------
// HTTP 与进程辅助

/** 随机空闲端口：net 起临时 server 绑 0 号端口，取到后关闭。 */
const freePort = () => new Promise((ok, fail) => {
  const probe = createServer();
  probe.on('error', fail);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => ok(port));
  });
});

/** 一次 HTTP 调用，返回 {status, json, text}。用 node:http 以支持伪造 Host 头。 */
function httpJson(port, method, path, { headers = {}, body = null, timeoutMs = 15_000 } = {}) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 响应保持 null */ }
        ok({ status: res.statusCode, json, text });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${method} ${path}，${timeoutMs}ms）`)));
    req.on('error', fail);
    if (body !== null) req.write(body);
    req.end();
  });
}

/** 一个独立桥进程 + 临时落盘根目录的用例组。 */
class BridgeGroup {
  constructor(name) {
    this.name = name;
    this.proc = null;
    this.port = 0;
    this.root = null;
    this.token = null;
    this.stderrChunks = [];
  }

  stderrTail() {
    return Buffer.concat(this.stderrChunks).toString('utf8').trimEnd().split('\n').slice(-8).join('\n');
  }

  async start() {
    this.port = await freePort();
    this.root = await mkdtemp(join(tmpdir(), 'mtp-bridge-test-'));
    this.proc = spawn(
      process.execPath,
      [BRIDGE_ENTRY, '--port', String(this.port), '--root', this.root, '--code', FIXED_CODE],
      { stdio: ['pipe', 'pipe', 'pipe'] }, // stdin 管道不关 -> 桥不退出，测完显式 kill
    );
    this.proc.stderr.on('data', (chunk) => this.stderrChunks.push(chunk));
    for (let i = 0; i < 60; i++) {
      if (this.proc.exitCode !== null) {
        throw new Error(`桥进程提前退出（code=${this.proc.exitCode}）\n桥 stderr 尾部:\n${this.stderrTail()}`);
      }
      try {
        const res = await httpJson(this.port, 'GET', '/status');
        if (res.status === 200) return;
      } catch { /* 桥未就绪，重试 */ }
      await sleep(100);
    }
    throw new Error(`桥启动超时（端口 ${this.port}）\n桥 stderr 尾部:\n${this.stderrTail()}`);
  }

  async stop() {
    if (this.proc && this.proc.exitCode === null) {
      const exited = new Promise((ok) => this.proc.once('exit', ok));
      this.proc.kill();
      await Promise.race([exited, sleep(3000)]);
      if (this.proc.exitCode === null) {
        try { this.proc.kill('SIGKILL'); } catch { /* 进程已退出 */ }
        await Promise.race([exited, sleep(1000)]);
      }
    }
    if (this.root) await rm(this.root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// 用例收集与报告

const results = { passed: [], failed: [], skipped: [] };

async function runCase(name, { group, strict = false } = {}, fn) {
  if (strict && !STRICT) {
    results.skipped.push(name);
    console.log(`  ⊘ 跳过（strict 用例，MTP_STRICT=0 降级）: ${name}`);
    return;
  }
  try {
    await fn();
    results.passed.push(name);
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const message = error?.message ?? String(error);
    results.failed.push({ name, message, bridgeLog: group?.stderrTail() ?? '' });
    console.log(`  ✗ ${name}: ${message.split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 用例组

// 组 1：/status 配对码暴露 + Host 校验（用例 1、2）
async function groupStatusHost() {
  console.log('\n[组 1] /status 配对码暴露与 Host 校验');
  const group = new BridgeGroup('status-host');
  try {
    await group.start();
    await runCase('1a GET /status 无浏览器头 -> JSON 含 code', { group }, async () => {
      const res = await httpJson(group.port, 'GET', '/status');
      assert.equal(res.status, 200);
      assert.ok(res.json && typeof res.json.code === 'string' && res.json.code.length > 0,
        `响应应含非空 code，实际: ${res.text.slice(0, 200)}`);
    });
    await runCase('1b GET /status 带 Origin: http://evil.example -> JSON 不含 code', { group }, async () => {
      const res = await httpJson(group.port, 'GET', '/status', { headers: { origin: 'http://evil.example' } });
      assert.equal(res.status, 200);
      assert.ok(res.json && !('code' in res.json), '浏览器来源的请求不应拿到配对码');
    });
    await runCase('2 伪造 Host: evil.example:PORT -> 403', { group, strict: true }, async () => {
      const res = await httpJson(group.port, 'GET', '/status', { headers: { host: `evil.example:${group.port}` } });
      assert.equal(res.status, 403, `伪造 Host 应 403，实际 ${res.status}`);
    });
  } finally {
    await group.stop();
  }
}

// 组 2：配对、Bearer 鉴权与 /file 落盘沙箱（用例 3、4）
async function groupPairFile() {
  console.log('\n[组 2] 配对、Bearer 鉴权与 /file 落盘沙箱');
  const group = new BridgeGroup('pair-file');
  try {
    await group.start();
    await runCase('3a 错误配对码 POST /pair -> 403', { group }, async () => {
      const res = await httpJson(group.port, 'POST', '/pair', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: WRONG_CODE }),
      });
      assert.equal(res.status, 403);
    });
    await runCase('3b 正确配对码 POST /pair -> 200 且返回 token', { group }, async () => {
      const res = await httpJson(group.port, 'POST', '/pair', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: FIXED_CODE }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.json && typeof res.json.token === 'string' && res.json.token.length > 0,
        '应返回非空 token');
      group.token = res.json.token;
    });
    await runCase('3c 错误 Bearer 调 /file -> 401', { group }, async () => {
      assert.ok(group.token, '前置失败: 未取得 token');
      const res = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: 'Bearer deadbeef', 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'nope.png', base64: SMALL_B64 }),
      });
      assert.equal(res.status, 401);
    });
    await runCase('3d 正确 token POST /hello -> 200 放行', { group }, async () => {
      assert.ok(group.token, '前置失败: 未取得 token');
      const res = await httpJson(group.port, 'POST', '/hello', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ tools: [], prompts: [] }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.json?.ok === true, '应放行并返回 ok:true');
    });
    await runCase('4a /file 相对路径 out.png -> ok:true 且 bytes>0', { group }, async () => {
      assert.ok(group.token, '前置失败: 未取得 token');
      const res = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'out.png', base64: SMALL_B64 }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.json?.ok === true, `应 ok:true，实际: ${res.text.slice(0, 200)}`);
      assert.ok(res.json.bytes > 0, `bytes 应 > 0，实际 ${res.json?.bytes}`);
    });
    await runCase("4b /file path 含 '..'（'../evil.png'）-> 403", { group }, async () => {
      const res = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: '../evil.png', base64: SMALL_B64 }),
      });
      assert.equal(res.status, 403, `路径穿越应 403，实际 ${res.status}`);
    });
    await runCase('4c /file 绝对路径逃逸 root -> 403', { group }, async () => {
      const escapePath = process.platform === 'win32' ? 'C:/Windows/Temp/evil.png' : '/tmp/evil.png';
      const res = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: escapePath, base64: SMALL_B64 }),
      });
      assert.equal(res.status, 403, `绝对路径 ${escapePath} 逃逸 root 应 403，实际 ${res.status}`);
    });
    await runCase('4d /file path 无扩展名 -> 返回 path 以 .png 结尾', { group }, async () => {
      const res = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'noext', base64: SMALL_B64 }),
      });
      assert.equal(res.status, 200);
      assert.ok(typeof res.json?.path === 'string' && res.json.path.endsWith('.png'),
        `返回 path 应以 .png 结尾，实际: ${res.json?.path}`);
    });
    await runCase('4e /file 同路径二次写入不带 overwrite -> 409', { group }, async () => {
      const first = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'dup.png', base64: SMALL_B64 }),
      });
      assert.equal(first.status, 200, `首次写入应 200，实际 ${first.status}`);
      const second = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'dup.png', base64: SMALL_B64 }),
      });
      assert.equal(second.status, 409, `不带 overwrite 二次写入应 409，实际 ${second.status}`);
    });
  } finally {
    await group.stop();
  }
}

// 组 3：配对限速（用例 5，独立进程，放最后跑）
async function groupRateLimit() {
  console.log('\n[组 3] 配对限速（连续错码后正确码也被拒；独立桥进程）');
  const group = new BridgeGroup('rate-limit');
  try {
    await group.start();
    await runCase('5a 连续 5 次错误配对码 -> 每次 403', { group }, async () => {
      for (let i = 1; i <= 5; i++) {
        const res = await httpJson(group.port, 'POST', '/pair', {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: WRONG_CODE }),
        });
        assert.equal(res.status, 403, `第 ${i} 次错码应 403，实际 ${res.status}`);
      }
    });
    await runCase('5b 第 6 次用正确码 -> 429', { group, strict: true }, async () => {
      const res = await httpJson(group.port, 'POST', '/pair', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: FIXED_CODE }),
      });
      assert.equal(res.status, 429, `连续失败后正确码也应被限速 429，实际 ${res.status}`);
    });
  } finally {
    await group.stop();
  }
}

// 组 4：/file 解码上限（用例 6，独立桥进程）
async function groupDecodeLimit() {
  console.log('\n[组 4] /file base64 解码上限（约 33MB > 32MB 上限；独立桥进程）');
  const group = new BridgeGroup('decode-limit');
  try {
    await group.start();
    // 先配对拿 token：解码上限的检查点在鉴权之后，不带 token 只会拿到 401。
    const pair = await httpJson(group.port, 'POST', '/pair', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: FIXED_CODE }),
    });
    assert.equal(pair.status, 200, `组 4 前置配对失败: ${pair.status}`);
    group.token = pair.json.token;
    await runCase('6 base64 解码约 33MB > 32MB 上限 -> 413', { group, strict: true }, async () => {
      const big = Buffer.alloc(33 * 1024 * 1024, 65).toString('base64'); // 约 44MB base64
      const res = await httpJson(group.port, 'POST', '/file', {
        headers: { authorization: `Bearer ${group.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'big.png', base64: big }),
        timeoutMs: 60_000,
      });
      assert.equal(res.status, 413, `超解码上限应 413，实际 ${res.status}`);
    });
  } finally {
    await group.stop();
  }
}

// ---------------------------------------------------------------------------------------------
// 主流程

console.log(`MermaidToPng 桥接测试（仓库根: ${REPO_ROOT}）`);
console.log(`模式: MTP_STRICT=${STRICT ? '1（全量）' : '0（降级: 跳过安全加固类 strict 用例）'}`);

try {
  await groupStatusHost();
  await groupPairFile();
  await groupRateLimit(); // 限速组独立进程，放最后
  await groupDecodeLimit();
} finally {
  // 各组内部 try/finally 已 kill 桥进程并清理临时目录；此处无额外持有资源。
}

console.log('\n========== 测试报告 ==========');
console.log(`通过 ${results.passed.length} / 失败 ${results.failed.length} / 跳过 ${results.skipped.length}（跳过=安全加固类 strict 用例，MTP_STRICT=0 降级）`);
for (const name of results.skipped) console.log(`  跳过: ${name}`);
for (const item of results.failed) {
  console.log(`\n[失败] ${item.name}\n  ${item.message}`);
  if (item.bridgeLog) console.log(`  桥 stderr 尾部:\n${item.bridgeLog.split('\n').map((l) => `    ${l}`).join('\n')}`);
}
if (results.failed.length > 0) {
  console.log(`\n${results.failed.length} 个用例失败`);
  process.exit(1);
}
console.log('桥接测试全部通过');
process.exit(0);
