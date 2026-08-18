/**
 * Long-running async worker that polls `claim_next_generation_jobs` from a
 * Postgres queue and runs each claimed job in-process.
 *
 * This process is managed by PM2 as `${APP_NAME}-worker` (see
 * `scripts/deploy-aws-release.sh`). It replaces the external cron that used
 * to hit `/api/jobs/process-generations` once per minute, and bypasses the
 * Vercel function `maxDuration = 300s` constraint that previously truncated
 * long video jobs.
 *
 * Architecture notes:
 *   - The Postgres queue uses `FOR UPDATE SKIP LOCKED` so multiple workers
 *     can run safely against the same database. To scale, just start a
 *     second PM2 process with `pm2 start npm --name ${APP_NAME}-worker-2
 *     -- run worker`.
 *   - The fire-and-forget `startGenerationJob` call from API routes still
 *     runs as the first-chance processing path. This worker is the
 *     reliable safety net for jobs whose first-chance process exited
 *     before the job completed.
 *   - Logs are emitted via `console.*` directly (NOT through `lib/logger.ts`,
 *     which gates `info`/`debug` on `NODE_ENV === "development"`). PM2
 *     captures stdout via `pm2 logs`.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runNextGenerationJobs } from "@/lib/api/generation-jobs";
import {
  cleanupOssMirrorTransfers,
  expireOssMirrorTransfers,
  isAliyunOssMirrorEnabled,
  processPendingOssMirrorTransfers,
} from "@/lib/api/oss-mirror-transfer";
import { getAdminClient } from "@/lib/supabase/admin";
import { parseWorkerConfig, type WorkerConfig } from "@/lib/worker/config";

type TickResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  exhaustedRefunded: number;
  durationMs: number;
  dryRun: boolean;
};

type TickClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

type LoopSignals = {
  isStopRequested: () => boolean;
};

type LoopStats = {
  batches: number;
  claimed: number;
  succeeded: number;
  failed: number;
  consecutiveErrors: number;
  consecutiveEmptyPolls: number;
  lastHourBatches: { batches: number; claimed: number; succeeded: number; failed: number; sinceMs: number };
  startedAtMs: number;
};

const require = createRequire(import.meta.url);
const isMainModule = (() => {
  try {
    return require.main === module;
  } catch {
    return false;
  }
})();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Create a real-time clock for production use. Tests can pass a fake clock
 * to drive the loop deterministically with `vi.useFakeTimers()`.
 */
export function createRealClock(): TickClock {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  };
}

/**
 * Run a single poll cycle. Pure-ish: takes an admin client, a config, and a
 * clock. Returns a result object on success; throws on RPC error. The loop
 * in `runLoop` is responsible for backoff, error escalation, and signal
 * handling.
 */
export async function tickOnce(
  supabase: ReturnType<typeof getAdminClient>,
  config: WorkerConfig,
  clock: TickClock,
): Promise<TickResult> {
  const startedAt = clock.now();
  if (config.dryRun) {
    return {
      claimed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      exhaustedRefunded: 0,
      durationMs: clock.now() - startedAt,
      dryRun: true,
    };
  }

  const result = await runNextGenerationJobs(config.batchSize, {
    staleAfterMinutes: config.staleMinutes,
    concurrency: config.concurrency,
  });

  const claimed = Array.isArray(result.results) ? result.results.length : 0;
  const succeeded = Array.isArray(result.results) ? result.results.filter((r) => r.ok).length : 0;
  const failed = claimed - succeeded;
  const exhaustedRefunded = Number(result.exhausted_refunded || 0);

  return {
    claimed,
    succeeded,
    failed,
    skipped: 0,
    exhaustedRefunded,
    durationMs: clock.now() - startedAt,
    dryRun: false,
  };
}

function emit(event: string, fields: Record<string, unknown> = {}) {
  if (process.env.WORKER_LOG_FORMAT === "json") {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
  } else {
    const parts = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    console.log(`[worker] ${event}${parts.length > 0 ? " " + parts.join(" ") : ""}`);
  }
}

function emitError(event: string, err: unknown, fields: Record<string, unknown> = {}) {
  const message = err instanceof Error ? err.message : String(err);
  if (process.env.WORKER_LOG_FORMAT === "json") {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event,
        error: message,
        ...fields,
      }),
    );
  } else {
    console.error(`[worker] ${event} error=${message}`, fields);
  }
}

function createSignalHook(): LoopSignals {
  let stopRequested = false;
  const handler = (signal: NodeJS.Signals) => {
    if (stopRequested) return;
    stopRequested = true;
    emit("signal.received", { signal });
  };
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
  return { isStopRequested: () => stopRequested };
}

