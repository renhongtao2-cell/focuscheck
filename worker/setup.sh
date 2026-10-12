#!/usr/bin/env bash
#
# FocusCheck — one-shot Worker setup
#
# Does everything between "I have a Cloudflare account" and "the site is
# generating AI reports":
#
#   1. checks you are logged in to Cloudflare
#   2. creates the ORDERS KV namespace and writes its id into wrangler.toml
#   3. stores your LLM API key as an encrypted secret
#   4. deploys the Worker
#   5. writes the Worker URL into assets/config.js
#
# Usage:   bash worker/setup.sh
#
# You need a Cloudflare account (free) and an LLM API key before starting.
# Run this from the project root or from worker/ — it handles both.

set -euo pipefail

# ---------------------------------------------------------------- helpers
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
info()  { printf '  %s\n' "$1"; }
fail()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
ok()    { printf '\033[32m✓ %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- locate dirs
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

CONFIG_JS="$PROJECT_DIR/assets/config.js"
WRANGLER_TOML="$SCRIPT_DIR/wrangler.toml"

[ -f "$WRANGLER_TOML" ] || fail "找不到 wrangler.toml —— 请在项目内运行本脚本"
[ -f "$CONFIG_JS" ]     || fail "找不到 assets/config.js —— 请在项目内运行本脚本"

bold "FocusCheck Worker 安装向导"
echo

# ---------------------------------------------------------------- 1. tooling
command -v npx >/dev/null 2>&1 || fail "需要 Node.js（含 npx）。请先安装 Node 18+。"

# Prefer a locally installed wrangler when one is available: installing it
# globally can fail behind a restricted shell, and the exact version does not
# matter for a deploy. Override with WRANGLER=/path/to/wrangler.
WRANGLER="${WRANGLER:-npx --yes wrangler}"

# ---------------------------------------------------------------- 2. login
bold "1/5  检查 Cloudflare 认证状态"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  info "使用 CLOUDFLARE_API_TOKEN（非交互模式）"
fi
if $WRANGLER whoami >/dev/null 2>&1; then
  ok "已认证"
else
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    fail "CLOUDFLARE_API_TOKEN 无效或权限不足。需要 Workers Scripts:Edit、Workers KV Storage:Edit、Account Settings:Read。"
  fi
  info "未登录，即将打开浏览器完成授权…"
  $WRANGLER login
  $WRANGLER whoami >/dev/null 2>&1 || fail "登录未完成，请重试"
  ok "登录成功"
fi
echo

# ---------------------------------------------------------------- 3. KV
bold "2/5  创建订单存储（KV）"
if grep -qE '^[[:space:]]*\[\[kv_namespaces\]\]' "$WRANGLER_TOML"; then
  ok "wrangler.toml 里已经配置过 KV，跳过"
else
  info "正在创建 ORDERS namespace…"
  KV_OUT="$($WRANGLER kv namespace create ORDERS 2>&1 || true)"
  KV_ID="$(printf '%s' "$KV_OUT" | grep -oE 'id[[:space:]]*=[[:space:]]*"[a-f0-9]{32}"' | grep -oE '[a-f0-9]{32}' | head -1)"

  if [ -z "$KV_ID" ]; then
    echo "$KV_OUT" | tail -20
    fail "无法从输出里解析出 KV id。请手动运行：npx wrangler kv namespace create ORDERS"
  fi

  # Replace the commented-out block with a real one.
  python - "$WRANGLER_TOML" "$KV_ID" <<'PY'
import re, sys
path, kv_id = sys.argv[1], sys.argv[2]
src = open(path, encoding="utf-8").read()
block = '[[kv_namespaces]]\nbinding = "ORDERS"\nid = "%s"\n' % kv_id
# swap the commented placeholder block for a real one
new, n = re.subn(r'(?ms)^# -+\n# KV namespace used to record paid orders\..*?^# id = ".*?"\n',
                 block, src)
if n != 1:
    sys.exit("无法在 wrangler.toml 里定位 KV 占位块（替换次数 %d）。"
             "请手动添加：\n[[kv_namespaces]]\nbinding = \"ORDERS\"\nid = \"%s\"" % (n, kv_id))
open(path, "w", encoding="utf-8").write(new)
PY
  ok "KV 已创建并写入 wrangler.toml（id: ${KV_ID:0:8}…）"
fi
echo

# ---------------------------------------------------------------- 4. secrets
bold "3/5  设置密钥"
if [ -n "${LLM_API_KEY:-}" ]; then
  info "使用环境变量里的 LLM_API_KEY"
else
  info "粘贴你的 LLM API key（输入不会显示在屏幕上），然后回车："
  printf '  > '
  IFS= read -rs LLM_API_KEY
  echo
fi
[ -n "$LLM_API_KEY" ] || fail "没有拿到 LLM API key"

printf '%s' "$LLM_API_KEY" | $WRANGLER secret put LLM_API_KEY >/dev/null
ok "LLM_API_KEY 已作为加密密钥保存"
unset LLM_API_KEY

# The webhook secret only matters once a payment provider is connected, so it
# is optional here rather than a prompt that blocks the first deploy.
if [ -n "${PAYMENT_WEBHOOK_SECRET:-}" ]; then
  printf '%s' "$PAYMENT_WEBHOOK_SECRET" | $WRANGLER secret put PAYMENT_WEBHOOK_SECRET >/dev/null
  ok "PAYMENT_WEBHOOK_SECRET 已保存"
  unset PAYMENT_WEBHOOK_SECRET
else
  info "未提供 PAYMENT_WEBHOOK_SECRET —— 接支付前记得补上"
fi
echo

# ---------------------------------------------------------------- 5. deploy
bold "4/5  部署 Worker"
DEPLOY_OUT="$($WRANGLER deploy 2>&1 || true)"
WORKER_URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)"

