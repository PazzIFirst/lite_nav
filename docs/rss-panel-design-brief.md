# RSS 订阅区视觉改造 Brief

> **对象**:主栏中段那块「订阅」列表(标题「订阅」+ 右上「刷新 / 管理订阅」),以及它的「订阅管理」弹窗。
> **目标**:现在功能完整但不好看。这次只做视觉与信息层级,不改交互语义、不改接口。
> **读者**:接手做视觉的人。看完能直接改、能自己验、能交图。

---

## 1. 现状

### 1.1 结构

```
<div class="rss-panel">                 ← 只有一条上边框,没有卡片容器
  <div class="rss-head">
    <span class="rss-head-title">订阅</span>
    <span class="rss-head-meta">5/5 个源正常</span>
    <button class="rss-tool">刷新</button>
    <button class="rss-tool">管理订阅</button>
  </div>
  <div class="rss-list">                ← max-height 340px,可滚动,顶部 10px 渐隐
    <a class="rss-item" href=…>          ← 三栏 grid:84px 来源 / 1fr 标题 / auto 时间
      <span class="rss-source">IT之家</span>
      <span class="rss-title">初探苹果 macOS 27 触控体验…</span>
      <span class="rss-time">24 分钟前</span>
    </a>
    … ×40
  </div>
</div>
```

### 1.2 现有样式

| 类名 | 作用 | 当前值 |
|---|---|---|
| `.rss-panel` | 面板 | 无背景,仅 `border-top` + `padding-top: 12px` |
| `.rss-head-title` | 「订阅」 | 11px / 700 / 大写、`--text-muted`、letter-spacing .10em |
| `.rss-head-meta` | 源状态 | 10px、`--text-muted`、flex:1 |
| `.rss-tool` | 两个文字按钮 | 11px、`--accent`、悬停浅蓝底 |
| `.rss-item` | 一行 | `grid-template-columns: 84px minmax(0,1fr) auto`,`padding 6px 4px`,圆角 `--r-sm` |
| `.rss-source` | 来源 | 10px、`--text-tertiary`、单行 ellipsis |
| `.rss-title` | 标题 | 13px、`--text-primary`、**强制单行** ellipsis |
| `.rss-time` | 相对时间 | 10px、`--text-muted`、tabular-nums |

窄屏(≤480px)只把来源列压到 68px、标题降到 12px。

---

## 2. 我为什么觉得它不好看(具体到可改的点)

