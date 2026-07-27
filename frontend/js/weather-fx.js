// 天气卡动效 —— 按「完整天气名」查预设,71 种各有各的粒子参数。
//
// 为什么不按大组(rain/snow/…)查:大组只有 8 个,28 种降水会共用同一套粒子,
// 小雨和特大暴雨长得一模一样。粒度必须和图标对齐,即一种天气一套参数。
//
// 三条硬约束:
//   1. 动画只碰 transform / opacity —— 走合成器,不触发重排重绘。
//      宽高、位置、blur 这些都在创建时写死,不进 @keyframes。
//   2. 位置用分层抽样,不用纯随机;雨再拆成近/中/远三层。这两条比堆数量
//      有效得多 —— 纯随机 left 会聚簇出大片空档,单层排布则是一把梳子,
//      都是「数量够了但看着稀」的根源。详见下面 strat() 和 RAIN_DEPTH。
//      常见天气很轻(晴 2 / 多云 4 / 小雨 36 / 中雨 48 / 大雨 84 个粒子),
//      只有暴雨以上才过百,而那是红色预警级别,一年见不到几次。
//   3. opacity 必须通过 --o 变量进 keyframes。直接设 el.style.opacity 会被
//      keyframes 里的 opacity 覆盖(动画优先级更高),是个很隐蔽的坑。

const rand = (a, b) => a + Math.random() * (b - a);
const r2 = (a, b) => rand(a, b).toFixed(2);
const r0 = (a, b) => Math.round(rand(a, b));

// 参数是按桌面 176px 宽的卡标定的。手机上卡片变成整行(约 340px),
// 高度不变 → 面积翻倍、同样粒子数密度腰斩。按宽度补回来。
// 但补密不能无限:特大暴雨桌面已经 58 个,×1.9 就是 110 个,低端手机吃不消。
// 所以补密系数还要受一条绝对总数上限约束。
const DESIGN_W = 176;
const MAX_PARTICLES = 120;
const MAX_DENS = 1.6;
let DENS = 1;
const nOf = (n) => Math.max(1, Math.round(n * DENS));

// 一套预设在桌面密度下的粒子总数
function baseCount(layers) {
  return layers.reduce(
    (s, l) => s + (['flash', 'accum', 'glow'].includes(l.fx) ? 1 : (l.n || 1)), 0);
}

// 粒子下落行程。倾角越大、雨丝越长,要走越远才能完全离开卡片下沿。
// 卡片高 108,留点余量按 110 算。
const fallPx = (lenMax = 0, tilt = 0) =>
  Math.ceil((110 + lenMax) / Math.cos((tilt * Math.PI) / 180));

// ===== 分层抽样 =====
// 纯随机 left 是泊松分布:n 根雨丝里必然出现大片空档和几处并排,
// 数量堆再多,空档也只是变小不会消失 —— 这是「看着稀」的几何原因。
// 改成把宽度切成 n 格、每格放一颗再抖动,空档被强制均摊掉。
// 相位(animation-delay)同理分层,保证任一瞬间垂直方向也是均匀的。
const strat = (i, n, from = 0, to = 100, jitter = 0.9) =>
  from + ((i + 0.5 + (Math.random() - 0.5) * jitter) / n) * (to - from);
const stratDelay = (i, n, dur) => -((i + Math.random()) / n) * dur;

// 斜着落的粒子整体会横漂,起点范围必须朝「来向」扩出一个漂移量,
// 否则漂走的那一侧下半部分永远是空的 —— 比如雨丝向左漂,右下角就没雨。
let CARD_W = DESIGN_W;
const pct = (px) => (px / CARD_W) * 100;

// ===== 雨的景深分层 =====
// 真实的雨有景深:近处的粗、长、快、深,远处的细、短、慢、淡。
// 单层均匀排布本质上是一把梳子,间距再密也是规则空档。拆成三层之后,
// 远景那层专门填近景的缝,观感密度远高于同等元素数的单层。
const RAIN_DEPTH = [
  //  n     dur   len    w     opacity  tilt
  [0.38, 0.80, 1.35, 1.15, 1.15, 1.15],   // 近景
  [0.50, 1.00, 0.88, 0.85, 0.85, 1.00],   // 中景
  [0.62, 1.28, 0.46, 0.55, 0.55, 0.82],   // 远景:专填空隙
];
// 全局增益:嫌稀/嫌密就调这一个数,不用动 13 档的表
const RAIN_GAIN = 1.22;

function rainStack({ n, dur, len, w, tilt, opacity, env }) {
  return RAIN_DEPTH.map(([kn, kd, kl, kw, ko, kt]) => ({
    fx: 'drop',
    n: Math.max(2, Math.round(n * kn)),
    dur: [+(dur[0] * kd).toFixed(2), +(dur[1] * kd).toFixed(2)],
    len: [Math.max(3, Math.round(len[0] * kl * RAIN_GAIN)),
          Math.max(4, Math.round(len[1] * kl * RAIN_GAIN))],
    w: +Math.max(0.7, w * kw * RAIN_GAIN).toFixed(2),
    tilt: Math.round(tilt * kt),
    opacity: +Math.min(0.95, opacity * ko).toFixed(2),
    ...(env ? { env } : {}),
  }));
}

// ===== 雪的景深分层 =====
// 雪跟雨一样要分景深。单层清一色的圆点最容易显廉价 —— 大小一致、
// 不透明度一致,看着像气泡不像雪。
const SNOW_DEPTH = [
  //  n     dur   size   dx   opacity
  [0.34, 0.80, 1.30, 1.15, 1.00],   // 近景:大、快、实
  [0.44, 1.00, 0.85, 0.95, 0.72],   // 中景
  [0.56, 1.32, 0.52, 0.72, 0.42],   // 远景:小、慢、淡,填缝用
];
// 雪的全局增益。雪粒虽然比雨丝大,但单颗占的面积其实更小(圆点 vs 长线),
// 同样的 n 铺出来比雨稀得多,所以要单独往上提。嫌密就调这一个数。
const SNOW_GAIN = 1.7;

