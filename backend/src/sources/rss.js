// RSS:抓取任意订阅源,解析成 {title, link, time, source}。
// 零依赖正则解析(项目原则),对 RSS 2.0 的 <item> 与 Atom 的 <entry> 都适用。
import { fetchT, readBufferLimited } from '../fetcher.js';
import { readThreeState, writeBoth } from '../redis.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_ITEMS = 40;
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
  if (!['http:', 'https:'].includes(u.protocol)) return false;
  if (PRIVATE_HOST.test(u.hostname)) return false;
  return true;
}

// ===== 解析 =====
function unescape(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');            // 必须最后
}

// 先解 CDATA / 实体,再剥标签 —— 顺序反了的话,<![CDATA[标题]]> 会被当成一个标签整段吃掉
const stripTags = (s) => unescape(String(s)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function field(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

// Atom 的 link 在属性里:<link rel="alternate" href="..."/>
function atomLink(block) {
  const all = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  for (const [, attrs] of all) {
    if (/rel=["'](alternate|self)?["']/i.test(attrs) || !/rel=/i.test(attrs)) {
      const href = attrs.match(/href=["']([^"']+)["']/i);
      if (href) return unescape(href[1]);
    }
  }
  return '';
}

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export function parseFeed(xml) {
  const items = [];
  const push = (title, link, date) => {
    const t = stripTags(title);
    if (!t) return;
    items.push({ title: t.slice(0, 200), link: unescape(String(link || '').trim()), time: parseDate(date) });
  };

  // RSS 2.0 / RSS 1.0
  for (const m of String(xml).matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const b = m[0];
    push(field(b, 'title'), field(b, 'link') || atomLink(b), field(b, 'pubDate') || field(b, 'dc:date'));
  }
  // Atom
  for (const m of String(xml).matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const b = m[0];
    push(field(b, 'title'), atomLink(b) || field(b, 'id'), field(b, 'updated') || field(b, 'published'));
  }
  return items.slice(0, MAX_ITEMS);
}

function feedTitle(xml) {
  const head = String(xml).slice(0, 4000);
  const m = head.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]).slice(0, 40) : '';
}

// ===== 抓取 =====
export async function fetchFeed(url) {
  if (!isSafeFeedUrl(url)) throw new Error('bad_url');
  const key = `rss:feed:${url}`;
  const cached = await readThreeState(key, null).catch(() => null);
  if (cached?.freshness === 'fresh') return cached;

  const r = await fetchT(url, { timeout: 9000, ua: UA, headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
  const buf = await readBufferLimited(r, MAX_BYTES);
  const xml = buf.toString('utf8');
  const items = parseFeed(xml);
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
  return { data: { items: items.slice(0, 60), feeds } };
}
