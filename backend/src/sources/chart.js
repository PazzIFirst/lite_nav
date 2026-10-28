// 行情图表的数据层:K 线(日)与分时。
//
// 源的选择按市场分,而不是排队试 —— 每个源覆盖的市场不一样,顺序错了就白等超时:
//   A股 / 港股 / 美股     腾讯(稳、不带 Referer 也行) → 东财 → Yahoo
//   全球指数(100.*)      Yahoo(^HSI/^NDX/^GSPC…) → 东财
//   外汇(133.*)          新浪外汇日线(全历史) → 东财 → Yahoo(CNY=X 近似)
// 东财字段最全、还带当日未收盘的活口,但它对突发请求会直接断 TLS 连接(实测连发
// 十几次就封),所以只当第二源;封了之后冷却 10 分钟不再试。
import { fetchT, readJsonLimited, readBufferLimited } from '../fetcher.js';
import { readThreeState, writeBoth } from '../redis.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const EM_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_TRENDS = 'https://push2.eastmoney.com/api/qt/stock/trends2/get';
const TX_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const TX_MINUTE = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query';
const SINA_FX = 'https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_=/NewForexService.getDayKLine';
const YH_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const SECID_RE = /^\d{1,3}\.[A-Za-z0-9._-]{1,14}$/;

// 东财熔断:连接层失败后 10 分钟内不再试
let emDownUntil = 0;
const emAvailable = () => Date.now() > emDownUntil;
const emFail = () => { emDownUntil = Date.now() + 10 * 60 * 1000; };

export function isValidSecid(s) {
  return typeof s === 'string' && SECID_RE.test(s);
}

// 只分离市场前缀，BRK.B 等证券代码内部的点必须保留。
function splitSecid(secid) {
  const value = String(secid);
  const separator = value.indexOf('.');
  return [value.slice(0, separator), value.slice(separator + 1)];
}

export function marketOf(secid) {
  const n = Number(splitSecid(secid)[0]);
  if (n === 0 || n === 1) return 'cn';
  if (n === 116) return 'hk';
  if (n === 105 || n === 106 || n === 107) return 'us';
  if (n === 133) return 'fx';
  if (n === 100) return 'index';
  return 'other';
}

const HK_INDEX = new Set(['HSI', 'HSCE', 'HSTECH']);

function txCode(secid) {
  const [mk, code] = splitSecid(secid);
  const n = Number(mk);
  if (n === 100 && HK_INDEX.has(code)) return 'hk' + code;
  if (n === 1) return 'sh' + code;
  if (n === 0) return 'sz' + code;
  if (n === 116) return 'hk' + code;
  if (n === 105 || n === 106 || n === 107) return 'us' + code;
  return null;
}

// 全球指数 → Yahoo 符号
const YH_INDEX = {
  // 港股
  HSI: '^HSI', HSCE: '^HSCE', HSTECH: '^HSTECH',
  // 美股
  NDX: '^NDX', IXIC: '^IXIC', SPX: '^GSPC', DJIA: '^DJI',
  // 亚太
  N225: '^N225', KS11: '^KS11', TWII: '^TWII', SENSEX: '^BSESN', NSEI: '^NSEI', AXJO: '^AXJO',
  // 欧洲
  GDAXI: '^GDAXI', FCHI: '^FCHI', FTSE: '^FTSE', STOXX50E: '^STOXX50E', IBEX: '^IBEX',
  // 其他
  BVSP: '^BVSP', GSPTSE: '^GSPTSE',
};

function yahooCode(secid) {
  const [mk, code] = splitSecid(secid);
  const n = Number(mk);
  if (n === 133) return code + '=X';
  if (n === 100) return Object.hasOwn(YH_INDEX, code) ? YH_INDEX[code] : null;
  // 美股:Yahoo 用裸代码,腾讯的美股日线只回两三根,所以美股反而以 Yahoo 为主
  if (n === 105 || n === 106 || n === 107) return code.replace(/\./g, '-');
  return null;
}

