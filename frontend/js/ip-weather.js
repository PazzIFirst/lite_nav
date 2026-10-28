// IP 检测(国内 + 国外)+ 天气联动 + 天气城市弹窗
import { fetchT, apiGet, srcTooltip } from './api.js';
import { renderWeatherFx, resolveBgKey, displayName } from './weather-fx.js';
import { renderWeatherIcon } from './weather-icons.js';

// 国内 IP 检测 — 浏览器直连国内 IP 服务。多源并行,IP 与城市分两路取:
//
//   · IP   只认 `v4only` 源 —— 域名仅有 A 记录,浏览器无 IPv6 可选、被迫走 IPv4,
//          测到的必然是你的 IPv4 出口地址。双栈源(toutiao 有 AAAA=240e:...)在
//          IPv6 优先的客户端上返回的是 v6 地址,其 ip 字段一律不采信。
//   · 城市 取「城市级」源优先(今日头条到市,其余只到省)→ 天气联动更准。
//
// 注:`v4only` 只是声明该域名当前仅有 A 记录,合并时仍用 IPV4_RE 复核返回值,
//     源方哪天加了 AAAA 也不会把 IPv6 当成 IPv4 显示出来。
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

// 下列 v4only 源均已实测:域名仅 A 记录无 AAAA、响应带 CORS 头、返回纯文本 IPv4。
// 选源还有一条隐性约束:域名必须是分流规则会判为「直连」的国内服务 —— 境外托管的
// v4 源(如 v4.myip.la,A 记录在 Vultr)会被代理接管,测出代理出口 IPv4,
// 那是错的「国内 IP」,比显示 IPv6 更具误导性,故不采用。
const DOMESTIC_IP_APIS = [
  // DNSPod IPv4 专用端点 — 纯文本,只回 IP 无城市
  { url: 'https://ipv4.ddnspod.com', v4only: true, text: true,
    parse: t => ({ ip: String(t).trim() }) },
  // zxinc IPv6 数据库项目的 v4 端点 — 同为纯文本
  { url: 'https://v4.ip.zxinc.org/getip', v4only: true, text: true,
    parse: t => ({ ip: String(t).trim() }) },
  // mir6 — 省级;实测域名双栈(AAAA=2404:2280:...)且会直接返回 IPv6,故不标 v4only
  { url: 'https://api.mir6.com/api/ip?type=json', level: 'province',
    parse: d => d?.data?.ip
      ? { ip: d.data.ip,
          city: String(d.data.city || d.data.province || '').replace(/[省市]$/, '') }
      : null },
  // 今日头条 widget — 城市级;域名双栈,同样不标 v4only,只采它的 city
  { url: 'https://www.toutiao.com/stream/widget/local_weather/data/', level: 'city',
    parse: d => d?.data?.ip
      ? { ip: d.data.ip, city: d.data.city || '' }
      : null },
];
// 已移除 myip.ipip.net:该域名确为 IPv4-only(无 AAAA),本可当强制 v4 源,
// 但实测响应头无 Access-Control-Allow-Origin,浏览器跨域必被拦 —— 用不了。

// 国外 IP 检测 — 浏览器直连境外 IP 服务。
// 你的分流代理按规则路由这些请求:走代理的线路 → 服务看到你的代理出口 IP。
// 故这里反映「你访问境外站点所用的 IP」。顺序兜底,命中即停。
const FOREIGN_IP_APIS = [
  { url: 'https://ipinfo.io/json',
    parse: d => d?.ip
      ? { ip: d.ip, city: d.city || d.region || '', country: d.country || '', countryCode: d.country || '' }
      : null },
  { url: 'https://ipapi.co/json/',
    parse: d => d?.ip
      ? { ip: d.ip, city: d.city || d.region || '',
          country: d.country_name || d.country || '', countryCode: d.country_code || d.country || '' }
      : null },
  { url: 'https://api.ipify.org?format=json',
    parse: d => d?.ip ? { ip: d.ip, city: '', country: '', countryCode: '' } : null },
];

let ipCity = '';
let wxCard, wxTempEl, wxCityEl, wxNameEl, wxCityBtn;

