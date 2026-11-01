# Bridge Reference

## Contents

- Architecture
- Installation
- Codex to DSH protocol
- DSH to Codex protocol
- Permissions and privacy
- Platform limitations
- Recovery

## Architecture

The bridge has two independent directions:

1. `scripts/dsh-client.mjs` calls the local DSH Web API. DSH sessions remain visible in the Web UI.
2. The DSH Cordis plugin calls a loopback HTTP controller. The controller starts Codex App Server over stdio for one serialized operation and then releases it.

The bridge stores only identifiers and bounded request state. It does not merge hidden model state.

## Installation

On macOS, Linux, or Windows with Node.js 22+, clone the repository and run:

```sh
node scripts/install.mjs --target Both
npm run controller:start
```

The Windows-specific installer remains available on the verified Windows path:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Target Both
```

`Codex` installs the skill under `${CODEX_HOME:-~/.codex}/skills`. `DSH` installs it under `~/.agents/skills`. `Both` installs both copies. The installer backs up an existing skill before replacement.

Unless `-SkipDshPlugin` is used, the installer also backs up and updates `~/.dsh/profiles/web/cordis.patch.yml` with a `file://` entry for `bridge/dsh-plugin/index.mjs`.

Restart Codex and DSH after installation. Start the controller with `npm run controller:start`, or let the DSH plugin call the cross-platform Node.js manager on first use.

DSH Desktop owns a separate `desktop` profile. Fully quit Desktop, run `dsh plugin --profile desktop add /absolute/path/to/codex-dsh-bridge`, and reopen it. Desktop uses authenticated OS-assigned loopback ports, so the Codex-to-DSH HTTP client still requires the separate Web profile on port `3080`; the DSH-to-Codex plugin can run in either profile.

## Codex To DSH Protocol

`dsh-client.mjs` sends UTF-8 JSON envelopes to DSH:

- `send`: create or prompt a session;
- `watch`: listen to `/api/events.mux` and save pending questions/approvals;
- `answer`: answer a DSH question through `/api/respond`;
- `answer-approval`: allow once or reject a DSH approval request;
- `current` and `reset-current`: inspect or clear the reusable session pointer.

The default DSH URL is `http://127.0.0.1:3080` and may be overridden with `DSH_BASE_URL` or `--base`. The reusable pointer defaults to `.tmp/dsh-bridge/current-session.json` and may be overridden with `DSH_BRIDGE_STATE_FILE`.

DSH `0.2.1-rc.5` requires an authenticated browser session for this API. The client does not read or persist launch tokens or cookies and therefore returns an explicit HTTP 401 compatibility error on that release. Web reachability alone is not a completed Codex-to-DSH loop.

## DSH To Codex Protocol

The controller exposes these loopback routes:

- `GET /health`
- `GET /v1/thread`
- `GET /v1/threads`
- `GET /v1/threads/:threadId/context`
- `POST /v1/ask`
- `POST /v1/fork`
- `POST /v1/continue`
- `GET /v1/requests/:requestId`
- `POST /v1/interactions/:rpcId/respond`

The controller creates one dedicated Codex bridge task on first run. It persists that task ID in `bridge/runtime/state.json`. Runtime files must never be committed.

Requests are serialized. Each operation starts App Server, loads the relevant task, performs the call, stops App Server, and only then marks the request complete. This prevents a stale writer from blocking the desktop application while idle.

## Permissions And Privacy

- Bind only to loopback. The controller has no user authentication.
- The dedicated bridge task starts with read-only sandboxing and approval policy `never`.
- Reading another task is bounded to recent turns and 30,000 characters.
- Returned task metadata omits the local working-directory path.
- Prefer `codex_start` for unrelated work and fork only when inherited history is needed. Continuing an existing task requires `WRITE_TO_EXISTING_THREAD`.
- Active tasks are rejected to reduce collisions with live desktop work.
- Do not forward credentials or broad private histories.

## Platform Limitations

- Windows 11 is the only end-to-end verified platform for this release.
- `scripts/install.mjs` and `bridge/manage-controller.mjs` provide cross-platform installation and process management. The older PowerShell entry points remain for compatibility.
- macOS/Linux DSH plugin loading and the complete bidirectional loop still require real-machine verification.
- DSH is a developer preview. Web API, Cordis, and plugin contracts may change.
- The bridge does not add vision, computer use, browser control, email, scheduling, or multimodal support.
- Codex desktop and App Server can briefly contend for the same task writer during an active bridge call.

## Recovery

1. Run `node scripts/doctor.mjs` from the repository.
2. Confirm DSH Web responds on port `3080`.
3. Run `npm run controller:status`, then `npm run controller:restart` if needed.
4. Confirm the DSH profile patch still points to the cloned repository's `bridge/dsh-plugin/index.mjs`.
5. If a task remains “open elsewhere” after a bridge request is complete, stop the controller, verify no `codex app-server` child remains, and retry from the desktop application.
6. If DSH loses the tools after an upgrade, inspect the DSH/Cordis compatibility before rewriting user state.
