#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateEndpoint } from "./controller/http-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const runtimeDir = path.join(here, "runtime");
const controller = path.join(here, "controller", "controller.mjs");
const pidFile = path.join(runtimeDir, "controller.pid.json");
const logFile = path.join(runtimeDir, "controller.log");
const host = process.env.CODEX_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.CODEX_BRIDGE_PORT ?? 32123);
validateEndpoint(host, port);
const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
const healthUrl = `http://${urlHost}:${port}/health`;
const action = process.argv[2] ?? "start";

if (!new Set(["start", "stop", "restart", "status"]).has(action)) {
  fail("Usage: node bridge/manage-controller.mjs start|stop|restart|status");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  fail(`Invalid CODEX_BRIDGE_PORT: ${process.env.CODEX_BRIDGE_PORT}`);
}

if (action === "stop" || action === "restart") await stopController();
if (action === "start" || action === "restart") await startController();
if (action === "status") await showStatus();

async function startController() {
  let health = await getHealth();
  if (health?.ready && health?.service === "codex-dsh-bridge") {
    console.log(`ready ${healthUrl}`);
    return;
  }
  if (health?.service === "codex-dsh-bridge" && health?.status === "failed") {
    await stopController();
    health = undefined;
  }
  if (health) {
    fail(`Port ${port} is already serving an unexpected process or an unready bridge`);
  }

  const existing = readPidFile();
  if (existing && isAlive(existing.pid)) {
    fail(`Controller process ${existing.pid} is running but ${healthUrl} is not ready; inspect ${logFile}`);
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  const log = fs.openSync(logFile, "a");
  let child;
  try {
    child = spawn(process.execPath, [controller], {
      cwd: root,
      detached: true,
      env: process.env,
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(log);
  }
  child.unref();
  writePidFile({ pid: child.pid, startedAt: new Date().toISOString(), controller });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await delay(250);
    const next = await getHealth();
    if (next?.ready && next?.service === "codex-dsh-bridge") {
      console.log(`ready ${healthUrl} pid=${child.pid}`);
      return;
    }
    if (!isAlive(child.pid)) {
      fail(`Controller exited before becoming ready; inspect ${logFile}`);
    }
    if (next?.status === "failed") {
      fail(`Controller initialization failed: ${next.error ?? "unknown error"}; inspect ${logFile}`);
    }
  }
  fail(`Controller did not become ready within 30 seconds; inspect ${logFile}`);
}

async function stopController() {
  const entry = readPidFile();
  if (!entry) {
    console.log("not-running");
    return;
  }
  if (!isExpectedController(entry)) {
    fail(`Refusing to stop PID ${entry.pid}: the PID file does not identify this controller`);
  }
  if (!isAlive(entry.pid)) {
    removePidFile();
    console.log("not-running");
    return;
  }
  if (!isExpectedControllerProcess(entry.pid)) {
    fail(`Refusing to stop PID ${entry.pid}: it is not running ${controller}`);
  }

  process.kill(entry.pid, "SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && isAlive(entry.pid)) await delay(100);
  if (isAlive(entry.pid)) {
    process.kill(entry.pid, "SIGKILL");
    await delay(100);
  }
  removePidFile();
  console.log("stopped");
}

async function showStatus() {
  const health = await getHealth();
  if (health?.ready && health?.service === "codex-dsh-bridge") {
    console.log(`ready ${healthUrl}`);
    return;
  }
  if (health) {
    console.log(`${health.status ?? "not-ready"} ${healthUrl}${health.error ? `: ${health.error}` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(`offline ${healthUrl}`);
  process.exitCode = 1;
}

async function getHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
    const body = await response.json();
    return body && typeof body === "object" ? body : undefined;
  } catch {
    return undefined;
  }
}

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return undefined;
  }
}

function writePidFile(value) {
  const temporary = `${pidFile}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, pidFile);
}

function removePidFile() {
  try {
    fs.unlinkSync(pidFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function isExpectedController(entry) {
  return Number.isInteger(entry?.pid) && path.resolve(entry?.controller ?? "") === controller;
}

function isExpectedControllerProcess(pid) {
  if (process.platform === "win32") {
    const command = `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 && result.stdout.includes(controller);
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 && result.stdout.includes(controller);
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
