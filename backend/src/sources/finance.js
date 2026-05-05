import iconv from 'iconv-lite';
import { fetchT, runAndCache } from '../fetcher.js';
import redis, { writeBoth } from '../redis.js';
import { safeNumber, safeParse } from '../safe.js';

const KEY = 'finance';
const HOT_TTL = 60;

// 各指标的合理值区间(M-006):用于过滤异常值
// min/max 给宽的容忍度,只过滤明显错误(如 changePct=24977%)
const VALUE_RANGES = {
  usdcny: { min: 1,    max: 20    },
  sse:    { min: 500,  max: 20000 },
  szse:   { min: 1000, max: 50000 },
  csi300: { min: 500,  max: 20000 },
  hsi:    { min: 5000, max: 60000 },
  nasdaq: { min: 1000, max: 100000 },
  sp500:  { min: 500,  max: 30000 },
  djia:   { min: 5000, max: 200000 },
  gold:   { min: 100,  max: 10000 },  // 上海金 ¥/克 范围
};
const PCT_MIN = -50, PCT_MAX = 50;  // 涨跌幅合理区间

function fmtNum(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// 在指标层面记录 fetched_at + freshness(M-001 修复:每个指标独立时间戳)
function makeItem(id, price, pct, sourceId, sourceLabel) {
  const range = VALUE_RANGES[id];
  if (!Number.isFinite(price)) return null;
  if (range && (price < range.min || price > range.max)) return null;
  let pctNum = Number.isFinite(pct) ? pct : null;
  if (pctNum != null && (pctNum < PCT_MIN || pctNum > PCT_MAX)) pctNum = null;
  return {
    value: fmtNum(price, price >= 1000 ? 0 : 2),
    changePct: pctNum,
    _meta: {
      source: sourceId,
      source_label: sourceLabel,
      fetched_at: Date.now(),
      freshness: 'fresh',
    },
  };
}

async function loadFromEastMoney() {
  const secids = '1.000001,0.399001,1.000300,100.HSI,100.NDX,100.SPX,100.DJIA,118.AU9999';
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?ut=fa5fd1943c7b386f172d6893dbfba10b&fltt=2&invt=2&fields=f2,f3,f12,f14&secids=${secids}`;
  const r = await fetchT(url, { timeout: 5000 });
  const d = await r.json();
  const list = d?.data?.diff;
  if (!Array.isArray(list)) return null;
  const codeMap = {
    '000001': 'sse', '399001': 'szse', '000300': 'csi300',
    'HSI': 'hsi', 'NDX': 'nasdaq', 'SPX': 'sp500', 'DJIA': 'djia', 'AU9999': 'gold',
  };
  const out = {};
  for (const item of list) {
    const id = codeMap[item.f12];
    if (!id) continue;
    const n = Number(item.f2);             // M-003/M-004 修复
    const pct = Number(item.f3);
    const filled = makeItem(id, n, pct, 'eastmoney', '东方财富');
    if (filled) out[id] = filled;
  }
  return Object.keys(out).length ? out : null;
}

async function loadFromSina() {
  // ⚠ 新浪美股/港股因 GFW 返回空,nf_AU0 字段格式不同,弃用 — 只用作 A 股兜底
  const syms = 's_sh000001,s_sz399001,s_sh000300';
  const url = `https://hq.sinajs.cn/list=${syms}`;
  const r = await fetchT(url, {
    timeout: 6000,
    headers: { 'Referer': 'https://finance.sina.com.cn/' },
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = iconv.decode(buf, 'gb18030');
  const SINA_MAP = [
    { sym: 's_sh000001', id: 'sse',    pi: 1, ci: 3 },
    { sym: 's_sz399001', id: 'szse',   pi: 1, ci: 3 },
    { sym: 's_sh000300', id: 'csi300', pi: 1, ci: 3 },
  ];
  const valMap = {};
  for (const line of text.split('\n')) {
    const m = line.match(/hq_str_([^=]+)="([^"]*)"/);
    if (m) valMap[m[1]] = m[2].split(',');
  }
  const out = {};
  for (const { sym, id, pi, ci } of SINA_MAP) {
    const vals = valMap[sym];
    if (!vals || vals.length <= Math.max(pi, ci)) continue;
    const price = Number(vals[pi]);
    const pct = Number(vals[ci]);
    const filled = makeItem(id, price, pct, 'sina', '新浪财经');
    if (filled) out[id] = filled;
  }
  return Object.keys(out).length ? out : null;
}

async function loadFromTencent() {
  const syms = 'sh000001,sz399001,sh000300,hkHSI,usIXIC,usINX,usDJI';
  const url = `https://qt.gtimg.cn/q=${syms}`;
  const r = await fetchT(url, { timeout: 5000 });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = iconv.decode(buf, 'gb18030');
  const map = {
    'sh000001': 'sse', 'sz399001': 'szse', 'sh000300': 'csi300',
    'hkHSI': 'hsi', 'usIXIC': 'nasdaq', 'usINX': 'sp500', 'usDJI': 'djia',
  };
  const out = {};
  for (const line of text.split(/[\n;]/)) {
    const m = line.match(/v_([A-Za-z0-9_$]+)="([^"]+)"/);
    if (!m) continue;
    const id = map[m[1]];
    if (!id) continue;
    const fields = m[2].split('~');
    const price = Number(fields[3]);
    if (!Number.isFinite(price)) continue;

    // 启发式:找时间戳字段位置,涨跌幅 = ts + 2
    let tsIdx = -1;
    for (let i = 25; i < Math.min(45, fields.length); i++) {
      if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(fields[i])) { tsIdx = i; break; }
    }
    if (tsIdx < 0) {
      for (let i = 25; i < Math.min(45, fields.length); i++) {
        if (/^20\d{12}$/.test(fields[i])) { tsIdx = i; break; }
      }
    }
    let pct = NaN;
    if (tsIdx > 0 && tsIdx + 2 < fields.length) {
      pct = Number(fields[tsIdx + 2]);
    }
    const filled = makeItem(id, price, pct, 'tencent', '腾讯财经');
    if (filled) out[id] = filled;
  }
  return Object.keys(out).length ? out : null;
}

