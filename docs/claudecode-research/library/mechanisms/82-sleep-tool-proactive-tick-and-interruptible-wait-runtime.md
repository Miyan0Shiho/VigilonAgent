# SleepTool / Proactive Tick / Interruptible Wait Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：ScheduleCron Tools / Scheduler / Durable-Session Runtime`](./81-schedule-cron-tools-scheduler-and-durable-session-runtime.md) | [`下一站：RemoteTriggerTool / OAuth Headers / Action Surface / Raw Result Runtime`](./83-remote-trigger-tool-oauth-headers-action-surface-and-raw-result-runtime.md)

本文把 `SleepTool` 单独从 proactive/assistant/queue 总述里拆出来。但要先说明一个边界：当前源码镜像里只有 [`../../src/tools/SleepTool/prompt.ts`](../../src/tools/SleepTool/prompt.ts) 可见，`SleepTool` 主体实现文件本身没有展开。所以这篇不会硬装成“已经拿到完整 tool body”，而是只写当前镜像里真正能证实的外围 runtime：

- tool exposure gate
- proactive tick loop
- interruptible-tool contract
- queue wake semantics
- spinner/transcript UI suppression
- auto-mode safety classification
- channel/scheduled-task interaction edges

也就是说，这篇讲的是 “Sleep 在 Claude Code 里怎样被宿主系统依赖”，不是它内部到底如何计时每一秒。

## 1. `SleepTool` 不是普通常驻工具，它只在 proactive 能力打开时才装进工具池

源码镜像：[`../../src/tools.ts`](../../src/tools.ts), [`../../src/main.tsx`](../../src/main.tsx)

`tools.ts` 里它的装配条件是：

- `feature('PROACTIVE') || feature('KAIROS')`
- `require('./tools/SleepTool/SleepTool').SleepTool`

也就是说，编译期没有 proactive 相关 feature 时，这把工具直接不存在。

更关键的是，`main.tsx` 里还有一条显式注释：

- `maybeActivateProactive(options)` 必须先于 `getTools()`
- 否则 `SleepTool.isEnabled()` 过不去

这说明 `SleepTool` 的可见性不是静态 true，而是依赖 proactive activation 的 runtime gate。

## 2. 在 assistant mode 下，brief 会被强制开启，但 Sleep 不会被 assistant 本身强开

源码镜像：[`../../src/main.tsx`](../../src/main.tsx)

`main.tsx` 里写得很清楚：

- assistant mode 可 force brief on
- 但 `SleepTool` 仍然“stays disabled”
- 真正是否可用仍取决于 proactive gate

这说明 Claude Code 明确把：

- `assistant / kairos`
- `brief`
- `sleep`

看成三条相关但不等价的能力线。

## 3. 从 prompt contract 看，`SleepTool` 的产品定位就是“无事可做时的低成本挂起”

源码镜像：[`../../src/tools/SleepTool/prompt.ts`](../../src/tools/SleepTool/prompt.ts)

当前可见 prompt contract 非常直接：

- `Wait for a specified duration`
- user can interrupt any time
- 可以在 nothing to do / waiting for something 时使用
- 优先于 `Bash(sleep ...)`
- wake-up 有 API 成本，要和 5 分钟 prompt cache 过期一起权衡

所以它不是“为了模拟 Bash sleep 的对等工具”，而是专门为 autonomous/proactive loop 设计的低副作用等待原语。

## 4. system prompt 甚至把它上升成 proactive 模式下的强制 idle protocol

源码镜像：[`../../src/constants/prompts.ts`](../../src/constants/prompts.ts)

在 proactive/assistant 提示词里，Claude Code 明确要求：

- 会收到 `<tick>` prompt
- 用 `Sleep` 控制等待时长
- 如果 tick 到来且没事做，**必须**调用 `Sleep`
- 不允许只回 “still waiting / nothing to do” 这类文本

这说明在产品语义里，`SleepTool` 不是可有可无的 convenience tool，而是 proactive 自回环里的正式 idle transition。

## 5. `<tick>` prompt 才是它的上游驱动器，Sleep 只是把 tick-to-tick 间隔显式工具化

源码镜像：[`../../src/constants/prompts.ts`](../../src/cli/print.ts)

headless/proactive 路径会在队列空的时候注入：

- `<${TICK_TAG}>${localTime}</${TICK_TAG}>`

系统 prompt 又要求模型用 `Sleep` 回答这些 tick。

所以这条链不是：

- “模型自己偶尔想睡就睡”

而是：

- runtime 注入 tick
- model 在 tick 上决定有事做还是 Sleep
- Sleep 再控制下一次有效唤醒窗口

