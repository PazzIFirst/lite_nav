// 天气图标 —— 50 套自绘 SVG,覆盖 71 种天气(21 种复用近似档)。
//
// 风格约定(改图标时必须守住,否则一眼看出不是一家人):
//   · viewBox 统一 0 0 48 48,内容控制在 x/y ∈ [3,45]
//   · 只用 circle / rect(rx) / ellipse / polygon / g —— 不用 path。
//     弧线参数写错了肉眼很难发现,几何图元则渲染结果可预期
//   · 纯实心 fill,不用 stroke / 渐变 / 滤镜
//   · 颜色一律走 class(ic-*),由 main.css 上色。这样深浅主题、
//     不同背景族都能各自覆盖,不用改一行 SVG
//
// 共用零件:云、雪花、闪电在所有图标里是同一份几何,只做平移缩放。
// 这是「成一家人」的关键 —— 各画各的云,拼起来就散了。

import { resolveFxKey } from './weather-fx.js';

const CLOUD = '<circle cx="19" cy="20" r="7.5"/><circle cx="29" cy="18" r="9"/>'
  + '<circle cx="34" cy="24" r="6.5"/><rect x="13" y="22" width="24" height="9" rx="4.5"/>';
const FLAKE = '<rect x="-0.9" y="-4.5" width="1.8" height="9" rx="0.9"/>'
  + '<rect x="-0.9" y="-4.5" width="1.8" height="9" rx="0.9" transform="rotate(60)"/>'
  + '<rect x="-0.9" y="-4.5" width="1.8" height="9" rx="0.9" transform="rotate(120)"/>';
const BOLT = '<polygon class="ic-bolt" points="26,31 17,40 22.5,40 19,46 29,36 23.5,36"';

const cloud = (cls = 'ic-cloud', tf = '') =>
  `<g class="${cls}"${tf ? ` transform="${tf}"` : ''}>${CLOUD}</g>`;
const flake = (tf) => `<g class="ic-snow" transform="${tf}">${FLAKE}</g>`;
const svg = (body) => `<svg viewBox="0 0 48 48" class="wx-ic" aria-hidden="true">${body}</svg>`;

// 太阳:中心圆 + 8 根等分光芒
const SUN_RAYS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((a) => `<rect class="ic-sun" x="22.2" y="2.4" width="3.6" height="8.2" rx="1.8" transform="rotate(${a} 24 24)"/>`)
  .join('');

