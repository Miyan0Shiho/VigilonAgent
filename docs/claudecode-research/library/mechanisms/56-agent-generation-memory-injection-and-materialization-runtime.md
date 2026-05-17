# Agent Generation / Memory Injection / Materialization Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Confirmation / Review / Navigation Surfaces`](../architecture/35-agent-confirmation-review-and-navigation-surfaces.md) | [`下一站：Agent Definition Editing / Validation / Persistence Runtime`](./55-agent-definition-editing-validation-and-persistence-runtime.md)

`/agents` 的创建流已经在前台卷册里拆成了 wizard，但真正把“自然语言需求 -> agent 草稿 -> 含 memory 的最终 definition -> 落盘 + AppState 热更新”接起来的，是另一条更深的运行时链：

- `components/agents/generateAgent.ts`
- `components/agents/new-agent-creation/CreateAgentWizard.tsx`
- `components/agents/new-agent-creation/wizard-steps/ColorStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/MemoryStep.tsx`
- `components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`

这一卷不重复解释向导每一页怎么显示，而是专门讲 agent creation 的编译、late binding、memory 注入和最终 materialization。

## 1. `generateAgent()` 不是普通聊天，而是一次无工具的 definition compilation

源码镜像：[`../../src/components/agents/generateAgent.ts`](../../src/components/agents/generateAgent.ts)

`generateAgent()` 的输入只有四个核心量：

- `userPrompt`
- `model`
- `existingIdentifiers`
- `abortSignal`

它做的不是“让模型给点建议”，而是明确要求返回：

- `identifier`
- `whenToUse`
- `systemPrompt`

也就是说这一步本质上是一次受约束的 schema compilation，把用户口语需求编译成 agent definition 的三个主字段。

## 2. 唯一性在这一层只是 prompt-time 软约束，不是最终真相源

源码镜像：[`../../src/components/agents/generateAgent.ts`](../../src/components/agents/generateAgent.ts), [`../../src/components/agents/validateAgent.ts`](../../src/components/agents/validateAgent.ts)

`existingIdentifiers` 只会被拼成一段 prompt：

- “these identifiers already exist and must NOT be used”

这说明生成阶段的去重只是 soft guidance。真正的 authoring 约束仍然在后面：

- `TypeStep` 重新验证 identifier 语法
- `validateAgent` 再做跨 source duplicate 检查

所以 Claude Code 没把“模型没撞名”当成最终一致性保证。

## 3. 生成器会吃到真实 user/project context，不是裸 prompt

源码镜像：[`../../src/components/agents/generateAgent.ts`](../../src/components/agents/generateAgent.ts)

生成链里有两步很关键：

- `getUserContext()`
- `prependUserContext([userMessage], userContext)`

这意味着 agent generator 并不是孤立工作的。它会带着当前会话能看到的 user/system context 一起进模型，包括 repo 里的约束、CLAUDE.md 类规则和其他上游上下文。于是“生成 agent”天生就是 repo-aware 的，而不是一个与当前代码库脱钩的小工具。

## 4. memory 指令不是后处理补丁，而是生成时就进了 system prompt

源码镜像：[`../../src/components/agents/generateAgent.ts`](../../src/components/agents/generateAgent.ts)

`generateAgent.ts` 里把生成用 system prompt 分成两层：

- `AGENT_CREATION_SYSTEM_PROMPT`
- `AGENT_MEMORY_INSTRUCTIONS`

只有 `isAutoMemoryEnabled()` 打开时，后者才会被拼进去。这表示 Claude Code 对 memory 的设计不是“生成完以后再问要不要记忆”，而是：

- 如果产品 gate 开着
- 生成器从一开始就被要求考虑 agent 是否需要跨会话积累知识

也就是说 memory awareness 在 agent generation 这一步已经是 first-class concern。

## 5. 生成请求被刻意锁成无工具、无思维流、专用 query source

源码镜像：[`../../src/components/agents/generateAgent.ts`](../../src/components/agents/generateAgent.ts)

调用 `queryModelWithoutStreaming()` 时，关键选项是：

- `thinkingConfig: { type: 'disabled' }`
- `tools: []`
- `getToolPermissionContext: getEmptyToolPermissionContext()`
- `querySource: 'agent_creation'`

这四个决定说明：

- 生成 agent 不允许临时开工具探索
- 不暴露普通会话里的工具权限面
- 不走 streaming UI
- 在 telemetry / cache / API 侧有单独来源标签

所以这条链被明确做成了一个 deterministic-ish 的 compile request，而不是普通 assistant turn。

## 6. JSON 解析策略是“严格优先，宽容兜底”

源码镜像：[`../../src/components/agents/generateAgent.ts`](../../src/components/agents/generateAgent.ts)

结果解析分两层：

1. 先直接 `jsonParse(responseText.trim())`
2. 失败后再用 `/\\{[\\s\\S]*\\}/` 抽取包裹中的 JSON

最后还会强校验：

- `identifier`
- `whenToUse`
- `systemPrompt`

这说明 Claude Code 既不完全信任模型会“只返回 JSON”，也不因为轻微包裹文本就直接失败，而是把 agent generation 做成了 strict schema with forgiving extraction 的模式。

## 7. 生成成功后并不会立刻变成最终 agent，而是故意先回到人工校订链

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx), [`../../src/components/agents/new-agent-creation/CreateAgentWizard.tsx`](../../src/components/agents/new-agent-creation/CreateAgentWizard.tsx)

