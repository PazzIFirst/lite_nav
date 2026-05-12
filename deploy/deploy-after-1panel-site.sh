#!/bin/bash
# 部署 lite-nav 到 1Panel 站点(注入反代 + 拷贝 index.html)
#
# 用法:
#   sudo bash deploy-after-1panel-site.sh <domain> [openresty-container]
#
# 例:
#   sudo bash deploy-after-1panel-site.sh nav.example.com
#   sudo bash deploy-after-1panel-site.sh nav.example.com 1Panel-openresty-abc1
#
# 也可用环境变量:
#   DOMAIN=nav.example.com OPENRESTY_CONTAINER=1Panel-openresty-abc1 sudo -E bash deploy-after-1panel-site.sh
#
# 前提:已在 1Panel UI 创建网站并申请 SSL 证书。

set -euo pipefail

DOMAIN="${DOMAIN:-${1:-}}"
OPENRESTY_CTN="${OPENRESTY_CONTAINER:-${2:-}}"
PANEL_ROOT="${PANEL_ROOT:-/opt/1panel/apps/openresty/openresty}"

if [ -z "$DOMAIN" ]; then
  echo "用法: sudo bash $0 <domain> [openresty-container-name]"
  echo "例:  sudo bash $0 nav.example.com"
  exit 1
fi

# 自动检测 OpenResty 容器(若未传入)
if [ -z "$OPENRESTY_CTN" ]; then
  OPENRESTY_CTN=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE 'openresty' | head -1 || true)
  if [ -z "$OPENRESTY_CTN" ]; then
    echo "找不到 OpenResty 容器,请用第二个参数显式指定"
    echo "可用容器:"
    docker ps --format '  {{.Names}} ({{.Image}})'
    exit 1
  fi
  echo "[i] 自动检测到 OpenResty 容器: $OPENRESTY_CTN"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_ROOT="${PANEL_ROOT}/www/sites/${DOMAIN}/index"
CONF_FILE="${PANEL_ROOT}/conf/conf.d/${DOMAIN}.conf"
SNIPPET="${SCRIPT_DIR}/openresty-api-snippet.conf.example"
FRONTEND_DIR="${SCRIPT_DIR}/../frontend"

if [ ! -d "$SITE_ROOT" ]; then
  echo "站点目录不存在: $SITE_ROOT"
  echo "请先在 1Panel UI 创建网站 ${DOMAIN}(类型选「静态网站」)"
  exit 1
fi
if [ ! -f "$CONF_FILE" ]; then
  echo "站点配置不存在: $CONF_FILE"
  exit 1
fi
if [ ! -d "$FRONTEND_DIR" ]; then
  echo "前端目录不存在: $FRONTEND_DIR"
  exit 1
fi
if [ ! -f "$SNIPPET" ]; then
  echo "反代片段不存在: $SNIPPET"
  exit 1
fi

echo "[1/3] 部署 frontend/* → $SITE_ROOT/(含 index.html + css + js + flags + robots/sitemap)"
cp -r "$FRONTEND_DIR"/* "$SITE_ROOT/"

if grep -q "nav-backend API" "$CONF_FILE"; then
  echo "[2/3] 反代配置已存在,跳过注入"
else
  echo "[2/3] 备份并注入 /api/ 反代到 $CONF_FILE"
  cp "$CONF_FILE" "${CONF_FILE}.bak.$(date +%s)"

  python3 - "$CONF_FILE" "$SNIPPET" <<'PYEOF'
import sys
conf_path, snip_path = sys.argv[1], sys.argv[2]
with open(conf_path) as f: text = f.read()
with open(snip_path) as f: snippet = f.read().rstrip() + '\n'

# 在每个 server { ... } 块的最后一个 } 之前插入 snippet
# 用括号深度跟踪,匹配嵌套花括号
out, i, n = [], 0, len(text)
import re
while i < n:
    m = re.search(r'\bserver\s*\{', text[i:])
    if not m:
        out.append(text[i:])
        break
    out.append(text[i:i+m.start()])
    start = i + m.end()
    depth = 1
    j = start
    while j < n and depth:
        if text[j] == '{': depth += 1
        elif text[j] == '}': depth -= 1
        j += 1
    body = text[start:j-1]
    if 'nav-backend API' in body:
        out.append(text[i+m.start():j])
    else:
        out.append('server {')
        out.append(body.rstrip())
        out.append('\n' + snippet)
        out.append('}')
    i = j

with open(conf_path, 'w') as f: f.write(''.join(out))
PYEOF
fi

echo "[3/3] 测试 + 重载 OpenResty"
docker exec "$OPENRESTY_CTN" openresty -t
docker exec "$OPENRESTY_CTN" openresty -s reload

echo ""
echo "完成。测试:"
echo "  curl -s https://${DOMAIN}/api/health"
echo "  浏览器访问: https://${DOMAIN}"
