import Redis from 'ioredis';
import { safeParse } from './safe.js';

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  // issue#5:模块加载时不要立即连接,首次操作触发(避免 import 即触发持续重连)
  lazyConnect: true,
  enableReadyCheck: true,
  // 有界超时 + 重试上限 — Redis 不可用时降级路径不卡(返回 fallback 即可)
  connectTimeout: 3000,         // 连接握手 3s 超时
  commandTimeout: 2000,         // 单个命令 2s 超时
  maxRetriesPerRequest: 2,      // 每请求最多 2 次重试
  retryStrategy: (times) => times > 5 ? null : Math.min(times * 200, 2000),
});

redis.on('error', (e) => console.error('[redis]', e.message));
redis.on('connect', () => console.log('[redis] connected'));

const HOT_PREFIX = 'cache:';
const LASTGOOD_PREFIX = 'lastgood:';

// 动态 key(用户输入产生的)的 lastgood TTL,默认 30 天
// 静态 key(服务端固定的,如 finance:indices)的 lastgood 永久
const DYNAMIC_LASTGOOD_TTL_SEC = Number(process.env.DYNAMIC_LASTGOOD_TTL_SEC || 30 * 24 * 3600);

// 判断 key 是否动态(含用户输入)
function isDynamicKey(key) {
  return key.startsWith('weather:');
}

// 三态读取:fresh(在 cache 内)/stale(在 lastgood 内)/fallback(兜底)
// Redis 异常时不抛错,降级到 fallback 或 null
export async function readThreeState(key, builtinFallback) {
  let hot = null, lastGood = null;
  try {
    [hot, lastGood] = await Promise.all([
      redis.get(HOT_PREFIX + key).catch(e => { console.warn('[redis] get hot:', key, e.message); return null; }),
      redis.get(LASTGOOD_PREFIX + key).catch(e => { console.warn('[redis] get lastgood:', key, e.message); return null; }),
    ]);
  } catch (e) {
    console.warn('[redis] readThreeState failed:', key, e.message);
  }

  if (hot) {
    const parsed = safeParse(hot);
    if (parsed) return { ...parsed, freshness: 'fresh' };
    console.warn('[redis] cache:', key, 'JSON corrupt, ignoring');
  }
  if (lastGood) {
    const parsed = safeParse(lastGood);
    if (parsed) {
      const age = Math.floor((Date.now() - (parsed.fetched_at || 0)) / 1000);
      return { ...parsed, freshness: 'stale', stale_age_sec: age };
    }
    console.warn('[redis] lastgood:', key, 'JSON corrupt, ignoring');
  }
  if (builtinFallback) {
    return {
      ...builtinFallback,
      source: 'builtin',
      source_label: '内置兜底',
      fetched_at: 0,                     // 用 0 而非 Date.now,前端可识别真伪
      freshness: 'fallback',
    };
  }
  return null;
}

// 双写 cache + lastgood;其一失败不阻塞另一个
export async function writeBoth(key, payload, hotTtlSec) {
  const json = JSON.stringify(payload);
  const lastgoodTtl = isDynamicKey(key) ? DYNAMIC_LASTGOOD_TTL_SEC : null;

  const setHot = redis
    .set(HOT_PREFIX + key, json, 'EX', hotTtlSec)
    .catch(e => console.warn('[redis] set cache:', key, e.message));
  const setLast = lastgoodTtl
    ? redis.set(LASTGOOD_PREFIX + key, json, 'EX', lastgoodTtl)
        .catch(e => console.warn('[redis] set lastgood (TTL):', key, e.message))
    : redis.set(LASTGOOD_PREFIX + key, json)
        .catch(e => console.warn('[redis] set lastgood:', key, e.message));

  await Promise.allSettled([setHot, setLast]);
}

// 给 health check 用:Redis 是否可用
export async function pingRedis() {
  try {
    const r = await redis.ping();
    return r === 'PONG';
  } catch {
    return false;
  }
}

export default redis;
