# Agent Definitions / Selection / Spawn / Handoff Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Dynamic Skills / Model-Only Skills / Host-Safe Command Gates`](./44-dynamic-skills-model-only-skills-and-host-safe-command-gates.md) | [`下一站：Agent Memory / Snapshots / Built-In Specialist Prompts`](./52-agent-memory-snapshots-and-built-in-specialist-prompts.md)

这篇把 Claude Code 里最核心、但之前只散落在 swarm、permission、policy 文档里的 `AgentTool` 主链单独拆出来。主问题不是“AgentTool 能不能起一个子代理”，而是它怎样把下面这些层拼成一个统一 runtime：

- agent definition 的多来源加载与胜出规则
- builtin / custom / plugin / managed agents 的同台选择
- sync / async / teammate / remote / worktree 五种 spawn 分支
- fork subagent 的 cache-stable 继承协议
- background agent 的 task / notification / handoff 语义
- resume agent 的 transcript / worktree / replacement-state 恢复

对应源码主链是：`tools/AgentTool/{loadAgentsDir,builtInAgents,agentDisplay,prompt,AgentTool,runAgent,forkSubagent,resumeAgent,agentToolUtils,UI}.ts[x]`。

## 1. `AgentTool` 不是单一工具，而是 “definition loader + prompt router + spawn host + result protocol” 四层叠起来的系统

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx), [`../../src/tools/AgentTool/loadAgentsDir.ts`](../../src/tools/AgentTool/loadAgentsDir.ts), [`../../src/tools/AgentTool/prompt.ts`](../../src/tools/AgentTool/prompt.ts), [`../../src/tools/AgentTool/agentToolUtils.ts`](../../src/tools/AgentTool/agentToolUtils.ts)

这条链至少有四层职责：

- loader：把 built-in、plugin、user、project、managed、flag agents 解析成统一 `AgentDefinition`
- prompt：告诉模型哪些 agent 可用、何时用、何时不该用、fork 语义是什么
- call host：把一次 `AgentTool(...)` 调用分流成 teammate / remote / async / sync / worktree
- result protocol：把完成态压成 `completed / async_launched / teammate_spawned / remote_launched`

所以 AgentTool 在 Claude Code 里不是“BashTool 那样的一把工具”，而更像 agent runtime 的主装配器。

## 2. agent definitions 从一开始就不是单来源，而是有明确 source precedence

源码镜像：[`../../src/tools/AgentTool/loadAgentsDir.ts`](../../src/tools/AgentTool/loadAgentsDir.ts), [`../../src/tools/AgentTool/agentDisplay.ts`](../../src/tools/AgentTool/agentDisplay.ts)

`loadAgentsDir.ts` 里统一的 `AgentDefinition` 覆盖三大类：

- `BuiltInAgentDefinition`
- `CustomAgentDefinition`
- `PluginAgentDefinition`

而 active agent 胜出顺序不是隐含的，而是明确写在：

- `getActiveAgentsFromList()`
- `resolveAgentOverrides()`

当前顺序是：

1. built-in
2. plugin
3. user
4. project
5. flag
6. managed

后写入 `Map(agentType -> agent)` 的 source 会覆盖前面的 source，所以 managed 最终胜出。也就是说 `/agents` 看到的不是“所有 agent 平铺”，而是经过 precedence 仲裁后的有效面。

## 3. `agentDisplay.ts` 说明 `/agents` 不是只看 active list，而是同时维护 “全量来源视图 + 覆盖关系”

源码镜像：[`../../src/tools/AgentTool/agentDisplay.ts`](../../src/tools/AgentTool/agentDisplay.ts)

`agentDisplay.ts` 独立做了三件事：

- 规定 source group 的显示顺序
- 给每个 `(agentType, source)` 去重
- 给被覆盖的 agent 标注 `overriddenBy`

这说明 agent catalog 的产品设计不是“只展示最终可调用对象”，而是要让用户看见：

