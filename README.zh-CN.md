# Codex DSH 双向桥接

[English README](README.md)

Desktop 实验通道：安装插件并重启 DSH 后，可在仓库中运行
`node scripts/dsh-local.mjs --help`。该通道通过本机 IPC 创建独立会话、
发送文本及读取有限结果，无需浏览器凭据。问题和授权默认在 Desktop 中处理；
创建时添加 `--interactions ipc` 可使用 `pending`、`answer` 和 `answer-approval`。
“本次允许”必须得到用户对具体操作的授权，并提供对应请求的确认值。
详见 [macOS IPC 验证记录](docs/MAC-IPC-VERIFICATION.md)和
[Windows IPC 验证记录](docs/WINDOWS-IPC-VERIFICATION.md)；尚未完成全部回归。

这是一个在本机运行、交互过程可见的 Codex 与 DeepSeek Harness（DSH）双向桥接项目。

- **Codex 调用 DSH：**Codex 可以创建或继续一个 Web UI 中可见的 DSH 对话，监听提问与授权，并读取结果。
- **DSH 调用 Codex：**DSH 持久插件通过回环地址调用 controller，再由 Codex App Server 创建、读取、派生或在明确授权后继续桌面应用中可见的 Codex 任务。
- **同一份 Skill 给双方：**`skills/codex-dsh-bridge/` 可以安装到 Codex，也可以安装到 DSH 使用的 Agent Skills 目录。

它连接的是两套 Agent Harness，不是直接拼接两个模型 API，也不会自动合并双方的私有记忆。

## 当前状态

实验性版本。Windows 11 已验证 Controller 和 DSH→Codex 路径；macOS arm64 与 Windows 11 均已使用 DSH Desktop `0.2.1-rc.5` 完成 Desktop 本机 IPC 实机验证。Windows Named Pipe 还通过了单元测试、生命周期测试、强制重启恢复和有界审查会话测试。DSH 仍处于开发者预览阶段，可能发生破坏兼容性的变化。

## 架构

### Windows rc.5 更新后的 macOS 回归

macOS arm64、DSH Desktop `0.2.1-rc.5` 下，12 项测试及 18 个 JavaScript
模块语法检查通过。实机验证了 Desktop IPC 健康、新建独立会话、问题回答及
DSH→Codex 只读 context 闭环，Controller 启动与停止也正常。

修复了 IPC 集成测试在较深仓库路径下超出 macOS Unix socket 地址长度限制、
报 `EINVAL` 的问题：Unix 测试改用短 `/tmp` 目录，Windows 测试目录和
Named Pipe 分支保持不变。详见[回归记录](docs/MAC-RC5-REGRESSION.md)。

```text
Codex -> scripts/dsh-client.mjs -> DSH Web API :3080 -> Web UI 可见的 DSH 对话

DSH -> 持久 Cordis 插件 -> HTTP 127.0.0.1:32123
    -> 本地 controller -> Codex App Server stdio
    -> 桌面应用可见的 Codex 任务
```

## 环境要求

- Node.js 22 或更新版本
- DeepSeek Harness Web UI（`npx @deepseek-ai/dsh web`）
- 可通过 `codex` 命令访问的 Codex CLI，或设置 `CODEX_BRIDGE_EXECUTABLE`
- 已完成登录的本地 Codex 环境
- 已验证的 Windows 安装和自动启动流程需要 PowerShell 5.1 或更新版本

在 macOS 上，必须确保非交互进程也能从 `PATH` 找到 `node` 和 `codex`，而不只是 Terminal 的交互 shell。Controller 使用回环端口 `32123`，DSH Web 默认使用 `3080`；本地防火墙或终端安全软件需要允许回环通信。Apple Silicon 与 Intel 使用相同的 JavaScript 入口，但两种架构都还没有完成端到端验证。

## macOS/Linux 安装

```sh
git clone https://github.com/yukinatsuqwq/codex-dsh-bridge.git
cd codex-dsh-bridge
node scripts/install.mjs --target Both
```

安装器会先备份已有 Skill 和 DSH patch 文件，再替换或追加配置。安装后重启 Codex 和 DSH Web。使用跨平台管理器启动或检查 Controller：

```sh
npm run controller:start
npm run controller:status
npm run doctor
```

第一次启动 Controller 会创建 `bridge/runtime/state.json`，并可能创建专用 Codex 桥接任务，因此它不是零写入的健康检查。日志保存在 `bridge/runtime/controller.log`。

### DSH Desktop

DSH Desktop 独占单独的 `desktop` profile，不会加载 `web` profile 的 patch。请先完全退出 DSH Desktop，再使用桌面版自带或已经注册的 `dsh` 命令安装本仓库，然后重新打开应用：

```sh
dsh plugin --profile desktop add /本仓库的绝对路径/codex-dsh-bridge
```

必须使用仓库绝对路径；不要从 Desktop 的私有回环 URL 中复制认证令牌。如果系统没有 `node`，插件会使用 DSH 自身的 Node 运行时。前面的 Web profile 安装仍用于 `127.0.0.1:3080` 工作流。

Windows Desktop IPC 使用 Named Pipe，并要求每次请求携带随机令牌。令牌保存在仅允许当前用户和 SYSTEM 访问的状态目录中；实现不依赖 Named Pipe 默认权限，也不会额外开放 TCP 端口。

DSH `0.2.1-rc.5` 使用浏览器 session 保护 Web API。当前 Codex→DSH 客户端刻意不读取或保存启动 Token、Cookie，因此在该版本上会返回明确的 HTTP 401 兼容性错误。在官方提供并实现不暴露秘密的外部客户端认证机制前，不能把 Web 端口可访问等同于 Codex→DSH 闭环通过。

