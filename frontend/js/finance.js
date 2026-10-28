// 行情:三张可配置的卡片(货币 / 股指 / A股 / 港股 / 美股)
//
// 只看一个交易日:盘中画当天的分时线(30s 轮询续画),收盘画最近那个交易日的分时。
// 不画历史日 K —— 一张卡大约 200px 宽,60 根蜡烛在这个尺寸下只能看个大概趋势,
// 分时反而能把「今天怎么走的」说清楚。。
import { apiGet, srcTooltip } from './api.js';

const SLOTS_KEY = 'nav.fin.slots';
const COLOR_KEY = 'nav.fin.color';

const COLORS = {
  'red-up':   { up: '#e5484d', down: '#30a46c' },   // 默认:红涨绿跌
  'green-up': { up: '#30a46c', down: '#e5484d' },
};

const KIND_LABEL = { currency: '货币', index: '股指', cn: 'A股', hk: '港股', us: '美股' };

const PRESETS = {
  currency: [
    { secid: '133.USDCNH', name: '美元/离岸人民币', group: '人民币' },
    { secid: '133.USDCNY', name: '美元/人民币(在岸)', group: '人民币' },
    { secid: '133.EURUSD', name: '欧元/美元', group: '主要货币' },
    { secid: '133.GBPUSD', name: '英镑/美元', group: '主要货币' },
    { secid: '133.USDJPY', name: '美元/日元', group: '主要货币' },
    { secid: '133.USDCHF', name: '美元/瑞郎', group: '主要货币' },
    { secid: '133.USDCAD', name: '美元/加元', group: '主要货币' },
    { secid: '133.AUDUSD', name: '澳元/美元', group: '主要货币' },
    { secid: '133.NZDUSD', name: '纽元/美元', group: '主要货币' },
    { secid: '133.EURJPY', name: '欧元/日元', group: '交叉盘' },
    { secid: '133.EURGBP', name: '欧元/英镑', group: '交叉盘' },
    { secid: '133.USDHKD', name: '美元/港元', group: '亚洲' },
    { secid: '133.USDSGD', name: '美元/新加坡元', group: '亚洲' },
  ],
  index: [
    { secid: '1.000001', name: '上证指数', group: '中国' },
    { secid: '0.399001', name: '深证成指', group: '中国' },
    { secid: '1.000300', name: '沪深300', group: '中国' },
    { secid: '1.000905', name: '中证500', group: '中国' },
    { secid: '1.000016', name: '上证50', group: '中国' },
    { secid: '0.399006', name: '创业板指', group: '中国' },
    { secid: '1.000688', name: '科创50', group: '中国' },
    { secid: '100.HSI', name: '恒生指数', group: '港股' },
    { secid: '100.HSCE', name: '恒生国企', group: '港股' },
    { secid: '100.HSTECH', name: '恒生科技', group: '港股' },
    { secid: '100.NDX', name: '纳斯达克100', group: '美股' },
    { secid: '100.IXIC', name: '纳斯达克综指', group: '美股' },
    { secid: '100.SPX', name: '标普500', group: '美股' },
    { secid: '100.DJIA', name: '道琼斯', group: '美股' },
    { secid: '100.N225', name: '日经225', group: '亚太' },
    { secid: '100.KS11', name: '韩国KOSPI', group: '亚太' },
    { secid: '100.TWII', name: '台湾加权', group: '亚太' },
    { secid: '100.SENSEX', name: '印度SENSEX', group: '亚太' },
    { secid: '100.NSEI', name: '印度Nifty50', group: '亚太' },
    { secid: '100.AXJO', name: '澳洲ASX200', group: '亚太' },
    { secid: '100.GDAXI', name: '德国DAX', group: '欧洲' },
    { secid: '100.FCHI', name: '法国CAC40', group: '欧洲' },
    { secid: '100.FTSE', name: '英国富时100', group: '欧洲' },
    { secid: '100.STOXX50E', name: '欧洲斯托克50', group: '欧洲' },
    { secid: '100.IBEX', name: '西班牙IBEX35', group: '欧洲' },
    { secid: '100.BVSP', name: '巴西BOVESPA', group: '其他' },
    { secid: '100.GSPTSE', name: '加拿大TSX', group: '其他' },
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
let cardGeneration = 0;
let busy = [], quoteViews = [];
let pickerSession = 0, pickerBusy = false, pickerFocusTimer = null;
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



// 滑动平均:压掉分钟级抖动,只留「今天大概怎么走的」。
// 两端窗口截断(不是跳过),否则最后一个平滑点会和末点脱开,末点的小圆点浮在线外。
// 卡片上的报价/涨跌始终用真实值,平滑只影响画出来的线。
function smooth(points, radius) {
  if (!points || points.length < radius * 2 + 3) return points;
  const n = points.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;      // 两端窗口截断,而不是不处理
      sum += points[j].p; cnt++;
    }
    out[i] = { p: sum / cnt };
  }
  return out;
}

