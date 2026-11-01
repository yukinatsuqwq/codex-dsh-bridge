# Windows 接手验证说明

日期：2026-11-01。目标仓库：`yukinatsuqwq/codex-dsh-bridge`。
参考上游：`dddzzz123-dz/codex-dsh-bridge`。
本地修改基线：`b1c277e6bbc37d9b872672d91ad0edea09c9f806`。

## 先看结论

修改尚未 commit、push 或创建 PR。GitHub main 不包含这批改动；接手者必须
取得完整本地工作树，包括所有新增文件，不能只 clone GitHub 就开始验收。
不要覆盖或清理未提交内容。Windows 能力保留，但没有在 Windows 实机验证。

macOS arm64 / DSH Desktop 0.2.1-rc.5 / Node 24 已验证：

- Desktop 插件加载、Controller 自动启动、Codex App Server 初始化。
- DSH → Codex 专用空白 task 的只读 context；返回不含 cwd。
- 新本机 IPC 创建 DSH 会话、发送提示、读取助手文本；Desktop 中会话可见。
- ask_user_question → pending → answer → PASS；回答后 pending 清空。
- 真实 bash 授权：固定命令 `/usr/bin/true`，拒绝分支阻止执行；另一个独立
  请求 allowed-once 后完成，助手报告退出码 0，Desktop 工具状态 completed。
- 已消费授权 ID 重放被拒绝；无长期授权策略变化。
- 真实等待提问期间 cancel 返回 cancelled=true，pending 清空。
- Desktop 显示取消问题 ASK_ABORTED；后续会话仍可继续。
- 最新 Controller 离线回归返回明确 offline/unreachable；正常退出 Desktop
  后 socket 文件自动消失，没有自动删除不明 PID 或未知服务。
- 重启 Desktop 后 health 再次成功，旧会话 snapshot 被明确拒绝，符合
  “仅当前 Host 创建的会话可访问”的所有权边界。
- 全部 11 项自动测试通过，包括隔离 socket、权限、交互绑定和子进程关闭。

**最重要的差异：新 IPC 仅支持 macOS/Linux；Windows Named Pipe 尚未实现。**
Windows 插件仍能调用原有 DSH → Codex Controller；新 `dsh-local.mjs` 在 Windows
会明确报不支持。旧 Codex → DSH Web 脚本保留，但当前 DSH Web 浏览器认证会
返回 401；这是认证契约问题，不能据此声称 Windows 双向闭环已通过。

## 文件地图

| 文件 | 作用 / 接手重点 |
| --- | --- |
| `bridge/manage-controller.ps1` | 原 Windows 入口，与基线无改动 |
| `scripts/install-windows.ps1` | 原 Windows 安装器，与基线无改动 |
| `bridge/manage-controller.mjs` | 新跨平台进程管理；Windows PID 重用保护需重点审查 |
| `bridge/resolve-codex.mjs` | 显式 executable、macOS bundle 发现、其他平台回退 codex |
| `bridge/controller/app-server-client.mjs` | 启动失败、RPC 超时、EOF/TERM/KILL 关闭 |
| `bridge/controller/http-policy.mjs` | 强制 127.0.0.1、Host/Origin 校验、JSON 大小限制 |
| `bridge/controller/controller.mjs` | health 协议字段、隐私字段白名单、交互转发 |
| `bridge/dsh-plugin/index.mjs` | 工具注册、Node 管理器启动；Windows 不启用 Unix IPC |
| `bridge/dsh-plugin/local-ipc.mjs` | 同用户 Unix socket；Windows 传输待补 |
| `bridge/dsh-plugin/interactions.mjs` | 可复用的问答/授权请求绑定、超时与取消 |
| `scripts/dsh-local.mjs` | 新 IPC 命令行入口 |
| `scripts/install.mjs` | 新跨平台安装器，带备份及 Web patch 幂等处理 |
| `scripts/dsh-client.mjs` | 原 Web 协议，401 安全失败，不提取浏览器凭据 |
| `bridge/controller/*.test.mjs` | 回归测试；Unix socket 两项在 Windows 跳过 |
| `bridge/controller/SECURITY.md` | 安全边界及协议 |
| `docs/MAC-IPC-VERIFICATION.md` | macOS 详细证据，含历史记录，注意更新日期 |

## Windows 实机前置检查

使用 Windows 11、Node 22+，同时记录 Node、Codex CLI、Codex Desktop、DSH 的
精确版本及 CPU 架构。不要读取任何密码、Token、Cookie、凭据文件或私人会话。
测试目录使用新建空目录或公开源码副本。不得真实同步数据。

在源码根目录运行（PowerShell）：

