#!/usr/bin/env bash
set -Eeuo pipefail

trim_value() {
  local value="${1-}"
  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

APP_NAME="$(trim_value "${AWS_APP_NAME:-wanxiangzy}")"
if [ -z "$APP_NAME" ]; then
  APP_NAME="wanxiangzy"
fi

BASE_DIR="$(trim_value "${AWS_APP_DIR:-}")"
if [ -z "$BASE_DIR" ]; then
  BASE_DIR="$HOME/apps/wanxiangzy"
fi
case "$BASE_DIR" in
  "~")
    BASE_DIR="$HOME"
    ;;
  "~/"*)
    BASE_DIR="$HOME/${BASE_DIR#~/}"
    ;;
esac
if [ "$BASE_DIR" != "/" ]; then
  BASE_DIR="${BASE_DIR%/}"
fi

ARCHIVE="${DEPLOY_ARCHIVE:?DEPLOY_ARCHIVE is required}"
TAG="${TAG_NAME:-manual-$(date +%Y%m%d%H%M%S)}"
SAFE_TAG="$(printf '%s' "$TAG" | tr -c 'A-Za-z0-9._-' '-')"
RELEASE_DIR="$BASE_DIR/releases/$SAFE_TAG"
SHARED_DIR="$BASE_DIR/shared"
PREVIOUS_TARGET="$(readlink -f "$BASE_DIR/current" 2>/dev/null || true)"
# Application shutdown waits up to 40 seconds. PM2 must allow a larger drain
# window before SIGKILL so BullMQ can release locks and close QueueEvents.
PM2_KILL_TIMEOUT_MS=65000
PM2_READY_TIMEOUT_MS="${PM2_READY_TIMEOUT_MS:-60000}"
PM2_WEB_INSTANCES="${PM2_WEB_INSTANCES:-2}"
PM2_WORKER_INSTANCES=""
PM2_ROLLBACK_CONFIG="$SHARED_DIR/.pm2-rollback-${SAFE_TAG}.cjs"
SHARED_ENV_BACKUP="$SHARED_DIR/.env.production.rollback-${SAFE_TAG}"
SHARED_ENV_TEMP="$SHARED_DIR/.env.production.deploy-${SAFE_TAG}.tmp"
CUTOVER_STARTED=0
ROLLBACK_IN_PROGRESS=0
SHARED_ENV_SWITCHED=0

start_app() {
  local app_dir="$1"

  # 应用 engines 要求 node >=22 <23；pm2 在 22 的 shell 中启动进程，
  # 否则 node 23 下 Web Streams 内部 API 不兼容导致运行时崩溃。
  # pm2 默认解释器是它自身安装时的 node（可能仍是 23），必须显式指定 22。
  ensure_node_version
  local node_bin
  node_bin="$(command -v node)"
  echo "pm2 interpreter: $node_bin ($(node -v))"

  if [ ! -f "$app_dir/ecosystem.production.cjs" ]; then
    echo "Missing controlled PM2 ecosystem config in $app_dir" >&2
    return 1
  fi

  # startOrReload performs a rolling cluster reload for Web. Both entrypoints
  # send PM2's explicit `ready` message, so the next process is not replaced
  # until its successor has completed real application initialization.
  PM2_APP_NAME="$APP_NAME" \
    PM2_RELEASE_DIR="$app_dir" \
    PM2_NODE_BIN="$node_bin" \
    PM2_WEB_INSTANCES="$PM2_WEB_INSTANCES" \
    PM2_WORKER_INSTANCES="$PM2_WORKER_INSTANCES" \
    PM2_KILL_TIMEOUT_MS="$PM2_KILL_TIMEOUT_MS" \
    PM2_READY_TIMEOUT_MS="$PM2_READY_TIMEOUT_MS" \
    NODE_ENV=production \
    pm2 startOrReload "$app_dir/ecosystem.production.cjs" --update-env
}

verify_pm2_process_contract() {
  local expected_dir="$1"
  node "$RELEASE_DIR/scripts/verify-pm2-contract.cjs" \
    "$APP_NAME" \
    "$expected_dir" \
    "$PM2_WEB_INSTANCES" \
    "$PM2_WORKER_INSTANCES"
}

snapshot_pm2_process_config() {
  node "$RELEASE_DIR/scripts/snapshot-pm2-config.cjs" \
    "$PM2_ROLLBACK_CONFIG" \
    "$APP_NAME" \
    "${APP_NAME}-worker"
}

