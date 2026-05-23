import { writeBoth } from './redis.js';

const MAX_BODY_BYTES = Number(process.env.FETCH_MAX_BODY_BYTES || 2 * 1024 * 1024); // 2MB

// issue#9:边读边计数的 body 读取器 —— 第三方不返 Content-Length 时仍能强制限额
// 取代裸 res.json() / res.arrayBuffer(),避免无限读流到内存
async function readBodyLimited(res, maxBytes) {
  const reader = res.body && res.body.getReader && res.body.getReader();
  if (!reader) { // 无流接口,fallback 到 arrayBuffer(预检 content-length 已过)
    return Buffer.from(await res.arrayBuffer());
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel('body too large'); } catch {}
      throw new Error(`response too large: ${total}+ bytes (max ${maxBytes})`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readJsonLimited(res, maxBytes = MAX_BODY_BYTES) {
  const cl = Number(res.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > maxBytes) {
    throw new Error(`response too large: ${cl} bytes (max ${maxBytes})`);
  }
  const buf = await readBodyLimited(res, maxBytes);
  return JSON.parse(buf.toString('utf8'));
}

export async function readBufferLimited(res, maxBytes = MAX_BODY_BYTES) {
  const cl = Number(res.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > maxBytes) {
    throw new Error(`response too large: ${cl} bytes (max ${maxBytes})`);
  }
  return await readBodyLimited(res, maxBytes);
}

// 通用 fetch 包装:超时、body size 限制、协议白名单、透传 method/body/headers
export async function fetchT(url, opts = {}) {
  // 协议白名单
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new Error(`disallowed protocol: ${u.protocol}`);
    }
  } catch (e) {
    throw new Error(`invalid url: ${e.message}`);
  }

  const ms = opts.timeout || 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      body: opts.body,
      signal: controller.signal,
      headers: {
        'User-Agent': opts.ua || 'Mozilla/5.0 (NavBot/1.0)',
        ...(opts.headers || {}),
      },
      redirect: opts.redirect || 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // 检查 Content-Length(部分服务可能不返回,无法严格 enforce)
    const cl = Number(res.headers.get('content-length'));
    if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) {
      throw new Error(`response too large: ${cl} bytes`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 主备链:依次尝试,第一个 non-null 即返回
export async function tryChain(sources) {
  const errors = [];
  for (const src of sources) {
    try {
      const data = await src.fn();
      if (data == null) {
        errors.push(`${src.id}: empty`);
        continue;
      }
      return { data, source: src.id, source_label: src.label };
    } catch (e) {
      errors.push(`${src.id}: ${e.message}`);
    }
  }
  throw new Error('all_sources_failed: ' + errors.join(' | '));
}

// 三段分离:fetch/transform/cache 各自捕获
// fetch 失败 → 抛错(主备链由调用方决定降级)
// transform 失败 → warn,但仍然不是 fetch 失败
// cache 失败 → warn,但仍然返回 payload(请求方可直接使用)
export async function runAndCache({ key, sources, hotTtlSec, transform }) {
  let result;
  try {
    result = await tryChain(sources);
  } catch (e) {
    console.warn(`[fetch] ${key} all sources failed: ${e.message}`);
    return null;
  }

  let data = result.data;
  if (transform) {
    try {
      data = transform(data);
    } catch (e) {
      console.warn(`[fetch] ${key} transform failed: ${e.message},使用原始数据`);
    }
  }

  const payload = {
    data,
    source: result.source,
    source_label: result.source_label,
    fetched_at: Date.now(),
  };

  // cache 失败不影响调用方使用 payload(C-005 修复)
  try {
    await writeBoth(key, payload, hotTtlSec);
  } catch (e) {
    console.warn(`[fetch] ${key} cache write failed: ${e.message}(数据已获取,仅未持久化)`);
  }

  console.log(`[fetch] ${key} ← ${result.source_label} OK`);
  return payload;
}
