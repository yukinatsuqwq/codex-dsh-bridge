---
name: codex-dsh-bridge
description: Coordinate OpenAI Codex and DeepSeek Harness (DSH) in either direction through visible local tasks. Use when Codex should ask DeepSeek for a review or bounded helper task through the DSH Web UI, when DSH should list/read/fork/continue Codex tasks through the local App Server bridge, when handling live DSH questions or approvals, or when diagnosing the Codex-DSH bridge.
---

# Codex DSH Bridge

Use the bridge to complete concrete work with an explicit audit trail. Do not delegate merely to demonstrate the bridge.

## Select A Direction

### Codex To DSH

Use `scripts/dsh-client.mjs` from this skill directory:

```powershell
node scripts/dsh-client.mjs send --continue --text "Review these files and return the top three risks. Do not modify files."
node scripts/dsh-client.mjs watch --continue --seconds 60
```

Use `--text-file` for long or non-ASCII prompts. Use `--agent-preset cordis` only for DSH plugin-development tasks. Reuse `--continue` when the user wants one visible DSH conversation instead of a new conversation each turn.

Capture `question/requested` and `approval/requested` events with `watch`. Answer only after checking that the requested action matches the user's intent.

### DSH To Codex

Use the persistent DSH tools:

- `codex_threads`: discover candidate Codex tasks.
- `codex_context`: read a bounded snapshot without modifying the task.
- `codex_ask`: submit work to the dedicated bridge task, optionally with selected read-only context.
- `codex_start`: create a desktop-visible Codex task with no inherited history. Prefer this for unrelated new work.
- `codex_fork`: inherit a selected task in a new desktop-visible task. Use only when that history is intentionally required.
- `codex_continue`: write to an existing task only after explicit authorization for that exact task.
- `codex_check`: poll a queued bridge request.
- `codex_respond`: answer a pending Codex interaction with a matching structured result.

For `codex_continue`, require the literal confirmation `WRITE_TO_EXISTING_THREAD` after the user approves the target task.

## Delegation Rules

- Give the other agent a bounded task, exact file paths, expected output, and modification policy.
- Keep secrets, cookies, API keys, OAuth tokens, and private exports out of prompts and logs.
- Treat responses as suggestions until the coordinating agent verifies them.
- Prefer read-only context, independent tasks, or intentional forks over mutating existing tasks.
- Do not claim shared memory. Only explicitly transferred context crosses the bridge.
- Do not assume DeepSeek can read images or operate the computer. Separate verified plugins are required.

## Setup And Troubleshooting

Read [references/bridge-reference.md](references/bridge-reference.md) for installation, configuration, protocol details, platform limits, and recovery steps.
