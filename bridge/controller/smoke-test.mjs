#!/usr/bin/env node
const base = process.env.CODEX_BRIDGE_URL ?? "http://127.0.0.1:32123";
const prompt = process.argv.slice(2).join(" ") || "Reply with exactly: DSH_CODEX_BRIDGE_READY";

const created = await request("/v1/ask", { text: prompt });
console.log(`requestId=${created.requestId} threadId=${created.threadId}`);

for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const response = await fetch(`${base}/v1/requests/${created.requestId}`);
  const item = await response.json();
  if (item.status === "completed") {
    console.log(item.answer);
    break;
  }
  if (item.status === "failed") {
    console.error(item.error ?? item.turnError ?? "Bridge request failed");
    process.exit(1);
  }
}

async function request(route, body) {
  const response = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
