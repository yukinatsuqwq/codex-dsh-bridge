# Codex DSH Bridge

[中文说明](README.zh-CN.md)

Experimental Desktop transport: after installing the plugin and restarting
DSH, run `node scripts/dsh-local.mjs --help` from this repository. The local IPC
creates isolated sessions, sends text and returns bounded results without browser
credentials. Questions and approvals default to Desktop; create with
`--interactions ipc` to use pending/answer/answer-approval. A one-time grant
requires explicit user authorization and the matching per-request confirmation.
See the
[macOS](docs/MAC-IPC-VERIFICATION.md) and
[Windows](docs/WINDOWS-IPC-VERIFICATION.md) verification records for outstanding regressions.

A local, visible, bidirectional bridge between OpenAI Codex and DeepSeek Harness (DSH).

- **Codex to DSH:** Codex creates or continues a visible DSH Web UI session, watches questions and approvals, and reads the result.
- **DSH to Codex:** a persistent DSH plugin calls a loopback controller, which uses Codex App Server to create, inspect, fork, or explicitly continue desktop-visible Codex tasks.
- **One skill for both sides:** the Agent Skill in `skills/codex-dsh-bridge/` can be installed for Codex and for DSH-compatible skill discovery.

This project coordinates two agent harnesses. It does not replace either model API or merge their private memory.

## Status

Experimental. The controller and DSH-to-Codex path were verified on Windows 11. Native Desktop IPC was verified on macOS arm64 and its authenticated Windows Named Pipe transport passed Windows unit and lifecycle tests. A live Windows Desktop round trip still requires a DSH Desktop version compatible with the macOS-tested `0.2.1-rc.5`; the available Windows host during verification was `0.2.1-rc.2`. DSH remains in developer preview and may introduce compatibility-breaking changes.

## Architecture

```text
Codex -> scripts/dsh-client.mjs -> DSH Web API :3080 -> visible DSH session

DSH -> persistent Cordis plugin -> HTTP 127.0.0.1:32123
    -> local controller -> Codex App Server over stdio
    -> desktop-visible Codex task
```

## Requirements

- Node.js 22 or newer
- DeepSeek Harness Web UI (`npx @deepseek-ai/dsh web`)
- Codex CLI available as `codex` or configured with `CODEX_BRIDGE_EXECUTABLE`
- An authenticated local Codex installation
- PowerShell 5.1 or newer for the verified Windows installer and auto-start path

On macOS, make sure `node` and `codex` are available to non-interactive processes, not only to an interactive shell. The controller uses loopback ports `32123` and `3080`; local firewall or endpoint-security software must allow loopback traffic. Both Apple Silicon and Intel use the same JavaScript entry points, but neither architecture has completed end-to-end verification yet.

## macOS/Linux Installation

```sh
git clone https://github.com/yukinatsuqwq/codex-dsh-bridge.git
cd codex-dsh-bridge
node scripts/install.mjs --target Both
```

The installer backs up existing skill and DSH patch files before replacing or extending them. Restart Codex and DSH Web after installation. Start or inspect the controller with the cross-platform manager:

```sh
npm run controller:start
npm run controller:status
npm run doctor
```

The first controller start creates `bridge/runtime/state.json` and may create a dedicated Codex bridge task. It is not a zero-write health check. Logs are written to `bridge/runtime/controller.log`.

### DSH Desktop

DSH Desktop owns a separate `desktop` profile and does not load the `web` profile patch. Fully quit DSH Desktop, install this repository with Desktop's bundled or registered `dsh` command, and reopen the application:

```sh
dsh plugin --profile desktop add /absolute/path/to/codex-dsh-bridge
```

Use the repository's absolute path; do not copy authentication tokens from Desktop's private loopback URLs. The plugin uses DSH's own Node runtime when a system `node` executable is unavailable. The Web profile installation above remains available for `127.0.0.1:3080` workflows.

On Windows, Desktop IPC uses a Named Pipe plus a fresh random token stored in a current-user state directory whose ACL is reduced to the current user and SYSTEM. The token is required on every request. It does not open another TCP listener or rely on the default Named Pipe ACL.

DSH `0.2.1-rc.5` protects the Web API with a browser session. The current Codex-to-DSH client deliberately does not read or store launch tokens or cookies, so it reports a clear HTTP 401 compatibility error with that release. Do not treat Web reachability as a completed Codex-to-DSH loop until an official non-secret external-client authentication mechanism is available and implemented.

## Windows Installation

```powershell
git clone https://github.com/yukinatsuqwq/codex-dsh-bridge.git
cd codex-dsh-bridge
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Target Both
```

The installer:

1. installs the same skill into `~/.codex/skills/` and/or `~/.agents/skills/`;
2. backs up and updates `~/.dsh/profiles/web/cordis.patch.yml` with the persistent DSH plugin;
3. keeps runtime state inside `bridge/runtime/`, which is ignored by Git.