function snowStack({ n, dur, size, dx, opacity, env }) {
  return SNOW_DEPTH.map(([kn, kd, ks, kx, ko]) => ({
    fx: 'flake',
    n: Math.max(3, Math.round(n * kn * SNOW_GAIN)),
    dur: [+(dur[0] * kd).toFixed(2), +(dur[1] * kd).toFixed(2)],
    size: [+Math.max(1.6, size[0] * ks).toFixed(1), +Math.max(2.2, size[1] * ks).toFixed(1)],
    dx: Math.round(dx * kx),
    opacity: +Math.min(0.95, opacity * ko).toFixed(2),
    ...(env ? { env } : {}),
  }));
}

// ===== 粒子原语 =====
// 每个返回一段 cssText;class 名与 main.css 里的规则一一对应。

const PRIM = {
  // 雨丝:上细下浓的一道,沿自身倾斜轴下落
  drop: (p) => {
    const f = fallPx(p.len[1], p.tilt);
    // rotate(+tilt) 后 translateY 会把雨丝带向左下,横向漂移 sin(tilt)×fall。
    // 起点向右扩这么多,右下角才有雨可落。
    const drift = pct(Math.sin((p.tilt * Math.PI) / 180) * f);
    // 外扩后任一高度都有 drift/(100+drift) 的雨丝落在卡外,按比例补回来,
    // 否则修好了右下角却把整体密度稀释了
    const n = nOf(Math.round(p.n * (1 + drift / 100)));
    return times(n, (i) => ({
      cls: 'fx-drop',
      css: `left:${strat(i, n, 0, 100 + drift).toFixed(1)}%; height:${r0(p.len[0], p.len[1])}px; width:${p.w}px;
        --tilt:${p.tilt}deg; --fall:${fallPx(p.len[1], p.tilt)}px; --o:${p.opacity};
        animation-duration:${r2(p.dur[0], p.dur[1])}s;
        animation-delay:${stratDelay(i, n, p.dur[1]).toFixed(2)}s;`,
    }));
  },

  // 溅点:卡片底部扩散的小圆环,暴雨级才加
  splash: (p) => times(nOf(p.n), () => ({
    cls: 'fx-splash',
    css: `left:${r2(4, 92)}%; width:${p.size}px; height:${p.size}px; --o:${p.opacity};
      animation-duration:${r2(p.dur[0], p.dur[1])}s; animation-delay:-${r2(0, p.dur[1])}s;`,
  })),

  // 毛毛雨:极细颗粒,几乎不成线,横向飘移明显
  mist: (p) => {
    const d = pct(p.dx);              // 毛毛雨左右都飘,两侧各扩一个 dx
    const n = nOf(Math.round(p.n * (1 + (2 * d) / 100)));
    return times(n, (i) => ({
      cls: 'fx-mist',
      css: `left:${strat(i, n, -d, 100 + d).toFixed(1)}%; width:${p.size}px; height:${p.size}px;
        --dx:${r0(-p.dx, p.dx)}px; --fall:${fallPx(0, 0)}px; --o:${p.opacity};
        animation-duration:${r2(p.dur[0], p.dur[1])}s;
        animation-delay:${stratDelay(i, n, p.dur[1]).toFixed(2)}s;`,
    }));
  },

  // 冻雨的冰晶反光:慢落 + 落点结冰的青色微光
  glaze: (p) => times(nOf(p.n), () => ({
    cls: 'fx-glaze',
    css: `left:${r2(2, 96)}%; width:${p.size}px; height:${p.size}px;
      --fall:${fallPx(0, 0)}px; --o:${p.opacity};
      animation-duration:${r2(p.dur[0], p.dur[1])}s; animation-delay:-${r2(0, p.dur[1])}s;`,
  })),

  // 雪粒:边落边横漂。dirSign 让大雪以上统一风向,小雪则左右乱飘
  flake: (p) => {
    const uni = p.dx <= 12;                       // 雪大 → 风向一致
    const sign = Math.random() < 0.5 ? -1 : 1;
    // 统一风向时只需扩逆风那一侧;左右乱飘时两侧都扩
    const dp = pct(p.dx);
    const [from, to] = uni
      ? (sign > 0 ? [-dp, 100] : [0, 100 + dp])
      : [-dp, 100 + dp];
    const n = nOf(Math.round(p.n * ((to - from) / 100)));
    return times(n, (i) => {
      const d = rand(p.size[0], p.size[1]);
      const dx = uni ? sign * rand(p.dx * 0.55, p.dx) : rand(-p.dx, p.dx);
      return {
        cls: 'fx-flake',
        css: `left:${strat(i, n, from, to).toFixed(1)}%; width:${d.toFixed(1)}px; height:${d.toFixed(1)}px;
          top:${(-(d + 2)).toFixed(1)}px; --dx:${dx.toFixed(0)}px;
          --fall:${fallPx(0, 0)}px; --o:${p.opacity};
          animation-duration:${r2(p.dur[0], p.dur[1])}s;
          animation-delay:${stratDelay(i, n, p.dur[1]).toFixed(2)}s;`,
      };
    });
  },

  // 硬质颗粒:米雪 / 冰粒 / 冰雹。下落快,几乎不飘
  pellet: (p) => {
    const n = nOf(p.n);
    return times(n, (i) => ({
      cls: 'fx-pellet' + (p.size >= 2.4 ? ' is-hard' : ''),   // 硬的加冷白高光
      css: `left:${strat(i, n, 0, 100).toFixed(1)}%; width:${p.size}px; height:${p.size}px;
        top:${-(p.size + 2)}px; --fall:${fallPx(0, 0)}px; --o:${p.opacity};
        animation-duration:${r2(p.dur[0], p.dur[1])}s;
        animation-delay:${stratDelay(i, n, p.dur[1]).toFixed(2)}s;`,
    }));
  },

  // 横向疾行的条状气流:吹雪 / 沙尘 / 大风
  gust: (p) => times(nOf(p.n), () => ({
    cls: 'fx-gust',
    css: `top:${r2(8, 92)}%; width:${r0(p.len[0], p.len[1])}px; --o:${p.opacity};
      ${p.tint ? `--c:${p.tint};` : ''}
      animation-duration:${r2(p.dur[0], p.dur[1])}s; animation-delay:-${r2(0, p.dur[1])}s;`,
  })),

  // 卡片底部的积雪带。高度不能动(会重排),用 scaleY
  accum: (p) => [{
    cls: 'fx-accum',
    css: `height:${p.h}px; --o:${p.opacity}; animation-duration:${p.dur}s;`,
  }],

  // 云团:高斯模糊的圆角块横飘
  cloud: (p) => times(p.n, () => ({
    cls: 'fx-cloud',
    css: `top:${r2(p.top[0], p.top[1])}%; width:${r0(p.w[0], p.w[1])}px;
      height:${r0(p.h[0], p.h[1])}px; --blur:${p.blur}px; --o:${p.opacity};
      ${p.tint ? `--c:${p.tint};` : ''}
      animation-duration:${r2(p.dur[0], p.dur[1])}s; animation-delay:-${r2(0, p.dur[1])}s;`,
  })),

  // 宽横带:雾 / 霾 / 尘的底层
  band: (p) => times(p.n, (i) => ({
    cls: 'fx-band',
    css: `top:${(6 + (i * 84) / Math.max(1, p.n)).toFixed(0)}%; height:${p.h}px;
      --blur:${p.blur}px; --o:${p.opacity}; ${p.tint ? `--c:${p.tint};` : ''}
      animation-duration:${r2(p.dur[0], p.dur[1])}s; animation-delay:-${r2(0, p.dur[1])}s;`,
  })),

  // 悬浮颗粒:沙粒 / 霾粒 / 冰晶。static 的只闪不飘(雾凇的冰晶是附着的)
  grain: (p) => times(nOf(p.n), () => ({
    cls: 'fx-grain' + (p.static ? ' is-static' : ''),
    css: `left:${r2(2, 96)}%; top:${r2(4, 94)}%; width:${p.size}px; height:${p.size}px;
      --gx:${r0(-11, 11)}px; --gy:${r0(-8, 8)}px; --o:${p.opacity};
      ${p.tint ? `--c:${p.tint};` : ''}
      animation-duration:${r2(p.dur[0], p.dur[1])}s; animation-delay:-${r2(0, p.dur[1])}s;`,
  })),

  // 呼吸光团(太阳)。注意:不是黄色,用暖白 --fx-sun,黄色太土
  glow: (p) => [{
    cls: 'fx-glow',
    css: `width:${p.size}px; height:${p.size}px; top:${p.top}px; right:${p.right}px;
      --c:${p.color}; --s0:${p.scale[0]}; --s1:${p.scale[1]};
      animation-duration:${p.dur}s;${p.delay ? ` animation-delay:${p.delay}s;` : ''}`,
  }],

  // 整卡辉光。真闪电时天是整个亮起来的,所以辉光要留,只是强度让给 bolt
  flash: (p) => [{
    cls: `fx-flash fx-flash--${p.k}`,
    css: `animation-duration:${p.period}s;`,
  }],

  // 弧状闪电。每次渲染现生成一条折线 + 一条分叉,所以每张卡的闪电都不一样。
  // 用 halo(粗、深色)垫底 + core(细、近白)压顶 —— 浅色卡背景上纯白线看不见,
  // 靠 halo 勾出形状,core 给「烫」的感觉。
  bolt: (p) => times(p.n || 1, () => {
    const W = 100, H = 100;
    const seg = 5 + Math.floor(Math.random() * 3);
    let x = W * (0.25 + Math.random() * 0.5), y = 0;
    const pts = [[x, y]];
    for (let i = 1; i <= seg; i++) {
      y = (H * i) / seg;
      x = Math.max(6, Math.min(94, x + (Math.random() - 0.5) * W * 0.46));
      pts.push([x, y]);
    }
    const fmt = (a) => a.map((q) => q.map((v) => v.toFixed(1)).join(',')).join(' ');
    // 分叉:从中段某点斜着甩出去一小截
    const bi = 1 + Math.floor(Math.random() * (seg - 2));
    const [bx, by] = pts[bi];
    const fork = fmt([[bx, by],
      [bx + (Math.random() - 0.5) * 30, by + H * 0.12],
      [bx + (Math.random() - 0.5) * 46, by + H * 0.26]]);
    const main = fmt(pts);
    return {
      cls: `fx-bolt fx-flash--${p.k}`,
      css: `animation-duration:${p.period}s; left:${(Math.random() * 62 + 8).toFixed(0)}%;`,
      html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">`
        + `<polyline class="bolt-halo" points="${main}"/>`
        + `<polyline class="bolt-halo" points="${fork}"/>`
        + `<polyline class="bolt-core" points="${main}"/>`
        + `<polyline class="bolt-core" points="${fork}"/></svg>`,
    };
  }),
};

