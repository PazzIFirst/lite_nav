// IP 检测后端代理 — F-013:避免前端直连第三方暴露访客 IP
// 用访客的 IP(从反代 X-Real-IP / X-Forwarded-For 拿)调外部 API,后端转发结果
// 前端只看到 /api/ip,不再向 ipwho.is/ipinfo.io/ip.sb 等暴露
import { fetchT } from '../fetcher.js';
import { cleanText } from '../safe.js';

// 简单内存缓存 IP → 信息(避免每次访问都打外部 API)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30min
const MAX_CACHE = 1000;

function getCache(ip) {
  const ent = cache.get(ip);
  if (!ent) return null;
  if (Date.now() - ent.ts > CACHE_TTL) { cache.delete(ip); return null; }
  return ent.data;
}
function setCache(ip, data) {
  if (cache.size >= MAX_CACHE) {
    // 简单 LRU:删一个最旧的
    cache.delete(cache.keys().next().value);
  }
  cache.set(ip, { data, ts: Date.now() });
}

function normalizeInfo(info) {
  if (!info) return null;
  return {
    ip: cleanText(info.ip, 64),
    city: cleanText(info.city || info.region || '', 100),
    country: cleanText(info.country || '', 100),
    countryCode: typeof info.countryCode === 'string'
      ? info.countryCode.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
      : '',
  };
}

// 国内 IP 检测(走国内服务,走的应该是访客 IP,但实际是后端服务器 IP)
// 注意:这里是后端代发,所以查到的是后端服务器的国内 IP,不是访客的;
// 如果访客在国内、后端在境外,这个值反映的是后端
async function fetchDomestic() {
  const apis = [
    {
      url: 'https://whois.pconline.com.cn/ipJson.jsp?json=true',
      parse: d => d?.ip && !d?.err && {
        ip: d.ip, city: d.city || d.pro, country: '中国', countryCode: 'CN',
      },
    },
  ];
  for (const api of apis) {
    try {
      const r = await fetchT(api.url, { timeout: 4000 });
      const data = await r.json();
      const info = api.parse(data);
      if (info?.ip) return normalizeInfo(info);
    } catch {}
  }
  return null;
}

async function fetchGoogle(visitorIp) {
  // 用具体访客 IP 查询
  const apis = visitorIp ? [
    {
      url: `https://ipwho.is/${visitorIp}`,
      parse: d => d?.success && {
        ip: d.ip, city: d.city || d.region, country: d.country, countryCode: d.country_code,
      },
    },
    {
      url: `https://ipinfo.io/${visitorIp}/json`,
      parse: d => d?.ip && {
        ip: d.ip, city: d.city || d.region, country: d.country, countryCode: d.country,
      },
    },
  ] : [
    {
      url: 'https://ipwho.is/',
      parse: d => d?.success && {
        ip: d.ip, city: d.city || d.region, country: d.country, countryCode: d.country_code,
      },
    },
    {
      url: 'https://ipinfo.io/json',
      parse: d => d?.ip && {
        ip: d.ip, city: d.city || d.region, country: d.country, countryCode: d.country,
      },
    },
  ];

  for (const api of apis) {
    try {
      const r = await fetchT(api.url, { timeout: 4000 });
      const info = api.parse(await r.json());
      if (info?.ip) return normalizeInfo(info);
    } catch {}
  }
  return null;
}

// 给 server 路由用:返回 { domestic, google }
export async function lookupIp(visitorIp) {
  const cached = visitorIp ? getCache(visitorIp) : null;
  if (cached) return { ...cached, _cached: true };

  const [domestic, google] = await Promise.allSettled([
    fetchDomestic(),
    fetchGoogle(visitorIp),
  ]);

  const out = {
    domestic: domestic.status === 'fulfilled' ? domestic.value : null,
    google:   google.status   === 'fulfilled' ? google.value   : null,
  };
  if (visitorIp && (out.domestic || out.google)) setCache(visitorIp, out);
  return out;
}
