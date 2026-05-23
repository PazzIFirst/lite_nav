// 多国节假日 + 倒计时 + 国家选择弹窗 + 周末/月初
import { apiGet, srcTooltip, copyToClipboard } from './api.js';

const COUNTRY_KEY = 'countdownCountries';
const DEFAULT_COUNTRIES = ['CN', 'US', 'GB', 'DE', 'JP'];

function getSelectedCountries() {
  try {
    const s = JSON.parse(localStorage.getItem(COUNTRY_KEY));
    if (Array.isArray(s) && s.length) {
      const valid = s.filter(x => typeof x === 'string' && /^[A-Z]{2}$/.test(x));
      if (valid.length) return valid.slice(0, 5);
    }
  } catch {}
  return DEFAULT_COUNTRIES;
}

function saveSelectedCountries(arr) {
  try { localStorage.setItem(COUNTRY_KEY, JSON.stringify(arr)); } catch {}
}

const _holidayCache = {};
const _countryNames = {};

async function loadHolidayCountries() {
  try {
    const r = await apiGet('/api/holidays/countries');
    for (const c of r.data || []) _countryNames[c.code] = c.name;
  } catch {}
}

async function loadHolidayForCountry(code) {
  try {
    const r = await apiGet('/api/holidays?country=' + encodeURIComponent(code));
    _holidayCache[code] = {
      items: (r.data?.items || []).map(h => ({
        name: h.name,
        name_native: h.name_native || h.name,
        start: new Date(h.s),
        end: new Date(h.e),
      })),
      meta:  { source: r.source, source_label: r.source_label, fetched_at: r.fetched_at, freshness: r.freshness },
    };
  } catch {
    _holidayCache[code] = { items: [], meta: null };
  }
}

function findNextHoliday(items, today) {
  let best = null, min = Infinity;
  for (const h of items) {
    // issue#6:用完整范围判断「假期中」,多天假期第 2 天起也算
    const diffStart = Math.round((h.start - today) / 86400000);
    const diffEnd   = Math.round((h.end   - today) / 86400000);
    if (diffStart <= 0 && diffEnd >= 0) {
      return { name: h.name, name_native: h.name_native, diff: 0 };
    }
    if (diffStart > 0 && diffStart < min) {
      min = diffStart;
      best = { name: h.name, name_native: h.name_native, diff: diffStart };
    }
  }
  return best;
}

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

