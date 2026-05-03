import { fetchT, runAndCache } from '../fetcher.js';

const HOT_TTL = 1800; // 30min

// 国内城市 → 中国天气网 cityCode 映射(用于 itboy 接口)
// 覆盖直辖市 + 省会 + GDP 前 50 城市;不在表内的退到 Open-Meteo
const CN_CITY_CODES = {
  // 直辖市
  '北京': '101010100', '上海': '101020100', '天津': '101030100', '重庆': '101040100',
  // 港澳台
  '香港': '101320101', '澳门': '101330101', '台北': '101340101',
  // 广东
  '广州': '101280101', '深圳': '101280601', '东莞': '101281601', '佛山': '101280800',
  '中山': '101281701', '珠海': '101280701', '惠州': '101280301', '江门': '101281101',
  '汕头': '101280501', '湛江': '101281001', '茂名': '101282001', '肇庆': '101280901',
  // 长三角
  '杭州': '101210101', '宁波': '101210401', '温州': '101210701', '苏州': '101190401',
  '南京': '101190101', '无锡': '101190201', '常州': '101191101', '南通': '101190501',
  '徐州': '101190801',
  // 华北华中
  '济南': '101120101', '青岛': '101120201', '烟台': '101120501', '威海': '101121301',
  '郑州': '101180101', '洛阳': '101180901',
  '武汉': '101200101', '长沙': '101250101', '合肥': '101220101', '南昌': '101240101',
  // 西南
  '成都': '101270101', '昆明': '101290101', '贵阳': '101260101', '南宁': '101300101',
  '海口': '101310101', '三亚': '101310201',
  // 东北西北
  '沈阳': '101070101', '大连': '101070201', '哈尔滨': '101050101', '长春': '101060101',
  '西安': '101110101', '兰州': '101160101', '银川': '101170101', '乌鲁木齐': '101130101',
  '太原': '101100101', '呼和浩特': '101080101', '石家庄': '101090101',
  '拉萨': '101140101', '西宁': '101150101',
  // 福建
  '福州': '101230101', '厦门': '101230201', '泉州': '101230501',
};

function lookupCnCode(name) {
  if (!name) return null;
  if (CN_CITY_CODES[name]) return CN_CITY_CODES[name];
  // 容错:去掉"市/省/区"后缀
  const trimmed = name.replace(/[市省区县]$/, '');
  return CN_CITY_CODES[trimmed] || null;
}

function wmoText(c) {
  return {
    0: '晴', 1: '少云', 2: '多云', 3: '阴', 45: '雾',
    51: '小雨', 53: '小雨', 55: '中雨', 61: '小雨', 63: '中雨', 65: '大雨',
    71: '小雪', 73: '中雪', 75: '大雪', 80: '阵雨', 81: '阵雨', 82: '暴雨',
    95: '雷雨', 99: '强雷暴',
  }[c] ?? '--';
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
function makeItboySource(cityName) {
  return async () => {
    const code = lookupCnCode(cityName);
    if (!code) return null;
    const r = await fetchT(`http://t.weather.itboy.net/api/weather/city/${code}`, { timeout: 5000 });
    const d = await r.json();
    if (d?.status !== 200 || !d?.data) return null;
    const today = d.data.forecast?.[0];
    const type  = today?.type || '';
    const wendu = d.data.wendu;
    if (!type && !wendu) return null;
    return {
      text: `${type} ${wendu}°`.trim(),
      city: d.cityInfo?.city || cityName,
    };
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
    const r = await fetchT(`https://wttr.in/${encodeURIComponent(query)}?format=j1`, { timeout: 6000 });
    const d = await r.json();
    const cur = d?.current_condition?.[0];
    if (!cur) return null;
    const area = d.nearest_area?.[0]?.areaName?.[0]?.value || query;
    return {
      text: `${cur.weatherDesc?.[0]?.value || ''} ${cur.temp_C}°`,
      city: area,
    };
  };
}

export async function refreshWeatherForCity(city) {
  const key = 'weather:' + city.toLowerCase();
  // 国内城市优先用中国天气网(国家气象局数据),非国内自动跳过到 Open-Meteo
  await runAndCache({
    key,
    sources: [
      { id: 'cn-weather', label: '中国天气网', fn: makeItboySource(city) },
      { id: 'open-meteo', label: 'Open-Meteo', fn: makeOpenMeteoSource(() => geocode(city)) },
      { id: 'wttr',       label: 'wttr.in',    fn: makeWttrSource(city) },
    ],
    hotTtlSec: HOT_TTL,
  });
}

export async function refreshWeatherForCoords(lat, lon, label) {
  const key = `weather:coords:${lat},${lon}`;
  await runAndCache({
    key,
    sources: [
      { id: 'open-meteo', label: 'Open-Meteo', fn: makeOpenMeteoSource(async () => ({ lat, lon, name: label || '' })) },
      { id: 'wttr',       label: 'wttr.in',    fn: makeWttrSource(`${lat},${lon}`) },
    ],
    hotTtlSec: HOT_TTL,
  });
}

export const WEATHER_BUILTIN_FALLBACK = { data: { text: '天气 --', city: '' } };