function times(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i));
  return out;
}

// ===== 71 种天气预设 =====
// env: [包络名, 周期秒, 谷底, 峰值] —— 表现「零星/间歇性/阵性」的断续感。
// 同一天气里 env 相同的图层共用一个包络容器,否则雨丝和溅点会不同相,一眼假。
const P = {
  /* ── 天空 (4) ───────────────────────────────────────────── */
  // 光晕要跟图标槽同心。槽是右上角 44×44、卡片内边距 16px,
  // 所以图标中心在「距上 38px、距右 38px」。glow 的 top/right 是左上角坐标,
  // 所以 top = right = 38 - size/2,两团大小不同、偏移量也不同。
  '晴': [
    { fx: 'glow', size: 136, top: -30, right: -30, color: 'var(--fx-sun)', dur: 7.5, scale: [1, 1.07] },
    { fx: 'glow', size: 60, top: 8, right: 8, color: 'var(--fx-sun)', dur: 7.5, scale: [1, 1.16], delay: -3.75 },
  ],
  '晴间少云': [
    { fx: 'glow', size: 104, top: -14, right: -14, color: 'var(--fx-sun)', dur: 8, scale: [1, 1.06] },
    { fx: 'cloud', n: 2, dur: [26, 36], w: [46, 74], h: [16, 24], top: [-6, 34], blur: 9, opacity: 0.42 },
  ],
  '多云': [{ fx: 'cloud', n: 4, dur: [18, 26], w: [68, 116], h: [24, 36], top: [-14, 52], blur: 11, opacity: 0.66 }],
  '阴': [
    { fx: 'cloud', n: 6, dur: [12, 20], w: [104, 164], h: [34, 52], top: [-24, 70], blur: 14, opacity: 0.92 },
    { fx: 'band', n: 2, dur: [28, 38], h: 34, blur: 16, opacity: 0.30 },
  ],

  /* ── 视程障碍 (9) ───────────────────────────────────────── */
  '轻雾': [{ fx: 'band', n: 3, dur: [18, 26], h: 16, blur: 9, opacity: 0.34, tint: 'var(--fx-fog)' }],
  '雾': [
    { fx: 'band', n: 5, dur: [22, 32], h: 26, blur: 13, opacity: 0.60, tint: 'var(--fx-fog)' },
    { fx: 'cloud', n: 1, dur: [40, 40], w: [150, 176], h: [52, 64], top: [18, 34], blur: 20, opacity: 0.45, tint: 'var(--fx-fog)' },
  ],
  '冻雾': [
    { fx: 'band', n: 6, dur: [26, 38], h: 32, blur: 15, opacity: 0.78, tint: 'var(--fx-frost)' },
    { fx: 'grain', n: 6, dur: [10, 16], size: 1.6, opacity: 0.50, tint: 'var(--fx-frost)' },
  ],
  '雾凇': [
    { fx: 'band', n: 4, dur: [24, 34], h: 24, blur: 13, opacity: 0.52, tint: 'var(--fx-frost)' },
    { fx: 'grain', n: 14, dur: [2.4, 4.2], size: 2, opacity: 0.85, tint: 'var(--fx-frost)', static: true },
  ],
  '霾': [
    { fx: 'band', n: 4, dur: [18, 28], h: 20, blur: 10, opacity: 0.50, tint: 'var(--fx-haze)' },
    { fx: 'grain', n: 10, dur: [10, 16], size: 1.4, opacity: 0.30, tint: 'var(--fx-haze)' },
  ],
  '浮尘': [
    { fx: 'band', n: 2, dur: [24, 34], h: 24, blur: 12, opacity: 0.34, tint: 'var(--fx-dust)' },
    { fx: 'grain', n: 20, dur: [16, 26], size: 1.7, opacity: 0.36, tint: 'var(--fx-dust)' },
  ],
  '扬沙': [
    { fx: 'band', n: 2, dur: [18, 26], h: 28, blur: 11, opacity: 0.46, tint: 'var(--fx-dust)' },
    { fx: 'grain', n: 16, dur: [8, 13], size: 1.8, opacity: 0.44, tint: 'var(--fx-dust)' },
    { fx: 'gust', n: 4, dur: [1.8, 2.8], len: [26, 46], opacity: 0.30, tint: 'var(--fx-dust)' },
  ],
  '沙尘暴': [
    { fx: 'band', n: 3, dur: [12, 18], h: 34, blur: 10, opacity: 0.62, tint: 'var(--fx-dust)' },
    { fx: 'grain', n: 12, dur: [4, 6.5], size: 2, opacity: 0.56, tint: 'var(--fx-dust)' },
    { fx: 'gust', n: 9, dur: [0.9, 1.5], len: [46, 80], opacity: 0.50, tint: 'var(--fx-dust)' },
  ],
  '强沙尘暴': [
    { fx: 'band', n: 4, dur: [7, 11], h: 40, blur: 9, opacity: 0.80, tint: 'var(--fx-dust)' },
    { fx: 'grain', n: 8, dur: [2, 3.4], size: 2.2, opacity: 0.70, tint: 'var(--fx-dust)' },
    { fx: 'gust', n: 16, dur: [0.45, 0.8], len: [76, 132], opacity: 0.72, tint: 'var(--fx-dust)' },
  ],

  /* ── 毛毛雨 (4) ─ 落速 20~45 px/s,远慢于小雨的 151,一眼是「飘」不是「落」 ── */
  '零星小毛毛雨': [{ fx: 'mist', n: 20, dur: [4.85, 6.15], size: 1.4, dx: 28, opacity: 0.28, env: ['spot', 7, 0, 0.9] }],
  '小毛毛雨': [{ fx: 'mist', n: 34, dur: [3.7, 4.75], size: 1.6, dx: 23, opacity: 0.34 }],
  '毛毛雨': [{ fx: 'mist', n: 46, dur: [2.85, 3.62], size: 2, dx: 18, opacity: 0.42 }],
  '浓毛毛雨': [
    { fx: 'mist', n: 54, dur: [2.15, 2.74], size: 2.3, dx: 13, opacity: 0.52 },
    ...rainStack({ n: 10, dur: [1.25, 1.5], len: [7, 12], w: 1.1, tilt: 3, opacity: 0.30 }),
  ],

  /* ── 冻毛毛雨 (3) ─ 过冷,比同档毛毛雨再慢一点 ── */
  '附近有零星冻毛毛雨': [
    { fx: 'mist', n: 17, dur: [5.4, 6.85], size: 1.5, dx: 22, opacity: 0.26, env: ['spot', 7.5, 0, 0.85] },
    { fx: 'glaze', n: 5, dur: [3.6, 5.6], size: 2, opacity: 0.38 },
  ],
  '轻冻毛毛雨': [
    { fx: 'mist', n: 34, dur: [4.05, 5.15], size: 1.7, dx: 17, opacity: 0.34 },
    { fx: 'glaze', n: 10, dur: [3.2, 5], size: 2.4, opacity: 0.48 },
  ],
  '强冻毛毛雨': [
    { fx: 'mist', n: 46, dur: [3.12, 3.97], size: 2.1, dx: 12, opacity: 0.44 },
    { fx: 'glaze', n: 16, dur: [2.8, 4.4], size: 2.8, opacity: 0.60 },
  ],

  /* ── 降雨 (16) ─────────────────────────────────────────────────────────
     覆盖率 1.9→4.5→15.4→23.0→32.1→44.3 %(小/中/大/暴/大暴/特大暴)
     落速   151→227→338→497→738→1083 px/s,等比 1.22 递增
     dur 区间收到 ±8%:之前是 ±20%,而相邻档只差 1.2× —— 最快的中雨和
     最慢的大雨一样快,档与档在视觉上就糊成了一片。这是「速度看着没区别」
     的真正原因,不是没做速度分级。 ── */
  '附近有零星降雨': [...rainStack({ n: 9, dur: [1.04, 1.22], len: [8, 13], w: 1.2, tilt: 3, opacity: 0.30, env: ['spot', 8, 0, 0.85] })],
  '零星小雨': [...rainStack({ n: 15, dur: [0.86, 1.01], len: [9, 14], w: 1.25, tilt: 3, opacity: 0.36, env: ['spot', 6.5, 0.08, 1] })],
  '小雨': [...rainStack({ n: 24, dur: [0.71, 0.84], len: [10, 16], w: 1.35, tilt: 4, opacity: 0.42 })],
  '小到中雨': [...rainStack({ n: 28, dur: [0.6, 0.71], len: [13, 20], w: 1.5, tilt: 6, opacity: 0.47 })],
  '间歇性中雨': [...rainStack({ n: 32, dur: [0.51, 0.6], len: [16, 24], w: 1.7, tilt: 8, opacity: 0.57, env: ['inter', 5.5, 0.15, 1] })],
  '中雨': [...rainStack({ n: 32, dur: [0.51, 0.6], len: [16, 24], w: 1.7, tilt: 8, opacity: 0.54 })],
  '中到大雨': [...rainStack({ n: 44, dur: [0.45, 0.52], len: [21, 31], w: 2, tilt: 10, opacity: 0.59 })],
  '间歇性大雨': [...rainStack({ n: 56, dur: [0.39, 0.45], len: [26, 38], w: 2.3, tilt: 12, opacity: 0.68, env: ['inter', 5, 0.2, 1] })],
  '大雨': [...rainStack({ n: 56, dur: [0.39, 0.45], len: [26, 38], w: 2.3, tilt: 12, opacity: 0.65 })],
  '大到暴雨': [...rainStack({ n: 61, dur: [0.33, 0.38], len: [29, 42], w: 2.4, tilt: 14, opacity: 0.70 })],
  '暴雨': [
    ...rainStack({ n: 66, dur: [0.28, 0.33], len: [32, 47], w: 2.55, tilt: 16, opacity: 0.75 }),
    { fx: 'splash', n: 8, dur: [0.6, 0.9], size: 5, opacity: 0.28 },
  ],
  '暴雨到大暴雨': [
    ...rainStack({ n: 71, dur: [0.24, 0.28], len: [35, 51], w: 2.7, tilt: 18, opacity: 0.79 }),
    { fx: 'splash', n: 9, dur: [0.52, 0.78], size: 6, opacity: 0.33 },
  ],
  '大暴雨': [
    ...rainStack({ n: 76, dur: [0.2, 0.24], len: [38, 56], w: 2.8, tilt: 20, opacity: 0.84 }),
    { fx: 'splash', n: 10, dur: [0.45, 0.68], size: 7, opacity: 0.38 },
  ],
  '大暴雨到特大暴雨': [
    ...rainStack({ n: 81, dur: [0.17, 0.2], len: [42, 62], w: 2.95, tilt: 22, opacity: 0.88 }),
    { fx: 'splash', n: 11, dur: [0.39, 0.59], size: 8, opacity: 0.43 },
  ],
  '特大暴雨': [
    ...rainStack({ n: 86, dur: [0.14, 0.17], len: [46, 68], w: 3.1, tilt: 24, opacity: 0.92 }),
    { fx: 'splash', n: 12, dur: [0.34, 0.51], size: 9, opacity: 0.48 },
  ],
  '雨': [...rainStack({ n: 32, dur: [0.51, 0.6], len: [16, 24], w: 1.7, tilt: 8, opacity: 0.54 })],

  /* ── 阵雨 (3) ─ 对流雨:同强度下更快、更长、更斜,数量比稳定性降雨少 ── */
  '小阵雨': [...rainStack({ n: 26, dur: [0.5, 0.58], len: [15, 23], w: 1.65, tilt: 8, opacity: 0.48, env: ['shower', 5, 0.12, 1] })],
  '阵雨': [...rainStack({ n: 40, dur: [0.32, 0.37], len: [22, 33], w: 2.1, tilt: 14, opacity: 0.62, env: ['shower', 4.5, 0.2, 1] })],
  '强阵雨': [
    ...rainStack({ n: 60, dur: [0.22, 0.26], len: [34, 50], w: 2.7, tilt: 19, opacity: 0.76, env: ['shower', 4, 0.28, 1] }),
    { fx: 'splash', n: 9, dur: [0.6, 0.9], size: 6, opacity: 0.30, env: ['shower', 4, 0.28, 1] },
  ],

  /* ── 冻雨 (2) ─ 慢(100~135 px/s)且近垂直,靠速度而非密度和中雨区分 ── */
  '轻冻雨': [
    ...rainStack({ n: 24, dur: [1.2, 1.42], len: [13, 20], w: 1.6, tilt: 3, opacity: 0.44 }),
    { fx: 'glaze', n: 12, dur: [3, 4.8], size: 2.4, opacity: 0.50 },
  ],
  '冻雨': [
    ...rainStack({ n: 34, dur: [0.95, 1.11], len: [19, 28], w: 2, tilt: 5, opacity: 0.57 }),
    { fx: 'glaze', n: 20, dur: [2.6, 4.2], size: 3, opacity: 0.62 },
  ],

  /* ── 雨夹雪 (5) ─ 雨占比随量级递减:雪相越占优,越要靠大雪花撑住「强」 ── */
  '附近有零星雨夹雪': [
    ...rainStack({ n: 14, dur: [0.82, 0.96], len: [9, 14], w: 1.5, tilt: 5, opacity: 0.40 }),
    ...snowStack({ n: 7, dur: [4.8, 6.8], size: [2.5, 4], dx: 20, opacity: 0.60 }),
  ],
  '小雨夹雪': [
    ...rainStack({ n: 22, dur: [0.65, 0.77], len: [11, 17], w: 1.75, tilt: 7, opacity: 0.55 }),
    ...snowStack({ n: 14, dur: [4, 5.6], size: [3, 4.5], dx: 16, opacity: 0.78 }),
  ],
  '雨夹雪': [
    ...rainStack({ n: 28, dur: [0.53, 0.62], len: [14, 21], w: 1.9, tilt: 9, opacity: 0.62 }),
    ...snowStack({ n: 28, dur: [2.7, 3.8], size: [4, 5.8], dx: 12, opacity: 0.90 }),
  ],
  '小阵性雨夹雪': [
    ...rainStack({ n: 24, dur: [0.47, 0.55], len: [12, 19], w: 1.75, tilt: 12, opacity: 0.58, env: ['burst', 8.5, 0.3, 1] }),
    ...snowStack({ n: 21, dur: [3.3, 4.6], size: [3.5, 5], dx: 14, opacity: 0.84, env: ['burst', 8.5, 0.3, 1] }),
  ],
  '中到大阵性雨夹雪': [
    ...rainStack({ n: 32, dur: [0.36, 0.42], len: [16, 25], w: 2.1, tilt: 16, opacity: 0.70, env: ['burst', 7, 0.4, 1] }),
    ...snowStack({ n: 44, dur: [2, 2.9], size: [4.8, 7], dx: 8, opacity: 0.95, env: ['burst', 7, 0.4, 1] }),
    { fx: 'gust', n: 4, dur: [1.2, 1.9], len: [28, 55], opacity: 0.18, env: ['burst', 7, 0.4, 1] },
  ],

  /* ── 降雪 (12) ──────────────────────────────────────────── */
  '附近有零星降雪': [...snowStack({ n: 3, dur: [6.5, 9.5], size: [2, 3.2], dx: 28, opacity: 0.55 })],
  '零星小雪': [...snowStack({ n: 5, dur: [5.6, 8.6], size: [2.5, 4], dx: 24, opacity: 0.74 })],
  '小雪': [...snowStack({ n: 9, dur: [5.4, 8.2], size: [2.5, 4], dx: 22, opacity: 0.82 })],
  '小到中雪': [...snowStack({ n: 12, dur: [4.2, 6], size: [3.6, 5.2], dx: 17, opacity: 0.87 })],
  '零星中雪': [...snowStack({ n: 8, dur: [3.8, 5.4], size: [4, 5.6], dx: 16, opacity: 0.84 })],
  '中雪': [...snowStack({ n: 14, dur: [3.8, 5.4], size: [4, 5.6], dx: 15, opacity: 0.90 })],
  '中到大雪': [
    ...snowStack({ n: 16, dur: [2.9, 4.2], size: [4.6, 6.4], dx: 12, opacity: 0.93 }),
    { fx: 'accum', h: 5, dur: 7.5, opacity: 0.36 },
  ],
  '零星大雪': [...snowStack({ n: 10, dur: [2.6, 3.8], size: [5, 7], dx: 11, opacity: 0.92 })],
  '大雪': [
    ...snowStack({ n: 18, dur: [2.6, 3.8], size: [5, 7], dx: 10, opacity: 0.95 }),
    { fx: 'accum', h: 6, dur: 7, opacity: 0.42 },
  ],
  '大到暴雪': [
    ...snowStack({ n: 20, dur: [1.9, 2.9], size: [5.6, 8], dx: 7, opacity: 0.97 }),
    { fx: 'gust', n: 3, dur: [1.3, 2], len: [30, 62], opacity: 0.20 },
    { fx: 'accum', h: 8, dur: 6.5, opacity: 0.48 },
  ],
  '暴雪': [
    ...snowStack({ n: 22, dur: [1.7, 2.6], size: [6, 8.5], dx: 6, opacity: 0.98 }),
    { fx: 'gust', n: 4, dur: [1.1, 1.8], len: [35, 70], opacity: 0.26 },
    { fx: 'accum', h: 9, dur: 6, opacity: 0.55 },
  ],
  '雪': [...snowStack({ n: 14, dur: [3.8, 5.4], size: [4, 5.6], dx: 15, opacity: 0.90 })],

  /* ── 阵雪 (2) ───────────────────────────────────────────── */
  '小阵雪': [...snowStack({ n: 11, dur: [4.6, 7], size: [3, 4.4], dx: 19, opacity: 0.84, env: ['burst', 9, 0.25, 1] })],
  '阵雪': [...snowStack({ n: 16, dur: [3.2, 4.8], size: [4.3, 6], dx: 13, opacity: 0.92, env: ['burst', 8, 0.3, 1] })],

  /* ── 其它固态 (6) ───────────────────────────────────────── */
  '米雪': [{ fx: 'pellet', n: 14, dur: [2.2, 3.2], size: 2, opacity: 0.65 }],
  '冰粒': [{ fx: 'pellet', n: 18, dur: [1.2, 1.7], size: 2.5, opacity: 0.95 }],
  '小阵性冰粒': [{ fx: 'pellet', n: 11, dur: [1.5, 2.1], size: 2.4, opacity: 0.90, env: ['burst', 8, 0.25, 1] }],
  '中到大阵性冰粒': [
    { fx: 'pellet', n: 22, dur: [0.95, 1.35], size: 2.8, opacity: 0.98, env: ['burst', 6.5, 0.45, 1] },
    { fx: 'gust', n: 2, dur: [1, 1.6], len: [26, 52], opacity: 0.20, env: ['burst', 6.5, 0.45, 1] },
  ],
  '吹雪': [
    { fx: 'gust', n: 8, dur: [0.7, 1.3], len: [40, 90], opacity: 0.40 },
    ...snowStack({ n: 12, dur: [1.6, 2.6], size: [2.5, 4.5], dx: 130, opacity: 0.80 }),
    { fx: 'accum', h: 5, dur: 5, opacity: 0.40 },
  ],
  '暴风雪': [
    { fx: 'gust', n: 8, dur: [0.55, 1], len: [55, 120], opacity: 0.42 },
    ...snowStack({ n: 16, dur: [1.3, 2.1], size: [5, 8], dx: 95, opacity: 0.98 }),
    { fx: 'accum', h: 10, dur: 5, opacity: 0.60 },
  ],

  /* ── 雷暴 (5) ─ 闪电是「啪-啪…(长静默)」,不是均匀闪 ────────── */
  '附近有雷雨': [
    { fx: 'cloud', n: 3, dur: [20, 28], w: [90, 140], h: [30, 44], top: [-16, 50], blur: 13, opacity: 0.72 },
    { fx: 'flash', k: 'near', period: 11 },
  ],
  '雷阵雨': [
    { fx: 'cloud', n: 2, dur: [16, 24], w: [96, 150], h: [32, 46], top: [-20, 44], blur: 13, opacity: 0.80 },
    ...rainStack({ n: 42, dur: [0.32, 0.38], len: [18, 29], w: 2, tilt: 8, opacity: 0.58 }),
    { fx: 'flash', k: 'storm', period: 7 },
    { fx: 'bolt', k: 'storm', period: 7 },
  ],
  '雷阵雨伴小冰雹': [
    { fx: 'cloud', n: 2, dur: [14, 22], w: [96, 150], h: [32, 46], top: [-20, 44], blur: 13, opacity: 0.82 },
    ...rainStack({ n: 30, dur: [0.3, 0.35], len: [16, 26], w: 1.9, tilt: 10, opacity: 0.50 }),
    { fx: 'pellet', n: 15, dur: [0.55, 0.8], size: 3, opacity: 0.82 },
    { fx: 'flash', k: 'hail', period: 6 },
    { fx: 'bolt', k: 'hail', period: 6 },
  ],
  '雷阵雨伴大冰雹': [
    { fx: 'cloud', n: 3, dur: [11, 18], w: [110, 168], h: [36, 52], top: [-24, 50], blur: 14, opacity: 0.90 },
    ...rainStack({ n: 21, dur: [0.26, 0.31], len: [14, 23], w: 1.8, tilt: 12, opacity: 0.44 }),
    { fx: 'pellet', n: 12, dur: [0.36, 0.55], size: 5.5, opacity: 0.95 },
    { fx: 'flash', k: 'hail2', period: 5 },
    { fx: 'bolt', k: 'hail2', period: 5, n: 2 },
  ],
  '雷雪': [
    { fx: 'cloud', n: 2, dur: [18, 26], w: [100, 152], h: [32, 46], top: [-18, 46], blur: 14, opacity: 0.60 },
    ...snowStack({ n: 14, dur: [3.6, 6.2], size: [3, 6], dx: 22, opacity: 0.92 }),
    { fx: 'flash', k: 'snow', period: 9 },
    { fx: 'bolt', k: 'snow', period: 9 },
  ],
};

