// IP 检测(国内 + 国外)+ 天气联动 + 天气城市弹窗
import { fetchT, apiGet, srcTooltip } from './api.js';

// 国内 IP 检测 — 浏览器直连国内 API。
// split-tunnel 代理通常把国内域名走直连,故这里拿到的是访客的「国内分流出口 IP」。
// 必须浏览器侧做(后端在境外,代发拿到的是后端 IP)。
// 这 3 个源经实测在常见环境下 CORS 可过;顺序兜底,命中即停。
const DOMESTIC_IP_APIS = [
  // 今日头条 widget — 唯一给到城市级(最适合天气联动)
  { url: 'https://www.toutiao.com/stream/widget/local_weather/data/',
    parse: d => d?.data?.ip
      ? { ip: d.data.ip, city: d.data.city || '', country: '中国', countryCode: 'CN' }
      : null },
  // mir6 — 给省份
  { url: 'https://api.mir6.com/api/ip?type=json',
    parse: d => d?.data?.ip
      ? { ip: d.data.ip,
          city: String(d.data.city || d.data.province || '').replace(/[省市]$/, ''),
          country: '中国', countryCode: 'CN' }
      : null },
  // ipip.net — 纯文本,给省份(正则取第 2 段 = 省,不是第 3 段 ISP)
  { url: 'https://myip.ipip.net', text: true,
    parse: t => {
      const ip  = (t.match(/当前 IP[：:]\s*([\d.]+)/) || [])[1];
      const loc = (t.match(/来自于[：:]\s*\S+\s+(\S+)/) || [])[1];
      return ip ? { ip, city: loc || '', country: '中国', countryCode: 'CN' } : null;
    } },
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

// domestic = 浏览器侧检测的国内分流 IP
// viaSite  = 后端 /api/ip 返回的「访问本站(境外域名)所用的 IP」
// 两者相同 → 你访问本站走的是直连;不同 → viaSite 即你的境外出口 IP
function buildIpDisplay(domestic, viaSite) {
  const locEl = document.getElementById('ip-loc');
  locEl.innerHTML = '';

  locEl.appendChild(makeIpEntry('国内IP:', domestic));

  if (domestic && viaSite && domestic.ip === viaSite.ip) {
    const e = makeIpEntry('国外IP:', null, '本站直连');
    e.title = '你访问本站(hi.xzsjno1.com,境外域名)走的是直连,出口 IP 与国内相同'
            + ' —— 即当前未对本站启用代理';
    locEl.appendChild(e);
  } else {
    const e = makeIpEntry('国外IP:', viaSite);
    if (viaSite) e.title = '你访问本站所用的 IP(后端实测,非缓存)';
    locEl.appendChild(e);
  }
}

export async function initLocation() {
  weatherEl = document.getElementById('weather-info');
  const locEl = document.getElementById('ip-loc');
  locEl.textContent = '定位中…';

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

  // 国外 IP:后端 /api/ip(读 X-Forwarded-For + 服务端 geo,同源、无 CORS、无 403)
  async function detectViaSite() {
    try {
      const r = await apiGet('/api/ip');
      return r?.data?.ip ? r.data : null;
    } catch { return null; }
  }

  let domesticInfo = null, viaSiteInfo = null;
  const [domRes, siteRes] = await Promise.allSettled([detectDomestic(), detectViaSite()]);
  if (domRes.status  === 'fulfilled') domesticInfo = domRes.value;
  if (siteRes.status === 'fulfilled') viaSiteInfo  = siteRes.value;

  if (!domesticInfo && !viaSiteInfo) {
    locEl.textContent = '定位失败';
    renderWeather();
    return;
  }

  // 只在拿到 domestic(真实国内 IP)时才自动联动天气
  ipCity = (domesticInfo?.city) || '';
  if (ipCity) document.getElementById('autoCity').placeholder = ipCity;
  renderWeather();
  buildIpDisplay(domesticInfo, viaSiteInfo);
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
