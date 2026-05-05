// 输出清洗工具 — 第三方数据进缓存/前端前统一清洗

// 协议白名单 URL 校验
export function safeHttpUrl(url, fallback = null) {
  if (!url || typeof url !== 'string') return fallback;
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : fallback;
  } catch {
    return fallback;
  }
}

// 文本清洗:trim、限长、去除控制字符
export function cleanText(s, maxLen = 200) {
  if (s == null) return '';
  const t = String(s).replace(/[\x00-\x1f\x7f]/g, '').trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

// 数字校验:有限数 + 可选区间
export function safeNumber(n, opts = {}) {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return opts.fallback ?? null;
  if (opts.min != null && num < opts.min) return opts.fallback ?? null;
  if (opts.max != null && num > opts.max) return opts.fallback ?? null;
  return num;
}

// 日期 ISO 字符串(YYYY-MM-DD)校验
export function safeDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const yi = +y, moi = +mo, di = +d;
  if (yi < 1900 || yi > 2200) return null;
  if (moi < 1 || moi > 12) return null;
  if (di < 1 || di > 31) return null;
  return `${y}-${mo}-${d}`;
}

// JSON 安全解析
export function safeParse(s, fallback = null) {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
