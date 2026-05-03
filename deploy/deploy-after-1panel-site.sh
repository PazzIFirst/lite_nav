#!/bin/bash
# 用法: sudo bash /opt/nav-backend/deploy-after-1panel-site.sh
# 前提: 已在 1Panel UI 创建网站 hi.xzsjno1.com 并申请 SSL 证书
#
# 这个脚本做三件事:
#   1. 把 /opt/nav-backend/index.html 复制到 1Panel 网站根目录
#   2. 在 1Panel 生成的 conf 文件里注入 location /api/ 反代
#   3. 重载 OpenResty

set -euo pipefail

DOMAIN="hi.xzsjno1.com"
SITE_ROOT="/opt/1panel/apps/openresty/openresty/www/sites/${DOMAIN}/index"
CONF_FILE="/opt/1panel/apps/openresty/openresty/conf/conf.d/${DOMAIN}.conf"
SNIPPET="/opt/nav-backend/openresty-snippet.conf"
SRC_HTML="/opt/nav-backend/index.html"
OPENRESTY_CTN="1Panel-openresty-pdNW"

if [ ! -d "$SITE_ROOT" ]; then
  echo "❌ 站点目录不存在: $SITE_ROOT"
  echo "   请先在 1Panel UI 创建网站 ${DOMAIN}(类型选「静态网站」)"
  exit 1
fi
if [ ! -f "$CONF_FILE" ]; then
  echo "❌ 站点配置不存在: $CONF_FILE"
  exit 1
fi

echo "→ 部署 index.html → $SITE_ROOT/"
cp "$SRC_HTML" "$SITE_ROOT/index.html"

if grep -q "nav-backend API" "$CONF_FILE"; then
  echo "→ 反代配置已存在,跳过"
else
  echo "→ 备份并注入 /api/ 反代"
  cp "$CONF_FILE" "${CONF_FILE}.bak.$(date +%s)"

  python3 - "$CONF_FILE" "$SNIPPET" <<'PYEOF'
import sys, re
conf_path, snip_path = sys.argv[1], sys.argv[2]
with open(conf_path) as f: text = f.read()
with open(snip_path) as f: snippet = f.read().rstrip() + '\n'

# 在每个 server { ... } 块的最后一个 } 之前插入 snippet
def inject(match):
    body = match.group(1)
    # 不重复注入
    if 'nav-backend API' in body:
        return match.group(0)
    return 'server {' + body.rstrip() + '\n' + snippet + '}'

# 匹配 server {  ...balanced...  }  — 用括号深度跟踪
out, i, n = [], 0, len(text)
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

echo "→ 测试 OpenResty 配置"
docker exec "$OPENRESTY_CTN" openresty -t

echo "→ 重载 OpenResty"
docker exec "$OPENRESTY_CTN" openresty -s reload

echo ""
echo "✓ 部署完成"
echo ""
echo "测试:"
echo "  curl -s https://${DOMAIN}/api/health"
echo "  浏览器访问: https://${DOMAIN}"
