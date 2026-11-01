#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CodexAppServerClient } from "./app-server-client.mjs";
import { resolveCodexExecutable } from "../resolve-codex.mjs";
import { validateEndpoint, validateRequest, readBody } from "./http-policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeRoot = path.resolve(here, "..");
const workspace = path.resolve(process.env.CODEX_BRIDGE_WORKSPACE ?? path.resolve(bridgeRoot, ".."));
const runtimeDir = path.resolve(here, "../runtime");
const statePath = path.join(runtimeDir, "state.json");
const executable = resolveCodexExecutable();
const host = process.env.CODEX_BRIDGE_HOST ?? "127.0.0.1";
const port = Number(process.env.CODEX_BRIDGE_PORT ?? 32123);
validateEndpoint(host, port);
const threadName = process.env.CODEX_BRIDGE_THREAD_NAME ?? "DSH-Codex 双向桥接专用任务";

fs.mkdirSync(runtimeDir, { recursive: true });
const state = readJson(statePath, { threadId: null, requests: {} });
const app = new CodexAppServerClient({ executable, cwd: workspace });
const pendingServerRequests = new Map();
let active = Promise.resolve();
let readyStatus = "starting";
let readyError;

app.on("serverRequest", (message) => {
  pendingServerRequests.set(String(message.id), message);
  for (const request of Object.values(state.requests)) {
    if (request.status === "running") request.pendingInteraction = message;
  }
  saveState();
});

const ready = initializeBridge();
ready.catch(() => undefined);

