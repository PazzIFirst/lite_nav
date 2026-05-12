// 通用 API 调用 + 数据源悬停提示工具

// F-002:fetchT 透传 method/body/headers
export async function fetchT(url, ms = 5000, options = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function apiGet(path) {
  const r = await fetchT(path, 8000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// F-009 / F-010:协议白名单 URL 校验,防 javascript:/data:
export function safeHttpUrl(url, fallback = '#') {
  if (!url || typeof url !== 'string') return fallback;
  try {
    const u = new URL(url, location.href);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : fallback;
  } catch { return fallback; }
}

export function fmtAge(ts) {
  if (!ts) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return sec + ' 秒前';
  if (sec < 3600) return Math.floor(sec / 60) + ' 分钟前';
  if (sec < 86400) return Math.floor(sec / 3600) + ' 小时前';
  return Math.floor(sec / 86400) + ' 天前';
}

export function freshnessText(f) {
  return ({ fresh: '✓ 新鲜', stale: '⚠ 缓存(过期)', fallback: '⚠ 本地兜底' }[f]) || f || '';
}

// 生成 title 属性内容(原生 tooltip,鼠标悬停显示)
export function srcTooltip(meta) {
  if (!meta) return '';
  const lines = [];
  if (meta.source_label) lines.push('数据源: ' + meta.source_label);
  if (meta.fetched_at)   lines.push('更新: ' + fmtAge(meta.fetched_at));
  if (meta.freshness)    lines.push('状态: ' + freshnessText(meta.freshness));
  return lines.join('\n');
}

// favicon — F-014:走后端代理(避开向各网站直接发请求暴露访问行为)
const FAVICON_OVERRIDES = {
  'xiaohongshu.com':     'https://fe-video-qc.xhscdn.com/fe-platform/ed8b0d8f55ab934dcca991d45496161d24fffbc8.png',
  'www.xiaohongshu.com': 'https://fe-video-qc.xhscdn.com/fe-platform/ed8b0d8f55ab934dcca991d45496161d24fffbc8.png',
  'npmjs.com':           'https://www.google.com/s2/favicons?sz=32&domain=npmjs.com',
};

export function faviconUrl(domain) {
  if (FAVICON_OVERRIDES[domain]) return FAVICON_OVERRIDES[domain];
  const safe = domain.toLowerCase().replace(/[^a-z0-9.-]/g, '');
  return `/api/favicon?domain=${encodeURIComponent(safe)}`;
}

// 复制文本到剪贴板(优先 navigator.clipboard,降级 textarea)
export function copyToClipboard(text) {
  const showToast = () => {
    const t = document.createElement('div');
    t.textContent = '已复制: ' + text;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#202124;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;z-index:1000;box-shadow:0 2px 12px rgba(0,0,0,0.3);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(showToast).catch(() => fallbackCopy(text, showToast));
  } else {
    fallbackCopy(text, showToast);
  }
}
function fallbackCopy(text, onDone) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;top:-100px;opacity:0;';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); onDone?.(); } catch {}
  ta.remove();
}