async function runCleanup(supabase: ReturnType<typeof getAdminClient>) {
  try {
    await supabase.rpc("cleanup_rate_limit_buckets");
  } catch (err) {
    emitError("cleanup.rate_limit_buckets", err);
  }
}

/**
 * Independent high-throughput recovery loop. Mirror retries never wait for a
 * generation batch or the five-minute housekeeping interval, and multiple
 * EC2 worker processes safely share work through SKIP LOCKED leases.
 */
export async function runOssMirrorRecoveryLoop(
  supabase: ReturnType<typeof getAdminClient>,
  clock: TickClock = createRealClock(),
  signals: LoopSignals = createSignalHook(),
) {
  if (!isAliyunOssMirrorEnabled()) {
    emit("oss_mirror.loop.disabled");
    return;
  }

  const batchSize = parseBoundedEnv("ALIYUN_OSS_MIRROR_WORKER_BATCH_SIZE", 50, 1, 100);
  const pollIntervalMs = parseBoundedEnv("ALIYUN_OSS_MIRROR_WORKER_POLL_INTERVAL_MS", 1_000, 100, 30_000);
  const idleBackoffMaxMs = parseBoundedEnv("ALIYUN_OSS_MIRROR_WORKER_IDLE_BACKOFF_MAX_MS", 10_000, pollIntervalMs, 60_000);
  const maxConsecutiveErrors = parseBoundedEnv("ALIYUN_OSS_MIRROR_WORKER_MAX_ERRORS", 20, 3, 100);
  let emptyPolls = 0;
  let consecutiveErrors = 0;
  let errorBackoffMs = 1_000;
  let lastExpiryAt = 0;
  let lastRetentionAt = 0;
  let lastHeartbeatAt = 0;
  const totals = { claimed: 0, completed: 0, deferred: 0, failed: 0 };

  emit("oss_mirror.loop.started", { batchSize, pollIntervalMs, idleBackoffMaxMs });
  while (!signals.isStopRequested()) {
    try {
      const result = await processPendingOssMirrorTransfers(batchSize, supabase);
      totals.claimed += result.claimed;
      totals.completed += result.completed;
      totals.deferred += result.deferred;
      totals.failed += result.failed;
      consecutiveErrors = 0;
      errorBackoffMs = 1_000;
      if (result.claimed > 0) {
        emptyPolls = 0;
        emit("oss_mirror.batch.complete", {
          ...result,
          saturated: result.claimed === batchSize,
        });
      } else {
        emptyPolls += 1;
      }

      const now = clock.now();
      if (now - lastExpiryAt >= 60_000) {
        lastExpiryAt = now;
        const expired = await expireOssMirrorTransfers(500, supabase);
        if (expired > 0) emit("oss_mirror.expired", { count: expired });
      }
      if (now - lastRetentionAt >= HOUR_MS) {
        lastRetentionAt = now;
        const cleaned = await cleanupOssMirrorTransfers(supabase);
        if (cleaned.metadataDeleted > 0 || cleaned.failedObjectsDeleted > 0) {
          emit("oss_mirror.retention", cleaned);
        }
      }
      if (now - lastHeartbeatAt >= 60_000) {
        lastHeartbeatAt = now;
        emit("oss_mirror.heartbeat", {
          ...totals,
          consecutiveErrors,
          consecutiveEmptyPolls: emptyPolls,
          rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        });
      }

      if (result.claimed === 0) {
        await sleepWithStop(
          clock,
          computeIdleSleepMs(emptyPolls, pollIntervalMs, idleBackoffMaxMs),
          signals,
        );
      }
    } catch (error) {
      consecutiveErrors += 1;
      emitError("oss_mirror.batch.error", error, { consecutiveErrors, maxConsecutiveErrors });
      if (consecutiveErrors >= maxConsecutiveErrors) throw error;
      await sleepWithStop(clock, errorBackoffMs, signals);
      errorBackoffMs = Math.min(errorBackoffMs * 2, 30_000);
    }
  }
  emit("oss_mirror.loop.stopped");
}

/**
 * Main poll loop. Returns when the signal hook reports stop and the current
 * batch (if any) has finished. Exits the process when the consecutive-error
 * threshold is crossed so PM2 can restart with backoff.
 */
