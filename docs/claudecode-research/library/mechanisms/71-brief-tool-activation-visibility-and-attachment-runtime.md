# BriefTool / Activation / Visibility / Attachment Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：BashTool Runtime`](./70-bash-tool-sandbox-permission-and-transcript-runtime.md) | [`下一站：TaskCreate / TaskList / TaskGet / TaskUpdate Runtime`](./33-task-create-list-get-update-runtime.md)

`SendUserMessage` 看起来像一个简单消息工具，但在 Claude Code 里它其实承载了另一套“用户真正能看见什么”的显示协议。真正把 brief mode 变成独立运行时的，不只是 `BriefTool.ts`，而是下面这一串模块一起工作：

- `BriefTool.ts`
- `prompt.ts`
- `attachments.ts`
- `upload.ts`
- `commands/brief.ts`
- `components/Messages.tsx`
- `screens/REPL.tsx`
- `constants/prompts.ts`
- `UI.tsx`

它们拼起来，才是 Claude Code 的 brief-only visibility runtime。

## 1. `BriefTool` 先把 feature gate 拆成 `entitled` 和 `enabled` 两层

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/BriefTool.ts`](../../sources/claude-code/src/tools/BriefTool/BriefTool.ts)

`BriefTool` 没把“能不能用”压成一个布尔值，而是明确拆成：

- `isBriefEntitled()`
- `isBriefEnabled()`

前者回答“当前 build/账号/宿主有没有资格使用 brief”，后者回答“这一轮会话里工具是否真的挂进工具池”。两层 gate 的输入也不同：

- `isBriefEntitled()` 看 `KAIROS / KAIROS_BRIEF`、GrowthBook、`CLAUDE_CODE_BRIEF`、assistant mode
- `isBriefEnabled()` 再叠一层 `getKairosActive() || getUserMsgOptIn()`

所以 brief 在 Claude Code 里不是普通 UI 功能，而是一条受权限和产品开关共同治理的 capability。

## 2. brief mode 的真实状态源不是 `/brief`，而是统一汇流的 `userMsgOptIn`

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/BriefTool.ts`](../../sources/claude-code/src/tools/BriefTool/BriefTool.ts), [`../../sources/claude-code/src/commands/brief.ts`](../../sources/claude-code/src/commands/brief.ts)

代码里已经把激活来源写死：

- `--brief`
- `defaultView: 'chat'`
- `/brief`
- `/config` 里的 defaultView picker
- `--tools` / SDK `tools`
- `CLAUDE_CODE_BRIEF`
- assistant mode 的 `kairosActive`

这些入口不会各自维护一份状态，而是统一汇到：

- `getUserMsgOptIn()`
- `setUserMsgOptIn(...)`

也就是说，brief mode 的“真相源”在 bootstrap state，而不是 slash command 本身。

## 3. `/brief` 命令做的不是简单视图切换，而是让工具池和 transcript 协议一起换挡

源码镜像：[`../../sources/claude-code/src/commands/brief.ts`](../../sources/claude-code/src/commands/brief.ts), [`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

`/brief` 最关键的动作不是改 `isBriefOnly`，而是同时：

- `setUserMsgOptIn(newState)`
- `context.setAppState(... isBriefOnly: newState ...)`

代码里对原因写得很明确：

- brief 开关会改变 tool list
- 如果 mid-session 不重算工具集，模型会继续按旧模式输出
- brief 打开后 plain text 可能被 `filterForBriefTool(...)` 直接隐藏

所以 `/brief` 真正切换的是：

- 工具可用性
- 模型系统提示词
- transcript 可见性规则

而不是单纯把列表渲染成 chat view。

## 4. `BRIEF_TOOL_PROMPT` 明确把 `SendUserMessage` 定义成“真实答案通道”

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/prompt.ts`](../../sources/claude-code/src/tools/BriefTool/prompt.ts), [`../../sources/claude-code/src/constants/prompts.ts`](../../sources/claude-code/src/constants/prompts.ts)