export const FX_PRESETS = P;
export const FX_CONDITIONS = Object.keys(P);

// 查不到完整天气名时的退路。三个上游的文案不完全在词表内(比如中国天气网
// 偶尔回「小雨-中雨」这类连字符写法),按关键字降到最近的档,总比没有强。
function fallbackKey(name) {
  const s = String(name || '');
  if (!s) return null;
  // 雷要先分冰雹再分雨雪 —— 中国天气网 d05 的原文就是「雷阵雨伴有冰雹」,
  // 只判 /雷/ 会把冰雹丢掉
  if (/雷/.test(s)) {
    if (/雹/.test(s)) return /大雹|大冰雹/.test(s) ? '雷阵雨伴大冰雹' : '雷阵雨伴小冰雹';
    return /雪/.test(s) ? '雷雪' : '雷阵雨';
  }
  if (/雹/.test(s)) return '雷阵雨伴小冰雹';
  if (/雨夹雪/.test(s)) return '雨夹雪';
  if (/暴雪/.test(s)) return '暴雪';
  if (/大雪/.test(s)) return '大雪';
  if (/中雪/.test(s)) return '中雪';
  if (/小雪|阵雪|雪/.test(s)) return /阵/.test(s) ? '阵雪' : '小雪';
  if (/冰粒|米雪/.test(s)) return '冰粒';
  if (/毛毛雨/.test(s)) return '毛毛雨';
  if (/冻雨/.test(s)) return '冻雨';
  if (/特大暴雨/.test(s)) return '特大暴雨';
  if (/大暴雨/.test(s)) return '大暴雨';
  if (/暴雨/.test(s)) return '暴雨';
  if (/大雨/.test(s)) return '大雨';
  if (/中雨/.test(s)) return '中雨';
  if (/阵雨/.test(s)) return '阵雨';
  if (/雨/.test(s)) return '小雨';
  if (/沙尘暴/.test(s)) return '沙尘暴';
  if (/扬沙|浮尘|沙|尘/.test(s)) return '浮尘';
  if (/霾/.test(s)) return '霾';
  if (/雾/.test(s)) return '雾';
  if (/阴/.test(s)) return '阴';
  if (/晴/.test(s)) return '晴';
  if (/云/.test(s)) return '多云';
  return null;
}