export async function runLoop(
  supabase: ReturnType<typeof getAdminClient>,
  config: WorkerConfig,
  clock: TickClock = createRealClock(),
  signals: LoopSignals = createSignalHook(),
): Promise<void> {
  const stats: LoopStats = {
    batches: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    consecutiveErrors: 0,
    consecutiveEmptyPolls: 0,
    lastHourBatches: { batches: 0, claimed: 0, succeeded: 0, failed: 0, sinceMs: clock.now() },
    startedAtMs: clock.now(),
  };

  let lastCleanupAt = 0;
  let lastHeartbeatAt = 0;
  let backoffMs = config.errorBackoffMs;

  emit("loop.started", {
    batchSize: config.batchSize,
    concurrency: config.concurrency,
    pollIntervalMs: config.pollIntervalMs,
    idleBackoffMaxMs: config.idleBackoffMaxMs,
    staleMinutes: config.staleMinutes,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    maxInFlightTimeoutMs: config.maxInFlightTimeoutMs,
    dryRun: config.dryRun,
  });

  while (!signals.isStopRequested()) {
    const tickStart = clock.now();

    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const watchdogPromise = new Promise<never>((_, reject) => {
      watchdog = setTimeout(
        () => reject(new Error(`batch watchdog fired after ${config.maxInFlightTimeoutMs}ms`)),
        config.maxInFlightTimeoutMs,
      );
    });

    try {
      const result = await Promise.race([tickOnce(supabase, config, clock), watchdogPromise]);
      if (watchdog) clearTimeout(watchdog);
      stats.batches += 1;
      stats.claimed += result.claimed;
      stats.succeeded += result.succeeded;
      stats.failed += result.failed;
      stats.lastHourBatches.batches += 1;
      stats.lastHourBatches.claimed += result.claimed;
      stats.lastHourBatches.succeeded += result.succeeded;
      stats.lastHourBatches.failed += result.failed;
      stats.consecutiveErrors = 0;
      backoffMs = config.errorBackoffMs;

      emit("batch.complete", {
        claimed: result.claimed,
        succeeded: result.succeeded,
        failed: result.failed,
        exhaustedRefunded: result.exhaustedRefunded,
        durationMs: result.durationMs,
        dryRun: result.dryRun,
      });

      // Adaptive polling: when the queue is empty, double the sleep up to
      // `idleBackoffMaxMs` so we don't burn RPC quota hammering an idle DB.
      // Any non-empty tick resets the counter and tight-loops to drain
      // backlog. This brings idle RPC volume (~120/hr when capped) close
      // to the old cron baseline (~120/hr), while busy-mode latency stays
      // at the configured `pollIntervalMs`.
      if (result.claimed === 0) {
        stats.consecutiveEmptyPolls += 1;
        const sleepMs = computeIdleSleepMs(
          stats.consecutiveEmptyPolls,
          config.pollIntervalMs,
          config.idleBackoffMaxMs,
        );
        await sleepWithStop(clock, sleepMs, signals);
      } else {
        stats.consecutiveEmptyPolls = 0;
      }
    } catch (err) {
      if (watchdog) clearTimeout(watchdog);
      // The `Promise.race` watchdog is a loop-level safety, not a job
      // cancellation. If it fired, the in-flight `runNextGenerationJobs`
      // call is still writing to Postgres in the background; we just yield
      // so the next tick can pick up the work it eventually leaves
      // half-done. We do NOT increment consecutiveErrors for timeouts —
      // those are the expected failure mode for very long jobs.
      const isWatchdog = err instanceof Error && err.message.includes("batch watchdog fired");
      if (isWatchdog) {
        emit("batch.timeout", { maxInFlightTimeoutMs: config.maxInFlightTimeoutMs });
        // Give the in-flight call a moment to settle before we start
        // another tick.
        await sleepWithStop(clock, 1000, signals);
        continue;
      }

      stats.consecutiveErrors += 1;
      emitError("batch.error", err, {
        consecutiveErrors: stats.consecutiveErrors,
        maxConsecutiveErrors: config.maxConsecutiveErrors,
      });

      if (stats.consecutiveErrors >= config.maxConsecutiveErrors) {
        emit("loop.escalating", { consecutiveErrors: stats.consecutiveErrors });
        throw err;
      }

      await sleepWithStop(clock, backoffMs, signals);
      backoffMs = Math.min(backoffMs * 2, config.maxErrorBackoffMs);
    }

    // Housekeeping: periodic cleanup and heartbeat. These are best-effort
    // and never throw.
    const elapsed = clock.now() - tickStart;
    if (clock.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
      lastCleanupAt = clock.now();
      await runCleanup(supabase);
    }
    if (clock.now() - lastHeartbeatAt >= config.heartbeatIntervalMs) {
      lastHeartbeatAt = clock.now();
      const hourElapsed = clock.now() - stats.lastHourBatches.sinceMs >= HOUR_MS;
      const window = hourElapsed
        ? stats.lastHourBatches
        : { batches: stats.batches, claimed: stats.claimed, succeeded: stats.succeeded, failed: stats.failed };
      emit("heartbeat", {
        uptimeMs: clock.now() - stats.startedAtMs,
        batches: stats.batches,
        consecutiveErrors: stats.consecutiveErrors,
        consecutiveEmptyPolls: stats.consecutiveEmptyPolls,
        windowSinceMs: hourElapsed ? stats.lastHourBatches.sinceMs : stats.startedAtMs,
        windowBatches: window.batches,
        windowClaimed: window.claimed,
        windowSucceeded: window.succeeded,
        windowFailed: window.failed,
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      });
      if (hourElapsed) {
        stats.lastHourBatches = { batches: 0, claimed: 0, succeeded: 0, failed: 0, sinceMs: clock.now() };
      }
    }
    // Avoid burning CPU on a tight loop when ticks complete in <1ms.
    if (elapsed < 5 && !signals.isStopRequested()) {
      await sleepWithStop(clock, Math.max(0, 5 - elapsed), signals);
    }
  }

  emit("loop.stopped", {
    batches: stats.batches,
    claimed: stats.claimed,
    succeeded: stats.succeeded,
    failed: stats.failed,
    uptimeMs: clock.now() - stats.startedAtMs,
  });
}

