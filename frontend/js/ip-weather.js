// IP 检测(国内 + 国外)+ 天气联动 + 天气城市弹窗
import { fetchT, apiGet, srcTooltip } from './api.js';

// 国内 IP 检测 — 浏览器直连国内 IP 服务。分流代理通常把国内域名走直连,
// 故这里测得「你访问国内站点所用的 IP」。顺序兜底,命中即停。
// ipip 放第一:其域名无 AAAA 记录,强制走 IPv4 → 返回 IPv4(双栈用户不会拿到一长串 IPv6)。
const DOMESTIC_IP_APIS = [
  // ipip.net — 域名 IPv4-only,强制 IPv4;纯文本,省份级(正则取第 2 段 = 省)
  { url: 'https://myip.ipip.net', text: true,
    parse: t => {
      const ip  = (t.match(/当前 IP[：:]\s*([\d.]+)/) || [])[1];
      const loc = (t.match(/来自于[：:]\s*\S+\s+(\S+)/) || [])[1];
      return ip ? { ip, city: loc || '', country: '中国', countryCode: 'CN' } : null;
    } },
  // mir6 — 省份级
  { url: 'https://api.mir6.com/api/ip?type=json',
    parse: d => d?.data?.ip
      ? { ip: d.data.ip,
          city: String(d.data.city || d.data.province || '').replace(/[省市]$/, ''),
          country: '中国', countryCode: 'CN' }
      : null },
  // 今日头条 widget — 城市级,但域名双栈,可能返回 IPv6
  { url: 'https://www.toutiao.com/stream/widget/local_weather/data/',
    parse: d => d?.data?.ip
      ? { ip: d.data.ip, city: d.data.city || '', country: '中国', countryCode: 'CN' }
      : null },
];

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
  de.title = '你访问国内站点所用的 IP(浏览器实测国内 IP 服务)';
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

  // 顺序兜底:逐个试 apis,命中即停(后续不再发请求 → console 干净)
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

  // 国内、国外两路并行,各自独立测量
  const [domRes, fgRes] = await Promise.allSettled([
    detectChain(DOMESTIC_IP_APIS),
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
