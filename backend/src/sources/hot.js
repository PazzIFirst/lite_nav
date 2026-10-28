import { fetchT, runAndCache, readJsonLimited, readBufferLimited } from '../fetcher.js';
import { safeHttpUrl, cleanText } from '../safe.js';

const HOT_TTL = 300; // 5min
const TITLE_MAX = 200;

// 部分站点(头条/贴吧/虎嗅等)对非浏览器 UA 返回空或验证页
const UA_BROWSER =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

// 所有源的收口:原始条目数组 → 清洗 → 去重 → 空则返回 null(交给主备链降级)
function finalize(raw) {
  if (!Array.isArray(raw)) return null;
  const items = raw.slice(0, 30).map(sanitizeItem).filter(Boolean);
  return items.length ? dedupByTitle(items) : null;
}

// ===== 通用源构造器 =====

// ===== 站方官方源 =====
// 微博、抖音靠 Referer 过来源校验:不带 Referer 时微博返 403,抖音返 200 但 body 为空
function makeWeiboSource() {
  return async () => {
    const r = await fetchT('https://weibo.com/ajax/side/hotSearch', {
      timeout: 6000, ua: UA_BROWSER, headers: { Referer: 'https://weibo.com/' },
    });
    const d = await readJsonLimited(r);
    const list = d?.data?.realtime;
    if (!Array.isArray(list)) return null;
    // is_ad=1 是插在榜单里的广告位,不是热搜
    return finalize(list.filter(i => i && !i.is_ad).map(i => {
      const word = cleanText(i.word, 80);
      return {
        title: word,
        url: word ? 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + word + '#') : '',
      };
    }));
  };
}

// 百度:条目在 data.cards[].content[] 里再套一层 content[] 才到 {word,url}
function makeBaiduSource() {
  return async () => {
    const r = await fetchT('https://top.baidu.com/api/board?platform=wise&tab=realtime', {
      timeout: 6000, ua: UA_BROWSER,
    });
    const d = await readJsonLimited(r);
    const list = (d?.data?.cards || []).flatMap(c => (c?.content || []).flatMap(x => x?.content || []));
    return finalize(list.map(i => ({ title: i?.word, url: i?.url })));
  };
}

// 抖音:data.word_list[];站内热榜的条目页是 /hot/<sentence_id>
function makeDouyinSource() {
  const url = 'https://www.douyin.com/aweme/v1/web/hot/search/list/'
    + '?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1';
  return async () => {
    const r = await fetchT(url, {
      timeout: 6000, ua: UA_BROWSER, headers: { Referer: 'https://www.douyin.com/' },
    });
    const d = await readJsonLimited(r);
    const list = d?.data?.word_list;
    if (!Array.isArray(list)) return null;
    return finalize(list.map(i => ({
      title: i?.word,
      url: i?.sentence_id ? 'https://www.douyin.com/hot/' + encodeURIComponent(i.sentence_id) : '',
    })));
  };
}

// 知乎官方移动接口:target.url 是 api.zhihu.com/questions/<id>,换成站内地址。
// id 只能从 URL 里取字符串 —— target.id 是超过 2^53 的数字,当数字读会被浮点截断
function zhihuItemUrl(target) {
  const raw = String(target?.url || '');
  const q = raw.match(/\/questions\/(\d+)/);
  if (q) return 'https://www.zhihu.com/question/' + q[1];
  const a = raw.match(/\/articles\/(\d+)/);
  if (a) return 'https://zhuanlan.zhihu.com/p/' + a[1];
  return raw;
}

function makeZhihuSource() {
  return async () => {
    const r = await fetchT('https://api.zhihu.com/topstory/hot-lists/total?limit=50', {
      timeout: 6000, ua: UA_BROWSER,
    });
    const d = await readJsonLimited(r);
    return finalize((d?.data || []).map(i => ({ title: i?.target?.title, url: zhihuItemUrl(i?.target) })));
  };
}

// 第三方兜底:知乎对机房 IP 有风控,官方接口在服务器上大量返回
// 403「系统监测到您的网络环境存在异常」,只能挂一个镜像备源。
// 这是 NewsNow 开源项目的公开实例,只用于知乎;要换实例改这一处 URL 即可
function makeNewsnowSource(id) {
  return async () => {
    const r = await fetchT('https://newsnow.busiyi.world/api/s?id=' + encodeURIComponent(id), {
      timeout: 8000, ua: UA_BROWSER,
    });
    const d = await readJsonLimited(r);
    // status 取 success(它现抓)或 cache(命中它自己的缓存),两种都有 items;为空才当失败
    if (!Array.isArray(d?.items) || d.items.length === 0) return null;
    return finalize(d.items.map(i => ({ title: i?.title, url: i?.url })));
  };
}

