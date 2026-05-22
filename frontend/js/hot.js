// 热榜面板(知乎/微博/百度/B 站)
import { apiGet, srcTooltip, safeHttpUrl } from './api.js';

export const HOT_SOURCES = [
  { id:'zhihu', title:'知乎热榜', side:'left',  link:'https://www.zhihu.com/hot',                icon:'https://zhihu.com/favicon.ico' },
  { id:'weibo', title:'微博热搜', side:'left',  link:'https://weibo.com/hot/search',             icon:'https://weibo.com/favicon.ico' },
  { id:'baidu', title:'百度热搜', side:'right', link:'https://top.baidu.com/board?tab=realtime', icon:'https://baidu.com/favicon.ico' },
  { id:'bili',  title:'B站热榜', side:'right', link:'https://www.bilibili.com/v/popular/rank',  icon:'https://bilibili.com/favicon.ico' },
];

export async function loadHotList(source) {
  const listEl   = document.getElementById('hot-' + source.id + '-list');
  const sourceEl = document.getElementById('hot-' + source.id + '-source');
  if (!listEl) return;
  listEl.innerHTML = '<div class="hot-panel-loading">加载中…</div>';

  // 普通 GET 读取(后端 cron 定期刷新缓存)。强制重拉是 token 保护的管理接口,
  // 不暴露给浏览器,故刷新按钮只做重新加载。
  let payload = null;
  try {
    payload = await apiGet('/api/hot/' + source.id);
  } catch {
    listEl.innerHTML = `<div class="hot-panel-loading" style="cursor:pointer" data-retry="${source.id}">加载失败,点击重试</div>`;
    listEl.querySelector('[data-retry]')?.addEventListener('click', () => loadHotList(source));
    return;
  }

  const items = Array.isArray(payload?.data) ? payload.data : [];
  if (sourceEl) {
    sourceEl.textContent = payload?.source_label ? '· ' + payload.source_label : '';
    sourceEl.title = srcTooltip(payload);
  }

  if (!items.length || !items[0]?.title || items[0]?.title === '(暂无数据)') {
    listEl.innerHTML = `<div class="hot-panel-loading" style="cursor:pointer" data-retry="${source.id}">暂无数据,点击重试</div>`;
    listEl.querySelector('[data-retry]')?.addEventListener('click', () => loadHotList(source, true));
    return;
  }

  listEl.innerHTML = '';
  items.slice(0, 15).forEach((item, i) => {
    const a = document.createElement('a');
    a.className = 'hot-item';
    a.href = safeHttpUrl(item.url || source.link, source.link);
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

function createHotPanel(source) {
  const panel = document.createElement('div');
  panel.className = 'hot-panel';
  panel.id = 'hot-' + source.id + '-panel';

  const header = document.createElement('div');
  header.className = 'hot-panel-header';

  const titleWrap = document.createElement('a');
  titleWrap.href = source.link;
  titleWrap.target = '_blank';
  titleWrap.rel = 'noopener';
  titleWrap.style.cssText = 'display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit;';

  if (source.icon) {
    const img = document.createElement('img');
    img.src = source.icon;
    img.width = 14; img.height = 14;
    img.style.cssText = 'border-radius:3px;flex-shrink:0;';
    img.onerror = () => img.style.display = 'none';
    titleWrap.appendChild(img);
  }

  const title = document.createElement('span');
  title.className = 'hot-panel-title';
  title.textContent = source.title;
  titleWrap.appendChild(title);

  const srcLabel = document.createElement('span');
  srcLabel.id = 'hot-' + source.id + '-source';
  srcLabel.className = 'hot-panel-source';

  const refreshBtn = document.createElement('span');
  refreshBtn.className = 'hot-panel-refresh';
  refreshBtn.textContent = '刷新';
  refreshBtn.title = '重新加载热榜';
  refreshBtn.addEventListener('click', () => loadHotList(source));

  const leftWrap = document.createElement('span');
  leftWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;';
  leftWrap.append(titleWrap, srcLabel);

  header.append(leftWrap, refreshBtn);
  panel.appendChild(header);

  const list = document.createElement('div');
  list.id = 'hot-' + source.id + '-list';
  list.innerHTML = '<div class="hot-panel-loading">加载中…</div>';
  panel.appendChild(list);

  return panel;
}

export function initHotLists() {
  const leftSidebar  = document.getElementById('leftSidebar');
  const rightSidebar = document.getElementById('rightSidebar');

  for (const source of HOT_SOURCES) {
    const panel = createHotPanel(source);
    if (source.side === 'left') leftSidebar.appendChild(panel);
    else rightSidebar.appendChild(panel);
    loadHotList(source);
  }
}
