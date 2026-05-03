import express from 'express';
import { readThreeState } from './redis.js';
import { startScheduler } from './scheduler.js';
import { FINANCE_BUILTIN_FALLBACK } from './sources/finance.js';
import { HOT_IDS, HOT_BUILTIN_FALLBACK, refreshHotList } from './sources/hot.js';
import { WEATHER_BUILTIN_FALLBACK, refreshWeatherForCity, refreshWeatherForCoords } from './sources/weather.js';
import { HOLIDAY_BUILTIN_FALLBACK, SUPPORTED_COUNTRIES, refreshHolidayForCountry } from './sources/holiday.js';
import { getSuggestions } from './sources/suggest.js';
import { computeTodayInfo, refreshToday } from './sources/today.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// CORS:仅允许同域;反代后请求是同域,直接放开
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ===== 行情 =====
app.get('/api/finance', async (req, res) => {
  const [indices, fx] = await Promise.all([
    readThreeState('finance:indices', null),
    readThreeState('finance:fx',      null),
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
        fetched_at:   indices.fetched_at,
        freshness:    indices.freshness,
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

  // 任何未被填充的 key 都标记为 builtin
  for (const k of Object.keys(merged)) {
    if (!sources[k]) sources[k] = { source: 'builtin', source_label: '内置兜底', fetched_at: 0, freshness: 'fallback' };
  }

  res.json({ data: merged, sources });
});

// ===== 热榜 =====
app.get('/api/hot/:id', async (req, res) => {
  const { id } = req.params;
  if (!HOT_IDS.includes(id)) return res.status(404).json({ error: 'unknown_hot_id' });
  const r = await readThreeState('hot:' + id, HOT_BUILTIN_FALLBACK);
  res.json(r);
});

app.post('/api/hot/:id/refresh', async (req, res) => {
  const { id } = req.params;
  if (!HOT_IDS.includes(id)) return res.status(404).json({ error: 'unknown_hot_id' });
  await refreshHotList(id);
  const r = await readThreeState('hot:' + id, HOT_BUILTIN_FALLBACK);
  res.json(r);
});

// ===== 节假日(多国)=====
// GET /api/holidays?country=CN  → 单个国家
// GET /api/holidays/countries   → 支持的国家列表
app.get('/api/holidays/countries', (req, res) => {
  res.json({ data: SUPPORTED_COUNTRIES });
});

app.get('/api/holidays', async (req, res) => {
  const country = String(req.query.country || 'CN').toUpperCase();
  // 白名单校验:防止任意 country 触发外网调用(DoS 向量)
  if (!SUPPORTED_COUNTRIES.some(c => c.code === country)) {
    return res.status(400).json({
      error: 'unsupported_country',
      supported: SUPPORTED_COUNTRIES.map(c => c.code),
    });
  }
  const key = 'holiday:' + country;
  let r = await readThreeState(key, null);
  if (!r) {
    // 缓存未命中,实时拉取
    await refreshHolidayForCountry(country);
    r = await readThreeState(key, HOLIDAY_BUILTIN_FALLBACK);
  }
  res.json(r);
});

// ===== 今日(农历/节气/传统节日)=====
app.get('/api/today', async (req, res) => {
  // 当天直接算,无需走缓存(算法每次都几毫秒)
  // 但仍然走 readThreeState 给前端一致的 source/freshness 字段
  let r = await readThreeState('today', null);
  if (!r) {
    await refreshToday();
    r = await readThreeState('today', null);
  }
  // 兜底:就地算
  if (!r) {
    res.json({
      data: computeTodayInfo(),
      source: 'lunar-javascript',
      source_label: 'lunar-javascript(实时计算)',
      fetched_at: Date.now(),
      freshness: 'fresh',
    });
    return;
  }
  res.json(r);
});

// ===== 天气(按城市/坐标按需请求,stale-while-revalidate)=====
app.get('/api/weather', async (req, res) => {
  const { city, lat, lon, label } = req.query;

  if (city) {
    const key = 'weather:' + String(city).toLowerCase();
    let r = await readThreeState(key, null);
    if (!r) {
      // 完全无缓存,阻塞拉取
      await refreshWeatherForCity(String(city));
      r = await readThreeState(key, WEATHER_BUILTIN_FALLBACK);
    } else if (r.freshness === 'stale' || r.freshness === 'fallback') {
      // 有旧数据,立即返回,后台异步刷新
      refreshWeatherForCity(String(city)).catch(() => {});
    }
    return res.json(r);
  }

  if (lat && lon) {
    const key = `weather:coords:${lat},${lon}`;
    let r = await readThreeState(key, null);
    if (!r) {
      await refreshWeatherForCoords(Number(lat), Number(lon), label || '');
      r = await readThreeState(key, WEATHER_BUILTIN_FALLBACK);
    } else if (r.freshness === 'stale' || r.freshness === 'fallback') {
      refreshWeatherForCoords(Number(lat), Number(lon), label || '').catch(() => {});
    }
    return res.json(r);
  }

  res.status(400).json({ error: 'need city or lat/lon' });
});

// ===== 搜索联想 =====
app.get('/api/suggest', async (req, res) => {
  const { q } = req.query;
  const r = await getSuggestions(String(q || ''));
  res.json(r);
});

// ===== 启动 =====
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on 0.0.0.0:${PORT}`);
  startScheduler();
});

process.on('unhandledRejection', e => console.error('[unhandled]', e));
process.on('uncaughtException',  e => console.error('[uncaught]',  e));