// 点数远多于像素时,按桶取平均 —— 1000 个点画在 200px 上只会糊成一条粗带
function thin(points, maxN) {
  if (!points || points.length <= maxN) return points;
  const step = points.length / maxN;
  const out = [];
  for (let i = 0; i < maxN; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let sum = 0, n = 0;
    for (let k = a; k < b && k < points.length; k++) { sum += points[k].p; n++; }
    out.push({ p: sum / n });
  }
  const last = points[points.length - 1];
  out[out.length - 1] = { p: last.p };   // 末端保持真实值
  return out;
}

function drawTrend(canvas, points, prevClose, up, down) {
  const { ctx, w, h } = setupCanvas(canvas);
  if (!points || points.length < 1) return;
  points = smooth(thin(points, Math.max(60, Math.round(w))), 3);
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
  ctx.lineWidth = 1.4;
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
      <span class="fin-card-name"></span>
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
  // 整张卡都能点:标题只是文字,不再做按钮
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', '更换标的');
  el.addEventListener('click', () => openPicker(i));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(i); }
  });
  return el;
}

function paintCard(i, opt) {
  quoteViews[i] = opt;
  const el = cards[i];
  if (!el) return;
  if (opt.name) {
    el.querySelector('.fin-card-name').textContent = opt.name;
    el.setAttribute('aria-label', '更换标的:' + opt.name);
  }

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

  const pts = (opt.trend && opt.trend.points) || [];
  const last = pts.length ? pts[pts.length - 1].p : null;
  const prev = opt.prevClose ?? (opt.trend && opt.trend.prevClose) ?? (pts.length ? pts[0].p : null);
  drawTrend(canvas, pts, prev, up, down);

  priceEl.textContent = fmtNum(last);
  const pct = (prev && last != null) ? ((last - prev) / prev) * 100 : null;
  chgEl.textContent = fmtPct(pct);
  const cls = pct == null ? '' : pct >= 0 ? ' is-up' : ' is-down';
  chgEl.className = 'fin-chg' + cls;
  priceEl.className = 'fin-price' + cls;

  const d = (opt.trend && opt.trend.date) || '';
  const day = /^\d{8}$/.test(d) ? `${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
  stateEl.textContent = opt.live ? '盘中' : ('收盘' + (day ? ' · ' + day : ''));
  stateEl.className = 'fin-state' + (opt.live ? ' is-live' : '');
  srcEl.textContent = opt.srcLabel || '';
  el.title = opt.srcLabel ? srcTooltip({ source_label: opt.srcLabel }) : '';
}

async function loadSlot(i) {
  const slot = slots[i];
  if (!slot || !cards[i] || busy[i]) return;
  const generation = cardGeneration;
  const request = Symbol('quote request');
  busy[i] = request;
  const isCurrent = () => generation === cardGeneration && slots[i] === slot && busy[i] === request;
  try {
    const t = await apiGet(`/api/intraday?secid=${encodeURIComponent(slot.secid)}`);
    if (!isCurrent()) return;
    const d = t.data;
    if (d.name && d.name !== slot.name) {
      slot.name = d.name;
      saveSlots();
    }
    liveState[i] = !!d.live;
    lastLoad[i] = Date.now();
    paintCard(i, {
      name: slot.name, trend: d, prevClose: d.prevClose,
      live: !!d.live, srcLabel: t.source_label,
    });
  } catch (e) {
    if (isCurrent()) paintCard(i, { error: true });
  } finally {
    if (isCurrent()) busy[i] = null;
  }
}

// ===== 选择器 =====
function invalidatePickerRequest() {
  ++pickerSession;
  pickerBusy = false;
  clearTimeout(pickerFocusTimer);
  const btn = document.getElementById('finPickOk');
  btn.disabled = false;
  btn.textContent = '确定';
}

function openPicker(i) {
  invalidatePickerRequest();
  pickIndex = i;
  const slot = slots[i];
  pickKind = ['currency', 'index', 'cn', 'hk', 'us'].includes(slot.kind) ? slot.kind : 'index';
  document.getElementById('finPickTitle').textContent = `第 ${i + 1} 张 · 选择标的`;
  renderTabs();
  renderPickerBody(slot);
  document.getElementById('finPickModal').classList.add('open');
}

const closePicker = () => {
  invalidatePickerRequest();
  document.getElementById('finPickModal').classList.remove('open');
};

function renderTabs() {
  const tabs = document.getElementById('finTabs');
  tabs.innerHTML = '';
  [['currency', '货币'], ['index', '股指'], ['cn', 'A股'], ['hk', '港股'], ['us', '美股']].forEach(([kind, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fin-tab' + (kind === pickKind ? ' is-active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { invalidatePickerRequest(); pickKind = kind; renderTabs(); renderPickerBody(null); });
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
    const groups = new Map();
    PRESETS[pickKind].forEach(p => {
      const key = p.group || '';
      if (!groups.has(key)) {
        const g = document.createElement('optgroup');
        g.label = key;
        groups.set(key, g);
        sel.appendChild(g);
      }
      const o = document.createElement('option');
      o.value = p.secid;
      o.textContent = p.name;
      groups.get(key).appendChild(o);
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
    const session = pickerSession;
    pickerFocusTimer = setTimeout(() => {
      if (session === pickerSession && document.getElementById('finPickModal').classList.contains('open')) input.focus();
    }, 30);
  }
}

async function confirmPick() {
  const modal = document.getElementById('finPickModal');
  if (pickerBusy || !modal.classList.contains('open')) return;
  const session = pickerSession, index = pickIndex, kind = pickKind;
  const isCurrent = () => session === pickerSession && modal.classList.contains('open');
  const btn = document.getElementById('finPickOk');
  let replacement;
  if (kind === 'currency' || kind === 'index') {
    const secid = document.getElementById('finPreset').value;
    const hit = PRESETS[kind].find(p => p.secid === secid);
    if (!hit) return;
    replacement = { kind, secid, name: hit.name };
  } else {
    const code = document.getElementById('finCode').value.trim();
    if (!code) return;
    pickerBusy = true;
    btn.disabled = true;
    btn.textContent = '解析中…';
    try {
      const r = await apiGet(`/api/symbol?market=${kind}&code=${encodeURIComponent(code)}`);
      if (!isCurrent()) return;
      replacement = { kind, secid: r.data.secid, name: r.data.name || code, code: r.data.code };
    } catch (e) {
      if (isCurrent()) document.getElementById('finCodeHint').textContent = '没找到这个代码,换个试试';
      return;
    } finally {
      if (isCurrent()) {
        pickerBusy = false;
        btn.disabled = false;
        btn.textContent = '确定';
      }
    }
  }
  if (!isCurrent()) return;
  slots[index] = replacement;
  saveSlots();
  closePicker();
  rebuild();
}

// ===== 设置 =====
// 和热榜槽位共用「页面设置」弹窗,所以走同一套逻辑:改动先预览,
// 点保存才落盘,点取消还原。不在弹窗里开「即时保存」的口子。
let colorAtOpen = null;

function paintColorOpts() {
  document.querySelectorAll('#finColorOpts .fin-color-opt').forEach(b => {
    b.classList.toggle('is-active', b.dataset.mode === colorMode);
  });
}

function repaintQuotes() {
  quoteViews.forEach((view, i) => { if (view) paintCard(i, view); });
}

function applyColorAttr() {
  document.documentElement.dataset.finColor = colorMode;
}

function openColorDraft() {
  colorAtOpen = colorMode;
  paintColorOpts();
}

// 预览:只改内存和画面,不写 localStorage
function pickColor(mode) {
  colorMode = mode === 'green-up' ? 'green-up' : 'red-up';
  applyColorAttr();
  paintColorOpts();
  repaintQuotes();
}

function commitColorDraft() {
  if (colorAtOpen && colorMode !== colorAtOpen) saveColor();
  colorAtOpen = null;
}

function revertColorDraft() {
  if (colorAtOpen && colorMode !== colorAtOpen) {
    colorMode = colorAtOpen;
    applyColorAttr();
    paintColorOpts();
    repaintQuotes();
  }
  colorAtOpen = null;
}

function resetColor() {
  colorMode = 'red-up';
  colorAtOpen = null;
  saveColor();
  applyColorAttr();
  paintColorOpts();
  repaintQuotes();
}

// ===== 对外 =====
function rebuild() {
  if (!grid) return;
  ++cardGeneration;
  busy = [];
  quoteViews = [];
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
    // 设置入口在页面右上角,和热榜槽位共用一个弹窗、一套保存/取消语义
    const settings = document.getElementById('hotModal');
    settings.addEventListener('settings:open', openColorDraft);
    settings.addEventListener('settings:close', (e) => {
      if (e.detail.action === 'save') commitColorDraft();
      else if (e.detail.action === 'reset') resetColor();
      else revertColorDraft();
    });
    document.querySelectorAll('#finColorOpts .fin-color-opt').forEach(b => {
      b.addEventListener('click', () => pickColor(b.dataset.mode));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('finPickModal').classList.contains('open')) {
        e.preventDefault(); closePicker();
      }
    });
    document.getElementById('finCode').addEventListener('input', () => {
      if (pickerBusy) invalidatePickerRequest();
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