async function sleepWithStop(clock: TickClock, ms: number, signals: LoopSignals) {
  const deadline = clock.now() + ms;
  while (clock.now() < deadline) {
    if (signals.isStopRequested()) return;
    const remaining = Math.max(0, Math.min(50, deadline - clock.now()));
    if (remaining === 0) return;
    await clock.sleep(remaining);
  }
}

/**
 * Adaptive idle backoff. Empty poll #1 sleeps `pollIntervalMs`, #2 doubles,
 * #3 doubles again, and so on, capped at `idleBackoffMaxMs`. Exported so
 * tests can verify the curve without spinning up the full loop.
 */
export function computeIdleSleepMs(
  consecutiveEmptyPolls: number,
  pollIntervalMs: number,
  idleBackoffMaxMs: number,
): number {
  if (consecutiveEmptyPolls <= 0) return 0;
  const shift = consecutiveEmptyPolls - 1;
  // Cap the shift to avoid Number overflow when consecutiveEmptyPolls is
  // very large (e.g. test scenarios that simulate days of idle). 32 is
  // already ~4.3 billion ms = ~50 days, far past any practical value.
  const safeShift = Math.min(shift, 32);
  const candidate = pollIntervalMs * Math.pow(2, safeShift);
  return Math.min(candidate, idleBackoffMaxMs);
}

/**
 * Load `.env.local` (dev) or `.env.production` (shared/prod) into
 * `process.env` if present. Never overwrites an already-set var. Mirrors the
 * pattern used by `scripts/upload-presets.ts` so behavior is consistent.
 */
export function loadDotEnvIfPresent() {
  const candidates = [".env.local", ".env.production"];
  for (const filename of candidates) {
    const filepath = resolve(process.cwd(), filename);
    let content: string;
    try {
      content = readFileSync(filepath, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIndex = line.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function validateRequiredEnv() {
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((name) => !process.env[name] || process.env[name] === "");
  if (missing.length > 0) {
    throw new Error(`[worker] missing required env: ${missing.join(", ")}`);
  }
}

function parseBoundedEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function bootstrap() {
  loadDotEnvIfPresent();
  validateRequiredEnv();
  const config = parseWorkerConfig(process.env);
  if (!config.enabled) {
    emit("loop.disabled", { reason: "WORKER_ENABLED=false" });
    return;
  }
  // Touch the admin client once at boot so env validation happens before
  // we start the loop. getAdminClient throws if env is missing.
  const supabase = getAdminClient();
  const signals = createSignalHook();
  await Promise.all([
    runLoop(supabase, config, createRealClock(), signals),
    runOssMirrorRecoveryLoop(supabase, createRealClock(), signals),
  ]);
}

if (isMainModule) {
  bootstrap()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      emitError("fatal", err);
      // Non-zero exit so PM2 restarts the process. PM2's default restart
      // strategy applies an exponential backoff automatically.
      process.exit(1);
    });

  process.on("unhandledRejection", (reason) => {
    emitError("unhandledRejection", reason);
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    emitError("uncaughtException", err);
    process.exit(1);
  });
}
