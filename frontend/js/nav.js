// 网站导航分组(可编辑)+ 添加/编辑/删除弹窗
import { faviconUrl } from './api.js';

const DEFAULT_NAV = [
  { id:'china', title:'中国媒体社区', sites:[
    {name:'微博',   url:'https://weibo.com'},
    {name:'知乎',   url:'https://zhihu.com'},
    {name:'B站',    url:'https://bilibili.com'},
    {name:'小红书', url:'https://xiaohongshu.com'},
    {name:'豆瓣',   url:'https://douban.com'},
    {name:'虎扑',   url:'https://hupu.com'},
    {name:'澎湃',   url:'https://thepaper.cn'},
    {name:'头条',   url:'https://toutiao.com'},
  ]},
  { id:'work', title:'工作与 AI', sites:[
    {name:'ChatGPT', url:'https://chat.openai.com'},
    {name:'Claude',  url:'https://claude.ai'},
    {name:'Gemini',  url:'https://gemini.google.com'},
    {name:'Grok',    url:'https://grok.com'},
    {name:'GitHub',  url:'https://github.com'},
    {name:'Notion',  url:'https://notion.so'},
    {name:'Figma',   url:'https://figma.com'},
    {name:'Slack',   url:'https://slack.com'},
  ]},
  { id:'social', title:'国外社交媒体', sites:[
    {name:'X',         url:'https://x.com'},
    {name:'Instagram', url:'https://instagram.com'},
    {name:'YouTube',   url:'https://youtube.com'},
    {name:'Facebook',  url:'https://facebook.com'},
    {name:'TikTok',    url:'https://tiktok.com'},
    {name:'LinkedIn',  url:'https://linkedin.com'},
    {name:'Reddit',    url:'https://reddit.com'},
    {name:'Discord',   url:'https://discord.com'},
  ]},
];

let navGroups = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('navGroups'));
    if (Array.isArray(s) && s.length) {
      const valid = s.filter(g =>
        g && typeof g.id === 'string' && typeof g.title === 'string' &&
        Array.isArray(g.sites)
      ).map(g => ({
        id: g.id,
        title: g.title.slice(0, 100),
        sites: g.sites.filter(site =>
          site && typeof site.name === 'string' && typeof site.url === 'string'
        ).map(site => ({
          name: site.name.slice(0, 100),
          url: site.url.slice(0, 500),
        })),
      }));
      if (valid.length) return valid;
    }
  } catch {}
  return DEFAULT_NAV;
})();
function saveNav() { localStorage.setItem('navGroups', JSON.stringify(navGroups)); }
function getFavicon(url) { try { return faviconUrl(new URL(url).hostname); } catch { return ''; } }

let editingGroupId = null;
let siteEditIdx    = { gIdx:-1, sIdx:-1 };
let groupEditIdx   = -1;