// 当前选中的城市槽位('auto' | 'wxCity1' | 'wxCity2'),记进 localStorage
const WX_ACTIVE_KEY = 'wxActiveCity';
let wxList = [];   // 本轮成功拿到天气的城市,顺序即槽位顺序
let wxIdx  = 0;

function grabWeatherEls() {
  wxCard    = wxCard    || document.getElementById('weatherCard');
  wxTempEl  = wxTempEl  || document.getElementById('wxTemp');
  wxCityEl  = wxCityEl  || document.getElementById('wxCity');
  wxNameEl  = wxNameEl  || document.getElementById('wxName');
  wxCityBtn = wxCityBtn || document.getElementById('wxCityBtn');
}

async function fetchWeatherViaBackend(query) {
  try { return await apiGet('/api/weather?' + query); }
  catch { return null; }
}

// 后端新版返回 temp/condition 结构化字段,但 Redis 里还躺着老格式的缓存
// (hot 30 分钟、lastgood 30 天),那些只有拼好的 text。拆回来兜底。
function splitLegacyText(text) {
  // 温度可能带小数(中国天气网回 "阴 36.6°"),别漏了 \.\d+
  const m = /^(.*?)\s*(-?\d+(?:\.\d+)?)\s*°\s*$/.exec(String(text || '').trim());
  if (m) return { condition: m[1].trim(), temp: Math.round(Number(m[2])) };
  return { condition: String(text || '').trim(), temp: null };
}

function paintWeatherCard(temp, condition, city, tooltip) {
  if (!wxCard) return;
  const multi = wxList.length > 1;
  wxTempEl.textContent = (temp == null || Number.isNaN(temp)) ? '--°' : temp + '°';
  wxCityEl.textContent = city || '--';
  // 卡片上用短名(约 92px 放不下「附近有零星冻毛毛雨」这种),
  // 完整名称仍在 tooltip 里,信息不丢
  wxNameEl.textContent = condition ? displayName(condition) : '--';
  // 背景族 15 个,按强度分档(rain-1…4 等),查不到就落回默认玻璃底
  wxCard.dataset.bg = resolveBgKey(condition) || 'unknown';
  wxCard.classList.toggle('has-more', multi);   // 控制城市名旁的小箭头显隐
  wxCard.title = (tooltip ? tooltip + '\n\n' : '')
    + (multi ? '点城市名切换城市 · ' : '') + '点卡片设置天气城市';
  // 动效按「完整天气名」查预设(28 种各一套),不是按 8 个大组 ——
  // 大组粒度下小雨和特大暴雨长得一模一样,这正是之前「雨没区别」的原因
  renderWeatherFx(document.getElementById('wxFx'), condition);
  renderWeatherIcon(document.getElementById('wxIcon'), condition);
}

// 画当前选中的那个城市;tooltip 里把全部城市列出来,选中项打 ▸
function paintActive() {
  if (!wxList.length) { paintWeatherCard(null, '', '', ''); return; }
  if (wxIdx >= wxList.length) wxIdx = 0;
  const it = wxList[wxIdx];
  const tip = wxList.map((x, i) =>
    `${i === wxIdx ? '▸' : ' '} [${x.city}] ${x.condition} ${x.temp == null ? '--' : x.temp}°\n   ${x.tooltip.replace(/\n/g, '\n   ')}`
  ).join('\n\n');
  paintWeatherCard(it.temp, it.condition, it.city, tip);
}

function cycleCity() {
  if (wxList.length < 2) return;
  wxIdx = (wxIdx + 1) % wxList.length;
  try { localStorage.setItem(WX_ACTIVE_KEY, wxList[wxIdx].key); } catch (_) {}
  paintActive();
}