Restart Codex so it discovers the skill, then restart the DSH Web process so it loads the persistent plugin.

Start or inspect the controller:

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\manage-controller.ps1 start
powershell -ExecutionPolicy Bypass -File .\bridge\manage-controller.ps1 status
npm run doctor
```

## Usage

From Codex, ask it to use the `codex-dsh-bridge` skill or run:

```sh
node scripts/dsh-client.mjs send --continue --text "Review this implementation and return the three highest-risk issues."
node scripts/dsh-client.mjs watch --continue --seconds 60
```

Inside DSH, the persistent plugin exposes:

- `codex_threads`
- `codex_context`
- `codex_ask`
- `codex_start`
- `codex_fork`
- `codex_continue`
- `codex_check`
- `codex_respond`

Prefer `codex_context` for read-only inspection. Use `codex_start` for an unrelated new task and `codex_fork` only when the selected task's history is intentionally required. `codex_continue` requires explicit user authorization and the exact confirmation value `WRITE_TO_EXISTING_THREAD`.

### When DSH cannot see a local file

An absolute Windows path is not automatically visible inside DSH's workspace or sandbox. If DSH reports that a known local path is missing, do not keep retrying the same path. Have Codex read the file first, remove secrets, and pass the bounded text as explicit context, or attach the file through DSH's file input. The path alone is not a file transfer.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_BRIDGE_EXECUTABLE` | `codex` | Codex CLI executable or wrapper |
| `CODEX_BRIDGE_WORKSPACE` | repository root | Working directory used by bridge tasks |
| `CODEX_BRIDGE_HOST` | `127.0.0.1` | Controller bind host |
| `CODEX_BRIDGE_PORT` | `32123` | Controller port |
| `CODEX_BRIDGE_THREAD_NAME` | `DSH-Codex 双向桥接专用任务` | Dedicated bridge task title |
| `CODEX_BRIDGE_URL` | `http://127.0.0.1:32123` | Controller URL used by the DSH plugin |
| `CODEX_APP_SERVER_URL` | unset | Legacy alias for `CODEX_BRIDGE_URL` |
| `CODEX_APP_SERVER_REQUEST_TIMEOUT_MS` | `120000` | Timeout for one App Server RPC |
| `DSH_BASE_URL` | `http://127.0.0.1:3080` | DSH Web API URL used by the client and doctor |
| `DSH_BRIDGE_STATE_FILE` | `.tmp/dsh-bridge/current-session.json` | Codex-to-DSH reusable session pointer |
| `AGENTS_HOME` | `~/.agents` | DSH-compatible skill installation root |
| `DSH_HOME` | `~/.dsh` | DSH profile root used by the installer |

## Security And Limitations

- The controller binds to loopback by default and accepts writes only from loopback hosts/origins. It has no network authentication and must not be exposed to a LAN or the public Internet.
- Any local process running as the same user can attempt to call the loopback controller. Treat the machine account boundary as the trust boundary.
- The bridge task runs Codex with read-only sandboxing and approval policy `never`. Direct continuation of an existing task is separately guarded.
- DSH receives only context explicitly selected through bridge tools. It cannot silently read every Codex conversation.
- Codex and DSH do not share live hidden reasoning, credentials, browser state, or model memory.
- DeepSeek does not gain image understanding, computer use, email, or browser control from this bridge. Those require separate verified tools/plugins.
- A Codex task may briefly show “open elsewhere” while App Server owns its writer. The controller releases the writer after each operation.
- Requests are serialized. This is a collaboration bridge, not a high-throughput multi-agent scheduler.
- The DSH Web API and Cordis plugin contracts are not yet stable. Pin known-good versions for important workflows.
- DSH Desktop uses an authenticated, OS-assigned loopback port rather than the Web profile's fixed `3080`; `scripts/dsh-client.mjs` currently targets the Web profile only. The DSH-to-Codex plugin works in either profile when installed into that profile.
- DSH `0.2.1-rc.5` Web API authentication is not supported by `scripts/dsh-client.mjs`; it fails closed with an explicit HTTP 401 message instead of reading browser credentials.
- Thread snapshots omit the local working-directory path before they are returned to DSH.
- macOS arm64 Desktop IPC passed live verification. Windows Named Pipe transport passed isolated Windows tests, including rejection of an incorrect token; a live Desktop round trip remains pending because the available Windows DSH Desktop was older than the macOS-tested build. Intel macOS and Linux remain unverified.

## Privacy

Do not put API keys, OAuth tokens, cookies, credentials, private conversation exports, or runtime state into prompts or commits. `.gitignore` excludes the standard state and secret paths, but it cannot prevent deliberate inclusion.

## License

MIT