// ===== 交易时段 =====
function localParts(timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { dow, mins: Number(p.hour) * 60 + Number(p.minute), day: p.year + p.month + p.day };
}

const inRange = (m, a, b) => m >= a && m < b;

// 指数按它真正所在的市场判时段:标普在纽约、恒生在港、日经在东京,不能一律用上海时间
const CN_RANGES = [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]];
const HK_RANGES = [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60]];
const US_RANGES = [[9 * 60 + 30, 16 * 60]];
const EU_RANGES = [[9 * 60, 17 * 60 + 30]];

const IDX_SESSION = {
  HSI:      { tz: 'Asia/Hong_Kong',    ranges: HK_RANGES },
  HSCE:     { tz: 'Asia/Hong_Kong',    ranges: HK_RANGES },
  HSTECH:   { tz: 'Asia/Hong_Kong',    ranges: HK_RANGES },
  NDX:      { tz: 'America/New_York',  ranges: US_RANGES },
  IXIC:     { tz: 'America/New_York',  ranges: US_RANGES },
  SPX:      { tz: 'America/New_York',  ranges: US_RANGES },
  DJIA:     { tz: 'America/New_York',  ranges: US_RANGES },
  GSPTSE:   { tz: 'America/Toronto',   ranges: US_RANGES },
  BVSP:     { tz: 'America/Sao_Paulo', ranges: [[10 * 60, 17 * 60]] },
  N225:     { tz: 'Asia/Tokyo',        ranges: [[9 * 60, 11 * 60 + 30], [12 * 60 + 30, 15 * 60 + 30]] },
  KS11:     { tz: 'Asia/Seoul',        ranges: [[9 * 60, 15 * 60 + 30]] },
  TWII:     { tz: 'Asia/Taipei',       ranges: [[9 * 60, 13 * 60 + 30]] },
  SENSEX:   { tz: 'Asia/Kolkata',      ranges: [[9 * 60 + 15, 15 * 60 + 30]] },
  NSEI:     { tz: 'Asia/Kolkata',      ranges: [[9 * 60 + 15, 15 * 60 + 30]] },
  AXJO:     { tz: 'Australia/Sydney',  ranges: [[10 * 60, 16 * 60]] },
  GDAXI:    { tz: 'Europe/Berlin',     ranges: EU_RANGES },
  FCHI:     { tz: 'Europe/Paris',      ranges: EU_RANGES },
  IBEX:     { tz: 'Europe/Madrid',     ranges: EU_RANGES },
  STOXX50E: { tz: 'Europe/Berlin',     ranges: EU_RANGES },
  FTSE:     { tz: 'Europe/London',     ranges: [[8 * 60, 16 * 60 + 30]] },
};

// 正常交易日的时间轴；午休保留为独立区间，前端按有效交易分钟压缩。
// https://www.jpx.co.jp/english/equities/trading/domestic/01.html
// https://www.hkex.com.hk/Services/Trading-hours-and-Severe-Weather-Arrangements/Trading-Hours/Securities-Market
// 恒生指数也会在随机收市后发布最终值，竞价点需保留：
// https://www.hsi.com.hk/static/uploads/contents/en/news/indexChgNotice/20160707T000000.pdf
export function getTradingSession(secid) {
  const kind = marketOf(secid), code = splitSecid(secid)[1];
  const spec = kind === 'index' ? (Object.hasOwn(IDX_SESSION, code) ? IDX_SESSION[code] : null)
    : kind === 'cn' ? { tz: 'Asia/Shanghai', ranges: CN_RANGES }
    : kind === 'hk' ? { tz: 'Asia/Hong_Kong', ranges: HK_RANGES }
    : kind === 'us' ? { tz: 'America/New_York', ranges: US_RANGES }
    : kind === 'fx' ? { tz: 'UTC', ranges: [[0, 1440]] } : null;
  if (!spec) return null;
  return {
    timeZone: spec.tz, ranges: spec.ranges.map(range => [...range]),
    ...((kind === 'hk' || (kind === 'index' && HK_INDEX.has(code))) ? { closingAuctionEnd: 970 } : {}),
  };
}