// F-021:多城天气并行。卡片只展示第一个成功的城市,其余进 tooltip。
async function refreshWeather() {
  grabWeatherEls();
  const targets = [];
  if (ipCity) targets.push({ key: 'auto', city: ipCity });
  for (const k of ['wxCity1', 'wxCity2']) {
    const c = localStorage.getItem(k);
    if (c) targets.push({ key: k, city: c });
  }

  if (!targets.length) {
    wxList = [];
    paintWeatherCard(null, '', '', '');
    return;
  }

  const results = await Promise.allSettled(
    targets.map(t => fetchWeatherViaBackend('city=' + encodeURIComponent(t.city)))
  );

  wxList = [];
  results.forEach((res, i) => {
    const d = res.status === 'fulfilled' ? res.value?.data : null;
    if (!d || (!d.text && d.temp == null)) return;
    const legacy = splitLegacyText(d.text);
    wxList.push({
      key:       targets[i].key,
      temp:      d.temp != null ? d.temp : legacy.temp,
      condition: d.condition || legacy.condition,
      city:      d.city || targets[i].city,
      tooltip:   srcTooltip(res.value),
    });
  });

  // 恢复上次选的城市。它可能已经被删了(或这次没拉到),那就退回第一个
  const saved = localStorage.getItem(WX_ACTIVE_KEY);
  const at = wxList.findIndex(x => x.key === saved);
  wxIdx = at >= 0 ? at : 0;
  paintActive();
}

function renderWeather() {
  grabWeatherEls();
  if (wxNameEl && wxNameEl.textContent === '--') wxNameEl.textContent = '加载中…';
  refreshWeather().catch(() => paintWeatherCard(null, '', '', ''));
}

function makeIpEntry(label, info, fallbackText) {
  const wrap = document.createElement('span');
  wrap.className = 'ip-entry';

  const labelEl = document.createElement('span');
  labelEl.className = 'ip-entry-label';
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  if (!info) {
    wrap.appendChild(document.createTextNode(fallbackText || '--'));
    return wrap;
  }

  const cc = info.countryCode;
  if (cc && /^[A-Za-z]{2}$/.test(cc)) {
    const flag = document.createElement('img');
    const lc = cc.toLowerCase();
    flag.src = 'flags/' + lc + '.png';
    flag.onerror = () => { flag.onerror = null; flag.src = 'https://flagcdn.com/16x12/' + lc + '.png'; };
    flag.width = 16; flag.height = 12;
    flag.alt = cc;
    flag.style.cssText = 'vertical-align:middle;border-radius:2px;margin-right:3px;';
    wrap.appendChild(flag);
  }

  const loc = info.city
    ? (cc === 'CN' ? info.city : `${info.city} ${info.country || ''}`.trim())
    : (info.country || '');
  if (loc) wrap.appendChild(document.createTextNode(loc));

  const ipEl = document.createElement('span');
  ipEl.className = 'ip-entry-addr';
  ipEl.textContent = info.ip || '';
  wrap.appendChild(ipEl);

  return wrap;
}

// domestic = 浏览器请求国内 IP 服务测得 — 你访问国内站点所用的 IP
// foreign  = 浏览器请求境外 IP 服务测得 — 你访问境外站点所用的 IP
// 两个独立测量。开了代理且代理走境外线路时,foreign 即代理出口 IP。
function buildIpDisplay(domestic, foreign) {
  const locEl = document.getElementById('ip-loc');
  locEl.innerHTML = '';

  const de = makeIpEntry('国内IP:', domestic);
  de.title = '你访问国内站点所用的 IP(浏览器实测国内 IP 服务)'
    + (domestic?.ip?.includes(':')
        ? '\n⚠ 所有 IPv4 专用源均未响应,当前显示的是 IPv6 出口地址'
        : '');
  locEl.appendChild(de);

  const fe = makeIpEntry('国外IP:', foreign);
  if (foreign) fe.title = '你访问境外站点所用的 IP(浏览器实测境外 IP 服务)。\n'
                        + '开了代理且该线路走代理时,这里即代理出口 IP。';
  locEl.appendChild(fe);
}

