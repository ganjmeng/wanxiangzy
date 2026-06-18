const { spawnSync } = require("node:child_process");

const root = process.cwd();
const nextCli = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: root,
  env: {
    ...process.env,
    NEXT_PRIVATE_BUILD_WORKER: process.env.NEXT_PRIVATE_BUILD_WORKER || "1",
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
