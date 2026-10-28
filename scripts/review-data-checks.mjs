// Run: node --experimental-vm-modules scripts/review-data-checks.mjs
// Uses the real chart module and holiday route with mocked cache/network/clock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let now = Date.parse('2026-10-29T07:00:00Z'); // Thursday, Shanghai 15:00 (closed)
const Clock = class extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
let cached = null, failing = false;
const requests = [], writes = [];
const context = vm.createContext({ Date: Clock, Intl, URL, Buffer, console });
const bindings = {
  '../redis.js': {
    readThreeState: async () => cached,
    writeBoth: async (key, value, ttl) => { writes.push({ key, value, ttl }); },
  },
  '../fetcher.js': {
    fetchT: async url => { requests.push(url); if (failing) throw new Error('offline'); return { url }; },
    readBufferLimited: async () => Buffer.from(''),
    readJsonLimited: async ({ url }) => {
      if (url.includes('searchapi')) return {}; // exercises resolveCode fallback too
      if (url.includes('finance.yahoo')) return {
        chart: { result: [{ meta: { exchangeTimezoneName: 'America/New_York', shortName: 'BRK.B' },
          timestamp: Array.from({ length: 6 }, (_, i) => Math.floor(now / 1000) - (5 - i) * 60),
          indicators: { quote: [{ open: [1, 2, 3, 4, 5, 6], close: [2, 3, 4, 5, 6, 7], high: [3, 4, 5, 6, 7, 8], low: [1, 1, 2, 3, 4, 5], volume: [10, 10, 10, 10, 10, 10] }] },
        }] },
      };
      if (url.includes('fqkline')) {
        const code = new URL(url).searchParams.get('param').split(',')[0];
        return { data: { [code]: { day: [['2026-10-29', '100', '110', '112', '99', '10']], qt: { [code]: ['', 'Test'] } } } };
      }
      return {};
    },
  },
};
const chart = new vm.SourceTextModule(readFileSync(new URL('../backend/src/sources/chart.js', import.meta.url), 'utf8'), { context });
await chart.link(specifier => {
  const exports = bindings[specifier]; assert(exports, specifier);
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
});
await chart.evaluate();
const { getKline, getIntraday, resolveCode, isValidSecid } = chart.namespace;
const resolved = await resolveCode('us', 'BRK.B');
assert.equal(resolved.secid, '105.BRK.B'); assert(isValidSecid(resolved.secid));
requests.length = 0;
await getKline(resolved.secid);
assert(requests[0].includes('/chart/BRK-B?'), 'Yahoo must receive the full share class symbol');
requests.length = 0;
await getIntraday(resolved.secid);
assert(requests[0].includes('/chart/BRK-B?'), 'Intraday must retain the share class too');

const cachedBar = { secid: '1.000001', live: false, bars: [{ t: '2026-09-01', o: 100, c: 102 }] };
cached = { freshness: 'stale', fetched_at: Date.parse('2026-09-01'), data: cachedBar };
requests.length = 0;
let result = await getKline('1.000001');
assert(requests.length > 0, 'Closed market must refresh stale lastgood data');
assert.equal(result.data.bars[0].t, '2026-10-29'); assert.equal(result.data.live, false);

cached = { freshness: 'fresh', fetched_at: now - 20_000, data: { ...cachedBar, live: true } };
requests.length = 0;
result = await getKline('1.000001');
assert(requests.length > 0, 'Market close must fetch the final bar even within the old TTL');
assert.equal(result.data.live, false);
assert.equal(cached.data.live, true, 'Response normalization must not mutate the cache object');
assert.equal(writes.at(-1).ttl, 600);

cached = { freshness: 'fresh', fetched_at: now - 30_000, data: { ...cachedBar, live: false } };
requests.length = 0;
result = await getKline('1.000001');
assert.equal(requests.length, 0); assert.equal(result.data.live, false);
cached.fetched_at = now - 601_000;
await getKline('1.000001');
assert(requests.length > 0, 'A mislabeled fresh cache still has a bounded age');