export function isMarketOpen(secid) {
  const session = getTradingSession(secid);
  return sessionIsOpen(session);
}

function sessionIsOpen(session) {
  if (!session) return false;
  const { dow, mins } = localParts(session.timeZone);
  if (dow === 0 || dow === 6) return false;
  if (session.ranges.some(([a, b]) => inRange(mins, a, b))) return true;
  const close = session.ranges[session.ranges.length - 1][1];
  return !!session.closingAuctionEnd && inRange(mins, close, session.closingAuctionEnd);
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ===== 日 K =====
async function emKline(secid, days) {
  if (!emAvailable()) return null;
  const url = `${EM_KLINE}?fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57`
    + `&klt=101&fqt=1&end=20500101&lmt=${days}&secid=${encodeURIComponent(secid)}`;
  let d;
  try {
    const r = await fetchT(url, { timeout: 5000, ua: UA, headers: { Referer: 'https://quote.eastmoney.com/' } });
    d = await readJsonLimited(r);
  } catch (e) {
    emFail();
    throw e;
  }
  const k = d?.data?.klines;
  if (!Array.isArray(k) || !k.length) return null;
  const bars = k.map(line => {
    const [t, o, c, h, l, v] = String(line).split(',');
    return { t, o: num(o), c: num(c), h: num(h), l: num(l), v: num(v) };
  }).filter(b => b.o > 0 && b.c > 0);
  return bars.length ? { name: d.data.name, decimal: d.data.decimal, bars } : null;
}

async function txKline(secid, days) {
  const code = txCode(secid);
  if (!code) return null;
  const r = await fetchT(`${TX_KLINE}?param=${code},day,,,${days},qfq`, { timeout: 6000, ua: UA });
  const d = await readJsonLimited(r);
  const node = d?.data?.[code];
  const rows = node?.qfqday || node?.day;
  if (!Array.isArray(rows) || !rows.length) return null;
  const bars = rows.map(([t, o, c, h, l, v]) => ({
    t, o: num(o), c: num(c), h: num(h), l: num(l), v: num(v),
  })).filter(b => b.o > 0 && b.c > 0);
  return bars.length ? { name: node.qt?.[code]?.[1], decimal: null, bars } : null;
}

// 新浪外汇:「var _=("2014-11-07,开,收,高,低,|…");」,只要最后 N 条
async function sinaFxKline(secid, days) {
  const [mk, code] = splitSecid(secid);
  if (Number(mk) !== 133) return null;
  const r = await fetchT(`${SINA_FX}?symbol=${encodeURIComponent(code)}`, {
    timeout: 8000, ua: UA, headers: { Referer: 'https://finance.sina.com.cn' },
  });
  const buf = await readBufferLimited(r);
  const m = buf.toString('utf8').match(/var\s*_=\("([^"]*)"/);
  if (!m) return null;
  const rows = m[1].split('|').filter(Boolean).slice(-days);
  const bars = rows.map(row => {
    const [t, o, c, h, l] = row.split(',');
    return { t, o: num(o), c: num(c), h: num(h), l: num(l), v: null };
  }).filter(b => b.o > 0 && b.c > 0);
  return bars.length ? { name: code.slice(0, 3) + '/' + code.slice(3), decimal: null, bars } : null;
}

async function yahooKline(secid, days) {
  const sym = yahooCode(secid);
  if (!sym) return null;
  const range = days <= 30 ? '1mo' : days <= 90 ? '3mo' : days <= 180 ? '6mo' : '1y';
  const r = await fetchT(`${YH_CHART}${encodeURIComponent(sym)}?range=${range}&interval=1d`, { timeout: 8000, ua: UA });
  const d = await readJsonLimited(r);
  const res = d?.chart?.result?.[0];
  if (!res?.timestamp?.length) return null;
  const tz = res.meta?.exchangeTimezoneName || 'UTC';
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const q = res.indicators.quote[0];
  const bars = res.timestamp.map((ts, i) => ({
    t: fmt.format(new Date(ts * 1000)),
    o: num(q.open?.[i]), c: num(q.close?.[i]), h: num(q.high?.[i]), l: num(q.low?.[i]), v: num(q.volume?.[i]),
  })).filter(b => b.o > 0 && b.c > 0).slice(-days);
  return bars.length ? { name: res.meta?.shortName || sym, decimal: null, bars } : null;
}

const EM = ['eastmoney', '东方财富', emKline];
const TX = ['tencent', '腾讯', txKline];
const SINA = ['sina', '新浪外汇', sinaFxKline];
const YH = ['yahoo', 'Yahoo', yahooKline];
const YH_TRENDS = ['yahoo', 'Yahoo', yahooTrends];
const EM_T = ['eastmoney', '东方财富', emTrends];
const TX_T = ['tencent', '腾讯', txMinute];

function chainFor(secid) {
  const kind = marketOf(secid);
  if (kind === 'fx') return [SINA, EM, YH];
  if (kind === 'index') return [YH, EM, TX];
  if (kind === 'us') return [YH, TX, EM];    // 腾讯的美股日线只有两三根
  return [TX, EM, YH];
}

// 缓存的 live 是抓取时状态，响应时必须按当前交易时段重算。
function withCurrentSession(payload, live) {
  return { ...payload, data: { ...payload.data, live } };
}

function chartCacheReusable(cached, live, maxAgeSeconds) {
  const age = Date.now() - Number(cached?.fetched_at);
  // 开/闭市转换时立刻补抓；其余盘后缓存也有上限，不能永久复用 lastgood。
  return cached?.data && cached.freshness === 'fresh' && (cached.data.marketOpen ?? cached.data.live) === live
    && Number.isFinite(age) && age >= 0 && age < maxAgeSeconds * 1000;
}

export async function getKline(secid, days = 60) {
  const live = isMarketOpen(secid);
  const key = `chart:k:${secid}:${days}`;
  const cached = await readThreeState(key, null).catch(() => null);
  if (chartCacheReusable(cached, live, live ? 60 : 600)) return withCurrentSession(cached, live);

  for (const [id, label, fn] of chainFor(secid)) {
    try {
      const got = await fn(secid, days);
      if (!got) continue;
      const payload = {
        data: { secid, name: got.name, decimal: got.decimal, live, bars: got.bars.slice(-days) },
        source: id, source_label: label, fetched_at: Date.now(),
      };
      await writeBoth(key, payload, live ? 60 : 600).catch(() => {});
      return payload;
    } catch (e) { /* 下一个源 */ }
  }
  if (cached?.data) return withCurrentSession(cached, live);
  throw new Error('all_sources_failed');
}

// ===== 分时 =====
// 只给时间语义已明确的源补时间轴。东财外汇/境外市场的 naive HH:mm
// 时区无法确认时仍提供报价，不把它冒充 UTC/交易所时间。
function intradaySession(payload, secid, live) {
  const kind = marketOf(secid), code = splitSecid(secid)[1];
  const supportedNaive = kind === 'cn' || kind === 'hk' || (kind === 'index' && HK_INDEX.has(code));
  const session = Object.prototype.hasOwnProperty.call(payload.data, 'session') ? payload.data.session
    : (payload.source === 'eastmoney' && !supportedNaive) ? null : getTradingSession(secid);
  const currentDay = session ? localParts(session.timeZone).day : '';
  const isToday = !!currentDay && dateKey(payload.data.date) === currentDay;
  const marketOpen = isToday ? sessionIsOpen(session) : live;
  // 旧交易日的完整走势不能显示为“盘中”；市场开放时仍应继续轮询补新数据。
  return { ...payload, data: { ...payload.data, live: marketOpen && isToday, marketOpen, session } };
}

function dateKey(value) {
  const text = String(value || '');
  return /^\d{8}$/.test(text) ? text : /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10).replace(/-/g, '') : '';
}

