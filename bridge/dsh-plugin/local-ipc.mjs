import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { InteractionRegistry } from "./interactions.mjs";

export function ipcDirectory() {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "codex-dsh-bridge", "ipc");
  }
  return `/tmp/codex-dsh-${process.getuid()}`;
}

export function ipcPath() {
  if (process.platform === "win32") {
    const suffix = crypto.createHash("sha256").update(ipcDirectory()).digest("hex").slice(0, 24);
    return `\\\\.\\pipe\\codex-dsh-${suffix}`;
  }
  return path.join(ipcDirectory(), "desktop.sock");
}

export function verifyDirectory(create = false, directory = ipcDirectory()) {
  if (create) {
    try { fs.mkdirSync(directory, { mode: 0o700, recursive: true }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("DSH IPC state path must be a real directory");
  if (process.platform === "win32") {
    if (create) secureWindowsDirectory(directory);
    return;
  }
  if (stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw new Error("DSH IPC directory must be owned by the current user with mode 0700");
  }
}

export async function startLocalIpc(ctx, socketPath = ipcPath(), stateDirectory = ipcDirectory()) {
  verifyDirectory(true, process.platform === "win32" ? stateDirectory : path.dirname(socketPath));
  const descriptor = path.join(stateDirectory, "desktop.json");
  const token = process.platform === "win32" ? crypto.randomBytes(32).toString("base64url") : undefined;
  // Never unlink a socket owned by a running Host, or guess at a stale endpoint.
  if (process.platform === "win32") {
    if (fs.existsSync(descriptor)) {
      const existing = readDescriptor(descriptor);
      if (existing && await descriptorIsLive(existing)) {
        throw new Error("DSH IPC descriptor already exists; another Host owns it");
      }
      fs.unlinkSync(descriptor);
    }
  } else if (fs.existsSync(socketPath)) throw new Error("DSH IPC socket already exists; another Host may own it");
  const sessions = new Map();
  const interactions = new InteractionRegistry({ owns: (id, agent) => sessions.get(id)?.interactions === "ipc" && ctx.sessions.get(id) === agent.session });
  const disposeQuestions = ctx.on("user-questions/request", (request, next) => interactions.handle("question", request, next), { prepend: true });
  const disposeApprovals = ctx.on("approval/request", (request, next) => interactions.handle("approval", request, next), { prepend: true });
  const disposeEvents = ctx.on("session/event", (session, event) => {
    const entry = sessions.get(session.id);
    if (!entry) return;
    if (event.type === "assistant/message") {
      const content = event.data?.content ?? event.data?.message?.content;
      const text = Array.isArray(content) ? content.filter(p => p.type === "text").map(p => p.text).join("\n") : "";
      if (text) entry.text = (entry.text + text + "\n").slice(-30000);
    }
    if (event.type === "turn/start") entry.status = "running";
    if (event.type === "turn/end") entry.status = "completed";
  });
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (sockets.size >= 16) { socket.destroy(); return; }
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(15000, () => socket.destroy());
    let data = "";
    let accepted = false;
    socket.on("data", chunk => {
      if (accepted) return;
      data += chunk.toString("utf8");
      if (Buffer.byteLength(data) > 65536) { socket.destroy(); return; }
      const end = data.indexOf("\n");
      if (end < 0) return;
      accepted = true;
      Promise.resolve().then(() => dispatch(JSON.parse(data.slice(0, end)))).then(
        result => socket.end(JSON.stringify({ ok: true, ...result }) + "\n"),
        error => socket.end(JSON.stringify({ ok: false, error: error.message }) + "\n"),
      );
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  }).catch(error => { disposeEvents(); disposeQuestions(); disposeApprovals(); throw error; });
  try {
    if (process.platform === "win32") {
      fs.writeFileSync(descriptor, `${JSON.stringify({ pipe: socketPath, token })}\n`, { encoding: "utf8", flag: "wx" });
    } else {
      fs.chmodSync(socketPath, 0o600);
    }
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    disposeEvents();
    disposeQuestions();
    disposeApprovals();
    interactions.cancel();
    throw error;
  }
  server.on("error", () => {});
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    disposeEvents();
    disposeQuestions();
    disposeApprovals();
    interactions.cancel();
    for (const socket of sockets) socket.destroy();
    server.close(); // Node removes its own Unix socket on close.
    if (process.platform === "win32") {
      try { fs.unlinkSync(descriptor); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  };

  async function dispatch(request) {
    if (!request || typeof request !== "object") throw new Error("Invalid IPC request");
    if (process.platform === "win32" && request.token !== token) throw new Error("DSH IPC authentication failed");
    if (request.method === "health") return { service: "codex-dsh-local", protocolVersion: 1 };
    if (request.method === "create") {
      if (sessions.size >= 100) throw new Error("Bridge session limit reached; restart the Host to reset ownership");
      if (request.interactions !== undefined && !["ipc", "desktop"].includes(request.interactions)) throw new Error("interactions must be ipc or desktop");
      if (typeof request.cwd !== "string" || !path.isAbsolute(request.cwd) || !fs.statSync(request.cwd).isDirectory()) throw new Error("An explicit absolute test workspace directory is required");
      const created = await ctx.sessionController.create({ cwd: request.cwd });
      sessions.set(created.sessionId, { text: "", status: "idle", interactions: request.interactions ?? "desktop" });
      if (typeof request.title === "string") await ctx.sessionController.rename({ sessionId: created.sessionId, title: request.title.slice(0, 120) });
      return { sessionId: created.sessionId };
    }
    const entry = sessions.get(request.sessionId);
    if (!entry) throw new Error("Session is not owned by this bridge Host; create a new bridge session");
    if (request.method === "pending") return { pending: interactions.list(request.sessionId) };
    if (request.method === "answer" || request.method === "answer-approval") return interactions.respond({ ...request, kind: request.method === "answer" ? "question" : "approval" });
    if (request.method === "snapshot") return { sessionId: request.sessionId, ...entry };
    if (request.method === "cancel") {
      await ctx.sessionController.cancel({ sessionId: request.sessionId });
      interactions.cancel(request.sessionId);
      return { sessionId: request.sessionId, cancelled: true };
    }
    if (request.method === "prompt") {
      if (typeof request.text !== "string" || !request.text.trim()) throw new Error("Non-empty text is required");
      if (entry.status === "queued" || entry.status === "running") throw new Error("Bridge session is busy; wait for completion or cancel it");
      const previousStatus = entry.status;
      entry.status = "queued";
      try {
        await ctx.sessionController.prompt({ sessionId: request.sessionId, requestId: crypto.randomUUID(), mode: "queue", content: [{ type: "text", text: request.text }] }, AbortSignal.timeout(10000));
      } catch (error) {
        if (entry.status === "queued") entry.status = previousStatus;
        throw error;
      }
      return { sessionId: request.sessionId, accepted: true };
    }
    throw new Error("Unsupported IPC method");
  }
}

export async function callLocalIpc(request, socketPath = ipcPath(), stateDirectory = ipcDirectory()) {
  verifyDirectory(false, process.platform === "win32" ? stateDirectory : path.dirname(socketPath));
  let authenticated = request;
  if (process.platform === "win32") {
    const descriptor = JSON.parse(fs.readFileSync(path.join(stateDirectory, "desktop.json"), "utf8"));
    if (descriptor.pipe !== socketPath || typeof descriptor.token !== "string" || descriptor.token.length < 32) {
      throw new Error("Invalid DSH IPC descriptor");
    }
    authenticated = { ...request, token: descriptor.token };
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.setEncoding("utf8");
    let data = "";
    socket.setTimeout(15000, () => socket.destroy(new Error("DSH IPC timed out")));
    socket.on("connect", () => socket.write(JSON.stringify(authenticated) + "\n"));
    socket.on("error", reject);
    socket.on("data", chunk => {
      data += chunk.toString("utf8");
      if (Buffer.byteLength(data) > 262144) socket.destroy(new Error("DSH IPC response too large"));
    });
    socket.on("end", () => {
      try {
        const result = JSON.parse(data);
        if (!result.ok) throw new Error(result.error);
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}

function readDescriptor(descriptor) {
  try {
    const value = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    return typeof value?.pipe === "string" && typeof value?.token === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function descriptorIsLive(descriptor) {
  try {
    const result = await rawPipeCall(descriptor.pipe, { method: "health", token: descriptor.token }, 750);
    return result?.ok === true && result?.service === "codex-dsh-local";
  } catch {
    return false;
  }
}

function rawPipeCall(pipe, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    socket.setEncoding("utf8");
    let data = "";
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("DSH IPC probe timed out")));
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("error", reject);
    socket.on("data", chunk => { data += chunk.toString("utf8"); });
    socket.on("end", () => {
      try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
    });
  });
}

function secureWindowsDirectory(directory) {
  const identity = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = identity.stdout?.match(/S-1-(?:\d+-)+\d+/)?.[0];
  if (identity.status !== 0 || !sid) throw new Error("Could not determine the current Windows user SID for IPC protection");
  const commands = [
    ["/inheritance:r"],
    ["/grant:r", `*${sid}:(OI)(CI)F`],
    ["/grant:r", "*S-1-5-18:(OI)(CI)F"],
  ];
  for (const args of commands) {
    const result = spawnSync("icacls.exe", [directory, ...args], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) throw new Error(`Could not secure the DSH IPC state directory: ${(result.stderr || result.stdout).trim()}`);
  }
}