export function renderNavGroups() {
  const container = document.getElementById('navGroups'); container.innerHTML = '';
  navGroups.forEach((group, gIdx) => {
    const isEditing = editingGroupId === group.id;
    const sec = document.createElement('div'); sec.className = 'nav-group';

    const header = document.createElement('div'); header.className = 'nav-group-header';

    const titleWrap = document.createElement('span');
    titleWrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
    const titleEl = document.createElement('span'); titleEl.className = 'nav-group-title'; titleEl.textContent = group.title;
    titleWrap.appendChild(titleEl);

    if (isEditing) {
      const renameBtn = document.createElement('span');
      renameBtn.className = 'nav-group-edit-btn';
      renameBtn.style.cssText = 'font-size:10px;padding:1px 5px;';
      renameBtn.textContent = '重命名';
      renameBtn.addEventListener('click', () => openGroupModal(gIdx));
      titleWrap.appendChild(renameBtn);

      const delGroupBtn = document.createElement('span');
      delGroupBtn.className = 'nav-group-edit-btn';
      delGroupBtn.style.cssText = 'font-size:10px;padding:1px 5px;color:#d93025;';
      delGroupBtn.textContent = '删除分组';
      delGroupBtn.addEventListener('click', () => {
        if (!confirm(`确定删除分组「${group.title}」及其所有网站?`)) return;
        navGroups.splice(gIdx, 1);
        if (editingGroupId === group.id) editingGroupId = null;
        saveNav(); renderNavGroups();
      });
      titleWrap.appendChild(delGroupBtn);
    }

    const editBtn = document.createElement('span'); editBtn.className = 'nav-group-edit-btn';
    editBtn.textContent = isEditing ? '完成' : '编辑';
    editBtn.addEventListener('click', () => { editingGroupId = isEditing ? null : group.id; renderNavGroups(); });
    header.append(titleWrap, editBtn); sec.appendChild(header);

    const row = document.createElement('div'); row.className = 'nav-group-sites';
    group.sites.forEach((site, sIdx) => {
      const chip = document.createElement('div'); chip.className = 'site-chip' + (isEditing ? ' editing' : '');
      const fav = getFavicon(site.url);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = site.name;
      chip.appendChild(nameSpan);
      if (fav) {
        const favImg = document.createElement('img');
        favImg.src = fav; favImg.loading = 'lazy'; favImg.width = 16; favImg.height = 16;
        favImg.onerror = function() { this.style.display = 'none'; };
        chip.insertBefore(favImg, chip.firstChild);
      }
      if (isEditing) {
        const rm = document.createElement('span'); rm.className = 'site-remove'; rm.textContent = '×';
        rm.addEventListener('click', e => { e.stopPropagation(); navGroups[gIdx].sites.splice(sIdx,1); saveNav(); renderNavGroups(); });
        chip.appendChild(rm);
        chip.addEventListener('click', () => openSiteModal(gIdx, sIdx, site));
      } else {
        chip.addEventListener('click', () => window.open(site.url, '_blank', 'noopener'));
      }
      row.appendChild(chip);
    });

    if (isEditing) {
      const addBtn = document.createElement('div'); addBtn.className = 'site-add-chip';
      addBtn.textContent = '+ 添加'; addBtn.addEventListener('click', () => openSiteModal(gIdx, -1, null));
      row.appendChild(addBtn);
    }
    sec.appendChild(row);
    container.appendChild(sec);
    if (gIdx < navGroups.length - 1) { const div = document.createElement('div'); div.className='nav-group-divider'; container.appendChild(div); }
  });

  const addGroupDiv = document.createElement('div');
  addGroupDiv.style.cssText = 'margin-top:4px;';
  const addGroupBtn = document.createElement('span');
  addGroupBtn.className = 'nav-group-edit-btn';
  addGroupBtn.style.cssText = 'font-size:12px;padding:3px 10px;border:1px dashed #c5d8fc;border-radius:6px;';
  addGroupBtn.textContent = '+ 新增分组';
  addGroupBtn.addEventListener('click', () => openGroupModal(-1));
  addGroupDiv.appendChild(addGroupBtn);
  container.appendChild(addGroupDiv);
}

function openSiteModal(gIdx, sIdx, site) {
  siteEditIdx = { gIdx, sIdx };
  document.getElementById('siteModalTitle').textContent = sIdx === -1 ? '添加网站' : '编辑网站';
  document.getElementById('siteName').value = site?.name || '';
  document.getElementById('siteUrl').value  = site?.url  || 'https://';
  document.getElementById('siteModal').classList.add('open');
  setTimeout(() => document.getElementById('siteName').focus(), 50);
}

function openGroupModal(gIdx) {
  groupEditIdx = gIdx;
  document.getElementById('groupModalTitle').textContent = gIdx === -1 ? '新增分组' : '重命名分组';
  document.getElementById('groupName').value = gIdx === -1 ? '' : navGroups[gIdx].title;
  document.getElementById('groupModal').classList.add('open');
  setTimeout(() => document.getElementById('groupName').focus(), 50);
}

export function initNavModule() {
  document.getElementById('groupCancel').addEventListener('click', () =>
    document.getElementById('groupModal').classList.remove('open'));
  document.getElementById('groupModal').addEventListener('click', e => {
    if (e.target === document.getElementById('groupModal')) e.target.classList.remove('open');
  });
  document.getElementById('groupSaveBtn').addEventListener('click', () => {
    const name = document.getElementById('groupName').value.trim();
    if (!name) return;
    if (groupEditIdx === -1) {
      navGroups.push({ id: 'g' + Date.now(), title: name, sites: [] });
    } else {
      navGroups[groupEditIdx].title = name;
    }
    saveNav(); renderNavGroups();
    document.getElementById('groupModal').classList.remove('open');
  });

  document.getElementById('siteCancel').addEventListener('click', () =>
    document.getElementById('siteModal').classList.remove('open'));
  document.getElementById('siteModal').addEventListener('click', e => {
    if (e.target === document.getElementById('siteModal')) e.target.classList.remove('open');
  });
  document.getElementById('siteSaveBtn').addEventListener('click', () => {
    const name = document.getElementById('siteName').value.trim().slice(0, 100);
    let   url  = document.getElementById('siteUrl').value.trim();
    if (!name || !url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let validUrl;
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) {
        alert('网址必须是 http:// 或 https://');
        return;
      }
      validUrl = u.href;
    } catch {
      alert('网址格式无效');
      return;
    }
    const { gIdx, sIdx } = siteEditIdx;
    if (sIdx === -1) navGroups[gIdx].sites.push({ name, url: validUrl });
    else             navGroups[gIdx].sites[sIdx] = { name, url: validUrl };
    saveNav(); renderNavGroups();
    document.getElementById('siteModal').classList.remove('open');
  });
}
