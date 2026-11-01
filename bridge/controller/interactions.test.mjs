import test from "node:test";
import assert from "node:assert/strict";
import { InteractionRegistry } from "../dsh-plugin/interactions.mjs";

const request = (signal) => ({ agent: { session: { id: "owned" } }, signal, questions: [{ id: "q", question: "Continue?", options: [{ label: "Yes" }, { label: "No" }] }], toolName: "synthetic-test", reason: "No real action" });
const registry = (timeoutMs = 1000) => new InteractionRegistry({ owns: id => id === "owned", timeoutMs });

test("unowned sessions pass through and never enter the pending registry", async () => {
  const r = registry();
  assert.equal(await r.handle("approval", { agent: { session: { id: "private" } } }, () => "desktop"), "desktop");
  assert.deepEqual(r.list("private"), []);
});

test("questions require exact session, kind, ids and option labels; answers are one-shot", async () => {
  const r = registry();
  const wait = r.handle("question", request(), () => assert.fail());
  const [{ rpcId }] = r.list("owned");
  const response = { rpcId, sessionId: "owned", kind: "question", answers: [{ id: "q", selected: ["Yes"] }] };
  assert.throws(() => r.respond({ ...response, sessionId: "private" }), /does not match/);
  assert.throws(() => r.respond({ ...response, kind: "approval" }), /does not match/);
  assert.throws(() => r.respond({ ...response, answers: [{ id: "q", selected: ["Forged"] }] }), /Invalid/);
  r.respond(response);
  assert.deepEqual(await wait, { answers: [{ id: "q", selected: ["Yes"] }] });
  assert.throws(() => r.respond(response), /does not match/);
});

test("approval grant requires per-request confirmation and never grants permanently", async () => {
  const r = registry();
  const wait = r.handle("approval", request(), () => assert.fail());
  const [{ rpcId }] = r.list("owned");
  const response = { rpcId, sessionId: "owned", kind: "approval", outcome: "allowed-once" };
  assert.throws(() => r.respond(response), /confirmation/);
  assert.throws(() => r.respond({ ...response, outcome: "always" }), /Outcome/);
  r.respond({ ...response, confirmation: `ALLOW_ONCE:${rpcId}` });
  assert.equal(await wait, "allowed-once");
});

test("timeout rejects approval; abort and unload clear pending interactions", async () => {
  const r = registry(10);
  assert.equal(await r.handle("approval", request(), () => assert.fail()), "rejected");
  const abort = new AbortController();
  const wait = assert.rejects(r.handle("question", request(abort.signal), () => assert.fail()), /cancelled/);
  abort.abort();
  await wait;
  const approval = r.handle("approval", request(), () => assert.fail());
  r.cancel();
  assert.equal(await approval, "cancelled");
  assert.deepEqual(r.list("owned"), []);
});
