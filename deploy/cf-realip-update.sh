#!/usr/bin/env bash
# 自动刷新 Cloudflare 网段白名单(配合 cloudflare-realip.conf.example)
#
# 为什么需要:CF 网段变动后,新增网段不在白名单里 → nginx 不采信这些节点发来的
# CF-Connecting-IP → 经该网段来的访客共用一个限流桶,可能误伤吃 429。
# 注意这个失效是「朝安全侧倒」的:漏网段只会少信任,不会让谁能伪造 IP。
#
# 安装:
#   cp deploy/cf-realip-update.sh /usr/local/sbin/cf-realip-update
#   chmod +x /usr/local/sbin/cf-realip-update
#   # 配 systemd timer(见 deploy/cf-realip-update.timer.example),或 cron:
#   #   17 4 * * 1 /usr/local/sbin/cf-realip-update >>/var/log/cf-realip.log 2>&1
#
# 手动预演(不改任何文件):
#   DRY_RUN=1 /usr/local/sbin/cf-realip-update

set -uo pipefail

CONF="${CONF:-/etc/nginx/snippets/cloudflare-realip.conf}"
V4_URL="${V4_URL:-https://www.cloudflare.com/ips-v4}"
V6_URL="${V6_URL:-https://www.cloudflare.com/ips-v6}"
DRY_RUN="${DRY_RUN:-0}"
# 合理性下限:CF 正常有 15 个 v4 + 7 个 v6 网段。低于这个数说明响应被截断/劫持/
# 返回了错误页,宁可什么都不做也不能拿残缺列表覆盖 —— 那会把大量 CF 节点踢出白名单。
MIN_V4="${MIN_V4:-10}"
MIN_V6="${MIN_V6:-4}"

log() { echo "[$(date '+%F %T')] $*"; }
die() { log "ABORT: $*"; exit 1; }

v4=$(curl -fsS --max-time 20 "$V4_URL") || die "拉取 v4 列表失败,保持现状不动"
v6=$(curl -fsS --max-time 20 "$V6_URL") || die "拉取 v6 列表失败,保持现状不动"

# 只保留形如 x.x.x.x/n 和 xxxx::/n 的行,过滤掉可能混进来的 HTML/空行
v4=$(grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$' <<<"$v4" || true)
v6=$(grep -E '^[0-9a-fA-F:]+/[0-9]+$'                  <<<"$v6" || true)

n4=$(grep -c . <<<"$v4"); n6=$(grep -c . <<<"$v6")
[ "$n4" -ge "$MIN_V4" ] || die "v4 网段只有 $n4 条(下限 $MIN_V4),响应可疑,保持现状不动"
[ "$n6" -ge "$MIN_V6" ] || die "v6 网段只有 $n6 条(下限 $MIN_V6),响应可疑,保持现状不动"

tmp=$(mktemp); trap 'rm -f "$tmp" "$tmp.bak"' EXIT
{
  echo "# Cloudflare 网段白名单 —— 本文件由 cf-realip-update 自动生成,请勿手改"
  echo "# 来源: $V4_URL / $V6_URL"
  echo "# 更新于: $(date '+%F %T %Z')"
  echo "#"
  echo "# 只有来自下列网段的请求,其 CF-Connecting-IP 头才被采信并还原成 \$remote_addr。"
  echo "# 非 CF 来源伪造该头一律忽略 —— 这是限流键和 /api/ip 不被污染的前提。"
  echo
  echo "# --- IPv4 ($n4) ---"
  sed 's/^/set_real_ip_from /; s/$/;/' <<<"$v4"
  echo
  echo "# --- IPv6 ($n6) ---"
  sed 's/^/set_real_ip_from /; s/$/;/' <<<"$v6"
  echo
  echo "real_ip_header CF-Connecting-IP;"
} > "$tmp"

# 网段集合没变就不动(避免无意义的 reload)
if [ -f "$CONF" ] && diff -q \
     <(grep -oE '[0-9a-fA-F:.]+/[0-9]+' "$CONF" | sort) \
     <(grep -oE '[0-9a-fA-F:.]+/[0-9]+' "$tmp"  | sort) >/dev/null 2>&1; then
  log "无变化($n4 v4 + $n6 v6),跳过"
  exit 0
fi

log "检测到变化:$n4 v4 + $n6 v6"
if [ "$DRY_RUN" = "1" ]; then
  log "DRY_RUN=1,仅预演。差异如下:"
  diff <(grep -oE '[0-9a-fA-F:.]+/[0-9]+' "$CONF" 2>/dev/null | sort) \
       <(grep -oE '[0-9a-fA-F:.]+/[0-9]+' "$tmp" | sort) || true
  exit 0
fi

# 就地替换 + nginx -t 校验;校验不过立即回滚,绝不留下起不来的配置
[ -f "$CONF" ] && cp "$CONF" "$tmp.bak"
install -m 644 "$tmp" "$CONF"
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx && log "已更新并 reload nginx"
else
  if [ -f "$tmp.bak" ]; then
    cp "$tmp.bak" "$CONF"; log "ROLLBACK: nginx -t 失败,已还原旧配置"
  else
    rm -f "$CONF"; log "ROLLBACK: nginx -t 失败,已移除新写入的配置"
  fi
  nginx -t >/dev/null 2>&1 || log "WARN: 回滚后 nginx -t 仍不通过,需人工介入"
  exit 1
fi
