import cron from 'node-cron';
import { refreshFinance } from './sources/finance.js';
import { refreshAllHot } from './sources/hot.js';
import { refreshAllHolidays } from './sources/holiday.js';
import { refreshToday } from './sources/today.js';

// 预热的国家(默认五大);其他国家按需(用户访问时实时拉)
const PREWARM_COUNTRIES = ['CN', 'US', 'GB', 'DE', 'JP'];

export function startScheduler() {
  console.log('[scheduler] initial fetch...');
  refreshFinance().catch(e => console.error('[scheduler] finance init', e));
  refreshAllHot().catch(e => console.error('[scheduler] hot init', e));
  refreshAllHolidays(PREWARM_COUNTRIES).catch(e => console.error('[scheduler] holidays init', e));
  refreshToday().catch(e => console.error('[scheduler] today init', e));

  // 行情:每 30 秒
  cron.schedule('*/30 * * * * *', () => {
    refreshFinance().catch(e => console.error('[scheduler] finance', e.message));
  });

  // 热榜:每 5 分钟
  cron.schedule('*/5 * * * *', () => {
    refreshAllHot().catch(e => console.error('[scheduler] hot', e.message));
  });

  // 节假日(常用国家):每天凌晨 3 点
  cron.schedule('0 3 * * *', () => {
    refreshAllHolidays(PREWARM_COUNTRIES).catch(e => console.error('[scheduler] holidays', e.message));
  });

  // 今日:每天凌晨 0:01(刚过零点更新农历)
  cron.schedule('1 0 * * *', () => {
    refreshToday().catch(e => console.error('[scheduler] today', e.message));
  });

  console.log('[scheduler] started');
}
