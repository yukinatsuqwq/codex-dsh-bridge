import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { CodexAppServerClient } from "./app-server-client.mjs";

test("missing executable rejects initialization and releases the process", async () => {
  const executable = process.platform === "win32"
    ? "C:\\nonexistent-codex-bridge-test\\codex.exe"
    : "/nonexistent-codex-bridge-test";
  const client = new CodexAppServerClient({ executable, cwd: process.cwd() });
  await assert.rejects(client.start(), /Could not start Codex app-server/);
  assert.equal(client.process, null);
  assert.equal(client.pending.size, 0);
});

test("stop rejects pending RPCs and terminates a child that ignores stdin EOF", { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ["-e", 'process.stdin.resume(); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); console.log("ready");'], { stdio: ["pipe", "pipe", "ignore"] });
  const client = new CodexAppServerClient({ executable: process.execPath, cwd: process.cwd() });
  try {
    await once(child.stdout, "data");
    client.process = child;
    const pending = assert.rejects(client.request("test/pending"), /app-server stopped/);
    await client.stop();
    await pending;
    assert.equal(client.pending.size, 0);
    assert.equal(client.process, null);
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
