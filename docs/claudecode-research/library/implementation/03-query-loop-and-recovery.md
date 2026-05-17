# Query Loop、恢复与压缩

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：输入预处理`](./02-input-processing-and-command-dispatch.md) | [`下一站：Session Storage`](./04-session-storage-and-resume.md)

本文聚焦 `query.ts` 和 `QueryEngine.ts` 如何把一次用户任务推进到工具执行、恢复续轮、压缩和终止。

## 1. `QueryEngine.submitMessage()` 是外层会话中枢

源码镜像：[`../../sources/claude-code/src/QueryEngine.ts`](../../sources/claude-code/src/QueryEngine.ts)

`QueryEngine` 不是模型循环本身，而是会话级外壳。它负责：

- 持有 `mutableMessages`
- 持有累计 `totalUsage`
- 维护 read file cache、permission denials、discovered skills 等跨 turn 状态
- 在 `submitMessage()` 里串起 system prompt、输入预处理、transcript 落盘和 `query()`

所以 QueryEngine 解决的是“会话状态持续性”，而不是“单轮采样逻辑”。

## 2. `query.ts` 是单轮复杂度中心

源码镜像：[`../../sources/claude-code/src/query.ts`](../../sources/claude-code/src/query.ts)

`queryLoop()` 通过一个显式 `State` 对象维护循环中的可变状态：

- `messages`
- `toolUseContext`
- `autoCompactTracking`
- `maxOutputTokensRecoveryCount`
- `hasAttemptedReactiveCompact`
- `pendingToolUseSummary`
- `turnCount`

这说明 Claude Code 的 agent loop 不是“递归调用模型直到没工具”为止”这么简单，它是一个带恢复、预算和压缩分支的状态机。

## 3. 这条循环同时承担哪些机制

从 imports 可以看出 `query.ts` 同时接入了：

- API 调用与 retry / fallback
- auto compact / reactive compact / context collapse / snip compact
- token budget / output budget
- memory prefetch
- tool orchestration 与 streaming tool executor
- tool result budget 与结果转储
- stop hooks / post-sampling hooks

所以 `query.ts` 是 Claude Code 的“机制汇流中心”。

## 4. 恢复逻辑不是异常补丁，而是主流程一部分

代码里显式处理了：

- `max_output_tokens` 恢复
- prompt too long
- compact 之后的 `taskBudget.remaining`
- 缺失 tool result 的补桥消息

这意味着 Claude Code 假设长任务、截断和压缩是正常场景，而不是边缘错误。

## 5. 为什么要把压缩和恢复写进主循环

如果 compact / recovery 只作为外围补丁，系统会面临两个问题：

- 状态和 transcript 无法保持一致
- SDK / UI / background session 对“当前会话是否还活着”会产生不同认知

把它们并进主循环后，Claude Code 才能把“继续这次任务”视作同一个 session 的自然延续。