`BRIEF_TOOL_PROMPT` 和 `BRIEF_PROACTIVE_SECTION` 说的是同一件事：

- brief mode 下，用户真正会读到的回答应该走 `SendUserMessage`
- tool 外普通文本只是 detail-view 可见，不应承担主答案

这也是为什么 `constants/prompts.ts` 会在启用 `KAIROS / KAIROS_BRIEF` 时，把 `getBriefSection()` 作为系统提示词动态段接进去。brief 不是 UI-only 选择，而是 model-facing output contract。

## 5. `BriefTool` 自己是只读工具，但它携带了一条用户可见附件通道

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/BriefTool.ts`](../../sources/claude-code/src/tools/BriefTool/BriefTool.ts), [`../../sources/claude-code/src/tools/BriefTool/attachments.ts`](../../sources/claude-code/src/tools/BriefTool/attachments.ts)

`BriefTool` 明确声明：

- `isReadOnly() === true`
- `isConcurrencySafe() === true`

但它又支持：

- `message`
- `attachments`
- `status = normal | proactive`

这说明它的副作用不在本地文件系统，而在“向用户投递可见消息”这条产品面。附件也不是直接吞路径，而是先：

- `validateAttachmentPaths(...)`
- `resolveAttachments(...)`

把原始输入提升成：

- `path`
- `size`
- `isImage`
- 可选 `file_uuid`

所以 BriefTool 本质上是一条 user-facing delivery channel。

## 6. attachment runtime 刻意分成“本地 stat 真相”和“bridge upload 增强”两层

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/attachments.ts`](../../sources/claude-code/src/tools/BriefTool/attachments.ts), [`../../sources/claude-code/src/tools/BriefTool/upload.ts`](../../sources/claude-code/src/tools/BriefTool/upload.ts)

`resolveAttachments(...)` 先串行 `stat`，再按需并行上传。分层很明确：

- 本地 `stat` 填 `size/isImage`，并保证顺序稳定
- bridge upload 只是给远端 viewer 增强预览能力

上传失败时，附件仍保留：

- `path`
- `size`
- `isImage`

这样本地终端和同机桌面仍可渲染；只有 web viewer 需要 `file_uuid`。这是典型的“本地路径真相 + 远端预览 sidecar”设计。

## 7. `upload.ts` 不是普通文件上传，而是专门给 bridge/web viewer 准备的 sidecar 协议

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/upload.ts`](../../sources/claude-code/src/tools/BriefTool/upload.ts)

上传层有几条非常明确的边界：

- 只有 `BRIDGE_MODE` 构建保留这段逻辑
- 只有 `replBridgeEnabled` 或 `CLAUDE_CODE_BRIEF_UPLOAD` 才实际上传
- `30MB` 以上直接跳过
- 图片 MIME 只认窄白名单
- 失败统一降级成 `undefined`

它的目标不是保证附件一定能在云端打开，而是：

- 当 viewer 不在本机时，尽量补一个 `file_uuid`

这属于 brief mode 特有的多宿主可见性层。

## 8. `UI.tsx` 明确把同一个结果渲染成三套不同宿主语法

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/UI.tsx`](../../sources/claude-code/src/tools/BriefTool/UI.tsx)

`renderToolResultMessage(...)` 至少分三条路径：

- `isTranscriptMode`
- `isBriefOnly`
- default view

差异不是颜色，而是整套阅读协议：

- transcript mode 保留 `⏺` gutter，把它当显式 tool event
- brief-only mode 改成 `Claude + timestamp` 的 chat label
- default view 刻意抹掉 tool chrome，把消息读成普通回答

所以 `SendUserMessage` 的视觉真相不是唯一的，而是被宿主模式重解释。

