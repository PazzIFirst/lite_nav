import { fetchT, readJsonLimited } from '../fetcher.js';

// 搜索联想:每个查询独立、不缓存(用户输入即时变化),后端做主备 + CORS 终结
export async function getSuggestions(query) {
  if (!query?.trim()) return { data: [], source: 'empty', source_label: '空查询' };

  const sources = [
    {
      id: 'baidu',
      label: '百度联想',
      fn: async () => {
        // 百度 sugrec 接口,JSON 格式 {g: [{q: "..."}]} 或 sug 接口
        const r = await fetchT(
          `https://www.baidu.com/sugrec?prod=pc&wd=${encodeURIComponent(query)}`,
          { timeout: 3000 }
        );
        const d = await readJsonLimited(r);
        const list = Array.isArray(d?.g) ? d.g.map(x => x.q).filter(Boolean) : null;
        return list?.length ? list : null;
      },
    },
    {
      id: 'google',
      label: 'Google 联想',
      fn: async () => {
        const r = await fetchT(
          `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}&hl=zh-CN`,
          { timeout: 3000 }
        );
        const d = await readJsonLimited(r);
        const list = Array.isArray(d?.[1]) ? d[1] : null;
        return list?.length ? list : null;
      },
    },
    {
      id: 'bing',
      label: 'Bing 联想',
      fn: async () => {
        const r = await fetchT(
          `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`,
          { timeout: 3000 }
        );
        const d = await readJsonLimited(r);
        const list = Array.isArray(d?.[1]) ? d[1] : null;
        return list?.length ? list : null;
      },
    },
  ];

  // 联想用 Promise.any 并发竞速,谁先来用谁
  const wrapped = sources.map(s => s.fn().then(data => {
    if (!data) throw new Error('empty');
    return { data: data.slice(0, 8), source: s.id, source_label: s.label };
  }));
  try {
    return await Promise.any(wrapped);
  } catch {
    return { data: [], source: 'failed', source_label: '全部失败' };
  }
}
