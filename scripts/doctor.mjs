#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const dshUrl = process.env.DSH_BASE_URL ?? "http://127.0.0.1:3080";
const bridgeUrl = process.env.CODEX_APP_SERVER_URL ?? "http://127.0.0.1:32123";
const results = [];

results.push({
  check: "Node.js",
  ok: Number(process.versions.node.split(".")[0]) >= 22,
  detail: process.version,
});

const codexExecutable = process.env.CODEX_BRIDGE_EXECUTABLE ?? "codex";
const codex = spawnSync(codexExecutable, ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32" && !/\.exe$/i.test(codexExecutable),
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
    results.push({ check, ok: response.ok, detail: `HTTP ${response.status} ${url}` });
  } catch (error) {
    results.push({ check, ok: false, detail: `${url}: ${error.message}` });
  }
}

for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.check}: ${item.detail}`);
}

if (results.some((item) => !item.ok)) process.exitCode = 1;

