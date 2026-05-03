# lite-nav

> 轻量级个人/团队导航主页 · 农历 · 多国节假日 · 实时行情 · 热榜
> 多源容灾,**永不返回空** · 自部署 / 内网 / 本地皆可

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
![Backend: Node.js 20](https://img.shields.io/badge/Backend-Node.js%2020-339933)
![Frontend: Vanilla](https://img.shields.io/badge/Frontend-Vanilla%20HTML%2FJS-orange)
![Storage: Redis](https://img.shields.io/badge/Cache-Redis-DC382D)

一个符合中国大陆用户使用习惯的轻量级导航主页。无外部框架、单文件前端,后端可选(放弃后端会失去多源 Fallback、缓存与跨设备一致性,但仍可单文件本地用)。

A self-hostable lightweight navigation homepage tuned for users in mainland China — featuring lunar calendar, almanac, multi-country holidays, live finance & social-media hot lists. Multi-source fallback that **never returns empty**.

---

## ✨ 核心特性

### 信息聚合
- 🕐 **6 城市时钟** — 默认北京/纽约/伦敦/东京/悉尼/迪拜,可换成任意 IANA 时区
- 📅 **公历 + 农历 + 节气 + 老黄历** — 含干支纪年、生肖、宜忌(取前 5)、神位(喜/财/福)、黄黑道、彭祖百忌、纳音、冲煞;鼠标悬停查看详情
- 🎌 **多国法定节假日** — 默认中美英德日,可换 20 国(含韩/法/泰/澳/俄/印/巴西等),**全部中文显示**,悬停看原文,**点击复制原文**
- 💹 **实时金融行情** — USD/CNY 汇率、A股(上证/深证/沪深300)、港股恒生、美股(纳指/标普/道指)、上海金现货
- 🌤 **天气** — 自动检测 IP 城市 + 两个用户自定义城市;**国内城市优先用国家气象局数据**(中雨准确显示,不再"晴"反差)
- 🌐 **国内外双 IP** — 同时显示访客的国内出口 IP 和国外出口 IP(适合用代理的用户校验)
- 🔥 **4 热榜** — 知乎 / 微博 / 百度 / B站
- 🔍 **10 搜索引擎** — 百度 / Google / Bing / 知乎 / Yandex / Bilibili / YouTube / GitHub / X / DuckDuckGo / npm,带联想 + 历史
- 🗂 **可编辑导航分组** — localStorage 存,每个浏览器独立
- ⏰ **倒计时** — 周末 / 各国节假日 / 距月初

### 工程亮点

| 亮点 | 实现 |
|---|---|
| **永不返回空** | 每类数据 3-6 层 fallback;最坏情况返回 lastgood 缓存或内置兜底 |
| **三态读取** | `fresh` / `stale` / `fallback` 在响应里明确标记,前端展示状态 |
| **每条数据带数据源** | 鼠标悬停看到 "数据源: 东方财富 · 更新: 30 秒前 · 状态: ✓ 新鲜" |
| **多源并行合并** | 行情数据并行调东方财富+新浪+腾讯,每个数据点独立选最优源 |
| **stale-while-revalidate** | 旧数据立即返回,后台异步刷新 |
| **农历完全离线** | `lunar-javascript` 纯算法,无外网依赖,2030 年仍可用 |
| **节假日 5 层 fallback** | 在线 API → CDN → **镜像内打包**(2024-2027) → npm 离线包 → 算法推算关键节日 → 内置 |
| **0 SQL 依赖** | 用户偏好走 localStorage,共享数据走 Redis,**没有数据库** |

---

## 🚀 快速开始

### 前置条件

- 一台 Linux 服务器(任意发行版,有 Docker)
- 一个域名(用于 HTTPS;**无域名也能跑**,IP 直连即可,但不能上 Let's Encrypt SSL)
- 反向代理(本仓库示例用 OpenResty/Nginx;Caddy/Traefik 同理)
- 可选:[1Panel](https://1panel.cn) 面板(本项目原生针对 1Panel 优化,但不强制)

### 部署步骤(以 1Panel 为例,5 分钟)

```bash
# 1. 克隆
git clone https://github.com/PazzIFirst/lite_nav.git
cd lite_nav

# 2. 配置后端
cp backend/docker-compose.yml.example backend/docker-compose.yml
# 编辑 backend/docker-compose.yml,改 REDIS_HOST / REDIS_PASSWORD
# 注意:1Panel 的 Redis 容器名通常是 1Panel-redis-XXXX,网络是 1panel-network

# 3. 起后端
cd backend
docker compose up -d --build
# 看日志确认 OK
docker logs nav-backend --tail 20

# 4. 在 1Panel UI 创建网站(类型选「静态」),申请 Let's Encrypt SSL

# 5. 部署前端 + 注入反代配置
cd ../deploy
sudo bash deploy-after-1panel-site.sh   # 脚本里改成你自己的域名
```

### 部署步骤(普通 Nginx / Caddy)

不用 1Panel,改用普通 Nginx:

```bash
# 1-3 同上

# 4. 把 frontend/index.html 放到你的网站根目录
sudo cp frontend/index.html /var/www/html/index.html

# 5. 在 Nginx 站点配置里追加 location /api/(参考 deploy/openresty-api-snippet.conf.example)
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

# 6. reload
sudo nginx -s reload
```

### 本地试用(无后端,纯静态)

把 `frontend/index.html` 用浏览器直接打开。前端会因为 `/api/*` 调用全部失败而退化:
- 农历 / 节假日:看不到
- 行情 / 热榜:加载失败
- 天气:加载失败
- 但**搜索、城市时钟、导航分组**仍可用

要正常用,**后端必须跑起来**。

---

## 🏗 架构

```
浏览器
  │ HTTPS
  ▼
反代(OpenResty / Nginx / Caddy)
  ├─ /              ──→ frontend/index.html 静态文件
  └─ /api/*         ──→ 127.0.0.1:3000 (nav-backend Docker 容器)
                          │
                          ├─ node-cron 定时任务
                          │   ├─ 行情每 30s
                          │   ├─ 热榜每 5min
                          │   ├─ 节假日每天 03:00
                          │   └─ 今日(农历)每天 00:01
                          │
                          ├─ 三方 API
                          │   ├─ 东方财富 / 新浪 / 腾讯(行情)
                          │   ├─ Open-Meteo / wttr.in / 中国天气网(天气)
                          │   ├─ Nager.Date / date-holidays / timor.tech(节假日)
                          │   ├─ BA9 / VVHAN / B站官方(热榜)
                          │   └─ 百度 / Google / Bing(搜索联想)
                          │
                          └─ Redis (cache: + lastgood: 双键)
```

---

## 📦 数据源清单

### 节假日
| 国家 | 主源 | 备 1 | 备 2 | 离线兜底 |
|---|---|---|---|---|
| CN | timor.tech | NateScarlet/holiday-cn (CDN) | **镜像内打包**(2023-2027) | 算法推算(春节/端午/中秋等农历日)+ 内置 |
| US/GB/DE/JP/FR/KR/CA/AU/SG/IN/IT/ES/RU/BR/NL/CH/TH/MY/NZ | Nager.Date API | date-holidays npm(完全离线) | — | — |

**所有非中文节日名经过手工翻译**(覆盖联邦/州/邦级 700+ 条目,如 `Truman Day → 杜鲁门日(密苏里州)`、`Vesak Day → 卫塞节`)。

### 农历 / 老黄历
- `lunar-javascript`(纯算法,寿星天文历)
- 100% 离线,无任何外网依赖

### 金融
| 数据 | 主 | 备 1 | 备 2 |
|---|---|---|---|
| 美元/人民币 | Frankfurter | ExchangeRate-API | — |
| A 股指数 | 东方财富 | 新浪财经 | 腾讯财经 |
| 港股恒生 | 东方财富 | 腾讯财经 | — |
| 美股(纳指/标普/道指) | 东方财富 | 腾讯财经 | — |
| 黄金(¥/克) | 东方财富 AU9999 | 上轮缓存继承 | — |

并行调用 + 每个数据点独立选最优源。

### 天气
| 城市类型 | 主 | 备 1 | 备 2 |
|---|---|---|---|
| 国内城市(446 内置 cityCode,覆盖全国地级市 + 主要县级) | 中国天气网 (itboy 镜像) | Open-Meteo | wttr.in |
| 国外城市 | Open-Meteo | wttr.in | — |

### 热榜
- 知乎 / 微博 / 百度 / B站 — 主源 BA9 + 备源 VVHAN;B 站还有官方 API 兜底

---

## 🔧 配置

### 后端环境变量(`backend/docker-compose.yml`)

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 后端监听端口 |
| `REDIS_HOST` | redis | Redis 主机/容器名 |
| `REDIS_PORT` | 6379 | Redis 端口 |
| `REDIS_PASSWORD` | (无) | Redis 密码 |
| `TZ` | Asia/Shanghai | 时区 |

### 前端用户偏好(浏览器 localStorage,无需配置)

| Key | 含义 |
|---|---|
| `clockCities` | 6 城市时钟列表 |
| `wxCity1` / `wxCity2` | 自定义天气城市 |
| `searchHistory` | 搜索历史(最多 10 条) |
| `navGroups` | 自定义导航分组 |
| `countdownCountries` | 倒计时显示的国家代码列表 |

清掉 localStorage 即恢复默认。

---

## 🛠 二次开发

### 目录结构

```
lite-nav/
├── README.md
├── LICENSE                 # GPL-3.0
├── .gitignore
├── frontend/
│   └── index.html          # ~70KB 单文件,无构建
├── backend/
│   ├── Dockerfile
│   ├── docker-compose.yml.example
│   ├── package.json
│   └── src/
│       ├── server.js       # Express 路由
│       ├── scheduler.js    # node-cron 定时任务
│       ├── redis.js        # 三态读写封装
│       ├── fetcher.js      # 主备链 + runAndCache
│       └── sources/
│           ├── finance.js     # 行情(三家并行合并)
│           ├── hot.js         # 热榜
│           ├── weather.js     # 天气(国内/国外分流)
│           ├── holiday.js     # 节假日(多国 + 多层 fallback)
│           ├── holiday-i18n.js # 700+ 条节日中文翻译
│           ├── today.js       # 农历 / 节气 / 老黄历
│           └── suggest.js     # 搜索联想
└── deploy/
    ├── openresty-api-snippet.conf.example
    └── deploy-after-1panel-site.sh
```

### 加新国家(节假日)

1. 在 `backend/src/sources/holiday.js` 的 `SUPPORTED_COUNTRIES` 数组加一行
2. 在 `backend/src/sources/holiday-i18n.js` 加翻译表
3. 重建容器

### 加新数据源

每个 source 是一个返回 `Promise<data | null>` 的函数。失败抛错或返回 `null` 即可,主备链会自动 fall through。模板:

```js
async function fromMyApi(/* args */) {
  const r = await fetchT('https://...', { timeout: 5000 });
  const d = await r.json();
  if (!d?.expected_field) return null;
  return /* normalized data */;
}
```

### 改前端

`frontend/index.html` 是单文件,**改完直接覆盖部署目录**即可:

```bash
sudo cp frontend/index.html /opt/1panel/apps/openresty/openresty/www/sites/<your-domain>/index/index.html
```

无需重启任何服务,浏览器 Ctrl+F5 即生效。

---

## ❓ FAQ

**Q: 为什么没有数据库?**
A: 用户偏好(导航分组、搜索历史等)走浏览器 localStorage,共享数据(行情、热榜)走 Redis。引入 SQL 没有任何收益。

**Q: 我的服务器在境外,某些国内 API 是不是会拿不到数据?**
A: 后端已尽量挑可访问性好的源(东方财富、Nager.Date 都全球可达)。如果某条 API 在你境外服务器上 DNS 解析失败,fallback 链自然跳到下一家。境外服务器实测全功能可用。

**Q: 怎么换默认导航分组?**
A: 改 `frontend/index.html` 里 `DEFAULT_NAV` 数组(在 `script` 末段)。已有用户的浏览器仍会读 localStorage,需手动清掉才看到新默认。

**Q: 怎么不让某个数据源被用?**
A: 在 `backend/src/sources/<x>.js` 里把对应 source 从数组里删掉/注释掉。

**Q: 黄金为什么是 ¥/克?**
A: 东方财富 AU9999 是上海金交所现货,单位 ¥/克(不是 USD/盎司)。中国用户更熟悉这个价位。如要切到 COMEX 国际金价,改 secid 为 `100.GC00Y`。

**Q: 节假日怎么知道是 2030 年也准?**
A: 算法层用 `lunar-javascript` 推算春节/端午/中秋等农历节日的公历日期(永远准),不准的部分是**调休** —— 那个由国务院前一年公告,**任何方案都做不到提前 5 年**;但你能算出"距 2030 年春节多少天"。

---

## 🤝 贡献

欢迎 PR!特别欢迎:
- 补全 `holiday-i18n.js` 的小语种节日翻译
- 加更多国家的节假日(目前 20 国)
- 修各种数据源拼写/字段变化

PR 前请:
1. 确保后端 `docker compose up -d --build` 不报错
2. 确保前端 `index.html` 在浏览器里能正常加载(Ctrl+Shift+I 看控制台无错误)

---

## 📜 License

[GPL-3.0](LICENSE)

本项目使用 GPL-3.0 协议。**衍生作品必须开源**且使用相同/兼容协议。商用前请阅读 LICENSE 全文。

---

## 🙏 鸣谢

数据源:
- [东方财富](https://www.eastmoney.com/) / [新浪财经](https://finance.sina.com.cn/) / [腾讯财经](https://qq.com) — 行情
- [Frankfurter](https://www.frankfurter.app/) / [ExchangeRate-API](https://www.exchangerate-api.com/) — 汇率
- [Open-Meteo](https://open-meteo.com/) / [wttr.in](https://wttr.in) / [中国天气网](http://www.weather.com.cn) — 天气
- [timor.tech](https://timor.tech/) / [NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn) / [Nager.Date](https://date.nager.at/) — 节假日
- [api.ba9.cn](https://api.ba9.cn) / [VVHAN API](https://api.vvhan.com) / B 站官方 API — 热榜

库:
- [lunar-javascript](https://github.com/6tail/lunar-javascript) — 农历/节气/老黄历(MIT)
- [date-holidays](https://github.com/commenthol/date-holidays) — 多国节假日(ISC)
- [express](https://expressjs.com/) / [ioredis](https://github.com/redis/ioredis) / [node-cron](https://github.com/node-cron/node-cron) / [iconv-lite](https://github.com/ashtuchkin/iconv-lite)

---

如果这个项目对你有用,欢迎 ⭐ Star。
