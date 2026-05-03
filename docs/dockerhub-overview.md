# lite-nav backend

> 自部署轻量级导航主页的后端 — 农历、多国节假日、行情、热榜聚合,多源容灾,**永不返回空**。
> Self-hostable lightweight nav homepage backend — lunar calendar, multi-country holidays, live finance & hot lists. Multi-source fallback that **never returns empty**.

![lite-nav preview](https://raw.githubusercontent.com/PazzIFirst/lite_nav/main/docs/screenshot.png)

GitHub: **[PazzIFirst/lite_nav](https://github.com/PazzIFirst/lite_nav)** · License: GPL-3.0

---

## 快速启动 / Quick Start

```bash
# 1. 拉取 compose 模板 / Get the compose template
curl -O https://raw.githubusercontent.com/PazzIFirst/lite_nav/main/backend/docker-compose.yml.example
mv docker-compose.yml.example docker-compose.yml

# 2. 编辑 REDIS_HOST / REDIS_PASSWORD
# 2. Edit REDIS_HOST / REDIS_PASSWORD in docker-compose.yml

# 3. 启动 / Up
docker compose up -d
docker logs nav-backend --tail 20
```

完整部署(前端、反代、Let's Encrypt SSL)见 → [GitHub 部署文档](https://github.com/PazzIFirst/lite_nav#部署步骤以-1panel-为例5-分钟)

Full deployment guide (frontend + reverse proxy + Let's Encrypt SSL) → see [GitHub README](https://github.com/PazzIFirst/lite_nav#快速开始)

---

## 这是什么 / What's inside

- Express on Node.js 20-alpine
- Redis 双层缓存 `cache:` + `lastgood:`(stale-while-revalidate 模式)
- node-cron 定时任务:行情 30s、热榜 5min、节假日每日、农历 00:01 / scheduled tasks for finance (30s) / hot (5min) / holidays (daily) / almanac (00:01)
- 中国节假日 5 层 fallback,含**镜像内打包数据**(2026-2030) / 5-tier fallback chain for CN public holidays incl. image-baked offline data
- 农历、24 节气、老黄历(宜忌、神位、彭祖百忌)— 100% 离线,基于 `lunar-javascript`
  Lunar calendar, 24 solar terms, Chinese almanac (yi/ji/positions/pengzu) — 100% offline
- 20 国法定节假日全中文显示,悬停看原文,点击复制
  20-country public holidays, all translated to Chinese with native originals on hover
- 446 个国内城市精确映射 CMA cityCode,优先用国家气象局数据
  446 prefectured Chinese cities mapped to CMA cityCode for accurate domestic weather

---

## Tags

| Tag | Meaning / 含义 |
|---|---|
| `latest` | Latest `main` build / 最新 main 分支构建 |
| `1.0.0`, `1.0` | Semantic version / 语义化版本 |
| `sha-XXXXXXX` | Specific commit (immutable) / 特定 commit |

## Architectures

- `linux/amd64`
- `linux/arm64`(树莓派、Apple Silicon、ARM 服务器 / Raspberry Pi, Apple Silicon, ARM servers)

## 系统要求 / System requirements

- 最低 1 vCPU, 512 MB RAM(推荐 1 GB)/ Minimum 1 vCPU, 512 MB RAM (1 GB recommended)
- 容器可达的 Redis 6+ / Redis 6+ reachable from the container
- 镜像约 250 MB / Image ~250 MB

## 配置 / Configuration

| Env | Default | Description |
|---|---|---|
| `PORT` | `3000` | Listen port / 监听端口 |
| `REDIS_HOST` | `redis` | Redis host/container name / Redis 主机或容器名 |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | _(empty)_ | Redis password |
| `TZ` | `Asia/Shanghai` | Timezone |

---

## 反馈 / Issues

issues / PRs welcome at GitHub: **[PazzIFirst/lite_nav](https://github.com/PazzIFirst/lite_nav)**
