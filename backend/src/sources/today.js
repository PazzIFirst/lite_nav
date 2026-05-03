// 农历/节气/传统节日 — 100% 离线、无外网依赖
// 基于 lunar-javascript(纯算法,寿星天文历)
import lunar from 'lunar-javascript';
const { Solar } = lunar;

import { writeBoth } from '../redis.js';

export function computeTodayInfo() {
  const now = new Date();
  const solar = Solar.fromDate(now);
  const l = solar.getLunar();

  const monthZh = l.getMonthInChinese();
  const dayZh   = l.getDayInChinese();
  // 闰月会带"闰"前缀
  const lunarText = '农历' + (l.isLeap?.() ? '闰' : '') + monthZh + '月' + dayZh;

  const term = l.getJieQi() || '';        // 当天节气(如"立夏"),非节气日为空
  const nextTerm = (() => {
    try { return l.getNextJieQi(true)?.getName() || ''; } catch { return ''; }
  })();
  const nextTermDate = (() => {
    try {
      const jq = l.getNextJieQi(true);
      const s  = jq?.getSolar();
      return s ? `${s.getYear()}-${String(s.getMonth()).padStart(2,'0')}-${String(s.getDay()).padStart(2,'0')}` : '';
    } catch { return ''; }
  })();

  const festivals = [
    ...(l.getFestivals?.() || []),       // 农历传统节日(春节/端午/中秋等)
    ...(l.getOtherFestivals?.() || []),  // 其他农历节日
    ...(solar.getFestivals?.() || []),   // 公历节日(元旦/儿童节等)
    ...(solar.getOtherFestivals?.() || []),
  ];

  // 老黄历:宜忌、神位、黄黑道、彭祖百忌、冲煞
  const almanac = {
    yi:           safe(() => l.getDayYi()).slice(0, 6),
    ji:           safe(() => l.getDayJi()).slice(0, 6),
    position_xi:  safe(() => l.getDayPositionXiDesc(), ''),
    position_cai: safe(() => l.getDayPositionCaiDesc(), ''),
    position_fu:  safe(() => l.getDayPositionFuDesc(), ''),
    shen_name:    safe(() => l.getDayTianShen(), ''),         // 值神名(青龙/玄武/...)
    shen_type:    safe(() => l.getDayTianShenType(), ''),     // 黄道 / 黑道
    chong_sha:    safe(() => l.getDayChongDesc(), ''),
    pengzu_gan:   safe(() => l.getPengZuGan(), ''),
    pengzu_zhi:   safe(() => l.getPengZuZhi(), ''),
    nayin:        safe(() => l.getDayNaYin(), ''),
  };

  return {
    solar_date: `${solar.getYear()}-${String(solar.getMonth()).padStart(2,'0')}-${String(solar.getDay()).padStart(2,'0')}`,
    lunar_text: lunarText,
    lunar_year_ganzhi: l.getYearInGanZhi(),
    lunar_year_zodiac: l.getYearShengXiao(),
    term,
    next_term: nextTerm,
    next_term_date: nextTermDate,
    festivals,
    almanac,
  };
}

function safe(fn, fallback) {
  try { const v = fn(); return v == null ? (fallback ?? []) : v; }
  catch { return fallback ?? []; }
}

// 后端 24h 缓存(每天 0 点会自然过期)
export async function refreshToday() {
  const data = computeTodayInfo();
  await writeBoth('today', {
    data,
    source: 'lunar-javascript',
    source_label: 'lunar-javascript(离线算法)',
    fetched_at: Date.now(),
  }, 24 * 3600);
}
