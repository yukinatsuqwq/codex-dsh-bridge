import path from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalIpc } from "./local-ipc.mjs";

// The desktop DSH plugin loader already accepts this plain tool descriptor.
// Keeping this tiny adapter local avoids depending on DSH's private bundled package.
function defineTool(descriptor) {
  const properties = descriptor.parameters ?? {};
  const required = [];
  for (const [name, schema] of Object.entries(properties)) {
    if (schema.required) {
      required.push(name);
      delete schema.required;
    }
  }
  return {
    ...descriptor,
    parameters: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    },
  };
}

export const name = "codex-appserver-bridge";
export const inject = ["tools", "subprocess", "sessionController", "sessions"];

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeDir = path.resolve(here, "..");
const workspace = path.resolve(bridgeDir, "..");
const manager = path.join(bridgeDir, "manage-controller.mjs");
const baseUrl = process.env.CODEX_BRIDGE_URL ?? process.env.CODEX_APP_SERVER_URL ?? "http://127.0.0.1:32123";
let controllerStart;

export function apply(ctx) {
  ctx.effect(() => {
    let disposed = false;
    let cleanup;
    const starting = (async () => {
      try {
        const dispose = await startLocalIpc(ctx);
        if (disposed) dispose();
        else cleanup = dispose;
      } catch (error) {
        ctx.logger.warn(`Codex local IPC unavailable: ${error.message}`);
      }
    })();
    return async () => { disposed = true; cleanup?.(); await starting; };
  });
  ctx.tools.register(makeTool({
    name: "codex_ask",
    description: "Send a concrete task to the persistent Codex bridge task. Returns a request id immediately; use codex_check until it completes.",
    parameters: {
      text: {
        type: "string",
        required: true,
        description: "The complete task or question for Codex.",
      },
      context_thread_id: {
        type: "string",
        description: "Optional existing Codex thread id to include as read-only context. The answer still goes to the dedicated bridge thread.",
      },
    },
    execute: async ({ text, context_thread_id }) => {
      await ensureController(ctx);
      return request("/v1/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, contextThreadId: context_thread_id || undefined }),
      });
    },
  }));

  ctx.tools.register(makeTool({
    name: "codex_threads",
    description: "List recent Codex tasks that can be selected as a read-only context source or explicit fork source.",
    parameters: {
      limit: { type: "number", description: "Number of tasks to return, from 1 to 50." },
      search: { type: "string", description: "Optional case-sensitive title fragment." },
    },
    execute: async ({ limit, search }) => {
      await ensureController(ctx);
      const query = new URLSearchParams();
      if (limit !== undefined) query.set("limit", String(Math.max(1, Math.min(50, Math.trunc(limit)))));
      if (search) query.set("search", search);
      return request(`/v1/threads${query.size ? `?${query}` : ""}`);
    },
  }));

  ctx.tools.register(makeTool({
    name: "codex_context",
    description: "Read a bounded snapshot of an explicitly selected Codex task without resuming or modifying it.",
    parameters: {
      thread_id: { type: "string", required: true, description: "The selected Codex thread id." },
      max_turns: { type: "number", description: "Recent turns to include, from 1 to 20; defaults to 8." },
    },
    execute: async ({ thread_id, max_turns }) => {
      await ensureController(ctx);
      const turns = max_turns === undefined ? 8 : Math.max(1, Math.min(20, Math.trunc(max_turns)));
      return request(`/v1/threads/${encodeURIComponent(thread_id)}/context?maxTurns=${turns}`);
    },
  }));

  ctx.tools.register(makeTool({
    name: "codex_start",
    description: "Create a completely independent Codex task with no inherited conversation history, then run a prompt in it. Use this for a genuinely new task; use codex_fork only when inherited context is intentional.",
    parameters: {
      text: { type: "string", required: true, description: "The complete task to run in the independent Codex thread." },
      name: { type: "string", description: "Optional title for the new Codex task." },
    },
    execute: async ({ text, name: taskName }) => {
      await ensureController(ctx);
      return request("/v1/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, name: taskName || undefined }),
      });
    },
  }));

  ctx.tools.register(makeTool({
    name: "codex_fork",
    description: "Create a Codex task that intentionally inherits an explicitly selected task's history, then run a prompt in the fork. Do not use this for an unrelated new task; use codex_start instead.",
    parameters: {
      thread_id: { type: "string", required: true, description: "The source Codex thread id." },
      text: { type: "string", required: true, description: "The task to run in the new fork." },
      name: { type: "string", description: "Optional title for the new Codex task." },
    },
    execute: async ({ thread_id, text, name: forkName }) => {
      await ensureController(ctx);
      return request("/v1/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread_id, text, name: forkName || undefined }),
      });
    },
  }));

  ctx.tools.register(makeTool({
    name: "codex_continue",
    description: "Write directly into an existing Codex task. Use only after the user explicitly authorizes that exact target thread; otherwise use codex_fork.",
    parameters: {
      thread_id: { type: "string", required: true, description: "The existing Codex thread id to modify." },
      text: { type: "string", required: true, description: "The message to append to that task." },
      confirmation: { type: "string", required: true, description: "Must be exactly WRITE_TO_EXISTING_THREAD after explicit user authorization." },
    },
    execute: async ({ thread_id, text, confirmation }) => {
      if (confirmation !== "WRITE_TO_EXISTING_THREAD") throw new Error("explicit user confirmation is required");
      await ensureController(ctx);
      return request("/v1/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: thread_id, text, confirmation }),
      });
    },
  }));

  ctx.tools.register(makeTool({
    name: "codex_check",
    description: "Check a Codex bridge request and return its queued, running, completed, or failed state.",
    parameters: {
      request_id: {
        type: "string",
        required: true,
        description: "The requestId returned by codex_ask.",
      },
    },
    execute: ({ request_id }) => request(`/v1/requests/${encodeURIComponent(request_id)}`, {}, 5_000),
  }));

  ctx.tools.register(makeTool({
    name: "codex_respond",
    description: "Respond to a pending Codex App Server question or approval interaction.",
    parameters: {
      rpc_id: {
        type: "string",
        required: true,
        description: "The rpc id exposed in pendingInteraction.",
      },
      result_json: {
        type: "string",
        required: true,
        description: "A JSON object containing the App Server interaction result.",
      },
    },
    execute: ({ rpc_id, result_json }) => {
      let result;
      try {
        result = JSON.parse(result_json);
      } catch {
        throw new Error("result_json must be valid JSON");
      }
      if (!isPlainObject(result)) throw new Error("result_json must contain a JSON object");
      return request(`/v1/interactions/${encodeURIComponent(rpc_id)}/respond`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result }),
      });
    },
  }));
}