function latestDayPoints(rows) {
  const valid = rows.filter(row => row.p > 0 && Number.isFinite(row.p) && /^\d{8}$/.test(row.day) && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.t));
  const day = valid.reduce((latest, row) => row.day > latest ? row.day : latest, '');
  const minutes = new Map();
  for (const row of valid) if (row.day === day) minutes.set(row.t, { t: row.t, p: row.p });
  return { date: day, points: [...minutes.values()].sort((a, b) => a.t.localeCompare(b.t)) };
}

async function emTrends(secid) {
  if (!emAvailable()) return null;
  const url = `${EM_TRENDS}?fields1=f1,f2,f3,f4,f5&fields2=f51,f53,f56&iscr=0&ndays=1&secid=${encodeURIComponent(secid)}`;
  let d;
  try {
    const r = await fetchT(url, { timeout: 5000, ua: UA, headers: { Referer: 'https://quote.eastmoney.com/' } });
    d = await readJsonLimited(r);
  } catch (e) {
    emFail();
    throw e;
  }
  const rows = d?.data?.trends;
  if (!Array.isArray(rows) || !rows.length) return null;
  const normalized = latestDayPoints(rows.map(s => {
    const [stamp, price] = String(s).split(',');
    return { day: dateKey(stamp), t: stamp.slice(11, 16), p: num(price) };
  }));
  if (!normalized.points.length) return null;
  return {
    name: d.data.name, decimal: d.data.decimal,
    prevClose: num(d.data.preClose), ...normalized,
  };
}

