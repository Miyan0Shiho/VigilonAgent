# Swarm Banner / Direct Messages / Mailbox Surfaces

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Preview Toggle / Transcript Routing / Auto-Exit`](./23-preview-toggle-transcript-routing-and-auto-exit.md) | [`下一站：Permission Request Queue / Dialog Surfaces`](./25-permission-request-queue-and-dialog-surfaces.md)

本文继续下钻 swarm 前台，但不再讲 transcript route，而是专门拆“用户怎么看到当前 swarm 身份、`@agent` 消息怎么绕过模型直发、mailbox 消息怎么从文件与运行时队列汇流回 transcript”这条表面链：`useSwarmBanner.ts`、`directMemberMessage.ts`、`PromptInput.tsx`、`teammateMailbox.ts`、`useInboxPoller.ts`、`attachments.ts`、`AttachmentMessage.tsx`、`context/mailbox.tsx`、`utils/mailbox.ts`。

## 1. 这层解决的是“swarm 内消息如何被看见和投递”，不是 teammate 如何被创建

源码镜像：[`../../src/components/PromptInput/useSwarmBanner.ts`](../../src/components/PromptInput/useSwarmBanner.ts), [`../../src/utils/directMemberMessage.ts`](../../src/utils/directMemberMessage.ts), [`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/components/messages/AttachmentMessage.tsx`](../../src/components/messages/AttachmentMessage.tsx), [`../../src/context/mailbox.tsx`](../../src/context/mailbox.tsx), [`../../src/utils/mailbox.ts`](../../src/utils/mailbox.ts)

前几卷已经把这些讲清了：

- teammate 如何 spawn、discover、retain、view
- preview toggle 和 transcript routing 如何决定输入发给谁

这一卷继续回答更贴近用户表面的几个问题：

- 顶部 banner 到底在显示 leader、teammate、还是 viewed local agent
- `@agent-name hello` 为什么不是普通 prompt，而是绕过模型的 peer DM
- 文件 mailbox、`AppState.inbox`、内存 mailbox 三套东西各自负责哪一段
- 为什么某些 mailbox 消息会进 transcript，而另一些必须保留给 poller 路由

所以它是 swarm 的 message-surface 协议层。

## 2. `useSwarmBanner()` 说明 banner 不是纯装饰，而是当前输入所有权和 swarm 拓扑的压缩读数

源码镜像：[`../../src/components/PromptInput/useSwarmBanner.ts`](../../src/components/PromptInput/useSwarmBanner.ts)

`useSwarmBanner()` 不是简单读一个名字字段，而是先把当前会话分成几种互斥状态：

- 外部 teammate：显示 `@agentName`
- leader 且已有 teammates，但当前不在 tmux / native panes / in-process：显示 `tmux -L ... a`
- leader 正在看某个 teammate：显示被看的 `@agentName`
- leader 正在看某个 `local_agent`：反查 `agentNameRegistry` 后显示 `@name`
- standalone agent：显示 `/rename` / `/color` 派生的 banner
- `--agent` CLI flag：显示 agent type

这说明 banner 的职责不是“渲染昵称”，而是把当前输入面板实际控制的是谁、该去哪里看队友、当前 foreground 的是不是 named agent，一次性压缩成一行。

## 3. tmux attach hint 说明 leader UI 明确承认“有些 swarm 不在当前前台里”，而不是假装所有 teammate 都能内嵌显示

源码镜像：[`../../src/components/PromptInput/useSwarmBanner.ts`](../../src/components/PromptInput/useSwarmBanner.ts)

当满足这些条件时：

- `teamContext` 里已有 teammates
- 但当前不在 tmux
- 也不在 in-process mode
- 也不是 native panes backend

banner 不会硬显示某个 agent 名，而是退回：

- `View teammates: \`tmux -L ${getSwarmSocketName()} a\``

这说明 Claude Code 的 swarm UX 没把外部 pane backend 伪装成同一套内联 transcript，而是明确告诉用户“队友实际在别的 pane 世界里”。

## 4. `parseDirectMemberMessage()` 说明 `@agent` 前缀是一条独立输入协议，不是普通 prompt 上的字符串约定

源码镜像：[`../../src/utils/directMemberMessage.ts`](../../src/utils/directMemberMessage.ts)

它只接受这种语法：

- `@recipientName whitespace message`

并且做了几层硬约束：

- recipient 只能匹配 `[\w-]+`
- 必须有至少一个空白分隔
- message 会被 trim，空消息直接拒绝

所以 `@agent hi` 在这里不是 prompt engineering 语义，而是一个正式的 input subprotocol。

## 5. `sendDirectMemberMessage()` 说明 peer DM 的真正语义是“写 mailbox”，不是“替用户发起一轮模型对话”

