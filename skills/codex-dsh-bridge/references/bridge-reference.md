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

On the verified Windows path, clone the repository and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Target Both
```

`Codex` installs the skill under `${CODEX_HOME:-~/.codex}/skills`. `DSH` installs it under `~/.agents/skills`. `Both` installs both copies. The installer backs up an existing skill before replacement.

Unless `-SkipDshPlugin` is used, the installer also backs up and updates `~/.dsh/profiles/web/cordis.patch.yml` with a `file://` entry for `bridge/dsh-plugin/index.mjs`.

Restart Codex and DSH after installation. Start the controller with `bridge/manage-controller.ps1 start`, or let the DSH plugin start it on first use.

## Codex To DSH Protocol

`dsh-client.mjs` sends UTF-8 JSON envelopes to DSH:

- `send`: create or prompt a session;
- `watch`: listen to `/api/events.mux` and save pending questions/approvals;
- `answer`: answer a DSH question through `/api/respond`;
- `answer-approval`: allow once or reject a DSH approval request;
- `current` and `reset-current`: inspect or clear the reusable session pointer.

The default DSH URL is `http://127.0.0.1:3080`. The reusable pointer defaults to `.tmp/dsh-bridge/current-session.json` and may be overridden with `DSH_BRIDGE_STATE_FILE`.

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
- Prefer `codex_start` for unrelated work and fork only when inherited history is needed. Continuing an existing task requires `WRITE_TO_EXISTING_THREAD`.
- Active tasks are rejected to reduce collisions with live desktop work.
- Do not forward credentials or broad private histories.

## Platform Limitations

- Windows 11 is the only verified platform for this release.
- `install-windows.ps1`, `manage-controller.ps1`, and DSH plugin auto-start use PowerShell.
- The JavaScript controller and DSH client are intended to be portable, but macOS/Linux process management and plugin loading have not been tested.
- DSH is a developer preview. Web API, Cordis, and plugin contracts may change.
- The bridge does not add vision, computer use, browser control, email, scheduling, or multimodal support.
- Codex desktop and App Server can briefly contend for the same task writer during an active bridge call.

## Recovery

1. Run `node scripts/doctor.mjs` from the repository.
2. Confirm DSH Web responds on port `3080`.
3. Run `bridge/manage-controller.ps1 status`, then `restart` if needed.
4. Confirm the DSH profile patch still points to the cloned repository's `bridge/dsh-plugin/index.mjs`.
5. If a task remains “open elsewhere” after a bridge request is complete, stop the controller, verify no `codex app-server` child remains, and retry from the desktop application.
6. If DSH loses the tools after an upgrade, inspect the DSH/Cordis compatibility before rewriting user state.