function makeTool({ name: toolName, description, parameters, execute }) {
  return defineTool({
    name: toolName,
    description,
    parameters,
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    },
    execute,
  });
}

async function ensureController(ctx) {
  try {
    const health = await request("/health", {}, 2_000);
    if (health.ready) return;
  } catch {
    // Start once below, then wait for the health endpoint.
  }

  if (!controllerStart) {
    controllerStart = startController(ctx).finally(() => {
      controllerStart = undefined;
    });
  }
  return controllerStart;
}

async function startController(ctx) {
  const subprocess = ctx.get("subprocess");
  if (!subprocess) throw new Error("DSH subprocess service is unavailable");
  let node;
  try {
    node = await subprocess.resolveExecutable("node");
  } catch {}
  node ||= process.execPath;
  if (!node) throw new Error("Node.js executable was not found; install Node.js 22+ or configure DSH's runtime");
  const handle = subprocess.spawn({
    argv: [node, manager, "start"],
    cwd: workspace,
    stdio: {
      stdin: "ignore",
      stdout: { maxBytes: 64 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 2_000,
  });
  let startError;
  handle.done.then((outcome) => {
    if (outcome.exitCode !== 0) {
      const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
      startError = new Error(`could not start Codex bridge controller: ${stderr.trim() || `exit ${outcome.exitCode}`}`);
    }
  }, (error) => {
    startError = error;
  });

  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const health = await request("/health", {}, 2_000);
      if (health.ready) return;
    } catch (error) {
      lastError = error;
    }
    if (startError) throw startError;
  }
  throw new Error(`Codex bridge controller did not become healthy: ${lastError?.message ?? "timeout"}`);
}

async function request(pathname, init = {}, timeoutMs = 120_000) {
  let response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error?.name === "TimeoutError" || error?.name === "AbortError"
      ? `timed out after ${timeoutMs}ms`
      : error?.message ?? String(error);
    throw new Error(`Codex bridge controller is offline or unreachable at ${baseUrl}: ${reason}`, { cause: error });
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Codex bridge returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  if (!response.ok) {
    const detail = typeof body === "object" && body?.error ? body.error : text;
    throw new Error(`Codex bridge HTTP ${response.status}: ${detail || response.statusText}`);
  }
  if (!isPlainObject(body)) throw new Error(`Codex bridge returned an invalid HTTP ${response.status} body`);
  return body;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