// ===== 显示名 =====
// 卡片右下角只有约 92px(12px 字号 ≈ 7 个汉字),而内部标识里混着三种口径:
// 中国天气网的国内术语、WMO 码表的中译、WWO 的英文口径中译。
// 「附近有 / 零星 / 间歇性」是 WWO 的 nearby/patchy/intermittent 直译,
// 中文预报根本不这么说 —— 这类一律并掉。
//
// 这是纯显示层:内部标识仍驱动 71 种动效和 50 套图标,合并显示名
// 不损失视觉区分度;完整名称保留在卡片 tooltip 里。
const DISPLAY = {
  '晴间少云': '晴间多云',            // 「少云」是观测云量术语,预报用语是「晴间多云」
  // 毛毛雨:观测规范里不设强度分级,WMO 的三档是码表产物,没有中文对应
  '零星小毛毛雨': '毛毛雨', '小毛毛雨': '毛毛雨', '浓毛毛雨': '毛毛雨',
  '附近有零星冻毛毛雨': '冻毛毛雨', '轻冻毛毛雨': '冻毛毛雨', '强冻毛毛雨': '冻毛毛雨',
  '附近有零星降雨': '小雨', '零星小雨': '小雨',
  '间歇性中雨': '中雨', '间歇性大雨': '大雨',
  '大暴雨到特大暴雨': '特大暴雨',    // 唯一一处显示量级偏严一档,8 字实在放不下
  '小阵雨': '阵雨',
  '轻冻雨': '冻雨',
  '附近有零星雨夹雪': '雨夹雪', '小阵性雨夹雪': '小雨夹雪',
  '中到大阵性雨夹雪': '中到大雨夹雪',
  '附近有零星降雪': '小雪', '零星小雪': '小雪',
  '零星中雪': '中雪', '零星大雪': '大雪',
  '小阵雪': '阵雪',
  '小阵性冰粒': '冰粒', '中到大阵性冰粒': '冰粒',   // 国内规范中冰粒不分强度
  '附近有雷雨': '雷阵雨',
  '雷阵雨伴小冰雹': '雷雨伴冰雹', '雷阵雨伴大冰雹': '雷雨伴大冰雹',
  '雷雪': '雷暴雪',                  // thundersnow 的业务文献中文名
};

