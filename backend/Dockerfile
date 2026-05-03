FROM node:20-alpine

# wget 用于构建时拉 holiday-cn 数据 + 容器内 healthcheck
RUN apk add --no-cache wget ca-certificates

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

# 构建时打包 NateScarlet/holiday-cn 多年 JSON,失败不阻塞构建
# 这是 CN 节假日的镜像内离线兜底层(在 timor.tech / GitHub 都挂时使用)
RUN mkdir -p /app/data/holiday-cn && \
    for year in 2023 2024 2025 2026 2027 2028 2029 2030; do \
      wget -q --tries=2 --timeout=15 \
        -O /app/data/holiday-cn/$year.json \
        "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/$year.json" \
        || rm -f /app/data/holiday-cn/$year.json; \
    done && \
    ls -la /app/data/holiday-cn/

# 降权:用 alpine 自带的 node 用户跑
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

# 健康检查:容器进程在但卡死时 docker 也能识别
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/server.js"]
