// 多国节假日:支持白名单内的国家代码(见 SUPPORTED_COUNTRIES)
// CN 走中国专用链(含调休信息);其他国家走 Nager.Date + date-holidays(离线兜底)
import fs from 'node:fs';
import path from 'node:path';
import lunar from 'lunar-javascript';
import Holidays from 'date-holidays';
import { fetchT, runAndCache } from '../fetcher.js';
import { translateHolidayName } from './holiday-i18n.js';
import { safeDate, safeHttpUrl } from '../safe.js';

const { Solar } = lunar;

const HOT_TTL = 7 * 24 * 3600;
// H-002 修复:打包数据路径走 env,默认仍是 /app/data/holiday-cn 兼容现有 Dockerfile
const PACKED_DATA_DIR = process.env.PACKED_HOLIDAY_DIR || '/app/data/holiday-cn';

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

// 把含 {s,e} 的范围展开成单日 [{name,date}] —— mergeRanges 输入需为单日
// 否则多天假期(春节/国庆)在最终聚合时会被压成 1 天(issue #4)
function expandHolidayDays(h) {
  const days = [];
  const s = h.s, e = h.e || h.s;
  let cur = s;
  while (cur <= e) {
    days.push({ name: h.name, date: cur });
    const [y, m, d] = cur.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    cur = dt.toISOString().slice(0, 10);
    if (days.length > 60) break;   // 防御:单个假期最多展开 60 天
  }
  return days;
}

// ===== CN 数据源链 =====

// 1. timor.tech(含调休)
async function cnFromTimor(year) {
  const r = await fetchT(`https://timor.tech/api/holiday/year/${year}`, { timeout: 6000 });
  const d = await r.json();
  if (!d?.holiday) return null;
  const dates = Object.entries(d.holiday)
    .filter(([k, v]) => v.holiday === true && /^\d{2}-\d{2}$/.test(k))   // H-010:校验 MM-DD 格式
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

// 4. 算法兜底(H-004 修复):仅输出节日当天,**不再写国庆 10/01-10/07** 的虚假调休
//    实际调休由国务院前一年公告,任何离线方案都无法预测,只标节日本身即可
function cnFromAlgorithm(year) {
  const fmt = s => `${s.getYear()}-${String(s.getMonth()).padStart(2,'0')}-${String(s.getDay()).padStart(2,'0')}`;
  const out = [
    { name: '元旦(算法兜底,不含调休)',   s: `${year}-01-01`, e: `${year}-01-01` },
    { name: '劳动节(算法兜底,不含调休)', s: `${year}-05-01`, e: `${year}-05-01` },
    { name: '国庆节(算法兜底,不含调休)', s: `${year}-10-01`, e: `${year}-10-01` },
  ];

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
  return list
    .filter(h => safeDate(h.date))                     // 校验日期格式
    .map(h => {
      const native = h.localName || h.name;
      return {
        name: translateHolidayName(country, native),
        name_native: native,
        s: h.date.slice(0, 10),                        // H-003:用 ISO 字符串而非 new Date(避免时区漂移)
        e: h.date.slice(0, 10),
      };
    });
}

// 2. date-holidays npm(完全离线,~200 国家)
function fromDateHolidaysNpm(country, year) {
  try {
    const hdLocal = new Holidays(country);
    const localList = hdLocal.getHolidays(year);
    if (!Array.isArray(localList) || !localList.length) return null;
    return localList
      .filter(h => h.type === 'public')
      .map(h => {
        // H-003 修复:date-holidays 的 h.date 已是字符串,直接 slice 避开 new Date 时区问题
        const dateStr = typeof h.date === 'string' ? h.date.slice(0, 10) :
                        (() => {
                          const d = new Date(h.start);
                          return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
                        })();
        const ymd = safeDate(dateStr);
        if (!ymd) return null;
        const native = h.name;
        return {
          name: translateHolidayName(country, native),
          name_native: native,
          s: ymd,
          e: ymd,
        };
      })
      .filter(Boolean);
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

// 通用去重 + 排序(H-006/H-007/H-008 修复)
function dedupAndSort(items) {
  const seen = new Set();
  const out = [];
  for (const h of items) {
    const key = `${h.name}|${h.s}|${h.e}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  out.sort((a, b) => a.s.localeCompare(b.s));
  return out;
}

export async function refreshHolidayForCountry(country) {
  const year = new Date().getFullYear();
  await runAndCache({
    key: `holiday:${country}`,
    // H-005:source_label 包含真实子源
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
        if (cur.status === 'fulfilled' && cur.value)   { out.push(...cur.value.data);  subs.push(`${year}:${cur.value.source}`); }
        if (next.status === 'fulfilled' && next.value) { out.push(...next.value.data); subs.push(`${year+1}:${next.value.source}`); }
        if (!out.length) return null;

        // H-008/issue#4:展开多天范围 → mergeRanges 重新合并 → 保留完整 e
        const merged = mergeRanges(out.flatMap(expandHolidayDays));
        // mergeRanges 不保留 name_native,按 name 重新拼回(同名假期翻译相同)
        const final = merged.map(m => {
          const orig = out.find(h => h.name === m.name);
          return { ...m, name_native: orig?.name_native || m.name };
        });
        const items = dedupAndSort(final);
        const sourceLabel = subs.length ? `多源合并(${subs.join(', ')})` : '多源合并';
        return { items, sub_sources: subs, source_label_detail: sourceLabel };
      },
    }],
    hotTtlSec: HOT_TTL,
  });
}

export async function refreshAllHolidays(countries) {
  await Promise.allSettled((countries || ['CN','US','GB','DE','JP']).map(refreshHolidayForCountry));
}

// 内置兜底(H-009 修复:CN 用算法兜底,其他国家空数组)
const _now = new Date();
const _curYear = _now.getFullYear();
let _builtinCnItems = [];
try {
  const cur = cnFromAlgorithm(_curYear);
  const next = cnFromAlgorithm(_curYear + 1);
  _builtinCnItems = dedupAndSort([
    ...(cur || []).map(h => ({ ...h, name_native: h.name })),
    ...(next || []).map(h => ({ ...h, name_native: h.name })),
  ]);
} catch {}

export const HOLIDAY_BUILTIN_FALLBACK = {
  data: { items: _builtinCnItems, sub_sources: ['algorithm-fallback'] },
};

// 非中国国家不能套用中国农历兜底(返回错国家的节日 = 假数据,比空更糟)
const HOLIDAY_EMPTY_FALLBACK = {
  data: { items: [], sub_sources: ['empty-fallback'] },
};

// 按请求的国家选兜底:CN 用算法推算,其他国家返回空 items
export function holidayFallback(country) {
  return country === 'CN' ? HOLIDAY_BUILTIN_FALLBACK : HOLIDAY_EMPTY_FALLBACK;
}