/** 天气名 → 卡片上显示的短名。查不到就原样返回 */
export function displayName(conditionName) {
  const k = resolveFxKey(conditionName);
  if (!k) return String(conditionName || '');
  return DISPLAY[k] || k;
}

export const FX_DISPLAY = DISPLAY;

export function resolveFxKey(conditionName) {
  const s = String(conditionName || '').trim();
  return P[s] ? s : fallbackKey(s);
}

// ===== 卡片背景族 =====
// 16 个族,覆盖 71 种天气。降水按强度分档(rain-1…rain-5、snow-1/2、dust-1/2),
// 背景由浅入深,和动效的强度阶梯同向 —— 雨越大,底色越沉。
// 对比度全部实算过,最差一档对 --text-primary 仍有 10.9:1(浅色)/7.5:1(深色)。
const BG = {
  clear:    ['晴'],
  cloudy:   ['晴间少云', '多云'],
  overcast: ['阴'],
  fog:      ['轻雾', '雾', '冻雾', '雾凇'],
  haze:     ['霾'],
  'dust-1': ['浮尘', '扬沙'],
  'dust-2': ['沙尘暴', '强沙尘暴'],
  'rain-1': ['零星小毛毛雨', '小毛毛雨', '毛毛雨', '浓毛毛雨',
             '附近有零星降雨', '零星小雨', '小雨', '小到中雨', '小阵雨'],
  'rain-2': ['间歇性中雨', '中雨', '中到大雨', '雨', '阵雨'],
  'rain-3': ['间歇性大雨', '大雨', '大到暴雨', '强阵雨'],
  'rain-4': ['暴雨', '暴雨到大暴雨'],
  'rain-5': ['大暴雨', '大暴雨到特大暴雨', '特大暴雨'],
  freeze:   ['附近有零星冻毛毛雨', '轻冻毛毛雨', '强冻毛毛雨', '轻冻雨', '冻雨',
             '附近有零星雨夹雪', '小雨夹雪', '雨夹雪', '小阵性雨夹雪', '中到大阵性雨夹雪',
             '米雪', '冰粒', '小阵性冰粒', '中到大阵性冰粒'],
  'snow-1': ['附近有零星降雪', '零星小雪', '小雪', '小到中雪', '零星中雪', '中雪',
             '中到大雪', '小阵雪', '阵雪', '雪'],
  'snow-2': ['零星大雪', '大雪', '大到暴雪', '暴雪', '吹雪', '暴风雪'],
  thunder:  ['附近有雷雨', '雷阵雨', '雷阵雨伴小冰雹', '雷阵雨伴大冰雹', '雷雪'],
};

