// 公历/北京时间 + 农历 + 老黄历(后端 /api/today 算)
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

function makeSep() {
  const s = document.createElement('span');
  s.className = 'almanac-sep';
  s.textContent = '·';
  return s;
}

function renderAlmanac(a, container) {
  if (!a || !container) return;
  container.innerHTML = '';

  function badgedSpan(badgeText, badgeClass, body) {
    const wrap = document.createElement('span');
    const badge = document.createElement('span');
    badge.className = badgeClass;
    badge.textContent = badgeText;
    wrap.appendChild(badge);
    wrap.appendChild(document.createTextNode(body));
    return wrap;
  }

  if (a.yi?.length) {
    container.appendChild(badgedSpan('宜', 'almanac-yi-label', a.yi.slice(0, 5).join(' ')));
    container.appendChild(makeSep());
  }
  if (a.ji?.length) {
    container.appendChild(badgedSpan('忌', 'almanac-ji-label', a.ji.slice(0, 5).join(' ')));
    container.appendChild(makeSep());
  }
  if (a.shen_type) {
    const shenSpan = document.createElement('span');
    const badge = document.createElement('span');
    badge.className = 'almanac-shen ' + (a.shen_type === '黄道' ? 'huang' : 'hei');
    badge.textContent = a.shen_type + '日';
    shenSpan.appendChild(badge);
    if (a.shen_name) shenSpan.appendChild(document.createTextNode(' ' + a.shen_name));
    container.appendChild(shenSpan);
  }

  const tipLines = [];
  if (a.position_xi)  tipLines.push('喜神方位: ' + a.position_xi);
  if (a.position_cai) tipLines.push('财神方位: ' + a.position_cai);
  if (a.position_fu)  tipLines.push('福神方位: ' + a.position_fu);
  if (a.chong_sha)    tipLines.push('冲煞: ' + a.chong_sha);
  if (a.nayin)        tipLines.push('纳音: ' + a.nayin);
  if (a.pengzu_gan)   tipLines.push('彭祖百忌(干): ' + a.pengzu_gan);
  if (a.pengzu_zhi)   tipLines.push('彭祖百忌(支): ' + a.pengzu_zhi);
  container.title = tipLines.join('\n');
}

export function renderLunar() {
  const el = document.getElementById('lunar-date');
  const almanacEl = document.getElementById('almanac-row');
  apiGet('/api/today').then(r => {
    const d = r?.data;
    if (!d) { el.textContent = '农历 --'; return; }
    el.textContent = d.lunar_text + ' · ' + d.lunar_year_ganzhi + ' · 属' + d.lunar_year_zodiac;
    const tipLines = [srcTooltip(r)];
    if (d.term)              tipLines.push('今日节气: ' + d.term);
    if (d.next_term)         tipLines.push('下个节气: ' + d.next_term + ' (' + d.next_term_date + ')');
    if (d.festivals?.length) tipLines.push('节日: ' + d.festivals.join('、'));
    el.title = tipLines.filter(Boolean).join('\n');
    renderAlmanac(d.almanac, almanacEl);
  }).catch(() => { el.textContent = '农历 --'; });
}
