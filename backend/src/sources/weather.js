import { fetchT, runAndCache } from '../fetcher.js';

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

// W-005 修复:补全 WMO 天气码
function wmoText(c) {
  return {
    0: '晴', 1: '少云', 2: '多云', 3: '阴',
    45: '雾', 48: '雾凇',
    51: '毛毛雨', 53: '小雨', 55: '中雨',
    56: '冻雨(轻)', 57: '冻雨',
    61: '小雨', 63: '中雨', 65: '大雨',
    66: '冻雨(轻)', 67: '冻雨',
    71: '小雪', 73: '中雪', 75: '大雪',
    77: '雪粒',
    80: '阵雨', 81: '阵雨', 82: '暴雨',
    85: '阵雪', 86: '强阵雪',
    95: '雷雨', 96: '雷雨夹冰雹', 99: '强雷暴',
  }[c] ?? '--';
}

// W-002 修复:weather key normalize(trim+小写,长度限制)
function normalizeCityKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 50);
}

async function geocode(name) {
  const r = await fetchT(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`,
    { timeout: 5000 }
  );
  const d = await r.json();
  const hit = d?.results?.[0];
  if (!hit) return null;
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
      const d = await r.json();
      if (d?.status !== 200 || !d?.data) return null;
      const today = d.data.forecast?.[0];
      const type  = today?.type || '';
      const wendu = d.data.wendu;
      if (!type && !wendu) return null;
      return { text: `${type} ${wendu}°`.trim(), city: d.cityInfo?.city || cityName };
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
    const d = await r.json();
    if (d?.current?.temperature_2m == null) return null;
    return {
      text: `${wmoText(d.current.weather_code)} ${Math.round(d.current.temperature_2m)}°`,
      city: c.name,
    };
  };
}

function makeWttrSource(query) {
  return async () => {
    // W-006 修复:加 lang=zh
    const r = await fetchT(`https://wttr.in/${encodeURIComponent(query)}?format=j1&lang=zh`, { timeout: 6000 });
    const d = await r.json();
    const cur = d?.current_condition?.[0];
    if (!cur) return null;
    const area = d.nearest_area?.[0]?.areaName?.[0]?.value || query;
    // wttr.in 中文返回在 lang_zh 字段
    const desc = cur.lang_zh?.[0]?.value || cur.weatherDesc?.[0]?.value || '';
    return {
      text: `${desc} ${cur.temp_C}°`.trim(),
      city: area,
    };
  };
}

export async function refreshWeatherForCity(city) {
  // W-002 修复:模块内 normalize
  const trimmed = String(city || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  if (!trimmed) return;
  const key = 'weather:' + normalizeCityKey(trimmed);
  await runAndCache({
    key,
    sources: [
      { id: 'cn-weather', label: '中国天气网', fn: makeItboySource(trimmed) },
      { id: 'open-meteo', label: 'Open-Meteo', fn: makeOpenMeteoSource(() => geocode(trimmed)) },
      { id: 'wttr',       label: 'wttr.in',    fn: makeWttrSource(trimmed) },
    ],
    hotTtlSec: HOT_TTL,
  });
}

export async function refreshWeatherForCoords(lat, lon, label) {
  // W-003/W-004 修复:模块内归一化 + 二次校验
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || la < -90  || la > 90)  return;
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) return;
  const laNorm = la.toFixed(3);
  const loNorm = lo.toFixed(3);
  const labelStr = String(label || '').trim().slice(0, 50);
  const key = `weather:coords:${laNorm},${loNorm}`;
  await runAndCache({
    key,
    sources: [
      { id: 'open-meteo', label: 'Open-Meteo', fn: makeOpenMeteoSource(async () => ({ lat: la, lon: lo, name: labelStr })) },
      { id: 'wttr',       label: 'wttr.in',    fn: makeWttrSource(`${laNorm},${loNorm}`) },
    ],
    hotTtlSec: HOT_TTL,
  });
}

export const WEATHER_BUILTIN_FALLBACK = { data: { text: '天气 --', city: '' } };
