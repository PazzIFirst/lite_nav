// RSS 订阅：跨源交错、接近底部自动续读、支持源可用性检测。
import { PRESETS, DEFAULT_FEEDS } from './rss-presets.js';
import { mixRssItems } from './rss-flow.js';
import { fetchT } from './api.js';
import { prepareRssContent, createRssImage, rssHttpUrl } from './rss-content.js';

const FEEDS_KEY = 'nav.rss.feeds';
const MAX_ITEMS = 160;
const MAX_FEEDS = 20;
const PAGE_SIZE = 8;
const expandedItems = new Set();
const preparedContent = new WeakMap();
let currentItems = [], currentFeeds = [], shownCount = PAGE_SIZE, articleSerial = 0;
let foldViews = [], deferredItems = [];
let appendFrame = 0, reloadRequested = false;
let modalVersion = 0, adding = false;
const feedChecks = new Map(), pendingChecks = new Map();

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
const RSS_SYMBOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 10a9 9 0 0 1 9 9M5 4a15 15 0 0 1 15 15"/><circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/></svg>';
const EXTERNAL_ARROW = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 15 15 5M6 5h9v9"/></svg>';
const CHEVRON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';

function timeAgo(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return new Date(ts).toISOString().slice(0, 10);
}

function setMeta(text, status = '') {
  const meta = document.getElementById('rssMeta');
  if (!meta) return;
  meta.textContent = text;
  meta.dataset.status = status;
}

function renderState(title, detail, kind = 'empty') {
  foldViews = [];
  cancelAnimationFrame(appendFrame);
  document.getElementById('rssLoadStatus').textContent = '';
  document.getElementById('rssSourceOverflow').replaceChildren();
  const more = document.getElementById('rssMoreBtn');
  if (more) more.hidden = true;
  const state = document.createElement('div');
  state.className = 'rss-state';
  state.dataset.kind = kind;
  state.setAttribute('role', 'status');
  state.innerHTML = `<span class="rss-state-icon">${RSS_SYMBOL}</span><strong class="rss-state-title"></strong><p class="rss-state-detail"></p>`;
  state.querySelector('.rss-state-title').textContent = title;
  state.querySelector('.rss-state-detail').textContent = detail;
  listEl.replaceChildren(state);
}

function renderLoading() {
  const loading = document.createElement('div');
  loading.className = 'rss-loading';
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-label', '订阅加载中');
  for (let i = 0; i < 4; i++) {
    const row = document.createElement('div');
    row.className = 'rss-skeleton';
    row.setAttribute('aria-hidden', 'true');
    row.innerHTML = '<span class="rss-skeleton-title"></span><span class="rss-skeleton-detail"></span>';
    loading.appendChild(row);
  }
  listEl.replaceChildren(loading);
}

