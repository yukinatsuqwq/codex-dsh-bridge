#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { codexSpawnSpec, resolveCodexExecutable } from "../bridge/resolve-codex.mjs";

const dshUrl = process.env.DSH_BASE_URL ?? "http://127.0.0.1:3080";
const bridgeUrl = process.env.CODEX_BRIDGE_URL ?? process.env.CODEX_APP_SERVER_URL ?? "http://127.0.0.1:32123";
const results = [];

results.push({
  check: "Node.js",
  ok: Number(process.versions.node.split(".")[0]) >= 22,
  detail: process.version,
});

const codexExecutable = resolveCodexExecutable();
const codexLaunch = codexSpawnSpec(codexExecutable, ["--version"]);
const codex = spawnSync(codexLaunch.command, codexLaunch.args, {
  encoding: "utf8",
  windowsHide: true,
});
results.push({
  check: "Codex CLI",
  ok: codex.status === 0,
  detail: (codex.stdout || codex.stderr || codex.error?.message || "not found").trim(),
});

for (const [check, url] of [["DSH Web", dshUrl], ["Bridge controller", `${bridgeUrl}/health`]]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    if (check === "Bridge controller") {
      const health = await response.json();
      const ok = response.ok && health?.service === "codex-dsh-bridge" && health?.ready === true;
      results.push({ check, ok, detail: `HTTP ${response.status} ${health?.status ?? "invalid-health-response"} ${url}` });
    } else {
      const reachable = response.ok || response.status === 401;
      const suffix = response.status === 401 ? " (reachable; browser authentication required)" : "";
      results.push({ check, ok: reachable, detail: `HTTP ${response.status} ${url}${suffix}` });
    }
  } catch (error) {
    results.push({ check, ok: false, detail: `${url}: ${error.message}` });
  }
}

for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.check}: ${item.detail}`);
}

if (results.some((item) => !item.ok)) process.exitCode = 1;

