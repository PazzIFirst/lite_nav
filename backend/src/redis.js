import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: false,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

redis.on('error', (e) => console.error('[redis]', e.message));
redis.on('connect', () => console.log('[redis] connected'));

const HOT_PREFIX = 'cache:';
const LASTGOOD_PREFIX = 'lastgood:';

export async function readThreeState(key, hotTtlSec, builtinFallback) {
  const [hot, lastGood] = await Promise.all([
    redis.get(HOT_PREFIX + key),
    redis.get(LASTGOOD_PREFIX + key),
  ]);
  if (hot) {
    const parsed = JSON.parse(hot);
    return { ...parsed, freshness: 'fresh' };
  }
  if (lastGood) {
    const parsed = JSON.parse(lastGood);
    const age = Math.floor((Date.now() - (parsed.fetched_at || 0)) / 1000);
    return { ...parsed, freshness: 'stale', stale_age_sec: age };
  }
  if (builtinFallback) {
    return {
      ...builtinFallback,
      source: 'builtin',
      source_label: '内置兜底',
      fetched_at: Date.now(),
      freshness: 'fallback',
    };
  }
  return null;
}

export async function writeBoth(key, payload, hotTtlSec) {
  const json = JSON.stringify(payload);
  await Promise.all([
    redis.set(HOT_PREFIX + key, json, 'EX', hotTtlSec),
    redis.set(LASTGOOD_PREFIX + key, json),
  ]);
}

export default redis;
