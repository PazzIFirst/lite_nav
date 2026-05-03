import { writeBoth } from './redis.js';

export async function fetchT(url, opts = {}) {
  const ms = opts.timeout || 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': opts.ua || 'Mozilla/5.0 (NavBot/1.0)',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

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

export async function runAndCache({ key, sources, hotTtlSec, transform }) {
  try {
    const result = await tryChain(sources);
    let data = result.data;
    if (transform) data = transform(data);
    const payload = {
      data,
      source: result.source,
      source_label: result.source_label,
      fetched_at: Date.now(),
    };
    await writeBoth(key, payload, hotTtlSec);
    console.log(`[fetch] ${key} ← ${result.source_label} OK`);
    return payload;
  } catch (e) {
    console.warn(`[fetch] ${key} 全部源失败,保留旧 lastgood: ${e.message}`);
    return null;
  }
}
