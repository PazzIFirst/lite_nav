// Feed HTML 只在惰性 template 中解析,绝不把原节点/原属性放进页面。
// 展开时仅重建以下阅读元素,图片与链接单独验证 URL。
const BLOCKED = 'script,style,noscript,iframe,object,embed,form,input,button,textarea,select,option,link,meta,base,svg,math,video,audio,canvas,template,head';
const ALLOWED = new Set(['P','DIV','SECTION','ARTICLE','SPAN','BR','HR','STRONG','B','EM','I','U','S','DEL','SUP','SUB','UL','OL','LI','BLOCKQUOTE','PRE','CODE','H1','H2','H3','H4','H5','H6','A','IMG','FIGURE','FIGCAPTION','TABLE','THEAD','TBODY','TR','TH','TD']);
const MAX_INPUT = 80000;
const MAX_NODES = 3000;

export function rssHttpUrl(value, base = location.href) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) return '';
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function imageInfo(node, base) {
  const width = Number(node.getAttribute('width'));
  const height = Number(node.getAttribute('height'));
  if ((width > 0 && width <= 2) || (height > 0 && height <= 2) || node.hasAttribute('hidden')) return null;
  // data-src 常用于延迟图片;不接受 data: 占位图与源 HTML 中的 srcset。
  for (const attr of ['data-src','data-original','src']) {
    const url = rssHttpUrl(node.getAttribute(attr), base);
    if (url) return { url, alt: (node.getAttribute('alt') || '').slice(0, 200), width, height };
  }
  return null;
}

export function createRssImage(info, thumbnail = false) {
  const img = document.createElement('img');
  img.className = thumbnail ? 'rss-thumbnail' : 'rss-body-image';
  img.alt = info.alt || (thumbnail ? '' : '文章配图');
  img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  if (info.width > 2 && info.height > 2 && info.width <= 16000 && info.height <= 16000) {
    img.width = info.width; img.height = info.height;
  }
  img.addEventListener('error', () => {
    if (thumbnail) img.remove();
    else {
      const note = document.createElement('span'); note.className = 'rss-image-fallback';
      note.textContent = '配图暂时无法显示,可前往原文查看'; img.replaceWith(note);
    }
  }, { once: true });
  img.src = info.url;
  return img;
}

export function prepareRssContent(item) {
  const base = rssHttpUrl(item.contentBase) || rssHttpUrl(item.link) || rssHttpUrl(item.feed) || location.href;
  const raw = typeof item.content === 'string' ? item.content.slice(0, MAX_INPUT) : '';
  const template = document.createElement('template');
  if (item.contentFormat === 'text') {
    for (const para of raw.split(/\n\s*\n/)) {
      if (!para.trim()) continue;
      const p = document.createElement('p'); p.textContent = para; template.content.appendChild(p);
    }
  } else {
    template.innerHTML = raw; // 惰性文档,随后完全按白名单重建。
    template.content.querySelectorAll(BLOCKED).forEach(node => node.remove());
    template.content.querySelectorAll('[hidden]').forEach(node => node.remove());
  }
  template.content.querySelectorAll('p,div,section,article,li,h1,h2,h3,h4,h5,h6,br,blockquote').forEach(node => node.after(document.createTextNode(' ')));
  const text = template.content.textContent.replace(/\s+/g, ' ').trim();
  const summary = typeof item.summary === 'string' ? item.summary.trim().slice(0, 4000) : '';
  const excerpt = (summary.length >= 32 ? summary : text || summary).replace(/\s+/g, ' ').trim();
  const images = [...template.content.querySelectorAll('img')].map(img => imageInfo(img, base)).filter(Boolean);
  const enclosure = rssHttpUrl(item.image, base);
  const cover = images[0] || (enclosure ? { url: enclosure, alt: '', width: 0, height: 0 } : null);
  const canExpand = !!(text || excerpt || images.length || enclosure);
  const hasMore = text.length > excerpt.length + 20 || images.length > 0 || !!enclosure;

  const build = () => {
    let nodes = 0;
    let depthLimited = false;
    const copy = (node, depth = 0) => {
      if (++nodes > MAX_NODES) return null;
      if (depth > 40) { depthLimited = true; return null; }
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || node.matches(BLOCKED)) return null;
      if (node.tagName === 'IMG') {
        const info = imageInfo(node, base); return info ? createRssImage(info) : null;
      }
      const tag = node.tagName;
      const allowed = ALLOWED.has(tag);
      let el = allowed ? document.createElement(/^H[1-6]$/.test(tag) ? 'h4' : ['SECTION','ARTICLE'].includes(tag) ? 'div' : tag.toLowerCase()) : document.createDocumentFragment();
      if (tag === 'A') {
        const url = rssHttpUrl(node.getAttribute('href'), base);
        if (url) { el.href = url; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
        else el = document.createElement('span');
      }
      for (const child of node.childNodes) { const clean = copy(child, depth + 1); if (clean) el.appendChild(clean); }
      return el;
    };
    const result = document.createDocumentFragment();
    for (const child of template.content.childNodes) { const clean = copy(child); if (clean) result.appendChild(clean); }
    if (!text && !images.length && excerpt) { const p = document.createElement('p'); p.textContent = excerpt; result.appendChild(p); }
    if (enclosure && !images.some(img => img.url === enclosure)) result.appendChild(createRssImage({url:enclosure,alt:'',width:0,height:0}));
    if (item.contentTruncated || nodes > MAX_NODES || depthLimited) {
      const note = document.createElement('p'); note.className = 'rss-content-note';
      note.textContent = '订阅内容较长,余下部分可在原文阅读。'; result.appendChild(note);
    }
    return result;
  };
  return { excerpt, cover, canExpand, hasMore, build };
}
