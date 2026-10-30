#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BASE = "http://127.0.0.1:3080";
const DEFAULT_OUT = ".tmp/dsh-bridge";
const CURRENT_SESSION_FILE = process.env.DSH_BRIDGE_STATE_FILE ?? ".tmp/dsh-bridge/current-session.json";

function usage() {
  console.log(`Usage:
  node tools/dsh-codex-bridge.mjs send --text "prompt" [--text-file prompt.md] [--continue] [--base http://127.0.0.1:3080] [--workspace-id id] [--session-id id] [--agent-preset preset] [--title title]
  node tools/dsh-codex-bridge.mjs watch [--continue] [--session-id id] [--seconds 30] [--out .tmp/dsh-bridge]
  node tools/dsh-codex-bridge.mjs answer --rpc-id id --session-id id --answers-json "[{...}]"
  node tools/dsh-codex-bridge.mjs answer-approval --rpc-id id --session-id id --approval-id id --outcome allowed-once|rejected
  node tools/dsh-codex-bridge.mjs current
  node tools/dsh-codex-bridge.mjs reset-current

Notes:
  - send --agent-preset cordis creates a DSH 创造模式 session when no reusable matching session exists.
  - send --continue reuses .tmp/dsh-bridge/current-session.json; if --agent-preset is set, it only reuses a matching preset.
  - watch listens to WebSocket /api/events.mux and writes question/requested and approval/requested frames as pending-*.json.
  - answer sends POST /api/respond with a DSH question answer payload.
  - answer-approval sends a one-shot DSH approval outcome.
  - All HTTP JSON is sent as UTF-8.`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readCurrentSession() {
  if (!fs.existsSync(CURRENT_SESSION_FILE)) return undefined;
  return JSON.parse(fs.readFileSync(CURRENT_SESSION_FILE, "utf8"));
}

function writeCurrentSession(data) {
  writeJson(CURRENT_SESSION_FILE, {
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

async function api(base, method, payload) {
  const body = {
    type: "client-request",
    rpcId: crypto.randomUUID(),
    method,
    payload,
  };
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function respond(base, rpcId, result) {
  const body = {
    type: "client-response",
    rpcId,
    result,
  };
  const response = await fetch(new URL("/api/respond", base), {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`respond HTTP ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function valueOf(envelope) {
  return envelope?.result?.value ?? envelope?.payload ?? envelope;
}

async function firstWorkspaceId(base) {
  const response = await api(base, "workspace.list", {});
  const value = valueOf(response);
  const workspaces = value.workspaces ?? value.items ?? [];
  const workspace = workspaces[0];
  const id = workspace?.workspaceId ?? workspace?.id;
  if (!id) {
    throw new Error("No DSH workspace was returned by workspace.list.");
  }
  return id;
}

async function sendCommand(args) {
  const base = args.base ?? DEFAULT_BASE;
  const text = args["text-file"] ? fs.readFileSync(args["text-file"], "utf8") : args.text;
  if (!text) throw new Error("send requires --text or --text-file.");
  const agentPreset = args["agent-preset"] ?? args.preset;
  const shouldContinue = args.continue === true || args["use-current"] === true;
  const savedCurrent = shouldContinue ? readCurrentSession() : undefined;
  const current = savedCurrent && (!agentPreset || savedCurrent.agentPreset === agentPreset)
    ? savedCurrent
    : undefined;
  let sessionId = args["session-id"] ?? current?.sessionId;
  const workspaceId = args["workspace-id"] ?? (sessionId ? undefined : await firstWorkspaceId(base));
  if (!sessionId) {
    const createPayload = agentPreset ? { workspaceId, agentPreset } : { workspaceId };
    const created = await api(base, "session.create", createPayload);
    const value = valueOf(created);
    sessionId = value.sessionId ?? value.id;
    if (!sessionId) throw new Error(`session.create did not return a session id: ${JSON.stringify(created)}`);
  }
  if (args.title) {
    await api(base, "session.rename", { sessionId, title: args.title });
  }
  await api(base, "session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text }],
  });
  if (shouldContinue || !args["session-id"]) {
    writeCurrentSession({
      base,
      sessionId,
      workspaceId: workspaceId ?? current?.workspaceId ?? savedCurrent?.workspaceId,
      agentPreset: agentPreset ?? current?.agentPreset,
      title: args.title ?? current?.title,
    });
  }
  console.log(JSON.stringify({ ok: true, sessionId, workspaceId, agentPreset }, null, 2));
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function watchCommand(args) {
  const base = args.base ?? DEFAULT_BASE;
  const outDir = args.out ?? DEFAULT_OUT;
  const current = args.continue === true || args["use-current"] === true ? readCurrentSession() : undefined;
  const sessionFilter = args["session-id"] ?? current?.sessionId;
  const seconds = Number(args.seconds ?? 30);
  ensureDir(outDir);
  const ndjsonPath = path.join(outDir, "events.ndjson");
  let questionCount = 0;
  const wsUrl = new URL("/api/events.mux", base);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const WebSocketImpl = globalThis.WebSocket ?? (await import("ws")).default;
  await new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(wsUrl);
    const timer = setTimeout(() => {
      socket.close();
      resolve();
    }, Math.max(1, seconds) * 1000);
    socket.addEventListener("open", () => undefined);
    socket.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(event.error ?? new Error("events.mux WebSocket error"));
    });
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("message", (event) => {
      try {
        const data = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
        const envelope = JSON.parse(data);
        const frame = envelope.payload;
        if (sessionFilter && frame?.sessionId !== sessionFilter) return;
        fs.appendFileSync(ndjsonPath, `${JSON.stringify(envelope)}\n`, "utf8");
        if (frame?.type === "question/requested") {
          questionCount++;
          const file = path.join(outDir, `pending-question-${frame.sessionId}-${envelope.rpcId}.json`);
          writeJson(file, {
            rpcId: envelope.rpcId,
            sessionId: frame.sessionId,
            questions: frame.questions,
          });
          console.log(JSON.stringify({
            type: "question/requested",
            rpcId: envelope.rpcId,
            sessionId: frame.sessionId,
            questions: frame.questions,
            savedTo: file,
          }, null, 2));
        } else if (frame?.type === "question/resolved") {
          console.log(JSON.stringify(frame, null, 2));
        } else if (frame?.type === "approval/requested") {
          const file = path.join(outDir, `pending-approval-${frame.sessionId}-${envelope.rpcId}.json`);
          writeJson(file, {
            rpcId: envelope.rpcId,
            sessionId: frame.sessionId,
            approvalId: frame.approvalId,
            toolName: frame.toolName,
            callId: frame.callId,
            reason: frame.reason,
          });
          console.log(JSON.stringify({
            type: "approval/requested",
            rpcId: envelope.rpcId,
            sessionId: frame.sessionId,
            approvalId: frame.approvalId,
            toolName: frame.toolName,
            callId: frame.callId,
            reason: frame.reason,
            savedTo: file,
          }, null, 2));
        } else if (frame?.type === "approval/resolved") {
          console.log(JSON.stringify(frame, null, 2));
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
    });
  });
  console.log(JSON.stringify({ ok: true, questionCount, eventsFile: ndjsonPath }, null, 2));
}

async function answerCommand(args) {
  const base = args.base ?? DEFAULT_BASE;
  const rpcId = args["rpc-id"];
  const sessionId = args["session-id"];
  const answersJson = args["answers-json"];
  if (!rpcId || !sessionId || !answersJson) {
    throw new Error("answer requires --rpc-id, --session-id, and --answers-json.");
  }
  const answers = JSON.parse(answersJson);
  const receipt = await respond(base, rpcId, {
    ok: true,
    value: {
      sessionId,
      answer: { answers },
    },
  });
  console.log(JSON.stringify(receipt, null, 2));
}

async function answerApprovalCommand(args) {
  const base = args.base ?? DEFAULT_BASE;
  const rpcId = args["rpc-id"];
  const sessionId = args["session-id"];
  const approvalId = args["approval-id"];
  const outcome = args.outcome;
  if (!rpcId || !sessionId || !approvalId || !outcome) {
    throw new Error("answer-approval requires --rpc-id, --session-id, --approval-id, and --outcome.");
  }
  if (!["allowed-once", "rejected"].includes(outcome)) {
    throw new Error("answer-approval --outcome must be allowed-once or rejected.");
  }
  const receipt = await respond(base, rpcId, {
    ok: true,
    value: {
      sessionId,
      approvalId,
      outcome,
    },
  });
  console.log(JSON.stringify(receipt, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    usage();
    return;
  }
  if (command === "send") return sendCommand(args);
  if (command === "watch") return watchCommand(args);
  if (command === "answer") return answerCommand(args);
  if (command === "answer-approval") return answerApprovalCommand(args);
  if (command === "current") {
    console.log(JSON.stringify(readCurrentSession() ?? null, null, 2));
    return;
  }
  if (command === "reset-current") {
    if (fs.existsSync(CURRENT_SESSION_FILE)) fs.unlinkSync(CURRENT_SESSION_FILE);
    console.log(JSON.stringify({ ok: true, cleared: CURRENT_SESSION_FILE }, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
