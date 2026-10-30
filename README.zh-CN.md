# Codex DSH 双向桥接

[English README](README.md)

这是一个在本机运行、交互过程可见的 Codex 与 DeepSeek Harness（DSH）双向桥接项目。

- **Codex 调用 DSH：**Codex 可以创建或继续一个 Web UI 中可见的 DSH 对话，监听提问与授权，并读取结果。
- **DSH 调用 Codex：**DSH 持久插件通过回环地址调用 controller，再由 Codex App Server 创建、读取、派生或在明确授权后继续桌面应用中可见的 Codex 任务。
- **同一份 Skill 给双方：**`skills/codex-dsh-bridge/` 可以安装到 Codex，也可以安装到 DSH 使用的 Agent Skills 目录。

它连接的是两套 Agent Harness，不是直接拼接两个模型 API，也不会自动合并双方的私有记忆。

## 当前状态

实验性版本。目前只在 **Windows 11**、Codex 桌面应用/CLI 和 DSH Web UI 上完成实现与验证。DSH 仍处于开发者预览阶段，可能发生破坏兼容性的变化。macOS 与 Linux 尚未验证，controller 自动启动目前只支持 Windows。

## 架构

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

```powershell
node .\scripts\dsh-client.mjs send --continue --text "检查这个实现并返回风险最高的三个问题。"
node .\scripts\dsh-client.mjs watch --continue --seconds 60
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
- macOS/Linux 的安装、进程管理和插件自动启动尚未验证。

## 隐私

不要把 API Key、OAuth Token、Cookie、凭证、私人对话导出或运行状态写入提示词或提交。`.gitignore` 会排除常见状态和密钥文件，但不能阻止人为主动加入。

## 许可证

MIT