async function txMinute(secid) {
  const code = txCode(secid);
  if (!code) return null;
  const r = await fetchT(`${TX_MINUTE}?code=${code}`, { timeout: 6000, ua: UA });
  const d = await readJsonLimited(r);
  const node = d?.data?.[code];
  const rows = node?.data?.data;
  if (!Array.isArray(rows) || !rows.length) return null;
  const qt = node.qt?.[code] || [];
  const day = dateKey(node.data.date) || dateKey(qt[30]);
  const normalized = latestDayPoints(rows.map(s => {
    const [hhmm, price] = String(s).split(' ');
    return { day, t: hhmm.slice(0, 2) + ':' + hhmm.slice(2, 4), p: num(price) };
  }));
  if (!normalized.points.length) return null;
  return { name: qt[1], decimal: null, prevClose: num(qt[4]), ...normalized };
}

// Yahoo 的 1 分钟线:美股/指数的分时最可靠(腾讯的美股分时只有一两根)
async function yahooTrends(secid) {
  const sym = yahooCode(secid);
  if (!sym) return null;
  // 外汇源按 London 日切片；多取一个窗口后按 UTC 日分组，避免 BST 23:00 换日丢掉当天前半段。
  const range = marketOf(secid) === 'fx' ? '5d' : '1d';
  const r = await fetchT(`${YH_CHART}${encodeURIComponent(sym)}?range=${range}&interval=1m&includePrePost=false`, { timeout: 8000, ua: UA });
  const d = await readJsonLimited(r);
  const res = d?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  if (!res?.timestamp?.length || !q) return null;
  const session = getTradingSession(secid);
  const timeZone = session?.timeZone || res.meta?.exchangeTimezoneName || 'UTC';
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const partsOf = ts => Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).map(part => [part.type, part.value]));
  const normalized = latestDayPoints(res.timestamp.map((ts, i) => {
    const price = num(q.close?.[i]);
    if (!Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) return {};
    const p = partsOf(ts);
    return { day: p.year + p.month + p.day, t: p.hour + ':' + p.minute, p: price };
  }));
  if (!normalized.points.length) return null;
  // 同一天的供应方 regular 时段可描述半日市；不能用已指向明天的 current 元数据裁昨天数据。
  const period = res.meta?.currentTradingPeriod?.regular;
  if (session && marketOf(secid) !== 'fx' && Number.isFinite(period?.start) && Number.isFinite(period?.end)) {
    const start = partsOf(period.start), end = partsOf(period.end);
    if (start.year + start.month + start.day === normalized.date && end.year + end.month + end.day === normalized.date) {
      const first = Number(start.hour) * 60 + Number(start.minute), last = Number(end.hour) * 60 + Number(end.minute);
      const ranges = session.ranges.map(([a, b]) => [Math.max(a, first), Math.min(b, last)]).filter(([a, b]) => b > a);
      if (ranges.length) {
        session.ranges = ranges;
        if (session.closingAuctionEnd) session.closingAuctionEnd = ranges[ranges.length - 1][1] + 10;
      }
    }
  }
  return {
    name: res.meta?.shortName, decimal: null,
    prevClose: num(res.meta?.chartPreviousClose ?? res.meta?.previousClose),
    ...normalized, session,
  };
}

