import express from 'express';
import rateLimit from 'express-rate-limit';
import redis, { readThreeState, pingRedis } from './redis.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { FINANCE_BUILTIN_FALLBACK } from './sources/finance.js';
import { HOT_IDS, HOT_BUILTIN_FALLBACK, refreshHotList } from './sources/hot.js';
import { WEATHER_BUILTIN_FALLBACK, refreshWeatherForCity, refreshWeatherForCoords } from './sources/weather.js';
import { HOLIDAY_BUILTIN_FALLBACK, SUPPORTED_COUNTRIES, refreshHolidayForCountry } from './sources/holiday.js';
import { getSuggestions } from './sources/suggest.js';
import { computeTodayInfo } from './sources/today.js';
import {
  ValidationError,
  validateCity, normalizeCityKey, validateLatLon,
  validateShortText, validateQuery, validateCountryCode,
} from './validators.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // 反代后正确识别客户端 IP(给 rate-limit 用)
app.use(express.json({ limit: '64kb' }));

// ===== CORS:从 env 读白名单,不再 * =====
// CORS_ORIGIN=https://nav.example.com,https://other.example.com
// 默认 '' = 不发 CORS 头(同域反代时无需 CORS)
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  if (CORS_ORIGINS.length === 0) return next();
  const origin = req.headers.origin;
  if (origin && (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

// ===== 限流 =====
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MIN || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
app.use('/api', apiLimiter);

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.REFRESH_LIMIT_PER_MIN || 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_refreshes' },
});

// ===== 工具:把 async 路由 catch 接到错误中间件 =====
const a = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ===== /api/health 包含 Redis 状态 =====
app.get('/api/health', a(async (req, res) => {
  const redisOk = await pingRedis();
  res.status(redisOk ? 200 : 503).json({
    ok: redisOk,
    redis: redisOk ? 'up' : 'down',
    ts: Date.now(),
  });
}));

// ===== 行情 =====
app.get('/api/finance', a(async (req, res) => {
  // 即使 Redis 全挂,也要返回 builtin fallback,不抛错
  const [indices, fx] = await Promise.all([
    readThreeState('finance:indices', null).catch(() => null),
    readThreeState('finance:fx',      null).catch(() => null),
  ]);

  const merged = { ...(FINANCE_BUILTIN_FALLBACK.data) };
  const sources = {};

  if (indices?.data) {
    const perSrc = indices.per_source || {};
    for (const [k, v] of Object.entries(indices.data)) {
      merged[k] = v;
      const ps = perSrc[k];
      sources[k] = {
        source:       ps?.source       || indices.source,
        source_label: ps?.source_label || indices.source_label,
        fetched_at:   ps?.fetched_at   || indices.fetched_at,
        freshness:    ps?.freshness    || indices.freshness,
      };
    }
  }
  if (fx?.data?.usdcny) {
    merged.usdcny = fx.data.usdcny;
    sources.usdcny = {
      source: fx.source,
      source_label: fx.source_label,
      fetched_at: fx.fetched_at,
      freshness: fx.freshness,
    };
  }

  for (const k of Object.keys(merged)) {
    if (!sources[k]) sources[k] = { source: 'builtin', source_label: '内置兜底', fetched_at: 0, freshness: 'fallback' };
  }

  res.json({ data: merged, sources });
}));

// ===== 热榜 =====
app.get('/api/hot/:id', a(async (req, res) => {
  const { id } = req.params;
  if (!HOT_IDS.includes(id)) return res.status(404).json({ error: 'unknown_hot_id' });
  const r = await readThreeState('hot:' + id, HOT_BUILTIN_FALLBACK);
  res.json(r);
}));

// 公开刷新接口需要 token(默认禁用,设 env REFRESH_TOKEN 启用)
app.post('/api/hot/:id/refresh', refreshLimiter, a(async (req, res) => {
  const expected = process.env.REFRESH_TOKEN;
  if (!expected) return res.status(403).json({ error: 'refresh_disabled' });
  const got = req.headers['x-refresh-token'] || req.query.token;
  if (got !== expected) return res.status(401).json({ error: 'invalid_token' });

  const { id } = req.params;
  if (!HOT_IDS.includes(id)) return res.status(404).json({ error: 'unknown_hot_id' });
  await refreshHotList(id);
  const r = await readThreeState('hot:' + id, HOT_BUILTIN_FALLBACK);
  res.json(r);
}));