async function loadFXFrankfurter() {
  const r = await fetchT('https://api.frankfurter.app/latest?from=USD&to=CNY', { timeout: 5000 });
  const d = await r.json();
  if (!d?.rates?.CNY) return null;
  const filled = makeItem('usdcny', Number(d.rates.CNY), null, 'frankfurter', 'Frankfurter');
  return filled ? { usdcny: filled } : null;
}

async function loadFXErApi() {
  const r = await fetchT('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
  const d = await r.json();
  const filled = makeItem('usdcny', Number(d?.rates?.CNY), null, 'er-api', 'ExchangeRate-API');
  return filled ? { usdcny: filled } : null;
}

const FX_SOURCES = [
  { id: 'frankfurter', label: 'Frankfurter',     fn: loadFXFrankfurter },
  { id: 'er-api',      label: 'ExchangeRate-API', fn: loadFXErApi },
];

const INDEX_SOURCES_RANKED = [
  { id: 'eastmoney', label: '东方财富', fn: loadFromEastMoney },
  { id: 'sina',      label: '新浪财经', fn: loadFromSina },
  { id: 'tencent',   label: '腾讯财经', fn: loadFromTencent },
];

// 在 source 名上加 -stale 后缀(避免 M-002:重复继承会变 -stale-stale)
function markStale(sourceId, sourceLabel) {
  const cleanId = sourceId.replace(/(-stale)+$/, '');
  const cleanLabel = sourceLabel.replace(/(\(保留上次值\))+$/, '');
  return {
    source: cleanId + '-stale',
    source_label: cleanLabel + '(保留上次值)',
  };
}

async function refreshIndices() {
  const results = await Promise.all(
    INDEX_SOURCES_RANKED.map(s =>
      s.fn().then(data => ({ ...s, data })).catch(e => {
        console.warn(`[finance] ${s.id} failed: ${e.message}`);  // M-007 修复
        return { ...s, data: null, err: e?.message };
      })
    )
  );

  const merged = {};
  // 优先级合并:每个 key 取第一个有值的源
  for (const { data } of results) {
    if (!data) continue;
    for (const [k, v] of Object.entries(data)) {
      if (!v?.value || v.value === '--') continue;
      if (!merged[k]) merged[k] = v;
    }
  }

  // 缺失字段从 lastgood 继承(stale 标记;M-001:每项保留各自 fetched_at)
  try {
    const prevRaw = await redis.get('lastgood:finance:indices');
    if (prevRaw) {
      const prev = safeParse(prevRaw);
      if (prev) {
        for (const [k, v] of Object.entries(prev.data || {})) {
          if (!merged[k] && v?.value && v.value !== '--') {
            const oldMeta = v._meta || {};
            const stale = markStale(oldMeta.source || 'unknown', oldMeta.source_label || 'unknown');
            merged[k] = {
              value: v.value,
              changePct: v.changePct,
              _meta: {
                source: stale.source,
                source_label: stale.source_label,
                fetched_at: oldMeta.fetched_at || 0,   // 保留旧时间戳让前端识别老化
                freshness: 'stale',
              },
            };
          }
        }
      } else {
        console.warn('[finance] lastgood JSON corrupt, skipped');  // M-008 修复
      }
    }
  } catch (e) {
    console.warn('[finance] read lastgood failed:', e.message);
  }

  if (Object.keys(merged).length === 0) {
    console.warn('[finance] all index sources failed');
    return false;
  }

  // 顶层 source_label 描述本次合并情况
  const distinctSources = [...new Set(Object.values(merged).map(v => v._meta?.source_label).filter(Boolean))];
  const overallLabel = distinctSources.length === 1 ? distinctSources[0] : `多源合并(${distinctSources.join('+')})`;

  // 组装 per_source 给 server.js 用(per_source 只放元信息;_meta 留在 data 里以便下次继承)
  const per_source = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v._meta) per_source[k] = { ...v._meta };
  }

  await writeBoth(KEY + ':indices', {
    data: merged,           // 保留 _meta 以便下次继承
    source: 'merged',
    source_label: overallLabel,
    fetched_at: Date.now(),
    per_source,
  }, HOT_TTL);
  console.log(`[fetch] finance:indices ← ${overallLabel} (${Object.keys(merged).length}/8 项)`);
  return true;
}

// 返回 boolean 以便 scheduler/调用方知道结果(M-009 部分修复)
export async function refreshFinance() {
  const [idxRes, fxRes] = await Promise.allSettled([
    refreshIndices(),
    runAndCache({
      key: KEY + ':fx',
      sources: FX_SOURCES,
      hotTtlSec: 3600,
    }),
  ]);
  return {
    indices: idxRes.status === 'fulfilled' && idxRes.value,
    fx:      fxRes.status  === 'fulfilled' && fxRes.value !== null,
  };
}

// 内置兜底:usdcny 标"参考"避免误导(M-010)
export const FINANCE_BUILTIN_FALLBACK = {
  data: {
    usdcny: { value: '7.20', changePct: null, _hint: '内置参考值' },
    nasdaq: { value: '--', changePct: null },
    sp500:  { value: '--', changePct: null },
    djia:   { value: '--', changePct: null },
    gold:   { value: '--', changePct: null },
    sse:    { value: '--', changePct: null },
    szse:   { value: '--', changePct: null },
    csi300: { value: '--', changePct: null },
    hsi:    { value: '--', changePct: null },
  },
};
