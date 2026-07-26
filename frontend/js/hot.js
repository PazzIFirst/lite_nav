// 热榜面板 —— 四个固定槽位(左上/左下/右上/右下),每个槽位放哪个榜由用户设置
import { apiGet, srcTooltip, safeHttpUrl, faviconUrl } from './api.js';

const SLOT_KEY = 'hotSlots';
// 槽位顺序即渲染顺序:左侧栏取 0/1,右侧栏取 2/3
const SLOT_LABELS = ['左上', '左下', '右上', '右下'];
const DEFAULT_SLOTS = ['zhihu', 'weibo', 'baidu', 'bili'];

// /api/hot/catalog 拉不到时的兜底目录 —— 保证默认四个榜仍能显示
const FALLBACK_CATALOG = [
  { id: 'zhihu', title: '知乎热榜', link: 'https://www.zhihu.com/hot' },
  { id: 'weibo', title: '微博热搜', link: 'https://weibo.com/hot/search' },
  { id: 'baidu', title: '百度热搜', link: 'https://top.baidu.com/board?tab=realtime' },
  { id: 'bili',  title: 'B站热榜', link: 'https://www.bilibili.com/v/popular/rank' },
];

let catalog = FALLBACK_CATALOG;

function metaOf(id) {
  return catalog.find(c => c.id === id) || null;
}

export function getSlots() {
  try {
    const raw = JSON.parse(localStorage.getItem(SLOT_KEY));
    if (Array.isArray(raw)) {
      // 定长 4;非法 id(如目录里已删除的榜)按空槽处理
      return Array.from({ length: 4 }, (_, i) =>
        typeof raw[i] === 'string' && metaOf(raw[i]) ? raw[i] : '');
    }
  } catch (_) {}
  return [...DEFAULT_SLOTS];
}

function saveSlots(slots) {
  try { localStorage.setItem(SLOT_KEY, JSON.stringify(slots)); } catch (_) {}
}

// 从榜单主页链接取域名 → 走后端 favicon 代理(F-014:不向各站点直接发请求)
function iconFor(link) {
  try { return faviconUrl(new URL(link).hostname); } catch { return ''; }
}

// slotIndex 决定 DOM id,而非榜单 id —— 这样同一个榜放进两个槽位也不会撞 id
async function loadSlot(slotIndex) {
  const listEl   = document.getElementById('hot-slot' + slotIndex + '-list');
  const sourceEl = document.getElementById('hot-slot' + slotIndex + '-source');
  if (!listEl) return;

  const id = getSlots()[slotIndex];
  const meta = metaOf(id);
  if (!meta) return;

  listEl.innerHTML = '<div class="hot-panel-loading">加载中…</div>';

  // 普通 GET 读取(后端 cron 定期刷新缓存,冷门榜由后端按需拉取)。
  // 强制重拉是 token 保护的管理接口,不暴露给浏览器,故刷新按钮只做重新加载。
  let payload = null;
  try {
    payload = await apiGet('/api/hot/' + encodeURIComponent(meta.id));
  } catch {
    listEl.innerHTML = '<div class="hot-panel-loading" style="cursor:pointer">加载失败,点击重试</div>';
    listEl.firstChild.addEventListener('click', () => loadSlot(slotIndex));
    return;
  }

  const items = Array.isArray(payload?.data) ? payload.data : [];
  if (sourceEl) {
    sourceEl.textContent = payload?.source_label ? '· ' + payload.source_label : '';
    sourceEl.title = srcTooltip(payload);
  }

  if (!items.length || !items[0]?.title || items[0]?.title === '(暂无数据)') {
    listEl.innerHTML = '<div class="hot-panel-loading" style="cursor:pointer">暂无数据,点击重试</div>';
    listEl.firstChild.addEventListener('click', () => loadSlot(slotIndex));
    return;
  }

  listEl.innerHTML = '';
  items.slice(0, 15).forEach((item, i) => {
    const a = document.createElement('a');
    a.className = 'hot-item';
    a.href = safeHttpUrl(item.url || meta.link, meta.link);
    a.target = '_blank';
    a.rel = 'noopener';

    const rank = document.createElement('span');
    rank.className = 'hot-rank' + (i===0?' top1':i===1?' top2':i===2?' top3':'');
    rank.textContent = i + 1;

    const title = document.createElement('span');
    title.className = 'hot-title';
    title.textContent = item.title;

    a.append(rank, title);
    listEl.appendChild(a);
  });
}