const server = http.createServer(async (req, res) => {
  try {
    validateRequest(req, port);
    const url = new URL(req.url, `http://${host}:${port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, readyStatus === "failed" ? 503 : 200, {
        service: "codex-dsh-bridge",
        protocolVersion: 1,
        ok: readyStatus !== "failed",
        ready: readyStatus === "ready",
        status: readyStatus,
        threadId: state.threadId,
        activeRequests: runningCount(),
        ...(readyError ? { error: readyError.message } : {}),
      });
    }
    if (readyStatus === "failed") throw readyError;
    await ready;
    if (req.method === "GET" && url.pathname === "/v1/thread") {
      return json(res, 200, { ok: true, threadId: state.threadId, name: threadName });
    }
    if (req.method === "GET" && url.pathname === "/v1/threads") {
      const limit = boundedInteger(url.searchParams.get("limit"), 20, 1, 50);
      const searchTerm = url.searchParams.get("search")?.trim() || undefined;
      const result = await serialize(() => withApp(() => app.request("thread/list", {
          limit,
          sortKey: "updated_at",
          sortDirection: "desc",
          ...(searchTerm ? { searchTerm } : {}),
        })));
      const threads = (result.data ?? []).map(compactThread);
      return json(res, 200, { ok: true, threads, nextCursor: result.nextCursor ?? null });
    }
    const contextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context$/);
    if (req.method === "GET" && contextMatch) {
      const threadId = decodeURIComponent(contextMatch[1]);
      const maxTurns = boundedInteger(url.searchParams.get("maxTurns"), 8, 1, 20);
      const snapshot = await serialize(() => withApp(() => readContextSnapshot(threadId, maxTurns)));
      return json(res, 200, { ok: true, ...snapshot });
    }
    if (req.method === "POST" && url.pathname === "/v1/ask") {
      const body = await readBody(req);
      if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { ok: false, error: "text is required" });
      const contextThreadId = optionalString(body.contextThreadId);
      return queueRequest(res, {
        mode: "bridge",
        threadId: state.threadId,
        text: body.text,
        ...(contextThreadId ? { contextThreadId } : {}),
      });
    }
    if (req.method === "POST" && url.pathname === "/v1/start") {
      const body = await readBody(req);
      if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { ok: false, error: "text is required" });
      return queueRequest(res, {
        mode: "start",
        text: body.text,
        name: optionalString(body.name),
      });
    }
    if (req.method === "POST" && url.pathname === "/v1/fork") {
      const body = await readBody(req);
      if (typeof body.threadId !== "string" || !body.threadId.trim()) return json(res, 400, { ok: false, error: "threadId is required" });
      if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { ok: false, error: "text is required" });
      return queueRequest(res, {
        mode: "fork",
        sourceThreadId: body.threadId.trim(),
        text: body.text,
        name: optionalString(body.name),
      });
    }
    if (req.method === "POST" && url.pathname === "/v1/continue") {
      const body = await readBody(req);
      if (body.confirmation !== "WRITE_TO_EXISTING_THREAD") return json(res, 400, { ok: false, error: "explicit confirmation is required to write to an existing thread" });
      if (typeof body.threadId !== "string" || !body.threadId.trim()) return json(res, 400, { ok: false, error: "threadId is required" });
      if (typeof body.text !== "string" || !body.text.trim()) return json(res, 400, { ok: false, error: "text is required" });
      if (body.threadId.trim() === state.threadId) return json(res, 400, { ok: false, error: "use /v1/ask for the dedicated bridge thread" });
      return queueRequest(res, {
        mode: "continue",
        threadId: body.threadId.trim(),
        text: body.text,
      });
    }
    const requestMatch = url.pathname.match(/^\/v1\/requests\/([^/]+)$/);
    if (req.method === "GET" && requestMatch) {
      const item = state.requests[requestMatch[1]];
      return item ? json(res, 200, { ok: true, ...item }) : json(res, 404, { ok: false, error: "request not found" });
    }
    const responseMatch = url.pathname.match(/^\/v1\/interactions\/([^/]+)\/respond$/);
    if (req.method === "POST" && responseMatch) {
      const rpcId = responseMatch[1];
      if (!pendingServerRequests.has(rpcId)) return json(res, 404, { ok: false, error: "interaction not found" });
      const body = await readBody(req);
      app.respond(Number.isNaN(Number(rpcId)) ? rpcId : Number(rpcId), body.result ?? body);
      pendingServerRequests.delete(rpcId);
      return json(res, 200, { ok: true, rpcId });
    }
    return json(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    return json(res, error.status ?? 500, { ok: false, code: error.code ?? "BRIDGE_ERROR", error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`DSH Codex bridge controller listening on http://${host}:${port}`);
});
server.on("error", async (error) => {
  console.error(`Controller HTTP server failed on ${host}:${port}: ${error.message}`);
  readyStatus = "failed";
  readyError = error;
  await app.stop().catch(() => undefined);
  process.exit(1);
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    await app.stop().catch((error) => console.error(`Could not stop Codex app-server: ${error.message}`));
    process.exit(0);
  });
}

async function ensureThread() {
  if (state.threadId) {
    try {
      await app.request("thread/read", { threadId: state.threadId, includeTurns: false });
      return;
    } catch (error) {
      console.error(`Could not resume ${state.threadId}; creating a new bridge thread: ${error.message}`);
    }
  }
  const result = await app.request("thread/start", {
    cwd: workspace,
    approvalPolicy: "never",
    sandbox: "read-only",
    serviceName: "dsh_codex_bridge",
  });
  state.threadId = result.thread.id;
  await app.request("thread/name/set", { threadId: state.threadId, name: threadName });
  saveState();
}

async function initializeBridge() {
  try {
    await app.start();
    await ensureThread();
    await app.stop();
    readyStatus = "ready";
    console.log(`Codex thread: ${state.threadId}`);
  } catch (error) {
    readyStatus = "failed";
    readyError = error;
    await app.stop().catch(() => undefined);
    console.error(`Bridge initialization failed: ${error.message}`);
    throw error;
  }
}

async function runRequest(requestId) {
  const request = state.requests[requestId];
  if (!request) return;
  request.status = "running";
  request.startedAt = new Date().toISOString();
  saveState();

  let answer = "";
  let targetThreadId = request.threadId;
  let finalStatus = "failed";
  const onNotification = (message) => {
    const params = message.params ?? {};
    if (params.threadId && targetThreadId && params.threadId !== targetThreadId) return;
    if (message.method === "item/agentMessage/delta") answer += params.delta ?? "";
    if (message.method === "item/completed" && params.item?.type === "agentMessage" && params.item.text) answer = params.item.text;
    if (message.method === "turn/completed" && params.turn?.id === request.turnId) {
      request.turnStatus = params.turn.status;
      request.turnError = params.turn.error ?? null;
    }
  };
  app.on("notification", onNotification);
  try {
    await app.start();
    if (request.mode === "start") {
      const started = await app.request("thread/start", {
        cwd: workspace,
        approvalPolicy: "never",
        sandbox: "read-only",
        serviceName: "dsh_codex_bridge",
      });
      targetThreadId = started.thread.id;
      request.threadId = targetThreadId;
      await app.request("thread/name/set", {
        threadId: targetThreadId,
        name: request.name || `DSH task ${targetThreadId.slice(0, 8)}`,
      });
    } else if (request.mode === "fork") {
      await assertThreadNotActive(request.sourceThreadId);
      const forked = await app.request("thread/fork", { threadId: request.sourceThreadId });
      targetThreadId = forked.thread.id;
      request.threadId = targetThreadId;
      const sourceName = request.name || forked.thread.name || `DSH fork ${request.sourceThreadId.slice(0, 8)}`;
      await app.request("thread/name/set", { threadId: targetThreadId, name: sourceName });
    } else if (request.mode === "continue") {
      await assertThreadNotActive(targetThreadId);
      await app.request("thread/resume", { threadId: targetThreadId });
    } else {
      await app.request("thread/resume", { threadId: targetThreadId });
    }

    let prompt = request.text;
    if (request.mode === "bridge" && request.contextThreadId) {
      const context = await readContextSnapshot(request.contextThreadId, 8);
      prompt = [
        "Use the following read-only snapshot from another Codex task as context. Do not assume access to anything outside this snapshot.",
        `<codex-thread-context id="${request.contextThreadId}" title="${escapeAttribute(context.thread.name ?? context.thread.preview ?? "")}">`,
        context.text,
        "</codex-thread-context>",
        "",
        "Task from DSH:",
        request.text,
      ].join("\n");
    }

    const result = await app.request("turn/start", {
      threadId: targetThreadId,
      input: [{ type: "text", text: prompt }],
      cwd: workspace,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
    });
    request.turnId = result.turn.id;
    saveState();
    await waitFor(() => request.turnStatus, 10 * 60_000);
    request.answer = answer;
    finalStatus = request.turnStatus === "completed" ? "completed" : "failed";
    if (!answer && request.turnError) request.error = request.turnError.message ?? JSON.stringify(request.turnError);
  } catch (error) {
    finalStatus = "failed";
    request.error = error.message;
  } finally {
    app.off("notification", onNotification);
    if (targetThreadId && targetThreadId !== state.threadId) {
      try {
        await app.request("thread/unsubscribe", { threadId: targetThreadId });
      } catch {}
    }
    await app.stop().catch((error) => console.error(`Could not release Codex writer: ${error.message}`));
    request.status = finalStatus;
    request.completedAt = new Date().toISOString();
    saveState();
  }
}

function queueRequest(res, fields) {
  const requestId = crypto.randomUUID();
  state.requests[requestId] = {
    requestId,
    status: "queued",
    answer: "",
    createdAt: new Date().toISOString(),
    ...fields,
  };
  saveState();
  serialize(() => runRequest(requestId));
  return json(res, 202, {
    ok: true,
    requestId,
    threadId: fields.threadId ?? null,
    sourceThreadId: fields.sourceThreadId ?? fields.contextThreadId ?? null,
    mode: fields.mode,
    status: "queued",
  });
}

function serialize(operation) {
  const run = active.then(operation);
  active = run.catch((error) => console.error(error));
  return run;
}

async function withApp(operation) {
  await app.start();
  try {
    return await operation();
  } finally {
    await app.stop();
  }
}

async function assertThreadNotActive(threadId) {
  const result = await app.request("thread/read", { threadId, includeTurns: false });
  if (result.thread?.status?.type === "active") throw new Error("target thread is active; wait for its current turn to finish");
}

async function readContextSnapshot(threadId, maxTurns) {
  const result = await app.request("thread/read", { threadId, includeTurns: true });
  const thread = result.thread;
  if (!thread) throw new Error("thread not found");
  const turns = (thread.turns ?? []).slice(-maxTurns);
  const sections = [];
  for (const turn of turns) {
    const lines = [];
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage") {
        const text = (item.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
        if (text) lines.push(`User: ${text}`);
      } else if (item.type === "agentMessage" && item.text) {
        lines.push(`Codex: ${item.text}`);
      }
    }
    if (lines.length) sections.push(lines.join("\n"));
  }
  let text = sections.join("\n\n");
  const maxChars = 30_000;
  let truncated = false;
  if (text.length > maxChars) {
    text = text.slice(text.length - maxChars);
    truncated = true;
  }
  return {
    thread: compactThread(thread),
    maxTurns,
    returnedTurns: turns.length,
    truncated,
    text,
  };
}

function compactThread(thread) {
  return {
    id: thread.id,
    name: thread.name ?? null,
    preview: thread.preview ?? null,
    createdAt: thread.createdAt ?? null,
    updatedAt: thread.updatedAt ?? null,
    status: thread.status ?? null,
    forkedFromId: thread.forkedFromId ?? null,
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function escapeAttribute(value) {
  return String(value).replace(/[&"<>]/g, (character) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character]);
}

function saveState() {
  const finished = Object.values(state.requests)
    .filter((item) => item.status === "completed" || item.status === "failed")
    .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  for (const item of finished.slice(100)) delete state.requests[item.requestId];
  const temporary = `${statePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runningCount() {
  return Object.values(state.requests).filter((item) => item.status === "queued" || item.status === "running").length;
}

function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }
    }, 100);
  });
}

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": data.length });
  res.end(data);
}
