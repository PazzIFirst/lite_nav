import { fetchT, runAndCache } from '../fetcher.js';

const HOT_TTL = 300; // 5min

function parseBa9(d) {
  if (!d?.success || !Array.isArray(d.data)) return null;
  const items = d.data
    .filter(i => i?.title)
    .map(i => ({ title: i.title, url: i.url || i.mobilUrl || '' }));
  return items.length ? items : null;
}

function makeBa9Source(label, slug) {
  return async () => {
    const r = await fetchT(`https://api.ba9.cn/api/get.${slug}`, { timeout: 5000 });
    return parseBa9(await r.json());
  };
}

function makeVvhanSource(slug) {
  return async () => {
    const r = await fetchT(`https://api.vvhan.com/api/hotlist/${slug}`, { timeout: 5000 });
    const d = await r.json();
    if (!d?.success || !Array.isArray(d.data)) return null;
    const items = d.data
      .filter(i => i?.title)
      .slice(0, 30)
      .map(i => ({ title: i.title, url: i.url || i.mobil_url || '' }));
    return items.length ? items : null;
  };
}

const SOURCE_DEFS = {
  zhihu: [
    { id: 'ba9', label: 'BA9 API', fn: makeBa9Source('知乎', 'zhihuhot?type=zhihu') },
    { id: 'vvhan', label: 'VVHAN API', fn: makeVvhanSource('zhihuHot') },
  ],
  weibo: [
    { id: 'ba9', label: 'BA9 API', fn: makeBa9Source('微博', 'weibohot?type=weibo') },
    { id: 'vvhan', label: 'VVHAN API', fn: makeVvhanSource('wbHot') },
  ],
  baidu: [
    { id: 'ba9', label: 'BA9 API', fn: makeBa9Source('百度', 'baiduhot?type=baidu') },
    { id: 'vvhan', label: 'VVHAN API', fn: makeVvhanSource('baiduRY') },
  ],
  bili: [
    {
      id: 'bili-official-day',
      label: 'B站官方-每日热门',
      fn: async () => {
        const r = await fetchT('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1', { timeout: 5000 });
        const d = await r.json();
        if (d?.code !== 0) return null;
        return d.data?.list?.filter(i => i?.title)
          .map(i => ({ title: i.title, url: 'https://www.bilibili.com/video/' + i.bvid })) || null;
      },
    },
    {
      id: 'bili-official-rank',
      label: 'B站官方-综合排行',
      fn: async () => {
        const r = await fetchT('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=1', { timeout: 5000 });
        const d = await r.json();
        if (d?.code !== 0) return null;
        return d.data?.list?.filter(i => i?.title)
          .map(i => ({ title: i.title, url: 'https://www.bilibili.com/video/' + i.bvid })) || null;
      },
    },
    { id: 'ba9', label: 'BA9 API', fn: makeBa9Source('B站', 'bilihot.day?type=biliall') },
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

export const HOT_BUILTIN_FALLBACK = {
  data: [{ title: '(暂无数据)', url: '' }],
};
