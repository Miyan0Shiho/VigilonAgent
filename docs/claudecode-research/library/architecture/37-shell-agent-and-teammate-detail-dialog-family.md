# Shell / Agent / Teammate Detail Dialog Family

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Remote Session Detail / Background Task Operator Surfaces`](./36-remote-session-detail-and-background-task-operator-surfaces.md) | [`下一站：LocalAgentTask / Retention / Panel / Notification Runtime`](../mechanisms/53-local-agent-task-retention-panel-and-notification-runtime.md)

`BackgroundTasksDialog` 把后台对象分成多个宿主以后，detail 层并没有继续走一个统一模板。当前源码里至少有三种并列的本地详情面：

- `components/tasks/ShellDetailDialog.tsx`
- `components/tasks/AsyncAgentDetailDialog.tsx`
- `components/tasks/InProcessTeammateDetailDialog.tsx`

这一卷只讲这三份 dialog 如何共享一套终端交互语法，但又各自承认不同的 host truth。

## 1. `BackgroundTasksDialog` 在 detail route 上显式分宿主，不存在“统一 detail 模板”

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

进入 `viewState.mode === 'detail'` 后，路由是硬编码分叉的：

- `local_bash -> ShellDetailDialog`
- `local_agent -> AsyncAgentDetailDialog`
- `in_process_teammate -> InProcessTeammateDetailDialog`
- `remote_agent -> RemoteSessionDetailDialog`

这说明 Claude Code 在 detail 层承认的不是“后台任务都长一样”，而是不同执行宿主各有独立观察面。

## 2. 三种 dialog 共享同一套终端 modal 语法

源码镜像：

- [`../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx)
- [`../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx)
- [`../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx)

三者都复用了同一套外壳协议：

- 外层是 `Box(tabIndex=0, autoFocus, onKeyDown=...)`
- 内层是 `Dialog`
- 都注册 `confirm:yes -> onDone`
- 都把 `Esc/Enter/Space` 作为关闭主动作
- 都支持 `←` 返回 list

也就是说，detail family 在交互壳上是统一 modal grammar，在内容与动作面上才分宿主。

## 3. `ShellDetailDialog` 的 host truth 是“命令 + 输出文件尾部”，不是 activity timeline

源码镜像：[`../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx)

这份 dialog 首先展示的是：

- `Status`
- `Runtime`
- `Command` 或 `Script`
- `Output`

它不看 `recentActivities`，也不解释 tool use。因为 shell host 的真实观测面是：

- 进程是否还在跑
- 退出码是多少
- 命令长什么样
- 输出文件当前尾部是什么

所以它本质上是一个 output-tail viewer。

## 4. shell detail 用 `tailFile()` + `Suspense` + `useDeferredValue` 维持低抖动输出预览

源码镜像：[`../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx)

它没有直接把整个输出文件读进内存，而是：

- `getTaskOutputPath(shell.id)`
- `tailFile(path, 8192)`
- running 时每秒 `setInterval(...)` 重新取尾部
- `useDeferredValue(outputPromise)` 保持上一次已解析内容，避免 fallback 闪烁
- `Suspense` 只包 output 区

这条链说明 shell detail 的设计目标不是“最准实时日志台”，而是“低抖动、低成本地看最近几 KB”。

## 5. shell 输出视图故意只保留最后 10 行，并明确告诉你它是不完整的

源码镜像：[`../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/ShellDetailDialog.tsx)

`ShellOutputContent` 会：

- 只找最后 10 个换行边界
- 用 `bytesTotal > content.length` 判断 `isIncomplete`
- 以固定 `height={12}` 的 rounded box 渲染
- footer 明写 `Showing N lines`
- 若截断则追加 `of <filesize>`

所以这个 detail 从协议上就在声明：它是 tail preview，不是完整 transcript，也不是可滚动日志浏览器。

## 6. `AsyncAgentDetailDialog` 的 host truth 是“agent 进度摘要”，不是输出文件

源码镜像：[`../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx)

local async agent 的 detail 重点变成了：

- 标题：`selectedAgent.agentType` + `description`
- 副标题：`status + elapsed + token count + tool count`
- `recentActivities`
- `plan` 或截断后的 `prompt`
- 失败时的 `error`

这说明本地 agent detail 的宿主真相是“这名 agent 最近做了什么、消耗了多少、现在到哪一步”，而不是 shell 式输出流。

