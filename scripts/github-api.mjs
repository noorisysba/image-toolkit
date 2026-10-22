// Uses the existing OS credential manager. Credentials never enter files or logs.
import { spawnSync } from "node:child_process";
const credential = spawnSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n\n",
  encoding: "utf8",
  env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
});
const token = (credential.stdout || "")
  .split("\n")
  .find((x) => x.startsWith("password="))
  ?.slice(9)
  .trim();
if (!token)
  throw new Error(
    "GitHub authentication is required in Git Credential Manager.",
  );
const [method = "GET", path = "/user", payload] = process.argv.slice(2);
const response = await fetch(`https://api.github.com${path}`, {
  method,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(payload ? { "Content-Type": "application/json" } : {}),
  },
  body: payload,
});
const body = await response.text();
console.log(
  JSON.stringify({
    status: response.status,
    body: body ? JSON.parse(body) : null,
  }),
);
if (!response.ok) process.exitCode = 1;