function sourceTone(feed) {
  let hash = 0;
  for (const ch of String(feed || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 4;
}

function refreshFoldButtons() {
  const changes = foldViews.filter(v => v.article.dataset.expanded !== 'true').map(v =>
    [v.button, !v.force && v.summary.scrollHeight <= v.summary.clientHeight + 1]);
  changes.forEach(([button, hidden]) => { button.hidden = hidden; });
}

function updateFooter() {
  const remaining = Math.max(0, currentItems.length - shownCount);
  const more = document.getElementById('rssMoreBtn');
  more.hidden = !remaining;
  more.textContent = `继续阅读 · 还有 ${remaining} 篇`;
  document.getElementById('rssLoadStatus').textContent = remaining
    ? `已呈现 ${Math.min(shownCount, currentItems.length)} 篇 · 下滑自动加载`
    : deferredItems.length ? '其余同源内容已合并，展开后可查看' : '本次更新已读到底';
  const overflow = document.getElementById('rssSourceOverflow');
  overflow.hidden = !!remaining || !deferredItems.length;
}

function renderOverflow() {
  const box = document.getElementById('rssSourceOverflow'); box.replaceChildren();
  if (!deferredItems.length) return;
  const details = document.createElement('details');
  const heading = document.createElement('summary');
  const source = presetName(deferredItems[0].feed) || deferredItems[0].source || '同一订阅源';
  heading.textContent = `${source} · 其余 ${deferredItems.length} 篇`;
  const note = document.createElement('p'); note.textContent = '已合并同源内容，换个节奏阅读。';
  details.append(heading, note);
  for (const item of deferredItems) {
    const url = rssHttpUrl(item.link);
    const link = document.createElement(url ? 'a' : 'span');
    link.textContent = item.title;
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    details.appendChild(link);
  }
  box.appendChild(details);
}

function checkNextBatch() {
  const more = document.getElementById('rssMoreBtn');
  if (loading || more.hidden || !more.getClientRects().length) return;
  const rect = more.getBoundingClientRect();
  if (rect.top < innerHeight + 700 && rect.bottom > -700) appendMore();
}

function appendMore() {
  if (loading || appendFrame || shownCount >= currentItems.length) return;
  appendFrame = requestAnimationFrame(() => {
    appendFrame = 0;
    if (loading) return;
    const stream = listEl.querySelector('.rss-day');
    if (!stream) return;
    const next = Math.min(shownCount + PAGE_SIZE, currentItems.length);
    const fragment = document.createDocumentFragment();
    for (const item of currentItems.slice(shownCount, next)) fragment.appendChild(createArticle(item));
    stream.appendChild(fragment);
    shownCount = next;
    updateFooter();
    refreshFoldButtons();
    requestAnimationFrame(checkNextBatch);
  });
}

function renderItems(items, feeds) {
  cancelAnimationFrame(appendFrame); appendFrame = 0;
  const mixed = mixRssItems(items.slice(0, MAX_ITEMS));
  currentItems = mixed.items;
  deferredItems = mixed.deferred;
  currentFeeds = feeds || [];
  const ok = currentFeeds.filter(f => f.ok).length, total = currentFeeds.length;
  setMeta(total && ok < total ? `${ok}/${total} 个源正常` : `${total ? total + ' 个订阅源 · ' : ''}${currentItems.length + deferredItems.length} 篇更新`, total && ok < total ? 'partial' : 'ok');
  if (!currentItems.length) {
    renderState('暂时没有新内容', '试试刷新，或在「管理订阅」中更换信息源。');
    return;
  }
  const anchor = [...listEl.querySelectorAll('.rss-item')].find(el => {
    const rect = el.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 16;
  });
  const anchorKey = anchor?.dataset.key, anchorTop = anchor?.getBoundingClientRect().top;
  foldViews = [];
  const stream = document.createElement('section'); stream.className = 'rss-day';
  stream.setAttribute('aria-label', '交错订阅内容');
  const heading = document.createElement('h3'); heading.className = 'rss-day-heading';
  heading.textContent = '最新内容'; stream.appendChild(heading);
  for (const item of currentItems.slice(0, shownCount)) stream.appendChild(createArticle(item));
  listEl.replaceChildren(stream);
  renderOverflow(); updateFooter();
  const present = new Set(currentItems.map(it => [it.feed, it.link, it.title].join('\n')));
  for (const key of expandedItems) if (!present.has(key)) expandedItems.delete(key);
  if (anchorKey) {
    const next = [...listEl.querySelectorAll('.rss-item')].find(el => el.dataset.key === anchorKey);
    if (next) window.scrollBy({top:next.getBoundingClientRect().top - anchorTop,behavior:'instant'});
  }
  requestAnimationFrame(refreshFoldButtons);
}

function createArticle(it) {
  const key = [it.feed, it.link, it.title].join('\n');
  const article = document.createElement('article'); article.className = 'rss-item'; article.dataset.key = key; article.dataset.feed = it.feed || it.source || 'unknown';
  const url = rssHttpUrl(it.link);
  const title = document.createElement('h4'); title.className = 'rss-article-title';
  const titleLink = document.createElement('a'); titleLink.className = 'rss-title';
  titleLink.textContent = it.title;
  if (url) { titleLink.href = url; titleLink.target = '_blank'; titleLink.rel = 'noopener noreferrer'; }
  title.appendChild(titleLink);

  const byline = document.createElement('div'); byline.className = 'rss-byline';
  const sourceName = presetName(it.feed) || it.source || '订阅源';
  const avatar = document.createElement('span'); avatar.className = 'rss-source-avatar';
  avatar.dataset.tone = sourceTone(it.feed); avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = /^[a-z]/i.test(sourceName) ? sourceName.slice(0, 2) : sourceName.slice(0, 1);
  const source = document.createElement('span'); source.className = 'rss-source-name'; source.textContent = sourceName; source.title = sourceName;
  byline.append(avatar, source);
  if (it.author && it.author !== sourceName) {
    const author = document.createElement('span'); author.className = 'rss-author'; author.textContent = it.author; author.title = it.author;
    byline.appendChild(author);
  }
  const collapse = document.createElement('button'); collapse.className = 'rss-collapse-top';
  collapse.type = 'button'; collapse.textContent = '收起'; byline.appendChild(collapse);

  let prepared = preparedContent.get(it);
  if (!prepared) { prepared = prepareRssContent(it); preparedContent.set(it, prepared); }
  const preview = document.createElement('div'); preview.className = 'rss-preview';
  if (prepared.cover) preview.appendChild(createRssImage(prepared.cover, true));
  const summary = document.createElement('p'); summary.className = 'rss-summary'; summary.textContent = prepared.excerpt;
  if (prepared.excerpt) preview.appendChild(summary);
  const body = document.createElement('div'); body.className = 'rss-content'; body.id = 'rss-content-' + (++articleSerial);
  const actions = document.createElement('div'); actions.className = 'rss-article-actions';
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'rss-expand';
  toggle.setAttribute('aria-controls', body.id); collapse.setAttribute('aria-controls', body.id);
  actions.appendChild(toggle);
  if (url) {
    const original = document.createElement('a'); original.className = 'rss-original';
    original.href = url; original.target = '_blank'; original.rel = 'noopener noreferrer';
    original.innerHTML = '阅读原文' + EXTERNAL_ARROW; actions.appendChild(original);
  }
  const time = document.createElement('time'); time.className = 'rss-time'; time.textContent = timeAgo(it.time);
  if (Number.isFinite(it.time) && it.time > 0 && !Number.isNaN(new Date(it.time).getTime())) time.dateTime = new Date(it.time).toISOString();
  actions.appendChild(time);
  let built = false;
  const setExpanded = (expanded, userAction = false) => {
    const top = article.getBoundingClientRect().top;
    if (expanded && !built) { body.appendChild(prepared.build()); built = true; }
    article.dataset.expanded = String(expanded);
    preview.hidden = expanded || (!prepared.excerpt && !prepared.cover); body.hidden = !expanded;
    collapse.hidden = !expanded;
    toggle.innerHTML = (expanded ? '收起' : '展开阅读') + CHEVRON;
    toggle.setAttribute('aria-expanded', String(expanded)); collapse.setAttribute('aria-expanded', String(expanded));
    toggle.hidden = !prepared.canExpand;
    if (expanded) expandedItems.add(key); else expandedItems.delete(key);
    if (userAction && !expanded && top < 0) {
      article.scrollIntoView({block:'start',behavior:'instant'});
      titleLink.focus({preventScroll:true});
    }
    if (userAction && !expanded) requestAnimationFrame(refreshFoldButtons);
  };
  toggle.addEventListener('click', () => setExpanded(article.dataset.expanded !== 'true', true));
  collapse.addEventListener('click', () => setExpanded(false, true));
  article.append(title, byline, preview, body, actions);
  foldViews.push({article, summary, button: toggle, force: prepared.hasMore});
  setExpanded(prepared.canExpand && expandedItems.has(key));
  return article;
}

// ===== 拉取 =====
export async function loadRss() {
  if (!listEl) return;
  if (loading) { reloadRequested = true; return; }
  if (!selected.length) {
    listEl.setAttribute('aria-busy', 'false');
    setMeta('关注你感兴趣的信息源');
    renderState('还没有订阅', '在「管理订阅」中选择你想关注的信息源。');
    return;
  }
  loading = true;
  const refresh = document.getElementById('rssRefreshBtn');
  if (refresh) refresh.disabled = true;
  const more = document.getElementById('rssMoreBtn');
  if (more) more.disabled = true;
  listEl.setAttribute('aria-busy', 'true');
  setMeta('正在更新订阅…', 'loading');
  if (!listEl.querySelector('.rss-item')) renderLoading();
  try {
    const r = await fetchT('/api/rss', 20000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: selected.map(f => f.url) }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!reloadRequested) renderItems(j.data?.items || [], j.data?.feeds || []);
  } catch (e) {
    if (reloadRequested) return;
    setMeta('更新失败', 'error');
    renderState('订阅暂时无法加载', '稍后刷新重试,或检查订阅源是否可用。', 'error');
  } finally {
    loading = false;
    if (refresh) refresh.disabled = false;
    if (more) more.disabled = false;
    listEl.setAttribute('aria-busy', 'false');
    if (reloadRequested) { reloadRequested = false; loadRss(); }
    else requestAnimationFrame(checkNextBatch);
  }
}

// ===== 订阅管理弹窗 =====
const clone = (arr) => arr.map(f => ({ ...f }));

function openModal() {
  modalVersion++; adding = false;
  document.getElementById('rssAddBtn').disabled = false;
  document.getElementById('rssSave').disabled = false;
  document.getElementById('rssPresetSearch').value = '';
  staged = clone(selected);
  document.getElementById('rssAddHint').textContent = '';
  document.getElementById('rssUrlInput').value = '';
  renderModal();
  document.getElementById('rssModal').classList.add('open');
}

const closeModal = () => {
  modalVersion++; staged = null;
  document.getElementById('rssModal').classList.remove('open');
};

function renderModal() {
  const box = document.getElementById('rssPresets');
  box.innerHTML = '';
  const query = document.getElementById('rssPresetSearch').value.trim().toLowerCase();
  for (const g of PRESETS) {
    const matches = g.items.filter(item => (g.group + ' ' + item.name + ' ' + item.url).toLowerCase().includes(query));
    if (!matches.length) continue;
    const h = document.createElement('h3');
    h.className = 'rss-group-label';
    h.textContent = g.group;
    box.appendChild(h);

    const wrap = document.createElement('div');
    wrap.className = 'rss-checks';
    for (const item of matches) {
      const id = 'rss_' + encodeURIComponent(item.url).replace(/%/g, '');
      const label = document.createElement('label');
      label.className = 'rss-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = staged.some(f => f.url === item.url);
      cb.addEventListener('change', () => {
        if (cb.checked && staged.length >= MAX_FEEDS) {
          cb.checked = false;
          document.getElementById('rssAddHint').textContent = '最多选择 20 个源，请先取消一个';
          return;
        }
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
  if (!box.childElementCount) box.innerHTML = '<p class="rss-empty">没有找到匹配的预设源</p>';
  renderCustomList();
}

function renderCustomList() {
  if (!staged) return;
  const summary = document.getElementById('rssSelectionCount');
  if (summary) summary.textContent = `已选 ${staged.length} / ${MAX_FEEDS} 个源`;
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
    url.title = f.url;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rss-custom-del';
    del.textContent = '×';
    del.setAttribute('aria-label', '移除 ' + (f.name || f.url));
    del.addEventListener('click', () => {
      staged = staged.filter(x => x.url !== f.url);
      // 预设源被移除时同步取消勾选
      renderModal();
    });
    const info = document.createElement('div');
    info.className = 'rss-custom-info';
    const state = feedChecks.get(f.url);
    const status = document.createElement('span'); status.className = 'rss-check-status';
    status.dataset.status = state?.status || 'unknown'; status.setAttribute('role', 'status');
    status.textContent = state?.status === 'checking' ? '正在检测…' : state?.status === 'ok'
      ? `可用 · ${state.count} 篇 · ${timeAgo(state.checkedAt)}检测`
      : state?.status === 'error' ? '暂不可用 · ' + state.message : '尚未检测';
    const check = document.createElement('button'); check.type = 'button'; check.className = 'rss-recheck';
    check.textContent = state?.status === 'checking' ? '检测中' : state?.status === 'error' ? '重试' : state ? '重新检测' : '检测';
    check.disabled = state?.status === 'checking';
    check.setAttribute('aria-label', '检测 ' + (f.name || f.url));
    check.addEventListener('click', () => { checkFeed(f.url).catch(() => {}); });
    const controls = document.createElement('div'); controls.className = 'rss-custom-controls';
    controls.append(check, del);
    info.append(name, url, status);
    row.append(info, controls);
    box.appendChild(row);
  }
}

function checkFeed(url) {
  if (pendingChecks.has(url)) return pendingChecks.get(url);
  feedChecks.set(url, {status:'checking'}); renderCustomList();
  const task = (async () => {
    try {
      const r = await fetchT('/api/rss/feed?refresh=1&url=' + encodeURIComponent(url), 20000);
      const j = await r.json();
      if (!r.ok) throw new Error(r.status === 429 ? '请求较频繁，稍后再试' : '无法取得 RSS / Atom 条目');
      if (!(j.data?.count > 0)) throw new Error('未发现可读条目');
      const state = {status:'ok', title:j.data.title || url, count:j.data.count, checkedAt:j.data.checkedAt || Date.now()};
      feedChecks.set(url, state);
      return state;
    } catch (error) {
      const message = error.name === 'AbortError' ? '连接超时，请稍后重试' : error.message === 'Failed to fetch' ? '网络连接失败' : error.message;
      feedChecks.set(url, {status:'error', message});
      throw error;
    } finally {
      pendingChecks.delete(url); renderCustomList();
    }
  })();
  pendingChecks.set(url, task);
  return task;
}

async function addCustom() {
  if (adding || !staged) return;
  const input = document.getElementById('rssUrlInput'), hint = document.getElementById('rssAddHint');
  let raw = input.value.trim();
  if (!raw) return;
  let url;
  try {
    if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) raw = 'https://' + raw;
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    parsed.hash = ''; url = parsed.href;
  } catch { hint.textContent = '请输入有效的 HTTP / HTTPS 订阅地址'; return; }
  if (staged.some(f => f.url === url)) { hint.textContent = '这个地址已经加过了，可在列表中重新检测'; return; }
  if (staged.length >= MAX_FEEDS) { hint.textContent = '最多选择 20 个源，请先取消一个'; return; }
  const session = modalVersion;
  adding = true;
  document.getElementById('rssAddBtn').disabled = true;
  document.getElementById('rssSave').disabled = true;
  hint.textContent = '正在连接并检测内容…';
  try {
    const result = await checkFeed(url);
    if (session !== modalVersion || !staged) return;
    if (staged.length >= MAX_FEEDS) { hint.textContent = '检测通过；已达到 20 个源，请先取消一个再添加'; return; }
    if (!staged.some(f => f.url === url)) staged.push({url, name:result.title});
    input.value = '';
    hint.textContent = `已添加 · 检测通过，发现 ${result.count} 篇内容`;
    renderModal();
  } catch {
    if (session === modalVersion) hint.textContent = '检测失败，未添加。请确认这是 RSS / Atom 地址，或稍后重试。';
  } finally {
    if (session === modalVersion) {
      adding = false;
      document.getElementById('rssAddBtn').disabled = false;
      document.getElementById('rssSave').disabled = false;
    }
  }
}

function saveModal() {
  if (adding || !staged) return;
  if (!staged.length) {
    document.getElementById('rssAddHint').textContent = '至少留一个源';
    return;
  }
  selected = clone(staged);
  shownCount = PAGE_SIZE;
  expandedItems.clear();
  saveSelected();
  closeModal();
  loadRss();
}

// ===== 初始化 =====
export function initRss() {
  if (inited || !listEl) return;
  inited = true;
  new ResizeObserver(refreshFoldButtons).observe(listEl);
  const more = document.getElementById('rssMoreBtn');
  more.addEventListener('click', appendMore);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) appendMore();
    }, {rootMargin:'700px 0px'});
    observer.observe(more);
  }
  document.getElementById('rssPresetSearch').addEventListener('input', renderModal);
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
