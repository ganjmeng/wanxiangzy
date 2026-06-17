const { spawnSync } = require("node:child_process");

const root = process.cwd();
const nextCli = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: root,
  env: {
    ...process.env,
    // The worker path can crash the native compiler on Windows with large app trees.
    NEXT_PRIVATE_BUILD_WORKER: process.env.NEXT_PRIVATE_BUILD_WORKER || "0",
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