## 6. 当前镜像里看不到 `SleepTool` 主体，但能确认它是唯一被宿主当作 `interruptBehavior: 'cancel'` 典型案例的工具

源码镜像：[`../../src/Tool.ts`](../../src/Tool.ts), [`../../src/utils/handlePromptSubmit.ts`](../../src/utils/handlePromptSubmit.ts), [`../../src/services/tools/StreamingToolExecutor.ts`](../../src/services/tools/StreamingToolExecutor.ts)

`Tool.ts` 定义了：

- `interruptBehavior(): 'cancel' | 'block'`

`handlePromptSubmit.ts` 和 `StreamingToolExecutor.ts` 的注释都把 `SleepTool` 当成 `'cancel'` 的典型：

- 用户新提交消息时
- 只要当前 running tools 全是 `interruptBehavior === 'cancel'`
- 就直接 `abortController.abort('interrupt')`

而 executor 侧又会把：

- `signal.reason === 'interrupt'`
- 且 tool interruptBehavior 是 `cancel`

解释成：

- `user_interrupted`

这条链已经足够说明：Sleep 的宿主语义不是“消息排队等它结束”，而是“新消息可以直接把这次等待作废”。

## 7. 这就是为什么 `Sleep` 会和普通长工具产生不同的输入体验

源码镜像：[`../../src/utils/handlePromptSubmit.ts`](../../src/services/tools/StreamingToolExecutor.ts)

对 block 型工具，用户新消息只是进队列。

对 Sleep 这类 cancel 型工具，用户新消息会：

- 触发 `abort('interrupt')`
- 丢弃当前 sleep result
- 然后继续处理新输入

所以在 operator 体验上，Sleep 更像“软挂起状态”，而不是占住前台的活动任务。

## 8. `QueuePriority` 注释还明确写了：`next/later` 队列都可以唤醒 in-progress Sleep

源码镜像：[`../../src/types/textInputTypes.ts`](../../src/types/textInputTypes.ts), [`../../src/query.ts`](../../src/query.ts)

类型注释里直接写着：

- `next` wakes an in-progress SleepTool
- `later` 也 wakes an in-progress SleepTool

`query.ts` 里的实际实现则是：

- 如果本轮 tool-use 里出现过 `Sleep`
- `getCommandsByMaxPriority('later')`
- 否则只 drain 到 `next`

这意味着 Sleep 改变了 queued command 的 attach 阈值：它把通常要“下个 turn 才处理”的 later 级命令提前挂回当前 loop。

## 9. 这条“Sleep flush” 不是抽象优化，而是为后台通知设计的

源码镜像：[`../../src/query.ts`](../../src/query.ts)

`query.ts` 的注释已经把原因讲明白了：

- 一些后台任务通知默认还是 `later`
- 没有 Sleep flush，这些通知就只能等 turn 完结
- 有了 Sleep，later 级通知可以在同一轮 loop 里附着回来

所以 Sleep 在 Claude Code 里还有一层隐藏职责：

- 充当“允许稍后优先级命令提早回流”的 loop boundary marker

## 10. `REPL` 还专门为 Sleep 做了 spinner 抑制，说明它不该被看成“正在忙”

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx)

REPL 会计算：

- `onlySleepToolActive`

如果最后一个 assistant message 中所有 in-progress tool_use 都是 `Sleep`，就：

- 隐藏 spinner

这说明产品层认为：

- 正在 `Sleep`

并不等于：

- 正在积极计算、需要给用户忙碌反馈

Sleep 更接近一种“静默等待态”。

## 11. `REPL` 里还有一句关键注释：`proactive tick -> Sleep -> tick` 会饿死 scheduler，所以 assistant mode 要绕过 loading gate

源码镜像：[`../../src/screens/REPL.tsx`](../../src/screens/REPL.tsx), [`../../src/hooks/useScheduledTasks.ts`](../../src/hooks/useScheduledTasks.ts)

`useScheduledTasks` 的 assistantMode 旁边写得很直白：

- 如果不绕过 `isLoading`
- proactive `tick -> Sleep -> tick` loop 会让 scheduler 饥饿

这说明 Sleep 不是孤立工具，它已经和 cron/scheduled task 子系统产生了真实调度耦合。Claude Code 甚至要为了它调整 `useScheduledTasks` 的 fire gate。

## 12. headless path 的 proactive tick loop和 REPL path 共享同一条核心语义

源码镜像：[`../../src/cli/print.ts`](../../src/main.tsx)

`print.ts` 在 headless path 下：

- 队列空时注入 `<tick>`
- `setTimeout(0)` 让 stdin/control_request 先处理
- 然后 `run()`

这和 REPL 中的 proactive 思路一致：Sleep 的存在前提不是 UI，而是“队列空时还有 autonomous loop 要继续”。

