# AskUserQuestion Schema / Preview / Operator Loop Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Plugin Skill Trust Boundaries / Hooks / Shell Runtime`](./67-plugin-skill-trust-boundaries-hooks-and-shell-runtime.md) | [`下一站：ExitPlanMode / Partially Visible ReviewArtifact Operator Loops`](./69-exit-plan-mode-and-partially-visible-review-artifact-operator-loops.md)

`13` 已经把 `AskUserQuestion` 作为工具家族的一员拆到机制层，但还没有把它真正作为“人机交互子系统”单独讲开。当前实现里，这个工具不只是返回几道选择题，它还连着：

- schema 与 preview 格式约束
- `requiresUserInteraction()` 带来的 permission queue 语义
- 本地多题表单对话框
- remote session detail 中的 CTA 摘要显示

这一卷只讲这条 operator loop。

## 1. `AskUserQuestion` 的真实产品定位不是普通 tool call，而是“让主会话停下来等待用户回答”

源码镜像：[`../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx)

这条工具有三个非常关键的声明：

- `shouldDefer: true`
- `requiresUserInteraction() { return true }`
- `checkPermissions() -> { behavior: 'ask', message: 'Answer questions?' }`

这说明它不是普通只读工具，也不是后台能默默完成的网络/文件调用，而是明确要求：

- 中断当前自动推进
- 把控制权还给用户
- 等用户答完再继续

所以它更接近“交互断点”而不是一般工具。

## 2. 它的输入 schema 本质上是一个小型问卷 DSL

源码镜像：[`../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx)

核心结构是：

- `questions[]`
- 每题有 `question / header / options / multiSelect`
- 每个 option 有 `label / description / preview?`
- 顶层还有 `answers / annotations / metadata`

这里的重点不是字段数量，而是它已经足以表达：

- 单选或多选
- 每个选项的解释
- 每个选项的预览内容
- 用户后续可能附上的 notes / preview annotation

也就是说，这不是“字符串问题 + 字符串答案”的弱协议，而是一套小型 operator interview DSL。

## 3. 工具在 schema 层就强制了一批 UI 友好的约束

源码镜像：[`../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx)

它在 schema 里直接卡住：

- `questions` 最多 `4`
- 每题 `options` 最少 `2`、最多 `4`
- 问题文本必须唯一
- 每题内部 option label 必须唯一
- `header` 要受 `ASK_USER_QUESTION_TOOL_CHIP_WIDTH` 限制

这说明 AskUserQuestion 的产品面从一开始就不是开放式 survey builder，而是刻意压成适合终端/侧栏弹窗的轻量问答面。

## 4. `preview` 不是永远可用字段，它受宿主 preview format gate 控制

源码镜像：[`../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../sources/claude-code/src/bootstrap/state.ts)

`description()` / `prompt()` 会先看：

- `getQuestionPreviewFormat()`

如果 preview format 未配置：

- 不向模型暴露 preview 相关提示

如果 preview format 是 `html`：

- 才启用带 preview 的协议说明
- `validateInput()` 还会额外校验 preview 内容

因此 `preview` 字段不是工具的硬保证，而是一个宿主能力协商结果。

## 5. HTML preview 还带一层意图验证，不接受 full document、script、style

源码镜像：[`../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx)

`validateHtmlPreview(...)` 明确拒绝：

- `<html>`
- `<body>`
- `<!DOCTYPE>`
- `<script>`
- `<style>`

也就是说，AskUserQuestion 的 preview 功能不是让模型随便吐一段网页，而是被限制成“可嵌入宿主的安全 HTML fragment”。

## 6. `isEnabled()` 里的 channels gate 说明它的关键宿主前提是“有人在键盘前”

源码镜像：[`../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../sources/claude-code/src/bootstrap/state.ts)

当：

- `KAIROS` / `KAIROS_CHANNELS` 开启
- 且 `getAllowedChannels().length > 0`

它会直接 `return false`。注释写得很直白：

- 用户可能在 Telegram/Discord，不在 TUI 前
- 多选弹窗会挂住

所以 AskUserQuestion 的核心宿主假设是：当前确实有人能现场交互。这和 headless/cron/channel relay 是不同的运行时。

## 7. 工具结果的最终语义不是“用户点了哪个 option”，而是“模型现在可以继续，且带着这些结构化回答”

源码镜像：[`../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`](../../sources/claude-code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx)

`mapToolResultToToolResultBlockParam(...)` 会把返回结果转换成一段明确的 continuation signal：

- `User has answered your questions: ... You can now continue ...`

并把：

- answer string
- selected preview
- user notes