function createHotPanel(slotIndex, meta) {
  const panel = document.createElement('div');
  panel.className = 'hot-panel';
  panel.id = 'hot-slot' + slotIndex + '-panel';

  const header = document.createElement('div');
  header.className = 'hot-panel-header';

  const titleWrap = document.createElement('a');
  titleWrap.href = meta.link;
  titleWrap.target = '_blank';
  titleWrap.rel = 'noopener';
  titleWrap.style.cssText = 'display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit;';

  const iconUrl = iconFor(meta.link);
  if (iconUrl) {
    const img = document.createElement('img');
    img.src = iconUrl;
    img.width = 14; img.height = 14;
    img.style.cssText = 'border-radius:3px;flex-shrink:0;';
    img.onerror = () => img.style.display = 'none';
    titleWrap.appendChild(img);
  }

  const title = document.createElement('span');
  title.className = 'hot-panel-title';
  title.textContent = meta.title;
  titleWrap.appendChild(title);

  const srcLabel = document.createElement('span');
  srcLabel.id = 'hot-slot' + slotIndex + '-source';
  srcLabel.className = 'hot-panel-source';

  const refreshBtn = document.createElement('span');
  refreshBtn.className = 'hot-panel-refresh';
  refreshBtn.textContent = '刷新';
  refreshBtn.title = '重新加载热榜';
  refreshBtn.addEventListener('click', () => loadSlot(slotIndex));

  const leftWrap = document.createElement('span');
  leftWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;';
  leftWrap.append(titleWrap, srcLabel);

  header.append(leftWrap, refreshBtn);
  panel.appendChild(header);

  const list = document.createElement('div');
  list.id = 'hot-slot' + slotIndex + '-list';
  list.innerHTML = '<div class="hot-panel-loading">加载中…</div>';
  panel.appendChild(list);

  return panel;
}

// 按当前槽位设置重建两侧面板并加载
function renderHotPanels() {
  const leftSidebar  = document.getElementById('leftSidebar');
  const rightSidebar = document.getElementById('rightSidebar');
  leftSidebar.innerHTML = '';
  rightSidebar.innerHTML = '';

  const slots = getSlots();
  slots.forEach((id, i) => {
    const meta = metaOf(id);
    if (!meta) return;                                  // 空槽 → 该位置不显示
    const panel = createHotPanel(i, meta);
    (i < 2 ? leftSidebar : rightSidebar).appendChild(panel);
    loadSlot(i);
  });
}

// 供 main.js 轮询调用:只刷新当前显示中的面板
export function refreshAllHotPanels() {
  getSlots().forEach((id, i) => { if (metaOf(id)) loadSlot(i); });
}

export async function initHotLists() {
  try {
    const r = await apiGet('/api/hot/catalog');
    if (Array.isArray(r?.data) && r.data.length) catalog = r.data;
  } catch {
    // 目录接口不可用时沿用兜底目录,默认四个榜照常显示
  }
  renderHotPanels();
}

// ===== 设置弹窗 =====

function openHotModal() {
  const slots = getSlots();
  const box = document.getElementById('hotSlots');
  box.innerHTML = '';

  SLOT_LABELS.forEach((label, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

    const tag = document.createElement('span');
    tag.style.cssText = 'font-size:11px;color:var(--text-secondary);width:36px;flex-shrink:0;';
    tag.textContent = label;

    const select = document.createElement('select');
    select.className = 'modal-input';
    select.dataset.slot = i;
    select.style.flex = '1';

    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = '— 不显示 —';
    select.appendChild(empty);

    for (const c of catalog) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.title;
      if (slots[i] === c.id) opt.selected = true;
      select.appendChild(opt);
    }

    row.append(tag, select);
    box.appendChild(row);
  });

  document.getElementById('hotModal').classList.add('open');
}

export function initHotSettings() {
  const modal = document.getElementById('hotModal');
  document.getElementById('hotSettingsBtn').addEventListener('click', openHotModal);
  document.getElementById('hotCancel').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });

  document.getElementById('hotReset').addEventListener('click', () => {
    saveSlots([...DEFAULT_SLOTS]);
    modal.classList.remove('open');
    renderHotPanels();
  });

  document.getElementById('hotSave').addEventListener('click', () => {
    const selects = document.querySelectorAll('#hotSlots select');
    const slots = ['', '', '', ''];
    for (const s of selects) slots[Number(s.dataset.slot)] = s.value || '';
    saveSlots(slots);
    modal.classList.remove('open');
    renderHotPanels();
  });
}
