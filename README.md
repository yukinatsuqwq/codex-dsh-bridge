# Codex DSH Bridge

[中文说明](README.zh-CN.md)

A local, visible, bidirectional bridge between OpenAI Codex and DeepSeek Harness (DSH).

- **Codex to DSH:** Codex creates or continues a visible DSH Web UI session, watches questions and approvals, and reads the result.
- **DSH to Codex:** a persistent DSH plugin calls a loopback controller, which uses Codex App Server to create, inspect, fork, or explicitly continue desktop-visible Codex tasks.
- **One skill for both sides:** the Agent Skill in `skills/codex-dsh-bridge/` can be installed for Codex and for DSH-compatible skill discovery.

This project coordinates two agent harnesses. It does not replace either model API or merge their private memory.

## Status

Experimental. The current release was implemented and verified on **Windows 11** with Codex desktop/CLI and the DSH Web UI. DSH itself is in developer preview and may introduce compatibility-breaking changes. macOS and Linux have not been tested; automatic controller startup is currently Windows-only.

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

## Windows Installation

```powershell
git clone https://github.com/dddzzz123-dz/codex-dsh-bridge.git
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

```powershell
node .\scripts\dsh-client.mjs send --continue --text "Review this implementation and return the three highest-risk issues."
node .\scripts\dsh-client.mjs watch --continue --seconds 60
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
| `CODEX_BRIDGE_THREAD_NAME` | `DSH-Codex bridge` | Dedicated bridge task title |
| `CODEX_APP_SERVER_URL` | `http://127.0.0.1:32123` | URL used by the DSH plugin |
| `DSH_BRIDGE_STATE_FILE` | `.tmp/dsh-bridge/current-session.json` | Codex-to-DSH reusable session pointer |

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
- macOS/Linux installation, service management, and DSH plugin auto-start are not yet verified.

## Privacy

Do not put API keys, OAuth tokens, cookies, credentials, private conversation exports, or runtime state into prompts or commits. `.gitignore` excludes the standard state and secret paths, but it cannot prevent deliberate inclusion.

## License

MIT
