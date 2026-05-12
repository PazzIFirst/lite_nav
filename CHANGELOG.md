# Changelog

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
