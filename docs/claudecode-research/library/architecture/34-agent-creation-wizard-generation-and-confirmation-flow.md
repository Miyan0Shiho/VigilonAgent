# Agent Creation Wizard / Generation / Confirmation Flow

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agents Management / Detail / Editing Workbench`](./33-agents-management-detail-and-editing-workbench.md) | [`下一站：Agent Confirmation / Review / Navigation Surfaces`](./35-agent-confirmation-review-and-navigation-surfaces.md)

`/agents` 里已经有浏览、详情、编辑，但“创建新 agent”其实是另一套完整 authoring flow。它不是弹一个表单，而是把生成式 authoring、手工 authoring、工具选择、模型与颜色配置、最终落盘确认，全部接进统一 wizard runtime：

- `components/agents/new-agent-creation/CreateAgentWizard.tsx`
- `components/agents/new-agent-creation/wizard-steps/LocationStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/MethodStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/TypeStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/ToolsStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`
- `components/agents/ModelSelector.tsx`
- `components/agents/ColorPicker.tsx`

这一卷只讲创建流本身，不重复 `/agents` 总工作台和 definition persistence 的更深机制。

## 1. `CreateAgentWizard` 不是静态多步表单，而是可变 step pipeline

源码镜像：[`../../src/components/agents/new-agent-creation/CreateAgentWizard.tsx`](../../src/components/agents/new-agent-creation/CreateAgentWizard.tsx)

`CreateAgentWizard` 不是把所有字段都固定摊开，而是显式装了一串 step：

1. `LocationStep`
2. `MethodStep`
3. `GenerateStep`
4. `TypeStep`
5. `PromptStep`
6. `DescriptionStep`
7. `ToolsStep`
8. `ModelStep`
9. `ColorStep`
10. 可选 `MemoryStep`
11. `ConfirmStepWrapper`

而且 `MemoryStep` 只有在 `isAutoMemoryEnabled()` 打开时才真正插进去。

这说明 agent authoring flow 在产品上是：

- feature-gated
- generation-aware
- step graph 可变

而不是“一套永远固定的 wizard 页数”。

## 2. 位置选择从第一步开始就把 authoring 绑到 source governance

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/LocationStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/LocationStep.tsx)

`LocationStep` 只给出两种创建位置：

- `Project (.claude/agents/)`
- `Personal (~/.claude/agents/)`

选中后立刻：

- `updateWizardData({ location })`
- `goNext()`

也就是说“agent 放在哪”不是保存前最后一步的文件路径问题，而是整个 authoring flow 的起始真相。后续确认页展示路径、最终 `saveAgentToFile()` 的 source、以及 active roster 的来源，都依赖这一步。

## 3. `MethodStep` 不是视觉分流，而是真的改写后续图

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/MethodStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/MethodStep.tsx)

这里有两个选项：

- `Generate with Claude (recommended)`
- `Manual configuration`

但关键不在文案，而在跳转：

- 选 `generate` -> `goNext()`，进入 `GenerateStep`
- 选 `manual` -> `goToStep(3)`，直接跳到 `TypeStep`

所以生成式 authoring 和手工 authoring 不是“是否预填草稿”，而是两条不同的状态路径：

- 生成式先拿到 `generatedAgent`
- 手工式直接构造 definition 字段

## 4. `GenerateStep` 把 agent creation 接进主模型，而不是独立小模型

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx)

`GenerateStep` 用的是：

- `useMainLoopModel()`
- `generateAgent(trimmedPrompt, model, [], controller.signal)`

这说明“帮我生成一个 agent”不是另一个轻量模板工具，而是直接借用 Claude Code 主模型选择体系。生成出来的结果随后被拆进 wizardData：

- `agentType: generated.identifier`
- `whenToUse`
- `systemPrompt`
- `generatedAgent`
- `wasGenerated: true`

所以创建 agent 的生成链本质上是一次受约束的 prompt-to-definition 编译。

## 5. 生成流的取消协议是完整的，不是只关一个 spinner

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx)

这里单独维护了：

- `abortControllerRef`
- `createAbortController()`
- `APIUserAbortError`

并且 `Esc` 在生成时绑定到：

- `handleCancelGeneration()`

效果是：

- `abort()`
- 清空 controller
- `setIsGenerating(false)`
- `setError('Generation cancelled')`

这说明生成并不是 fire-and-forget；它被当成一个可取消的 authoring 子任务，而且取消语义要写回 wizard 前台状态。

## 6. `GenerateStep` 里 `Esc` 的意义会切换，键位上下文是 authoring runtime 的一部分

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx)

同一个 `confirm:no`：

- 生成中：取消生成
- 非生成中：回退到 `MethodStep`

而且两个绑定都用 `context: 'Settings'`，故意避免普通文本输入时 `n` 被误判成 cancel。

这说明创建向导不是只换页面，它对键位语义做了状态机级重写。

## 7. 外部编辑器在生成提示阶段就已经接进来了

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx)

在生成说明文本时，用户可以：

- `chat:externalEditor`
- `editPromptInEditor(prompt)`

返回后会同步：

- `setPrompt(result.content)`
- `setCursorOffset(result.content.length)`

所以外部编辑器并不只是最终 definition markdown 的逃生舱，它在“给 Claude 描述 agent 需求”这一步就已经被当成一等 authoring surface。

## 8. 生成成功后不是去确认页，而是故意跳到 `ToolsStep`

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx)

成功后调用的是：

- `goToStep(6)`

也就是直接跳到 `ToolsStep`，而不是先看完整确认页。

这说明生成结果在产品上被认为：

- 能自动产出 `identifier / whenToUse / systemPrompt`
- 但工具权限仍然需要显式 operator 审核

因此 `ToolsStep` 是生成流里的人工接管点。

## 9. `TypeStep` 并不信任上一步的文本，而是重新跑专门的 identifier 校验

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/TypeStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/TypeStep.tsx), [`../../src/components/agents/validateAgent.ts`](../../src/components/agents/validateAgent.ts)

`TypeStep` 不管值来自生成式还是手工输入，提交前都先：

- `trim()`
- `validateAgentType(trimmedValue)`

也就是说 agent type 是单独受保护的 authoring field。生成结果不会跳过这层合法性检查。

## 10. `ToolsStep` 复用 `ToolSelector`，但多了一层 wizard 语义

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ToolsStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ToolsStep.tsx), [`../../src/components/agents/ToolSelector.tsx`](../../src/components/agents/ToolSelector.tsx)

`ToolsStep` 的职责不是自己管选择逻辑，而是把 `ToolSelector` 接进 wizard：

- 初始值来自 `wizardData.selectedTools`
- 完成时写回 `selectedTools`
- 明确保留 `undefined` 作为 “all tools” 语义

所以在创建流里，工具面不是普通字段，而是一个独立 capability curation 子系统，再被 wizardState 包装成一步。

## 11. `ModelSelector` 的关键不是选模型，而是保护 custom model ID 的 round-trip

源码镜像：[`../../src/components/agents/ModelSelector.tsx`](../../src/components/agents/ModelSelector.tsx)

`ModelSelector` 先拿：

- `getAgentModelOptions()`

但如果当前 model 不在 alias 列表里，它会把这个值重新注入为：

- `Current model (custom ID)`

这意味着创建与编辑流都不会因为 UI 只有别名列表，就把一个已有 custom model ID 覆盖掉。model picker 的真实职责是：

- 给常见模型友好的选择面
- 同时保护未知但合法的 provider-specific model ID

## 12. `ColorPicker` 不是抽象 token picker，而是直接预览 agent identity

源码镜像：[`../../src/components/agents/ColorPicker.tsx`](../../src/components/agents/ColorPicker.tsx)

颜色选择时，底部即时渲染：

- `@{agentName}`

并按：

- `automatic`
- `AGENT_COLOR_TO_THEME_COLOR[selectedValue]`

来显示最终外观。

所以颜色面板不是“选主题色值”，而是在选这个 agent 进入 transcript、spinner、panel 之后的身份外观。

## 13. `ConfirmStep` 是 creation flow 的总审核面，不是保存按钮前的摘要页

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx)

确认页会集中展示：

- `Name`
- `Location`，并用 `getNewRelativeAgentFilePath(...)`
- `Tools`
- `Model`
- 可选 `Memory`
- description preview
- system prompt preview
- validation warnings
- validation errors

这说明 confirm 页本质上是在做两个动作：

- 给用户一个最终可审计的 definition 视图
- 再跑一次 `validateAgent(agent, tools, existingAgents)` 的前台总装配检查

## 14. 确认页里 `save` 和 `save + edit` 是两条正式收尾路径

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx)

确认页不是单一提交动作，而是两条键盘协议：

- `s / Enter` -> `onSave`
- `e` -> `onSaveAndEdit`

`ConfirmStepWrapper` 再把这两条动作翻译成：

- `saveAgent(false)`
- `saveAgent(true)`

所以“创建并完成”和“创建后立刻打开编辑器二次修订”在 Claude Code 里是同级收尾路径，不是隐藏高级选项。

## 15. `ConfirmStepWrapper` 负责真正的 side effects，不让纯展示页碰状态

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx)

真正的保存副作用都在 wrapper：

- `saveAgentToFile(...)`
- `setAppState(...)`
- 可选 `editFileInEditor(filePath)`
- `logEvent('tengu_agent_created', ...)`
- 最终 `onComplete(message)`

这说明 confirm 展示页和真正 mutation side effects 被明确分层：

- `ConfirmStep` 负责 review
- `ConfirmStepWrapper` 负责 commit

## 16. 新建 agent 的成功并不等于重启后才可见，它会立即进入 active roster

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx), [`../../src/tools/AgentTool/loadAgentsDir.ts`](../../src/tools/AgentTool/loadAgentsDir.ts)

保存后 wrapper 立刻：

- `allAgents.concat(wizardData.finalAgent)`
- `activeAgents: getActiveAgentsFromList(allAgents)`

所以新建 agent 在当前会话里不是“写盘等待下次加载”，而是立刻成为当前 AppState 里的 active definition。

## 17. 创建流把“definition authoring”与“operator telemetry”绑在一起

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx)

保存成功后会上报：

- `agent_type`
- `generation_method`
- `source`
- `tool_count`
- `has_custom_model`
- `has_custom_color`
- `has_memory`
- `memory_scope`
- `opened_in_editor`

这说明 agent authoring 在 Claude Code 里不是隐形本地配置改动，它是明确被当作产品行为来追踪和理解的。

## 18. 整条创建链真正做的是“先收集 authoring truth，再进入 persistence runtime”

把这条链收束起来，创建 wizard 的功能不是把字段填满，而是分阶段确定几种 truth：

- 这个 agent 属于哪个 source
- 生成还是手工
- 标识符是否合法
- 工具权限是否需要 operator 缩窄
- model / color / memory 是否需要显式个性化
- 最终 definition 在落盘前是否通过完整 validation

只有这些 truth 都收齐后，才交给 [Agent Definition Editing / Validation / Persistence Runtime](../mechanisms/55-agent-definition-editing-validation-and-persistence-runtime.md) 去真正写盘、重算 active roster、并把它变成当前会话里的真实 agent。
