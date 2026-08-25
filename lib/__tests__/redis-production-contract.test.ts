import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("standard Redis production contract", () => {
  it("has no legacy Redis REST dependency or configuration", () => {
    const files = [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      ".env.local.example",
      ".github/workflows/deploy-aws-on-tag.yml",
      "lib/ai-control-plane/capacity.server.ts",
    ];
    const removedVendorName = "up" + "stash";
    for (const file of files) {
      expect(read(file).toLowerCase(), file).not.toContain(removedVendorName);
    }
  });

  it("deploys production in BullMQ mode without printing the Redis URL", () => {
    const workflow = read(".github/workflows/deploy-aws-on-tag.yml");
    const deploy = read("scripts/deploy-aws-release.sh");
    expect(workflow).not.toContain("secrets.REDIS_URL");
    expect(deploy).toContain('mode !== "bullmq"');
    expect(deploy).toContain('capacityMode !== "redis"');
    expect(workflow).not.toMatch(/echo[^\n]*\$REDIS_URL/);
    expect(workflow).not.toContain("set -x");
  });

  it("pins the EC2 host key and serializes releases", () => {
    const workflow = read(".github/workflows/deploy-aws-on-tag.yml");
    const deploy = read("scripts/deploy-aws-release.sh");
    expect(workflow).toContain("AWS_SSH_KNOWN_HOSTS: ${{ secrets.AWS_SSH_KNOWN_HOSTS }}");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("StrictHostKeyChecking=accept-new");
    expect(workflow).not.toContain("ssh-keyscan");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('APP_DIR="${AWS_APP_DIR:-~/apps/wanxiangzy}"');
    expect(deploy).toContain('exec 9>"$SHARED_DIR/deploy.lock"');
    expect(deploy).toContain("flock -n 9");
  });

  it("gives BullMQ more than the 30-second application drain window", () => {
    const deploy = read("scripts/deploy-aws-release.sh");
    const ecosystem = read("ecosystem.production.cjs");
    const match = deploy.match(/^PM2_KILL_TIMEOUT_MS=(\d+)$/m);
    expect(match).toBeTruthy();
    expect(Number(match?.[1])).toBeGreaterThan(30_000);
    expect(deploy).toContain('PM2_KILL_TIMEOUT_MS="$PM2_KILL_TIMEOUT_MS"');
    expect(ecosystem).toContain("kill_timeout: killTimeoutMs");
  });

  it("blocks traffic switching until Redis responds and uses noeviction", () => {
    const deploy = read("scripts/deploy-aws-release.sh");
    const installIndex = deploy.indexOf("\ninstall_dependencies\n");
    const preflightIndex = deploy.indexOf("\nverify_production_redis\n", installIndex);
    const switchIndex = deploy.indexOf('ln -sfn "$RELEASE_DIR" "$BASE_DIR/current"');

    expect(installIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeGreaterThan(installIndex);
    expect(switchIndex).toBeGreaterThan(preflightIndex);
    expect(deploy).toContain('client.ping()');
    expect(deploy).toContain('client.config("GET", "maxmemory-policy")');
    expect(deploy).toContain('policy !== "noeviction"');
    expect(deploy).toContain('client.on("error", () => {})');
    expect(deploy).not.toMatch(/echo[^\n]*\$REDIS_URL/);
    expect(deploy).not.toMatch(/console\.(?:log|error)\([^\n]*process\.env\.REDIS_URL/);
  });

  it("requires the audited Outbox DLQ redrive RPC before switching traffic", () => {
    const deploy = read("scripts/deploy-aws-release.sh");
    const manifest = JSON.parse(read("runtime-contract.json"));
    for (const rpc of [
      "get_runtime_contract_version",
      "get_generation_service_entitlement",
      "redrive_generation_outbox",
      "claim_generation_job",
      "checkpoint_generation_execution",
      "mark_generation_needs_review",
      "settle_generation_for_ai_capacity",
      "settle_generation_for_retryable_error",
      "admin_retry_generation",
      "admin_settle_generation",
      "complete_generation_with_credit_adjustment",
      "complete_oss_mirror_transfer",
      "create_media_asset_upload",
      "claim_media_validation_jobs",
      "authorize_media_asset_cleanup",
    ]) {
      expect(deploy).toContain(`"${rpc}"`);
    }
    expect(deploy.indexOf('"redrive_generation_outbox"')).toBeLessThan(
      deploy.indexOf("const missing = required.filter"),
    );
    expect(manifest.contractVersion).toBe("2026-08-25.3");
    expect(manifest.contractHash).toBe("6305f1469f89046b063d1b87857a2ed43548f0b3c8480e697ce1e7e32b178dbd");
    expect(deploy).toContain('JSON.parse(readFileSync("runtime-contract.json", "utf8"))');
    expect(deploy).toContain("/rest/v1/rpc/get_runtime_contract_version");
    expect(deploy).toContain("contract?.contract_version !== expectedContractVersion");
    expect(deploy).toContain("contract?.contract_hash !== expectedContractHash");
  });

  it("always starts the production BullMQ worker", () => {
    const deploy = read("scripts/deploy-aws-release.sh");
    const ecosystem = read("ecosystem.production.cjs");
    expect(deploy).toContain('pm2 startOrReload "$app_dir/ecosystem.production.cjs" --update-env');
    expect(ecosystem).toContain('name: `${appName}-worker`');
    expect(ecosystem).toContain('script: resolve(releaseDir, "scripts/pm2-worker-entry.cjs")');
    expect(deploy).not.toContain("WORKER_ENABLED");
  });

  it("reports aggregate BullMQ outbox health without exposing the Redis endpoint", () => {
    const route = read("app/api/admin/model-control/route.ts");
    const component = read("components/admin/AdminModelControlPlane.tsx");

    expect(route).toContain('admin.rpc("get_generation_queue_health")');
    expect(route).toContain("pendingCount:");
    expect(route).toContain("publishingCount:");
    expect(route).toContain("deadCount:");
    expect(route).toContain("oldestPendingAgeSeconds:");
    expect(route).not.toMatch(/redisUrl\s*:/i);
    expect(component).toContain("BullMQ 与 Outbox 健康");
    expect(component).toContain("这里只展示配置状态和聚合计数");
  });
});
