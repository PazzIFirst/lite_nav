// 6 城市时钟 + 时区编辑弹窗

const CITY_TZ = {
  '北京':'Asia/Shanghai','上海':'Asia/Shanghai','广州':'Asia/Shanghai','深圳':'Asia/Shanghai',
  '成都':'Asia/Shanghai','武汉':'Asia/Shanghai','杭州':'Asia/Shanghai','香港':'Asia/Hong_Kong',
  '澳门':'Asia/Macau','台北':'Asia/Taipei',
  '东京':'Asia/Tokyo','大阪':'Asia/Tokyo','Tokyo':'Asia/Tokyo','Osaka':'Asia/Tokyo',
  '首尔':'Asia/Seoul','Seoul':'Asia/Seoul',
  '新加坡':'Asia/Singapore','Singapore':'Asia/Singapore',
  '曼谷':'Asia/Bangkok','Bangkok':'Asia/Bangkok',
  '雅加达':'Asia/Jakarta','Jakarta':'Asia/Jakarta',
  '孟买':'Asia/Kolkata','德里':'Asia/Kolkata','新德里':'Asia/Kolkata',
  'Mumbai':'Asia/Kolkata','Delhi':'Asia/Kolkata','Kolkata':'Asia/Kolkata',
  '迪拜':'Asia/Dubai','Dubai':'Asia/Dubai',
  '伊斯坦布尔':'Europe/Istanbul','Istanbul':'Europe/Istanbul',
  '莫斯科':'Europe/Moscow','Moscow':'Europe/Moscow',
  '伦敦':'Europe/London','London':'Europe/London',
  '巴黎':'Europe/Paris','Paris':'Europe/Paris',
  '柏林':'Europe/Berlin','Berlin':'Europe/Berlin',
  '马德里':'Europe/Madrid','Madrid':'Europe/Madrid',
  '罗马':'Europe/Rome','Rome':'Europe/Rome',
  '阿姆斯特丹':'Europe/Amsterdam','Amsterdam':'Europe/Amsterdam',
  '苏黎世':'Europe/Zurich','Zurich':'Europe/Zurich',
  '开罗':'Africa/Cairo','Cairo':'Africa/Cairo',
  '内罗毕':'Africa/Nairobi','Nairobi':'Africa/Nairobi',
  '拉各斯':'Africa/Lagos','Lagos':'Africa/Lagos',
  '约翰内斯堡':'Africa/Johannesburg','Johannesburg':'Africa/Johannesburg',
  '纽约':'America/New_York','NewYork':'America/New_York','New York':'America/New_York',
  '洛杉矶':'America/Los_Angeles','LosAngeles':'America/Los_Angeles','Los Angeles':'America/Los_Angeles',
  '芝加哥':'America/Chicago','Chicago':'America/Chicago',
  '旧金山':'America/Los_Angeles','SanFrancisco':'America/Los_Angeles',
  '西雅图':'America/Los_Angeles','Seattle':'America/Los_Angeles',
  '波士顿':'America/New_York','Boston':'America/New_York',
  '华盛顿':'America/New_York','Washington':'America/New_York',
  '多伦多':'America/Toronto','Toronto':'America/Toronto',
  '温哥华':'America/Vancouver','Vancouver':'America/Vancouver',
  '墨西哥城':'America/Mexico_City','MexicoCity':'America/Mexico_City',
  '圣保罗':'America/Sao_Paulo','SaoPaulo':'America/Sao_Paulo',
  '悉尼':'Australia/Sydney','Sydney':'Australia/Sydney',
  '墨尔本':'Australia/Melbourne','Melbourne':'Australia/Melbourne',
  '珀斯':'Australia/Perth','Perth':'Australia/Perth',
  '奥克兰':'Pacific/Auckland','Auckland':'Pacific/Auckland',
  '檀香山':'Pacific/Honolulu','Honolulu':'Pacific/Honolulu',
};

function lookupTz(name) {
  if (!name) return null;
  if (CITY_TZ[name]) return CITY_TZ[name];
  const k = name.trim().toLowerCase().replace(/\s+/g,'');
  for (const [kk, v] of Object.entries(CITY_TZ))
    if (kk.toLowerCase().replace(/\s+/g,'') === k) return v;
  try { new Intl.DateTimeFormat('en', { timeZone: name }); return name; } catch {}
  return null;
}

