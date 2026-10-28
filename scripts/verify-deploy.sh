#!/usr/bin/env bash
# 部署后校验:本地 frontend/ 与线上同名文件的哈希是否一致。
#
# 为什么需要它:Cloudflare / 浏览器会按 URL 缓存静态资源,项目又是零构建
# (文件名不带 hash)。发版后「文件已经换了」和「用户拿到的是新文件」是两件事,
# 只 diff 服务器目录看不出缓存层有没有刷。逐文件比哈希是唯一直接的判定。
#
# 用法:
#   bash scripts/verify-deploy.sh                       # 校验 https://litenav.info
#   BASE=https://example.com bash scripts/verify-deploy.sh
#   bash scripts/verify-deploy.sh --all                 # 连图片/flags 一起比(慢)
#   bash scripts/verify-deploy.sh --api                 # 额外查 /api/health 与版本
#
# 退出码:0 全部一致;1 有差异或请求失败。
set -uo pipefail

BASE="${BASE:-https://litenav.info}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/frontend"
ALL=0
CHECK_API=0

for arg in "$@"; do
  case "$arg" in
    --all) ALL=1 ;;
    --api) CHECK_API=1 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数:$arg(用 --help 看用法)" >&2; exit 2 ;;
  esac
done

[ -d "$FRONTEND" ] || { echo "找不到 frontend/ 目录:$FRONTEND" >&2; exit 2; }
command -v curl >/dev/null || { echo "需要 curl" >&2; exit 2; }

# macOS 是 shasum,Linux 是 sha256sum
if command -v sha256sum >/dev/null; then hashof() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null; then hashof() { shasum -a 256 "$1" | cut -d' ' -f1; }
else echo "需要 sha256sum 或 shasum" >&2; exit 2; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 默认只比文本资产 —— 图片和 flags 数量多、体积大,平时不会成为缓存问题
if [ "$ALL" -eq 1 ]; then
  mapfile -t FILES < <(cd "$FRONTEND" && find . -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' \
    -o -name '*.json' -o -name '*.xml' -o -name '*.txt' -o -name '*.svg' -o -name '*.png' -o -name '*.ico' \) \
    | sed 's|^\./||' | sort)
else
  mapfile -t FILES < <(cd "$FRONTEND" && find . -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' \
    -o -name '*.xml' -o -name '*.txt' -o -name 'og-image.png' \) | sed 's|^\./||' | sort)
fi

echo "对比 $BASE  共 ${#FILES[@]} 个文件"
echo

fail=0; stale=0; total=0; i=0; httpfail=0
for rel in "${FILES[@]}"; do
  i=$((i+1))
  total=$((total+1))
  local_hash="$(hashof "$FRONTEND/$rel")"
  out="$TMP/fetch"
  code=$(curl -sS --compressed -m 20 -o "$out" -w '%{http_code}' "$BASE/$rel" 2>"$TMP/err") || code="000"
  if [ "$code" != "200" ]; then
    printf '  ✗ %-28s HTTP %s\n' "$rel" "$code"
    stale=$((stale+1)); httpfail=$((httpfail+1)); fail=1; continue
  fi
  remote_hash="$(hashof "$out")"
  if [ "$local_hash" = "$remote_hash" ]; then
    [ $((i % 20)) -eq 0 ] && printf '  · 已检查 %d/%d\n' "$i" "$total"
  else
    printf '  ✗ %-28s 本地 %s  线上 %s\n' "$rel" "${local_hash:0:12}" "${remote_hash:0:12}"
    stale=$((stale+1)); fail=1
  fi
done

echo
if [ "$stale" -eq 0 ]; then
  echo "✓ $total 个文件全部与本地一致"
else
  echo "✗ $stale/$total 个文件不一致"
  if [ "$httpfail" -eq "$stale" ]; then
    echo "  全部是 HTTP 失败:检查 BASE 是否写对、站点是否已经部署"
  elif [ "$httpfail" -gt 0 ]; then
    echo "  其中 $httpfail 个是 HTTP 失败,其余是内容不一致"
    echo "  内容不一致通常是 Cloudflare 边缘还缓存着旧文件(发版前缓存了 1 天)"
    echo "  处理:CF 后台 Caching → Purge Everything,或用 API purge_cache;"
    echo "        源站 nginx 对 js/css 应发 Cache-Control: no-cache,否则每次发版都要手动清"
  else
    echo "  常见原因:Cloudflare 边缘还缓存着旧文件(发版前缓存了 1 天)"
    echo "  处理:CF 后台 Caching → Purge Everything,或用 API purge_cache;"
    echo "        源站 nginx 对 js/css 应发 Cache-Control: no-cache,否则每次发版都要手动清"
  fi
fi

if [ "$CHECK_API" -eq 1 ]; then
  echo
  health=$(curl -sS -m 10 -o "$TMP/health" -w '%{http_code}' "$BASE/api/health") || health="000"
  printf '  /api/health  HTTP %s  %s\n' "$health" "$(head -c 120 "$TMP/health" 2>/dev/null)"
  [ "$health" = "200" ] || fail=1
fi

exit "$fail"
