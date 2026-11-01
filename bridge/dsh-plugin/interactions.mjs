import crypto from "node:crypto";

export class InteractionRegistry {
  constructor({ owns, timeoutMs = 120000 }) {
    this.owns = owns;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
  }

  handle(kind, request, next) {
    const sessionId = request.agent?.session?.id;
    if (!sessionId || !this.owns(sessionId, request.agent)) return next();
    if (request.signal?.aborted) return kind === "approval" ? Promise.resolve("cancelled") : Promise.reject(new Error("Question cancelled"));
    const rpcId = crypto.randomUUID();
    // Serialize only explicit UI fields; never serialize Agent, context or signal.
    const view = kind === "question"
      ? { questions: request.questions.map(q => ({ id: q.id, header: q.header, question: q.question, multiSelect: q.multiSelect, options: q.options?.map(o => ({ label: o.label, description: o.description })), detail: q.detail, intent: q.intent })) }
      : { toolName: request.toolName, callId: request.callId, reason: request.reason };
    if (Buffer.byteLength(JSON.stringify(view)) > 32000) return kind === "approval" ? Promise.resolve("rejected") : Promise.reject(new Error("Question payload too large"));
    return new Promise((resolve, reject) => {
      const finish = (value, error) => {
        if (!this.pending.delete(rpcId)) return;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(kind === "approval" ? "cancelled" : undefined, kind === "question" ? new Error("Question cancelled") : undefined);
      const abort = () => cancel();
      const timer = setTimeout(() => finish(kind === "approval" ? "rejected" : undefined,
        kind === "question" ? Object.assign(new Error("Question timed out"), { code: "ASK_TIMED_OUT" }) : undefined), this.timeoutMs);
      this.pending.set(rpcId, { view: { rpcId, sessionId, kind, expiresAt: new Date(Date.now() + this.timeoutMs).toISOString(), ...view }, finish, cancel });
      request.signal?.addEventListener("abort", abort, { once: true });
      if (request.signal?.aborted) abort();
    });
  }

  list(sessionId) {
    return [...this.pending.values()].filter(p => p.view.sessionId === sessionId).map(p => p.view);
  }

  respond({ sessionId, rpcId, kind, answers, outcome, confirmation }) {
    const entry = this.pending.get(rpcId);
    if (!entry || entry.view.sessionId !== sessionId || entry.view.kind !== kind) throw new Error("Pending interaction does not match this session and kind");
    if (kind === "approval") {
      if (!["allowed-once", "rejected"].includes(outcome)) throw new Error("Outcome must be allowed-once or rejected");
      if (outcome === "allowed-once" && confirmation !== `ALLOW_ONCE:${rpcId}`) throw new Error("Explicit per-request ALLOW_ONCE confirmation is required");
      entry.finish(outcome);
    } else {
      const questions = entry.view.questions;
      if (!Array.isArray(answers) || answers.length !== questions.length || new Set(answers.map(a => a?.id)).size !== questions.length) throw new Error("Answer each question exactly once");
      for (const answer of answers) {
        const question = questions.find(q => q.id === answer?.id);
        if (!question || !Array.isArray(answer.selected) || answer.selected.some(s => typeof s !== "string" || !question.options?.some(o => o.label === s)) || new Set(answer.selected).size !== answer.selected.length || (!question.multiSelect && answer.selected.length > 1) || (answer.custom !== undefined && typeof answer.custom !== "string") || (!answer.selected.length && !answer.custom?.trim())) throw new Error("Invalid question answer");
      }
      entry.finish({ answers: answers.map(a => ({ id: a.id, selected: a.selected, ...(a.custom === undefined ? {} : { custom: a.custom }) })) });
    }
    return { responded: true, rpcId };
  }

  cancel(sessionId) {
    for (const entry of [...this.pending.values()]) if (sessionId === undefined || entry.view.sessionId === sessionId) entry.cancel();
  }
}