const BG_OF = {};
for (const [id, names] of Object.entries(BG)) for (const n of names) BG_OF[n] = id;

export const FX_BG_FAMILIES = Object.keys(BG);

/** 天气名 → 背景族 id。查不到返回 null,卡片落回默认玻璃底 */
export function resolveBgKey(conditionName) {
  const k = resolveFxKey(conditionName);
  return k ? (BG_OF[k] || null) : null;
}

/**
 * 把动效粒子渲染进容器。
 * @param {HTMLElement} host  动效层(.wx-fx)
 * @param {string} conditionName  完整天气名,如「大暴雨」「强沙尘暴」
 */
export function renderWeatherFx(host, conditionName) {
  if (!host) return;
  const key = resolveFxKey(conditionName);
  // 卡片变宽就补密,但受 MAX_DENS 和绝对总数上限双重约束 ——
  // 轻量天气(小雨 16 个)按宽度补足,重量天气(特大暴雨 58 个)按总数封顶。
  // 密度分档记进 stamp,窄屏切宽屏(转屏/响应式断点)会重建
  const w = host.offsetWidth || DESIGN_W;
  CARD_W = w;
  const base = key ? baseCount(P[key]) : 1;
  DENS = Math.max(1, Math.min(w / DESIGN_W, MAX_DENS, MAX_PARTICLES / base));
  const stamp = (key || '') + '@' + DENS.toFixed(1);
  // 同一天气同一密度不重建 —— 否则每次刷新粒子都从头开始,看得见「重置」
  if (host.dataset.fx === stamp) return;
  host.dataset.fx = stamp;
  host.textContent = '';
  if (!key) return;

  // env 相同的图层必须共用一个包络容器,不然雨丝和溅点不同相
  const envBox = new Map();
  const boxFor = (env) => {
    if (!env) return host;
    const sig = env.join('|');
    if (!envBox.has(sig)) {
      const b = document.createElement('div');
      b.className = 'fx-env fx-env--' + env[0];
      b.style.cssText = `--ep:${env[1]}s; --emin:${env[2]}; --emax:${env[3]};`;
      host.appendChild(b);
      envBox.set(sig, b);
    }
    return envBox.get(sig);
  };

  for (const layer of P[key]) {
    const build = PRIM[layer.fx];
    if (!build) continue;
    const box = boxFor(layer.env);
    for (const part of build(layer)) {
      const el = document.createElement('span');
      el.className = part.cls;
      el.style.cssText = part.css;
      if (part.html) el.innerHTML = part.html;   // 仅本模块生成的 SVG,无外部输入
      box.appendChild(el);
    }
  }
}
