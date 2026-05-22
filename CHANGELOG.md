# Changelog

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