const ICONS = {
  /* ── 天空 (4) ─────────────────────────────────────────── */
  '晴': svg(`<circle class="ic-sun" cx="24" cy="24" r="10"/>${SUN_RAYS}`),
  // 晴间少云:太阳是主体,云只压住右下一角。跟「多云」的区别就在这个主次
  '晴间少云': svg(
    '<circle class="ic-sun" cx="17" cy="16" r="7"/>'
    + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect class="ic-sun" x="15.5" y="2.5" width="3" height="4" rx="1.5" transform="rotate(${a} 17 16)"/>`).join('')
    + cloud('ic-cloud is-front', 'translate(9,17) scale(0.78)')),

  // 多云:太阳被云挡住大半,云是主体。两朵云一远一近 ——
  // 远的用 ic-cloud-far(更浅),近的加投影,否则同色叠在一起边界糊死
  '多云': svg(
    '<circle class="ic-sun" cx="15" cy="15" r="5.5"/>'
    + [270, 315, 0, 45].map((a) => `<rect class="ic-sun" x="13.7" y="4" width="2.6" height="3.5" rx="1.3" transform="rotate(${a} 15 15)"/>`).join('')
    + cloud('ic-cloud-far', 'translate(12,3) scale(0.6)')
    + cloud('ic-cloud is-front', 'translate(2,12) scale(0.92)')),

  // 阴:两朵暗云,远的浅一档 + 近的带投影,拉开层次
  '阴': svg(cloud('ic-cloud-dark-far', 'translate(-2,-2) scale(0.85)')
    + cloud('ic-cloud-dark is-front', 'translate(5,12) scale(0.95)')),

  /* ── 视程障碍 (9) ─────────────────────────────────────── */
  '轻雾': svg('<rect class="ic-fog" x="8" y="17" width="32" height="3" rx="1.5"/><rect class="ic-fog" x="14" y="27" width="20" height="3" rx="1.5"/>'),
  '雾': svg('<rect class="ic-fog" x="8" y="12" width="32" height="3" rx="1.5"/><rect class="ic-fog" x="4" y="20" width="40" height="3" rx="1.5"/><rect class="ic-fog" x="6" y="28" width="36" height="3" rx="1.5"/><rect class="ic-fog" x="10" y="36" width="28" height="3" rx="1.5"/>'),
  '冻雾': svg('<rect class="ic-fog" x="7" y="11" width="34" height="3" rx="1.5"/><rect class="ic-fog" x="5" y="20" width="38" height="3" rx="1.5"/><rect class="ic-fog" x="9" y="29" width="30" height="3" rx="1.5"/><circle class="ic-ice" cx="13" cy="17" r="1.9"/><circle class="ic-ice" cx="24" cy="17" r="1.9"/><circle class="ic-ice" cx="35" cy="17" r="1.9"/><circle class="ic-ice" cx="18" cy="26" r="1.9"/><circle class="ic-ice" cx="30" cy="26" r="1.9"/><circle class="ic-ice" cx="16" cy="38" r="1.9"/><circle class="ic-ice" cx="24" cy="38" r="1.9"/><circle class="ic-ice" cx="32" cy="38" r="1.9"/>'),
  '雾凇': svg('<rect class="ic-ice" x="12" y="8" width="2.4" height="9" rx="1.2"/><rect class="ic-ice" x="22" y="8" width="2.4" height="9" rx="1.2"/><rect class="ic-ice" x="32" y="8" width="2.4" height="9" rx="1.2"/><rect class="ic-fog" x="8" y="16" width="32" height="3" rx="1.5"/><rect class="ic-ice" x="15" y="29" width="2.4" height="9" rx="1.2"/><rect class="ic-ice" x="24" y="29" width="2.4" height="9" rx="1.2"/><rect class="ic-ice" x="33" y="29" width="2.4" height="9" rx="1.2"/><rect class="ic-fog" x="10" y="30" width="28" height="3" rx="1.5"/>'),
  '霾': svg('<rect class="ic-dust" x="7" y="14" width="34" height="3" rx="1.5"/><rect class="ic-dust" x="5" y="23" width="38" height="3" rx="1.5"/><rect class="ic-dust" x="9" y="32" width="30" height="3" rx="1.5"/><circle class="ic-dust" cx="14" cy="20" r="1.6"/><circle class="ic-dust" cx="26" cy="20" r="1.6"/><circle class="ic-dust" cx="36" cy="20" r="1.6"/><circle class="ic-dust" cx="18" cy="29" r="1.6"/><circle class="ic-dust" cx="30" cy="29" r="1.6"/><circle class="ic-dust" cx="16" cy="39" r="1.6"/><circle class="ic-dust" cx="24" cy="39" r="1.6"/><circle class="ic-dust" cx="32" cy="39" r="1.6"/>'),
  '浮尘': svg([[10,12],[20,9],[31,13],[40,10],[7,22],[17,20],[27,23],[37,21],[12,32],[23,31],[33,34],[42,30],[17,40],[29,39]].map(([x,y])=>`<circle class="ic-dust" cx="${x}" cy="${y}" r="1.6"/>`).join('')),
  '扬沙': svg('<rect class="ic-dust" x="8" y="13" width="16" height="3" rx="1.5" transform="rotate(-20 16 14.5)"/><rect class="ic-dust" x="22" y="24" width="18" height="3" rx="1.5" transform="rotate(-20 31 25.5)"/><rect class="ic-dust" x="12" y="34" width="17" height="3" rx="1.5" transform="rotate(-20 20.5 35.5)"/>' + [[33,10],[41,16],[9,24],[17,30],[35,38],[43,32],[26,42]].map(([x,y])=>`<circle class="ic-dust" cx="${x}" cy="${y}" r="1.6"/>`).join('')),
  '沙尘暴': svg('<rect class="ic-dust" x="9" y="7.5" width="30" height="3" rx="1.5" transform="rotate(-12 24 9)"/><rect class="ic-dust" x="7" y="15.5" width="28" height="3" rx="1.5" transform="rotate(-12 21 17)"/><rect class="ic-dust" x="13" y="23.5" width="28" height="3" rx="1.5" transform="rotate(-12 27 25)"/><rect class="ic-dust" x="8" y="31.5" width="30" height="3" rx="1.5" transform="rotate(-12 23 33)"/><rect class="ic-dust" x="12" y="38.5" width="26" height="3" rx="1.5" transform="rotate(-12 25 40)"/><circle class="ic-dust" cx="42" cy="20" r="1.6"/><circle class="ic-dust" cx="6" cy="27" r="1.6"/><circle class="ic-dust" cx="41" cy="35" r="1.6"/>'),
  '强沙尘暴': svg('<rect class="ic-dust" x="12" y="6.5" width="28" height="3" rx="1.5" transform="rotate(-12 26 8)"/><rect class="ic-dust" x="7" y="11.8" width="34" height="3" rx="1.5" transform="rotate(-12 24 13.3)"/><rect class="ic-dust" x="6" y="17.2" width="32" height="3" rx="1.5" transform="rotate(-12 22 18.7)"/><rect class="ic-dust" x="6" y="22.5" width="36" height="3" rx="1.5" transform="rotate(-12 24 24)"/><rect class="ic-dust" x="10" y="27.8" width="32" height="3" rx="1.5" transform="rotate(-12 26 29.3)"/><rect class="ic-dust" x="6" y="33.2" width="34" height="3" rx="1.5" transform="rotate(-12 23 34.7)"/><rect class="ic-dust" x="7" y="38.5" width="28" height="3" rx="1.5" transform="rotate(-12 21 40)"/>'),

  /* ── 毛毛雨 (3) ─ 用细颗粒不用长条 ──────────────────────── */
  '小毛毛雨': svg(cloud() + '<g class="ic-rain"><circle cx="17.6" cy="35.2" r="1.4"/><circle cx="24.4" cy="34.5" r="1.4"/><circle cx="31.4" cy="35.4" r="1.4"/><circle cx="27.6" cy="40.4" r="1.4"/></g>'),
  '毛毛雨': svg(cloud() + '<g class="ic-rain"><circle cx="16.4" cy="34.8" r="1.4"/><circle cx="22.4" cy="34.8" r="1.4"/><circle cx="28.4" cy="34.8" r="1.4"/><circle cx="34.4" cy="34.8" r="1.4"/><circle cx="19.4" cy="40.2" r="1.4"/><circle cx="25.4" cy="40.2" r="1.4"/><circle cx="31.4" cy="40.2" r="1.4"/></g>'),
  '浓毛毛雨': svg(cloud() + '<g class="ic-rain"><circle cx="15.2" cy="34.2" r="1.4"/><circle cx="20.6" cy="34.2" r="1.4"/><circle cx="26" cy="34.2" r="1.4"/><circle cx="31.4" cy="34.2" r="1.4"/><circle cx="36.8" cy="34.2" r="1.4"/><circle cx="17.9" cy="38.6" r="1.4"/><circle cx="23.3" cy="38.6" r="1.4"/><circle cx="28.7" cy="38.6" r="1.4"/><circle cx="34.1" cy="38.6" r="1.4"/><circle cx="26" cy="43.2" r="1.4"/><rect x="19.4" y="40.3" width="2.4" height="4.4" rx="1.2" transform="rotate(12 20.6 42.5)"/><rect x="30.2" y="40.3" width="2.4" height="4.4" rx="1.2" transform="rotate(12 31.4 42.5)"/></g>'),

  /* ── 冻毛毛雨 (2) ─ 颗粒 + 菱形冰晶 ─────────────────────── */
  '轻冻毛毛雨': svg(cloud() + '<g class="ic-rain"><circle cx="16.5" cy="35.2" r="1.5"/><circle cx="29.5" cy="35.2" r="1.5"/><circle cx="19.8" cy="41.4" r="1.5"/><circle cx="32.8" cy="41.4" r="1.5"/></g><g class="ic-ice"><polygon points="23,32.9 25.3,35.2 23,37.5 20.7,35.2"/><polygon points="36,32.9 38.3,35.2 36,37.5 33.7,35.2"/><polygon points="26.3,39.1 28.6,41.4 26.3,43.7 24,41.4"/></g>'),
  '强冻毛毛雨': svg(cloud() + '<g class="ic-rain"><circle cx="15.5" cy="34.4" r="1.5"/><circle cx="28.5" cy="34.4" r="1.5"/><circle cx="25.3" cy="39" r="1.5"/><circle cx="38.3" cy="39" r="1.5"/><circle cx="22" cy="42.6" r="1.5"/><circle cx="35" cy="42.6" r="1.5"/></g><g class="ic-ice"><polygon points="22,32.1 24.3,34.4 22,36.7 19.7,34.4"/><polygon points="35,32.1 37.3,34.4 35,36.7 32.7,34.4"/><polygon points="18.8,36.7 21.1,39 18.8,41.3 16.5,39"/><polygon points="31.8,36.7 34.1,39 31.8,41.3 29.5,39"/><polygon points="28.5,40.3 30.8,42.6 28.5,44.9 26.2,42.6"/></g>'),

  /* ── 稳定性降雨 (6) ─ 根数/长度/粗细/倾角 四维同时递进 ──── */
  '小雨': svg(cloud() + '<g class="ic-rain"><rect x="17.4" y="33" width="2.2" height="6.5" rx="1.1" transform="rotate(8 18.5 36.25)"/><rect x="24.4" y="33" width="2.2" height="6.5" rx="1.1" transform="rotate(8 25.5 36.25)"/><rect x="31.4" y="33" width="2.2" height="6.5" rx="1.1" transform="rotate(8 32.5 36.25)"/></g>'),
  '中雨': svg(cloud() + '<g class="ic-rain"><rect x="15.35" y="32.7" width="2.5" height="8.5" rx="1.25" transform="rotate(12 16.6 36.95)"/><rect x="21.55" y="32.7" width="2.5" height="8.5" rx="1.25" transform="rotate(12 22.8 36.95)"/><rect x="27.75" y="32.7" width="2.5" height="8.5" rx="1.25" transform="rotate(12 29 36.95)"/><rect x="33.95" y="32.7" width="2.5" height="8.5" rx="1.25" transform="rotate(12 35.2 36.95)"/></g>'),
  '大雨': svg(cloud() + '<g class="ic-rain"><rect x="14" y="32.2" width="2.8" height="10.5" rx="1.4" transform="rotate(16 15.4 37.45)"/><rect x="19.5" y="32.2" width="2.8" height="10.5" rx="1.4" transform="rotate(16 20.9 37.45)"/><rect x="25" y="32.2" width="2.8" height="10.5" rx="1.4" transform="rotate(16 26.4 37.45)"/><rect x="30.5" y="32.2" width="2.8" height="10.5" rx="1.4" transform="rotate(16 31.9 37.45)"/><rect x="36" y="32.2" width="2.8" height="10.5" rx="1.4" transform="rotate(16 37.4 37.45)"/></g>'),
  '暴雨': svg(cloud('ic-cloud-dark') + '<g class="ic-rain"><rect x="12.1" y="32.1" width="3" height="11.5" rx="1.5" transform="rotate(19 13.6 37.85)"/><rect x="17.3" y="32.1" width="3" height="11.5" rx="1.5" transform="rotate(19 18.8 37.85)"/><rect x="22.5" y="32.1" width="3" height="11.5" rx="1.5" transform="rotate(19 24 37.85)"/><rect x="27.7" y="32.1" width="3" height="11.5" rx="1.5" transform="rotate(19 29.2 37.85)"/><rect x="32.9" y="32.1" width="3" height="11.5" rx="1.5" transform="rotate(19 34.4 37.85)"/><rect x="38.1" y="32.1" width="3" height="11.5" rx="1.5" transform="rotate(19 39.6 37.85)"/></g>'),
  '大暴雨': svg(cloud('ic-cloud-dark') + '<g class="ic-rain"><rect x="10.45" y="31.75" width="3.1" height="12.5" rx="1.55" transform="rotate(21 12 38)"/><rect x="15.25" y="31.75" width="3.1" height="12.5" rx="1.55" transform="rotate(21 16.8 38)"/><rect x="20.05" y="31.75" width="3.1" height="12.5" rx="1.55" transform="rotate(21 21.6 38)"/><rect x="24.85" y="31.75" width="3.1" height="12.5" rx="1.55" transform="rotate(21 26.4 38)"/><rect x="29.65" y="31.75" width="3.1" height="12.5" rx="1.55" transform="rotate(21 31.2 38)"/><rect x="34.45" y="31.75" width="3.1" height="12.5" rx="1.55" transform="rotate(21 36 38)"/><rect x="39.25" y="31.75" width="3.1" height="12.5" rx="1.55" transform="rotate(21 40.8 38)"/></g>'),
  '特大暴雨': svg(cloud('ic-cloud-dark') + '<g class="ic-rain"><rect x="7.6" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 9.2 38.1)"/><rect x="12.1" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 13.7 38.1)"/><rect x="16.6" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 18.2 38.1)"/><rect x="21.1" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 22.7 38.1)"/><rect x="25.6" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 27.2 38.1)"/><rect x="30.1" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 31.7 38.1)"/><rect x="34.6" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 36.2 38.1)"/><rect x="39.1" y="31.35" width="3.2" height="13.5" rx="1.6" transform="rotate(24 40.7 38.1)"/></g>'),

  /* ── 阵雨 (3) ─ 对流雨:更少更长更斜,且长短不齐 ─────────── */
  '小阵雨': svg(cloud() + '<g class="ic-rain"><rect x="17.2" y="32.25" width="2.6" height="6.5" rx="1.3" transform="rotate(22 18.5 35.5)"/><rect x="24.7" y="32.2" width="2.6" height="10" rx="1.3" transform="rotate(22 26 37.2)"/><rect x="31.7" y="32.3" width="2.6" height="7" rx="1.3" transform="rotate(22 33 35.8)"/></g>'),
  '阵雨': svg(cloud() + '<g class="ic-rain"><rect x="14.35" y="32.25" width="2.9" height="7.5" rx="1.45" transform="rotate(24 15.8 36)"/><rect x="20.95" y="32" width="2.9" height="12" rx="1.45" transform="rotate(24 22.4 38)"/><rect x="27.55" y="32.15" width="2.9" height="8.5" rx="1.45" transform="rotate(24 29 36.4)"/><rect x="34.15" y="32.1" width="2.9" height="11" rx="1.45" transform="rotate(24 35.6 37.6)"/></g>'),
  '强阵雨': svg(cloud() + '<g class="ic-rain"><rect x="11.9" y="32.1" width="3.2" height="9" rx="1.6" transform="rotate(27 13.5 36.6)"/><rect x="18.1" y="31.25" width="3.2" height="13.5" rx="1.6" transform="rotate(27 19.7 38)"/><rect x="24.3" y="31.9" width="3.2" height="10" rx="1.6" transform="rotate(27 25.9 36.9)"/><rect x="30.5" y="31.3" width="3.2" height="13" rx="1.6" transform="rotate(27 32.1 37.8)"/><rect x="36.7" y="32.05" width="3.2" height="8.5" rx="1.6" transform="rotate(27 38.3 36.3)"/></g>'),

  /* ── 冻雨 (2) ─ 雨丝近垂直,配冰晶 ───────────────────────── */
  '轻冻雨': svg(cloud() + '<rect class="ic-rain" x="16.5" y="33" width="3" height="8" rx="1.5"/><rect class="ic-rain" x="28.5" y="33" width="3" height="8" rx="1.5"/><polygon class="ic-ice" points="24,38.6 26.6,41.8 24,45 21.4,41.8"/>'),
  '冻雨': svg(cloud() + '<rect class="ic-rain" x="13.5" y="32.5" width="3" height="7.5" rx="1.5"/><rect class="ic-rain" x="22.5" y="32.5" width="3" height="7.5" rx="1.5"/><rect class="ic-rain" x="31.5" y="32.5" width="3" height="7.5" rx="1.5"/><polygon class="ic-ice" points="19.5,39 22,42 19.5,45 17,42"/><polygon class="ic-ice" points="28.5,39 31,42 28.5,45 26,42"/>'),

  /* ── 雨夹雪 (4) ─ 雨雪配比随强度变化,雪相逐档占优 ───────── */
  '小雨夹雪': svg(cloud() + '<rect class="ic-rain" x="13" y="33" width="3" height="8.5" rx="1.5" transform="rotate(14 14.5 37.25)"/><rect class="ic-rain" x="20.5" y="33" width="3" height="8.5" rx="1.5" transform="rotate(14 22 37.25)"/><rect class="ic-rain" x="34" y="33" width="3" height="8.5" rx="1.5" transform="rotate(14 35.5 37.25)"/>' + flake('translate(28.5 38) scale(0.85)')),
  '雨夹雪': svg(cloud() + '<rect class="ic-rain" x="13.5" y="33" width="3" height="9" rx="1.5" transform="rotate(14 15 37.5)"/><rect class="ic-rain" x="26" y="33" width="3" height="9" rx="1.5" transform="rotate(14 27.5 37.5)"/>' + flake('translate(21.3 38) scale(0.9)') + flake('translate(35 38) scale(0.9)')),
  '小阵性雨夹雪': svg(cloud() + '<rect class="ic-rain" x="15" y="33.5" width="3.2" height="9" rx="1.6" transform="rotate(14 16.6 38)"/>' + flake('translate(26 36.8) scale(1.1)') + flake('translate(37 40.5) scale(0.9)')),
  '中到大阵性雨夹雪': svg(cloud() + '<rect class="ic-rain" x="12.8" y="34" width="3.2" height="8.5" rx="1.6" transform="rotate(14 14.4 38.25)"/>' + flake('translate(21.5 37) scale(1.15)') + flake('translate(31.5 40.5) scale(1)') + flake('translate(39.5 36.5) scale(0.9)')),

  /* ── 稳定性降雪 (4) ─ 朵数与单朵尺寸同时递进 ─────────────── */
  '小雪': svg(cloud() + flake('translate(18.5 37) scale(0.8)') + flake('translate(30 40.5) scale(0.8)')),
  '中雪': svg(cloud() + flake('translate(15.5 36.8) scale(0.85)') + flake('translate(24.5 41) scale(0.85)') + flake('translate(33.5 36.8) scale(0.85)')),
  // 后排缩小到 0.72 并拉开行距:原来 5 朵两两相交(间距 6.7 < 直径和 8.1),
  // 糊成一团;缩小后既不相交,大小差本身也成了景深
  '大雪': svg(cloud() + flake('translate(14 35.8) scale(0.9)') + flake('translate(24 35.8) scale(0.9)') + flake('translate(34 35.8) scale(0.9)') + flake('translate(19 41.6) scale(0.72)') + flake('translate(29 41.6) scale(0.72)')),
  '暴雪': svg(cloud('ic-cloud-dark') + flake('translate(14.5 36.2) scale(0.95)') + flake('translate(24 36.2) scale(0.95)') + flake('translate(33.5 36.2) scale(0.95)') + '<circle class="ic-snow" cx="19.3" cy="40.3" r="2"/><circle class="ic-snow" cx="28.8" cy="40.3" r="2"/><circle class="ic-snow" cx="39" cy="36.3" r="2"/><rect class="ic-snow" x="8" y="42.3" width="32" height="2.7" rx="1.35"/>'),

  /* ── 阵雪 (2) ─ 更少更大,排布不齐 ───────────────────────── */
  '小阵雪': svg(cloud() + flake('translate(19 37) scale(1.15)') + flake('translate(32 40.6) scale(0.95)')),
  '阵雪': svg(cloud() + flake('translate(16 38.3) scale(1.15)') + flake('translate(26.5 36.6) scale(1)') + flake('translate(36.5 40.4) scale(0.9)')),

  /* ── 其它固态降水 (6) ───────────────────────────────────── */
  '米雪': svg(cloud() + '<g class="ic-snow"><circle cx="16.5" cy="35.5" r="1.8"/><circle cx="23" cy="34.2" r="1.8"/><circle cx="30" cy="35.8" r="1.8"/><circle cx="36" cy="34.5" r="1.8"/><circle cx="20.5" cy="41.8" r="1.8"/><circle cx="28" cy="42.5" r="1.8"/></g>'),
  '冰粒': svg(cloud() + '<g class="ic-hail"><circle cx="18" cy="35" r="2.4"/><circle cx="26" cy="35" r="2.4"/><circle cx="34" cy="35" r="2.4"/><circle cx="18" cy="42" r="2.4"/><circle cx="26" cy="42" r="2.4"/><circle cx="34" cy="42" r="2.4"/></g>'),
  '小阵性冰粒': svg(cloud() + '<g class="ic-hail"><circle cx="17" cy="36" r="3.2"/><circle cx="34.5" cy="35.5" r="3"/><circle cx="28" cy="41" r="2.8"/></g>'),
  '中到大阵性冰粒': svg(cloud('ic-cloud-dark') + '<rect class="ic-fog" x="6" y="34.2" width="11" height="2.6" rx="1.3" transform="rotate(20 11.5 35.5)"/><rect class="ic-fog" x="8" y="40" width="11" height="2.6" rx="1.3" transform="rotate(20 13.5 41.3)"/><g class="ic-hail"><circle cx="20" cy="34.5" r="2.6"/><circle cx="27.5" cy="34" r="2.4"/><circle cx="35" cy="34.5" r="2.8"/><circle cx="41" cy="37.8" r="2.2"/><circle cx="23" cy="41.5" r="2.8"/><circle cx="30.5" cy="41" r="2.4"/><circle cx="37.5" cy="41.5" r="2.6"/></g>'),
  '吹雪': svg(cloud() + '<rect class="ic-fog" x="8" y="33" width="13" height="2.6" rx="1.3"/><rect class="ic-fog" x="12" y="38" width="13" height="2.6" rx="1.3"/><rect class="ic-fog" x="8" y="42.4" width="13" height="2.6" rx="1.3"/>' + flake('translate(32 35) scale(0.75) rotate(18)') + flake('translate(32.5 42) scale(0.6) rotate(-14)')),
  '暴风雪': svg(cloud('ic-cloud-dark') + '<rect class="ic-fog" x="4" y="32.4" width="18" height="2.6" rx="1.3"/><rect class="ic-fog" x="34" y="32.4" width="11" height="2.6" rx="1.3"/><rect class="ic-fog" x="9" y="37" width="16" height="2.6" rx="1.3"/><rect class="ic-fog" x="3" y="41.6" width="18" height="2.6" rx="1.3"/>' + flake('translate(29 35) scale(0.72) rotate(15)') + flake('translate(38 38.8) scale(0.7) rotate(-18)') + flake('translate(29.5 42.3) scale(0.58) rotate(24)')),

  /* ── 雷暴 (5) ─ 闪电大小 + 云的明暗 + 降水量级三轴递进 ──── */
  '附近有雷雨': svg(cloud() + `${BOLT} transform="translate(7.4 9.8) scale(0.72)"/>`),
  '雷阵雨': svg(cloud() + '<rect class="ic-rain" x="12.3" y="33" width="3" height="9" rx="1.5" transform="rotate(14 13.8 37.5)"/><rect class="ic-rain" x="30" y="33" width="3" height="9" rx="1.5" transform="rotate(14 31.5 37.5)"/><rect class="ic-rain" x="35.3" y="33" width="3" height="9" rx="1.5" transform="rotate(14 36.8 37.5)"/>' + `${BOLT} transform="translate(3 5.3) scale(0.85)"/>`),
  '雷阵雨伴小冰雹': svg(cloud('ic-cloud-dark') + '<rect class="ic-rain" x="12.3" y="32.7" width="3" height="7" rx="1.5" transform="rotate(14 13.8 36.2)"/><rect class="ic-rain" x="33" y="32.7" width="3" height="7" rx="1.5" transform="rotate(14 34.5 36.2)"/><g class="ic-hail"><circle cx="13.5" cy="43" r="2"/><circle cx="30.5" cy="43" r="2"/><circle cx="36" cy="43" r="2"/></g>' + `${BOLT} transform="translate(3 5.3) scale(0.85)"/>`),
  '雷阵雨伴大冰雹': svg(cloud('ic-cloud-dark') + '<rect class="ic-rain" x="12.5" y="31.8" width="3" height="6" rx="1.5" transform="rotate(14 14 34.8)"/><rect class="ic-rain" x="32" y="31.8" width="3" height="6" rx="1.5" transform="rotate(14 33.5 34.8)"/><g class="ic-hail"><circle cx="13.5" cy="41.5" r="3.2"/><circle cx="34" cy="41.5" r="3.2"/></g>' + `${BOLT} transform="translate(3.3 2.85) scale(0.9)"/>`),
  '雷雪': svg(cloud('ic-cloud-dark') + flake('translate(14.5 38) scale(0.85)') + flake('translate(35 38) scale(0.85)') + `${BOLT} transform="translate(6.6 7.2) scale(0.8)"/>`),
};

// 复用近似档。这 21 种要么是中文预报里的区间档(「小到中雨」),
// 要么是 wttr.in 才有的覆盖度限定词(「零星」「附近有」「间歇性」)——
// 都没必要单独画图,并到对应基础档才是正确的本地化。
const ALIAS = {
  '小到中雨': '中雨', '中到大雨': '大雨', '大到暴雨': '暴雨',
  '暴雨到大暴雨': '大暴雨', '大暴雨到特大暴雨': '特大暴雨',
  '小到中雪': '中雪', '中到大雪': '大雪', '大到暴雪': '暴雪',
  '零星小毛毛雨': '小毛毛雨', '附近有零星冻毛毛雨': '轻冻毛毛雨',
  '附近有零星降雨': '小雨', '零星小雨': '小雨',
  '间歇性中雨': '中雨', '间歇性大雨': '大雨',
  '附近有零星雨夹雪': '小雨夹雪',
  '附近有零星降雪': '小雪', '零星小雪': '小雪',
  '零星中雪': '中雪', '零星大雪': '大雪',
  '雨': '中雨', '雪': '中雪',
};

export const WX_ICONS = ICONS;
export const WX_ICON_ALIAS = ALIAS;

/** 天气名 → 图标 key。先精确查,再查复用表,最后走 weather-fx 的 fallback 链 */
export function resolveIconKey(conditionName) {
  const k = resolveFxKey(conditionName);
  if (!k) return null;
  return ICONS[k] ? k : (ALIAS[k] || null);
}

/**
 * 把天气图标画进槽位。查不到就留空 —— 槽位尺寸在 CSS 里占死了,
 * 空着不会让版面跳。
 * @param {HTMLElement} host  图标槽(.wx-icon)
 * @param {string} conditionName  完整天气名
 */
export function renderWeatherIcon(host, conditionName) {
  if (!host) return;
  const key = resolveIconKey(conditionName);
  if (host.dataset.ic === (key || '')) return;
  host.dataset.ic = key || '';
  host.innerHTML = key ? ICONS[key] : '';   // 仅本模块内的字面量,无外部输入
}