源码镜像：[`../../src/utils/directMemberMessage.ts`](../../src/utils/directMemberMessage.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

这条链非常硬：

- 必须有 `teamContext`
- 必须注入 `writeToMailbox`
- recipient 必须能在 `teamContext.teammates` 里按名字找到

成功后做的事情只有一件：

- 写入 `{ from: "user", text, timestamp }` 到 recipient mailbox

没有：

- model call
- tool dispatch
- transcript routing
- leader 中转生成

所以 `@agent` DM 本质上是用户向 swarm 邮箱总线直接投递一封信。

## 6. `PromptInput` 说明这条协议是“优先级高于普通 submit 的早分流”，成功后整轮 prompt 会被短路

源码镜像：[`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/utils/directMemberMessage.ts`](../../src/utils/directMemberMessage.ts)

`PromptInput` 在正常 submit 路由之前就会：

- 检查 agent swarms feature
- 尝试 `parseDirectMemberMessage(input)`
- 调 `sendDirectMemberMessage(...)`

如果成功：

- 显示 `Sent to @name`
- 清空 input 和 cursor / history 状态
- 直接 `return`

如果失败：

- `no_team_context`
- `unknown_recipient`

才会回退到普通 prompt 提交流程。

这说明 `@agent` DM 不是提交后的附加行为，而是一个能截断整轮 query 的高优先级 fast path。

## 7. `teammateMailbox.ts` 说明 swarm 邮箱的 durability layer 是“每个 teammate 一个 inbox 文件”，而不是 leader 内存态

源码镜像：[`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

文件层协议很明确：

- 路径：`~/.claude/teams/{team}/inboxes/{agent}.json`
- key 维度：team name + agent name
- 消息结构：`from/text/timestamp/read/color/summary`

核心原语有：

- `getInboxPath(...)`
- `readMailbox(...)`
- `readUnreadMessages(...)`
- `writeToMailbox(...)`
- `markMessageAsReadByIndex(...)`
- `markMessagesAsReadByPredicate(...)`

再加上 lockfile 重试，说明它被设计成多 Claude 并发读写时仍然能维持串行语义的 durable bus。

## 8. `useInboxPoller()` 说明 mailbox 文件不是直接渲染到前台，而是先经过“协议消息分类器”

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

poller 每秒读一次 unread mailbox，但不会把所有未读都当普通 teammate 文本，而是先拆成：

- permission requests / responses
- sandbox permission requests / responses
- shutdown requests / approvals
- team permission updates
- mode set requests
- plan approval requests / responses
- regular messages

这说明 mailbox 在系统里并不只是聊天信箱，而是同时承载：

- human/agent 文本消息
- worker permission RPC
- shutdown / mode / plan 审批协议

所以必须先 route，再决定哪些能进 transcript。

## 9. in-process teammate 不跑 `useInboxPoller()`，说明“共享 React 上下文”与“文件邮箱轮询”是两套互斥接收面

源码镜像：[`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/teammateContext.ts`](../../src/utils/teammateContext.ts)

`getAgentNameToPoll()` 第一件事就是：

- 如果 `isInProcessTeammate()`，返回 `undefined`

源码注释把原因讲得很直接：

- in-process teammate 走自己的 `waitForNextPromptOrShutdown()` 路线
- 它和 leader 共享 React context 与 AppState
- 如果再开 inbox poller，会把消息路由搞乱

这说明 mailbox 体系虽然统一成“message surface”，但接收端并不统一；in-process teammate 不是 file-polling consumer。

## 10. `isStructuredProtocolMessage()` 说明不是所有 mailbox 文本都能被模型看到，有一批必须保持“协议不可见”

源码镜像：[`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts)

系统明确把这些类型视为 structured protocol：

- `permission_request`
- `permission_response`
- `sandbox_permission_request`
- `sandbox_permission_response`
- `shutdown_request`
- `shutdown_approved`
- `team_permission_update`
- `mode_set_request`
- `plan_approval_request`
- `plan_approval_response`

`attachments.ts` 里会把这批消息从 mailbox attachment 候选里过滤掉，因为如果它们先被做成普通 transcript 附件，就永远到不了 `useInboxPoller()` 的专用 handler。

所以这里不是简单的“消息展示过滤”，而是协议正确性的关键护栏。

## 11. `getTeammateMailboxAttachments()` 说明 transcript 看到的 mailbox，不是原始 inbox 文件，而是“文件邮箱 + AppState.inbox”的桥接视图

源码镜像：[`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/state/AppState.tsx`](../../src/state/AppState.tsx)

这条桥接做了四件事：

- 从文件 mailbox 读 unread 非协议消息
- 从 `AppState.inbox.messages` 读 mid-turn pending 消息
- 只在 leader transcript 里并入 `AppState.inbox`
- 按 `from + timestamp + text prefix` 去重

这里最关键的设计是：

- 文件 mailbox 负责 turn 间 durability
- `AppState.inbox` 负责 turn 内即时可见

所以 transcript 里看到的“mailbox 消息”其实是一个 runtime-merged view。

## 12. `viewedTeammate || isInProcessTeammate()` 分支说明 leader inbox 不允许泄漏到 teammate transcript

源码镜像：[`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/state/selectors.ts`](../../src/state/selectors.ts)

如果当前：

- 正在看某个 teammate transcript
- 或当前进程本身就是 in-process teammate

那么 `pendingInboxMessages` 会直接变成空数组。

源码注释写得很清楚：

- `AppState.inbox` 里是发给 leader 的 mid-turn 消息
- viewed teammate 应该只看自己的 file mailbox
- in-process teammate 共享 leader 的 AppState，如果不屏蔽，会把 leader inbox 泄漏过去

这说明 message surface 的“谁能看见哪类 inbox”是显式隔离的。

## 13. idle collapse 说明 mailbox attachment 不是忠实镜像，而是会为了可读性主动做 UI 级压缩

源码镜像：[`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

在汇总所有消息后，系统会：

- 扫描 `idle_notification`
- 每个 agent 只保留最新一条

这样做的原因很直接：如果某个 teammate 高频发 idle ping，transcript 不应该被一堆等价心跳淹没。

所以 mailbox attachment 在 UI 层已经不是 raw log，而是读者友好的摘要面。

## 14. `AttachmentMessage` 说明 teammate mailbox 渲染不是“纯文本列表”，而是按内容类型再分层显示

源码镜像：[`../../src/components/messages/AttachmentMessage.tsx`](../../src/components/messages/AttachmentMessage.tsx)

`attachment.type === "teammate_mailbox"` 时，渲染器会再分四类：

- `shutdown_approved`、`idle_notification`、`teammate_terminated`：隐藏
- `task_assignment`：渲染成任务分配行
- plan approval request/response：走 `tryRenderPlanApprovalMessage(...)`
- 普通 teammate 文本：走 `TeammateMessageContent`

并且普通文本会消费：

- `msg.color`
- `msg.summary`
- `formatTeammateMessageContent(...)`

这说明 transcript 看到的 teammate mailbox 已经不是“附件里有一堆字符串”，而是一个小型消息子系统。

## 15. 只在构造完 attachment 后再 mark read，说明这里优先保证“不丢消息”，不是优先清空 inbox

源码镜像：[`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/utils/teammateMailbox.ts`](../../src/utils/teammateMailbox.ts)

`getTeammateMailboxAttachments()` 的顺序是：

1. 先聚合、去重、压缩所有消息
2. 先构造 `teammate_mailbox` attachment
3. 然后才 `markMessagesAsReadByPredicate(...)`

而且只标记：

- 非 structured protocol mailbox 消息

这说明该链明确优先防止“中途失败导致消息既没展示也被标已读”的丢失风险。

## 16. `context/mailbox.tsx` 和 `utils/mailbox.ts` 说明系统里还存在一层内存 mailbox，用于 React runtime 内的等待/派发，不等于 swarm inbox 文件

源码镜像：[`../../src/context/mailbox.tsx`](../../src/context/mailbox.tsx), [`../../src/utils/mailbox.ts`](../../src/utils/mailbox.ts)

这里有另一套更轻的抽象：

- `MailboxProvider` 在 React context 里 memo 一个 `new Mailbox()`
- `Mailbox` 自己维护 `queue`、`waiters`、`revision`
- 提供 `send / poll / receive / subscribe`

它和 `teammateMailbox.ts` 的关系不是上下替代，而是层级不同：

- `teammateMailbox.ts`：跨进程、跨会话、落磁盘、按 team+agent 定位
- `utils/mailbox.ts`：进程内、瞬时、给 runtime waiter / signal 用

所以 Claude Code 里的 mailbox 不是单数，而是“durable swarm inbox + in-memory runtime mailbox”双层结构。

## 17. 这条链最终说明 swarm message surface 实际上由四段协议拼起来

源码镜像：[`../../src/components/PromptInput/useSwarmBanner.ts`](../../src/components/PromptInput/useSwarmBanner.ts), [`../../src/components/PromptInput/PromptInput.tsx`](../../src/components/PromptInput/PromptInput.tsx), [`../../src/hooks/useInboxPoller.ts`](../../src/hooks/useInboxPoller.ts), [`../../src/utils/attachments.ts`](../../src/utils/attachments.ts), [`../../src/components/messages/AttachmentMessage.tsx`](../../src/components/messages/AttachmentMessage.tsx)

真正拼在一起工作的，是这四段：

- 身份压缩面：`useSwarmBanner()`
- 发送面：`@agent` -> `sendDirectMemberMessage()` -> `writeToMailbox()`
- 路由面：`useInboxPoller()` 对 structured protocol 与 regular message 分流
- 展示面：`getTeammateMailboxAttachments()` + `AttachmentMessage`

因此用户看到的“swarm 里发消息、收消息、看状态”并不是一个组件做完的，而是：

- banner 告诉你当前是谁
- direct message 决定消息是不是绕过模型
- poller 保证协议消息进对的 handler
- attachment bridge 再把可见消息安全地回流到 transcript

所以这篇不是 `PromptInput` 的补丁，而是 swarm message surface 的总装配图。
