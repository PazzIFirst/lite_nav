FROM node:20-alpine

# 安装 wget 用于构建时拉取 holiday-cn
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

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