## 13. `channelNotification` 还把 Sleep 当成 channel message 唤醒机制的一部分

源码镜像：[`../../src/services/mcp/channelNotification.ts`](../../src/services/mcp/channelNotification.ts)

channel inbound notification 的注释写着：

- handler 把消息 enqueue
- `SleepTool polls hasCommandsInQueue() and wakes within 1s`

即便我们当前看不到 SleepTool 主体，也能确认：

- 它内部不只是单次 timeout
- 还至少会感知 command queue 是否已有新消息

这再次说明 Sleep 的真实职责是 “可被外部事件唤醒的等待”，不是死等到毫秒数结束。

## 14. 被唤醒的外部事件并不只有人类输入，还包括 system-generated meta commands

源码镜像：[`../../src/utils/messageQueueManager.ts`](../../src/cli/print.ts), [`../../src/hooks/useScheduledTasks.ts`](../../src/services/mcp/channelNotification.ts)

队列里会进入很多 `isMeta` 命令：

- proactive ticks
- scheduled task fires
- channel messages
- plan verification 等系统事件

而 `Sleep` 恰好是这些“无须立即打断整轮、但需要把 autonomously-idle 状态唤醒”的主要桥梁。

## 15. `Sleep` 还被列进 auto-mode 安全白名单，说明它被视为低风险控制工具

源码镜像：[`../../src/utils/permissions/classifierDecision.ts`](../../src/tools/SleepTool/prompt.ts)

`SAFE_YOLO_ALLOWLISTED_TOOLS` 显式包含：

- `SLEEP_TOOL_NAME`

所以在 auto mode classifier 的 worldview 里，Sleep 不是高风险 execution，而是和：

- read/search
- task metadata
- plan-mode UI tools

同级的安全控制面。

## 16. 这和 prompt contract 其实是一致的：Sleep 不触碰文件、网络或外部副作用

虽然主体实现不可见，但从已知外围 contract 看，它至少满足：

- 不需要 shell process
- 不被当成 destructive
- 不需要额外 permission surface
- 可以被随时 cancel

这解释了为什么它会进入 auto-mode allowlist。

## 17. `Sleep` 的一个重要产品目的，是替代 `Bash(sleep ...)` 这类“占壳等待”

源码镜像：[`../../src/tools/SleepTool/prompt.ts`](../../src/tools/SleepTool/prompt.ts)

prompt 里明确说：

- Prefer this over `Bash(sleep ...)`
- it doesn't hold a shell process

这不是文案优化，而是宿主资源模型的不同：

- Bash sleep 会持有 shell host
- 会被 transcript/progress/UI 当成普通执行工具
- 还会和 shell task output/kill path 混在一起

而 Sleep 被做成独立工具，就是为了让“等待”从 shell execution 语义中剥离出来。

## 18. 当前镜像里没有 `SleepTool` 主体，也因此有几件事不能伪造

当前无法从源码镜像直接确认：

- input schema 是否是秒/毫秒/自然语言
- tool result 文案
- progress tick 是否每秒发一条 tool_result
- queue polling 的具体实现方式
- `hasCommandsInQueue()` 是怎样被调用的

这些都只能从外围注释推断“存在这样的机制”，不能在本文中当成已验证事实硬写进去。

## 19. 但已可确定的外围 runtime 已经足够说明它的功能级位置

即便主体缺失，当前镜像已经能稳定证明：

- Sleep 只在 proactive/kairos 上下文暴露
- 它是 proactive tick loop 的正式 idle primitive
- 它支持被用户输入和队列事件中断/唤醒
- 它改变 queue drain threshold
- 它抑制 REPL spinner
- 它和 scheduled tasks / channel messages 存在调度耦合
- 它在 permission/classifier 里被视为安全工具

所以它在 Claude Code 里的真正身份不是“等一会儿的小工具”，而是 autonomous host 的：

- interruptible idle state
- low-cost keepalive primitive
- queue wake boundary

## 20. 因此这篇最准确的结论应该是：

`SleepTool` 在当前源码镜像里仍然是“主体部分缺失，但外围 runtime 极其清晰”的半显式工具族成员。它的已证实部分已经足够独立成卷：

- upstream 由 `<tick>` 和 proactive activation 驱动
- midstream 受 `interruptBehavior: 'cancel'` 和 queue wake 规则控制
- downstream 影响 scheduler、channel notifications、spinner、以及 current-turn attachment drain

也就是说，Claude Code 已经把 “等待” 从普通工具执行中抽成了一种专门的 autonomous control runtime，只是这份镜像还没有把 `SleepTool` 主体源码一起带出来。
