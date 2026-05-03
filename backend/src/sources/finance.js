import iconv from 'iconv-lite';
import { fetchT, runAndCache } from '../fetcher.js';
import redis, { writeBoth } from '../redis.js';

const KEY = 'finance';
const HOT_TTL = 60;

function fmtNum(n, decimals = 2) {
  if (n == null || isNaN(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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
    const n = parseFloat(item.f2);
    if (!n || isNaN(n)) continue;
    out[id] = {
      value: fmtNum(n, n >= 1000 ? 0 : 2),
      changePct: typeof item.f3 === 'number' ? item.f3 : null,
    };
  }
  return Object.keys(out).length ? out : null;
}

async function loadFromSina() {
  // ⚠ 新浪在国内服务器上拿不到 gb_$ 美股 + s_hkhsi 港股(GFW 屏蔽,返回空字符串)
  // ⚠ nf_AU0 是黄金期货合约,字段含义与我们 s_格式不同,弃用
  // 因此 sina 只用作 A 股(SSE/SZSE/CSI300)的兜底
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
    const price = parseFloat(vals[pi]);
    const pct = parseFloat(vals[ci]);
    if (!price || isNaN(price)) continue;
    out[id] = { value: fmtNum(price, price >= 1000 ? 0 : 2), changePct: isNaN(pct) ? null : pct };
  }
  return Object.keys(out).length ? out : null;
}

async function loadFromTencent() {
  // 腾讯财经 qt.gtimg.cn
  // 字段格式实测(2026):
  //   A 股 (sh/sz): fields[3]=当前价, fields[33]=涨跌额, fields[34]=涨跌幅
  //   港股 (hk):    fields[3]=当前价, fields[32]=涨跌额, fields[33]=涨跌幅
  //   美股 (us):    fields[3]=当前价, fields[31]=涨跌额, fields[32]=涨跌幅
  // 通用启发式:涨跌幅在最后一个时间戳字段(YYYY 开头)后第 2 位
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
    const price = parseFloat(fields[3]);
    if (!price || isNaN(price)) continue;
    // 启发式:找时间戳字段位置,涨跌幅 = ts + 2
    // 优先级:带分隔符的日期(港股 yyyy/MM/dd HH:mm:ss / 美股 yyyy-MM-dd HH:mm:ss)→ A 股纯数字 yyyymmddhhmmss
    // 只在合理范围(idx 25-40)里找,避开尾部交易额(也可能是 14 位数字)
    let tsIdx = -1;
    for (let i = 25; i < Math.min(45, fields.length); i++) {
      const f = fields[i];
      if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(f)) { tsIdx = i; break; }
    }
    if (tsIdx < 0) {
      for (let i = 25; i < Math.min(45, fields.length); i++) {
        const f = fields[i];
        // A 股时间戳:14 位数字,但年份必须合理(20xx)
        if (/^20\d{12}$/.test(f)) { tsIdx = i; break; }
      }
    }
    let pct = NaN;
    if (tsIdx > 0 && tsIdx + 2 < fields.length) {
      pct = parseFloat(fields[tsIdx + 2]);
    }
    out[id] = { value: fmtNum(price, price >= 1000 ? 0 : 2), changePct: isNaN(pct) ? null : pct };
  }
  return Object.keys(out).length ? out : null;
}

async function loadFXFrankfurter() {
  const r = await fetchT('https://api.frankfurter.app/latest?from=USD&to=CNY', { timeout: 5000 });
  const d = await r.json();
  if (!d?.rates?.CNY) return null;
  return { usdcny: { value: fmtNum(d.rates.CNY, 4), changePct: null } };
}

async function loadFXErApi() {
  const r = await fetchT('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
  const d = await r.json();
  const cny = d?.rates?.CNY;
  if (!cny) return null;
  return { usdcny: { value: fmtNum(cny, 4), changePct: null } };
}

const FX_SOURCES = [
  { id: 'frankfurter', label: 'Frankfurter', fn: loadFXFrankfurter },
  { id: 'er-api',      label: 'ExchangeRate-API', fn: loadFXErApi },
];

// 指数:并行三源合并,每个数据点单独选优先级最高的可用源
// 优先级:eastmoney > sina > tencent
const INDEX_SOURCES_RANKED = [
  { id: 'eastmoney', label: '东方财富', fn: loadFromEastMoney },
  { id: 'sina',      label: '新浪财经', fn: loadFromSina },
  { id: 'tencent',   label: '腾讯财经', fn: loadFromTencent },
];

async function refreshIndices() {
  // 并行调用三家;每家失败不影响其他家
  const results = await Promise.all(
    INDEX_SOURCES_RANKED.map(s =>
      s.fn().then(data => ({ ...s, data })).catch(e => ({ ...s, data: null, err: e?.message }))
    )
  );

  // 合并:按优先级,每个 key 取第一个有值的源
  const merged = {};
  const perSource = {};
  for (const { id, label, data } of results) {
    if (!data) continue;
    for (const [k, v] of Object.entries(data)) {
      if (!v?.value || v.value === '--') continue;
      if (!merged[k]) {
        merged[k] = v;
        perSource[k] = { source: id, source_label: label };
      }
    }
  }

  // 缺失字段从上轮 lastgood 继承(避免黄金等单源数据闪烁)
  try {
    const prevRaw = await redis.get('lastgood:finance:indices');
    if (prevRaw) {
      const prev = JSON.parse(prevRaw);
      for (const [k, v] of Object.entries(prev.data || {})) {
        if (!merged[k] && v?.value && v.value !== '--') {
          merged[k] = v;
          const ps = prev.per_source?.[k];
          perSource[k] = ps
            ? { source: ps.source + '-stale', source_label: (ps.source_label || '') + '(保留上次值)' }
            : { source: 'inherited', source_label: '保留上次值' };
        }
      }
    }
  } catch {}

  if (Object.keys(merged).length === 0) {
    console.warn('[finance] all index sources failed');
    return;
  }

  // 数据级别的 source_label:全部来自同一源就用那个名,否则"多源合并"
  const distinctSources = [...new Set(Object.values(perSource).map(s => s.source_label))];
  const overallLabel = distinctSources.length === 1 ? distinctSources[0] : `多源合并(${distinctSources.join('+')})`;

  await writeBoth(KEY + ':indices', {
    data: merged,
    source: 'merged',
    source_label: overallLabel,
    fetched_at: Date.now(),
    per_source: perSource,
  }, HOT_TTL);
  console.log(`[fetch] finance:indices ← ${overallLabel} (${Object.keys(merged).length}/8 项)`);
}

export async function refreshFinance() {
  await Promise.allSettled([
    refreshIndices(),
    runAndCache({
      key: KEY + ':fx',
      sources: FX_SOURCES,
      hotTtlSec: 3600,
    }),
  ]);
}

export const FINANCE_BUILTIN_FALLBACK = {
  data: {
    usdcny: { value: '7.2000', changePct: null },
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
