# Agent Tool UI / Progress Grouping / Result Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Generation / Memory Injection / Materialization Runtime`](./56-agent-generation-memory-injection-and-materialization-runtime.md) | [`下一站：Agent Invocation / Task Host / Background Lifecycle Bridge`](./58-agent-invocation-task-host-and-background-lifecycle-bridge.md)

前面的 agent 卷册已经把 definition、spawn、memory、task host、creation wizard 拆开了，但 `AgentTool` 自己给主会话渲染出来的前台结果面，还没有单独成卷。真正把“一个 agent tool call 在 transcript 里长什么样、进度怎么折叠、remote/async/teammate 怎么分面显示”接起来的是：

- `tools/AgentTool/UI.tsx`
- `components/AgentProgressLine.tsx`
- `components/Message.tsx`
- `components/MessageResponse.tsx`
- `components/ToolUseLoader.tsx`
- `components/FallbackToolUseRejectedMessage.tsx`
- `components/FallbackToolUseErrorMessage.tsx`

这一卷聚焦 `AgentTool/UI.tsx` 这个 host-aware result renderer，不重复 spawn 或 task host 本身的实现。

## 1. `AgentTool/UI.tsx` 不是一个小 render helper，而是 agent tool 的专用 transcript adapter

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

这份文件并不只是把结果文本打印出来。它同时负责：

- `tool_use` tag 显示
- in-progress progress 面
- completed result 面
- rejected / error fallback 面
- grouped multi-agent 摘要面
- condensed vs transcript mode 双视图

也就是说，`AgentTool` 的用户可见行为有很大一部分并不在 `AgentTool.tsx` 本体，而在这份 UI adapter 里完成。

## 2. 它先把“哪些 progress 能安全进 transcript”做了一层类型门

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

最前面的 `hasProgressMessage()` 很关键。它明确排除了没有 `message` 字段的 progress 类型，例如：

- 某些透传进来的 `bash_progress`

这表示 `AgentTool` UI 不会把所有 progress 事件都强行塞进 transcript，而是先判断它们是否真的具备 message 语义。前台结果面依赖的是“可消息化的 progress”，不是原始 runtime event 全量镜像。

## 3. search/read/REPL 折叠不是通用 transcript 功能，而是 agent-progress 专属压缩器

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx), [`../../sources/claude-code/src/utils/collapseReadSearch.ts`](../../sources/claude-code/src/utils/collapseReadSearch.ts)

`getSearchOrReadInfo()` 和 `processProgressMessages()` 专门做了一件事：

- 把连续的 search/read/REPL 进度折成 summary

其中有两个关键约束：

- 只对有 message 的 agent progress 工作
- 只在 `tool_result` 侧计数，不在 `tool_use` 侧计数，避免双算

所以 transcript 里看到的 “Searched X files / Read Y files” 不是底层工具自己渲染的，而是 `AgentTool/UI.tsx` 站在 subagent transcript 层重新做的一次压缩汇总。

## 4. `tool_result` 的 completed/async/remote 三态，在这里被拆成完全不同的前台面

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

`renderToolResultMessage()` 先按 `status` 分流：

- `remote_launched`
- `async_launched`
- `completed`

它们不是同一套模板改几句文案，而是三种不同的 UI contract：

- `remote_launched`：显示 `taskId + sessionUrl`
- `async_launched`：显示 “Backgrounded agent”，并在非 transcript 模式下提示 `↓ manage / ctrl+o expand`
- `completed`：显示完整 prompt/progress/response/final assistant message 组合

这说明 agent tool 的结果面本身就内建了 host mode 语义，不依赖外层额外解释。

## 5. transcript mode 才会展开完整 subagent transcript；普通模式故意只给折叠版

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

同一个 completed result，在 `isTranscriptMode` 下会额外显示：

- `AgentPromptDisplay`
- `VerboseAgentTranscript`
- `AgentResponseDisplay`

非 transcript 模式则只保留：

- 完成摘要
- `CtrlOToExpand`

这意味着 Claude Code 对 subagent 结果采用的是两层显示策略：

- 默认先给高密度 summary
- 用户显式展开后才看完整 prompt/progress/response transcript

所以 agent tool 的可读性很大程度上来自这层 deliberate disclosure，而不是底层消息更少。

## 6. `VerboseAgentTranscript` 不是简单复用主 transcript，而是单独重建 lookups

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

`VerboseAgentTranscript()` 先对 progressMessages 做：

- `buildSubagentLookups(...)`

再把每个 progress 交给 `MessageComponent` 渲染。

这说明 subagent transcript 不是拿主会话 lookups 直接套用，而是为 agent 的局部消息流单独搭了一个 lookup 空间。agent tool 前台里看到的 tool/result 关系，是这层局部 lookup 重新组装的，不是全局 transcript 的副产物。

## 7. condensed mode 由终端行数预算触发，不是纯粹的“消息多就折叠”

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

`renderToolUseProgressMessage()` 里专门算了：

- `ESTIMATED_LINES_PER_TOOL = 9`
- `TERMINAL_BUFFER_LINES = 7`
- `toolToolRenderLinesEstimate`
- `terminalSize.rows < estimate`

