// 天气卡动效 —— 按「完整天气名」查预设,38 种各有各的粒子参数。
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

// ===== 38 种天气预设 =====
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
  // 多云:太阳还在,所以留一团比「晴间少云」小的光晕;云比它多一朵,但别压到
  // 「阴」那个量级 —— 原来 4 朵 0.66 的云飘满整卡,缩略看就是个阴天
  '多云': [
    { fx: 'glow', size: 88, top: -6, right: -6, color: 'var(--fx-sun)', dur: 9, scale: [1, 1.05] },
    { fx: 'cloud', n: 3, dur: [20, 28], w: [60, 104], h: [22, 32], top: [-10, 46], blur: 10, opacity: 0.50 },
  ],
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

  /* ── 降雨 (4) ─ 只保留四档,且视觉整体上移一档:
     小雨=原中雨 / 中雨=原暴雨 / 大雨=原大暴雨 / 暴雨=原特大暴雨。
     其余雨名(毛毛雨、小到中雨、阵雨、特大暴雨…)由 fallbackKey 归并到这四档 ——
     过去 23 种液态雨里有 19 种长在同一张图上,档与档只差几点密度。 ── */
  '小雨': [...rainStack({ n: 32, dur: [0.51, 0.6], len: [16, 24], w: 1.7, tilt: 8, opacity: 0.54 })],
  '中雨': [
    ...rainStack({ n: 66, dur: [0.28, 0.33], len: [32, 47], w: 2.55, tilt: 16, opacity: 0.75 }),
    { fx: 'splash', n: 8, dur: [0.6, 0.9], size: 5, opacity: 0.28 },
  ],
  '大雨': [
    ...rainStack({ n: 76, dur: [0.2, 0.24], len: [38, 56], w: 2.8, tilt: 20, opacity: 0.84 }),
    { fx: 'splash', n: 10, dur: [0.45, 0.68], size: 7, opacity: 0.38 },
  ],
  '暴雨': [
    ...rainStack({ n: 86, dur: [0.14, 0.17], len: [46, 68], w: 3.1, tilt: 24, opacity: 0.92 }),
    { fx: 'splash', n: 12, dur: [0.34, 0.51], size: 9, opacity: 0.48 },
  ],

  /* ── 冻雨 (1) ─ 慢且近垂直,靠速度而不是密度和雨区分 ── */
  '冻雨': [
    ...rainStack({ n: 34, dur: [0.95, 1.11], len: [19, 28], w: 2, tilt: 5, opacity: 0.57 }),
    { fx: 'glaze', n: 20, dur: [2.6, 4.2], size: 3, opacity: 0.62 },
  ],

  /* ── 雨夹雪 (1) ─ 只留一档:雨相直接取降雨第 2 档(中雨),再叠一层雪花 ── */
  '雨夹雪': [
    ...rainStack({ n: 66, dur: [0.28, 0.33], len: [32, 47], w: 2.55, tilt: 16, opacity: 0.75 }),
    ...snowStack({ n: 18, dur: [3.2, 4.6], size: [4.2, 5.8], dx: 14, opacity: 0.88 }),
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

  /* ── 其它固态 (3) ───────────────────────────────────────── */
  '米雪': [{ fx: 'pellet', n: 14, dur: [2.2, 3.2], size: 2, opacity: 0.65 }],
  '冰粒': [
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

  /* ── 雷暴 (1) ─ 只留「雷阵雨」:冰雹 / 雷雪 / 附近有雷雨全部并入;
     雨相取降雨第 3 档(大雨),闪电仍是「啪-啪…(长静默)」 ── */
  '雷阵雨': [
    { fx: 'cloud', n: 2, dur: [16, 24], w: [96, 150], h: [32, 46], top: [-20, 44], blur: 13, opacity: 0.80 },
    ...rainStack({ n: 76, dur: [0.2, 0.24], len: [38, 56], w: 2.8, tilt: 20, opacity: 0.84 }),
    { fx: 'flash', k: 'storm', period: 7 },
    { fx: 'bolt', k: 'storm', period: 7 },
  ],
};

export const FX_PRESETS = P;
export const FX_CONDITIONS = Object.keys(P);

// 查不到完整天气名时的退路。三个上游的文案不完全在词表内(比如中国天气网
// 偶尔回「小雨-中雨」这类连字符写法),按关键字降到最近的档,总比没有强。
function fallbackKey(name) {
  const s = String(name || '');
  if (!s) return null;
  // 雷雨只剩一档:冰雹、雷雪、附近有雷雨一律并入
  if (/雷/.test(s)) return '雷阵雨';
  if (/冻.*毛毛雨/.test(s)) return '冻雨';   // 冻毛毛雨并入冻雨:同一类,只差落速
  if (/冻雨/.test(s)) return '冻雨';
  if (/雨夹雪/.test(s)) return '雨夹雪';
  if (/米雪/.test(s)) return '米雪';
  if (/冰粒/.test(s)) return '冰粒';
  if (/暴雪/.test(s)) return '暴雪';
  if (/大雪/.test(s)) return '大雪';
  if (/中雪/.test(s)) return '中雪';
  if (/小雪|阵雪|雪/.test(s)) return /阵/.test(s) ? '阵雪' : '小雪';
  // 液态雨只保留 4 档,其余口径一律归并 —— 顺序有讲究:阵雨要先于「雨」,
  // 特大暴雨/大暴雨要先于「暴雨」,毛毛雨要先于「雨」
  if (/毛毛雨/.test(s)) return '小雨';
  if (/强阵雨/.test(s)) return '大雨';
  if (/阵雨/.test(s)) return '中雨';        // 阵雨=对流雨,按量级并入中雨
  if (/特大暴雨|大暴雨/.test(s)) return '暴雨';
  if (/暴雨/.test(s)) return '暴雨';
  if (/大雨/.test(s)) return '大雨';
  if (/中雨/.test(s)) return '中雨';
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
// 这是纯显示层:内部标识仍驱动 38 种动效和 30 套图标,合并显示名
// 不损失视觉区分度;完整名称保留在卡片 tooltip 里。
const DISPLAY = {
  '晴间少云': '晴间多云',            // 「少云」是观测云量术语,预报用语是「晴间多云」
  // 液态雨已收敛成 4 个键,不再需要合并显示名;冻结型(冻毛毛雨/雨夹雪)留着
  '附近有零星降雪': '小雪', '零星小雪': '小雪',
  '零星中雪': '中雪', '零星大雪': '大雪',
  '小阵雪': '阵雪',
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
// 15 个族,覆盖 52 种天气。降水按强度分档(rain-1…4、snow-1/2、dust-1/2),
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
  'rain-1': ['小雨'],
  'rain-2': ['中雨'],
  'rain-3': ['大雨'],
  'rain-4': ['暴雨'],
  freeze:   ['冻雨', '雨夹雪', '米雪', '冰粒'],
  'snow-1': ['附近有零星降雪', '零星小雪', '小雪', '小到中雪', '零星中雪', '中雪',
             '中到大雪', '小阵雪', '阵雪', '雪'],
  'snow-2': ['零星大雪', '大雪', '大到暴雪', '暴雪', '吹雪', '暴风雪'],
  thunder:  ['雷阵雨'],
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
