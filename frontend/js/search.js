// 搜索引擎切换 + 历史 + 联想
import { fetchT, faviconUrl } from './api.js';

const ENGINES = [
  { label:'百度',    key:'baidu',   url:'https://www.baidu.com/s?wd=',                  favicon:'baidu.com'    },
  { label:'Google',  key:'google',  url:'https://www.google.com/search?q=',             favicon:'google.com'   },
  { label:'Bing',    key:'bing',    url:'https://www.bing.com/search?q=',               favicon:'bing.com'     },
  { label:'知乎',    key:'zhihu',   url:'https://www.zhihu.com/search?type=content&q=', favicon:'zhihu.com'    },
  { label:'Yandex',  key:'yandex',  url:'https://yandex.com/search/?text=',             favicon:'yandex.com'   },
  { label:'Bilibili',key:'bilibili',url:'https://search.bilibili.com/all?keyword=',     favicon:'bilibili.com' },
  { label:'YouTube', key:'youtube', url:'https://www.youtube.com/results?search_query=',favicon:'youtube.com'  },
  { label:'GitHub',  key:'github',  url:'https://github.com/search?q=',                 favicon:'github.com'   },
  { label:'X',       key:'x',       url:'https://x.com/search?q=',                      favicon:'x.com'        },
  { label:'DuckDuckGo',key:'ddg',   url:'https://duckduckgo.com/?q=',                   favicon:'duckduckgo.com' },
  { label:'npm',     key:'npm',     url:'https://www.npmjs.com/search?q=',              favicon:'npmjs.com'    },
];

let currentEngine = 'baidu';
let addSearchHistory; // 由 initSearchHistory 设置,供联想模块调用

function initSearch() {
  const icon = document.getElementById('engineIcon');
  function setEngine(e) {
    currentEngine = e.key;
    icon.style.visibility = '';
    icon.src = faviconUrl(e.favicon);
    document.querySelectorAll('.engine-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.engine-btn[data-key="${e.key}"]`)?.classList.add('active');
  }

  const tabs = document.getElementById('engineTabs');
  ENGINES.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'engine-btn' + (e.key === currentEngine ? ' active' : '');
    btn.textContent = e.label;
    btn.dataset.key = e.key;
    btn.addEventListener('click', () => {
      setEngine(e);
      document.getElementById('searchInput').focus();
    });
    tabs.appendChild(btn);
  });

  setEngine(ENGINES.find(e => e.key === currentEngine));

  document.getElementById('searchForm').addEventListener('submit', ev => {
    ev.preventDefault();
    const q = document.getElementById('searchInput').value.trim();
    if (!q) return;
    addSearchHistory?.(q);
    const eng = ENGINES.find(e => e.key === currentEngine);
    if (eng) window.open(eng.url + encodeURIComponent(q), '_blank', 'noopener');
  });
}

function initSearchHistory() {
  const HIST_KEY = 'searchHistory';
  const MAX = 10;
  const container = document.getElementById('searchHistory');
  const input = document.getElementById('searchInput');

  function getHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(HIST_KEY));
      if (!Array.isArray(v)) return [];
      return v.filter(x => typeof x === 'string' && x.length > 0).slice(0, 50);
    } catch { return []; }
  }
  function saveHistory(h) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch {}
  }

  function render() {
    const h = getHistory();
    container.innerHTML = '';
    h.forEach((q, i) => {
      const chip = document.createElement('span');
      chip.className = 'hist-chip';
      chip.title = q;

      const text = document.createElement('span');
      text.className = 'hist-chip-text';
      text.textContent = q;

      const del = document.createElement('span');
      del.className = 'hist-del';
      del.textContent = '×';
      del.title = '删除';
      del.addEventListener('click', e => {
        e.stopPropagation();
        const hist = getHistory();
        hist.splice(i, 1);
        saveHistory(hist);
        render();
      });

      chip.append(text, del);
      chip.addEventListener('click', () => { input.value = q; input.focus(); });
      container.appendChild(chip);
    });
  }

  addSearchHistory = function(q) {
    const h = getHistory().filter(x => x !== q);
    h.unshift(q);
    saveHistory(h.slice(0, MAX));
    render();
  };

  render();
}

function initSuggestions() {
  const form  = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');

  const box = document.createElement('div');
  box.className = 'search-suggestions';
  form.appendChild(box);

  let timer = null, suggs = [], activeIdx = -1;
  let suggSeq = 0;  // F-005:请求序号防竞态

  function open()  { form.classList.add('sug-open'); }
  function close() { form.classList.remove('sug-open'); box.innerHTML = ''; suggs = []; activeIdx = -1; }

  function highlight(idx) {
    box.querySelectorAll('.sug-item').forEach((el, i) => el.classList.toggle('sug-active', i === idx));
    activeIdx = idx;
  }

  function pick(text) {
    input.value = text; close();
    addSearchHistory?.(text);   // F-006:联想入历史
    const eng = ENGINES.find(e => e.key === currentEngine);
    if (eng && text.trim()) window.open(eng.url + encodeURIComponent(text), '_blank', 'noopener');
  }

  function render(list) {
    suggs = list; activeIdx = -1; box.innerHTML = '';
    if (!list.length) { close(); return; }
    list.forEach((text, i) => {
      const el = document.createElement('div');
      el.className = 'sug-item';

      const iconWrap = document.createElement('span');
      iconWrap.innerHTML = '<svg class="sug-icon" viewBox="0 0 24 24"><path d="M21.71 20.29l-3.68-3.68A8.5 8.5 0 1 0 17 18l3.68 3.68a1 1 0 0 0 1.41-1.41zM10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z"/></svg>';
      el.appendChild(iconWrap.firstChild);

      const textSpan = document.createElement('span');
      textSpan.textContent = text;
      el.appendChild(textSpan);

      el.addEventListener('mouseover', () => highlight(i));
      el.addEventListener('mousedown', e => { e.preventDefault(); pick(text); });
      box.appendChild(el);
    });
    open();
  }

  async function fetchSugg(q) {
    if (!q.trim()) { close(); return; }
    const seq = ++suggSeq;
    try {
      const r = await fetchT(`/api/suggest?q=${encodeURIComponent(q)}`, 4000);
      if (seq !== suggSeq) return;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (seq !== suggSeq) return;
      const list = Array.isArray(d?.data) ? d.data : [];
      if (!list.length) { close(); return; }
      render(list.slice(0, 8));
    } catch { close(); }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => fetchSugg(input.value), 200); });
  input.addEventListener('focus', () => { if (input.value) fetchSugg(input.value); });
  input.addEventListener('blur',  () => setTimeout(close, 150));
  form.addEventListener('submit', close);

  input.addEventListener('keydown', e => {
    if (!form.classList.contains('sug-open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(activeIdx + 1, suggs.length - 1);
      highlight(next); input.value = suggs[next];
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = activeIdx <= 0 ? -1 : activeIdx - 1;
      highlight(prev); if (prev >= 0) input.value = suggs[prev];
    } else if (e.key === 'Escape') { close(); }
  });
}

export function initSearchModule() {
  initSearchHistory();   // 必须先,addSearchHistory 注册给 search + suggest 用
  initSearch();
  initSuggestions();
}
