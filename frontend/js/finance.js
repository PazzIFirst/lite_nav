// 行情:三张可配置的卡片(货币 / 股指 / A股 / 港股 / 美股)
//
// 非交易时段画最近 N 个交易日的日 K;交易时段改画当天分时线,
// 由 main.js 的 30s 轮询驱动,线随时间向右生长。
import { apiGet, srcTooltip } from './api.js';

const SLOTS_KEY = 'nav.fin.slots';
const COLOR_KEY = 'nav.fin.color';
const DAYS = 60;

const COLORS = {
  'red-up':   { up: '#e5484d', down: '#30a46c' },   // 默认:红涨绿跌
  'green-up': { up: '#30a46c', down: '#e5484d' },
};

const KIND_LABEL = { currency: '货币', index: '股指', cn: 'A股', hk: '港股', us: '美股' };

const PRESETS = {
  currency: [
    { secid: '133.USDCNH', name: '美元/离岸人民币' },
    { secid: '133.EURUSD', name: '欧元/美元' },
    { secid: '133.USDJPY', name: '美元/日元' },
    { secid: '133.GBPUSD', name: '英镑/美元' },
    { secid: '133.USDHKD', name: '美元/港元' },
    { secid: '133.AUDUSD', name: '澳元/美元' },
  ],
  index: [
    { secid: '1.000001', name: '上证指数' },
    { secid: '0.399001', name: '深证成指' },
    { secid: '1.000300', name: '沪深300' },
    { secid: '100.HSI', name: '恒生指数' },
    { secid: '100.NDX', name: '纳斯达克100' },
    { secid: '100.SPX', name: '标普500' },
    { secid: '100.DJIA', name: '道琼斯' },
    { secid: '100.N225', name: '日经225' },
  ],
};

const CODE_HINT = {
  cn: '6 位代码,如 600519 / 000001 / 300750',
  hk: '5 位代码或 1-5 位数字,如 00700 / 700',
  us: '美股票代码,如 AAPL / TSLA',
};

const DEFAULT_SLOTS = [
  { kind: 'index', secid: '1.000001', name: '上证指数' },
  { kind: 'index', secid: '100.NDX', name: '纳斯达克100' },
  { kind: 'currency', secid: '133.USDCNH', name: '美元/离岸人民币' },
];

let slots = loadSlots();
let colorMode = loadColor();
let pickIndex = 0;
let pickKind = 'currency';
let inited = false;
let busy = [false, false, false];
let liveState = [];   // 每张卡上次是不是盘中;收盘的卡不必重复拉
let lastLoad = [];    // 每张卡上次拉取时间,收盘卡每 10 分钟还是强制刷一次(防跨时段)

const grid = document.getElementById('financeGrid');
let cards = [];

// ===== 持久化 =====
function loadSlots() {
  try {
    const raw = JSON.parse(localStorage.getItem(SLOTS_KEY) || 'null');
    if (Array.isArray(raw) && raw.length === 3 && raw.every(s => s && s.secid && s.kind)) return raw;
  } catch (_) {}
  return DEFAULT_SLOTS.map(s => ({ ...s }));
}
const saveSlots = () => { try { localStorage.setItem(SLOTS_KEY, JSON.stringify(slots)); } catch (_) {} };

function loadColor() {
  try { return localStorage.getItem(COLOR_KEY) === 'green-up' ? 'green-up' : 'red-up'; }
  catch (_) { return 'red-up'; }
}
const saveColor = () => { try { localStorage.setItem(COLOR_KEY, colorMode); } catch (_) {} };

// ===== 数字 =====
function fmtNum(v) {
  if (v == null || Number.isNaN(v)) return '--';
  const digits = Math.abs(v) < 10 ? 4 : 2;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
const fmtPct = (v) => (v == null || Number.isNaN(v)) ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

// ===== 画布 =====
function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = canvas.clientWidth || 220;
  const h = canvas.clientHeight || 64;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}
const px = (v) => Math.round(v) + 0.5;