export async function initLocation() {
  grabWeatherEls();
  const locEl = document.getElementById('ip-loc');
  locEl.textContent = '定位中…';

  // 国外:顺序兜底,逐个试,命中即停(后续不再发请求 → console 干净)
  async function detectChain(apis) {
    for (const api of apis) {
      try {
        const res = await fetchT(api.url, 4500, { cache: 'no-store' });
        if (!res.ok) continue;
        const info = api.parse(api.text ? await res.text() : await res.json());
        if (info?.ip) return info;
      } catch {}
    }
    return null;
  }

  // 国内:多源并行,合并 —— IP 取「强制 IPv4」源,城市取「城市级」源
  async function detectDomestic() {
    const settled = await Promise.allSettled(DOMESTIC_IP_APIS.map(async api => {
      const res = await fetchT(api.url, 4500, { cache: 'no-store' });
      if (!res.ok) throw 0;
      const info = api.parse(api.text ? await res.text() : await res.json());
      if (!info?.ip) throw 0;
      return { ...info, _level: api.level, _v4only: !!api.v4only };
    }));
    // allSettled 保序,filter/find 亦保序 → find 命中的就是声明顺序上的最优源
    const got = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
    if (!got.length) return null;

    // IPv4 三级择优:强制 v4 源 → 双栈源恰好给了 v4 → 全是 v6 时兜底(有总比没有强)
    const ip = got.find(g => g._v4only && IPV4_RE.test(g.ip))?.ip
            || got.find(g => IPV4_RE.test(g.ip))?.ip
            || got[0].ip;
    const city = (got.find(g => g._level === 'city' && g.city)
                  || got.find(g => g.city) || got[0]).city || '';              // 城市级优先
    return { ip, city, country: '中国', countryCode: 'CN' };
  }

  // 国内、国外两路并行,各自独立测量
  const [domRes, fgRes] = await Promise.allSettled([
    detectDomestic(),
    detectChain(FOREIGN_IP_APIS),
  ]);
  const domestic = domRes.status === 'fulfilled' ? domRes.value : null;
  const foreign  = fgRes.status === 'fulfilled' ? fgRes.value : null;

  if (!domestic && !foreign) {
    locEl.textContent = '定位失败';
    renderWeather();
    return;
  }

  // 天气联动城市:用国内 IP 的城市,去掉末尾「省/市」便于后端地理编码
  ipCity = (domestic?.city || '').replace(/[省市]$/, '');
  if (ipCity) document.getElementById('autoCity').placeholder = ipCity;
  renderWeather();
  buildIpDisplay(domestic, foreign);
}

export function initWeatherModal() {
  grabWeatherEls();
  const wxModal = document.getElementById('weatherModal');
  const openModal = () => {
    document.getElementById('city1').value = localStorage.getItem('wxCity1') || '';
    document.getElementById('city2').value = localStorage.getItem('wxCity2') || '';
    wxModal.classList.add('open');
  };
  wxCard.addEventListener('click', openModal);
  // 卡片是 role="button",键盘也得能开
  wxCard.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(); }
  });
  // 城市名区域:多城市时切换,单城市时不拦截 —— 让点击冒泡上去开设置,不做死控件
  wxCityBtn.addEventListener('click', e => {
    if (wxList.length < 2) return;
    e.stopPropagation();
    cycleCity();
  });

  document.getElementById('wxCancel').addEventListener('click', () => wxModal.classList.remove('open'));
  wxModal.addEventListener('click', e => { if (e.target === wxModal) wxModal.classList.remove('open'); });
  document.getElementById('wxSave').addEventListener('click', () => {
    const prev1 = localStorage.getItem('wxCity1') || '';
    const prev2 = localStorage.getItem('wxCity2') || '';
    const next1 = document.getElementById('city1').value.trim();
    const next2 = document.getElementById('city2').value.trim();
    localStorage.setItem('wxCity1', next1);
    localStorage.setItem('wxCity2', next2);
    // 刚填/刚改了哪个槽位,就跳到哪个 —— 否则填完还停在「自动」,像是没生效
    if      (next1 && next1 !== prev1) localStorage.setItem(WX_ACTIVE_KEY, 'wxCity1');
    else if (next2 && next2 !== prev2) localStorage.setItem(WX_ACTIVE_KEY, 'wxCity2');
    wxModal.classList.remove('open');
    wxNameEl.textContent = '更新中…';
    renderWeather();
  });
}
