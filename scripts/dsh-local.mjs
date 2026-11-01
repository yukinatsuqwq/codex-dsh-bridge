#!/usr/bin/env node
import { callLocalIpc } from "../bridge/dsh-plugin/local-ipc.mjs";

const [method, ...argv] = process.argv.slice(2);
if (!method || method === "--help") {
  console.log(`Usage:
  node scripts/dsh-local.mjs health
  node scripts/dsh-local.mjs create --cwd /absolute/workspace --title "Bridge test"
  node scripts/dsh-local.mjs prompt --session-id id --text "Read-only task"
  node scripts/dsh-local.mjs snapshot --session-id id
  node scripts/dsh-local.mjs cancel --session-id id
  node scripts/dsh-local.mjs pending --session-id id
  node scripts/dsh-local.mjs answer --session-id id --rpc-id id --answers-json '[{"id":"q","selected":["Yes"]}]'
  node scripts/dsh-local.mjs answer-approval --session-id id --rpc-id id --outcome rejected

macOS, Linux, and Windows. Requires the running DSH Desktop plugin.
Only sessions created by this plugin Host are accessible; restarting DSH resets ownership.
Create defaults to Desktop interaction handling. Pass --interactions ipc on create to route questions and approvals to pending.
An allowed-once outcome additionally requires --confirmation ALLOW_ONCE:<rpc-id> after explicit user authorization.
Snapshot is a bounded text result, not a full event stream.`);
  process.exit(0);
}
const args = {};
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith("--") || !argv[i + 1]) throw new Error("Expected --option value");
  args[argv[i].slice(2)] = argv[i + 1];
}
try {
  console.log(JSON.stringify(await callLocalIpc({ method, cwd: args.cwd, title: args.title, sessionId: args["session-id"], text: args.text, interactions: args.interactions, rpcId: args["rpc-id"], answers: args["answers-json"] ? JSON.parse(args["answers-json"]) : undefined, outcome: args.outcome, confirmation: args.confirmation }), null, 2));
} catch (error) {
  console.error(`DSH local bridge: ${error.message}`);
  process.exitCode = 1;
}