function renderCountdowns() {
  const row = document.getElementById('countdown-row');
  const bjStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const [ty, tm, td] = bjStr.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);

  row.innerHTML = '';
  const itemNodes = [];

  function makeCountdownItem() {
    const sp = document.createElement('span');
    sp.className = 'countdown-item';
    return sp;
  }
  function makeFlagImg(code) {
    const img = document.createElement('img');
    img.src = `flags/${code.toLowerCase()}.png`;
    img.width = 16; img.height = 12; img.alt = code;
    img.style.cssText = 'vertical-align:middle;border-radius:2px;margin-right:2px;';
    img.onerror = () => { img.onerror = null; img.src = 'https://flagcdn.com/16x12/' + code.toLowerCase() + '.png'; };
    return img;
  }
  function makeSrcBadge(meta) {
    const fr = meta?.freshness;
    const srcOnline = fr === 'fresh' || fr === 'stale';
    const span = document.createElement('span');
    span.className = 'holiday-src ' + (srcOnline ? 'holiday-src-online' : 'holiday-src-local');
    span.title = srcTooltip(meta);
    span.textContent = srcOnline ? '在线' : '本地';
    return span;
  }
  function makeHolidayLabel(next) {
    const native = next.name_native || next.name;
    const showNative = native !== next.name;
    const span = document.createElement('span');
    span.className = 'holiday-name';
    span.style.cssText = 'cursor:pointer;text-decoration:underline dotted #bdc1c6;text-underline-offset:2px;';
    span.title = showNative ? (native + '\n点击复制原文') : '点击复制';
    span.dataset.copy = native;
    span.textContent = next.name;
    span.addEventListener('click', e => { e.stopPropagation(); copyToClipboard(native); });
    return span;
  }

  for (const code of getSelectedCountries()) {
    const cache = _holidayCache[code];
    if (!cache) continue;
    const next = findNextHoliday(cache.items, today);
    if (!next) continue;

    const item = makeCountdownItem();
    item.appendChild(makeFlagImg(code));

    if (next.diff === 0) {
      item.appendChild(makeHolidayLabel(next));
      item.appendChild(document.createTextNode('假期中'));
    } else {
      item.appendChild(document.createTextNode('距'));
      item.appendChild(makeHolidayLabel(next));
      item.appendChild(document.createTextNode(' '));
      const b = document.createElement('b');
      b.textContent = next.diff === 1 ? '明天' : `${next.diff}天`;
      item.appendChild(b);
    }
    item.appendChild(makeSrcBadge(cache.meta));
    itemNodes.push(item);
  }

  const picker = makeCountdownItem();
  picker.id = 'countryPickerBtn';
  picker.style.cssText = 'cursor:pointer;color:#1a73e8;';
  picker.title = '自定义国家';
  picker.textContent = '⚙ 国家';
  picker.addEventListener('click', openCountryModal);
  itemNodes.push(picker);

  itemNodes.forEach((node, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'countdown-sep';
      sep.textContent = '·';
      row.appendChild(sep);
    }
    row.appendChild(node);
  });
}

async function loadAllSelectedCountries() {
  const codes = getSelectedCountries();
  await Promise.allSettled(codes.map(loadHolidayForCountry));
  renderCountdowns();
}

let _allCountriesList = [];
async function ensureCountriesList() {
  if (_allCountriesList.length) return;
  try {
    const r = await apiGet('/api/holidays/countries');
    _allCountriesList = r.data || [];
  } catch {}
}

async function openCountryModal() {
  await ensureCountriesList();
  const selected = getSelectedCountries();
  const slots = document.getElementById('countrySlots');
  slots.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const tag = document.createElement('span');
    tag.style.cssText = 'font-size:11px;color:#9aa0a6;width:50px;flex-shrink:0;';
    tag.textContent = '槽位 ' + (i + 1);

    const select = document.createElement('select');
    select.className = 'modal-input';
    select.dataset.slot = i;
    select.style.flex = '1';

    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = '— 不显示 —';
    select.appendChild(empty);

    for (const c of _allCountriesList) {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = `${c.code} · ${c.name}`;
      if (selected[i] === c.code) opt.selected = true;
      select.appendChild(opt);
    }

    row.append(tag, select);
    slots.appendChild(row);
  }
  document.getElementById('countryModal').classList.add('open');
}

export function initHolidaysModule() {
  document.getElementById('countryCancel').addEventListener('click', () =>
    document.getElementById('countryModal').classList.remove('open'));
  document.getElementById('countryModal').addEventListener('click', e => {
    if (e.target.id === 'countryModal') e.target.classList.remove('open');
  });
  document.getElementById('countryReset').addEventListener('click', () => {
    saveSelectedCountries(DEFAULT_COUNTRIES);
    document.getElementById('countryModal').classList.remove('open');
    loadAllSelectedCountries();
  });
  document.getElementById('countrySave').addEventListener('click', () => {
    const selects = document.querySelectorAll('#countrySlots select');
    const codes = [];
    const seen = new Set();
    for (const s of selects) {
      const v = s.value;
      if (v && !seen.has(v)) { codes.push(v); seen.add(v); }
    }
    saveSelectedCountries(codes);
    document.getElementById('countryModal').classList.remove('open');
    loadAllSelectedCountries();
  });

  renderWeekend();
  loadHolidayCountries().then(loadAllSelectedCountries);
}