```powershell
git status --short
git diff --check
node --version
codex --version
dsh --version
npm run check
npm run check:ipc
node --test bridge/controller/app-server-client.test.mjs bridge/controller/http-policy.test.mjs bridge/controller/interactions.test.mjs bridge/controller/local-ipc.test.mjs
git diff --exit-code -- bridge/manage-controller.ps1 scripts/install-windows.ps1
```

Unix socket 测试在 Windows 跳过是预期行为，不等于 Windows IPC 通过。
如 Node 22 不接受 `npm test` 中的 glob，先使用上面的显式文件命令并记录问题。

## 验证顺序与验收

1. 先用隔离的测试用户目录验证安装器。修改 CODEX_HOME/AGENTS_HOME/DSH_HOME
   仅限当前测试进程；执行前核对脚本对这些变量的使用方式。验证首次安装、
   重复安装、备份、中文/空格路径；不要覆盖已有个人配置做第一轮测试。
2. 在已授权的实际 DSH 测试 profile 安装插件；Desktop 使用独立 profile：

```powershell
dsh plugin --profile desktop add 'C:\path with spaces\codex-dsh-bridge'
```

3. 分别验证原 PowerShell 管理器和新 Node 管理器，不能同时启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\manage-controller.ps1 start
powershell -ExecutionPolicy Bypass -File .\bridge\manage-controller.ps1 status
powershell -ExecutionPolicy Bypass -File .\bridge\manage-controller.ps1 stop
node bridge/manage-controller.mjs start
node bridge/manage-controller.mjs status
node bridge/manage-controller.mjs stop
```

4. `.exe`、`.cmd`、PATH 无 codex、显式 CODEX_BRIDGE_EXECUTABLE、路径含中文和
   空格均要测试。App Server spawn 使用 Windows shell 分支；核对实际启动参数，
   不通过拼接用户文本实现启动。找不到 executable 应明确失败，无孤儿进程。
5. health 应为 service=codex-dsh-bridge、protocolVersion=1、ready=true。
   32123 是 Controller；3080 是旧 DSH Web 默认端口；Desktop 动态端口不要硬编码。
6. 只用专用空白 Codex task 验证 codex_threads（明确搜索）、codex_context。
   不做无过滤私人任务枚举，不调用 codex_continue，不转发私人历史。
7. 停 Controller 后调用 codex_check：应有限时返回 offline/unreachable。
   再调用只读工具验证自动启动。检查 Codex App Server 子进程正常释放。
8. 端口占用：使用自建无关测试服务占住测试端口，管理器应报错，不能杀该服务。
   PID 文件过期/PID 重用、并发 start、start 失败清理需单独验证。
9. 旧 Web send/watch 若返回 401，记为认证不兼容；不要读 launch token/cookie，
   不关闭 DSH 认证，不降级到不安全版本以得到“通过”。

## Windows 反向通道后续实现要求

建议复用现有业务与 InteractionRegistry，仅增加 Windows Named Pipe 传输。
必须明确实现同用户访问控制，不能假定命名管道的默认权限足够；如所用 Node
API 无法设置必要的 Windows ACL，先报告限制。不要降级为无认证 localhost TCP。
socket/pipe 地址不应依赖 DSH Desktop 动态端口，不使用浏览器凭据。

接好后按 macOS 同样的闭环验收：create → prompt → snapshot，提问 answer，
真实无副作用命令的拒绝和单次允许、错误 session/rpc/kind、重放、超时、取消、
卸载重载、Host 重启后旧会话不可被自动认领。Windows `/usr/bin/true` 不存在，
选用已核对的无读写命令（如 `cmd.exe /d /c exit 0`），不得原样照搬 Unix 命令。

授权前检查 Desktop 中实际 tool call；pending 只含工具身份和理由，不包含完整
参数。确认值 ALLOW_ONCE:<rpcId> 只是防误用约束，不是身份认证。

## 回报格式

本轮 macOS 收尾状态：Controller 已停止，DSH Desktop 已重新打开且 IPC 健康；
没有待回答问题或授权。测试会话保留在 Desktop，重启后 IPC 不再认领旧会话。
强制崩溃/残留端点恢复、Intel macOS 和 Linux 实机仍为无法验证。

每项填写：通过 / 未通过 / 无法验证；附系统及版本、命令、实际结果、文件章节
或行号。日志只提供脱敏的最小错误，不上传 runtime/state、私人路径或凭据。
不可把保留源码、测试跳过或平台模拟当作实机通过。

推送条件：完成 Windows 两方向及故障回归、保持 macOS 已有测试通过、检查 diff
不含运行状态和秘密。用户要求完整验证后才可推送；目前尚未满足，不得 push/PR。