- agent 从哪里来
- 为什么这个来源没赢
- 当前是被哪个更高优先级来源压过去了

所以 `/agents` 本质上是一个 source-aware inventory，不只是 picker。

## 4. `loadAgentsDir.ts` 的 frontmatter 面远比普通 skill 更厚，说明 agent 本身就是复合 runtime 对象

源码镜像：[`../../src/tools/AgentTool/loadAgentsDir.ts`](../../src/tools/AgentTool/loadAgentsDir.ts)

当前 agent frontmatter 已经支持：

- `tools` / `disallowedTools`
- `model` / `effort` / `permissionMode`
- `mcpServers`
- `hooks`
- `skills`
- `maxTurns`
- `initialPrompt`
- `memory`
- `background`
- `isolation`
- `requiredMcpServers`
- `omitClaudeMd`

这说明 agent 不是一段静态 prompt，而是一个可声明：

- 能力边界
- 运行模式
- 执行宿主
- 上下文注入策略

的复合定义体。

## 5. builtin agents 不是固定表，而是按 entrypoint / feature / subscription gating 动态装配

源码镜像：[`../../src/tools/AgentTool/builtInAgents.ts`](../../src/tools/AgentTool/builtInAgents.ts)

`getBuiltInAgents()` 并不是把几个常量直接返回。它还会看：

- `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS` + noninteractive session
- coordinator mode
- `BUILTIN_EXPLORE_PLAN_AGENTS` + GrowthBook gate
- 当前 entrypoint 是否是 SDK
- `VERIFICATION_AGENT` + GrowthBook gate

因此 builtin catalog 不是一张永远相同的表，而是会因：

- SDK vs CLI/REPL
- feature rollout
- coordinator build

而变化的能力面。

## 6. `prompt.ts` 不是只列 agent 名单，而是在定义一种 delegation policy language

源码镜像：[`../../src/tools/AgentTool/prompt.ts`](../../src/tools/AgentTool/prompt.ts)

这份 prompt 真正做的不是简单列出 “有哪些 agent”：

- `shouldInjectAgentListInMessages()` 决定 agent list 是内联进工具描述，还是走 `agent_listing_delta` attachment
- `whenNotToUse` 告诉模型哪些搜索/读文件场景不该乱开 agent
- fork gate 打开时，会额外插入 “When to fork” 和 fork 专属 examples
- `allowedAgentTypes` 会把 catalog 收窄成工具规则允许的子集

也就是说，AgentTool 的 prompt 不是目录页，而是一个 delegation grammar：什么时候该 fork、什么时候该 fresh agent、什么时候根本别开 agent。

## 7. `shouldInjectAgentListInMessages()` 暗示 agent catalog 也是 prompt-cache 稳定性对象

源码镜像：[`../../src/tools/AgentTool/prompt.ts`](../../src/tools/AgentTool/prompt.ts)

当 gate 打开时，agent list 不再塞进 tool description，而是走 attachment。原因写得非常直白：

- agent list 会因为 MCP async connect、plugin reload、permission mode 变化而变化
- 这些变化会导致 tool description 改字节
- 进而 bust tools-block prompt cache

所以 agent catalog 在 Claude Code 里不是纯 UI 数据，它已经被当成 prompt-cache 敏感对象来治理。

## 8. `AgentTool.call()` 的第一层分流不是执行模型，而是“谁有资格生成谁”

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

进入 `call()` 之后，最先判的不是 sync/async，而是身份与 plan 约束：

- 没有 Agent Teams 权限时，`team_name` 直接报错
- teammate 不能再生成 teammate roster，除非去掉 `name`
- in-process teammate 不能开 background agents
- 如果 agent definition 自己 `background: true`，这个限制同样生效

这说明 AgentTool 的第一层语义不是“我要开什么 agent”，而是“当前身份有没有资格触发哪种 spawn topology”。