if [ -z "$WORKER_URL" ]; then
  echo "$DEPLOY_OUT" | tail -25
  fail "部署失败或无法解析出 URL，请查看上面的输出"
fi
ok "已部署：$WORKER_URL"
echo

# ---------------------------------------------------------------- 6. wire up
bold "5/5  把地址写进 assets/config.js"
python - "$CONFIG_JS" "$WORKER_URL" <<'PY'
import re, sys
path, url = sys.argv[1], sys.argv[2]
src = open(path, encoding="utf-8").read()
new, n = re.subn(r'API_ENDPOINT:\s*"[^"]*"', 'API_ENDPOINT: "%s"' % url, src, count=1)
if n == 0:
    sys.exit("config.js 里没找到 API_ENDPOINT")
open(path, "w", encoding="utf-8").write(new)
PY
ok "API_ENDPOINT 已更新"

echo
bold "完成。"
cat <<EOF

  下一步：
    1. 本地确认
       python -m http.server 8000
       先打开 http://localhost:8000/test.html 做完 18 题（答案存在浏览器里），
       再打开 http://localhost:8000/report.html?access=local-test
       应该能看到顶部出现「written for your specific answers」。

       为什么用 ?access=...：?sample= 和 ?unlocked=1 是本地预览模式，它们
       不调用大模型（report-ai.js 会直接返回），所以验证不了生成通路。
       而 REQUIRE_ACCESS 现在是 "false"，checkAccess() 直接放行 —— 随便一个
       access 值都能通过，这正是它此刻的用途。

    2. 提交上线    git add -A && git commit -m "Connect LLM" && git push

  记住：现在生成接口是开放的（任何人都能调用，会消耗你的额度）。
  等支付跑通后，把 worker/wrangler.toml 里的 REQUIRE_ACCESS 改成 "true"，
  再运行一次 bash worker/setup.sh（或 npx wrangler deploy）。

EOF