只有在普通模式且终端太矮时，才进入 condensed mode，显示：

- tool use 数
- token 数
- `ctrl+o expand`

这说明 progress 折叠不只是语义压缩，还直接考虑终端几何预算。`AgentTool` UI 的一个重要职责，是避免 agent progress 抢光当前屏幕。

## 8. “+N more tool uses” 不是按隐藏消息数算，而是按隐藏 tool-use 语义算

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

`hiddenToolUseCount` 的实现很克制：

- summary 行按 `searchCount + readCount + replCount > 0` 算一次
- 原始行只数真正含 `tool_use` 的消息

它明确不按“隐藏了多少行 progress message”来计数，因为那会把 `tool_use + tool_result + 文本` 这种多行进度夸大成多次工具调用。这里追的是语义上的 tool use 数，而不是渲染行数。

## 9. grouped agent surface 本身就是一套多-agent 聚合协议

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx), [`../../sources/claude-code/src/components/AgentProgressLine.tsx`](../../sources/claude-code/src/components/AgentProgressLine.tsx)

`renderGroupedAgentToolUse()` 会把多次 agent tool use 聚成一个统一 surface，然后计算每个 agent 的：

- `agentType`
- `description`
- `toolUseCount`
- `tokens`
- `isResolved / isError / isAsync`
- `lastToolInfo`
- 可选 `name`

再统一渲染：

- 顶部总体状态条
- 多行 `AgentProgressLine`

这表示多 agent 并发不是简单重复单 agent UI，而是单独有一层 grouped launch contract。

## 10. teammate spawn 会被故意伪装成 `@name` 身份，而不是裸显示 agent type

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

在 grouped surface 里，如果输出状态是：

- `teammate_spawned`

那它会特殊处理：

- 主名显示成 `@name`
- `subagent_type` 放进 description
- 自定义 agent 的颜色挂到 description，而不是 name

这说明 teammate 在 transcript 里的可见身份被产品化过，不是简单把底层 `subagent_type` 直接摊出来。`@name` 是 operator-facing persona，type 更像附属说明。

## 11. async 判定不是只看启动参数，还会看运行中被 background 的输出状态

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

`renderGroupedAgentToolUse()` 里 `isAsync` 有三种来源：

- `run_in_background === true`
- `output.status === 'async_launched'`
- `output.status === 'remote_launched'`
- 以及 teammate spawn 也会被视为 async family

这说明 agent 的前台结果面不是只看用户一开始怎么调用，还看执行过程中 host 怎么把它变成后台/远端任务。UI 追的是最终宿主语义，不是输入参数的单点快照。

## 12. `extractLastToolInfo()` 不是读最后一条消息，而是站在 agent 工具语义上做“最后一步摘要”

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

`extractLastToolInfo()` 的策略是：

1. 先从尾部回扫连续 search/read，必要时折成统一 summary
2. 否则找最后一个 `tool_result`
3. 用 `tool_use_id` 回查对应 `tool_use`
4. 再走 `tool.userFacingName()` / `tool.getToolUseSummary()`

所以 `AgentProgressLine` 上那句最后一步信息，本质上是“语义摘要”，不是“最后一条原始消息”。它会尽量把工具调用翻成 operator 可读的最后动作说明。

## 13. rejected 和 error surface 都会保留已发生的 progress transcript

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

无论是：

- `renderToolUseRejectedMessage()`
- `renderToolUseErrorMessage()`

它们都会先调用：

- `renderToolUseProgressMessage(progressMessagesForMessage, ...)`

然后再附加：

- `FallbackToolUseRejectedMessage`
- `FallbackToolUseErrorMessage`

这说明 agent tool 失败面并不是只给一条结论，而是保留“它已经做到了哪一步”的上下文。失败前发生过的 progress 不会被抹掉。

## 14. `renderToolUseTag()` 有意只在模型偏离主模型时显示 tag

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/UI.tsx`](../../sources/claude-code/src/tools/AgentTool/UI.tsx)

tag 渲染时会比较：

- `getMainLoopModel()`
- `parseUserSpecifiedModel(input.model)`

只有当 agent 指定模型和主循环模型不同，才真的显示 model tag。

这说明 transcript 顶部 tag 的目的不是列全配置，而是突出“与默认执行环境不同的东西”。如果 agent 没偏离主模型，UI 故意保持安静。

## 15. 这层 UI 和 `LocalAgentTask` / background task host 是相邻层，不是同一层

回跳：[`53-local-agent-task-retention-panel-and-notification-runtime.md`](./53-local-agent-task-retention-panel-and-notification-runtime.md)

要区分两件事：

- `AgentTool/UI.tsx` 负责“这次 agent tool 调用在 transcript 里怎么显示”
- `LocalAgentTask` 负责“本地 agent 被 retain/background 后如何在 panel/notification/viewingAgentTaskId 体系里继续存在”

也就是说：

- `57` 讲一次 tool invocation 的结果与进度表面
- `53/54` 讲 agent/main-session 被托管进 task host 之后的持久前台与后台生存期

这两层合起来，才是 Claude Code 里 agent 从调用到托管的完整 operator surface。
