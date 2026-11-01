import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { startLocalIpc, callLocalIpc, verifyDirectory } from "../dsh-plugin/local-ipc.mjs";

test("IPC exposes only bridge-created sessions and assistant text", { timeout: 10000 }, async () => {
  // macOS sockaddr_un has a small path limit; keep Unix sockets independent
  // of the checkout depth. Windows pipes do not use this directory as an address.
  const dir = fs.mkdtempSync(process.platform === "win32"
    ? path.join(process.cwd(), ".tmp-dsh-ipc-test-")
    : "/tmp/dsh-ipc-test-");
  const socket = process.platform === "win32"
    ? `\\\\.\\pipe\\codex-dsh-test-${crypto.randomUUID()}`
    : path.join(dir, "test.sock");
  let listener;
  let prompt;
  const ctx = {
    on: (event, callback) => { if (event === "session/event") listener = callback; return () => { if (event === "session/event") listener = undefined; }; },
    sessionController: {
      create: async () => ({ sessionId: "synthetic-session" }),
      rename: async () => {},
      prompt: async request => { prompt = request; },
      cancel: async () => {},
    },
  };
  let close;
  try {
    if (process.platform === "win32") {
      fs.writeFileSync(path.join(dir, "desktop.json"), JSON.stringify({ pipe: socket, token: "stale-token" }));
    }
    close = await startLocalIpc(ctx, socket, dir);
    if (process.platform !== "win32") assert.equal(fs.statSync(socket).mode & 0o777, 0o600);
    else {
      assert.ok(fs.existsSync(path.join(dir, "desktop.json")));
      const rejected = await rawCall(socket, { method: "health", token: "incorrect-token" });
      assert.equal(rejected.ok, false);
      assert.match(rejected.error, /authentication failed/);
    }
    assert.equal((await callLocalIpc({ method: "health" }, socket, dir)).protocolVersion, 1);
    await assert.rejects(callLocalIpc({ method: "snapshot", sessionId: "private-session" }, socket, dir), /not owned/);
    await callLocalIpc({ method: "create", cwd: dir }, socket, dir);
    await callLocalIpc({ method: "prompt", sessionId: "synthetic-session", text: "只读测试" }, socket, dir);
    assert.equal(prompt.content[0].text, "只读测试");
    listener({ id: "private-session" }, { type: "assistant/message", data: { content: [{ type: "text", text: "PRIVATE" }] } });
    listener({ id: "synthetic-session" }, { type: "tool/result", data: { text: "TOOL_PRIVATE" } });
    listener({ id: "synthetic-session" }, { type: "assistant/message", data: { content: [{ type: "text", text: "OK" }] } });
    listener({ id: "synthetic-session" }, { type: "turn/end" });
    const result = await callLocalIpc({ method: "snapshot", sessionId: "synthetic-session" }, socket, dir);
    assert.equal(result.text, "OK\n");
    assert.equal(result.status, "completed");
  } finally {
    close?.();
    await new Promise(resolve => setImmediate(resolve));
    fs.rmdirSync(dir);
  }
});

function rawCall(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding("utf8");
    let data = "";
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("error", reject);
    socket.on("data", chunk => { data += chunk; });
    socket.on("end", () => {
      try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
    });
  });
}

test("IPC state directory is created on first run", () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".tmp-dsh-ipc-parent-test-"));
  const dir = path.join(root, "missing-parent", "ipc");
  try {
    verifyDirectory(true, dir);
    assert.equal(fs.statSync(dir).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unsafe IPC directory permissions fail closed", { skip: process.platform === "win32" }, () => {
  const dir = fs.mkdtempSync("/tmp/dsh-ipc-mode-");
  try {
    fs.chmodSync(dir, 0o755);
    assert.throws(() => verifyDirectory(false, dir), /0700/);
  } finally { fs.rmdirSync(dir); }
});
