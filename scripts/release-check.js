const { spawn } = require("node:child_process");

const isWindows = process.platform === "win32";
function npmCheck(name, script, reason, fixHint, env = {}) {
  return isWindows
    ? {
        name,
        script,
        command: "cmd.exe",
        args: ["/d", "/s", "/c", `npm run ${script}`],
        reason,
        fixHint,
        env,
      }
    : {
        name,
        script,
        command: "npm",
        args: ["run", script],
        reason,
        fixHint,
        env,
      };
}

const checks = [
  npmCheck(
    "docs",
    "check:docs",
    "Documentation links, code fences, index coverage, or documented npm commands are invalid.",
    "Run `npm run check:docs` locally, fix the reported documentation issue, then rerun `npm run check:release`."
  ),
  npmCheck(
    "test",
    "test",
    "Unit/regression tests failed.",
    "Run `npm run test` locally, fix the first failing spec, then rerun `npm run check:release`."
  ),
  npmCheck(
    "check:prompts",
    "check:prompts",
    "Prompt regression check failed.",
    "Run `npm run check:prompts` locally, update the affected prompt behavior or fixture expectations, then rerun `npm run check:release`."
  ),
  npmCheck(
    "lint",
    "lint",
    "ESLint quality gate failed.",
    "Run `npm run lint` locally, fix reported errors, then rerun `npm run check:release`."
  ),
  npmCheck(
    "typecheck",
    "typecheck",
    "TypeScript type check failed.",
    "Run `npm run typecheck` locally, fix the first compiler error, then rerun `npm run check:release`."
  ),
  npmCheck(
    "build",
    "build",
    "Production build failed.",
    "Run `npm run build` to inspect the Next.js error, then rerun `npm run check:release`."
  ),
  npmCheck(
    "check:ssr-size",
    "check:ssr-size",
    "SSR package size check failed.",
    "Run `SSR_SIZE_FAIL_ON_RISK=1 npm run check:ssr-size` after a successful build and review the listed .next/server files or modules before deploying to EdgeOne.",
    { SSR_SIZE_FAIL_ON_RISK: "1" }
  ),
];

function printHelp() {
  console.log(`Usage: node scripts/release-check.js [--help]

Runs release gates in order:
  1. npm run check:docs
  2. npm run test
  3. npm run check:prompts
  4. npm run lint
  5. npm run typecheck
  6. npm run build
  7. SSR_SIZE_FAIL_ON_RISK=1 npm run check:ssr-size

The first failing step stops the release check and returns its exit code.

Environment forwarded to child checks:
  SSR_SIZE_LIMIT_MIB, SSR_SIZE_WARN_MIB, SSR_SIZE_LARGE_FILE_MIB, SSR_SIZE_TOP_COUNT, SSR_SIZE_FAIL_ON_RISK
`);
}

function formatDuration(startedAt) {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function printableCommand(check) {
  const envPrefix = Object.entries(check.env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `${envPrefix ? `${envPrefix} ` : ""}npm run ${check.script}`;
}

function printFailure(check, result, index) {
  const step = `${index + 1}/${checks.length}`;
  console.error(`\n[release-check] FAILED step ${step}: ${check.name}`);
  console.error(`  command: ${printableCommand(check)}`);
  console.error(`  status: ${result.message}`);
  console.error(`  why it matters: ${check.reason}`);
  console.error(`  next step: ${check.fixHint}`);
}

function runCheck(check, index) {
  return new Promise((resolve) => {
    const step = `${index + 1}/${checks.length}`;
    const startedAt = Date.now();
    console.log(`\n[release-check] Step ${step}: ${printableCommand(check)}`);

    const child = spawn(check.command, check.args, {
      stdio: "inherit",
      shell: false,
      windowsHide: isWindows,
      env: { ...process.env, ...(check.env || {}) },
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        code: 1,
        message: `could not start ${check.command}: ${error.message}`,
      });
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        console.log(`[release-check] Passed ${check.name} in ${formatDuration(startedAt)}`);
        resolve({ ok: true, code: 0 });
        return;
      }

      const exitCode = typeof code === "number" ? code : 1;
      const signalText = signal ? `, signal ${signal}` : "";
      resolve({
        ok: false,
        code: exitCode,
        message: `exit code ${exitCode}${signalText} after ${formatDuration(startedAt)}`,
      });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const unknownArgs = args.filter((arg) => arg !== "--help" && arg !== "-h");
  if (unknownArgs.length > 0) {
    console.error(`[release-check] Unknown option(s): ${unknownArgs.join(", ")}`);
    printHelp();
    process.exit(1);
  }

  console.log("[release-check] Running pre-release checks.");

  for (const [index, check] of checks.entries()) {
    const result = await runCheck(check, index);
    if (!result.ok) {
      printFailure(check, result, index);
      process.exit(result.code);
    }
  }

  console.log("\n[release-check] All release checks passed.");
}

main().catch((error) => {
  console.error(`[release-check] Unexpected error: ${error.stack || error.message}`);
  process.exit(1);
});
