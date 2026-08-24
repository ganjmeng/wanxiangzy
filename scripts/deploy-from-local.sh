#!/usr/bin/env bash
set -euo pipefail

# Wanxiangzy 手动部署脚本（Mac 本地运行）
# 原因：EC2 1.9G 内存 next build 会 OOM，所以本地构建，只传 .next 上去。
# 用法: ./scripts/deploy-from-local.sh <tag> [worker_instances] [worker_concurrency] [image_batch_concurrency]
# 后三项省略时，优先使用后台已发布 Worker 配置，其次使用生产环境文件。
# 示例: ./scripts/deploy-from-local.sh v2026.08.21-generation-queue.1 1 64 16

TAG="${1:?用法: $0 <tag> [worker_instances] [worker_concurrency] [image_batch_concurrency]}"
WORKER_INSTANCES="${2:-}"
WORKER_CONCURRENCY="${3:-}"
IMAGE_BATCH_CONCURRENCY="${4:-}"

validate_optional_integer() {
  local name="$1" value="$2" minimum="$3" maximum="$4"
  if [ -z "$value" ]; then return; fi
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt "$minimum" ] || [ "$value" -gt "$maximum" ]; then
    echo "$name 必须是 $minimum-$maximum 的整数" >&2
    exit 1
  fi
}

validate_optional_integer "worker_instances" "$WORKER_INSTANCES" 1 32
validate_optional_integer "worker_concurrency" "$WORKER_CONCURRENCY" 1 64
validate_optional_integer "image_batch_concurrency" "$IMAGE_BATCH_CONCURRENCY" 1 24

SSH_KEY="${SSH_KEY:-$HOME/Downloads/hk01.pem}"
SSH_HOST="${SSH_HOST:-13.237.73.135}"
SSH_USER="${SSH_USER:-ec2-user}"
WEB_INSTANCES="${WEB_INSTANCES:-1}"
APP_DIR="apps/wanxiangzy"
NODE_BIN="/home/ec2-user/.nvm/versions/node/v22.23.0/bin/node"
REPO="https://github.com/ganjmeng/wanxiangzy.git"
RELEASE_NAME="manual-$TAG"
LOCAL_TAR="/tmp/wanxiangzy-next-$TAG.tar.gz"
REMOTE_TAR="/tmp/wanxiangzy-next-$TAG.tar.gz"
# 部署钩子里的清理阈值 — 通过同名环境变量可覆盖。
KEEP_LOCAL_TARBALLS="${KEEP_LOCAL_TARBALLS:-5}"
KEEP_REMOTE_RELEASES="${KEEP_REMOTE_RELEASES:-3}"
KEEP_REMOTE_TARBALLS="${KEEP_REMOTE_TARBALLS:-2}"
LOG_TRUNCATE_KB="${LOG_TRUNCATE_KB:-5120}"

