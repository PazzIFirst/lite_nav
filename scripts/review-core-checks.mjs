// Regression checks for complete-body deadlines, cache TTLs and compressed JSON safety.
// Run: node --experimental-vm-modules scripts/review-core-checks.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const source = path => readFileSync(new URL(path, root), 'utf8');
const globals = { fetch, Headers, Response, AbortController, URL, Buffer, Uint8Array, setTimeout, clearTimeout, console };
async function moduleWithMocks(path, bindings = {}, extra = {}) {
  const context = vm.createContext({ ...globals, ...extra });
  const module = new vm.SourceTextModule(source(path), { context });
  await module.link(specifier => {
    assert(bindings[specifier], `Unexpected import: ${specifier}`);
    const exports = bindings[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}
const backend = await moduleWithMocks('backend/src/fetcher.js', { './redis.js': { writeBoth: async () => {} } }, { process: { env: {} } });
const frontend = await moduleWithMocks('frontend/js/api.js');
const sockets = new Set();
const server = createServer((req, res) => {
  if (req.url === '/stall') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders(); res.write('{"pending":'); return;
  }
  if (req.url === '/large') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': 96 * 1024 * 1024 });
    res.flushHeaders(); res.write('['); return;
  }
  if (req.url === '/chunked-large') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.alloc(2 * 1024 * 1024 + 1)); return;
  }
  if (req.url === '/empty') { res.writeHead(204); res.end(); return; }
  if (req.url === '/rss-large') {
    const items = Array.from({ length: 160 }, (_, i) => ({ title: String(i), content: '文'.repeat(80000), summary: '摘'.repeat(4000) }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { items } })); return;
  }
  if (req.url === '/redirect') { res.writeHead(302, { location: '/ok' }); res.end(); return; }
  const body = Buffer.from(JSON.stringify({ message: '正文完整读取 ✓' }));
  if (req.url === '/gzip') {
    const zipped = gzipSync(body);
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': zipped.length });
    res.end(zipped); return;
  }
  res.writeHead(req.url === '/error' ? 503 : 200, { 'content-type': 'application/json' });
  res.end(body);
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = path => `http://127.0.0.1:${server.address().port}${path}`;
const deadline = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline regression: operation still pending')), 1500); })]); }
  finally { clearTimeout(timer); }
};
try {
  for (const [name, read] of [
    ['backend', path => backend.fetchT(url(path), { timeout: 80 })],
    ['frontend', path => frontend.fetchT(url(path), 80)],
  ]) {
    const started = Date.now();
    await assert.rejects(deadline(read('/stall')), error => error.name === 'AbortError');
    assert(Date.now() - started < 1200, `${name} must bound response body read`);
    await assert.rejects(deadline(read('/large')), /too large/);
    const good = await read('/ok'); assert.equal((await good.json()).message, '正文完整读取 ✓');
    const compressed = await read('/gzip'); assert.equal((await compressed.json()).message, '正文完整读取 ✓');
    const redirect = await read('/redirect'); assert.equal(redirect.url, url('/ok')); assert(redirect.redirected);
    assert.equal(await (await read('/empty')).text(), '');
  }
  await assert.rejects(backend.fetchT(url('/chunked-large')), /too large/);
  await assert.rejects(backend.fetchT(url('/error')), /HTTP 503/);
  assert.equal((await frontend.fetchT(url('/error'))).status, 503);
  const aggregation = await frontend.fetchT(url('/rss-large'), 5000);
  assert.equal((await aggregation.json()).data.items.length, 160, 'Valid 20-feed CJK content must fit the browser limit');
  const controller = new AbortController();
  const aborted = frontend.fetchT(url('/stall'), 1000, { signal: controller.signal });
  controller.abort();
  await assert.rejects(deadline(aborted), error => error.name === 'AbortError');
  console.log('✓ Request deadlines cover complete bodies; size limits, gzip, redirects, errors and external abort preserved');
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}

const writes = [];
class FakeRedis {
  on() {}
  async set(...args) { writes.push(args); return 'OK'; }
}
const cache = await moduleWithMocks('backend/src/redis.js', {
  ioredis: { default: FakeRedis }, './safe.js': { safeParse: value => JSON.parse(value) },
}, { process: { env: { DYNAMIC_LASTGOOD_TTL_SEC: '0' } } });
assert.equal(cache.DYNAMIC_LASTGOOD_TTL_SEC, 30 * 86400, 'Invalid TTL cannot create permanent dynamic cache');
for (const key of ['weather:beijing', 'rss:feed:v2:https://example.org/feed?q=1', 'chart:k:105.BRK.B:60', 'chart:t:1.000001']) {
  writes.length = 0; await cache.writeBoth(key, { data: {} }, 600);
  const lastgood = writes.find(args => args[0] === 'lastgood:' + key);
  assert.equal(lastgood[2], 'EX'); assert(lastgood[3] > 0);
}
writes.length = 0; await cache.writeBoth('finance:indices', { data: {} }, 60);
assert.equal(writes.find(args => args[0] === 'lastgood:finance:indices').length, 2);
console.log('✓ RSS/chart/weather lastgood keys receive bounded TTL; fixed keys unchanged');

const require = createRequire(new URL('backend/package.json', root));
const express = require('express');
const parserVersion = require('body-parser/package.json').version;
const [major, minor, patch] = parserVersion.split('.').map(Number);
assert(major === 1 && (minor > 20 || (minor === 20 && patch >= 9)), 'Lockfile must contain patched body-parser 1.x');
const app = express();
// Exercise the fixed dependency with inflate enabled too; a regression crashes this isolated check process.
app.post('/dependency', express.json({ limit: '64kb' }), (_req, res) => res.json({ ok: true }));
assert.match(source('backend/src/server.js'), /express\.json\(\{[^}]*inflate:\s*false/);
app.post('/guard', express.json({ limit: '64kb', inflate: false }), (_req, res) => res.json({ ok: true }));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.type || 'error' }));
const api = app.listen(0, '127.0.0.1');
await new Promise(resolve => api.once('listening', resolve));
try {
  const base = `http://127.0.0.1:${api.address().port}`;
  const body = Buffer.concat([gzipSync(Buffer.from('{"ok":true}')), Buffer.from('trailing bytes')]);
  const r = await fetch(base + '/dependency', { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body });
  await r.text();
  const guard = await fetch(base + '/guard', { method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body });
  assert.equal(guard.status, 415); await guard.text();
  const normal = await fetch(base + '/guard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
  assert.equal(normal.status, 200); await normal.text();
  console.log(`✓ body-parser ${parserVersion} survives trailing compressed bytes; app rejects compressed JSON and accepts ordinary JSON`);
} finally { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
