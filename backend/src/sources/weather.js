import { fetchT, runAndCache, readJsonLimited } from '../fetcher.js';

const HOT_TTL = 1800; // 30min

// 国内城市 → 中国天气网 cityCode 映射(用于 itboy 接口)
// 覆盖全国地级市 + 主要县级市,共 446 条
// 数据来源:Memoyu/ChinaWeatherCityCode-JSON(GitHub)
// 不在表内的退到 Open-Meteo;有重名时取数据集中的第一条
// 数据来源:Memoyu/ChinaWeatherCityCode-JSON。运行时从 ./data/cn-cities.json 加载
// 不在表内的退到 Open-Meteo;有重名时取数据集中的第一条
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let CN_CITY_CODES = {};
try {
  CN_CITY_CODES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/cn-cities.json'), 'utf8'));
} catch (e) {
  console.error('[weather] failed to load cn-cities.json:', e.message);
}
// W-008 修复:增强 normalize 规则,处理多字行政区后缀
function lookupCnCode(name) {
  if (!name) return null;
  if (CN_CITY_CODES[name]) return CN_CITY_CODES[name];
  // 依次去除多字 / 单字行政区后缀
  const candidates = [
    name,
    name.replace(/(自治区|自治州|特别行政区|地区|县级市|省辖市|盟|旗)$/, ''),
    name.replace(/[市省区县盟州]$/, ''),
    name.replace(/[市省区县盟州]+$/g, ''),
  ];
  for (const c of candidates) {
    if (c && CN_CITY_CODES[c]) return CN_CITY_CODES[c];
  }
  return null;
}

// WMO 4677 天气码 → 中文。28 条,即 Open-Meteo 实际使用的全集。
// 译名与「三源严格并集」的词表对齐 —— 三个源的 condition 最终要落进同一套
// 天气名,才能共用一张图标映射表。历史版本有 4 处合并错误,已改正:
//   · 51/53/55 是 drizzle(毛毛雨三档),原写成「毛毛雨/小雨/中雨」,与 61/63 的 rain 撞车
//   · 56/57 是冻毛毛雨,66/67 才是冻雨,原来四个都写「冻雨」
//   · 80/81 原来都写「阵雨」,丢了强度差
//   · 82 是 violent showers(强阵雨),不是「暴雨」那个量级定义
function wmoText(c) {
  return {
    0: '晴', 1: '晴间少云', 2: '多云', 3: '阴',
    45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '浓毛毛雨',
    56: '轻冻毛毛雨', 57: '强冻毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨',
    66: '轻冻雨', 67: '冻雨',
    71: '小雪', 73: '中雪', 75: '大雪',
    77: '米雪',
    80: '小阵雨', 81: '阵雨', 82: '强阵雨',
    85: '小阵雪', 86: '阵雪',
    95: '雷阵雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
  }[c] ?? '';
}

// W-002 修复:weather key normalize(trim+小写,长度限制)
function normalizeCityKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 50);
}

async function geocode(name) {
  // W-007 修复:取 5 个候选,智能选最合适(避开 Open-Meteo 数据集里的拼音脏值)
  const r = await fetchT(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=zh&format=json`,
    { timeout: 5000 }
  );
  const d = await readJsonLimited(r);
  const results = d?.results || [];
  if (!results.length) return null;
  const lowerInput = String(name).toLowerCase();
  const isCn    = s => /[一-鿿]/.test(s || '');
  const isAscii = s => /^[\x20-\x7e]+$/.test(s || '');
  // 优先级(language=zh 下中文 name 是规范的):
  //   中文 name → 精确匹配输入 → 纯英文 name → 第一个
  // 同名城市存在(如新加坡 vs 南非 Singapore)时,exact 反而会选错;
  // language=zh 数据集第一个中文 name 通常就是用户预期那个
  const cn    = results.find(r => isCn(r.name));
  const exact = results.find(r => (r.name || '').toLowerCase() === lowerInput);
  const en    = results.find(r => isAscii(r.name));
  const hit = cn || exact || en || results[0];
  return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
}

// 中国天气网(itboy 镜像)— 国内城市数据来自国家气象局,准确度高于 Open-Meteo
// W-001 修复:优先 HTTPS,失败再 HTTP
function makeItboySource(cityName) {
  return async () => {
    const code = lookupCnCode(cityName);
    if (!code) return null;
    const tryFetch = async (proto) => {
      const r = await fetchT(`${proto}://t.weather.itboy.net/api/weather/city/${code}`, { timeout: 5000 });
      const d = await readJsonLimited(r);
      if (d?.status !== 200 || !d?.data) return null;
      const today = d.data.forecast?.[0];
      const type  = today?.type || '';
      const wendu = d.data.wendu;
      if (!type && !wendu) return null;
      const t = Number(wendu);
      return {
        text: `${type} ${wendu}°`.trim(),          // 保留:老前端/老缓存仍读这个
        city: d.cityInfo?.city || cityName,
        temp: Number.isFinite(t) ? Math.round(t) : null,
        condition: type,
      };
    };
    try { return await tryFetch('https'); }
    catch { return await tryFetch('http'); }
  };
}

