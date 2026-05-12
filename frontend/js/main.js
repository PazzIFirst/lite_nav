// 入口:串联各模块的初始化 + 启动周期性轮询(行情/热榜)
import { renderClockCards, updateClocks, initClocksModule } from './clocks.js';
import { renderSolar, renderLunar, updateBJTime } from './today.js';
import { initSearchModule } from './search.js';
import { initHolidaysModule } from './holidays.js';
import { initLocation, initWeatherModal } from './ip-weather.js';
import { renderFinance, loadFinance } from './finance.js';
import { initHotLists, loadHotList, HOT_SOURCES } from './hot.js';
import { renderNavGroups, initNavModule } from './nav.js';

// 明暗主题切换(主题已由 <head> 内联脚本应用,这里只挂事件)
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch(_) {}
  });
}

initSearchModule();
initClocksModule();
initHolidaysModule();
initWeatherModal();
initNavModule();

renderClockCards();
updateClocks();
setInterval(() => { updateBJTime(); updateClocks(); }, 1000);
updateBJTime();
renderSolar();
renderLunar();

renderNavGroups();
renderFinance();

initHotLists();
initLocation();

// F-019/F-020:Page Visibility — 标签页隐藏时停止轮询,显示时**只在离上次刷新足够久**才补一次
const FINANCE_INTERVAL = 30 * 1000;
const HOT_INTERVAL     = 5 * 60 * 1000;
let financeTimer = null, hotTimer = null;
let lastFinanceAt = 0, lastHotAt = 0;

function tickFinance() { loadFinance(); lastFinanceAt = Date.now(); }
function tickHot()     { HOT_SOURCES.forEach(s => loadHotList(s)); lastHotAt = Date.now(); }

function startPolling() {
  if (!financeTimer) {
    if (Date.now() - lastFinanceAt > FINANCE_INTERVAL) tickFinance();
    financeTimer = setInterval(tickFinance, FINANCE_INTERVAL);
  }
  if (!hotTimer) {
    if (Date.now() - lastHotAt > HOT_INTERVAL) tickHot();
    hotTimer = setInterval(tickHot, HOT_INTERVAL);
  }
}
function stopPolling() {
  if (financeTimer) { clearInterval(financeTimer); financeTimer = null; }
  if (hotTimer)     { clearInterval(hotTimer);     hotTimer = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling();
  else                 startPolling();
});

tickFinance();
lastHotAt = Date.now();   // initHotLists 已经触发了热榜首次加载
financeTimer = setInterval(tickFinance, FINANCE_INTERVAL);
hotTimer     = setInterval(tickHot,     HOT_INTERVAL);