stage_shared_environment() {
  local candidate="$RELEASE_DIR/.env.production"
  if [ ! -f "$candidate" ]; then
    echo "Missing candidate environment file in $RELEASE_DIR" >&2
    return 1
  fi

  rm -f -- "$SHARED_ENV_BACKUP" "$SHARED_ENV_TEMP"
  cp -p "$SHARED_DIR/.env.production" "$SHARED_ENV_BACKUP"
  chmod 600 "$SHARED_ENV_BACKUP"
  cp -p "$candidate" "$SHARED_ENV_TEMP"
  chmod 600 "$SHARED_ENV_TEMP"
  mv -f "$SHARED_ENV_TEMP" "$SHARED_DIR/.env.production"
  SHARED_ENV_SWITCHED=1
}

restore_shared_environment() {
  if [ "$SHARED_ENV_SWITCHED" -eq 0 ]; then
    return 0
  fi
  if [ ! -f "$SHARED_ENV_BACKUP" ]; then
    echo "Previous shared environment backup is missing; refusing to continue rollback." >&2
    return 1
  fi
  cp -p "$SHARED_ENV_BACKUP" "$SHARED_ENV_TEMP"
  chmod 600 "$SHARED_ENV_TEMP"
  mv -f "$SHARED_ENV_TEMP" "$SHARED_DIR/.env.production"
  rm -f -- "$SHARED_ENV_BACKUP"
  SHARED_ENV_SWITCHED=0
}

restore_pm2_snapshot() {
  local snapshot="$1"
  local expected_dir="$2"
  local restored_count
  local expected_web_instances
  local expected_worker_instances
  restored_count="$(node -e 'const value=require(process.argv[1]); process.stdout.write(String(Array.isArray(value.apps) ? value.apps.length : 0))' "$snapshot")"
  expected_web_instances="$(node -e 'const value=require(process.argv[1]); const app=value.apps?.find((entry)=>entry.name===process.argv[2]); process.stdout.write(String(app?.instances || 0))' "$snapshot" "$APP_NAME")"
  expected_worker_instances="$(node -e 'const value=require(process.argv[1]); const app=value.apps?.find((entry)=>entry.name===process.argv[2]); process.stdout.write(String(app?.instances || 0))' "$snapshot" "${APP_NAME}-worker")"

  if [ "$restored_count" -gt 0 ]; then
    NODE_ENV=production pm2 startOrReload "$snapshot" --update-env || return $?
  fi

  for proc in "$APP_NAME" "${APP_NAME}-worker"; do
    if ! node -e 'const value=require(process.argv[1]); process.exit(value.apps?.some((app)=>app.name===process.argv[2]) ? 0 : 1)' "$snapshot" "$proc"; then
      if pm2 describe "$proc" >/dev/null 2>&1; then
        pm2 delete "$proc" || return $?
      fi
    fi
  done

  node "$RELEASE_DIR/scripts/verify-pm2-contract.cjs" \
    "$APP_NAME" \
    "$expected_dir" \
    "$expected_web_instances" \
    "$expected_worker_instances"
}