function makeOpenMeteoSource(getCoords) {
  return async () => {
    const c = await getCoords();
    if (!c) return null;
    const r = await fetchT(
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code&timezone=auto`,
      { timeout: 5000 }
    );
    const d = await readJsonLimited(r);
    if (d?.current?.temperature_2m == null) return null;
    const code = d.current.weather_code;
    const cond = wmoText(code);
    const temp = Math.round(d.current.temperature_2m);
    return {
      text: `${cond} ${temp}°`.trim(),
      city: c.name,
      temp,
      condition: cond,
      wmo_code: typeof code === 'number' ? code : null,
    };
  };
}

function makeWttrSource(query) {
  return async () => {
    // lang 必须是 zh-cn 不能是 zh:上游 WWO 对 `zh` 没有简体译文,会原样回英文,
    // 于是 lang_zh 里躺的是 "Partly Cloudy" —— 这一路以前实际输出的是英文。
    const r = await fetchT(`https://wttr.in/${encodeURIComponent(query)}?format=j1&lang=zh-cn`, { timeout: 6000 });
    const d = await readJsonLimited(r);
    const cur = d?.current_condition?.[0];
    if (!cur) return null;
    const area = d.nearest_area?.[0]?.areaName?.[0]?.value || query;
    // 键名随 lang 变化,逐个兜:zh-cn → 通用 xx → 老的 zh → 英文原文
    const desc = cur['lang_zh-cn']?.[0]?.value
              || cur.lang_xx?.[0]?.value
              || cur.lang_zh?.[0]?.value
              || cur.weatherDesc?.[0]?.value || '';
    const t = Number(cur.temp_C);
    return {
      text: `${desc} ${cur.temp_C}°`.trim(),
      city: area,
      temp: Number.isFinite(t) ? Math.round(t) : null,
      condition: desc,
      wwo_code: Number.isFinite(Number(cur.weatherCode)) ? Number(cur.weatherCode) : null,
    };
  };
}

export async function refreshWeatherForCity(city) {
  // W-002 修复:模块内 normalize
  const trimmed = String(city || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  if (!trimmed) return null;
  const key = 'weather:' + normalizeCityKey(trimmed);
  // issue#8:返回 fresh payload,让路由在 Redis 写失败时仍能直接使用
  return runAndCache({
    key,
    sources: [
      { id: 'cn-weather', label: '中国天气网', fn: makeItboySource(trimmed) },
      { id: 'open-meteo', label: 'Open-Meteo', fn: makeOpenMeteoSource(() => geocode(trimmed)) },
      { id: 'wttr',       label: 'wttr.in',    fn: makeWttrSource(trimmed) },
    ],
    hotTtlSec: HOT_TTL,
  });
}

// 坐标天气缓存键 — 读(server.js)、写(本模块)必须用同一格式,否则刷新写入后读不到
export function coordsKey(lat, lon) {
  return `weather:coords:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

export async function refreshWeatherForCoords(lat, lon, label) {
  // W-003/W-004 修复:模块内归一化 + 二次校验
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || la < -90  || la > 90)  return null;
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) return null;
  const laNorm = la.toFixed(3);
  const loNorm = lo.toFixed(3);
  const labelStr = String(label || '').trim().slice(0, 50);
  const key = coordsKey(la, lo);
  // issue#8:返回 fresh payload,让路由在 Redis 写失败时仍能直接使用
  return runAndCache({
    key,
    sources: [
      { id: 'open-meteo', label: 'Open-Meteo', fn: makeOpenMeteoSource(async () => ({ lat: la, lon: lo, name: labelStr })) },
      { id: 'wttr',       label: 'wttr.in',    fn: makeWttrSource(`${laNorm},${loNorm}`) },
    ],
    hotTtlSec: HOT_TTL,
  });
}

export const WEATHER_BUILTIN_FALLBACK = {
  data: { text: '天气 --', city: '', temp: null, condition: '' },
};