## 9. `name + team_name` 这条路并不是普通 subagent，而是立刻切到 teammate spawn 协议

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

当满足：

- 有 `teamName`
- 有 `name`

就不会继续走普通 `runAgent()`，而是直接：

- 可选设置 agent color
- 调 `spawnTeammate(...)`
- 返回 `status: 'teammate_spawned'`

所以 teammate 不是 sync/async 分支里的一个小变体，而是 AgentTool 顶层就被切出去的独立执行通道。

## 10. `subagent_type` 为空时不一定是 general-purpose，有 fork gate 时会进入完全不同的路径

源码镜像：[`../../src/tools/AgentTool/forkSubagent.ts`](../../src/tools/AgentTool/forkSubagent.ts), [`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

这里的规则是：

- `subagent_type` 显式给了：按给定 agent type 走
- 没给且 fork gate 关：回落到 `GENERAL_PURPOSE_AGENT`
- 没给且 fork gate 开：走 `FORK_AGENT`

fork path 最关键的区别是：

- 继承父对话上下文
- 继承父系统 prompt 字节
- 继承父工具定义字节
- 强制 async interaction model

它不是“general-purpose agent 的快捷方式”，而是一个专门为 cache-identical prefix 设计的分支。

## 11. `buildForkedMessages()` 说明 fork 的核心目标之一是 prompt cache byte identity，不是方便复用上下文而已

源码镜像：[`../../src/tools/AgentTool/forkSubagent.ts`](../../src/tools/AgentTool/forkSubagent.ts)

fork child 的消息前缀会被构造成：

- 完整父 assistant message
- 所有 tool_use 的统一 placeholder tool_result
- 最后才接每个 child 自己的 directive

注释直接写明目的：

- 所有 fork child 尽量共享相同 API request prefix
- 只有最后一个 directive text block 不同

这说明 fork feature 的设计目标不只是“少写 prompt”，而是让多 fork 场景尽可能命中同一条 cache chain。

## 12. 远端、worktree、background 不是后处理选项，而是 `call()` 顶层 host routing 的正式分支

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

`call()` 里真正会把一个 subagent 路由到至少五种宿主：

- teammate spawn
- remote CCR launch
- async local/background
- sync foreground
- worktree-isolated local execution

其中 `effectiveIsolation = isolation ?? selectedAgent.isolation`，说明：

- 调用参数可以覆盖 definition
- definition 也可以强制某种宿主

所以 host routing 从一开始就是 agent definition/runtime protocol 的一部分。

## 13. remote isolation 不是“后台 agent + teleport”，而是直接换成 `remote_launched` 协议

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tasks/RemoteAgentTask/RemoteAgentTask.tsx)

当 `effectiveIsolation === 'remote'` 时，AgentTool 不走本地 `runAgent()`：

- 先做 `checkRemoteAgentEligibility()`
- 再 `teleportToRemote(...)`
- `registerRemoteAgentTask(...)`
- 返回 `status: 'remote_launched'`

这说明 remote agent 在这里不是普通 background agent 的 transport 替换，而是一个独立 output union 分支，有自己：

- precondition model
- task registration contract
- session URL
- output file path

## 14. background/sync 分流不是只看 `run_in_background`，而是六路条件合并后的宿主决策

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/AgentTool.tsx)

`shouldRunAsync` 当前由这些条件并出来：

- `run_in_background === true`
- `selectedAgent.background === true`
- coordinator mode
- fork gate
- assistant/kairos mode
- proactive mode
- 并且全都要过 `!CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`

这意味着 “同步还是后台” 在 Claude Code 里不是用户一个参数说了算，而是：

- 用户请求
- agent 定义
- 宿主模式
- 产品实验

共同决定的。

## 15. worktree isolation 不是单纯 chdir，而是完整的 worktree lifecycle

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/utils/worktree.ts)

当进入 worktree path 时，AgentTool 会：

- 先用 `earlyAgentId` 生成稳定 slug
- `createAgentWorktree(slug)`
- 对 fork child 注入 `buildWorktreeNotice(...)`
- 结束后 `hasWorktreeChanges(...)`
- 无改动就 `removeAgentWorktree(...)`
- 有改动就保留 worktree 并回写 metadata

所以 worktree isolation 在这里不是临时 cwd 覆写，而是一套真正可 resume、可清理、可保留成果的隔离执行协议。

## 16. `runAgent()` 不是 AgentTool 的实现细节，而是一个可被 spawn 与 resume 共同复用的 agent stream engine

源码镜像：[`../../src/tools/AgentTool/runAgent.ts`](../../src/tools/AgentTool/runAgent.ts), [`../../src/tools/AgentTool/resumeAgent.ts`](../../src/tools/AgentTool/resumeAgent.ts)

两条路径都会把真正执行交给 `runAgent(...)`：

- 普通 spawn
- `resumeAgentBackground(...)`

这说明 `runAgent()` 不只是某次工具调用的 helper，而是 Agent runtime 的共享流式核心。resume 只是在前面补：

- 旧 transcript
- metadata
- tool-result replacement state
- worktree path

再把同一个 stream engine 接起来。

## 17. agent-specific MCP 不是 loader 就决定完了，真正装配发生在 `runAgent()`

源码镜像：[`../../src/tools/AgentTool/runAgent.ts`](../../src/tools/AgentTool/runAgent.ts)

`initializeAgentMcpServers()` 说明 agent frontmatter 的 `mcpServers` 直到 runtime 才真正被装配：

- string spec：复用现有 MCP config
- inline spec：动态创建 agent-specific client
- plugin-only MCP policy 下，非 admin-trusted agent 会被跳过
- inline 创建的 client 还要在 agent 结束后做 cleanup

所以 agent-specific MCP 不只是定义期字段，而是启动期真正会接入 parent clients 的 additive runtime layer。

## 18. `resolveAgentTools()` 说明 agent 的工具边界不是“定义里写了啥就有啥”，还要经过宿主过滤和 deny 规则重算

源码镜像：[`../../src/tools/AgentTool/agentToolUtils.ts`](../../src/tools/AgentTool/agentToolUtils.ts)

真正的工具解算要经历：

- `filterToolsForAgent()` 先套 built-in/custom/async/teammate 的全局限制
- `disallowedTools` 再二次过滤
- wildcard `*` 才能吃到剩余全集
- `Agent(...)` spec 还会抽出 `allowedAgentTypes`

所以 agent frontmatter 里的 `tools` 更像一个声明式请求，最终可用工具是：

`global host gate -> async gate -> denylist -> explicit allowlist`

层层仲裁后的结果。

## 19. `AgentTool` 的输出协议不是单一 result，而是四态 discriminated union

源码镜像：[`../../src/tools/AgentTool/AgentTool.tsx`](../../src/tools/AgentTool/UI.tsx)

当前可见的主要状态有：

- `completed`
- `async_launched`
- `teammate_spawned`
- `remote_launched`

这意味着 AgentTool 对外表达的不是“子代理结果”，而是“这次 delegation 最终落在哪个 host protocol 上”。UI 也会按这四种状态切不同展示，而不是一套通用模板强行兼容。

## 20. `runAsyncAgentLifecycle()` 说明 background agent 的真正语义不是 fire-and-forget，而是 “持续记账 + 收尾分类 + 通知回流”

源码镜像：[`../../src/tools/AgentTool/agentToolUtils.ts`](../../src/tools/AgentTool/agentToolUtils.ts)

后台生命周期共享壳会负责：

- 消费 stream
- 更新 task progress
- 汇总 `finalizeAgentTool(...)`
- 先完成 task，再异步做 handoff classification 与 worktree cleanup
- 发 notification
- 失败/kill 时抽 partial result

注释还特别强调一件事：不能让 `classifyHandoffIfNeeded()` 之类的后处理阻塞 task completed。说明 background agent 在 Claude Code 里是一个被严格工程化的生命周期对象，不是开个 promise 就算完。

## 21. `finalizeAgentTool()` 和 `classifyHandoffIfNeeded()` 把 “子代理完成” 拆成结果收束和安全交接两段

源码镜像：[`../../src/tools/AgentTool/agentToolUtils.ts`](../../src/tools/AgentTool/agentToolUtils.ts)

完成态至少分两段：

- `finalizeAgentTool()`：
  - 找最终 assistant text
  - 计算 tokens / tool uses / duration
  - 发 analytics
  - 给出结构化 result
- `classifyHandoffIfNeeded()`：
  - 仅 auto mode 且 gate 打开时才跑
  - 把 subagent transcript 交给 classifier
  - 必要时生成安全 warning，附在 handoff 前

也就是说，Claude Code 不把 subagent result 直接无条件塞回主线程，而是允许在 handoff 边界再做一次安全审查。

## 22. `resumeAgentBackground()` 说明 resume 不是重新发 prompt，而是尽量恢复同一条 sidechain 的物理连续性

源码镜像：[`../../src/tools/AgentTool/resumeAgent.ts`](../../src/tools/AgentTool/resumeAgent.ts)

resume 路径会做几件非常物理层的恢复：

- 读旧 transcript 和 metadata
- 清掉 whitespace-only / orphaned-thinking / unresolved-tool-use 噪音
- 重建 replacement state，保持 prompt cache 稳定
- worktree 还存在就 bump mtime，防止被 stale cleanup 干掉
- fork resume 时优先复用原父系统 prompt 字节

这说明 `resume agent` 在 Claude Code 里不是“再起一个新的同名 agent”，而是尽量把旧 sidechain 接着跑下去。

## 23. `UI.tsx` 证明 AgentTool 的前台不是一个结果框，而是 progress transcript / collapsed read-search summary / host-specific status 面

源码镜像：[`../../src/tools/AgentTool/UI.tsx`](../../src/tools/AgentTool/UI.tsx)

UI 层至少做了这些事情：

- 对 progress messages 做 collapsed read/search summary
- 为 subagent transcript 建 `toolUseByID` lookup
- 按 `async_launched / remote_launched / teammate_spawned / completed` 分不同结果面
- 给后台执行态提供专门的 expand / hints / progress line

所以 AgentTool 的前台并不是“把最后一段 Markdown 打出来”，而是一个 agent transcript viewer + host-aware status renderer。

## 24. 从这一圈源码看，`AgentTool` 才是 Claude Code 把“delegate to another model process”产品化的真正总控层

把这些文件合起来看，它已经覆盖：

- definition loading
- source precedence
- catalog rendering
- tool/runtime gating
- fork cache protocol
- team spawn
- remote launch
- async lifecycle
- sync foreground execution
- worktree isolation
- handoff safety review
- resume continuity
- front台 transcript rendering

因此在 Claude Code 里，subagent 不是某个单点 feature，而是 AgentTool 主导的一整套运行时。

## 交叉参考

- swarm teammate 运行时：[`./16-swarm-teammates-and-permission-bridges.md`](./16-swarm-teammates-and-permission-bridges.md)
- worker permission 起点：[`./22-swarm-worker-permission-origin-and-wait-state.md`](./22-swarm-worker-permission-origin-and-wait-state.md)
- permission dialog pipeline：[`./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md`](./23-permission-runtime-hooks-classifier-and-dialog-pipeline.md)
- managed agents 治理：[`./41-policy-settings-governance-across-agents-skills-output-styles-and-tips.md`](./41-policy-settings-governance-across-agents-skills-output-styles-and-tips.md)
- tasks / foreground / footer 前台：[`../architecture/21-coordinator-spinner-tree-and-teammate-view-runtime.md`](../architecture/21-coordinator-spinner-tree-and-teammate-view-runtime.md)
