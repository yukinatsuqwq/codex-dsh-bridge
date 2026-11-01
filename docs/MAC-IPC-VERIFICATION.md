# macOS IPC verification — 2026-11-01

## Final local checks

All 11 tests passed again; all 18 JavaScript modules passed syntax checks.
Package JSON, diff whitespace, unchanged Windows scripts, and identical root /
skill Web client copies were checked. Real cancellation passed: the pending
question was present before cancel, cancel acknowledged, pending became empty,
and Desktop showed ASK_ABORTED. A subsequent prompt completed normally.
Controller was stopped and a real codex_check returned offline/unreachable.
Normal Desktop exit removed its socket (socketExistsAfterExit=false).
After restart, health passed and the previous session snapshot was refused as
not owned by this Host. Controller remains stopped; Desktop IPC is running.

Unverified boundaries: Windows and Intel real machines, Linux, abrupt-crash
recovery and Windows Named Pipe transport. Stale endpoints fail closed rather
than being automatically deleted. Runtime identity checks do not protect
against other malicious programs running under the same OS account.

## Interaction update

### Real approval test (2026-11-01, macOS arm64)

Real DSH bash authorization was exercised using only `/usr/bin/true`, with no
file reads/writes and no changes to permission policy. Two independent prompts
explicitly requested `danger-full-access` to trigger the normal approval seam.

1. Reject branch: pending returned a real approval bound to the owned session,
   bash tool and callId. IPC answered rejected. Desktop showed a failed tool
   call and the assistant stopped without retrying.
2. Allow-once branch: Desktop trajectory confirmed the exact command was
   `/usr/bin/true` before approval. IPC answered allowed-once with the exact
   request confirmation. Desktop's tool detail showed completed / no output;
   the assistant reported exit code 0. Snapshot returned completed.
3. Pending was empty after settlement. Reusing the consumed request ID was
   rejected with `Pending interaction does not match this session and kind`.

This verifies the real approval waterfall in both branches for a no-op command;
it does not authorize arbitrary future grants. The pending payload contains the
tool identity and justification, not full tool arguments. Always inspect the
actual matching tool call in Desktop before granting; justification alone is
not proof of what a tool will execute. No long-term policy was changed.

Implemented owned-session `pending`, `answer` and `answer-approval` over IPC.
Default interaction handling remains Desktop; opt in with `--interactions ipc`
on create. The adapter uses DSH's `user-questions/request` and `approval/request`
waterfalls with prepend listeners, forwarding all unowned/default sessions to
the existing handlers. It does not modify DSH approval policy.

Real-machine question test passed: ask_user_question emitted `bridge_test` with
PASS/FAIL, pending exposed the exact question, answer returned responded=true,
snapshot returned PASS/completed, and pending became empty. No files or real
approval actions were involved. One-time grant/reject and timeout/abort/unload
semantics passed synthetic tests; real permission requests subsequently passed
the explicit no-op test documented above.

The approval service became available again: all 11 tests, including the socket
integration test, now pass outside the restricted execution context. Earlier
approval-limit notes below describe historical results, not the current blocker.

Experimental local changes; no commit, push or PR. Windows testing is excluded
from this round at the user's request. The existing Windows paths remain.

## Implemented

`bridge/dsh-plugin/local-ipc.mjs` calls the installed DSH Host's
`sessionController.create`, `rename`, `prompt` and `cancel` methods directly.
The current installed runtime was inspected as application source only; no
credentials, browser storage or private conversation files were read.

The plugin injects `sessionController` and `sessions`, starts the socket through
a scoped Cordis effect, and disposes connections and the listener on unload.
`scripts/dsh-local.mjs --help` describes the native client. The authenticated
legacy Web transport remains separate and still returns HTTP 401.

## Observed on the installed DSH Desktop 0.2.1-rc.5 / macOS arm64

- IPC health: `ok: true`, service `codex-dsh-local`, protocol version 1.
- Create: a new isolated session titled `Codex IPC 兼容性测试 1101` succeeded.
- Prompt: a fixed no-tools message was accepted.
- Snapshot: returned `MAC_IPC_OK` with status `completed`.
- Computer Use: the same session and reply were visible under Desktop's
  ungrouped sessions.
- A second prompt through IPC requested only `codex_context` on the dedicated
  empty Codex task. Desktop displayed success, returnedTurns 0, truncated false,
  and no cwd field. No private task was used.

These observations establish a minimal native Codex → DSH → Codex read-only
tool loop. They do not establish complete question/approval/cancellation behavior.

## Remaining verification

- Historical automatic test suite result: 6 of 7 tests passed in the restricted execution context.
  The socket integration test failed at listen with EPERM. Its retry outside
  that context was not executed: the automatic approval service reported a usage
  limit and could not finish its review. This is an infrastructure blocker, not
  a passing result or an unsafe-action determination.
- Final bounds/busy-state changes after Desktop verification have syntax checks
  only; restart Desktop and repeat IPC regression when approvals work again.
- Questions and approvals default to Desktop; opt-in IPC handling passed the
  question and no-op permission tests documented above. No automatic grants.
- Cancellation, unload/reload, crash/stale-socket recovery and Controller offline
  behavior need fresh real-machine regression after the latest changes.
- Intel macOS and Linux are unverified; Windows is deliberately deferred.
- Run `npm test`, `npm run check`, `npm run check:ipc`, and `git diff --check`.

No secrets were used for the native IPC checks. No GitHub changes were made.
Do not describe this as a fully verified release.
