// 农历/节气/传统节日/老黄历 — 100% 离线、无外网依赖
// 基于 lunar-javascript(纯算法,寿星天文历)
// 算法运行 < 5ms,直接由 server 实时调用,不走 Redis 缓存
import lunar from 'lunar-javascript';
const { Solar } = lunar;

// 取北京时间(Asia/Shanghai)的"今天"(只取年月日)— D-001 修复
// 服务器跑 UTC 时,北京时间凌晨 0~8 点不会被算成前一天
function getBeijingToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  return Solar.fromYmd(+parts.year, +parts.month, +parts.day);
}

export function computeTodayInfo() {
  const solar = getBeijingToday();
  const l = solar.getLunar();

  const monthZh = l.getMonthInChinese();
  const dayZh   = l.getDayInChinese();
  const lunarText = '农历' + (l.isLeap?.() ? '闰' : '') + monthZh + '月' + dayZh;

  const term = l.getJieQi() || '';

  // D-005:复用 nextJieQi
  let nextTerm = '', nextTermDate = '';
  try {
    const nj = l.getNextJieQi(true);
    if (nj) {
      nextTerm = nj.getName?.() || '';
      const s = nj.getSolar?.();
      if (s) nextTermDate = `${s.getYear()}-${String(s.getMonth()).padStart(2,'0')}-${String(s.getDay()).padStart(2,'0')}`;
    }
  } catch {}

  // D-004:节日去重
  const festivalsRaw = [
    ...(l.getFestivals?.() || []),
    ...(l.getOtherFestivals?.() || []),
    ...(solar.getFestivals?.() || []),
    ...(solar.getOtherFestivals?.() || []),
  ];
  const festivals = [...new Set(festivalsRaw)];

  const almanac = {
    yi:           safe(() => l.getDayYi()).slice(0, 6),
    ji:           safe(() => l.getDayJi()).slice(0, 6),
    position_xi:  safe(() => l.getDayPositionXiDesc(), ''),
    position_cai: safe(() => l.getDayPositionCaiDesc(), ''),
    position_fu:  safe(() => l.getDayPositionFuDesc(), ''),
    shen_name:    safe(() => l.getDayTianShen(), ''),
    shen_type:    safe(() => l.getDayTianShenType(), ''),
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

// 保留导出供 scheduler 调用一次预热(虽然路由不再走缓存,scheduler 可选不再调用)
// 但保留兼容现有 scheduler.js 引用
export async function refreshToday() {
  // 现在 /api/today 不走缓存,这里仅作 health 探针:确保 lunar-javascript 模块可加载
  computeTodayInfo();
}