now = Date.parse('2026-10-29T06:59:00Z'); // reopening/current open session
cached = { freshness: 'fresh', fetched_at: now - 10_000, data: { ...cachedBar, live: false } };
requests.length = 0;
result = await getKline('1.000001');
assert(requests.length > 0); assert.equal(result.data.live, true);
assert.equal(writes.at(-1).ttl, 60);

now = Date.parse('2026-10-29T07:00:00Z');
cached = { freshness: 'stale', fetched_at: now - 600_000, data: { ...cachedBar, live: true } };
failing = true; requests.length = 0;
result = await getKline('1.000001');
assert(requests.length > 0); assert.equal(result.data.live, false);
assert.equal(result.data.bars[0].t, '2026-09-01', 'Upstream failure must retain the last known data');
cached = { ...cached, freshness: 'fresh', fetched_at: now - 1_000, data: { secid: '105.BRK.B', live: true, points: [{ t: '09:30', p: 100 }] } };
result = await getIntraday('105.BRK.B');
assert.equal(result.data.live, false, 'Intraday fallback must also use current session state');
console.log('✓ Charts: full ticker suffix, bounded closed-session cache, close/open refresh, current live flags, failure fallback');

const server = readFileSync(new URL('../backend/src/server.js', import.meta.url), 'utf8');
const start = server.indexOf('const holidayInflight = new Map();');
const end = server.indexOf('// ===== 今日', start);
assert(start >= 0 && end > start);
let handler, refreshes = 0, readsFail = false, logs = 0, release;
let holidayCached = { freshness: 'stale', data: { year: 2025 }, fetched_at: 1 };
let refresh = () => new Promise(resolve => { release = resolve; });
const holiday = vm.createContext({
  Map, Promise,
  console: { warn: () => { logs++; } },
  app: { get: (_path, fn) => { handler = fn; } },
  a: fn => fn,
  validateCountryCode: () => 'FR',
  SUPPORTED_COUNTRIES: [{ code: 'FR' }],
  readThreeState: async () => { if (readsFail) throw new Error('Redis unavailable'); return holidayCached; },
  refreshHolidayForCountry: () => { refreshes++; return refresh(); },
  holidayFallback: () => ({ freshness: 'fallback', data: { builtin: true } }),
});
vm.runInContext(server.slice(start, end), holiday);
const call = async () => {
  let value;
  await handler({ query: { country: 'FR' } }, { json: result => { value = result; } });
  return value;
};
const inflight = () => vm.runInContext("holidayInflight.get('FR')", holiday);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let timeout;
let staleResults;
try {
  staleResults = await Promise.race([
    Promise.all(Array.from({ length: 10 }, call)),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Stale responses waited for refresh')), 1000); }),
  ]);
} finally { clearTimeout(timeout); }
assert(staleResults.every(item => item.freshness === 'stale'));
assert.equal(refreshes, 1, 'Concurrent stale requests must share one background refresh');
const fresh = { data: { year: 2026 }, fetched_at: now };
const staleTask = inflight();
holidayCached = { ...fresh, freshness: 'fresh' }; release(fresh); await staleTask;
assert.equal((await call()).data.year, 2026); assert.equal(refreshes, 1);

holidayCached = { freshness: 'stale', data: { year: 2025 } };
refresh = async () => { throw new Error('upstream failed'); };
assert.equal((await call()).data.year, 2025); await flush();
assert.equal(logs, 1); assert.equal(inflight(), undefined, 'Failure must clear the in-flight slot');

holidayCached = null; refresh = () => new Promise(resolve => { release = resolve; });
const before = refreshes;
const coldRequests = [call(), call()]; await flush();
assert.equal(refreshes, before + 1, 'Cold requests must share a single refresh too');
release(fresh);
const coldResults = await Promise.all(coldRequests);
assert(coldResults.every(item => item.freshness === 'fresh' && item.data.year === 2026));
refresh = async () => { throw new Error('upstream failed'); };
assert.equal((await call()).freshness, 'fallback');
readsFail = true; refresh = async () => fresh;
assert.equal((await call()).data.year, 2026, 'Redis failure must not discard fresh data');
refresh = async () => { throw new Error('upstream failed'); };
assert.equal((await call()).freshness, 'fallback');
console.log('✓ Holidays: stale-while-revalidate, concurrent deduplication, failure cleanup, cold fetch and Redis failure fallback');
