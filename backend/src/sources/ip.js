// IP 检测后端代理 — 对「访客 IP」做服务端 geo 查询
//
// 访客 IP 来自 server.js 的 req.ip(Express trust proxy → Caddy 的 X-Forwarded-For)。
// 即「访客访问本站所用的 IP」。服务端对服务端查 geo,无 CORS、无浏览器 403。
//
// 注:无法在后端检测访客的「国内分流 IP」—— 那要观察访客自己的分流路由,
//     只能由浏览器侧完成(见 frontend/js/ip-weather.js 的 detectDomestic)。
import { fetchT, readJsonLimited } from '../fetcher.js';
import { cleanText } from '../safe.js';

// 内存缓存 IP → geo(避免每次访问都打外部 API)
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
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(ip, { data, ts: Date.now() });
}

function normalizeInfo(info) {
  if (!info || !info.ip) return null;
  return {
    ip: cleanText(info.ip, 64),
    city: cleanText(info.city || info.region || '', 100),
    country: cleanText(info.country || '', 100),
    countryCode: typeof info.countryCode === 'string'
      ? info.countryCode.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
      : '',
    source_label: info.source_label || '',
  };
}

// 私有 / 保留地址不查 geo(本地调试、内网直连等)
function isPublicIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const s = ip.replace(/^::ffff:/, '');           // IPv4-mapped IPv6
  if (s === '::1' || s === '127.0.0.1') return false;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(s)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return false;
  if (/^(f[cd]|fe80)/i.test(s)) return false;     // ULA / link-local IPv6
  return true;
}

// 多源 geo 查询 — 服务端对服务端,无 CORS
async function geoLookup(ip) {
  const apis = [
    {
      // ip-api.com:免费免 key,中文本地化(免费版仅 HTTP,服务端调用无妨)
      url: `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,country,countryCode,city,query`,
      label: 'ip-api.com',
      parse: d => d?.status === 'success' && {
        ip: d.query, city: d.city, country: d.country, countryCode: d.countryCode,
      },
    },
    {
      url: `https://ipinfo.io/${encodeURIComponent(ip)}/json`,
      label: 'ipinfo.io',
      parse: d => d?.ip && {
        ip: d.ip, city: d.city || d.region, country: d.country, countryCode: d.country,
      },
    },
    {
      url: `https://ipwho.is/${encodeURIComponent(ip)}`,
      label: 'ipwho.is',
      parse: d => d?.success && {
        ip: d.ip, city: d.city || d.region, country: d.country, countryCode: d.country_code,
      },
    },
  ];
  for (const api of apis) {
    try {
      const r = await fetchT(api.url, { timeout: 4500 });
      const info = api.parse(await readJsonLimited(r));
      const norm = normalizeInfo(info && { ...info, source_label: api.label });
      if (norm) return norm;
    } catch {}
  }
  return null;
}

// 给 server 路由用:geo-locate 访客 IP
export async function lookupIp(visitorIp) {
  if (!isPublicIp(visitorIp)) return null;
  const cached = getCache(visitorIp);
  if (cached) return cached;
  const info = await geoLookup(visitorIp);
  if (info) setCache(visitorIp, info);
  return info;
}
