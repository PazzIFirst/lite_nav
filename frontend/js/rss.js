// RSS 订阅:勾选多个源 → 后端并发抓取 → 按发布时间混排
import { fetchT } from './api.js';

const FEEDS_KEY = 'nav.rss.feeds';
const MAX_ITEMS = 40;

// 预设源:都在服务器上实测过能取到条目(2026-10)
const PRESETS = [
  {
    group: '中文科技',
    items: [
      { url: 'https://www.ithome.com/rss/', name: 'IT之家' },
      { url: 'https://sspai.com/feed', name: '少数派' },
      { url: 'https://www.ifanr.com/feed', name: '爱范儿' },
      { url: 'https://www.geekpark.net/rss', name: '极客公园' },
      { url: 'https://www.leiphone.com/feed', name: '雷锋网' },
      { url: 'https://www.tmtpost.com/rss', name: '钛媒体' },
      { url: 'https://www.infoq.cn/feed', name: 'InfoQ 中文' },
      { url: 'https://www.oschina.net/news/rss', name: '开源中国' },
      { url: 'https://www.ruanyifeng.com/blog/atom.xml', name: '阮一峰的网络日志' },
      { url: 'https://tech.meituan.com/feed/', name: '美团技术团队' },
      { url: 'https://www.appinn.com/feed/', name: '小众软件' },
      { url: 'https://www.iplaysoft.com/feed', name: '异次元' },
    ],
  },
  {
    group: '社区',
    items: [
      { url: 'https://www.v2ex.com/index.xml', name: 'V2EX' },
      { url: 'https://www.solidot.org/index.rss', name: 'Solidot' },
      { url: 'https://news.ycombinator.com/rss', name: 'Hacker News' },
      { url: 'https://lobste.rs/rss', name: 'Lobsters' },
    ],
  },
  {
    group: '海外科技',
    items: [
      { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge' },
      { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica' },
      { url: 'https://techcrunch.com/feed/', name: 'TechCrunch' },
      { url: 'https://feed.infoq.com/', name: 'InfoQ' },
      { url: 'https://github.blog/feed/', name: 'GitHub Blog' },
      { url: 'https://blog.cloudflare.com/rss/', name: 'Cloudflare Blog' },
    ],
  },
  {
    group: '新闻',
    items: [
      { url: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml', name: 'BBC 中文' },
      { url: 'https://cn.nytimes.com/rss/', name: '纽约时报中文网' },
      { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World' },
    ],
  },
];

// 默认勾选:都实测过在境内 / 境外两条线都能取到(2026-10)
const DEFAULT_FEEDS = [
  { url: 'https://www.ithome.com/rss/', name: 'IT之家' },
  { url: 'https://sspai.com/feed', name: '少数派' },
  { url: 'https://www.ifanr.com/feed', name: '爱范儿' },
  { url: 'https://www.geekpark.net/rss', name: '极客公园' },
  { url: 'https://www.solidot.org/index.rss', name: 'Solidot' },
];

let selected = loadSelected();
let staged = null;
let loading = false;
let inited = false;

const listEl = document.getElementById('rssList');

// ===== 持久化 =====
function loadSelected() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDS_KEY) || 'null');
    if (Array.isArray(raw) && raw.length) return raw.filter(f => f && f.url);
  } catch (_) {}
  return DEFAULT_FEEDS.map(f => ({ ...f }));
}
const saveSelected = () => { try { localStorage.setItem(FEEDS_KEY, JSON.stringify(selected)); } catch (_) {} };
const presetName = (url) => {
  for (const g of PRESETS) { const hit = g.items.find(i => i.url === url); if (hit) return hit.name; }
  return '';
};

// ===== 渲染 =====
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return new Date(ts).toISOString().slice(0, 10);
}

function renderItems(items, feeds) {
  listEl.innerHTML = '';
  if (!items.length) {
    listEl.innerHTML = '<div class="hot-panel-loading">没有拿到条目,试试「管理订阅」换几个源</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of items.slice(0, MAX_ITEMS)) {
    const a = document.createElement('a');
    a.className = 'rss-item';
    a.href = it.link || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const src = document.createElement('span');
    src.className = 'rss-source';
    src.textContent = presetName(it.feed) || it.source || '';   // 预设源用短名,自定义源用 feed 自己的标题

    const title = document.createElement('span');
    title.className = 'rss-title';
    title.textContent = it.title;

    const time = document.createElement('span');
    time.className = 'rss-time';
    time.textContent = timeAgo(it.time);

    a.append(src, title, time);
    frag.appendChild(a);
  }
  listEl.appendChild(frag);

  const ok = (feeds || []).filter(f => f.ok).length;
  const total = (feeds || []).length;
  const meta = document.getElementById('rssMeta');
  if (meta) meta.textContent = total ? `${ok}/${total} 个源正常` : '';
}

