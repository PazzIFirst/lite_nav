// 公历/北京时间 + 距周末/月初 + 农历 + 老黄历(后端 /api/today 算)
import { apiGet, srcTooltip } from './api.js';

const bjTimeFmt = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });

export function updateBJTime() {
  document.getElementById('bj-time').textContent = '北京 ' + bjTimeFmt.format(new Date());
}

export function renderSolar() {
  const now = new Date();
  const d = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', year:'numeric', month:'long', day:'numeric' }).format(now);
  const w = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', weekday:'short' }).format(now);
  document.getElementById('solar-date').textContent = d + ' ' + w;
}

// 距周末 / 距下月 —— 纯本地日期计算,不依赖任何 API
export function renderWeekend() {
  const weekendEl = document.getElementById('weekend-row');
  if (!weekendEl) return;
  const bjStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const [ty, tm, td] = bjStr.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);

  const dow = today.getDay();
  const daysToWeekend = (dow === 0 || dow === 6) ? 0 : (6 - dow);
  let weekendHtml;
  if (daysToWeekend === 0)      weekendHtml = '🎉 今天是周末';
  else if (daysToWeekend === 1) weekendHtml = '距周末 <b>明天</b>';
  else                          weekendHtml = `距周末 <b>${daysToWeekend}天</b>`;

  const nextMonth = tm === 12 ? new Date(ty + 1, 0, 1) : new Date(ty, tm, 1);
  const daysToNextMonth = Math.round((nextMonth - today) / 86400000);
  const nextMonthName = nextMonth.toLocaleDateString('zh-CN', { month: 'long' });
  let monthHtml;
  if (daysToNextMonth === 0)      monthHtml = `📅 今天${nextMonthName}1日`;
  else if (daysToNextMonth === 1) monthHtml = `距${nextMonthName} <b>明天</b>`;
  else                            monthHtml = `距${nextMonthName} <b>${daysToNextMonth}天</b>`;

  weekendEl.innerHTML = weekendHtml + ' <span class="countdown-sep">·</span> ' + monthHtml;
}

// 宜 / 忌 各占一行,黄道(神煞)徽章跟在农历那一行末尾
function renderAlmanac(a, container, shenEl) {
  if (!container || !shenEl) return;
  container.innerHTML = '';
  shenEl.innerHTML = '';
  if (!a) return;

  function line(labelText, labelClass, body) {
    const row = document.createElement('div');
    row.className = 'almanac-line';
    const label = document.createElement('span');
    label.className = labelClass;
    label.textContent = labelText;
    const text = document.createElement('span');
    text.className = 'almanac-text';
    text.textContent = body;
    row.append(label, text);
    return row;
  }

  if (a.yi?.length) container.appendChild(line('宜', 'almanac-yi-label', a.yi.slice(0, 5).join(' ')));
  if (a.ji?.length) container.appendChild(line('忌', 'almanac-ji-label', a.ji.slice(0, 5).join(' ')));

  if (a.shen_type) {
    const badge = document.createElement('span');
    badge.className = 'almanac-shen ' + (a.shen_type === '黄道' ? 'huang' : 'hei');
    badge.textContent = a.shen_type + (a.shen_name ? ' ' + a.shen_name : '日');
    shenEl.appendChild(badge);
  }

  const tipLines = [];
  if (a.position_xi)  tipLines.push('喜神方位: ' + a.position_xi);
  if (a.position_cai) tipLines.push('财神方位: ' + a.position_cai);
  if (a.position_fu)  tipLines.push('福神方位: ' + a.position_fu);
  if (a.chong_sha)    tipLines.push('冲煞: ' + a.chong_sha);
  if (a.nayin)        tipLines.push('纳音: ' + a.nayin);
  if (a.pengzu_gan)   tipLines.push('彭祖百忌(干): ' + a.pengzu_gan);
  if (a.pengzu_zhi)   tipLines.push('彭祖百忌(支): ' + a.pengzu_zhi);
  const tip = tipLines.join('\n');
  container.title = tip;
  shenEl.title = tip;
}

export function renderLunar() {
  const el = document.getElementById('lunar-date');
  const almanacEl = document.getElementById('almanac-row');
  const shenEl = document.getElementById('almanac-shen');
  apiGet('/api/today').then(r => {
    const d = r?.data;
    if (!d) { el.textContent = '农历 --'; return; }
    el.textContent = d.lunar_text + ' · ' + d.lunar_year_ganzhi + ' · 属' + d.lunar_year_zodiac;
    const tipLines = [srcTooltip(r)];
    if (d.term)              tipLines.push('今日节气: ' + d.term);
    if (d.next_term)         tipLines.push('下个节气: ' + d.next_term + ' (' + d.next_term_date + ')');
    if (d.festivals?.length) tipLines.push('节日: ' + d.festivals.join('、'));
    el.title = tipLines.filter(Boolean).join('\n');
    renderAlmanac(d.almanac, almanacEl, shenEl);
  }).catch(() => { el.textContent = '农历 --'; });
}
