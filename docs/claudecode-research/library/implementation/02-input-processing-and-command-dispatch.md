# 输入预处理与命令分发

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Bridge / Remote / Daemon`](../architecture/04-bridge-remote-and-daemon.md) | [`下一站：Query Loop`](./03-query-loop-and-recovery.md)

本文聚焦 prompt 在进入模型之前经历的所有前置处理。

## 1. 入口函数

源码镜像：[`../../sources/claude-code/src/utils/processUserInput/processUserInput.ts`](../../sources/claude-code/src/utils/processUserInput/processUserInput.ts)

`processUserInput()` 的位置很关键：它不在 REPL 里，也不在 `query.ts` 里，而是夹在“输入”与“模型循环”之间的标准入口。

## 2. 它的输出不只是消息

`ProcessUserInputBaseResult` 说明这一步不仅产出 `messages`，还会决定：

- `shouldQuery`：这一轮是否真的进入模型
- `allowedTools`
- `model`
- `effort`
- `resultText`
- `nextInput` / `submitNextInput`

也就是说，输入预处理本身就可能改变这轮执行的工具面、模型、复杂度和后续动作。

## 3. 它到底处理了哪些事

从 imports 和分支能看出，`processUserInput` 负责至少六件事：

- slash command 识别与本地命令执行
- pasted content / image block / attachment 组装
- bridge-safe command 与远程来源输入的区别处理
- ultraplan 关键字识别与替换
- user prompt submit hooks
- 阻断、附加上下文、系统级警告消息的生成

这一步的目标不是“把字符串变成 message”，而是把“原始用户输入”转成“可安全送入 agent loop 的会话动作”。

## 4. `shouldQuery` 为什么是关键变量

很多人容易把输入处理理解成模型前的小清洗，但 `shouldQuery` 说明事实不是这样。

当 `shouldQuery = false` 时，可能发生的是：

- 本地 slash command 已经消费了这次输入
- hook 阻止了继续执行
- 系统生成了一条告警或替代消息
- 本轮只需要局部状态更新，不需要调用模型

这就是为什么“用户按下回车”并不等于“Claude Code 一定发起了一次模型请求”。

## 5. hooks 在这里如何介入

`executeUserPromptSubmitHooks()` 和 `getUserPromptSubmitHookBlockingMessage()` 表明：

- hook 可以完全阻断原始 prompt 的继续执行
- hook 可以生成额外 context 附件
- hook 可以把这轮会话改造成系统消息或 warning

所以 hooks 不是工具调用后的旁路审计，它从输入进入系统的第一步就开始起作用。
