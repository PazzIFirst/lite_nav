// RSS:保留摘要、正文、作者与配图,按发布时间聚合。
// content 仅作数据返回,前端通过 DOM 白名单重建阅读内容。
import { readBufferLimited } from '../fetcher.js';
import { readThreeState, writeBoth } from '../redis.js';
import { parseFeed, feedTitle } from './rss-parser.js';
export { parseFeed } from './rss-parser.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_PER_FEED = 8;   // 单个源最多贡献几条:否则高频源(IT之家)会把整张列表刷满
const MAX_BYTES = 2 * 1024 * 1024;
const TTL = 10 * 60;          // 单个源缓存 10 分钟

// ===== URL 白名单 =====
// 订阅地址是用户自己填的,但仍挡住明显不该被服务器访问的目标:
// 只允许 http(s),不允许本机/内网字面量地址。
const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

export function isSafeFeedUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  if (PRIVATE_HOST.test(u.hostname)) return false;
  return true;
}

// ===== 抓取 =====
export async function fetchFeed(url, { refresh = false } = {}) {
  if (!isSafeFeedUrl(url)) throw new Error('bad_url');
  const key = `rss:feed:v2:${url}`;
  if (!refresh) {
    const cached = await readThreeState(key, null).catch(() => null);
    if (cached?.freshness === 'fresh') return cached;
  }

  // 超时覆盖响应体读取；主动检测必须绕过缓存，失败不能伪装成可用。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let xml;
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await readBufferLimited(r, MAX_BYTES);
    xml = buf.toString('utf8');
  } finally { clearTimeout(timer); }
  const items = parseFeed(xml, url);
  if (!items.length) throw new Error('no_items');

  const payload = {
    data: { url, title: feedTitle(xml), items },
    source: 'rss', source_label: 'RSS', fetched_at: Date.now(),
  };
  await writeBoth(key, payload, TTL).catch(() => {});
  return payload;
}

export async function fetchFeeds(urls) {
  const list = [...new Set((urls || []).filter(isSafeFeedUrl))].slice(0, 20);
  const settled = await Promise.allSettled(list.map(u => fetchFeed(u)));

  const feeds = [];
  const items = [];
  settled.forEach((res, i) => {
    const url = list[i];
    if (res.status === 'fulfilled') {
      const p = res.value;
      const title = p.data.title || '';
      feeds.push({ url, ok: true, title, count: p.data.items.length });
      for (const it of p.data.items.slice(0, MAX_PER_FEED)) {
        items.push({ ...it, source: title || new URL(url).hostname, feed: url });
      }
    } else {
      feeds.push({ url, ok: false, error: res.reason?.message || 'failed' });
    }
  });

  items.sort((a, b) => (b.time || 0) - (a.time || 0));
  return { data: { items, feeds } };
}
