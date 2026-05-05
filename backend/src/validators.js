// 请求输入统一校验 — 给路由用
// 失败抛 ValidationError(400);成功返回归一化后的值

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.status = 400;
  }
}

// 城市名:trim + 压缩多空格 + 长度 ≤50 + 字符白名单
// 接受中日韩文字、字母数字、空格、点、下划线、连字符
export function validateCity(raw, field = 'city') {
  if (raw == null) throw new ValidationError(`missing ${field}`, field);
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s) throw new ValidationError(`empty ${field}`, field);
  if (s.length > 50) throw new ValidationError(`${field} too long`, field);
  if (!/^[\p{L}\p{N}\s._-]+$/u.test(s)) throw new ValidationError(`${field} has invalid chars`, field);
  return s;
}

// 缓存 key 用的 normalize:小写化 + 已经 trim 的 city
export function normalizeCityKey(city) {
  return city.toLowerCase();
}

// lat/lon:有限数 + 范围 + 归一到 3 位小数(避免缓存碎片)
export function validateLatLon(latRaw, lonRaw) {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new ValidationError('lat must be a number in [-90, 90]', 'lat');
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new ValidationError('lon must be a number in [-180, 180]', 'lon');
  }
  return { lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)) };
}

// 短文本(label):trim + 长度限制
export function validateShortText(raw, field = 'label', maxLen = 50) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (s.length > maxLen) throw new ValidationError(`${field} too long (max ${maxLen})`, field);
  return s;
}

// 搜索查询:空 / 超长 / 控制字符过滤
export function validateQuery(raw, field = 'q', maxLen = 100) {
  if (raw == null) return '';
  const s = String(raw).replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (s.length > maxLen) throw new ValidationError(`${field} too long`, field);
  return s;
}

// 国家代码:大写 ISO 2 字母
export function validateCountryCode(raw, field = 'country') {
  if (raw == null) throw new ValidationError(`missing ${field}`, field);
  const s = String(raw).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) throw new ValidationError(`${field} must be ISO 3166-1 alpha-2`, field);
  return s;
}
