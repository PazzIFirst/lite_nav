// RSS/Atom 的内容解析。content 是不可信的源 HTML,只以 JSON 返回;
// 前端必须通过 rss-content.js 的 DOM 白名单重建后才能展示。
const MAX_ITEMS = 40;
const MAX_CONTENT = 80000;
const MAX_SUMMARY = 4000;

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo);/gi, (entity, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] || entity;
    const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
  });
}

// CDATA 内的 HTML 实体留给 HTML 解析器;CDATA 外只解除一层 XML 编码。
function decodeXml(raw) {
  const parts = String(raw || '').split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g);
  return parts.map(p => p.startsWith('<![CDATA[') ? p.slice(9, -3) : decodeEntities(p)).join('');
}

function plain(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(attrs, name) {
  const match = String(attrs || '').match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i'));
  return match ? decodeEntities(match[2]) : '';
}

function httpUrl(raw, base = '') {
  if (!raw || String(raw).length > 4096) return '';
  try {
    const url = new URL(String(raw).trim(), base || undefined);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function prepare(xml) {
  const chunks = [];
  // 避免 CDATA 中出现 </item>/<entry> 等文本时误切断文章。
  let prefix = '__RSS_CDATA_';
  while (String(xml).includes(prefix)) prefix += '_';
  const masked = String(xml).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, chunk => {
    const index = chunks.push(chunk) - 1;
    return prefix + index + '__';
  }).replace(/<!--[\s\S]*?-->/g, '');
  const restore = value => value.replace(new RegExp(prefix + '(\\d+)__', 'g'), (_, i) => chunks[Number(i)] || '');
  const field = (block, name) => {
    const tag = name.includes(':') ? name : '(?:[\\w.-]+:)?' + name;
    const match = block.match(new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)</' + tag + '\\s*>', 'i'));
    return match ? { value: decodeXml(restore(match[2])), attrs: match[1] } : { value: '', attrs: '' };
  };
  return { masked, field };
}

function atomLink(block, base) {
  for (const m of block.matchAll(/<(?:[\w.-]+:)?link\b([^>]*)\/?>/gi)) {
    const rel = attr(m[1], 'rel');
    if (rel && rel !== 'alternate') continue;
    const url = httpUrl(attr(m[1], 'href'), base);
    if (url) return url;
  }
  return '';
}

function enclosureImage(block, base) {
  for (const m of block.matchAll(/<(media:thumbnail|media:content|enclosure)\b([^>]*)\/?>/gi)) {
    if (m[1].toLowerCase() !== 'media:thumbnail' && !/^image\//i.test(attr(m[2], 'type')) && attr(m[2], 'medium') !== 'image') continue;
    const url = httpUrl(attr(m[2], 'url'), base);
    if (url) return url;
  }
  return '';
}

export function parseFeed(xml, feedUrl = '') {
  const { masked, field } = prepare(xml);
  const feedAttrs = masked.match(/<(?:[\w.-]+:)?(?:feed|channel|rss)\b([^>]*)>/i)?.[1] || '';
  const base = httpUrl(attr(feedAttrs, 'xml:base'), feedUrl) || feedUrl;
  const items = [];
  for (const match of masked.matchAll(/<(item|(?:[\w.-]+:)?entry)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    const isAtom = /(?:^|:)entry$/i.test(match[1]);
    const block = match[3];
    const itemBase = httpUrl(attr(match[2], 'xml:base'), base) || base;
    const title = plain(field(block, 'title').value).slice(0, 200);
    if (!title) continue;
    const link = isAtom ? atomLink(block, itemBase) || httpUrl(field(block, 'id').value, itemBase)
      : httpUrl(field(block, 'link').value, itemBase) || atomLink(block, itemBase);
    const summaryField = field(block, isAtom ? 'summary' : 'description');
    const bodyField = field(block, isAtom ? 'content' : 'content:encoded');
    const chosen = bodyField.value ? bodyField : summaryField;
    const contentFormat = isAtom && (!attr(chosen.attrs, 'type') || attr(chosen.attrs, 'type') === 'text') ? 'text' : 'html';
    const authorField = field(block, 'author').value;
    const author = plain(field(block, 'dc:creator').value || (isAtom ? field(authorField, 'name').value : authorField)).slice(0, 160);
    const date = field(block, isAtom ? 'published' : 'pubDate').value || field(block, isAtom ? 'updated' : 'dc:date').value;
    const timestamp = Date.parse(date);
    const summary = isAtom && (!attr(summaryField.attrs, 'type') || attr(summaryField.attrs, 'type') === 'text')
      ? summaryField.value.replace(/\s+/g, ' ').trim() : plain(summaryField.value);
    items.push({
      title, link, time: Number.isFinite(timestamp) ? timestamp : 0, author,
      summary: summary.slice(0, MAX_SUMMARY),
      content: chosen.value.slice(0, MAX_CONTENT), contentFormat,
      contentBase: httpUrl(attr(chosen.attrs, 'xml:base'), itemBase) || link || itemBase,
      contentTruncated: chosen.value.length > MAX_CONTENT,
      image: enclosureImage(block, link || itemBase),
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

export function feedTitle(xml) {
  const { masked, field } = prepare(xml);
  return plain(field(masked.split(/<(?:item|(?:[\w.-]+:)?entry)\b/i)[0], 'title').value).slice(0, 80);
}