一起编进 tool_result block。也就是说，它的真正价值在于把“人类回答”重新编码回模型可继续推理的结构化上下文。

## 8. 本地 permission UI 并不是简单列表，而是完整的多题状态机

源码镜像：[`../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx), [`../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.tsx`](../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/QuestionNavigationBar.tsx)

`AskUserQuestionPermissionRequestBody` 里维护的不只是一个当前选择，而是：

- `currentQuestionIndex`
- `answers`
- `questionStates`
- `isInTextInput`
- submit view / question view 切换

因此这不是“工具审批弹个 yes/no”，而是真正的多题 interview runtime，被挂在 permission queue 里执行。

## 9. preview 会反向影响布局计算，说明它不是附加字段，而是主 UI 模式分叉点

源码镜像：[`../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`](../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx)

本地对话框会先扫描：

- 哪题有 preview
- preview 渲染后的最大宽高

再决定：

- `globalContentHeight`
- `globalContentWidth`

也就是说 preview 不是简单“悬浮提示”，而是会切换整个问答对话框的布局策略。

## 10. AskUserQuestion 还支持图像粘贴与 annotation，说明它已经超出纯文本 multiple choice

源码镜像：[`../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`](../../sources/claude-code/src/utils/imageStore.ts)

本地实现里能看到：

- `onImagePaste(...)`
- `storeImage(...)`
- `pastedContentsByQuestion`
- `annotations`

这说明当前协议已支持：

- 用户对某题附图
- 用户给某个选择加 notes
- preview 与 notes 一起回流到 tool result

因此 AskUserQuestion 已经接近一个轻量“收集结构化用户输入”的通用子系统，而不是只有单行 radio button。

## 11. 远端 detail 不会复刻整套表单，只显示成一条 CTA 摘要

源码镜像：[`../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx)

在远端会话详情里，`formatToolUseSummary(...)` 对 AskUserQuestion 有专门特判：

- 不显示工具名
- 优先显示第一题 `question`
- 退化时才用 `header`
- 最终格式是 `Answer in browser: ...`

这说明远端 operator 面并不尝试在本地 detail 里重现完整问卷，而是只给出一个“去浏览器回答”的 CTA 摘要。

## 12. 本地 full dialog 与远端 CTA 摘要是同一工具的两种宿主实现

源码镜像：[`../../sources/claude-code/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`](../../sources/claude-code/src/components/tasks/RemoteSessionDetailDialog.tsx)

同样是 AskUserQuestion：

- 本地 REPL/permission queue：完整多题表单、preview、notes、paste
- 远端 detail：只压成一个 CTA summary

这说明工具本体只定义 schema 和 continuation contract，至于“怎样让用户实际回答”，是由宿主决定的。

## 13. `requiresUserInteraction()` 还会影响更上层的 permission / channel / bridge 调度逻辑

源码镜像：[`../../sources/claude-code/src/services/tools/toolHooks.ts`](../../sources/claude-code/src/hooks/toolPermission/handlers/interactiveHandler.ts)

当前源码里可以看到多处逻辑都在检查：

- `tool.requiresUserInteraction?.()`

这意味着 AskUserQuestion 的“需要人现场交互”不是局部 UI 约定，而是整个权限与运行时调度系统都会看的信号：

- 某些 channel relay 直接不跑
- 某些 bridge / interactive handler 会特殊对待
- 它天然更接近一个 operator loop 断点

## 14. 这篇和 `13`、`26`、`25` 的边界

[`./13-ask-user-glob-and-semi-visible-tools.md`](./13-ask-user-glob-and-semi-visible-tools.md) 讲的是：

- AskUserQuestion 在工具家族里的基本定位

这一篇讲的是：

- 它在 schema / preview / permission queue / remote CTA 这些表面上的完整运行时

[`../architecture/26-prompt-queue-and-elicitation-input-surfaces.md`](../architecture/26-prompt-queue-and-elicitation-input-surfaces.md) 讲 elicitation/prompt queue；[`../architecture/25-permission-request-queue-and-dialog-surfaces.md`](../architecture/25-permission-request-queue-and-dialog-surfaces.md) 讲 permission queue 通用外壳。本篇只聚焦 AskUserQuestion 自己的 operator protocol。

## 15. 一句话结论

AskUserQuestion 在 Claude Code 里已经不是“一个让模型问用户问题的工具”这么简单了。它实际是一套完整的 operator loop runtime：

- schema 定义轻量问卷 DSL
- preview 与 annotation 扩展输入面
- permission queue 承担本地多题表单宿主
- remote detail 退化成浏览器 CTA
- tool_result 再把人类回答编回模型上下文

这也是它值得从工具总述里独立出来单写一卷的原因。
