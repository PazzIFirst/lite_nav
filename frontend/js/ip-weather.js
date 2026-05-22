// IP 检测(国内 + 国外)+ 天气联动 + 天气城市弹窗
import { fetchT, apiGet, srcTooltip } from './api.js';

// 国内 IP 检测 — 浏览器直连国内 API,顺序兜底,命中即停。
// 仅在「经代理访问本站」时才需要(直连时 /api/ip 已给出国内 IP,见 initLocation)。
// ipip 放第一:其域名无 AAAA 记录,强制走 IPv4 → 返回 IPv4,与 /api/ip 统一,
// 避免双栈用户这里拿到一长串 IPv6、跟 /api/ip 的 IPv4 对不上。
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

// domestic = 你的国内 IP(直连访问本站时 = /api/ip 结果;经代理时 = 浏览器侧检测)
// foreign  = 你的境外出口 IP(仅经代理访问本站时有值;直连时为 null → 显示「本站直连」)
function buildIpDisplay(domestic, foreign) {
  const locEl = document.getElementById('ip-loc');
  locEl.innerHTML = '';

  locEl.appendChild(makeIpEntry('国内IP:', domestic));

  if (foreign) {
    const e = makeIpEntry('国外IP:', foreign);
    e.title = '你经代理访问本站所用的境外出口 IP(后端实测)';
    locEl.appendChild(e);
  } else {
    const e = makeIpEntry('国外IP:', null, '本站直连');
    e.title = '你访问本站走的是直连(用国内 IP),未经境外代理。\n'
            + '本站只有一台服务器,无法测出你访问谷歌等被墙网站时的出口 IP。';
    locEl.appendChild(e);
  }
}

export async function initLocation() {
  weatherEl = document.getElementById('weather-info');
  const locEl = document.getElementById('ip-loc');
  locEl.textContent = '定位中…';

  // 访问本站所用的 IP:后端 /api/ip(读 XFF + 服务端 geo,同源无 CORS)
  // hi.xzsjno1.com 无 AAAA → 永远 IPv4;ip-api.com → 城市级
  async function detectViaSite() {
    try {
      const r = await apiGet('/api/ip');
      return r?.data?.ip ? r.data : null;
    } catch { return null; }
  }

  // 国内 IP:浏览器顺序兜底直连国内 API(命中即停 → 后续不发请求 → console 干净)
  async function detectDomestic() {
    for (const api of DOMESTIC_IP_APIS) {
      try {
        const res = await fetchT(api.url, 4500, { cache: 'no-store' });
        if (!res.ok) continue;
        const info = api.parse(api.text ? await res.text() : await res.json());
        if (info?.ip) return info;
      } catch {}
    }
    return null;
  }

  const viaSite = await detectViaSite();
  let domestic, foreign;

  if (viaSite && viaSite.countryCode === 'CN') {
    // 用国内 IP 访问本站 = 直连。viaSite 本身(IPv4 + 城市级)即你的国内 IP,
    // 无需再做浏览器侧检测 → 不发任何第三方请求,console 全静。
    domestic = viaSite;
    foreign  = null;
  } else {
    // 经代理访问本站:viaSite 是境外出口;国内 IP 需浏览器侧检测
    domestic = await detectDomestic();
    foreign  = viaSite;
  }

  if (!domestic && !foreign) {
    locEl.textContent = '定位失败';
    renderWeather();
    return;
  }

  // 天气联动城市:去掉末尾「省/市」便于后端地理编码
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
