import { fetchT, runAndCache, readJsonLimited } from '../fetcher.js';
import { safeHttpUrl, cleanText } from '../safe.js';

const HOT_TTL = 300; // 5min
const TITLE_MAX = 200;

// 统一清洗:title 限长去控制字符,url 走协议白名单
function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const title = cleanText(item.title, TITLE_MAX);
  if (!title) return null;
  return {
    title,
    url: safeHttpUrl(item.url, null),
  };
}

function dedupByTitle(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || seen.has(it.title)) continue;
    seen.add(it.title);
    out.push(it);
  }
  return out;
}

function parseBa9(d) {
  if (!d?.success || !Array.isArray(d.data)) return null;
  const items = d.data
    .map(i => sanitizeItem({ title: i?.title, url: i?.url || i?.mobilUrl || '' }))
    .filter(Boolean);
  return items.length ? dedupByTitle(items) : null;
}

// B-005:删除死参 label
function makeBa9Source(slug) {
  return async () => {
    const r = await fetchT(`https://api.ba9.cn/api/get.${slug}`, { timeout: 5000 });
    return parseBa9(await readJsonLimited(r));
  };
}

function makeVvhanSource(slug) {
  return async () => {
    const r = await fetchT(`https://api.vvhan.com/api/hotlist/${slug}`, { timeout: 5000 });
    const d = await readJsonLimited(r);
    if (!d?.success || !Array.isArray(d.data)) return null;
    const items = d.data
      .slice(0, 30)
      .map(i => sanitizeItem({ title: i?.title, url: i?.url || i?.mobil_url || '' }))
      .filter(Boolean);
    return items.length ? dedupByTitle(items) : null;
  };
}

const SOURCE_DEFS = {
  zhihu: [
    { id: 'ba9',   label: 'BA9 API',   fn: makeBa9Source('zhihuhot?type=zhihu') },
    { id: 'vvhan', label: 'VVHAN API', fn: makeVvhanSource('zhihuHot') },
  ],
  weibo: [
    { id: 'ba9',   label: 'BA9 API',   fn: makeBa9Source('weibohot?type=weibo') },
    { id: 'vvhan', label: 'VVHAN API', fn: makeVvhanSource('wbHot') },
  ],
  baidu: [
    { id: 'ba9',   label: 'BA9 API',   fn: makeBa9Source('baiduhot?type=baidu') },
    { id: 'vvhan', label: 'VVHAN API', fn: makeVvhanSource('baiduRY') },
  ],
  bili: [
    {
      id: 'bili-official-day',
      label: 'B站官方-每日热门',
      fn: async () => {
        const r = await fetchT('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1', { timeout: 5000 });
        const d = await readJsonLimited(r);
        if (d?.code !== 0) return null;
        const items = (d.data?.list || [])
          .filter(i => i?.title && i?.bvid)            // B-003:bvid 必须存在
          .map(i => sanitizeItem({
            title: i.title,
            url: 'https://www.bilibili.com/video/' + encodeURIComponent(i.bvid),
          }))
          .filter(Boolean);
        return items.length ? dedupByTitle(items) : null;
      },
    },
    {
      id: 'bili-official-rank',
      label: 'B站官方-综合排行',
      fn: async () => {
        const r = await fetchT('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=1', { timeout: 5000 });
        const d = await readJsonLimited(r);
        if (d?.code !== 0) return null;
        const items = (d.data?.list || [])
          .filter(i => i?.title && i?.bvid)
          .map(i => sanitizeItem({
            title: i.title,
            url: 'https://www.bilibili.com/video/' + encodeURIComponent(i.bvid),
          }))
          .filter(Boolean);
        return items.length ? dedupByTitle(items) : null;
      },
    },
    { id: 'ba9', label: 'BA9 API', fn: makeBa9Source('bilihot.day?type=biliall') },
  ],
};

export const HOT_IDS = Object.keys(SOURCE_DEFS);

export async function refreshHotList(id) {
  const sources = SOURCE_DEFS[id];
  if (!sources) return;
  await runAndCache({
    key: 'hot:' + id,
    sources,
    hotTtlSec: HOT_TTL,
    transform: (items) => items.slice(0, 20),
  });
}

export async function refreshAllHot() {
  await Promise.allSettled(HOT_IDS.map(refreshHotList));
}

// B-006:builtin url 用 null
export const HOT_BUILTIN_FALLBACK = {
  data: [{ title: '(暂无数据)', url: null }],
};
