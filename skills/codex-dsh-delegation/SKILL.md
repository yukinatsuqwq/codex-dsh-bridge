---
name: codex-dsh-delegation
description: >
  Automatically route bounded coding subtasks between Codex and DeepSeek
  Harness through codex-dsh-bridge. Codex stays the main coordinator, decides
  what to keep, sends cheap independent checks to DSH, collects results, and
  continues the main task; DSH may send implementation work back to Codex.
---

# Codex–DSH 自动调度器

这个 skill 的作用不是告诉人“可以怎么分工”，而是让 Codex 在实际 coding
任务中主动执行一套双向调度流程。Codex 是总协调者，DSH 是便宜的并行助手。
两个 Agent 仍然各自保留自己的对话和权限。

## 默认总流程

收到 coding 任务后，Codex 按下面顺序工作：

1. 先把任务拆成“核心实现”和“可独立验证的小任务”。
2. 核心实现、架构选择、跨文件改动和最终合并由 Codex 自己负责。
3. 对于不需要共享隐藏上下文的部分，调用 `codex-dsh-bridge` 把小任务发给
   DSH。优先发只读审查、测试计划、边界检查和文档核对。
4. 记录每个委派的任务说明、返回的 request id、状态和结果；不要把“已发出”
   当成“已完成”。
5. DSH 返回后，Codex 重新核对证据，再决定采纳、修正或驳回建议。
6. 如果 DSH 发现必须改代码，DSH 不要直接碰核心工作；让 DSH 通过桥接器
   请求 Codex 使用 `codex_start` 新建独立实现任务，或在用户明确授权后使用
   `codex_continue` 继续指定任务。
7. Codex 完成实现后，可再次派 DSH 做最终只读验收，然后由 Codex 汇总交付。

简化成一句话：

```text
Codex 拆任务 → DSH 做便宜检查 → Codex 验证并实现 → DSH 复核 → Codex 交付
```

## Codex 什么时候自己做

以下工作不要交给 DSH 作为最终执行者：

- 需求澄清、总体设计和安全边界；
- 核心代码、配置、数据库/文件迁移和集成修改；
- 会改变用户数据、远端服务或生产环境的动作；
- 最终取舍、批准写入、回滚和交付说明；
- 需要完整主任务上下文才能正确判断的工作。

## Codex 什么时候派给 DSH

满足“边界清楚、可单独验收、即使失败也不会破坏主任务”时才委派：

- 只读代码审查和风险清单；
- 测试用例、边界条件、兼容性矩阵；
- 对脚本、配置、README 和 Codex 输出做第二视角核对；
- 独立检查日志、错误处理、回滚和安全遗漏；
- 对一个明确文件或明确函数提出修改建议，但默认不直接写入。

## 委派调用规则

每个委派提示必须包含：目标、输入范围、允许操作、禁止操作、输出格式、完成
条件和超时/停止条件。默认禁止写文件、删除数据、执行同步、提交代码和访问
密码/令牌。

通过桥接器时：

- Codex → DSH：使用 bridge skill 的 DSH Web UI/API，发送一个有界任务并等待
  结果；如果 DSH 提问或要求授权，转回 Codex/用户处理，不要猜答案。
- DSH → Codex：无关的新实现任务用 `codex_start`；确实需要旧历史才用
  `codex_context` 或 `codex_fork`；只有用户明确授权修改某个已有任务时才用
  `codex_continue`，并使用精确确认值 `WRITE_TO_EXISTING_THREAD`。
- 需要继承上下文时，只传明确选中的上下文，不要把所有历史对话打包给另一边。
- 如果 DSH 看不到 Codex 本机的绝对路径（尤其是桌面、下载目录或另一个沙箱），
  不要反复让 DSH 盲读路径：由 Codex 先读取并脱敏，再把必要的文本作为上下文传给
  DSH；或者使用 DSH 的文件附件能力。路径本身不等于文件已经共享。
- 委派结果必须包含文件名、行号或可复现证据；只有 request id 没有结果时，
  继续使用 `codex_check`/watch，不能宣布完成。

## 自动调度模板

Codex 可以按这个内部格式生成委派任务：

```text
[DSH 子任务]
目标：<一个明确问题>
范围：<文件/目录/函数>
允许：只读查看、运行不会改数据的检查
禁止：写入、删除、同步、提交、输出秘密
输出：按 文件:行号 -> 证据 -> 风险/建议 返回
完成条件：<可验收条件>
```

返回后按三类处理：

- 已确认：有证据，Codex 可采纳；
- 待确认：建议合理但缺少证据，Codex 自己补查；
- 不采纳：超出范围、违反安全边界或与本地事实冲突。

## NAS/同步任务示例

Codex 保留：确认哪一端是基准、源和目标方向、冲突/删除策略、备份和回滚，
以及最终是否允许同步。

然后由 Codex 自动发给 DSH：脚本真实参数、路径、反向写入可能、错误处理、
重试行为、火绒可能拦截的操作，以及交接文档和脚本是否矛盾。要求 DSH 不运行
同步工具，不移动/删除/写入文件，也不输出密码。DSH 返回后，Codex 再决定是否
允许真正同步。

## 收尾

## 失败和停止规则

桥接器离线、任务超时、DSH 反复提问或返回内容不完整时，停止自动委派并把
状态说清楚。不要自动重试有写入风险的任务，不要为了让流程“看起来完成”而
替 DSH 猜授权、补密码或扩大文件范围。恢复后从新的有界任务开始。
