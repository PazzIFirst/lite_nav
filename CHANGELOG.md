# Changelog

## v1.4.7 — 2026-05-23

第三轮 code review 3 个 issue 修复(GitHub issue #8 #9 #10)。

### Fixed

- **#8 Redis 写失败时新鲜数据被丢弃**:`runAndCache()` 即使 Redis 写失败也会返回新鲜 payload,但 `refreshWeather*` / `refreshHolidayForCountry` 没 return,路由再去读 Redis 拿不到 → 返回内置兜底 → 把 Redis 变成了硬依赖。改:refresh 函数全部 `return runAndCache(...)`;`refreshWeatherDedup` 返回 Promise<payload>;路由 `const fresh = await refresh*; r = fresh? {...fresh, freshness:'fresh'} : await read() ?? fallback`
- **#9 body 大小限制只看 Content-Length,流读取无限**:第三方不返 `Content-Length` 时 `res.json()`/`arrayBuffer()` 仍可无限读到内存。`fetcher.js` 新增 `readJsonLimited` / `readBufferLimited`,**边读边计数,超限即抛**;迁移 19 处 `res.json()` + 4 处 `arrayBuffer()`(weather/holiday/finance/hot/ip/suggest 各源 + favicon 代理)
- **#10 trust proxy 总是启用**:`app.set('trust proxy', 1)` 永远开 → 后端若直接暴露,客户端可伪造 `X-Forwarded-For` 欺骗 `req.ip`、绕过限流。改 `TRUST_PROXY` env 控制(默认关;`1` = 信任 1 跳,适合 Caddy/Nginx 反代;`true` 或 CIDR 列表也支持)

### Deployment note

**升级到 v1.4.7 必须在 docker-compose 给 backend 加 `TRUST_PROXY=1` 环境变量**,否则:
- `/api/ip` 会拿到 Caddy 的内网 IP(`172.x.x.x`)而不是访客真实 IP
- 限流变成所有用户共享一个桶(Caddy IP 为 key)

```yaml
backend:
  environment:
    - TRUST_PROXY=1   # 反代场景必需
```

## v1.4.6 — 2026-05-23

第二轮 code review 4 个 issue 修复(GitHub issue #4 #5 #6 #7)。

### Fixed

- **#4 后端把多天假期压成 1 天**:`holiday.js` 最终聚合 `out.map(h => ({date: h.s}))` 丢了 `h.e`,春节/国庆等多天假期范围只剩首日。新增 `expandHolidayDays()`:聚合前展开 `{s,e}` 为单日,`mergeRanges` 再合并出完整范围
- **#5 Redis 不可用时降级路径会卡**:`ioredis` 客户端用默认配置 → 命令无超时、无重试上限,Redis 挂时降级要等命令 30s 默认超时,import 时也会触发持续重连。改:`lazyConnect: true` + `connectTimeout: 3s` + `commandTimeout: 2s` + `maxRetriesPerRequest: 2` + `retryStrategy` 5 次后返回 null
- **#6 前端「假期中」只在第一天显示**:`findNextHoliday()` 只比 `today` 和 `h.start`,完全没用 `h.end` → 春节第 2-7 天显示成"已过去"。改为 `diffStart<=0 && diffEnd>=0` 双边判断,覆盖整个假期范围(时区/浮点容差用 `Math.round`)

> #4 修后端只是给前端正确数据,#6 修前端才能用到 —— **两者配套生效**。

### Chore

- **#7 提交 `backend/package-lock.json` + Dockerfile 改 `npm ci`**:
  - 此前无 lockfile,Docker `npm install` 每次重新解析 → 依赖版本可能漂移、构建不可复现
  - 改 `npm ci --omit=dev` 严格按 lockfile 安装,构建结果一致
  - 实测当前依赖 `node-cron@3.0.3 → uuid@8.3.2` 触发 npm audit moderate 告警(uuid <11.1.1);`node-cron@4.x` 为 breaking change,本次**不升**,作为已知接受风险跟踪。该 advisory 仅影响 v3-v7 UUID 生成路径,本项目未使用;影响极小

## v1.4.5 — 2026-05-23

修复 3 个 code review 发现的 bug(GitHub issue #1 #2 #3)。

### Fixed

- **#1 坐标天气缓存键读写不一致**:`/api/weather` 坐标路径,读用 `weather:coords:${la},${lo}`(原始数字)、写用 `toFixed(3)`,键对不上 → 刷新写入后仍读旧键 → 永远返回内置兜底。`weather.js` 导出 `coordsKey()`,读写共用同一格式
- **#2 热榜刷新按钮调了 token 保护接口**:刷新按钮发 `POST /api/hot/:id/refresh`,该接口未配 `REFRESH_TOKEN` 时 403、配了但请求不带 token 时 401 → 默认部署下点刷新必失败。按钮改为普通 `GET` 重新加载;强制重拉(token 保护)保留为管理接口,不暴露给浏览器
- **#3 非中国节假日套用了中国兜底**:`/api/holidays` 所有国家都用 `HOLIDAY_BUILTIN_FALLBACK`(中国农历算法生成),Redis 不可用 / 数据源全失败时 `?country=US` 会返回中国节假日。新增 `holidayFallback(country)`:CN 用算法兜底,其他国家返回空 `items`(假数据比空更糟)

### 影响

- #1:仅影响用 `lat/lon` 调天气的调用方(当前前端走 `city=`,未踩到)
- #2:用户可见 —— 热榜刷新按钮默认即坏
- #3:数据源故障时非中国节假日显示错误数据

## v1.4.4 — 2026-05-23

国内 IP 检测改为并行合并 —— 同时拿到 IPv4 + 城市级。纯前端。

### Fixed

- **天气城市退化成省份**:v1.4.2 为避免双栈用户拿到 IPv6,把国内检测链改成 ipip 优先;但 ipip 只到省级,城市级的今日头条排最后没被调用 → 天气从「东莞」退化成「广东」

### Changes

- 国内 IP 检测从「顺序兜底」改为「3 源并行 + 合并」:
  - **IP** 取 IPv4 优先(ipip 域名 v4-only,稳定给 IPv4)
  - **城市** 取「城市级」源优先(今日头条到市,ipip/mir6 只到省)
  - 既拿到 IPv4(不显示一长串 IPv6)、又有城市级地点(天气联动准)
- 每个国内源标注 `level: 'city' | 'province'` 供合并时择优
- 国外 IP 仍为顺序兜底(只需单个出口 IP)

## v1.4.3 — 2026-05-22

国外 IP 检测回滚到浏览器侧。纯前端(`ip-weather.js`)。

### 背景:v1.4.0 的设计错误

v1.4.0 把国外 IP 检测从「浏览器直连境外 IP 服务」改成了后端 `/api/ip`(读 `X-Forwarded-For`)。这是**原理性错误**:

- 旧机制对的原因:浏览器请求境外 IP 服务时,分流代理按规则路由 —— 走代理的线路,服务就看到**代理出口 IP**。它借用了浏览器自身的分流路由。
- `/api/ip` 只能知道「你怎么连到 `hi.xzsjno1.com`」。该站未被墙、被直连访问 → 后端永远只看到直连 IP,**测不到代理 IP**。于是开着代理却显示「本站直连」。

### Changes

- **国外 IP 恢复浏览器侧检测**:`ipinfo.io` → `ipapi.co` → `api.ipify.org` 顺序兜底(替换已失效的 ipwho.is / ip.sb),`cache: no-store`
- **去掉「本站直连」概念**:还原为「国内 IP / 国外 IP」两个独立测量,与 v1.3.x 行为一致
- 国内 IP 检测保留改进后的源(`ipip → mir6 → 今日头条`)
- 前端不再调用 `/api/ip`(后端该接口保留,暂未使用)

### 已知限制

国外 IP 反映的是「你访问境外 IP 服务所用的线路」。若你的分流规则把未被墙的境外站点走直连,国外 IP 可能与国内 IP 相同 —— 要看到「谷歌线路」出口 IP,需该 IP 服务也走代理(取决于你的客户端规则)。单服务器无法复刻 ip111.cn 式的多 echo 点三路检测。

## v1.4.2 — 2026-05-22

IP 显示逻辑优化。纯前端(`ip-weather.js`),后端无改动。

### Fixed

- **双栈用户国内 IP 显示成 IPv6**:今日头条接口域名是双栈的,v6 网络下浏览器走 IPv6 → 返回一长串 IPv6,与 ip111 等只显示 IPv4 不一致,也和 `/api/ip`(永远 IPv4)对不上,导致「本站直连」判断失效、误把国内 IP 标成「国外IP」
- **直连访问本站时把国内 IP 误标为国外 IP**:旧逻辑用 `domestic.ip === viaSite.ip` 精确比对,IPv4/IPv6 混用时永远不相等 → 走错分支

### Changes

- **检测逻辑重构**:先查 `/api/ip`(`hi.xzsjno1.com` 无 AAAA → 永远 IPv4;后端 ip-api.com → 城市级)
  - `/api/ip` 是**中国 IP** → 你直连访问本站,该结果(IPv4 + 城市级)**即你的国内 IP**;国外标「本站直连」;**完全不发浏览器侧第三方请求** → console 全静
  - `/api/ip` 是**境外 IP** → 你经代理访问本站,该 IP 即境外出口;国内 IP 才走浏览器侧检测
- 国内检测链重排:`ipip`(域名 IPv4-only,强制 IPv4)→ `mir6` → `今日头条`
- 「本站直连」时 tooltip 明确说明:单服务器无法测出访问谷歌等被墙网站的出口 IP

## v1.4.1 — 2026-05-22

小修。

### Fixed

- **`/api/favicon` 对 `x.com` 等单字符首段域名报 400**:后端域名正则用了 `[a-z0-9.-]+`(要求首段后至少 1 字符),把合法域名 `x.com`(X/推特)挡掉了 → 改 `+` 为 `*`,与前端正则一致
- **国家倒计时行未居中**:v1.3.0 把该行设为「强制单行 + 可横滚」时用了 `justify-content: flex-start`,内容未撑满时左对齐,与上方居中内容不一致 → 改 `safe center`(放得下居中,放不下退回左对齐可滚动、不裁切)

### CI

- `docker-publish.yml` 构建任务加 `timeout-minutes: 30` —— 偶发 runner / QEMU 卡死时 30 分钟即失败,不再耗满 GitHub Actions 的 6h 上限(v1.4.0 的 tag 构建就曾卡满 6h 被杀)
- 约定:`backend/package.json` 的 `version` 字段不再随版本号变动 —— 它不发布到 npm、运行时不读,纯装饰;改它会使 Docker 的 `npm install` 缓存层失效、拖慢构建。版本以 git tag + 镜像 tag 为准

## v1.4.0 — 2026-05-21

IP 检测重做。第三方 IP API 大面积 CORS / 403 失效,改为「国内浏览器侧多源 + 国外后端代理」。

### Fixed

- **国外 IP 失效**:前端直连的 `ipwho.is`(403)、`ip.sb`(无 CORS)、`ipinfo.io`(被浏览器启发式缓存,显示过期代理 IP)全部不可用 → 改由后端 `/api/ip` 检测
- **国内 IP 偶发 `--`**:`pconline` 不发 CORS 头、浏览器跨域读不了;现改用经实测可用的三源链
- **国内地点解析错误**:ipip 文本解析正则取错字段(抓「电信」运营商而非「广东」省份),导致显示 `CN电信`、天气联动定位到错误城市;已修正
- **`/api/favicon` 400**:某些导航卡片网址解析不出域名,`faviconUrl()` 拼出空 `domain=` 参数被后端拒绝;现在空/非法域名直接返回透明占位,不再发请求

### Changes

- **国内 IP — 浏览器侧三源顺序兜底**(命中即停,console 无多余报错):
  1. 今日头条 widget — 唯一返回城市级(天气联动更准)
  2. mir6 API — 省份级
  3. ipip.net — 省份级(纯文本,修正解析正则)
- **国外 IP — 后端 `/api/ip`**:读 `X-Forwarded-For`(Caddy 反代传入)拿访客访问本站所用的 IP,服务端 geo 查询(`ip-api.com` 中文 → `ipinfo.io` → `ipwho.is` 兜底),同源请求无 CORS、无 403、`Cache-Control: no-store` 不被缓存
- **显示逻辑**:对比国内 IP 与 `/api/ip` 结果 —— 相同 → 标「本站直连」(说明未对本站启用代理);不同 → 后者即境外出口 IP。任何情况都不显示假信息
- `ip.js`:删除无意义的 `fetchDomestic`(后端代发查到的是后端服务器 IP,非访客)

### 已知限制

- 受单服务器限制,无法复刻 ip111.cn 式的「国内/国外/谷歌」三路独立检测(那需要分布在不同网络位置的多个 echo 点)。本项目提供「国内分流 IP」+「访问本站所用 IP」两项,够用且诚实。

## v1.3.1 — 2026-05-20

行情区(finance)布局修复。仅 `frontend/css/main.css`,后端与其他模块零改动。

### Fixed

- **文字重叠**:v1.3.0 把行情格子内部列宽调大(列合计 256px + 间距 + 内边距 = 需 304px),但格子用 `33.333%` 百分比宽 —— 即便最大布局每格也只有 ~269px,先天差 35px 必然重叠;窄屏(如 1280×800 16:10、侧栏占位)更严重
- **在岸/离岸竖排**:第 2 列(`fin-pair-tag`)被压到 18px,「在岸」两字 ~21px 塞不下,又未设 `white-space: nowrap`,逐字换行成竖排
- **两侧留白过大**:固定宽格子居中后行内填不满,两侧出现明显空白

### Changes

- 行情格子改为 `flex: 1 0 260px`:可伸展填满整行(消除留白),但 `flex-shrink: 0` 保证永不被压到 260px 内容宽以下(永不重叠)
- 自动折行:宽屏 3 列 → 屏幕挤压自动 2 列 → 手机 1 列,无需断点切换列数
- 内部 5 列仍为固定像素(`62 24 56 50 36`),保证 label / 数值 / 涨跌 / 收盘徽章在所有格子里跨格对齐
- `fin-pair-tag` 加 `white-space: nowrap`;第 2 列加宽到 24px(4K 28px)
- `fin-label` 加 `text-overflow: ellipsis` 兜底

## v1.3.0 — 2026-05-13

UI 重设计:design system + 明/暗主题 + 玻璃质感 + 响应式。后端 / API / 所有 JS 模块行为零改动,纯 CSS + 少量 HTML 变化。

### Design System

- **设计 token**:`:root` 下统一 spacing(8px 节奏)/ type scale / radius / shadow / motion / z-index;主题切换只需替换一组 token
- **明/暗主题**:`<html data-theme>` 控制;首次访问跟随 `prefers-color-scheme`,用户切换后写入 `localStorage`
- **抗 FOUC**:`<head>` 内联脚本在首次绘制前应用主题,避免主题闪烁
- **明暗切换按钮**:固定右上角,玻璃质感小圆按钮,sun/moon SVG 互换
- **字体**:Inter → SF Pro → 苹方 / 微软雅黑 / 思源黑体 系统回落栈;数字使用 `tabular-nums` + `font-feature-settings: "tnum"`
- **降级 / 无障碍**:`prefers-reduced-motion` 自动关闭过渡;`color-scheme: light dark` 让浏览器原生控件适配

### Visual Upgrades

- **背景渐变**:大尺寸 radial-gradient 光晕(右上 cyan / 左下 purple),`background-attachment: fixed`
- **卡片玻璃化**:所有卡片(时钟、行情、热榜、Module A、modal)用 `backdrop-filter: blur(20px) saturate(180%)` + 1px 边 + 柔阴影
- **Module A 重构**:
  - 整体变成玻璃卡片,内部用 hairline(`border-top: 1px subtle`)分四段:日期 → 实时信息 → 老黄历 → 国家倒计时
  - 北京时间变成带绿色脉动 live-dot 的 pill
  - IP 信息从三色文本变成 chip,label 作大写迷你标签,IP 地址作 0.65 透明度尾随小字
  - 天气从淡灰背景变成 accent 色 pill(hover 抬起 1px)
  - 老黄历宜/忌/黄道徽章变更圆,letter-spacing 拉开
  - **国家倒计时强制单行**:`flex-wrap: nowrap` + `overflow-x: auto`,装不下时横向滚动(细滚动条 + 两端 mask 渐隐);"在线/本地" 文本徽章压成 6×6px 彩色圆点(emerald=在线,muted=本地),tooltip 信息保留
- **颜色信号**:涨用 emerald,跌用 rose,提醒用 amber,品牌色 cyan;light/dark 各有专属饱和度
- **微交互**:卡片 hover 抬起 1px + 阴影加深;chip hover 边变色;modal 进场 `fadeIn` + `scaleIn` 动画;按钮按下 `scale(0.97)`
- **骨架屏**:"行情加载中…" 上方加 1.6s 循环 shimmer 横条
- **modal**:背景 `backdrop-filter: blur(4px)`,圆角 18px,进场动画

### Responsive

- **< 1260px**(平板/小笔记本):隐藏侧栏(原本就有)
- **< 768px**(平板纵向):时钟 3 列,行情 2 列,模块内边距收紧;`date-divider` 隐藏避免行太挤
- **< 480px**(手机):时钟 2 列,行情 1 列,搜索框字号下调

### Files changed

- `frontend/css/main.css`:449 → ~830 行(完整 design system + 全面重写)
- `frontend/index.html`:`<head>` 加抗 FOUC 主题脚本;`<body>` 顶部加主题切换按钮
- `frontend/js/main.js`:主题切换按钮 click handler(7 行)
- 后端 / 其他 9 个 JS 模块:**零改动**

## v1.2.1 — 2026-05-12

许可证从 **GPL-3.0** 切换为 **MIT**。衍生作品不再要求开源/同协议,可自由商用、闭源、二次分发,仅需保留版权声明。同步更新 README badge、目录树、`index.html` JSON-LD `license` 字段、meta description、`<header>` 可读文本。

## v1.2.0 — 2026-05-12

前端重构 + SEO 加固。后端无功能变化(版本同步升级)。

### Refactor

- **frontend/index.html**:从 2034 行单文件拆为
  - `index.html`(~200 行,仅结构 + SEO `<head>`)
  - `css/main.css`(449 行)
  - `js/` 下 10 个 ES Module:
    - `main.js`(入口)
    - `api.js`(fetchT / apiGet / safeHttpUrl / fmtAge / freshnessText / srcTooltip / faviconUrl / copyToClipboard)
    - `search.js`(10 搜索引擎 + 历史 + 建议,F-005 race seq / F-006 / F-007)
    - `clocks.js`(6 城市时钟 + localStorage 校验)
    - `today.js`(公历 + 农历 + 老黄历 + 北京时间)
    - `holidays.js`(20 国节假日 + 倒计时 + 中文翻译)
    - `ip-weather.js`(IP 定位 + 天气)
    - `finance.js`(金融行情 + 双汇率 + 收盘徽章)
    - `hot.js`(知乎/微博/百度/B 站热榜)
    - `nav.js`(自定义导航分组 + URL 协议白名单)
- **零构建**:浏览器原生 `<script type="module">`,无 webpack / vite / next 依赖
- 每个模块独立可维护:改 IP 检测只动 `js/ip-weather.js`,改金融只动 `js/finance.js`

### SEO

- **`<title>` + `<meta name="description">` + keywords + author + canonical**
- **Open Graph**(og:type / title / description / url / image / locale / site_name)
- **Twitter Card**(summary_large_image)
- **Schema.org JSON-LD**:`WebApplication` 类型,声明 license / 价格 / 语言 / 组织
- **静态 `<header class="seo-only">`**:对爬虫可见的 h1 + 项目描述,视觉上 `clip: rect(0,0,0,0)` 隐藏
- **语义化标签**:`<main class="page-layout">` 替代 `<div>`
- **`robots.txt`** + **`sitemap.xml`**(自部署需改 `og:url` / `canonical` / `sitemap.xml` 里的域名)
- **`<link rel="preconnect" href="https://flagcdn.com">`**:flag 兜底 CDN 预连接(本地 flag 优先)
- **`theme-color`**(浏览器 UI 着色)

### Deploy

- `deploy/deploy-after-1panel-site.sh`:`cp` → `cp -r`(整个 `frontend/` 目录)
- `README.md`:目录树更新;本地试用部分提示 ES Modules 需通过 HTTP server(`python3 -m http.server 8080`),不能 `file://` 直开

### Compatibility

- 浏览器要求:支持原生 ES Modules(Chrome 61+ / Firefox 60+ / Safari 11+ / Edge 16+ — 2017 年起)
- 后端 API 协议 / Redis 缓存键 / Docker 镜像入口 100% 兼容,可平滑升级

---

## v1.1.0 — 2026-05-05

第二轮全面代码审计后的安全 + 稳定性 + 隐私加固。涉及 ~95 项修复,5 次独立 commit。

### Security & Privacy

- **CORS** 默认不发(同域反代);通过 `CORS_ORIGIN` env 显式白名单
- **限流**:`/api/*` 默认 120/min,`/api/hot/x/refresh` 5/min(可配置)
- **POST /api/hot/x/refresh** 必须配 `REFRESH_TOKEN` env 才启用
- **输入校验**:city/lat/lon/label/q/country 全部走中央 validators,统一 400 错误
- **协议白名单**:fetcher 只允许 http(s),前端 site URL 校验同样
- **响应清洗**:第三方数据进缓存前过 `safeHttpUrl/cleanText/safeNumber/safeDate`
- **容器降权**:Node 进程跑 `node` 用户(uid 1000)
- **IP 检测后端代理**:前端不再直连 ipwho.is / ipinfo.io / ip.sb / pconline / ipip — 访客 IP 仅由后端暴露给一家
- **favicon 代理**:前端不再直接向各域名拉 favicon
- **国旗本地化**:20 国国旗本地存储,不再依赖 flagcdn.com
- **localStorage schema 校验**:污染数据被忽略
- 前端关键 innerHTML 拼接替换为 DOM 操作 + textContent

### Correctness

- **时区**:`/api/today` 直接按北京时间计算(UTC 容器再不会显示昨天)
- **cron** 全部带 `{ timezone: 'Asia/Shanghai' }`
- **节假日**:多源结果排序 + 去重(`name|s|e`);所有国家走 `mergeRanges`
- **finance**:每个数据点带独立 `_meta { source, fetched_at, freshness }`,
  从 lastgood 继承时不再被伪装成 fresh
- 数据值合理区间校验(usdcny ∈ [1,20],sse ∈ [500,20000] 等)
- `Number()` 替代 `parseFloat` + `typeof`,`Number.isFinite()` 替代 `!n` 不再过滤 0
- **节假日时区漂移**:`date-holidays` / `Nager.Date` 改用 `h.date.slice(0,10)` 而不是 `new Date(...)`
- **CN 算法兜底**只标节日单天,不再写虚假调休(`国庆 10/01-10/07`)
- 农历/节气计算修正闰月、节日去重、`getNextJieQi` 单次复用

### Robustness

- **Redis 异常容错**:`safeParse`、`pingRedis`、`writeBoth` 拆开 allSettled — 任一 SET 失败不阻塞
- **lastgood TTL**:动态 key(weather:*)30 天 TTL,不再无限堆积
- **fetcher 三段错误分离**:fetch/transform/cache 独立 catch,cache 失败不丢已获取数据
- **优雅关闭**:SIGTERM/SIGINT 关闭 cron + http + redis,容器干净退出
- **任务运行锁**:慢网时同 task 多次触发会跳过而非堆积
- **in-flight Promise 去重**:`/api/holidays?country=X` 并发时只发一次外部请求
- **stale-while-revalidate**:已存在,行为更明确
- **Page Visibility API**:浏览器标签页隐藏时,前端 30s 行情 + 5min 热榜轮询暂停
- 天气并行请求(原本串行),首屏时间提升

### Code Hygiene

- weather.js 561 → 161 行 — 446 城 cityCode 拆到 `data/cn-cities.json`
- holiday-i18n.js 961 → 43 行 — 翻译表拆到 `i18n/{common,us,gb,...}.json`(v1.0 已做)
- 删除多个死代码:`FIN_ITEMS_ORDER`、`DOMESTIC_IP_APIS`、`makeBa9Source` 死参 `label`、`cnFromAlgorithm` 内 `lunar.SolarUtil ? null : null`
- `readThreeState` 删除未使用的 `hotTtlSec` 参数

### New Endpoints

| 路径 | 用途 |
|---|---|
| `GET /api/ip` | 后端代理 IP 检测,返回 `{ domestic, google, visitor_ip }` |
| `GET /api/favicon?domain=X` | 后端代理 favicon |

### New Env Vars

| Env | 默认 | 说明 |
|---|---|---|
| `CORS_ORIGIN` | (空,不发 CORS 头) | 逗号分隔的允许 origin 列表 |
| `RATE_LIMIT_PER_MIN` | 120 | 全局 API 限流 |
| `REFRESH_LIMIT_PER_MIN` | 5 | 刷新接口单独限流 |
| `REFRESH_TOKEN` | (空,接口禁用) | 配置后 POST /api/hot/x/refresh 需带 X-Refresh-Token |
| `HOST` | 0.0.0.0 | 监听 host(可改 127.0.0.1 仅本地) |
| `DYNAMIC_LASTGOOD_TTL_SEC` | 2592000(30 天) | 天气等动态 key 的 lastgood TTL |
| `FETCH_MAX_BODY_BYTES` | 2097152(2MB) | 第三方响应最大 body |
| `PACKED_HOLIDAY_DIR` | /app/data/holiday-cn | 容器内打包节假日数据路径 |

### New Dependencies

- `express-rate-limit ^7.4.1`

### 推迟到 v2

工作量过大、需要架构级讨论的 issue:

- F-012 配置导入/导出
- F-016 CSP 严格模式(需要把 inline JS/CSS 抽出来)
- F-017 移动端 sidebar 改成可折叠面板
- F-018 启动初屏延迟加载
- M-005 腾讯财经字段固定 schema + fixture 测试
- X-004 完整的 vitest 测试套件

---

## v1.0.0 — 2026-05-03

首个稳定版本,详见 [Release Notes](https://github.com/PazzIFirst/lite_nav/releases/tag/v1.0.0)。