echo "==> [1/6] 清理本地 /tmp 历史 tarball (保留最近 ${KEEP_LOCAL_TARBALLS} 个)"
if compgen -G "/tmp/wanxiangzy-next-*.tar.gz" > /dev/null; then
  total=$(ls -1t /tmp/wanxiangzy-next-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
  to_remove=$(ls -1t /tmp/wanxiangzy-next-*.tar.gz 2>/dev/null \
    | grep -v "/${TAG}.tar.gz\$" \
    | tail -n +$((KEEP_LOCAL_TARBALLS + 1)) || true)
  if [ -n "${to_remove:-}" ]; then
    echo "    移除:"
    echo "$to_remove" | sed 's/^/      /'
    echo "$to_remove" | xargs -I{} rm -f {} 2>/dev/null || true
  fi
  remaining=$(ls -1 /tmp/wanxiangzy-next-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
  echo "    本地 tarball: $total -> $remaining 个"
else
  echo "    没有旧 tarball"
fi

echo "==> [2/6] 验证 Supabase 运行时契约与 Realtime 发布配置"
node --env-file-if-exists=.env.production --env-file-if-exists=.env.local - <<'NODE'
import { readFileSync } from "node:fs";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Migration gate: Supabase URL or service role key is missing.");
  process.exit(1);
}

let response;
try {
  response = await fetch(`${url}/rest/v1/rpc/is_generation_outbox_realtime_ready`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
} catch {
  console.error("Migration gate: generation outbox Realtime status is unreachable.");
  process.exit(1);
}

let ready = false;
if (response.ok) {
  try {
    ready = await response.json() === true;
  } catch {
    ready = false;
  }
}
if (!ready) {
  console.error("Migration gate: generation outbox is missing from the Supabase Realtime publication.");
  process.exit(1);
}
console.log("Migration gate: generation outbox Realtime publication is ready.");

const expected = JSON.parse(readFileSync("runtime-contract.json", "utf8"));
let contractResponse;
try {
  contractResponse = await fetch(`${url}/rest/v1/rpc/get_runtime_contract_version`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
} catch {
  console.error("Migration gate: runtime contract is unreachable.");
  process.exit(1);
}
const rows = contractResponse.ok ? await contractResponse.json().catch(() => []) : [];
const actual = Array.isArray(rows) ? rows[0] : rows;
if (
  actual?.contract_version !== expected.contractVersion
  || actual?.contract_hash !== expected.contractHash
) {
  console.error(`Migration gate: expected ${expected.contractVersion}/${expected.contractHash}, got ${actual?.contract_version || "missing"}/${actual?.contract_hash || "missing"}.`);
  process.exit(1);
}
console.log(`Migration gate: runtime contract ${expected.contractVersion} is ready.`);

const requiredSkillTables = [
  "creative_agent_skills",
  "creative_agent_skill_versions",
  "creative_user_skills",
];
let schemaResponse;
try {
  schemaResponse = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      accept: "application/openapi+json",
    },
    signal: AbortSignal.timeout(10_000),
  });
} catch {
  console.error("Migration gate: Supabase Data API schema is unreachable.");
  process.exit(1);
}
if (!schemaResponse.ok) {
  console.error("Migration gate: could not read the authenticated Data API schema.");
  process.exit(1);
}
const schema = await schemaResponse.json();
const paths = schema && typeof schema.paths === "object" ? schema.paths : {};
const missingSkillTables = requiredSkillTables.filter(
  (name) => !Object.prototype.hasOwnProperty.call(paths, `/${name}`),
);
if (missingSkillTables.length > 0) {
  console.error(`Migration gate: missing Skill tables (${missingSkillTables.join(", ")}). Apply the Agent Skill migrations first.`);
  process.exit(1);
}
console.log("Migration gate: Agent Skill registry and version tables are ready.");
NODE

echo "==> [3/6] 本地构建 .next"
npm run build

echo "==> [4/6] 打包 .next"
tar -czf "$LOCAL_TAR" .next

echo "==> [5/6] 上传 .next 到 EC2"
scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$LOCAL_TAR" "$SSH_USER@$SSH_HOST:$REMOTE_TAR"

echo "==> [6/6] 远端清理旧 release / PM2 日志 / tarball + 准备 + 启动"
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SSH_USER@$SSH_HOST" \
  "KEEP_REMOTE_RELEASES=$KEEP_REMOTE_RELEASES KEEP_REMOTE_TARBALLS=$KEEP_REMOTE_TARBALLS LOG_TRUNCATE_KB=$LOG_TRUNCATE_KB TAG=$TAG WORKER_INSTANCES=$WORKER_INSTANCES WORKER_CONCURRENCY=$WORKER_CONCURRENCY IMAGE_BATCH_CONCURRENCY=$IMAGE_BATCH_CONCURRENCY WEB_INSTANCES=$WEB_INSTANCES NODE_BIN=$NODE_BIN APP_DIR=$APP_DIR REPO=$REPO REMOTE_TAR=$REMOTE_TAR bash -s" <<'REMOTE'
set -euo pipefail
RELEASE="$HOME/$APP_DIR/releases/manual-$TAG"
CURRENT="$(readlink -f "$HOME/$APP_DIR/current" 2>/dev/null || true)"

echo "---- [remote cleanup]"
RELEASES_DIR="$HOME/$APP_DIR/releases"
if compgen -G "$RELEASES_DIR/manual-*" > /dev/null; then
  keep_n="$KEEP_REMOTE_RELEASES"
  total=$(ls -1dt "$RELEASES_DIR"/manual-* 2>/dev/null | wc -l | tr -d ' ')
  to_remove=$(ls -1dt "$RELEASES_DIR"/manual-* 2>/dev/null | tail -n +$((keep_n + 1)) || true)
  if [ -n "${to_remove:-}" ]; then
    echo "    当前 release (保留最近 ${keep_n} 个 + current):"
    ls -1dt "$RELEASES_DIR"/manual-* 2>/dev/null | head -"$keep_n" | sed 's/^/      /'
    echo "    待清理:"
    echo "$to_remove" | while read -r d; do
      abs="$(cd "$d" 2>/dev/null && pwd || echo "$d")"
      if [ "$abs" = "$CURRENT" ]; then
        echo "      SKIP ${d#$RELEASES_DIR/} (current symlink target)"
      else
        echo "      rm -rf ${d#$RELEASES_DIR/}"
        rm -rf "$d"
      fi
    done
  fi
  remaining=$(ls -1dt "$RELEASES_DIR"/manual-* 2>/dev/null | wc -l | tr -d ' ')
  echo "    release 计数: $total -> $remaining"
