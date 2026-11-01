# Windows rc.5 changes: macOS regression

Input: `codex-dsh-bridge-v0.2.1-rc5-verified.zip`, commit
`a792532e952a3dd09bc743787a93ad2ce1ffdd5d`. The archive's commit matches
the repository main head checked before publishing this follow-up.

Environment: macOS arm64, DSH Desktop 0.2.1-rc.5, bundled Node 24.22.1.
The archive was extracted into a separate review directory. The previous Mac
working tree and original ZIP were preserved. Desktop's local plugin link was
updated to the review directory using `dsh plugin --profile desktop add`.

## Reproduced and fixed

`bridge/controller/local-ipc.test.mjs` created its Unix socket beneath the
checkout directory. The absolute address in this review exceeded macOS's
sockaddr_un path capacity, causing `listen EINVAL`. First run: 11 passed,
1 failed. The test now uses `/tmp/dsh-ipc-test-*` on Unix; Windows still uses
its existing directory and Named Pipe. No runtime Windows logic was modified.

After the fix: 12 tests passed, no failures or skips on macOS. All 18 JavaScript
modules passed `node --check`; package JSON parsed successfully.

## Live Desktop checks

- IPC health: service codex-dsh-local, protocolVersion 1, ok true.
- Created a fresh session titled RC5 Mac 回归 1102 in the public source directory.
- ask_user_question emitted a PASS/FAIL question; IPC answered PASS and snapshot
  returned PASS with completed status.
- New Controller started successfully and created its dedicated empty Codex task.
- DSH called codex_context only on that task: ok true, returnedTurns 0,
  truncated false, no cwd field in the response.
- Controller stopped successfully; codex_check returned offline/unreachable
  immediately according to the test session. The completed snapshot confirmed
  the error and that the tool did not restart Controller.

No private sessions, browser credentials or launch tokens were read. Existing
unrelated DSH plugins emitted compatibility warnings during installation; no
exemption or security-policy change was made for those plugins.

## Limits

This run does not independently verify Windows: its existing real-machine
record remains in WINDOWS-IPC-VERIFICATION.md. macOS Intel and Linux are still
unverified. Web client HTTP 401 behavior remains an acknowledged limitation.
Question handling was re-tested live; permission grants were not repeated in
this follow-up because their implementation did not change in this patch.