release_matches_runtime_contract() {
  local candidate_dir="$1"
  node - "$RELEASE_DIR/runtime-contract.json" "$candidate_dir/runtime-contract.json" <<'NODE'
const { readFileSync } = require("node:fs");

try {
  const expected = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const candidate = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const valid =
    expected?.schemaVersion === 1
    && candidate?.schemaVersion === 1
    && typeof expected.contractVersion === "string"
    && /^[a-f0-9]{64}$/.test(expected.contractHash || "")
    && candidate.contractVersion === expected.contractVersion
    && candidate.contractHash === expected.contractHash;
  process.exit(valid ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

healthcheck_app() {
  local port="${PORT:-}"
  if [ -z "$port" ] && [ -f "$BASE_DIR/current/.env.production" ]; then
    port="$(
      awk -F= '
        /^PORT=/ {
          value=$0
          sub(/^PORT=/, "", value)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
          gsub(/^["'\'']|["'\'']$/, "", value)
          print value
        }
      ' "$BASE_DIR/current/.env.production" | tail -n 1
    )"
  fi
  port="${port:-3000}"
  local url="http://127.0.0.1:${port}/"

  for _ in $(seq 1 30); do
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS -o /dev/null "$url"; then
        return 0
      fi
    else
      if node -e "fetch(process.argv[1]).then((r)=>process.exit(r.ok||r.status<500?0:1)).catch(()=>process.exit(1))" "$url"; then
        return 0
      fi
    fi
    sleep 2
  done

  return 1
}

rollback_previous_release() {
  ROLLBACK_IN_PROGRESS=1
  local rollback_status=0
  set +e
  restore_shared_environment || rollback_status=$?
  if [ -n "$PREVIOUS_TARGET" ] && [ -d "$PREVIOUS_TARGET" ]; then
    if ! release_matches_runtime_contract "$PREVIOUS_TARGET"; then
      echo "Automatic rollback blocked: the previous release does not declare the exact active database runtime contract." >&2
      echo "Stopping the incompatible application processes; roll forward, or restore the database and application together from backup." >&2
      for proc in "${APP_NAME}-worker" "$APP_NAME"; do
        if pm2 describe "$proc" >/dev/null 2>&1; then
          pm2 stop "$proc" >/dev/null 2>&1 || true
        fi
      done
      pm2 save >/dev/null 2>&1 || true
      set -e
      ROLLBACK_IN_PROGRESS=0
      return 1
    fi
    echo "Rolling back to previous release: $PREVIOUS_TARGET" >&2
    ln -sfn "$PREVIOUS_TARGET" "$BASE_DIR/current" || rollback_status=$?
    # The snapshot is authoritative because it preserves the exact instance
    # count and execution mode that were healthy before this release. An old
    # ecosystem is only a fallback if snapshot restoration itself fails.
    if [ "$rollback_status" -eq 0 ] && [ -f "$PM2_ROLLBACK_CONFIG" ]; then
      restore_pm2_snapshot "$PM2_ROLLBACK_CONFIG" "$PREVIOUS_TARGET" || rollback_status=$?
      if [ "$rollback_status" -ne 0 ] && [ -f "$BASE_DIR/current/ecosystem.production.cjs" ]; then
        rollback_status=0
        start_app "$BASE_DIR/current" || rollback_status=$?
        if [ "$rollback_status" -eq 0 ]; then
          verify_pm2_process_contract "$PREVIOUS_TARGET" || rollback_status=$?
        fi
      fi
    elif [ "$rollback_status" -eq 0 ] && [ -f "$BASE_DIR/current/ecosystem.production.cjs" ]; then
      start_app "$BASE_DIR/current" || rollback_status=$?
      if [ "$rollback_status" -eq 0 ]; then
        verify_pm2_process_contract "$PREVIOUS_TARGET" || rollback_status=$?
      fi
    elif [ "$rollback_status" -ne 0 ]; then
      :
    else
      echo "No PM2 rollback process configuration is available." >&2
      rollback_status=1
    fi
    if [ "$rollback_status" -eq 0 ]; then
      healthcheck_app || rollback_status=$?
    fi
    if [ "$rollback_status" -eq 0 ]; then
      pm2 save || rollback_status=$?
    fi
  else
    echo "No previous release found for rollback." >&2
    rollback_status=1
  fi
  if [ "$rollback_status" -ne 0 ]; then
    echo "Rollback could not establish a contract-compatible healthy release; stopping managed application processes." >&2
    for proc in "${APP_NAME}-worker" "$APP_NAME"; do
      if pm2 describe "$proc" >/dev/null 2>&1; then
        pm2 stop "$proc" >/dev/null 2>&1 || true
      fi
    done
    pm2 save >/dev/null 2>&1 || true
  fi
  set -e
  ROLLBACK_IN_PROGRESS=0
  return "$rollback_status"
}

handle_deploy_error() {
  local status="$1"
  local line="$2"
  trap - ERR
  if [ "$CUTOVER_STARTED" -eq 1 ] && [ "$ROLLBACK_IN_PROGRESS" -eq 0 ]; then
    echo "Deployment failed after traffic cutover at line $line; restoring previous release and PM2 configuration." >&2
    rollback_previous_release || echo "Automatic rollback failed; manual intervention is required." >&2
  fi
  rm -f -- "$PM2_ROLLBACK_CONFIG" "$SHARED_ENV_BACKUP" "$SHARED_ENV_TEMP"
  exit "$status"
}

trap 'handle_deploy_error $? $LINENO' ERR

handle_deploy_signal() {
  local signal="$1"
  local status="$2"
  trap - ERR INT TERM HUP
  echo "Deployment interrupted by $signal." >&2
  if [ "$CUTOVER_STARTED" -eq 1 ] && [ "$ROLLBACK_IN_PROGRESS" -eq 0 ]; then
    rollback_previous_release || echo "Automatic rollback failed; manual intervention is required." >&2
  fi
  rm -f -- "$PM2_ROLLBACK_CONFIG" "$SHARED_ENV_BACKUP" "$SHARED_ENV_TEMP"
  exit "$status"
}

trap 'handle_deploy_signal SIGINT 130' INT
trap 'handle_deploy_signal SIGTERM 143' TERM
trap 'handle_deploy_signal SIGHUP 129' HUP

cleanup_legacy_root_lockfiles() {
  for lockfile in package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml; do
    if [ -f "$BASE_DIR/$lockfile" ]; then
      echo "Removing legacy root lockfile: $BASE_DIR/$lockfile"
      rm -f -- "$BASE_DIR/$lockfile"
    fi
  done
}

configure_build_environment() {
  export npm_config_audit=false
  export npm_config_fund=false
  export npm_config_update_notifier=false
  export npm_config_progress=false
  export NEXT_TELEMETRY_DISABLED=1

  if [[ "${NODE_OPTIONS:-}" != *"--max-old-space-size"* ]]; then
    if [ -n "${NODE_OPTIONS:-}" ]; then
      export NODE_OPTIONS="$NODE_OPTIONS --max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE:-1536}"
    else
      export NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE:-1536}"
    fi
  fi
}

# 应用 engines 要求 node >=22 <23。EC2 曾运行 node 23 导致
# `controller[kState].transformAlgorithm is not a function` 运行时崩溃。
# 注意：nvm 会把 `node` 变成 shell 函数（返回 default alias 的版本），
# 判断与取路径必须用 `command -v node` 拿真实二进制，否则会被 shim 欺骗。
ensure_node_version() {
  local required_major="${NODE_REQUIRED_MAJOR:-22}"
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "ERROR: nvm not found at $NVM_DIR" >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  \. "$NVM_DIR/nvm.sh"

  local node_bin current_major
  node_bin="$(command -v node)"
  current_major="$("$node_bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"

  if [ "$current_major" != "$required_major" ]; then
    echo "Node ${current_major}.x detected at $node_bin; project requires node ${required_major}.x - switching via nvm..."
    nvm install "$required_major"
    nvm use "$required_major" || { echo "ERROR: nvm use $required_major failed" >&2; exit 1; }
    nvm alias default "$required_major" >/dev/null
  fi

  # 切换后重新解析真实二进制并校验主版本，失败直接退出而不是带病部署
  node_bin="$(command -v node)"
  current_major="$("$node_bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$current_major" != "$required_major" ]; then
    echo "ERROR: expected node ${required_major}.x but got ${current_major}.x at $node_bin" >&2
    exit 1
  fi
  echo "Node ${current_major}.x OK (engines: >=22 <23) at $node_bin"
}

ensure_build_swap() {
  local mem_total_mb="0"
  local swap_total_mb="0"
  mem_total_mb="$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || printf '0')"
  swap_total_mb="$(awk '/SwapTotal/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || printf '0')"

  local target_swap_mb="${BUILD_TARGET_SWAP_MB:-4096}"

  echo "Build memory: ${mem_total_mb:-0} MB RAM, ${swap_total_mb:-0} MB swap (target ${target_swap_mb} MB)"

  # Always top up the build swapfile on RAM-constrained hosts, even if some
  # swap is already present. The pre-existing 2 GB swapfile left over from an
  # earlier deploy is no longer enough for the Next.js 15 webpack optimize
  # phase on this app, so the script must grow it instead of bailing out.
  if [ "${mem_total_mb:-0}" -ge 3500 ]; then
    return 0
  fi

  if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
    echo "Low memory detected, but passwordless sudo is unavailable; continuing without build swap." >&2
    return 0
  fi

  local swapfile="$SHARED_DIR/build.swap"
  local swap_active=""
  swap_active="$(swapon --show=NAME 2>/dev/null | grep -Fx "$swapfile" || true)"
  local swap_size_mb=0
  if [ -f "$swapfile" ]; then
    swap_size_mb="$(($(stat -c %s "$swapfile" 2>/dev/null || echo 0) / 1024 / 1024))"
  fi

  # If the existing build swapfile is already active and at least the target
  # size, nothing to do.
  if [ -n "$swap_active" ] && [ "$swap_size_mb" -ge "$target_swap_mb" ]; then
    echo "Build swap already enabled at $swapfile (${swap_size_mb} MB)"
    return 0
  fi

  # Otherwise tear down any undersized active swap and remove the file so we
  # can recreate it at the target size.
  if [ -n "$swap_active" ]; then
    echo "Existing build swap is ${swap_size_mb} MB (< target ${target_swap_mb} MB); upgrading"
    sudo swapoff "$swapfile" 2>/dev/null || true
  fi
  if [ -f "$swapfile" ] && [ "$swap_size_mb" -lt "$target_swap_mb" ]; then
    sudo rm -f "$swapfile"
    swap_size_mb=0
  fi

  if ! swapon --show=NAME 2>/dev/null | grep -qx "$swapfile"; then
    if [ ! -f "$swapfile" ]; then
      echo "Creating ${target_swap_mb} MB temporary build swap at $swapfile"
      sudo fallocate -l "${target_swap_mb}M" "$swapfile" 2>/dev/null || sudo dd if=/dev/zero of="$swapfile" bs=1M count=$((target_swap_mb)) status=none
      sudo chmod 600 "$swapfile"
      sudo mkswap "$swapfile" >/dev/null
    fi

    echo "Enabling temporary build swap"
    if ! sudo swapon "$swapfile" 2>/dev/null; then
      echo "Existing build swap could not be enabled; recreating it." >&2
      sudo rm -f "$swapfile"
      sudo fallocate -l "${target_swap_mb}M" "$swapfile" 2>/dev/null || sudo dd if=/dev/zero of="$swapfile" bs=1M count=$((target_swap_mb)) status=none
      sudo chmod 600 "$swapfile"
      sudo mkswap "$swapfile" >/dev/null
      sudo swapon "$swapfile" 2>/dev/null || echo "Unable to enable build swap; continuing without it." >&2
    fi
  fi
}

dependency_cache_key() {
  if command -v sha256sum >/dev/null 2>&1; then
    { sha256sum package.json; sha256sum package-lock.json; } | sha256sum | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    { shasum -a 256 package.json; shasum -a 256 package-lock.json; } | shasum -a 256 | awk '{ print $1 }'
  else
    node - <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const hash = crypto.createHash("sha256");
for (const file of ["package.json", "package-lock.json"]) {
  hash.update(fs.readFileSync(file));
}
process.stdout.write(hash.digest("hex"));
NODE
  fi
}

dependency_cache_key_for_dir() {
  local target_dir="$1"

  if [ ! -f "$target_dir/package.json" ] || [ ! -f "$target_dir/package-lock.json" ]; then
    return 1
  fi

  (
    cd "$target_dir"
    dependency_cache_key
  )
}

install_dependencies_into_cache() {
  local cache_dir="$1"

  echo "Installing dependencies for cache: $(basename "$cache_dir")"
  rm -rf -- node_modules "$cache_dir/node_modules"
  npm ci --prefer-offline --no-audit --no-fund
  mkdir -p "$cache_dir"
  mv node_modules "$cache_dir/node_modules"
  ln -sfn "$cache_dir/node_modules" node_modules
}

use_dependency_cache_if_valid() {
  local cache_dir="$1"

  if [ ! -d "$cache_dir/node_modules" ]; then
    return 1
  fi

  rm -rf -- node_modules
  ln -sfn "$cache_dir/node_modules" node_modules

  if npm ls --omit=dev --depth=0 >/dev/null 2>&1; then
    touch "$cache_dir"
    return 0
  fi

  echo "Dependency cache is incomplete; rebuilding: $(basename "$cache_dir")" >&2
  rm -rf -- node_modules "$cache_dir/node_modules"
  return 1
}

install_dependencies() {
  if [ ! -f package-lock.json ]; then
    echo "package-lock.json is missing; falling back to npm install." >&2
    npm install --prefer-offline --no-audit --no-fund
    return 0
  fi

  local cache_root="$SHARED_DIR/node_modules-cache"
  local cache_key
  local cache_dir
  cache_key="$(dependency_cache_key)"
  cache_dir="$cache_root/$cache_key"
  mkdir -p "$cache_root"

  if [ -n "$PREVIOUS_TARGET" ] &&
    [ -d "$PREVIOUS_TARGET/node_modules" ] &&
    previous_cache_key="$(dependency_cache_key_for_dir "$PREVIOUS_TARGET" 2>/dev/null)" &&
    [ "$previous_cache_key" = "$cache_key" ]; then
    echo "Seeding dependency cache from current release: $cache_key"
    mkdir -p "$cache_dir"
    if [ ! -d "$cache_dir/node_modules" ]; then
      cp -al "$PREVIOUS_TARGET/node_modules" "$cache_dir/node_modules" 2>/dev/null ||
        cp -a "$PREVIOUS_TARGET/node_modules" "$cache_dir/node_modules"
    fi
    if ! use_dependency_cache_if_valid "$cache_dir"; then
      install_dependencies_into_cache "$cache_dir"
    fi
    return 0
  fi

  if [ -d "$cache_dir/node_modules" ]; then
    echo "Reusing dependency cache: $cache_key"
    if ! use_dependency_cache_if_valid "$cache_dir"; then
      install_dependencies_into_cache "$cache_dir"
    fi
    return 0
  fi

  install_dependencies_into_cache "$cache_dir"
}

verify_production_redis() {
  # Run this only after installing dependencies so the exact ioredis version in
  # the release performs the check. Errors are deliberately generic: connection
  # failures can contain the credential-bearing endpoint in their message.
  node --env-file=.env.production - <<'NODE'
const Redis = require("ioredis");

const client = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  commandTimeout: 5_000,
  retryStrategy: () => null,
});
// ioredis error events can include the endpoint. The deployment gate reports a
// generic failure below instead of allowing the client to print it implicitly.
client.on("error", () => {});

