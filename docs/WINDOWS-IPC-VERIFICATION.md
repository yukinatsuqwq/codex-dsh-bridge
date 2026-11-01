# Windows IPC verification — 2026-11-01

Environment: Windows 11, Node `24.22.1`, Codex CLI `0.166.0-alpha.5.1`, DSH
Desktop `0.2.1-rc.2`.

## Passed

- All JavaScript files passed `node --check`.
- Controller start, HTTP 200 health, stop and offline recovery passed on the
  real Windows host.
- The legacy PowerShell entry point now delegates to the PID- and health-aware
  Node manager. Its start, status, stop and final offline sequence passed; it no
  longer kills an arbitrary process merely because it owns the configured port.
- The cross-platform installer passed first install, repeat install, backup and
  idempotent DSH patch checks in paths containing spaces and Chinese characters.
- Missing Codex executables fail cleanly and release pending state.
- Windows Codex launch no longer uses `shell: true`. `.exe` and PATH resolution
  execute directly; explicitly configured `.cmd`/`.bat` wrappers use a fixed
  `cmd.exe` invocation and reject shell metacharacters in the configured path.
- Windows Named Pipe create, health, owned-session enforcement, prompt, bounded
  assistant snapshot and cleanup passed with a synthetic DSH Host.
- Every Windows pipe request requires a fresh random token. A request with an
  incorrect token was rejected. The token descriptor directory has inherited
  ACLs removed and grants access only to the current user and SYSTEM.
- Test result: 11 passed, 0 failed, 1 Unix-only mode test skipped.

## Not yet claimed

- A live DSH Desktop round trip on Windows is not claimed. The available Windows
  Desktop was `0.2.1-rc.2`, while the macOS live verification used
  `0.2.1-rc.5`; plugin contracts are still preview APIs.
- The old Web client remains intentionally unauthenticated and may receive HTTP
  401 from newer DSH Web builds. It does not read browser cookies or launch tokens.
- Endpoint security quarantined `bridge/manage-controller.ps1` during testing;
  the user restored it. The Node manager was fully exercised. No security product
  was disabled and no allowlist or system-security setting was changed.
- Intel macOS, Linux and forced-crash stale-endpoint recovery remain unverified.

No secrets, private conversation exports or runtime state are part of this report.