export async function getIntraday(secid) {
  const live = isMarketOpen(secid);
  const key = `chart:t:v2:${secid}`;
  const cached = await readThreeState(key, null).catch(() => null);
  const currentCached = cached?.data ? intradaySession(cached, secid, live) : null;
  const currentOpen = currentCached?.data.marketOpen ?? live;
  if (chartCacheReusable(cached, currentOpen, currentOpen ? 30 : 300)) return currentCached;

  const kind = marketOf(secid);
  const chain = (kind === 'us' || kind === 'index' || kind === 'fx') ? [YH_TRENDS, EM_T, TX_T] : [EM_T, TX_T, YH_TRENDS];
  for (const [id, label, fn] of chain) {
    try {
      const got = await fn(secid);
      // 开盘第一分钟也是真实数据；时间轴表达覆盖程度，不用点数伪装完整交易日。
      if (!got?.points?.length) continue;
      const payload = intradaySession({
        data: { secid, live, ...got },
        source: id, source_label: label, fetched_at: Date.now(),
      }, secid, live);
      await writeBoth(key, payload, payload.data.marketOpen ? 30 : 300).catch(() => {});
      return payload;
    } catch (e) { /* 下一个源 */ }
  }
  if (cached?.data) return intradaySession(cached, secid, live);
  throw new Error('all_sources_failed');
}

// ===== 代码解析 =====
export async function resolveCode(market, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) throw new Error('empty_code');
  if (!['cn', 'hk', 'us'].includes(market)) throw new Error('bad_market');

  try {
    const u = 'https://searchapi.eastmoney.com/api/suggest/get?type=14&token=D43BF722C8E33BDC906FB84D85E326E8'
      + `&count=8&input=${encodeURIComponent(code)}`;
    const r = await fetchT(u, { timeout: 5000, ua: UA });
    const d = await readJsonLimited(r);
    const rows = d?.QuotationCodeTable?.Data || [];
    const want = market === 'cn' ? ['0', '1'] : market === 'hk' ? ['116'] : ['105', '106', '107'];
    const hit = rows.find(x => want.includes(String(x.MktNum)) && String(x.Code).toUpperCase() === code)
      || rows.find(x => want.includes(String(x.MktNum)));
    if (hit) return { secid: hit.QuoteID || `${hit.MktNum}.${hit.Code}`, name: hit.Name, code: hit.Code };
  } catch (e) { /* 落到前缀规则 */ }

  if (market === 'cn') {
    if (!/^\d{6}$/.test(code)) throw new Error('bad_code');
    return { secid: `${/^[69]/.test(code) ? 1 : 0}.${code}`, name: code, code };
  }
  if (market === 'hk') {
    if (!/^\d{1,5}$/.test(code)) throw new Error('bad_code');
    const c = code.padStart(5, '0');
    return { secid: `116.${c}`, name: c, code: c };
  }
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(code)) throw new Error('bad_code');
  return { secid: `105.${code}`, name: code, code };
}
