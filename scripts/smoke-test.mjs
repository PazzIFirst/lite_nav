#!/usr/bin/env node
// 后端冒烟测试 —— 对一个已启动的实例发真请求
//   本地:  node src/server.js & ; node scripts/smoke-test.mjs
//   CI  :  BASE=http://127.0.0.1:3000 node scripts/smoke-test.mjs
//
// 只断言「不依赖第三方网络」的端点(health / catalog / today),
// 热榜和行情要打外网,在 CI 里断言它们只会得到随机失败的红叉,没有价值。

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function get(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(15000) });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

console.log(`冒烟测试 → ${BASE}\n`);

// ===== /api/health =====
const health = await get('/api/health');
check('/api/health 返回 200', health.status === 200, `实际 ${health.status}`);
check('Redis 连接正常', health.body?.redis === 'up', `实际 ${health.body?.redis}`);

// ===== /api/hot/catalog =====
const cat = await get('/api/hot/catalog');
const lists = cat.body?.data;
check('/api/hot/catalog 返回 200', cat.status === 200, `实际 ${cat.status}`);
check('目录非空', Array.isArray(lists) && lists.length > 0, `实际 ${lists?.length}`);

if (Array.isArray(lists)) {
  const ids = lists.map(l => l.id);
  check('榜单 id 无重复', new Set(ids).size === ids.length);
  check('每项都有 id/title/link', lists.every(l => l.id && l.title && l.link));
  check('link 全是 https', lists.every(l => String(l.link).startsWith('https://')),
        lists.filter(l => !String(l.link).startsWith('https://')).map(l => l.id).join(','));
  check('不外泄第三方接口地址', lists.every(l => !('sources' in l)));

  // 前后端一致性:前端写死的默认槽位 / 兜底目录,必须都是后端认识的 id
  const feSrc = readFileSync(join(ROOT, 'frontend/js/hot.js'), 'utf8');
  const grab = (name) => {
    const m = feSrc.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
    return m ? [...m[1].matchAll(/(?:id:\s*)?'([a-z0-9]+)'/gi)].map(x => x[1]) : [];
  };
  const defaults = grab('DEFAULT_SLOTS');
  const fallback = [...feSrc.matchAll(/\{\s*id:\s*'([^']+)'/g)].map(m => m[1]);

  check('前端 DEFAULT_SLOTS 全部存在于后端目录',
        defaults.length > 0 && defaults.every(id => ids.includes(id)),
        defaults.filter(id => !ids.includes(id)).join(','));
  check('前端 FALLBACK_CATALOG 全部存在于后端目录',
        fallback.length > 0 && fallback.every(id => ids.includes(id)),
        fallback.filter(id => !ids.includes(id)).join(','));

  console.log(`    (后端目录 ${ids.length} 个榜单)`);
}

// ===== /api/today:纯本地农历计算,不依赖外网 =====
const today = await get('/api/today');
check('/api/today 返回 200', today.status === 200, `实际 ${today.status}`);
check('农历数据非空', !!today.body?.data && Object.keys(today.body.data).length > 0);
check('today 标记为 fresh', today.body?.freshness === 'fresh');

// ===== 错误路径 =====
const bogus = await get('/api/hot/__nope__');
check('未知榜单 id 返回 404', bogus.status === 404, `实际 ${bogus.status}`);
const badCountry = await get('/api/holidays?country=ZZZ');
check('非法国家码返回 400', badCountry.status === 400, `实际 ${badCountry.status}`);
const notFound = await get('/api/__no_such_route__');
check('未知路由返回 404', notFound.status === 404, `实际 ${notFound.status}`);

console.log(failed ? `\n✗ ${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
