// 多国节假日:支持任意 ISO 3166-1 alpha-2 国家代码
// CN 走中国专用链(含调休信息);其他国家走 Nager.Date + date-holidays(离线兜底)
import fs from 'node:fs';
import path from 'node:path';
import lunar from 'lunar-javascript';
import Holidays from 'date-holidays';
import { fetchT, runAndCache } from '../fetcher.js';
import { translateHolidayName } from './holiday-i18n.js';

const { Solar } = lunar;

const HOT_TTL = 7 * 24 * 3600;
const PACKED_DATA_DIR = '/app/data/holiday-cn';

// ===== 国家展示元信息 =====
export const SUPPORTED_COUNTRIES = [
  { code: 'CN', name: '中国',     flag: 'cn' },
  { code: 'US', name: '美国',     flag: 'us' },
  { code: 'GB', name: '英国',     flag: 'gb' },
  { code: 'DE', name: '德国',     flag: 'de' },
  { code: 'JP', name: '日本',     flag: 'jp' },
  { code: 'FR', name: '法国',     flag: 'fr' },
  { code: 'KR', name: '韩国',     flag: 'kr' },
  { code: 'SG', name: '新加坡',   flag: 'sg' },
  { code: 'CA', name: '加拿大',   flag: 'ca' },
  { code: 'AU', name: '澳大利亚', flag: 'au' },
  { code: 'IN', name: '印度',     flag: 'in' },
  { code: 'IT', name: '意大利',   flag: 'it' },
  { code: 'ES', name: '西班牙',   flag: 'es' },
  { code: 'RU', name: '俄罗斯',   flag: 'ru' },
  { code: 'BR', name: '巴西',     flag: 'br' },
  { code: 'NL', name: '荷兰',     flag: 'nl' },
  { code: 'CH', name: '瑞士',     flag: 'ch' },
  { code: 'TH', name: '泰国',     flag: 'th' },
  { code: 'MY', name: '马来西亚', flag: 'my' },
  { code: 'NZ', name: '新西兰',   flag: 'nz' },
];

// ===== 通用工具:连续日期合并为区间 =====
function mergeRanges(items) {
  // items: [{ name, date }] sorted asc
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const ranges = [];
  for (const item of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.name === item.name) {
      const lastD = new Date(last.e);
      const thisD = new Date(item.date);
      const diff = Math.round((thisD - lastD) / 86400000);
      if (diff <= 1) { last.e = item.date; continue; }
    }
    ranges.push({ name: item.name, s: item.date, e: item.date });
  }
  return ranges;
}

// ===== CN 数据源链 =====

// 1. timor.tech(含调休)
async function cnFromTimor(year) {
  const r = await fetchT(`https://timor.tech/api/holiday/year/${year}`, { timeout: 6000 });
  const d = await r.json();
  if (!d?.holiday) return null;
  const dates = Object.entries(d.holiday)
    .filter(([, v]) => v.holiday === true)
    .map(([k, v]) => ({ date: `${year}-${k}`, name: v.name }));
  const merged = mergeRanges(dates);
  return merged.length ? merged : null;
}

// 2. NateScarlet/holiday-cn GitHub raw(含调休)
async function cnFromGitHub(year) {
  const r = await fetchT(
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
    { timeout: 6000 }
  );
  const d = await r.json();
  if (!Array.isArray(d?.days)) return null;
  const offDays = d.days.filter(x => x.isOffDay).map(x => ({ name: x.name, date: x.date }));
  const merged = mergeRanges(offDays);
  return merged.length ? merged : null;
}