## 9. `renderToolUseMessage()` 故意返回空，说明 brief 不想把“调用动作”前台化

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/UI.tsx`](../../sources/claude-code/src/tools/BriefTool/UI.tsx)

和大多数工具不同，`renderToolUseMessage()` 这里直接返回空。含义很明确：

- 用户不需要看到“模型准备发送一条可见消息”
- 真正需要前台显示的是已经送达的内容

这和 `BashTool`、`AgentTool` 这类强调过程可见性的工具是不同路线。

## 10. `Messages.tsx` 的 brief filter 不是美化层，而是 hard visibility contract

源码镜像：[`../../sources/claude-code/src/components/Messages.tsx`](../../sources/claude-code/src/components/Messages.tsx)

`filterForBriefTool(...)` 的规则非常硬：

- assistant plain text 默认丢弃
- 只保留 brief tool_use
- 只保留对应的 tool_result
- 真实用户输入保留
- 部分 system message 保留

代码里甚至明确说了：

- 如果模型忘了调用 Brief，用户这一轮可能什么都看不到
- filter 不会替模型补救

也就是说，brief mode 不是“帮普通回答换个壳”，而是把 transcript 重定义成“只认 SendUserMessage 为主答案”。

## 11. REPL 把 `isBriefOnly` 放进工具列表依赖，是为了避免 mid-session 空白回合

源码镜像：[`../../sources/claude-code/src/screens/REPL.tsx`](../../sources/claude-code/src/screens/REPL.tsx)

`REPL.tsx` 专门把 `isBriefOnly` 加进：

- `useMemo(() => getTools(...), [...])`

原因是：

- `BriefTool.isEnabled()` 实际读取 bootstrap state
- `/brief` 会在会话中途翻转这个状态
- 如果 React 看不到这个依赖变化，tool list 会 stale

最终会导致一种很糟糕的状态：

- transcript 过滤已经开启
- 工具列表里却没有 `SendUserMessage`
- 模型继续发 plain text
- 用户看到空白回合

所以这里不是性能细节，而是 load-bearing 修复。

## 12. `status = proactive` 不是文案标签，而是 brief mode 的产品语义位

源码镜像：[`../../sources/claude-code/src/tools/BriefTool/BriefTool.ts`](../../sources/claude-code/src/tools/BriefTool/BriefTool.ts), [`../../sources/claude-code/src/tools/BriefTool/prompt.ts`](../../sources/claude-code/src/tools/BriefTool/prompt.ts)

`status` 只有两个值：

- `normal`
- `proactive`

但 prompt 已经把它定义成：

- 是在回复用户刚说的话
- 还是在主动推送完成、阻塞、状态更新

调用时还会记录：

- `tengu_brief_send`
- `proactive`
- `attachment_count`

所以这不是附属文案，而是整个 proactive/away/background 工作流里的路由元数据。

## 13. 关闭 brief 时，系统会显式提醒模型回到 plain text 通道

源码镜像：[`../../sources/claude-code/src/commands/brief.ts`](../../sources/claude-code/src/commands/brief.ts)

`/brief` 切换后不会只改状态，还会通过 `metaMessages` 注入明确的 `system-reminder`：

- 打开时提醒“所有 user-facing output 必须走 `SendUserMessage`”
- 关闭时提醒“工具不可用了，应改回 plain text”

这说明 Claude Code 没打算让 brief 和普通模式“模糊兼容”，而是把它们当成两套明确不同的输出协议。

## 14. 从运行时角度看，`BriefTool` 实际上是 Claude Code 的第二条回答总线

把这些层连起来看，`SendUserMessage` 根本不是“发一条消息”：

- entitlement / opt-in / kill-switch
- tool availability
- system prompt contract
- transcript filtering
- bridge-aware attachment delivery
- multi-host UI rendering
- proactive status metadata

它和普通 assistant text 并列，构成 Claude Code 的第二条用户输出总线。brief mode 的复杂度不在 Markdown，而在“谁才算用户真正看见的答案”。
