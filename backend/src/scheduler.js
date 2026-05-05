import cron from 'node-cron';
import { refreshFinance } from './sources/finance.js';
import { refreshAllHot } from './sources/hot.js';
import { refreshAllHolidays } from './sources/holiday.js';
import { refreshToday } from './sources/today.js';

const PREWARM_COUNTRIES = ['CN', 'US', 'GB', 'DE', 'JP'];
const TZ = process.env.TZ || 'Asia/Shanghai';

const cronTasks = [];

// 任务运行锁:同任务并发时跳过(T-003 修复)
function withLock(name, fn) {
  let running = false;
  return async () => {
    if (running) {
      console.warn(`[scheduler] ${name} still running, skip`);
      return;
    }
    running = true;
    try { await fn(); }
    catch (e) { console.error(`[scheduler] ${name} error:`, e?.message || e); }
    finally { running = false; }
  };
}

export function stopScheduler() {
  for (const t of cronTasks) {
    try { t.stop(); } catch {}
  }
  cronTasks.length = 0;
  console.log('[scheduler] stopped');
}

export function startScheduler() {
  console.log(`[scheduler] starting (timezone=${TZ})`);

  // 启动时预热(fire-and-forget;ready 状态由 /api/health Redis 检查代理)
  refreshFinance().catch(e => console.error('[scheduler] finance init', e));
  refreshAllHot().catch(e => console.error('[scheduler] hot init', e));
  refreshAllHolidays(PREWARM_COUNTRIES).catch(e => console.error('[scheduler] holidays init', e));
  refreshToday().catch(e => console.error('[scheduler] today init', e));

  const opts = { timezone: TZ };

  // 行情:每 30 秒
  cronTasks.push(cron.schedule(
    '*/30 * * * * *',
    withLock('finance', refreshFinance),
    opts,
  ));

  // 热榜:每 5 分钟
  cronTasks.push(cron.schedule(
    '*/5 * * * *',
    withLock('hot', refreshAllHot),
    opts,
  ));

  // 节假日(常用国家):每天 03:00 北京时间
  cronTasks.push(cron.schedule(
    '0 3 * * *',
    withLock('holidays', () => refreshAllHolidays(PREWARM_COUNTRIES)),
    opts,
  ));

  // 今日(占位 — /api/today 现在直接计算,这里仅做周期性 sanity check)
  cronTasks.push(cron.schedule(
    '1 0 * * *',
    withLock('today', refreshToday),
    opts,
  ));

  console.log('[scheduler] started');
}