function drawCandles(canvas, bars, up, down) {
  const { ctx, w, h } = setupCanvas(canvas);
  if (!bars || !bars.length) return;
  const padY = 3;
  const hi = Math.max(...bars.map(b => b.h));
  const lo = Math.min(...bars.map(b => b.l));
  const span = hi - lo || 1;
  const y = v => h - padY - ((v - lo) / span) * (h - padY * 2);
  const slot = w / bars.length;
  const bodyW = Math.max(1.4, Math.min(6, slot * 0.62));

  bars.forEach((b, i) => {
    const cx = i * slot + slot / 2;
    const col = b.c >= b.o ? up : down;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px(cx), y(b.h));
    ctx.lineTo(px(cx), y(b.l));
    ctx.stroke();
    const top = y(Math.max(b.o, b.c));
    const bot = y(Math.min(b.o, b.c));
    ctx.fillRect(cx - bodyW / 2, top, bodyW, Math.max(1, bot - top));
  });
}

function drawTrend(canvas, points, prevClose, up, down) {
  const { ctx, w, h } = setupCanvas(canvas);
  if (!points || points.length < 1) return;
  const vals = points.map(p => p.p).filter(v => v > 0);
  if (!vals.length) return;
  const base = prevClose || vals[0];
  // 分时图按「相对昨收的对称区间」定纵轴:基线落在正中,一眼看出涨跌幅度
  const dev = Math.max(Math.abs(Math.max(...vals) - base), Math.abs(base - Math.min(...vals))) || base * 0.001;
  const hi = base + dev;
  const lo = base - dev;
  const span = hi - lo || 1;
  const padY = 4;
  const y = v => h - padY - ((v - lo) / span) * (h - padY * 2);
  const last = vals[vals.length - 1];
  const col = last >= base ? up : down;

  ctx.strokeStyle = 'rgba(148,163,184,.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, px(y(base)));
  ctx.lineTo(w, px(y(base)));
  ctx.stroke();
  ctx.setLineDash([]);

  const x = i => (points.length === 1 ? w - 1 : (i / (points.length - 1)) * (w - 1));

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, col + '30');
  grad.addColorStop(1, col + '00');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, h);
  points.forEach((p, i) => ctx.lineTo(x(i), y(p.p)));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.p)) : ctx.moveTo(x(i), y(p.p))));
  ctx.stroke();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x(points.length - 1), y(last), 2.4, 0, Math.PI * 2);
  ctx.fill();
}

// ===== 卡片 =====
function buildCard(slot, i) {
  const el = document.createElement('article');
  el.className = 'fin-card';
  el.dataset.idx = String(i);
  el.innerHTML = `
    <div class="fin-card-head">
      <button class="fin-card-name" type="button" title="点击更换标的"></button>
      <span class="fin-kind"></span>
    </div>
    <div class="fin-quote">
      <span class="fin-price">--</span>
      <span class="fin-chg"></span>
    </div>
    <canvas class="fin-canvas"></canvas>
    <div class="fin-foot"><span class="fin-state"></span><span class="fin-src"></span></div>`;
  el.querySelector('.fin-card-name').textContent = slot.name || '选择标的';
  el.querySelector('.fin-kind').textContent = KIND_LABEL[slot.kind] || '';
  el.querySelector('.fin-card-name').addEventListener('click', () => openPicker(i));
  return el;
}