// ===== 节假日 =====
app.get('/api/holidays/countries', (req, res) => {
  res.json({ data: SUPPORTED_COUNTRIES });
});

// in-flight 去重:并发请求同 country 时复用一次拉取
const holidayInflight = new Map();

app.get('/api/holidays', a(async (req, res) => {
  const country = validateCountryCode(req.query.country || 'CN');
  if (!SUPPORTED_COUNTRIES.some(c => c.code === country)) {
    return res.status(400).json({
      error: 'unsupported_country',
      supported: SUPPORTED_COUNTRIES.map(c => c.code),
    });
  }
  const key = 'holiday:' + country;
  let r = await readThreeState(key, null);
  if (!r) {
    let inflight = holidayInflight.get(country);
    if (!inflight) {
      inflight = refreshHolidayForCountry(country)
        .finally(() => holidayInflight.delete(country));
      holidayInflight.set(country, inflight);
    }
    await inflight;
    r = await readThreeState(key, HOLIDAY_BUILTIN_FALLBACK);
  }
  res.json(r);
}));

// ===== 今日(农历)— 直接实时计算,不走 Redis =====
// 农历算法只几毫秒,不需要缓存,且能保证跨日永远准确(D-001/D-002/D-003)
app.get('/api/today', a(async (req, res) => {
  res.json({
    data: computeTodayInfo(),
    source: 'lunar-javascript',
    source_label: 'lunar-javascript(实时计算)',
    fetched_at: Date.now(),
    freshness: 'fresh',
  });
}));

// ===== 天气 =====
app.get('/api/weather', a(async (req, res) => {
  const { city, lat, lon, label } = req.query;

  if (city) {
    const validated = validateCity(city);
    const key = 'weather:' + normalizeCityKey(validated);
    let r = await readThreeState(key, null);
    if (!r) {
      await refreshWeatherForCity(validated);
      r = await readThreeState(key, WEATHER_BUILTIN_FALLBACK);
    } else if (r.freshness === 'stale' || r.freshness === 'fallback') {
      refreshWeatherForCity(validated).catch(() => {});
    }
    return res.json(r);
  }

  if (lat != null && lon != null) {
    const { lat: la, lon: lo } = validateLatLon(lat, lon);
    const lab = validateShortText(label, 'label', 50);
    const key = `weather:coords:${la},${lo}`;
    let r = await readThreeState(key, null);
    if (!r) {
      await refreshWeatherForCoords(la, lo, lab);
      r = await readThreeState(key, WEATHER_BUILTIN_FALLBACK);
    } else if (r.freshness === 'stale' || r.freshness === 'fallback') {
      refreshWeatherForCoords(la, lo, lab).catch(() => {});
    }
    return res.json(r);
  }

  res.status(400).json({ error: 'need city or lat/lon' });
}));

// ===== 搜索联想 =====
app.get('/api/suggest', a(async (req, res) => {
  const q = validateQuery(req.query.q, 'q', 100);
  if (!q) return res.json({ data: [], source: 'empty', source_label: '空查询' });
  const r = await getSuggestions(q);
  res.json(r);
}));

// ===== 全局错误中间件(放在所有路由后)=====
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message, field: err.field });
  }
  console.error('[server]', err.stack || err.message);
  res.status(500).json({ error: 'internal_error' });
});

// 404 兜底
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// ===== 启动 =====
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`[server] listening on ${HOST}:${PORT}`);
  startScheduler();
});

// ===== 优雅关闭 =====
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] received ${signal}, shutting down gracefully...`);
  try { stopScheduler(); } catch {}
  server.close(() => console.log('[server] http closed'));
  try { await redis.quit(); console.log('[redis] closed'); } catch {}
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', e => console.error('[unhandled]', e));
process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e);
  // 进程进入未知状态,优雅退出由容器重启
  shutdown('uncaughtException');
});