// ===== 拉取 =====
export async function loadRss() {
  if (!listEl || loading) return;
  if (!selected.length) {
    listEl.innerHTML = '<div class="hot-panel-loading">还没有订阅,点右上「管理订阅」挑几个</div>';
    return;
  }
  loading = true;
  try {
    const r = await fetchT('/api/rss', 20000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: selected.map(f => f.url) }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    renderItems(j.data?.items || [], j.data?.feeds || []);
  } catch (e) {
    listEl.innerHTML = '<div class="hot-panel-loading">订阅加载失败,稍后重试</div>';
  } finally {
    loading = false;
  }
}

// ===== 订阅管理弹窗 =====
const clone = (arr) => arr.map(f => ({ ...f }));

function openModal() {
  staged = clone(selected);
  document.getElementById('rssAddHint').textContent = '';
  document.getElementById('rssUrlInput').value = '';
  renderModal();
  document.getElementById('rssModal').classList.add('open');
}

const closeModal = () => document.getElementById('rssModal').classList.remove('open');

function renderModal() {
  const box = document.getElementById('rssPresets');
  box.innerHTML = '';
  for (const g of PRESETS) {
    const h = document.createElement('div');
    h.className = 'rss-group-label';
    h.textContent = g.group;
    box.appendChild(h);

    const wrap = document.createElement('div');
    wrap.className = 'rss-checks';
    for (const item of g.items) {
      const id = 'rss_' + encodeURIComponent(item.url).replace(/%/g, '');
      const label = document.createElement('label');
      label.className = 'rss-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = staged.some(f => f.url === item.url);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!staged.some(f => f.url === item.url)) staged.push({ url: item.url, name: item.name });
        } else {
          staged = staged.filter(f => f.url !== item.url);
        }
        renderCustomList();
      });
      const span = document.createElement('span');
      span.textContent = item.name;
      label.append(cb, span);
      label.htmlFor = id;
      cb.id = id;
      wrap.appendChild(label);
    }
    box.appendChild(wrap);
  }
  renderCustomList();
}

function renderCustomList() {
  const box = document.getElementById('rssCustomList');
  box.innerHTML = '';
  const custom = staged.filter(f => !presetName(f.url));
  if (!custom.length) {
    box.innerHTML = '<div class="rss-empty">还没有自定义源</div>';
    return;
  }
  for (const f of custom) {
    const row = document.createElement('div');
    row.className = 'rss-custom-row';
    const name = document.createElement('span');
    name.className = 'rss-custom-name';
    name.textContent = f.name || f.url;
    const url = document.createElement('span');
    url.className = 'rss-custom-url';
    url.textContent = f.url;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rss-custom-del';
    del.textContent = '×';
    del.setAttribute('aria-label', '移除');
    del.addEventListener('click', () => {
      staged = staged.filter(x => x.url !== f.url);
      // 预设源被移除时同步取消勾选
      renderModal();
    });
    row.append(name, url, del);
    box.appendChild(row);
  }
}

async function addCustom() {
  const input = document.getElementById('rssUrlInput');
  const hint = document.getElementById('rssAddHint');
  let url = input.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (staged.some(f => f.url === url)) { hint.textContent = '这个地址已经加过了'; return; }
  hint.textContent = '检查中…';
  try {
    const r = await fetchT('/api/rss/feed?url=' + encodeURIComponent(url), 20000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const title = j.data?.title || url;
    staged.push({ url, name: title });
    input.value = '';
    hint.textContent = `已添加:${title}`;
    renderModal();
  } catch (e) {
    hint.textContent = '取不到这个地址的条目,检查一下是不是 RSS/Atom';
  }
}

function saveModal() {
  if (!staged.length) {
    document.getElementById('rssAddHint').textContent = '至少留一个源';
    return;
  }
  selected = clone(staged);
  saveSelected();
  closeModal();
  loadRss();
}

// ===== 初始化 =====
export function initRss() {
  if (inited || !listEl) return;
  inited = true;
  document.getElementById('rssManageBtn').addEventListener('click', openModal);
  document.getElementById('rssRefreshBtn').addEventListener('click', loadRss);
  document.getElementById('rssCancel').addEventListener('click', closeModal);
  document.getElementById('rssSave').addEventListener('click', saveModal);
  document.getElementById('rssAddBtn').addEventListener('click', addCustom);
  document.getElementById('rssUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustom(); }
  });
  document.getElementById('rssModal').addEventListener('click', (e) => {
    if (e.target.id === 'rssModal') closeModal();
  });
}