function paintCard(i, opt) {
  const el = cards[i];
  if (!el) return;
  if (opt.name) el.querySelector('.fin-card-name').textContent = opt.name;

  const priceEl = el.querySelector('.fin-price');
  const chgEl = el.querySelector('.fin-chg');
  const stateEl = el.querySelector('.fin-state');
  const srcEl = el.querySelector('.fin-src');
  const canvas = el.querySelector('.fin-canvas');
  const { up, down } = COLORS[colorMode];

  if (opt.error) {
    priceEl.textContent = '--';
    priceEl.className = 'fin-price';
    chgEl.textContent = '暂无数据';
    chgEl.className = 'fin-chg';
    stateEl.textContent = '';
    srcEl.textContent = '';
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.strokeStyle = 'rgba(148,163,184,.25)';
    ctx.beginPath(); ctx.moveTo(0, px(h / 2)); ctx.lineTo(w, px(h / 2)); ctx.stroke();
    return;
  }

  let last, prev;
  if (opt.trend) {
    const pts = opt.trend.points || [];
    last = pts.length ? pts[pts.length - 1].p : null;
    prev = opt.prevClose ?? opt.trend.prevClose ?? (pts.length ? pts[0].p : null);
    drawTrend(canvas, pts, prev, up, down);
  } else {
    const bars = opt.bars || [];
    last = bars.length ? bars[bars.length - 1].c : null;
    prev = bars.length > 1 ? bars[bars.length - 2].c : null;
    drawCandles(canvas, bars, up, down);
  }

  priceEl.textContent = fmtNum(last);
  const pct = (prev && last != null) ? ((last - prev) / prev) * 100 : null;
  chgEl.textContent = fmtPct(pct);
  const cls = pct == null ? '' : pct >= 0 ? ' is-up' : ' is-down';
  chgEl.className = 'fin-chg' + cls;
  priceEl.className = 'fin-price' + cls;

  stateEl.textContent = opt.live ? '盘中' : '收盘';
  stateEl.className = 'fin-state' + (opt.live ? ' is-live' : '');
  srcEl.textContent = opt.srcLabel || '';
  el.title = opt.srcLabel ? srcTooltip({ source_label: opt.srcLabel }) : '';
}

async function loadSlot(i) {
  const slot = slots[i];
  if (!slot || !cards[i] || busy[i]) return;
  busy[i] = true;
  try {
    const k = await apiGet(`/api/kline?secid=${encodeURIComponent(slot.secid)}&days=${DAYS}`);
    const d = k.data;
    if (d.name && d.name !== slot.name) {
      slot.name = d.name;
      saveSlots();
    }
    lastLoad[i] = Date.now();
    if (!d.live) {
      liveState[i] = false;
      paintCard(i, { name: slot.name, bars: d.bars, live: false, srcLabel: k.source_label });
      return;
    }
    liveState[i] = true;
    try {
      const t = await apiGet(`/api/intraday?secid=${encodeURIComponent(slot.secid)}`);
      paintCard(i, {
        name: slot.name, trend: t.data, prevClose: t.data.prevClose,
        live: true, srcLabel: t.source_label,
      });
    } catch (_) {
      paintCard(i, { name: slot.name, bars: d.bars, live: true, srcLabel: k.source_label });
    }
  } catch (e) {
    paintCard(i, { error: true });
  } finally {
    busy[i] = false;
  }
}

// ===== 选择器 =====
function openPicker(i) {
  pickIndex = i;
  const slot = slots[i];
  pickKind = ['currency', 'index', 'cn', 'hk', 'us'].includes(slot.kind) ? slot.kind : 'index';
  document.getElementById('finPickTitle').textContent = `第 ${i + 1} 张 · 选择标的`;
  renderTabs();
  renderPickerBody(slot);
  document.getElementById('finPickModal').classList.add('open');
}

const closePicker = () => document.getElementById('finPickModal').classList.remove('open');

function renderTabs() {
  const tabs = document.getElementById('finTabs');
  tabs.innerHTML = '';
  [['currency', '货币'], ['index', '股指'], ['cn', 'A股'], ['hk', '港股'], ['us', '美股']].forEach(([kind, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fin-tab' + (kind === pickKind ? ' is-active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { pickKind = kind; renderTabs(); renderPickerBody(null); });
    tabs.appendChild(b);
  });
}

