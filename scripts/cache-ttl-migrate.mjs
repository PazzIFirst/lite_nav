// 给旧版本留下的动态 lastgood 键补 TTL。只更新原本没有过期时间的键，不删除数据。
// 使用与后端相同的 REDIS_HOST/PORT/PASSWORD/DYNAMIC_LASTGOOD_TTL_SEC 环境。
import redis, { isDynamicKey, DYNAMIC_LASTGOOD_TTL_SEC } from '../backend/src/redis.js';
const prefix = 'lastgood:';
const expireOnlyPersistent = "if redis.call('TTL', KEYS[1]) == -1 then return redis.call('EXPIRE', KEYS[1], ARGV[1]) else return 0 end";
let inspected = 0, updated = 0;
try {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', prefix + '*', 'COUNT', 200);
    cursor = next;
    const dynamic = keys.filter(key => isDynamicKey(key.slice(prefix.length)));
    inspected += dynamic.length;
    if (dynamic.length) {
      const pipeline = redis.pipeline();
      for (const key of dynamic) pipeline.eval(expireOnlyPersistent, 1, key, DYNAMIC_LASTGOOD_TTL_SEC);
      for (const [error, result] of await pipeline.exec()) {
        if (error) throw error;
        updated += Number(result) || 0;
      }
    }
  } while (cursor !== '0');
  console.log(JSON.stringify({ inspected, updated, ttlSeconds: DYNAMIC_LASTGOOD_TTL_SEC }));
} finally { await redis.quit(); }
