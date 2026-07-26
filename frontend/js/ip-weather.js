// IP 检测(国内 + 国外)+ 天气联动 + 天气城市弹窗
import { fetchT, apiGet, srcTooltip } from './api.js';

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
let weatherEl;

async function fetchWeatherViaBackend(query) {
  try { return await apiGet('/api/weather?' + query); }
  catch { return null; }
}

// F-021:三城天气并行(原本是串行,慢)
async function refreshWeather() {
  const targets = [];
  if (ipCity) targets.push({ key: 'auto', city: ipCity });
  for (const k of ['wxCity1', 'wxCity2']) {
    const c = localStorage.getItem(k);
    if (c) targets.push({ key: k, city: c });
  }

  if (!targets.length) {
    weatherEl.textContent = '天气 --';
    weatherEl.title = '点击设置天气城市';
    return;
  }

  const results = await Promise.allSettled(
    targets.map(t => fetchWeatherViaBackend('city=' + encodeURIComponent(t.city)))
  );

  const parts = [], tooltipParts = [];
  results.forEach((res, i) => {
    if (res.status !== 'fulfilled' || !res.value?.data?.text) return;
    const r = res.value;
    const city = r.data.city || targets[i].city;
    parts.push(`${r.data.text} ${city}`);
    tooltipParts.push(`[${city}] ${srcTooltip(r)}`);
  });

  if (parts.length) {
    weatherEl.textContent = parts.join('   ');
    weatherEl.title = tooltipParts.join('\n\n') + '\n\n点击设置天气城市';
  } else {
    weatherEl.textContent = '天气 --';
    weatherEl.title = '点击设置天气城市';
  }
}

function renderWeather() {
  if (!weatherEl.textContent || weatherEl.textContent === '--') {
    weatherEl.textContent = '天气加载中…';
  }
  refreshWeather().catch(() => { weatherEl.textContent = '天气 --'; });
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
  weatherEl = document.getElementById('weather-info');
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
  weatherEl = weatherEl || document.getElementById('weather-info');
  const wxModal = document.getElementById('weatherModal');
  weatherEl.addEventListener('click', () => {
    document.getElementById('city1').value = localStorage.getItem('wxCity1') || '';
    document.getElementById('city2').value = localStorage.getItem('wxCity2') || '';
    wxModal.classList.add('open');
  });
  document.getElementById('wxCancel').addEventListener('click', () => wxModal.classList.remove('open'));
  wxModal.addEventListener('click', e => { if (e.target === wxModal) wxModal.classList.remove('open'); });
  document.getElementById('wxSave').addEventListener('click', () => {
    localStorage.setItem('wxCity1', document.getElementById('city1').value.trim());
    localStorage.setItem('wxCity2', document.getElementById('city2').value.trim());
    wxModal.classList.remove('open');
    weatherEl.textContent = '更新中…';
    renderWeather();
  });
}