const DEFAULT_CLOCKS = [
  { name:'北京',   tz:'Asia/Shanghai'      },
  { name:'纽约',   tz:'America/New_York'   },
  { name:'伦敦',   tz:'Europe/London'      },
  { name:'东京',   tz:'Asia/Tokyo'         },
  { name:'悉尼',   tz:'Australia/Sydney'   },
  { name:'迪拜',   tz:'Asia/Dubai'         },
];

let clockCities = (() => {
  try {
    const v = JSON.parse(localStorage.getItem('clockCities'));
    if (!Array.isArray(v) || !v.length) return DEFAULT_CLOCKS;
    const valid = v.filter(x => x && typeof x.name === 'string' && typeof x.tz === 'string');
    return valid.length ? valid : DEFAULT_CLOCKS;
  } catch { return DEFAULT_CLOCKS; }
})();

const clockFmts = {};
function getClockFmt(tz) {
  if (!clockFmts[tz]) clockFmts[tz] = {
    tf: new Intl.DateTimeFormat('zh-CN', { timeZone:tz, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }),
    df: new Intl.DateTimeFormat('zh-CN', { timeZone:tz, month:'numeric', day:'numeric', weekday:'short' }),
  };
  return clockFmts[tz];
}

let editingClockIdx = -1;
let clockModal;

function openClockModal(idx) {
  editingClockIdx = idx;
  document.getElementById('clockCityName').value = clockCities[idx].name;
  document.getElementById('clockTzInput').value   = clockCities[idx].tz;
  document.getElementById('clockHint').textContent = '';
  clockModal.classList.add('open');
  setTimeout(() => document.getElementById('clockCityName').focus(), 50);
}

export function renderClockCards() {
  const c = document.getElementById('cityClocks'); c.innerHTML = '';
  clockCities.forEach((city, idx) => {
    const card = document.createElement('div');
    card.className = 'clock-card'; card.dataset.idx = idx;
    card.innerHTML = `<div class="clock-city"></div><div class="clock-time" id="ct-${idx}">--:--</div><div class="clock-date" id="cd-${idx}">--</div>`;
    card.firstChild.textContent = city.name;
    card.addEventListener('click', () => openClockModal(idx));
    c.appendChild(card);
  });
}

export function updateClocks() {
  const now = new Date();
  clockCities.forEach((city, idx) => {
    try {
      const { tf, df } = getClockFmt(city.tz);
      const te = document.getElementById(`ct-${idx}`);
      const de = document.getElementById(`cd-${idx}`);
      if (te) te.textContent = tf.format(now);
      if (de) de.textContent = df.format(now);
    } catch {}
  });
}

export function initClocksModule() {
  clockModal = document.getElementById('clockModal');
  document.getElementById('clockCityName').addEventListener('input', function() {
    const tz = lookupTz(this.value.trim());
    const h = document.getElementById('clockHint');
    if (tz) { document.getElementById('clockTzInput').value = tz; h.style.color='#1a73e8'; h.textContent='✓ 已匹配时区:' + tz; }
    else    { h.style.color='#9aa0a6'; h.textContent='未匹配,请手动填写 IANA 时区'; }
  });
  document.getElementById('clockCancel').addEventListener('click', () => clockModal.classList.remove('open'));
  clockModal.addEventListener('click', e => { if (e.target === clockModal) clockModal.classList.remove('open'); });
  document.getElementById('clockSave').addEventListener('click', () => {
    const name = document.getElementById('clockCityName').value.trim();
    const tz   = document.getElementById('clockTzInput').value.trim();
    if (!name || !tz) return;
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      clockCities[editingClockIdx] = { name, tz };
      delete clockFmts[tz];
      localStorage.setItem('clockCities', JSON.stringify(clockCities));
      renderClockCards(); updateClocks();
      clockModal.classList.remove('open');
    } catch {
      const h = document.getElementById('clockHint'); h.style.color='#d93025'; h.textContent='时区无效,请检查格式';
    }
  });
}