// 3. 镜像内打包数据(Dockerfile 构建时拉取的 holiday-cn 副本)
async function cnFromPacked(year) {
  const file = path.join(PACKED_DATA_DIR, `${year}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(d?.days)) return null;
    const offDays = d.days.filter(x => x.isOffDay).map(x => ({ name: x.name, date: x.date }));
    const merged = mergeRanges(offDays);
    return merged.length ? merged : null;
  } catch { return null; }
}

// 4. 算法兜底:用 lunar-javascript 算关键节日的农历日期
//    ⚠ 不含调休信息,但能保证春节/端午/中秋等核心节日永远算得出来
function cnFromAlgorithm(year) {
  const fmt = s => `${s.getYear()}-${String(s.getMonth()).padStart(2,'0')}-${String(s.getDay()).padStart(2,'0')}`;
  const out = [
    { name: '元旦',   s: `${year}-01-01`, e: `${year}-01-01` },
    { name: '劳动节', s: `${year}-05-01`, e: `${year}-05-01` },
    { name: '国庆节', s: `${year}-10-01`, e: `${year}-10-07` },
  ];

  // 农历节日:Lunar.fromYmd(农历年, 月, 日).getSolar()
  const lunarFestivals = [
    { name: '春节(农历正月初一)', m: 1,  d: 1  },
    { name: '端午节(农历五月初五)', m: 5,  d: 5  },
    { name: '中秋节(农历八月十五)', m: 8,  d: 15 },
  ];
  for (const f of lunarFestivals) {
    try {
      const date = fmt(lunar.Lunar.fromYmd(year, f.m, f.d).getSolar());
      out.push({ name: f.name, s: date, e: date });
    } catch {}
  }

  // 清明:节气
  try {
    const qm = lunar.Lunar.fromDate(new Date(year, 3, 5)).getJieQiTable()['清明'];
    if (qm) {
      const date = fmt(qm);
      out.push({ name: '清明', s: date, e: date });
    }
  } catch {}

  return out.length ? out : null;
}

// ===== 通用国家数据源链(非 CN)=====
// 输出每条 holiday 都包含:
//   name        — 中文(经翻译)
//   name_native — 当地原文(英文/德文/日文等)
//   s, e        — 日期区间

// 1. Nager.Date API(localName 是当地原文)
async function fromNagerDate(country, year) {
  const r = await fetchT(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, { timeout: 6000 });
  const list = await r.json();
  if (!Array.isArray(list) || !list.length) return null;
  return list.map(h => {
    const native = h.localName || h.name;
    return {
      name: translateHolidayName(country, native),
      name_native: native,
      s: h.date,
      e: h.date,
    };
  });
}

// 2. date-holidays npm(完全离线,~200 国家)
function fromDateHolidaysNpm(country, year) {
  try {
    // 先取当地语言名(更接近 Nager.Date 的 key)
    const hdLocal = new Holidays(country);
    const localList = hdLocal.getHolidays(year);
    if (!Array.isArray(localList) || !localList.length) return null;
    return localList
      .filter(h => h.type === 'public')
      .map(h => {
        const d = new Date(h.start);
        const ymd = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const native = h.name;
        return {
          name: translateHolidayName(country, native),
          name_native: native,
          s: ymd,
          e: ymd,
        };
      });
  } catch { return null; }
}

// ===== 主调度函数 =====
function ensureNativeField(items) {
  // 统一保证每条 holiday 都有 name_native(展示中文 + 悬停原文)
  if (!Array.isArray(items)) return items;
  for (const h of items) {
    if (h.name_native == null) h.name_native = h.name;
  }
  return items;
}

async function fetchYearForCountry(country, year) {
  if (country === 'CN') {
    const sources = [
      { id: 'timor',     label: 'timor.tech',                    fn: () => cnFromTimor(year) },
      { id: 'github',    label: 'NateScarlet/holiday-cn (CDN)',  fn: () => cnFromGitHub(year) },
      { id: 'packed',    label: 'holiday-cn 镜像内打包',          fn: () => cnFromPacked(year) },
      { id: 'algorithm', label: 'lunar-javascript 算法推算',      fn: () => cnFromAlgorithm(year) },
      { id: 'date-holidays', label: 'date-holidays npm 包',       fn: () => fromDateHolidaysNpm('CN', year) },
    ];
    for (const s of sources) {
      try {
        const data = await s.fn();
        if (data?.length) return { data: ensureNativeField(data), source: s.id, source_label: s.label };
      } catch {}
    }
    return null;
  }

  const sources = [
    { id: 'nager',         label: 'Nager.Date API',     fn: () => fromNagerDate(country, year) },
    { id: 'date-holidays', label: 'date-holidays npm 包', fn: () => fromDateHolidaysNpm(country, year) },
  ];
  for (const s of sources) {
    try {
      const data = await s.fn();
      if (data?.length) return { data: ensureNativeField(data), source: s.id, source_label: s.label };
    } catch {}
  }
  return null;
}

export async function refreshHolidayForCountry(country) {
  const year = new Date().getFullYear();
  await runAndCache({
    key: `holiday:${country}`,
    sources: [{
      id: 'merged',
      label: '多源合并',
      fn: async () => {
        const [cur, next] = await Promise.allSettled([
          fetchYearForCountry(country, year),
          fetchYearForCountry(country, year + 1),
        ]);
        const out = [];
        const subs = [];
        if (cur.status === 'fulfilled' && cur.value)  { out.push(...cur.value.data);  subs.push(`${year}:${cur.value.source}`); }
        if (next.status === 'fulfilled' && next.value){ out.push(...next.value.data); subs.push(`${year+1}:${next.value.source}`); }
        if (!out.length) return null;
        return { items: out, sub_sources: subs };
      },
    }],
    hotTtlSec: HOT_TTL,
  });
}

export async function refreshAllHolidays(countries) {
  await Promise.allSettled((countries || ['CN','US','GB','DE','JP']).map(refreshHolidayForCountry));
}

// 内置兜底(防止全部失败)
export const HOLIDAY_BUILTIN_FALLBACK = {
  data: { items: [], sub_sources: ['empty'] },
};