1. **本质是一张表格**。三栏固定 grid,每行左中右对齐得像日志导出,而不是"内容流"。
2. **来源列在重复**。一个源连续 8 条,左列就是 8 次同样的四个字,占了 84px 却零信息增量。
3. **标题被截断**。中文长标题在 13px 单行下只能露 20 来个字,读者拿不到完整信息,而标题才是这一块的主体。
4. **40 条平铺没有节奏**。没有"今天 / 昨天 / 更早"之类的分段,滚动起来是一堵墙。
5. **不像一家人**。上面的行情是圆角卡片、右边的热榜是卡片,只有这块是裸列表 + 一条分割线。
6. **头部信息层级混乱**。一个标题、一个技术指标("5/5 个源正常")、两个纯文字按钮挤在一行,视觉权重接近。
7. **可点性暗示弱**。整行可点开原文,但只有悬停底色变化,没有箭头、没有位移,时间列反而最抢眼(纯数字）。
8. **弹窗与「页面设置」不一致**。订阅管理里的选项做成 pill 形 checkbox,而「页面设置」里是下拉 + 分段按钮。

---

## 3. 三个可选方向(选一个,或混)

| 方向 | 长什么样 | 适合 | 代价 |
|---|---|---|---|
| **A. 时间线** | 左侧一条竖轴 + 圆点,按「今天 / 昨天 / 更早」分段;来源缩成时间轴旁的小字 | 强调"什么时候发生的",和热榜的榜单气质区分开 | 每行可用宽度变窄,长标题要两行 |
| **B. 卡片流** | 每条一张小卡(来源 chip + 标题 + 时间),两列排;悬停浮起 | 信息密度高、显精致 | 40 张卡容易吵,滚动高度翻倍 |
| **C. 单列重排(改动最小)** | 保持一列,但:来源做成行首 chip、标题两行、时间弱化到右侧次要色、悬停整行右移 2px + 箭头 | 与现有列表气质连续、实现最快 | 惊喜有限 |

无论哪条,**来源重复**都要处理:同一源的连续条目可以把来源列留空(只在换源时显示一次),或把来源做成行首的彩色小标签。

---

## 4. 硬约束

1. **零构建、不引依赖**。只改 CSS + 少量 DOM 结构,不引入框架/图标库/字体文件。
2. **全部走 design tokens**(定义在 `frontend/css/main.css` 的 `:root`):
   - 间距 `--sp-1…--sp-10`、字号 `--fs-2xs…--fs-3xl`、圆角 `--r-sm…--r-full`
   - 颜色 `--bg-base/--bg-elev-1…3/--bg-hover`、`--text-primary/secondary/tertiary/muted`、`--border-subtle/--border-strong`、`--accent`/`--accent-bg`、`--emerald`/`--rose`/`--amber`
   - 动效 `--dur-fast/--dur-base`、`--ease-out`
   - 阴影 `--shadow-sm/--shadow-md`
   - 不要写死十六进制颜色(现有 `.rss-custom-del:hover` 里的 `#fff` 是唯一例外,可保留)
3. **深浅两套主题都要成立**。深色由 `:root[data-theme="dark"]` 覆盖 token,新样式不要绕开 token 直接上色。
4. **三个断点**:`max-width: 1260 / 768 / 480`,窄屏必须能读(标题至少两行)。
5. **类名前缀 `.rss-`**,不要复用 `.hot-*`(热榜在用)、不要改 `.fin-*`。
6. **不要改这些 id / 结构契约**(`frontend/js/rss.js` 直接取):
   - `#rssList` `#rssMeta` `#rssRefreshBtn` `#rssManageBtn`
   - 条目必须是 `<a href=…>`(点开原文),`.rss-item` 这个名字可保留可换,但换了要同步改 `renderItems()`
   - 弹窗:`#rssPresets` `#rssCustomList` `#rssUrlInput` `#rssAddBtn` `#rssSave` `#rssCancel`
7. **性能**:列表最多 40 条。不要在大面积元素上用 `backdrop-filter` 或 `filter: blur()`,不要给每行加 `transition: all`。

---

## 5. 要出图的状态(缺一不可)

| 状态 | 怎么造 |
|---|---|
| 正常 40 条 | 默认 5 个源 |
| 部分源失败(显示 `2/5 个源正常`) | 勾几个境外源后断网/在受限网络里加载 |
| 加载中 | 刷新瞬间(`.hot-panel-loading` 的文案) |
| 空列表(没有订阅) | 去掉全部源保存 |
| 超长标题 | IT之家当天的高频长标题足够 |
| 弹窗 | 「管理订阅」,亮色 + 暗色各一张 |
| 窄屏 | 480px 宽 |
| 深色 | 上述至少两个状态 |

**截图必须用唯一文件名**(带时间戳),复用同一路径会让人看到缓存的旧图——这次改造里已经因此浪费过一轮。

---

## 6. 验收

1. 40 条列表滚动顺滑(不复用 `backdrop-filter`)。
2. 深色下标题正文对比度 ≥ 4.5:1。
3. 480px 宽时标题至少两行或能完整读到,来源不再挤成一条缝。
4. 视觉上属于"这个站":圆角、留白、字重与行情卡/热榜卡一致。
5. 「订阅」这一块的视觉权重低于行情、高于页脚——它不该比行情更抢眼,但也不能像一行脚注。
6. 弹窗与「页面设置」用同一套控件语言(下拉/分段按钮/输入框)。

---

## 7. 代码位置

| 文件 | 位置 | 说明 |
|---|---|---|
| `frontend/index.html` | 309 行起 `.rss-panel` 整块 | 面板骨架 |
| `frontend/index.html` | 160 行起 `#rssModal` | 订阅管理弹窗 |
| `frontend/css/main.css` | **1133–1230 行** | RSS 全部样式 |
| `frontend/css/main.css` | 1499–1500 行 | ≤480px 的覆盖 |
| `frontend/js/rss.js` | `renderItems()` / `renderModal()` | 生成 DOM;可改结构,别改 id |
| 后端 | `backend/src/sources/rss.js` | **不用动** |

数据结构(`/api/rss` 返回):

```js
items: [{ title, link, time /* ms */, source /* 源标题 */, feed /* 源 URL */ }]
feeds: [{ url, ok, title?, count?, error? }]
```

前端渲染时来源优先用预设短名(`presetName(it.feed)`),自定义源回落到 `it.source`——设计时注意"来源名可能很长"(如「奇客Solidot–传递最新科技情报」)。

---

## 8. 怎么跑起来

```bash
# 后端(需要真实数据)
cd backend && npm install --cache /tmp/npm-cache   # 只装一次
PORT=3000 TZ=Asia/Shanghai node src/server.js

# 静态服务(另开一个)
python3 -m http.server 8099 --directory frontend
# 但 /api 要走后端,开发时用一个把 /api 反代到 3000 的小服务更方便
```

注意:部分境外源在受限网络里取不到,会显示「N/5 个源正常」——这是网络问题,不是样式问题,出图时换成本地能取到的源即可。
