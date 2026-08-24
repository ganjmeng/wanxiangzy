import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("AWS EC2 zero-downtime PM2 deployment contract", () => {
  it("runs Web as a readiness-gated cluster and parameterized Worker replicas", () => {
    const ecosystem = read("ecosystem.production.cjs");

    expect(ecosystem).toContain('const webInstances = boundedInteger("PM2_WEB_INSTANCES", 2, 1, 32)');
    expect(ecosystem).toContain('const workerInstances = boundedInteger("PM2_WORKER_INSTANCES", 1, 1, 32)');
    expect(ecosystem).toContain('exec_mode: "cluster"');
    expect(ecosystem).toContain("instances: webInstances");
    expect(ecosystem).toContain('exec_mode: "fork"');
    expect(ecosystem).toContain("instances: workerInstances");
    expect(ecosystem).toContain("wait_ready: true");
    expect(ecosystem).toContain("kill_timeout: killTimeoutMs");
    expect(ecosystem).toContain('boundedInteger("PM2_KILL_TIMEOUT_MS", 65_000, 56_000, 120_000)');
    expect(ecosystem).toContain('NODE_ENV: "production"');
  });

  it("signals readiness only after Web listen and Worker supervisor initialization", () => {
    const web = read("scripts/pm2-web-server.cjs");
    const worker = read("scripts/pm2-worker-entry.cjs");

    expect(web.indexOf("server.listen(")).toBeLessThan(web.indexOf('process.send("ready")'));
    expect(web).toContain('process.once("SIGTERM"');
    expect(web).toContain("server.closeIdleConnections?.()");
    expect(web).toContain("server.close(resolveClose)");
    expect(web).toContain("30_000");

    expect(worker).toContain('event?.event === "supervisor.ready"');
    expect(worker).toMatch(/if \(!ready && isSupervisorReady\(line\)\) \{[\s\S]*process\.send\("ready"\)/);
    expect(worker).toContain('child.kill(signal)');
    expect(worker).toContain("55_000");
  });

  it("uses rolling startOrReload and validates the complete new process set", () => {
    const deploy = read("scripts/deploy-aws-release.sh");
    const startFunction = deploy.slice(deploy.indexOf("start_app()"), deploy.indexOf("\n}\n\nverify_pm2_process_contract()") + 2);

    expect(startFunction).toContain('pm2 startOrReload "$app_dir/ecosystem.production.cjs" --update-env');
    expect(startFunction).not.toContain('pm2 delete "$proc"');
    expect(deploy).toContain('verify_pm2_process_contract "$RELEASE_DIR"');
    expect(deploy).toContain("scripts/apply-worker-runtime-config.mjs");
    expect(deploy).toContain('PM2_WORKER_INSTANCES="$PM2_WORKER_INSTANCES"');
    expect(deploy.indexOf('start_app "$BASE_DIR/current"')).toBeLessThan(
      deploy.lastIndexOf('verify_pm2_process_contract "$RELEASE_DIR"'),
    );

    const verifier = read("scripts/verify-pm2-contract.cjs");
    expect(verifier).toContain("web.length < 2");
    expect(verifier).toContain('exec_mode === "cluster_mode"');
    expect(verifier).toContain("worker.length !== expectedWorkerInstances");
    expect(verifier).toContain('exec_mode === "fork_mode"');
    expect(verifier).toContain('status === "online"');
  });

  it("captures the old PM2 configuration before cutover and restores it on failure", () => {
    const deploy = read("scripts/deploy-aws-release.sh");
    const snapshotIndex = deploy.lastIndexOf("\nsnapshot_pm2_process_config\n");
    const switchIndex = deploy.lastIndexOf('\nln -sfn "$RELEASE_DIR" "$BASE_DIR/current"');

    expect(snapshotIndex).toBeGreaterThan(-1);
    expect(snapshotIndex).toBeLessThan(switchIndex);
    expect(deploy).toContain("trap 'handle_deploy_error $? $LINENO' ERR");
    expect(deploy).toContain("trap 'handle_deploy_signal SIGTERM 143' TERM");
    expect(deploy).toContain('ln -sfn "$PREVIOUS_TARGET" "$BASE_DIR/current"');
    expect(deploy).toContain('restore_pm2_snapshot "$PM2_ROLLBACK_CONFIG" "$PREVIOUS_TARGET"');
    expect(deploy.indexOf('restore_pm2_snapshot "$PM2_ROLLBACK_CONFIG"')).toBeLessThan(
      deploy.indexOf('start_app "$BASE_DIR/current" || rollback_status=$?'),
    );
    expect(deploy).toContain('pm2 startOrReload "$snapshot" --update-env');
    expect(deploy).toContain('pm2 startOrReload "$snapshot" --update-env || return $?');
    expect(deploy).toContain('verify_pm2_process_contract "$PREVIOUS_TARGET"');
    expect(deploy).toContain('ln -sfn "$PREVIOUS_TARGET" "$BASE_DIR/current" || rollback_status=$?');
    expect(deploy).toContain("healthcheck_app || rollback_status=$?");
    expect(deploy).toContain("pm2 save || rollback_status=$?");

    const stageIndex = deploy.indexOf("\nstage_shared_environment\n");
    expect(stageIndex).toBeGreaterThan(snapshotIndex);
    expect(stageIndex).toBeLessThan(switchIndex);
    expect(deploy).toContain('cp -p "$SHARED_DIR/.env.production" "$RELEASE_DIR/.env.production"');
    expect(deploy).toContain("restore_shared_environment || rollback_status=$?");
    expect(deploy).toContain('SHARED_ENV_SWITCHED=1');
    expect(deploy).toContain('mv -f "$SHARED_ENV_TEMP" "$SHARED_DIR/.env.production"');
    expect(deploy).toContain('rm -f -- "$PM2_ROLLBACK_CONFIG" "$SHARED_ENV_BACKUP" "$SHARED_ENV_TEMP"');

    const snapshot = read("scripts/snapshot-pm2-config.cjs");
    expect(snapshot).toContain('safeRuntimeEnvironmentKeys = ["NODE_ENV", "PORT", "HOST", "TZ"]');
    expect(snapshot).not.toContain("env: pm2.env");
    expect(snapshot).toContain("instances: group.length");
    expect(snapshot).toContain("mode: 0o600");
  });

  it("never rolls a destructive database contract back to incompatible application code", () => {
    const deploy = read("scripts/deploy-aws-release.sh");
    const manifest = JSON.parse(read("runtime-contract.json"));

    expect(manifest).toEqual({
      schemaVersion: 1,
      contractVersion: "2026-08-25.2",
      contractHash: "9f9bc9c13f693c7297cc81e9a946a8c89d9e52dfef2c890c46604ce99f02946c",
    });
    expect(deploy).toContain("release_matches_runtime_contract()");
    expect(deploy).toContain('if ! release_matches_runtime_contract "$PREVIOUS_TARGET"; then');
    expect(deploy).toContain("Automatic rollback blocked:");
    expect(deploy).toContain('for proc in "${APP_NAME}-worker" "$APP_NAME"; do');
    expect(deploy).toContain('pm2 stop "$proc"');
    expect(deploy.indexOf('if ! release_matches_runtime_contract "$PREVIOUS_TARGET"; then')).toBeLessThan(
      deploy.indexOf('ln -sfn "$PREVIOUS_TARGET" "$BASE_DIR/current"'),
    );
  });

  it("blocks release cutover until the complete Agent Skill schema is present", () => {
    const releaseDeploy = read("scripts/deploy-aws-release.sh");
    const localDeploy = read("scripts/deploy-from-local.sh");

    for (const table of [
      "creative_agent_skills",
      "creative_agent_skill_versions",
      "creative_user_skills",
    ]) {
      expect(releaseDeploy).toContain(`"${table}"`);
      expect(localDeploy).toContain(`"${table}"`);
    }
    expect(localDeploy).toContain("Apply the Agent Skill migrations first.");
  });
});