else
  echo "    releases 目录为空，跳过 release 清理"
fi

big_logs=$(find "$HOME/.pm2/logs" -type f -name "*.log" -size +${LOG_TRUNCATE_KB}k 2>/dev/null || true)
if [ -n "${big_logs:-}" ]; then
  echo "    截断 PM2 日志 (>${LOG_TRUNCATE_KB}KB):"
  echo "$big_logs" | while read -r f; do
    size=$(stat -c %s "$f" 2>/dev/null || echo "?")
    : > "$f"
    echo "      truncated ${f#$HOME/} (was ${size} bytes)"
  done
else
  echo "    PM2 日志无需截断"
fi

old_tars=$(ls -1t /tmp/wanxiangzy-next-*.tar.gz 2>/dev/null | tail -n +$((KEEP_REMOTE_TARBALLS + 1)) | grep -v "/${TAG}.tar.gz\$" || true)
if [ -n "${old_tars:-}" ]; then
  echo "    清理 EC2 /tmp 上历史 tarball (保留当前 + 上一个):"
  echo "$old_tars" | while read -r f; do
    echo "      rm $(basename "$f")"
    rm -f "$f"
  done
fi
echo "    EC2 /tmp tarball 剩余 $(ls -1 /tmp/wanxiangzy-next-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') 个"
echo "---- [remote cleanup done]"

if [ ! -d "$RELEASE/.git" ]; then
  TOKEN="$(tr -d '[:space:]' < "$HOME/.wanxiangzy-gh-token")"
  git clone --depth 1 --branch "$TAG" "https://${TOKEN}@github.com/ganjmeng/wanxiangzy.git" "$RELEASE"
  git -C "$RELEASE" remote set-url origin "$REPO"
fi
if [ ! -d "$RELEASE/node_modules" ] && [ -n "$CURRENT" ] && [ -d "$CURRENT/node_modules" ]; then
  cp -a "$CURRENT/node_modules" "$RELEASE/node_modules"
elif [ ! -d "$RELEASE/node_modules" ]; then
  (cd "$RELEASE" && npm ci)
fi
cp "$HOME/$APP_DIR/shared/.env.production" "$RELEASE/.env.production"
DEPLOY_WORKER_INSTANCES="$WORKER_INSTANCES" \
DEPLOY_WORKER_CONCURRENCY="$WORKER_CONCURRENCY" \
DEPLOY_IMAGE_BATCH_CONCURRENCY="$IMAGE_BATCH_CONCURRENCY" \
  "$NODE_BIN" --env-file="$RELEASE/.env.production" "$RELEASE/scripts/apply-worker-runtime-config.mjs" "$RELEASE/.env.production"
rm -rf "$RELEASE/.next"
tar -xzf "$REMOTE_TAR" -C "$RELEASE"
ln -sfn "$RELEASE" "$HOME/$APP_DIR/current"
cd "$RELEASE"
pm2 delete wanxiangzy wanxiangzy-worker >/dev/null 2>&1 || true
PM2_APP_NAME=wanxiangzy PM2_RELEASE_DIR="$RELEASE" PM2_NODE_BIN="$NODE_BIN" PM2_WEB_INSTANCES="$WEB_INSTANCES" PM2_KILL_TIMEOUT_MS=65000 PM2_READY_TIMEOUT_MS=60000 "$NODE_BIN" --env-file="$RELEASE/.env.production" -e 'process.stdout.write(JSON.stringify(require("./ecosystem.production.cjs"), null, 2))' > /tmp/ecosystem.json
NODE_ENV=production pm2 startOrReload /tmp/ecosystem.json --update-env
pm2 save
pm2 status
REMOTE

echo ""
echo "==> 完成。访问 https://pixel-diffusion.com 验证"
