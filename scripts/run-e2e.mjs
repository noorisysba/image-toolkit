import { spawnSync } from "node:child_process";
const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (!process.env.TEST_URL) {
  run(["node_modules/typescript/bin/tsc", "-b"]);
  run(["node_modules/vite/bin/vite.js", "build"]);
}
run(["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)]);