## 7. async agent detail 先把 prompt 解释成“计划对象”，再退回普通文本

源码镜像：[`../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx)

这份 dialog 不会无脑展示 `prompt` 原文，而是先：

- `extractTag(agent.prompt, 'plan')`
- 若命中，则用 `UserPlanMessage`
- 否则才展示截断后的 prompt 文本

这说明 local agent detail 并不把 prompt 当成一串字符串，而是优先承认“计划”这种更高层的产品对象。

## 8. async agent detail 的 progress 是 tool activity timeline，不是 shell stdout

源码镜像：

- [`../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/AsyncAgentDetailDialog.tsx)
- [`../../sources/claude-code/src/components/tasks/renderToolActivity.tsx`](../../sources/claude-code/src/components/tasks/renderToolActivity.tsx)

running 时它会读取：

- `agent.progress.recentActivities`
- 用 `renderToolActivity(activity, tools, theme)` 做文本化解释

这说明它想给 operator 看的不是“工具返回了哪些原始字节”，而是“agent 最近在读、搜、调、跑什么”。

## 9. `InProcessTeammateDetailDialog` 继承 agent 摘要骨架，但把 swarm 身份和前台切换做成一级动作

源码镜像：[`../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx)

teammate detail 和 async agent detail 有明显同构：

- 都有 elapsed/tokens/tools 副标题
- 都有 `recentActivities`
- 都展示 prompt
- 失败时都展示 error

但它又多承认了两件本地 agent 不需要承认的事：

- 标题必须带 `@agentName` 和身份色
- running 时必须暴露 `foreground` 动作

这说明 teammate detail 不是“另一个 local agent detail”，而是 swarm runtime 的 operator surface。

## 10. `describeTeammateActivity()` 让 teammate detail 的标题直接携带 swarm 状态语义

源码镜像：

- [`../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx)
- [`../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx`](../../sources/claude-code/src/components/tasks/taskStatusUtils.tsx)

标题行除了 `@agentName` 之外，还会补：

- `({activity})`

这个 activity 不是普通 status label，而是 teammate-specific 摘要。也就是说，swarm 成员的详情页在标题层就已经把“它现在在忙什么”编码进了身份面。

## 11. `f` 是 teammate detail 独有的产品动作，表示“从摘要观察切回 transcript 前台”

源码镜像：

- [`../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/InProcessTeammateDetailDialog.tsx)
- [`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

当 teammate 仍在 running 时：

- detail 的 input guide 会出现 `f = foreground`
- `BackgroundTasksDialog` 会把它接成 `enterTeammateView(task.id, setAppState)`

所以 `f` 不是局部 UI 手势，而是从后台 detail surface 跳回前台 transcript ownership 的桥。

## 12. 三类 detail 的 stop 语义也不同

源码镜像：[`../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx`](../../sources/claude-code/src/components/tasks/BackgroundTasksDialog.tsx)

三类 detail 都会在 running 时显示 `x`，但真正接的 kill path 不一样：

- shell：`killShellTask(task.id)`
- local agent：`killAgentTask(task.id)`
- teammate：`killTeammateTask(task.id)`

看起来按键一致，但动作是按宿主专门路由的。这进一步说明 detail family 共享的是 operator grammar，不共享执行语义。

## 13. 这一 family 的信息密度也是分层的

可以把它们理解成三种不同的摘要密度：

- `ShellDetailDialog`
  - 命令、退出码、输出尾部
  - 面向 process/output host
- `AsyncAgentDetailDialog`
  - tool activity、plan/prompt、token/tool count
  - 面向 local async reasoning host
- `InProcessTeammateDetailDialog`
  - agent 摘要 + swarm identity + foreground handoff
  - 面向 teammate/operator host

所以这不是 UI 风格差异，而是三种宿主真相的不同压缩方式。

## 14. 这篇和 `08`、`36`、`53` 的边界

`08` 讲的是：

- task / remote / agent detail 整体装配关系

`36` 讲的是：

- `remote_agent` 后台目录与 remote-specific operator surfaces

这一篇讲的是：

- local shell / local async agent / in-process teammate 三种 detail dialog family
- 它们共享的 modal grammar
- 它们各自承认的 host truth

而 `53` 继续往下讲的是：

- `LocalAgentTask` 本身怎样 retain、通知、驱逐、进入 panel 与 transcript

也就是说，`37` 是 detail surface family，`53` 是 local-agent host lifecycle。
