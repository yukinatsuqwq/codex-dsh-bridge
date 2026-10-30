# Codex–DSH Bridge：Mac 端验证交接文档

## 给 DSH 的任务

请对照 GitHub 仓库 `yukinatsuqwq/codex-dsh-bridge` 的当前内容，评估这个桥接项目在 macOS 上是否可以按 README 完成安装、启动和最小闭环测试。

本次只做只读审查和修改建议：

- 允许：阅读 GitHub 上的 README、脚本、`package.json`、`bridge/`、`skills/` 和配置文件；列出 Mac 上的兼容性问题；给出最小修改建议。
- 禁止：修改 GitHub 线上文件、提交 PR、执行真实同步、删除文件、读取或索取任何 API Key、Cookie、密码、OAuth Token。
- 如果无法访问某个文件，请明确写出“无法验证”，不要根据猜测宣布通过。

## 验证目标

### 1. 环境前提

确认 README 是否清楚说明以下条件：

- macOS 版本和芯片架构（Apple Silicon / Intel）；
- Node.js 版本；
- Codex Desktop 或 Codex CLI 是否必须安装并已登录；
- DSH 是否需要先启动 Web UI/API；
- 是否需要 `npm install`、Cordis 插件安装或额外环境变量；
- macOS 的 Terminal、网络权限、文件权限和防火墙是否可能影响本地端口。

### 2. 路径和脚本兼容性

重点检查：

- `bridge/manage-controller.ps1` 是否只适用于 Windows；
- README 中是否把 PowerShell 命令误写成 Mac 可直接执行的命令；
- `127.0.0.1:32123`、DSH Web API 端口和 Codex App Server 的端口是否硬编码且可配置；
- Windows 路径、反斜杠、`.cmd`、`.exe`、注册表、任务栏或 Windows 服务相关内容；
- shell 脚本是否需要新增 `bridge/manage-controller.sh` 或 Node.js 跨平台启动器；
- 进程停止、日志位置、信号处理（SIGINT/SIGTERM）在 macOS 上是否正确。

### 3. 最小验证闭环

请给出一套不改用户数据的最小测试：

1. 启动 Codex App Server 或确认它已经在运行；
2. 启动本地 Controller；
3. 检查 `127.0.0.1:32123` 是否可访问；
4. 在 DSH 中调用一个只读 Codex 工具，例如列出任务或读取一个明确任务的上下文；
5. 从 Codex 向 DSH 发一个只读检查任务；
6. 确认两边的请求、状态、结果和错误信息都能在各自界面看到；
7. 关闭 Controller 后确认 DSH 得到清楚的离线错误，而不是无限等待。

不要把真实项目、密码、Token 或私人文件作为测试输入。测试任务可以使用“读取 README 并返回前三个风险”这类无写入任务。

## 需要返回的格式

请按下面格式返回，便于 Codex 直接处理：

```text
结论：可直接验证 / 需要小改后验证 / 当前无法验证

已确认：
- 文件或章节：证据

Mac 阻塞问题：
- 文件或章节：问题、影响、复现方式

建议修改：
- 文件：建议增加/删除/修改什么
- 是否必须改：是/否
- 是否可以先绕过：可以/不可以

建议的 Mac 命令：
- 只列出不会改数据的命令

最终最小测试步骤：
1. ...
2. ...
```

## Codex 收到结果后的处理规则

- 有文件、行号或 GitHub 链接证据的建议才进入修改候选；
- 只说“应该兼容”但没有证据的内容标记为待确认；
- 涉及 Windows 专用脚本的建议，优先补一个跨平台 Node.js 启动入口，而不是让 Mac 用户手改 PowerShell；
- 任何会启动真实同步、写入已有 Codex 任务、修改远端仓库或读取凭证的动作，都必须重新获得明确授权；
- DSH 只负责检查和提出建议，最终修改、提交和发布由 Codex 负责。