生成结果只会先写回 wizard state：

- `agentType`
- `whenToUse`
- `systemPrompt`
- `generatedAgent`
- `wasGenerated`

然后流程被送去：

- `TypeStep`
- `PromptStep`
- `DescriptionStep`
- `ToolsStep`
- `ModelStep`
- `ColorStep`
- 可选 `MemoryStep`

所以 generated agent 只是一个 draft seed，不是可直接落盘的 definition truth。

## 8. `ColorStep` 才第一次把分散字段 materialize 成 `finalAgent`

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ColorStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ColorStep.tsx)

到 `ColorStep` 之前，wizardData 里还是散的：

- `agentType`
- `whenToUse`
- `systemPrompt`
- `selectedTools`
- `selectedModel`
- `location`

`ColorStep` 确认时才第一次组装出：

- `finalAgent.agentType`
- `finalAgent.whenToUse`
- `finalAgent.getSystemPrompt`
- `finalAgent.tools`
- 可选 `model`
- 可选 `color`
- `source`

尤其 `systemPrompt` 不是字符串直接塞进去，而是封成 `getSystemPrompt()`。这说明创建流里的最终 definition 在一开始就被设计成支持 late binding。

## 9. `MemoryStep` 不是只写个 frontmatter 字段，而是重写 `getSystemPrompt()` 闭包

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/MemoryStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/MemoryStep.tsx), [`../../src/tools/AgentTool/agentMemory.ts`](../../src/tools/AgentTool/agentMemory.ts)

`MemoryStep` 的关键不是 `selectedMemory`，而是它会把现有 `finalAgent` 再改写一次：

- `memory`
- `getSystemPrompt: () => wizardData.systemPrompt + loadAgentMemoryPrompt(agentType, memory)`

而当用户选 `none` 时，又会把它退回成：

- `getSystemPrompt: () => wizardData.systemPrompt`

这说明 memory 在 agent creation 里不是 metadata-only 开关，而是直接改写系统提示词装配逻辑。真正写到磁盘前，final prompt 仍然是 closure 级 late-bound。

## 10. memory 推荐顺序依赖 agent 放置位置，位置治理会一路渗透到 prompt 装配

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/LocationStep.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/MemoryStep.tsx)

`MemoryStep` 会根据 `wizardData.location` 调整选项顺序：

- `userSettings` agent 默认推荐 `user` memory
- `projectSettings` agent 默认推荐 `project` memory

也就是说位置治理不仅影响定义文件落到哪，还会反过来影响 memory scope 推荐和最终 prompt composition。这两条链是耦合的，不是独立设置页各管各的。

## 11. `ConfirmStepWrapper` 才是真正的 mutation boundary

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx), [`../../src/components/agents/agentFileUtils.ts`](../../src/components/agents/agentFileUtils.ts)

前面所有步骤都只是准备 `wizardData`。真正发生持久化、副作用和前台状态收口的地方，是 `ConfirmStepWrapper.saveAgent()`：

1. `saveAgentToFile(...)`
2. `setAppState(...)` 把新 agent 拼进 `allAgents`
3. 用 `getActiveAgentsFromList(allAgents)` 重算 `activeAgents`
4. 如果用户要求，再 `editFileInEditor(filePath)`
5. 记录 `tengu_agent_created`
6. 向上层返回完成消息

所以 `ConfirmStepWrapper` 不是简单包一层 confirm UI，它就是 agent creation 的真正 commit point。

## 12. “保存并编辑”不是先拿保存结果回传路径，而是按 source + identifier 重新推导新文件路径

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx), [`../../src/components/agents/agentFileUtils.ts`](../../src/components/agents/agentFileUtils.ts)

`openInEditor` 分支不会依赖 `saveAgentToFile()` 返回文件路径，而是重新调用：

- `getNewAgentFilePath({ source, agentType })`

这表明创建链默认假设：

- 新 agent 的目标路径可由 source + identifier 决定
- 创建流和编辑器 handoff 共用同一套 path router

因此“保存并编辑”不是临时特例，而是落盘协议的标准延伸。

## 13. analytics 在这里记录的是 authoring feature truth，而不是底层文件细节

源码镜像：[`../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`](../../src/components/agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx), [`../../src/components/agents/generateAgent.ts`](../../src/components/agents/generateAgent.ts)

creation 链里有两次关键埋点：

- `tengu_agent_definition_generated`
- `tengu_agent_created`

记录的重点是：

- `agent_identifier / agent_type`
- `generation_method`
- `source`
- `tool_count`
- `has_custom_model`
- `has_custom_color`
- `has_memory`
- `memory_scope`
- `opened_in_editor`

这说明这条链在产品观测上最关心的是“用户怎样 author agent”，而不是“最终写了哪个具体文件路径”。

## 14. 创建链和持久化链是前后分层，不是重复实现

回跳：[`55-agent-definition-editing-validation-and-persistence-runtime.md`](./55-agent-definition-editing-validation-and-persistence-runtime.md)

这一卷和 `mechanisms/55` 的边界应该明确：

- `mechanisms/56` 讲的是 creation pipeline 怎样生成、改写、拼装和提交 `finalAgent`
- `mechanisms/55` 讲的是 definition markdown 如何被规范化、校验、路由和真正写盘

也就是说：

- `56` 解决“怎么把用户意图编译成可提交 definition”
- `55` 解决“怎么把 definition 安全变成磁盘与 active roster 真相”

两篇合起来，才是完整的 agent authoring runtime。