// 通用 JSON 源:pick(d) 从响应里挑出 [{title,url}, ...],结构差异全部收敛在 pick 里
function makeJsonSource(url, pick, opts = {}) {
  return async () => {
    const r = await fetchT(url, { timeout: 6000, ua: UA_BROWSER, ...opts });
    return finalize(pick(await readJsonLimited(r)));
  };
}

// 选源门槛:站方官方接口、官方 RSS。第三方聚合只在官方接口对机房 IP 有风控时作备源,
// 且注释里要写清是谁的实例。个人站点的「自用 / 仅供测试」型接口不纳入 ——
// 稳定性不可控,且多半带 QPS 限制与鉴权变更。
//
// 2026-10 的教训:此前知乎/微博/百度/抖音全靠 BA9 与 VVHAN 两家聚合,两家的源同时死掉 ——
// VVHAN 的 api 子域 NXDOMAIN,BA9 换了证书、口径全改,接口一律 404 —— 四个榜单一起空白,
// 而站方官方接口都是好的。聚合器可以当备源,不能当主源。
// 需要加源在下面 HOT_CATALOG 里加一条即可,结构与其余项相同。

// RSS 源:正则取 <item> 块里的 title/link,不引入 XML 解析依赖(项目零构建原则)
function rssField(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')            // 必须最后,否则 &amp;lt; 会被二次解码
    .trim();
}

function makeRssSource(url) {
  return async () => {
    const r = await fetchT(url, { timeout: 6000, ua: UA_BROWSER });
    const xml = (await readBufferLimited(r)).toString('utf8');
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    return finalize(blocks.map(b => ({ title: rssField(b, 'title'), url: rssField(b, 'link') })));
  };
}

