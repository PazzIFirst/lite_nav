// 行情(指数 + USD/CNY 双汇率 + 市场状态徽章)
import { apiGet, srcTooltip } from './api.js';

const FIN_ITEMS = [
  { id:'usdcny', label:'美元/人民币' },
  { id:'nasdaq', label:'纳斯达克'   },
  { id:'sp500',  label:'标普500'    },
  { id:'djia',   label:'道琼斯'     },
  { id:'gold',   label:'黄金/克'    },
  { id:'sse',    label:'上证'       },
  { id:'szse',   label:'深证成指'   },
  { id:'csi300', label:'沪深300'    },
  { id:'hsi',    label:'恒生'       },
];

let finPayload = null;

function marketStateBadge(marketTimeSec) {
  if (!marketTimeSec) return null;
  const ageMin = Math.floor((Date.now() / 1000 - marketTimeSec) / 60);
  if (ageMin < 30)     return { text: '盘中', cls: 'fin-mkt-open'    };
  if (ageMin < 4 * 60) return { text: '延迟', cls: 'fin-mkt-delayed' };
  return                      { text: '收盘', cls: 'fin-mkt-closed' };
}

// 各指数硬编码交易时段(基于北京时间;周末全部收盘)
function indexMarketState(id) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[parts.weekday];
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const inRange = (start, end) => mins >= start && mins < end;

  const cnIndex = ['sse', 'szse', 'csi300'].includes(id);
  const isHsi   = id === 'hsi';
  const isUs    = ['nasdaq', 'sp500', 'djia'].includes(id);
  const isGold  = id === 'gold';
  const isWeekend = dow === 0 || dow === 6;

  if (cnIndex) {
    if (isWeekend) return { text: '收盘', cls: 'fin-mkt-closed' };
    if (inRange(9*60+30, 11*60+30) || inRange(13*60, 15*60)) {
      return { text: '盘中', cls: 'fin-mkt-open' };
    }
    return { text: '收盘', cls: 'fin-mkt-closed' };
  }
  if (isHsi) {
    if (isWeekend) return { text: '收盘', cls: 'fin-mkt-closed' };
    if (inRange(9*60+30, 12*60) || inRange(13*60, 16*60)) {
      return { text: '盘中', cls: 'fin-mkt-open' };
    }
    return { text: '收盘', cls: 'fin-mkt-closed' };
  }
  if (isUs) {
    // 美股美东 9:30-16:00 = 北京 22:30-05:00(隔日)
    const usOpen =
      (dow >= 1 && dow <= 5 && mins >= 22*60+30) ||
      (dow >= 2 && dow <= 6 && mins < 5*60);
    return usOpen
      ? { text: '盘中', cls: 'fin-mkt-open' }
      : { text: '收盘', cls: 'fin-mkt-closed' };
  }
  if (isGold) {
    // 上海金 9:00-15:30 + 20:00-02:30(隔日)
    if (isWeekend) return { text: '收盘', cls: 'fin-mkt-closed' };
    if (inRange(9*60, 15*60+30) || mins >= 20*60 || mins < 2*60+30) {
      return { text: '盘中', cls: 'fin-mkt-open' };
    }
    return { text: '收盘', cls: 'fin-mkt-closed' };
  }
  return null;
}

function changeSpan(pct) {
  const c = document.createElement('span');
  c.className = 'fin-change fin-flat';
  if (pct == null) return c;
  c.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
  c.className = 'fin-change ' + (pct > 0.01 ? 'fin-up' : pct < -0.01 ? 'fin-down' : 'fin-flat');
  return c;
}

export function renderFinance() {
  const grid = document.getElementById('financeGrid');
  grid.innerHTML = '';

  const data    = finPayload?.data    || {};
  const sources = finPayload?.sources || {};

  for (const item of FIN_ITEMS) {
    const d    = data[item.id];
    const meta = sources[item.id];

    const el = document.createElement('div');
    el.className = 'finance-item';
    const label = document.createElement('span');
    label.className = 'fin-label';
    label.textContent = item.label;
    const tip = srcTooltip(meta);
    if (tip) el.title = tip;

    if (item.id === 'usdcny' && d?.value_cny && d?.value_cnh) {
      el.classList.add('finance-item-dual');
      el.appendChild(label);
      const addRow = (tagText, valStr, pct, marketTime) => {
        const tag = document.createElement('span');
        tag.className = 'fin-pair-tag';
        tag.textContent = tagText;
        const v = document.createElement('span');
        v.className = 'fin-value';
        v.textContent = valStr;
        el.appendChild(tag);
        el.appendChild(v);
        el.appendChild(changeSpan(pct));
        const state = marketStateBadge(marketTime);
        const b = document.createElement('span');
        b.className = 'fin-mkt ' + (state ? state.cls : '');
        b.textContent = state ? state.text : '';
        el.appendChild(b);
      };
      addRow('在岸', d.value_cny, d.changePct_cny, d.market_time_cny);
      addRow('离岸', d.value_cnh, d.changePct_cnh, d.market_time_cnh);
    } else {
      el.appendChild(label);
      el.appendChild(document.createElement('span'));   // col 2 空
      const value = document.createElement('span');
      value.className = 'fin-value';
      value.textContent = d ? d.value : '--';
      el.appendChild(value);
      el.appendChild(changeSpan(d?.changePct));
      const state = indexMarketState(item.id);
      const b = document.createElement('span');
      b.className = 'fin-mkt ' + (state ? state.cls : '');
      b.textContent = state ? state.text : '';
      el.appendChild(b);
    }

    grid.appendChild(el);
  }
}

export function updateFinanceNote() {
  const noteEl = document.getElementById('financeNote');
  const sources = finPayload?.sources || {};
  const stamps = Object.values(sources).map(s => s.fetched_at).filter(Boolean);
  if (!stamps.length) { noteEl.textContent = '行情加载中…'; return; }
  const newest = Math.max(...stamps);
  const states = new Set(Object.values(sources).map(s => s.freshness));
  const tag = states.has('stale') ? '(含缓存)' : states.has('fallback') ? '(含兜底)' : '';
  const p = new Date(newest);
  const hms = `${String(p.getHours()).padStart(2,'0')}:${String(p.getMinutes()).padStart(2,'0')}:${String(p.getSeconds()).padStart(2,'0')}`;
  noteEl.textContent = `数据更新: ${hms} ${tag}`.trim();
}

export async function loadFinance() {
  try {
    finPayload = await apiGet('/api/finance');
    renderFinance();
    updateFinanceNote();
  } catch (e) {
    console.warn('[finance]', e.message);
  }
}