(async () => {
  try {
    await client.connect();
    if (await client.ping() !== "PONG") throw new Error("unexpected PING response");

    const result = await client.config("GET", "maxmemory-policy");
    const policy = Array.isArray(result) ? String(result[result.length - 1] || "").toLowerCase() : "";
    if (policy !== "noeviction") throw new Error("unsafe maxmemory policy");

    console.log("Redis BullMQ preflight passed (PING, maxmemory-policy=noeviction).");
  } catch {
    console.error("Redis BullMQ preflight failed: require connectivity and maxmemory-policy=noeviction.");
    process.exitCode = 1;
  } finally {
    client.disconnect();
  }
})();
NODE
}

# Refuse to switch traffic to a release whose database is missing the durable
# generation/OSS/media data-plane RPCs. These migrations must be applied in the
# planned maintenance window. Without the full contract, some API or Worker
# paths would accept traffic and then strand durable jobs; fail closed instead.
verify_production_migration() {
  node --env-file=.env.production - <<'NODE'
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim().replace(/\\/+$/, "");
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const { readFileSync } = require("node:fs");
let runtimeContract;
try {
  runtimeContract = JSON.parse(readFileSync("runtime-contract.json", "utf8"));
} catch {
  console.error("Migration gate: runtime-contract.json is missing or invalid.");
  process.exit(1);
}
const expectedContractVersion = runtimeContract?.contractVersion;
const expectedContractHash = runtimeContract?.contractHash;
if (
  runtimeContract?.schemaVersion !== 1
  || typeof expectedContractVersion !== "string"
  || !/^[a-f0-9]{64}$/.test(expectedContractHash || "")
) {
  console.error("Migration gate: release runtime contract manifest is invalid.");
  process.exit(1);
}
const required = [
  "get_runtime_contract_version",
  "is_generation_outbox_realtime_ready",
  "create_generation_with_credit_debit_v2",
  "get_generation_service_entitlement",
  "settle_generation_for_tenant_capacity",
  "recover_stale_generation_capacity_waits",
  "claim_generation_outbox",
  "confirm_generation_outbox",
  "nack_generation_outbox",
  "recover_generation_outbox",
  "redrive_generation_outbox",
  "get_generation_queue_health",
  "publish_ai_control_plane_config",
  "record_ai_provider_outcome",
  "admin_ai_provider_metrics",
  "publish_worker_runtime_config",
  "get_admin_dashboard_period",
  "get_admin_billing_summary",
  "claim_generation_job",
  "create_creative_run",
  "attach_generation_to_creative_run",
  "checkpoint_generation_execution",
  "mark_generation_needs_review",
  "heartbeat_generation_job",
  "defer_generation_for_ai_capacity",
  "settle_generation_for_ai_capacity",
  "settle_generation_for_retryable_error",
  "admin_retry_generation",
  "admin_settle_generation",
  "fail_generation_with_credit_refund",
  "complete_generation_with_credit_adjustment",
  "register_oss_mirror_transfer",
  "claim_oss_mirror_transfers",
  "heartbeat_oss_mirror_transfer",
  "complete_oss_mirror_transfer",
  "defer_oss_mirror_transfer",
  "expire_oss_mirror_transfers",
  "cleanup_oss_mirror_transfers",
  "record_oss_mirror_resolution",
  "get_oss_mirror_queue_health",
  "recover_oss_mirror_transfers",
  "create_media_asset_upload",
  "complete_media_asset_upload",
  "fail_media_asset_upload",
  "verify_media_asset",
  "resolve_media_asset_object",
  "resolve_verified_media_asset_for_worker",
  "get_media_asset_status",
  "claim_media_validation_jobs",
  "heartbeat_media_validation_job",
  "complete_media_validation_job",
  "defer_media_validation_job",
  "recover_media_validation_jobs",
  "get_media_validation_queue_health",
  "claim_media_asset_cleanup",
  "authorize_media_asset_cleanup",
  "confirm_media_asset_cleanup",
  "nack_media_asset_cleanup",
  "get_media_asset_lifecycle_health",
];
const requiredTables = [
  "creative_agent_skills",
  "creative_agent_skill_versions",
  "creative_canvas_projects",
  "creative_runs",
  "creative_run_steps",
  "creative_user_skills",
  "resource_library_assets",
  "user_prompts",
];
if (!url || !serviceKey) {
  console.error("Migration gate: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.production.");
  process.exit(1);
}

(async () => {
  let response;
  try {
    response = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        accept: "application/openapi+json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error("Migration gate: Supabase Data API is unreachable.");
    process.exit(1);
  }
  if (!response.ok) {
    console.error("Migration gate: could not read the authenticated Data API schema.");
    process.exit(1);
  }
  const schema = await response.json();
  const paths = schema && typeof schema.paths === "object" ? schema.paths : {};
  const missing = required.filter((name) => !Object.prototype.hasOwnProperty.call(paths, `/rpc/${name}`));
  const missingTables = requiredTables.filter((name) => !Object.prototype.hasOwnProperty.call(paths, `/${name}`));
  if (missing.length > 0) {
    console.error(`Migration gate: missing RPCs (${missing.join(", ")}). Apply the corresponding migration first.`);
    process.exit(1);
  }
  if (missingTables.length > 0) {
    console.error(`Migration gate: missing tables (${missingTables.join(", ")}). Apply the corresponding migration first.`);
    process.exit(1);
  }

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
    console.error("Migration gate: runtime contract RPC is unreachable.");
    process.exit(1);
  }
  if (!contractResponse.ok) {
    console.error("Migration gate: runtime contract RPC rejected the service-role check.");
    process.exit(1);
  }
  const contractPayload = await contractResponse.json();
  const contract = Array.isArray(contractPayload) ? contractPayload[0] : contractPayload;
  if (
    contract?.contract_version !== expectedContractVersion
    || contract?.contract_hash !== expectedContractHash
  ) {
    console.error(
      `Migration gate: runtime contract mismatch (expected ${expectedContractVersion}/${expectedContractHash}).`,
    );
    process.exit(1);
  }

  let realtimeResponse;
  try {
    realtimeResponse = await fetch(`${url}/rest/v1/rpc/is_generation_outbox_realtime_ready`, {
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
  let realtimeReady = false;
  if (realtimeResponse.ok) {
    try {
      realtimeReady = await realtimeResponse.json() === true;
    } catch {
      realtimeReady = false;
    }
  }
  if (!realtimeReady) {
    console.error("Migration gate: generation outbox is missing from the Supabase Realtime publication.");
    process.exit(1);
  }
  console.log(`Migration gate: exact runtime contract ${expectedContractVersion} is present.`);
})();
NODE
}

cleanup_dependency_cache() {
  local cache_root="$SHARED_DIR/node_modules-cache"
  if [ ! -d "$cache_root" ]; then
    return 0
  fi

  mapfile -t OLD_CACHES < <(
    find "$cache_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
      sort -rn |
      awk 'NR > 4 { sub(/^[^ ]+ /, ""); print }'
  )

  for OLD_CACHE in "${OLD_CACHES[@]}"; do
    rm -rf -- "$OLD_CACHE"
  done
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed on the server." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed on the server." >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 is not installed. Install it with: npm install -g pm2" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR" "$SHARED_DIR"

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is required to serialize production deployments." >&2
  exit 1
fi
exec 9>"$SHARED_DIR/deploy.lock"
if ! flock -n 9; then
  echo "Another production deployment is already running for $BASE_DIR." >&2
  exit 1
fi

if [ ! -f "$SHARED_DIR/.env.production" ] && [ -f "$BASE_DIR/.env.production" ]; then
  cp "$BASE_DIR/.env.production" "$SHARED_DIR/.env.production"
fi

if [ ! -f "$SHARED_DIR/.env.production" ]; then
  echo "Missing $SHARED_DIR/.env.production" >&2
  echo "Create it once on the server before running tag deployments." >&2
  exit 1
fi

tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
cp -p "$SHARED_DIR/.env.production" "$RELEASE_DIR/.env.production"
chmod 600 "$RELEASE_DIR/.env.production"
cleanup_legacy_root_lockfiles

cd "$RELEASE_DIR"
configure_build_environment
ensure_node_version
ensure_build_swap
install_dependencies

# Admin stores a versioned desired capacity policy. Deployment is the only
# component allowed to apply it to the EC2 environment and PM2 process count.
node --env-file=.env.production scripts/apply-worker-runtime-config.mjs .env.production
PM2_WORKER_INSTANCES="$(node --env-file=.env.production -e 'process.stdout.write(process.env.PM2_WORKER_INSTANCES || "1")')"

# Manual and automated deploys share the same production fail-closed gate.
# Validate only structure and presence; never print the credential-bearing URL.
if ! node --env-file=.env.production - <<'NODE'
const mode = (process.env.GENERATION_QUEUE_MODE || "bullmq").trim().toLowerCase();
const capacityMode = (process.env.AI_ROUTER_CAPACITY_MODE || "").trim().toLowerCase();
if (mode !== "bullmq" || capacityMode !== "redis") process.exit(1);
try {
  const url = new URL(process.env.REDIS_URL || "");
  if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname) process.exit(1);
} catch {
  process.exit(1);
}
NODE
then
  echo "Production queue configuration invalid: require GENERATION_QUEUE_MODE=bullmq, AI_ROUTER_CAPACITY_MODE=redis, and a valid REDIS_URL" >&2
  exit 1
fi

# BullMQ cannot safely operate with an evicting Redis policy. Refuse the release
# before switching `current` if either the live connection or policy check fails.
verify_production_redis

# Refuse the release if the durable outbox RPCs for BullMQ / OSS mirror are
# missing on the target database. The migrations are destructive and must be
# applied manually, so the deploy gate only validates presence.
verify_production_migration

# Never switch traffic to a mirror-enabled release until the currently live
# resolver and the persistent Bucket Website rule pass an exact, read-only
# check. First-time rollout must therefore be staged with the flag disabled,
# then configured, then enabled in a later release.
OSS_REMOTE_TRANSFER_MODE="$(node --env-file-if-exists=.env.production -e 'process.stdout.write(process.env.ALIYUN_OSS_REMOTE_TRANSFER_MODE || "stream")')"
if [[ "${OSS_REMOTE_TRANSFER_MODE,,}" =~ ^(stream|mirror)$ ]]; then
  if ! npm run oss:configure-mirror -- --check; then
    echo "Pre-deploy OSS mirror configuration check failed for $APP_NAME from tag $TAG" >&2
    exit 1
  fi
fi

snapshot_pm2_process_config
CUTOVER_STARTED=1
stage_shared_environment
ln -sfn "$RELEASE_DIR" "$BASE_DIR/current"
start_app "$BASE_DIR/current"
verify_pm2_process_contract "$RELEASE_DIR"

if ! healthcheck_app; then
  echo "Healthcheck failed for $APP_NAME from tag $TAG" >&2
  pm2 logs "$APP_NAME" --lines 80 --nostream >&2 || true
  rollback_previous_release || echo "Automatic rollback failed; manual intervention is required." >&2
  CUTOVER_STARTED=0
  rm -f -- "$PM2_ROLLBACK_CONFIG"
  exit 1
fi

# Once cloud-pull is enabled, every release must prove the persistent Bucket
# rule still matches the deployed resolver. This is read-only and fails the
# release before it can serve generated results with a missing mirror rule.
if [[ "${OSS_REMOTE_TRANSFER_MODE,,}" =~ ^(stream|mirror)$ ]]; then
  if ! npm run oss:configure-mirror -- --check; then
    echo "OSS mirror configuration check failed for $APP_NAME from tag $TAG" >&2
    rollback_previous_release || echo "Automatic rollback failed; manual intervention is required." >&2
    CUTOVER_STARTED=0
    rm -f -- "$PM2_ROLLBACK_CONFIG"
    exit 1
  fi
fi

pm2 save
CUTOVER_STARTED=0
rm -f -- "$PM2_ROLLBACK_CONFIG" "$SHARED_ENV_BACKUP" "$SHARED_ENV_TEMP"
cleanup_dependency_cache

CURRENT_TARGET="$(readlink -f "$BASE_DIR/current" 2>/dev/null || true)"
mapfile -t OLD_RELEASES < <(
  find "$BASE_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' |
    sort -rn |
    awk 'NR > 5 { sub(/^[^ ]+ /, ""); print }'
)

for OLD_RELEASE in "${OLD_RELEASES[@]}"; do
  if [ "$OLD_RELEASE" = "$RELEASE_DIR" ] || [ "$OLD_RELEASE" = "$CURRENT_TARGET" ]; then
    continue
  fi
  rm -rf -- "$OLD_RELEASE"
done

if [ ! -d "$RELEASE_DIR" ]; then
  echo "Deployment release directory was removed unexpectedly: $RELEASE_DIR" >&2
  exit 1
fi

rm -f "$ARCHIVE"

echo "Deployed $APP_NAME from tag $TAG"