## Windows 安装

```powershell
git clone https://github.com/yukinatsuqwq/codex-dsh-bridge.git
cd codex-dsh-bridge
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -Target Both
```

安装脚本会：

1. 把同一份 Skill 安装到 `~/.codex/skills/` 和/或 `~/.agents/skills/`；
2. 先备份，再修改 `~/.dsh/profiles/web/cordis.patch.yml`，加载持久 DSH 插件；
3. 将运行状态保存在已被 Git 忽略的 `bridge/runtime/`。

安装后重启 Codex，让它重新发现 Skill；再重启 DSH Web 进程，让持久插件生效。

```powershell
powershell -ExecutionPolicy Bypass -File .\bridge\manage-controller.ps1 start
powershell -ExecutionPolicy Bypass -File .\bridge\manage-controller.ps1 status
npm run doctor
```

## 使用方式

在 Codex 中要求它使用 `codex-dsh-bridge` Skill，或者直接运行：

```sh
node scripts/dsh-client.mjs send --continue --text "检查这个实现并返回风险最高的三个问题。"
node scripts/dsh-client.mjs watch --continue --seconds 60
```

DSH 持久插件提供：

- `codex_threads`
- `codex_context`
- `codex_ask`
- `codex_start`
- `codex_fork`
- `codex_continue`
- `codex_check`
- `codex_respond`

读取上下文时优先使用 `codex_context`。无关的新任务使用 `codex_start`；只有确实需要继承所选任务历史时才使用 `codex_fork`。直接继续已有任务必须获得用户针对该任务的明确授权，并传入 `WRITE_TO_EXISTING_THREAD`。

### DSH 看不到本机文件时

Windows 绝对路径不会自动出现在 DSH 的工作区或沙箱里。如果 DSH 报告某个本机已知路径不存在，不要反复重试同一个路径。应由 Codex 先读取文件并移除密码、令牌等敏感内容，再把有界文本作为明确上下文交给 DSH，或者通过 DSH 的文件输入功能添加附件。只有路径并不等于文件已经传过去。

## 主要限制

- Controller 默认只监听回环地址，而且没有网络身份验证，不能暴露到局域网或公网。
- 同一系统用户下的其他本地进程理论上也可以尝试访问 controller，本项目以本机用户账户作为信任边界。
- DSH 只能看到通过工具明确选择并传递的 Codex 上下文，不能静默读取所有对话。
- 双方不会共享隐藏思考、凭证、浏览器状态或模型内部记忆。
- 这个桥接不会自动赋予 DeepSeek 图片理解、computer use、邮件或浏览器操作能力，这些能力需要单独安装并验证相应工具。
- App Server 操作期间，Codex 桌面任务可能短暂显示“在其他位置打开”；每次调用完成后 controller 会释放 writer。
- 请求会串行执行。它是协作桥接，不是高吞吐量多 Agent 调度器。
- DSH Web API 与 Cordis 插件接口仍可能变化，重要工作流应固定已验证版本。
- DSH Desktop 使用经过认证的动态回环端口，而不是 Web profile 固定的 `3080`；`scripts/dsh-client.mjs` 目前只支持 Web profile。DSH→Codex 插件安装到对应 profile 后可用于两者。
- DSH `0.2.1-rc.5` 的 Web API 认证尚不受 `scripts/dsh-client.mjs` 支持；客户端会用明确的 HTTP 401 错误安全失败，不读取浏览器凭证。
- 返回给 DSH 的 task 快照会移除本地工作目录路径。
- macOS arm64 与 Windows 11 Desktop IPC 均已使用 DSH Desktop `0.2.1-rc.5` 完成实机验证。Windows 还验证了错误令牌拒绝和强制重启后的残留描述文件恢复。Intel macOS 与 Linux 尚未验证。

## 配置

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `CODEX_BRIDGE_EXECUTABLE` | `codex` | Codex CLI 可执行文件或包装器 |
| `CODEX_BRIDGE_WORKSPACE` | 仓库根目录 | 桥接任务工作目录 |
| `CODEX_BRIDGE_HOST` | `127.0.0.1` | 仅接受此 IPv4 回环地址，禁止向局域网暴露 |
| `CODEX_BRIDGE_PORT` | `32123` | Controller 端口 |
| `CODEX_BRIDGE_THREAD_NAME` | `DSH-Codex 双向桥接专用任务` | 专用桥接任务标题 |
| `CODEX_BRIDGE_URL` | `http://127.0.0.1:32123` | DSH 插件使用的 Controller URL |
| `CODEX_APP_SERVER_URL` | 未设置 | `CODEX_BRIDGE_URL` 的旧版别名 |
| `CODEX_APP_SERVER_REQUEST_TIMEOUT_MS` | `120000` | 单次 App Server RPC 超时 |
| `DSH_BASE_URL` | `http://127.0.0.1:3080` | DSH Web API 地址 |
| `DSH_BRIDGE_STATE_FILE` | `.tmp/dsh-bridge/current-session.json` | Codex→DSH 可复用 session 指针 |
| `AGENTS_HOME` | `~/.agents` | DSH 兼容 Skill 的安装根目录 |
| `DSH_HOME` | `~/.dsh` | 安装器使用的 DSH profile 根目录 |

## 隐私

不要把 API Key、OAuth Token、Cookie、凭证、私人对话导出或运行状态写入提示词或提交。`.gitignore` 会排除常见状态和密钥文件，但不能阻止人为主动加入。

## 许可证

MIT
