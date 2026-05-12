// IP 检测(国内 + 国外)+ 天气联动 + 天气城市弹窗
import { fetchT, apiGet, srcTooltip } from './api.js';

// 国内 IP 检测(国内域名,split-tunnel 代理通常不拦截,可能拿到真实 ISP IP;
// 但 pconline/ipip 不发 Access-Control-Allow-Origin,跨域请求看浏览器策略决定)
const DOMESTIC_IP_APIS = [
  { url: 'https://whois.pconline.com.cn/ipJson.jsp?json=true',
    parse: d => d?.ip && !d?.err && { ip:d.ip, city:d.city||d.pro, country:'中国', countryCode:'CN' } },
  { url: 'https://myip.ipip.net',
    text: true,
    parse: t => {
      const ip  = (t.match(/当前 IP[：:]\s*([\d.]+)/) || [])[1];
      const loc = (t.match(/来自于[：:]\s*\S+\s+\S+\s+(\S+)/) || [])[1];
      return ip ? { ip, city: loc||'', country:'中国', countryCode:'CN' } : null;
    }
  },
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

function buildIpDisplay(domestic, google) {
  const locEl = document.getElementById('ip-loc');
  locEl.innerHTML = '';

  function makeEntry(label, info) {
    const wrap = document.createElement('span');
    wrap.className = 'ip-entry';

    const labelEl = document.createElement('span');
    labelEl.className = 'ip-entry-label';
    labelEl.textContent = label;
    wrap.appendChild(labelEl);

    if (!info) {
      wrap.appendChild(document.createTextNode('--'));
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

  locEl.appendChild(makeEntry('国内IP:', domestic));
  locEl.appendChild(makeEntry('国外IP:', google));
}

export async function initLocation() {
  weatherEl = document.getElementById('weather-info');
  const locEl = document.getElementById('ip-loc');
  locEl.textContent = '定位中…';

  async function detectDomestic() {
    for (const api of DOMESTIC_IP_APIS) {
      try {
        const res = await fetchT(api.url, 4000);
        if (!res.ok) continue;
        const info = api.parse(api.text ? await res.text() : await res.json());
        if (info?.ip) return info;
      } catch {}
    }
    return null;
  }

  async function detectGoogle() {
    const apis = [
      { url:'https://ipwho.is/',      parse:d=>d.success&&{ip:d.ip,city:d.city||d.region,country:d.country,countryCode:d.country_code} },
      { url:'https://ipinfo.io/json', parse:d=>d.ip&&{ip:d.ip,city:d.city||d.region,country:d.country,countryCode:d.country} },
      { url:'https://ip.sb/geoip',    parse:d=>d.ip&&{ip:d.ip,city:d.city||d.region,country:d.country,countryCode:d.country_code} },
    ];
    const wrapped = apis.map(async api => {
      const res = await fetchT(api.url, 4000);
      const info = api.parse(await res.json());
      if (!info?.ip) throw new Error('empty');
      return info;
    });
    try { return await Promise.any(wrapped); }
    catch { return null; }
  }

  let domesticInfo = null, googleInfo = null;
  const [domRes, ggRes] = await Promise.allSettled([detectDomestic(), detectGoogle()]);
  if (domRes.status === 'fulfilled') domesticInfo = domRes.value;
  if (ggRes.status  === 'fulfilled') googleInfo   = ggRes.value;

  if (!domesticInfo && !googleInfo) {
    locEl.textContent = '定位失败';
    renderWeather();
    return;
  }

  // 只在拿到 domestic(真实国内 IP)时才自动联动天气
  ipCity = (domesticInfo?.city) || '';
  if (ipCity) document.getElementById('autoCity').placeholder = ipCity;
  renderWeather();
  buildIpDisplay(domesticInfo, googleInfo);
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