function renderPickerBody(slot) {
  const presetField = document.getElementById('finPresetField');
  const codeField = document.getElementById('finCodeField');
  const isPreset = pickKind === 'currency' || pickKind === 'index';
  presetField.hidden = !isPreset;
  codeField.hidden = isPreset;

  if (isPreset) {
    const sel = document.getElementById('finPreset');
    sel.innerHTML = '';
    PRESETS[pickKind].forEach(p => {
      const o = document.createElement('option');
      o.value = p.secid;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    const hit = slot && PRESETS[pickKind].find(p => p.secid === slot.secid);
    if (hit) sel.value = hit.secid;
  } else {
    document.getElementById('finCodeLabel').textContent =
      { cn: 'A 股代码', hk: '港股代码', us: '美股代码' }[pickKind] || '代码';
    const input = document.getElementById('finCode');
    input.placeholder = { cn: '600519', hk: '00700', us: 'AAPL' }[pickKind] || '';
    input.value = slot && slot.kind === pickKind ? (slot.code || '') : '';
    document.getElementById('finCodeHint').textContent = CODE_HINT[pickKind] || '';
    setTimeout(() => input.focus(), 30);
  }
}

async function confirmPick() {
  const btn = document.getElementById('finPickOk');
  if (pickKind === 'currency' || pickKind === 'index') {
    const secid = document.getElementById('finPreset').value;
    const hit = PRESETS[pickKind].find(p => p.secid === secid);
    slots[pickIndex] = { kind: pickKind, secid, name: hit ? hit.name : secid };
  } else {
    const code = document.getElementById('finCode').value.trim();
    if (!code) return;
    btn.disabled = true;
    btn.textContent = '解析中…';
    try {
      const r = await apiGet(`/api/symbol?market=${pickKind}&code=${encodeURIComponent(code)}`);
      slots[pickIndex] = { kind: pickKind, secid: r.data.secid, name: r.data.name || code, code: r.data.code };
    } catch (e) {
      document.getElementById('finCodeHint').textContent = '没找到这个代码,换个试试';
      btn.disabled = false;
      btn.textContent = '确定';
      return;
    }
    btn.disabled = false;
    btn.textContent = '确定';
  }
  saveSlots();
  closePicker();
  rebuild();
}

// ===== 设置 =====
function paintColorOpts() {
  document.querySelectorAll('#finColorOpts .fin-color-opt').forEach(b => {
    b.classList.toggle('is-active', b.dataset.mode === colorMode);
  });
}

function applyColorAttr() {
  document.documentElement.dataset.finColor = colorMode;
}

function setColorMode(mode) {
  colorMode = mode === 'green-up' ? 'green-up' : 'red-up';
  saveColor();
  applyColorAttr();
  paintColorOpts();
  loadFinance();
}

// ===== 对外 =====
function rebuild() {
  if (!grid) return;
  liveState = [];
  lastLoad = [];
  grid.innerHTML = '';
  cards = slots.map((s, i) => {
    const el = buildCard(s, i);
    grid.appendChild(el);
    return el;
  });
  loadFinance();
}

export function renderFinance() {
  if (!grid) return;
  applyColorAttr();
  if (!inited) {
    inited = true;
    document.getElementById('finPickCancel').addEventListener('click', closePicker);
    document.getElementById('finPickOk').addEventListener('click', confirmPick);
    document.getElementById('finPickModal').addEventListener('click', (e) => {
      if (e.target.id === 'finPickModal') closePicker();
    });
    document.getElementById('finSettingsBtn').addEventListener('click', () => {
      paintColorOpts();
      document.getElementById('finSettingsModal').classList.add('open');
    });
    document.getElementById('finSettingsClose').addEventListener('click', () => {
      document.getElementById('finSettingsModal').classList.remove('open');
    });
    document.getElementById('finSettingsModal').addEventListener('click', (e) => {
      if (e.target.id === 'finSettingsModal') e.currentTarget.classList.remove('open');
    });
    document.querySelectorAll('#finColorOpts .fin-color-opt').forEach(b => {
      b.addEventListener('click', () => setColorMode(b.dataset.mode));
    });
    document.getElementById('finCode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirmPick(); }
    });
  }
  rebuild();
}

export function loadFinance() {
  // 只刷还在盘中的卡:收盘的日 K 不会变,没必要每 30 秒重画一遍。
  // 收盘卡每 10 分钟仍强制刷一次 —— 否则页面挂到第二天开盘,那张卡会一直是旧日期。
  const now = Date.now();
  slots.forEach((_, i) => {
    if (liveState[i] === false && lastLoad[i] && now - lastLoad[i] < 10 * 60 * 1000) return;
    loadSlot(i);
  });
}