// Hacker News:topstories 只返回 id 列表,标题要逐条取 → N+1
// 30 条并行,单条失败不影响整体(5min 缓存,实际每 5 分钟才打一次)
async function hackerNewsSource() {
  const r = await fetchT('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 6000 });
  const ids = await readJsonLimited(r);
  if (!Array.isArray(ids) || !ids.length) return null;
  const settled = await Promise.allSettled(ids.slice(0, 30).map(async id => {
    const ir = await fetchT(
      `https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(id)}.json`,
      { timeout: 5000 },
    );
    return await readJsonLimited(ir);
  }));
  return finalize(settled
    .filter(s => s.status === 'fulfilled' && s.value?.title)
    .map(s => ({
      title: s.value.title,
      url: s.value.url || `https://news.ycombinator.com/item?id=${encodeURIComponent(s.value.id)}`,
    })));
}

// ===== 榜单目录 =====
// 每项:id(缓存键 / 路由段)、title(前端显示)、link(榜单主页)、sources(主备链)
// 前端下拉框的可选项由 /api/hot/catalog 直接从这里生成,不会和后端脱节。
export const HOT_CATALOG = [
  {
    id: 'zhihu', title: '知乎热榜', link: 'https://www.zhihu.com/hot',
    sources: [
      { id: 'zhihu-official', label: '知乎官方', fn: makeZhihuSource() },
      { id: 'newsnow',       label: 'NewsNow 镜像', fn: makeNewsnowSource('zhihu') },
    ],
  },
  {
    id: 'weibo', title: '微博热搜', link: 'https://weibo.com/hot/search',
    sources: [
      { id: 'weibo-official', label: '微博官方', fn: makeWeiboSource() },
    ],
  },
  {
    id: 'baidu', title: '百度热搜', link: 'https://top.baidu.com/board?tab=realtime',
    sources: [
      { id: 'baidu-official', label: '百度官方', fn: makeBaiduSource() },
    ],
  },
  {
    id: 'bili', title: 'B站热榜', link: 'https://www.bilibili.com/v/popular/rank',
    sources: [
      {
        id: 'bili-official-day',
        label: 'B站官方-每日热门',
        fn: async () => {
          const r = await fetchT('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1', { timeout: 5000 });
          const d = await readJsonLimited(r);
          if (d?.code !== 0) return null;
          return finalize((d.data?.list || [])
            .filter(i => i?.title && i?.bvid)            // B-003:bvid 必须存在
            .map(i => ({
              title: i.title,
              url: 'https://www.bilibili.com/video/' + encodeURIComponent(i.bvid),
            })));
        },
      },
      {
        id: 'bili-official-rank',
        label: 'B站官方-综合排行',
        fn: async () => {
          const r = await fetchT('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=1', { timeout: 5000 });
          const d = await readJsonLimited(r);
          if (d?.code !== 0) return null;
          return finalize((d.data?.list || [])
            .filter(i => i?.title && i?.bvid)
            .map(i => ({
              title: i.title,
              url: 'https://www.bilibili.com/video/' + encodeURIComponent(i.bvid),
            })));
        },
      },
    ],
  },
  {
    id: 'douyin', title: '抖音热榜', link: 'https://www.douyin.com/hot',
    sources: [
      { id: 'douyin-official', label: '抖音官方', fn: makeDouyinSource() },
    ],
  },
  {
    id: 'toutiao', title: '今日头条', link: 'https://www.toutiao.com/',
    sources: [
      {
        id: 'toutiao-official', label: '头条官方',
        fn: makeJsonSource(
          'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
          d => (d?.data || []).map(i => ({ title: i?.Title, url: i?.Url })),
        ),
      },
    ],
  },
  {
    id: 'tencent', title: '腾讯新闻', link: 'https://news.qq.com/',
    sources: [
      {
        id: 'inews', label: '腾讯新闻官方',
        fn: makeJsonSource(
          'https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=30',
          // 首条是无链接的榜单说明行(「腾讯新闻用户最关注的热点…」),按有无 url 滤掉
          d => (d?.idlist || []).flatMap(g => g?.newslist || [])
                .filter(i => i?.url || i?.surl)
                .map(i => ({ title: i?.title, url: i?.url || i?.surl })),
        ),
      },
    ],
  },
  {
    id: 'netease', title: '网易新闻', link: 'https://news.163.com/',
    sources: [
      {
        id: 'netease-official', label: '网易新闻官方',
        fn: makeJsonSource(
          'https://m.163.com/fe/api/hot/news/flow',
          d => (d?.data?.list || []).map(i => ({ title: i?.title, url: i?.url })),
        ),
      },
    ],
  },
  {
    id: 'sina', title: '新浪新闻', link: 'https://news.sina.com.cn/',
    sources: [
      {
        id: 'sina-official', label: '新浪新闻官方',
        fn: makeJsonSource(
          'https://newsapp.sina.cn/api/hotlist?newsId=HB-1-snhs%2Ftop_news_list-all',
          d => (d?.data?.hotList || []).map(i => ({
            title: i?.info?.title,
            url: i?.base?.base?.url,
          })),
        ),
      },
    ],
  },
  {
    id: 'tieba', title: '百度贴吧', link: 'https://tieba.baidu.com/hottopic/browse/topicList',
    sources: [
      {
        id: 'tieba-official', label: '贴吧官方',
        fn: makeJsonSource(
          'https://tieba.baidu.com/hottopic/browse/topicList',
          d => (d?.data?.bang_topic?.topic_list || [])
                .map(i => ({ title: i?.topic_name, url: i?.topic_url })),
        ),
      },
    ],
  },
  {
    id: 'v2ex', title: 'V2EX 最热', link: 'https://www.v2ex.com/?tab=hot',
    sources: [
      {
        id: 'v2ex-official', label: 'V2EX 官方 API',
        fn: makeJsonSource(
          'https://www.v2ex.com/api/topics/hot.json',
          d => (Array.isArray(d) ? d : []).map(i => ({ title: i?.title, url: i?.url })),
        ),
      },
    ],
  },
  {
    id: 'juejin', title: '稀土掘金', link: 'https://juejin.cn/hot',
    sources: [
      {
        id: 'juejin-official', label: '掘金官方',
        fn: makeJsonSource(
          'https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot',
          d => (d?.data || []).map(i => ({
            title: i?.content?.title,
            url: i?.content?.content_id
              ? 'https://juejin.cn/post/' + encodeURIComponent(i.content.content_id)
              : '',
          })),
        ),
      },
    ],
  },
  {
    id: 'sspai', title: '少数派', link: 'https://sspai.com/',
    sources: [
      { id: 'sspai-rss', label: '少数派 RSS', fn: makeRssSource('https://sspai.com/feed') },
    ],
  },
  {
    id: 'ithome', title: 'IT之家', link: 'https://www.ithome.com/',
    sources: [
      { id: 'ithome-rss', label: 'IT之家 RSS', fn: makeRssSource('https://www.ithome.com/rss/') },
    ],
  },
  {
    id: 'huxiu', title: '虎嗅', link: 'https://www.huxiu.com/',
    sources: [
      {
        id: 'huxiu-official', label: '虎嗅官方',
        fn: makeJsonSource(
          'https://api-article.huxiu.com/web/article/articleList?platform=www&pagesize=20',
          d => (d?.data?.dataList || []).map(i => ({ title: i?.title, url: i?.share_url })),
        ),
      },
    ],
  },
  {
    id: 'cto51', title: '51CTO', link: 'https://www.51cto.com/',
    sources: [
      {
        id: '51cto-official', label: '51CTO 官方',
        fn: makeJsonSource(
          'https://api-media.51cto.com/index/index/recommend',
          d => (d?.data?.data?.list || []).map(i => ({ title: i?.title, url: i?.url })),
        ),
      },
    ],
  },
  {
    id: 'douban', title: '豆瓣热门电影', link: 'https://movie.douban.com/',
    sources: [
      {
        id: 'douban-official', label: '豆瓣官方',
        fn: makeJsonSource(
          'https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%83%AD%E9%97%A8&page_limit=30&page_start=0',
          d => (d?.subjects || []).map(i => ({
            title: i?.rate ? `${i.title}(${i.rate})` : i?.title,
            url: i?.url,
          })),
        ),
      },
    ],
  },
  {
    id: 'weread', title: '微信读书飙升', link: 'https://weread.qq.com/',
    sources: [
      {
        id: 'weread-official', label: '微信读书官方',
        // bookId 转 web 链接需要私有 hash 算法,故不给单条 url,前端回落到榜单主页
        fn: makeJsonSource(
          'https://weread.qq.com/web/bookListInCategory/rising?rank=1',
          d => (d?.books || []).map(i => ({ title: i?.bookInfo?.title, url: '' })),
        ),
      },
    ],
  },
  {
    id: 'hellogithub', title: 'HelloGitHub', link: 'https://hellogithub.com/',
    sources: [
      {
        id: 'hellogithub-official', label: 'HelloGitHub 官方',
        fn: makeJsonSource(
          'https://abroad.hellogithub.com/v1/?sort_by=featured&page=1',
          d => (d?.data || []).map(i => ({
            title: i?.title || i?.name || i?.full_name,
            url: i?.item_id
              ? 'https://hellogithub.com/repository/' + encodeURIComponent(i.item_id)
              : '',
          })),
        ),
      },
    ],
  },
  {
    id: 'solidot', title: 'Solidot', link: 'https://www.solidot.org/',
    sources: [
      { id: 'solidot-rss', label: 'Solidot RSS', fn: makeRssSource('https://www.solidot.org/index.rss') },
    ],
  },
  {
    id: 'ifanr', title: '爱范儿', link: 'https://www.ifanr.com/',
    sources: [
      { id: 'ifanr-rss', label: '爱范儿 RSS', fn: makeRssSource('https://www.ifanr.com/feed') },
    ],
  },
  {
    id: 'hackernews', title: 'Hacker News', link: 'https://news.ycombinator.com/',
    sources: [
      { id: 'hn-official', label: 'Hacker News 官方 API', fn: hackerNewsSource },
    ],
  },
];

const SOURCE_DEFS = Object.fromEntries(HOT_CATALOG.map(c => [c.id, c.sources]));

export const HOT_IDS = HOT_CATALOG.map(c => c.id);

// 给前端下拉框用的精简目录(剥掉 sources,不外泄第三方接口地址)
export const HOT_META = HOT_CATALOG.map(({ id, title, link }) => ({ id, title, link }));

// 默认展示的 4 个槽位 —— 也是 cron 的固定预热集
export const DEFAULT_HOT_IDS = ['zhihu', 'weibo', 'baidu', 'bili'];

// 榜单已增至 20+,全量轮询是浪费:cron 只刷「默认集 + 近 1 小时被访问过的」。
// 冷门榜由 /api/hot/:id 命中缺失时按需拉取(与 holiday / weather 路由同一套路)。
const RECENT_TTL_MS = 60 * 60 * 1000;
const recentlyUsed = new Map();

export function markHotUsed(id) {
  recentlyUsed.set(id, Date.now());
}

export function activeHotIds() {
  const now = Date.now();
  for (const [id, ts] of recentlyUsed) {
    if (now - ts > RECENT_TTL_MS) recentlyUsed.delete(id);
  }
  return [...new Set([...DEFAULT_HOT_IDS, ...recentlyUsed.keys()])];
}

// issue#8:return runAndCache —— Redis 写失败时调用方仍拿得到新鲜 payload
export async function refreshHotList(id) {
  const sources = SOURCE_DEFS[id];
  if (!sources) return null;
  return runAndCache({
    key: 'hot:' + id,
    sources,
    hotTtlSec: HOT_TTL,
    transform: (items) => items.slice(0, 20),
  });
}

export async function refreshAllHot() {
  await Promise.allSettled(activeHotIds().map(refreshHotList));
}

// B-006:builtin url 用 null
export const HOT_BUILTIN_FALLBACK = {
  data: [{ title: '(暂无数据)', url: null }],
};
