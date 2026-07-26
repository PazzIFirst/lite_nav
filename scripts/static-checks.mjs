#!/usr/bin/env node
// 零依赖静态检查 —— 本地直接 `node scripts/static-checks.mjs`,CI 里同一份脚本
//
// 这个项目没有测试框架、前端零构建,以下三项是最容易在重构中悄悄坏掉的契约:
//   1. 语法      — 所有 JS 能被 node 解析
//   2. 模块导入   — 前端 ES Module 的相对 import 都指向真实存在的文件
//   3. DOM 契约  — 前端 getElementById('x') 用到的 id,index.html 里确实有
// 第 3 项尤其关键:前端全靠 id 把 JS 和 HTML 缝在一起,改名漏改不会报错,只会静默失效。

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const note = (area, msg) => failures.push(`[${area}] ${msg}`);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
}

// ===== 1. 语法 =====
const jsFiles = [...walk(join(ROOT, 'backend/src')), ...walk(join(ROOT, 'frontend/js'))];
if (!jsFiles.length) note('syntax', '没扫到任何 JS 文件 —— 目录结构变了?');
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    note('syntax', `${f.replace(ROOT + '/', '')}\n${(e.stderr || '').toString().trim()}`);
  }
}
console.log(`✓ 语法检查 ${jsFiles.length} 个文件`);

// ===== 2. 前端模块导入可解析 =====
const feFiles = walk(join(ROOT, 'frontend/js'));
let importCount = 0;
for (const f of feFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    importCount++;
    const target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) {
      note('import', `${f.replace(ROOT + '/', '')} → ${m[1]} 不存在`);
    }
  }
}
console.log(`✓ 前端 import 解析 ${importCount} 条`);

// ===== 3. DOM id 契约 =====
// 只查字符串字面量;动态拼接的 id(如 'hot-slot'+i+'-list')由运行时创建,跳过
const html = readFileSync(join(ROOT, 'frontend/index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
const seen = new Set();
for (const f of feFiles) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    seen.add(m[1]);
    if (!htmlIds.has(m[1])) {
      note('dom-id', `${f.replace(ROOT + '/', '')} 引用了 #${m[1]},但 index.html 里没有`);
    }
  }
}
console.log(`✓ DOM id 契约 ${seen.size} 个(index.html 共 ${htmlIds.size} 个 id)`);

// ===== 结果 =====
if (failures.length) {
  console.error(`\n✗ ${failures.length} 项检查未通过:\n`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('\n全部通过');
