// RSS:保留摘要、正文、作者与配图,按发布时间聚合。
// content 仅作数据返回,前端通过 DOM 白名单重建阅读内容。
import { fetchRssBuffer, isSafeFeedUrl } from '../rss-network.js';
export { isSafeFeedUrl } from '../rss-network.js';
import { readThreeState, writeBoth } from '../redis.js';
import { parseFeed, feedTitle } from './rss-parser.js';
export { parseFeed } from './rss-parser.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_PER_FEED = 8;   // 单个源最多贡献几条:否则高频源(IT之家)会把整张列表刷满
const MAX_BYTES = 2 * 1024 * 1024;
const TTL = 10 * 60;          // 单个源缓存 10 分钟

// ===== 抓取 =====
export async function fetchFeed(url, { refresh = false } = {}) {
  if (!isSafeFeedUrl(url)) throw new Error('bad_url');
  const key = `rss:feed:v2:${url}`;
  if (!refresh) {
    const cached = await readThreeState(key, null).catch(() => null);
    if (cached?.freshness === 'fresh') return cached;
  }

  const { buffer, url: finalUrl } = await fetchRssBuffer(url, { timeoutMs: 12000, maxBytes: MAX_BYTES, userAgent: UA });
  const xml = buffer.toString('utf8');
  const items = parseFeed(xml, finalUrl);
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
