# Local Controller protocol

The Controller is an unauthenticated local machine API. It binds only to
`127.0.0.1`; the configurable port must be an integer from 1 to 65535.
It does not protect against other processes running as the current user.

All requests require a Host authority of `127.0.0.1:<port>` or
`localhost:<port>`. Requests carrying Origin or a browser cross-site fetch
context are rejected, including reads, to prevent exposing task metadata to
web pages. Native Node clients need no Origin header. Browser UI integrations
must not call this endpoint directly.

POST bodies must be JSON objects with media type `application/json` and may
not exceed 1 MiB. Invalid JSON and non-object bodies return HTTP 400;
oversized bodies return 413; unsupported media types return 415. Errors include
`ok: false`, `code`, and `error`. Health responses include `protocolVersion: 1`.

App Server startup failures release the child. Shutdown rejects pending RPCs,
waits two seconds for stdin EOF, then attempts SIGTERM and finally SIGKILL,
waiting up to two seconds after each signal. Windows uses Node's supported
process termination semantics. Controller start, health, shutdown and offline
recovery were exercised on a Windows 11 machine.

Run `npm test` to exercise request policy, JSON parsing, missing executable
handling, pending RPC cancellation and uncooperative child shutdown. Tests use
synthetic processes and streams and do not read Codex tasks or start DSH.

This protocol is independent of DSH Web authentication. A separate experimental
Desktop reverse transport is implemented in `bridge/dsh-plugin/local-ipc.mjs`.
On macOS/Linux it uses `/tmp/codex-dsh-<uid>/desktop.sock`, a current-user-owned
directory with mode 0700 and a socket with mode 0600. On Windows it uses a Named
Pipe and requires a fresh random token on every request. The descriptor containing
that token is written under LocalAppData after `icacls` removes inherited access
and grants access only to the current user and SYSTEM. Incorrect tokens fail closed.
The Windows design does not assume that the default Named Pipe ACL is sufficient.
Neither transport has a browser credential dependency.
Only sessions created by the current plugin Host are accessible. Restarting DSH
resets that ownership; existing sessions remain in Desktop but cannot be adopted
through IPC. Other programs running as the same OS user share this authority.

The IPC exposes health, create, prompt, snapshot, cancel, pending, answer and
answer-approval. It returns only
bounded assistant text and status, not tool outputs or global session events.
Questions and approvals default to Desktop. Creating a session with
`--interactions ipc` installs a prepended, owned-session-only answerer. The
pending registry uses fresh request IDs bound to the session and interaction
kind. Replies are one-shot, and question IDs and option labels are validated.
Approval outcomes are limited to allowed-once or rejected; a grant additionally
requires `--confirmation ALLOW_ONCE:<rpc-id>` after explicit user authorization
for that exact action. The string is a confirmation guard, not authentication.
Never synthesize it from an agent's request alone. Before granting, inspect
the actual matching tool call in Desktop:
pending exposes tool identity and reason, not complete execution arguments.
An agent-authored justification is not proof of the command being executed.
Requests time out after two
minutes, denying approvals and rejecting unanswered questions. Cancellation and
plugin disposal release pending waits. This routes answers through the original
DSH service waterfall; it does not bypass the service's approval policy or audit.
There is no TCP listener for this transport. Unix endpoints are never unlinked
automatically: a stale socket after a crash needs explicit operator recovery
after confirming no DSH Host owns it. On Windows, a descriptor is removed only
after its authenticated Named Pipe health probe fails; a live Host always wins.
