// 各国节假日中文翻译表 — loader
// 数据存放在 ./i18n/{common,us,gb,de,...}.json
// common 是多国共用的英文/宗教节日;每国 JSON 只放"国家特有"或"覆盖通用"的条目
// 加载时 spread COMMON 进每国表,确保 US 等国家也命中 New Year's Day → 元旦
//
// 添加翻译:直接编辑对应 JSON 文件,加 key/value,重启后端即生效
// 添加新国家:在 i18n/ 下新建 xx.json + 在 holiday.js 的 SUPPORTED_COUNTRIES 加一行
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const I18N_DIR = path.join(__dirname, 'i18n');

function loadJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(I18N_DIR, name + '.json'), 'utf8'));
  } catch {
    return {};
  }
}

const COMMON = loadJson('common');

// 自动扫描 i18n 目录,凡是非 common.json 都视作国家代码(小写文件名)
const TABLES = {};
try {
  for (const file of fs.readdirSync(I18N_DIR)) {
    if (!file.endsWith('.json') || file === 'common.json') continue;
    const code = file.replace('.json', '').toUpperCase();
    // 国家特有 + COMMON 兜底(国家定义的同 key 会覆盖 COMMON)
    TABLES[code] = { ...COMMON, ...loadJson(file.replace('.json', '')) };
  }
} catch (e) {
  console.error('[i18n] failed to load:', e.message);
}

export function translateHolidayName(country, native) {
  if (!native) return native;
  const t = TABLES[country];
  if (!t) return native;
  return t[native] || native;
}
