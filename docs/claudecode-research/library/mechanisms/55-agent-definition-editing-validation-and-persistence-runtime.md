# Agent Definition Editing / Validation / Persistence Runtime

导航：[`首页`](../README.md) | [`总索引`](../master-index.md) | [`上一站：Agent Generation / Memory Injection / Materialization Runtime`](./56-agent-generation-memory-injection-and-materialization-runtime.md) | [`下一站：Agents Management / Detail / Editing Workbench`](../architecture/33-agents-management-detail-and-editing-workbench.md)

前面的几卷已经把 agent 的定义加载、spawn、memory、task host 和 `/agents` 工作台拆开了，但“编辑一个 agent 到底怎么变成真实定义”还没有单独讲清。真正的主链在这里：

- `components/agents/AgentEditor.tsx`
- `components/agents/ToolSelector.tsx`
- `components/agents/agentFileUtils.ts`
- `components/agents/validateAgent.ts`
- `tools/AgentTool/loadAgentsDir.ts`
- `tools/AgentTool/agentDisplay.ts`

这一卷不再讲 `/agents` 的菜单流转，而是讲 definition mutation runtime：格式化、路径寻址、校验、落盘、颜色注册、active roster 重算。

## 1. agent 编辑不是改内存对象，而是回写 markdown definition

源码镜像：[`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/AgentEditor.tsx), [`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`AgentEditor.handleSave()` 的核心不是 setState，而是：

1. `updateAgentFile(...)`
2. 如有颜色变化，`setAgentColor(...)`
3. 重写 `agentDefinitions.allAgents`
4. 重新算 `activeAgents: getActiveAgentsFromList(allAgents)`

这说明 agent 编辑在 Claude Code 里是一个三层写入事务：

- definition file
- identity sidecar state（颜色）
- runtime active roster

所以 `/agents` 不是临时 UI 偏好面，它直接改真实 agent definition。

## 2. markdown frontmatter 不是机械序列化，而是携带产品语义

源码镜像：[`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`formatAgentAsMarkdown()` 做了几件很重要的事情：

- `description` 被双引号包裹，并手动转义 `\`、`"`、换行
- `tools` 在 `undefined` 或 `['*']` 时完全省略
- `model / effort / color / memory` 都是“有值才落盘”的 optional line

这里最关键的是 `tools` 的写法。Claude Code 不是把 “all tools” 写成显式布尔，也不是永远写 `*`，而是把：

- `undefined`
- `['*']`

统一压成“frontmatter 中没有 tools 字段”。

这意味着文件格式本身就在编码一个产品语义：省略字段 = unrestricted，而不是“缺省值待补”。

## 3. source-specific path router 才是 agent persistence 的真实底座

源码镜像：[`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`getAgentDirectoryPath()` 并不是简单拼路径。它明确把 source 分成：

- `userSettings -> $CLAUDE_HOME/agents`
- `projectSettings -> <cwd>/.claude/agents`
- `policySettings -> managed path/.claude/agents`
- `localSettings -> <cwd>/.claude/agents`
- `flagSettings -> 直接报错`

这里有两个要点：

- `flagSettings` agent 从定义上就不是可持久化目录来源
- `policySettings` 走的是 managed path，不和普通工作区目录混写

所以编辑与创建路径一开始就受治理来源约束，不是所有 source 都能被同一个文件 API 平权处理。

## 4. “新文件路径”和“真实文件路径”是两套协议

源码镜像：[`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

这里分了四个函数：

- `getNewAgentFilePath()`
- `getActualAgentFilePath()`
- `getNewRelativeAgentFilePath()`
- `getActualRelativeAgentFilePath()`

它们不是重复封装，而是在解决两个不同问题：

- 创建新 agent 时，文件名来自当前 `agentType`
- 编辑已有 agent 时，文件名优先取 `filename`，而不是强行等于 `agentType`

这意味着 Claude Code 的 agent definition runtime 允许：

- display name / logical type
- on-disk filename

不是永远一一同名。这样旧文件、重命名后遗留文件、或特定来源的 filename 保留都不会被 UI 误写。

## 5. relative path 文案本身就是 source truth，不只是显示辅助

源码镜像：[`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`getActualRelativeAgentFilePath()` 的返回值不是一律相对路径：

- built-in -> `Built-in`
- plugin -> `Plugin: <name>`
- flagSettings -> `CLI argument`
- 其他 source 才返回真正的相对 `.md` 路径

所以 UI 里看到的 “路径” 实际上是来源语义层：

- 有些 agent 真正来自磁盘
- 有些来自 plugin materialization
- 有些来自 CLI 注入
- 有些根本没有可编辑文件

这也解释了为什么 `AgentEditor` 在保存前会强制检查可编辑来源。

## 6. built-in 和 plugin 不是“都不可直接编辑”，而是不可编辑原因不同

源码镜像：[`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/AgentEditor.tsx), [`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

这里存在两层不同限制：

- `getActualAgentFilePath()` 对 plugin 直接抛错，因为它没有普通本地定义文件语义
- `AgentEditor.handleSave()` 允许 `isCustomAgent(agent) || isPluginAgent(agent)` 进入保存路径

这两点一起看，真实语义是：

- built-in 绝不允许写回
- plugin agent 允许走“更新定义”的统一写入协议，但不承诺暴露一个普通可 handoff 的本地文件路径

也就是说 plugin agent 在 mutation runtime 里更像“可编排来源”，而不是单纯“文件系统来源”。

## 7. 写文件时用 `datasync()`，说明 definition persistence 被当成真实配置写入对待

源码镜像：[`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`writeFileAndFlush()` 不是 `writeFile` 完就结束，而是：

1. `open(filePath, flag)`
2. `handle.writeFile(...)`
3. `handle.datasync()`
4. `handle.close()`

这表示 agent definition 写入被当成需要 flush 的配置更新，而不是普通临时缓存文件。尤其在：

- 创建新 agent
- 覆写已有 agent
- 依赖后续重启/重载去重新发现

这些路径上，显式 `datasync()` 能减少“文件写完但磁盘状态还没稳”的窗口。

## 8. create 和 update 的失败语义不一样

源码镜像：[`../../sources/claude-code/src/components/agents/agentFileUtils.ts`](../../sources/claude-code/src/components/agents/agentFileUtils.ts)

`saveAgentToFile()` 和 `updateAgentFile()` 复用了同一个写入底座，但错误模型不同：

- create 可选 `checkExists=true`，并把 `EEXIST` 翻译成明确的 “Agent file already exists”
- update 不做这个 gate，直接覆盖真实路径

这说明 Claude Code 把“创建重复 agent”和“更新现有 agent”视为两种不同的 operator error：

- create 要保护命名/来源空间
- update 要忠实覆盖既有 definition

## 9. validation 真正在检查的是“能否装配进运行时”，不只是表单合法性

源码镜像：[`../../sources/claude-code/src/components/agents/validateAgent.ts`](../../sources/claude-code/src/components/agents/validateAgent.ts)

`validateAgent()` 做了四类校验：

- `agentType` 语法：字母数字和连字符、长度 3-50、首尾必须是字母数字
- duplicate 检查：同名但不同 source 直接报冲突
- `whenToUse` / `getSystemPrompt()` 的长度与缺失
- `resolveAgentTools(agent, availableTools, false)` 的 invalid tools 检查

这里最关键的是最后一条。它不是只看字符串数组类型，而是直接调用真实的 tool resolution runtime。也就是说 validation 问的是：

- 这个 definition 放进当前宿主后，能不能 resolve 成可运行的工具面

而不是“frontmatter 看起来像不像对的”。

## 10. duplicate 规则按 `(agentType, source)` 看 inventory，但校验按 `agentType` 看冲突

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/agentDisplay.ts`](../../sources/claude-code/src/tools/AgentTool/agentDisplay.ts), [`../../sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts`](../../sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts), [`../../sources/claude-code/src/components/agents/validateAgent.ts`](../../sources/claude-code/src/components/agents/validateAgent.ts)

这里有一条很容易混淆的双重语义：

- `resolveAgentOverrides()` 会按 `(agentType, source)` 去重，这是为了容忍 git worktree duplicate load
- `validateAgent()` 会把“同名、不同 source”当成真正冲突

这说明：

- 运行时 inventory 可以容忍重复加载同一来源的副本
- 但 definition authoring 不鼓励再制造一个会和别的来源抢 precedence 的同名 agent

所以 authoring runtime 比 display runtime 更严格。

## 11. `getActiveAgentsFromList()` 是编辑保存后的真正收口点

源码镜像：[`../../sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts`](../../sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts), [`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/AgentEditor.tsx), [`../../sources/claude-code/src/components/agents/AgentsMenu.tsx`](../../sources/claude-code/src/components/agents/AgentsMenu.tsx)

active roster 的 precedence 顺序是：

- built-in
- plugin
- user
- project
- flag
- managed

然后用 `Map<agentType, agent>` 逐组覆盖。

`AgentEditor.handleSave()` 和 `AgentsMenu.handleAgentDeleted()` 都在最后调用：

- `getActiveAgentsFromList(allAgents)`

所以“编辑一个 agent”真正生效的瞬间，不是文件写完，而是这次 active roster 再计算完成。definition persistence 和 runtime precedence 在这里闭环。

## 12. `ToolSelector` 并不是把前台选择直接原样写回

源码镜像：[`../../sources/claude-code/src/components/agents/ToolSelector.tsx`](../../sources/claude-code/src/components/agents/ToolSelector.tsx), [`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/AgentEditor.tsx)

`ToolSelector` 有几层值得单独注意的协议：

- `initialTools === undefined || includes('*')` 时，会先展开成当前 custom-agent 可用工具全集
- 内部始终维护具体的 `selectedTools`
- `handleConfirm()` 时，如果发现“所有可用工具都被选中”，最终回传 `undefined`

这意味着工具编辑面故意把：

- 前台显式全选

重新压回：

- definition 层的“省略 tools 字段”

所以 UI state 和 persistence state 不是同构的，中间有一次 canonicalization。

## 13. MCP tools 在编辑面不是普通工具名，而是 server-aware capability cluster

源码镜像：[`../../sources/claude-code/src/components/agents/ToolSelector.tsx`](../../sources/claude-code/src/components/agents/ToolSelector.tsx)

`ToolSelector` 先按 bucket 分：

- `READ_ONLY`
- `EDIT`
- `EXECUTION`
- `MCP`
- `OTHER`

然后又对 MCP 单独跑：

- `mcpInfoFromString(tool.name)`
- `serverName` 分组

所以 agent tool 编辑不是“勾 MCP 工具字符串”，而是同时保留：

- 产品层 bucket 语义
- MCP server 级组织语义

这使得 agent authoring 更接近 capability curation，而不是裸字符串列表维护。

## 14. agent 编辑运行时和 `/agents` UI 是两层，不能混成一层理解

源码镜像：[`../../sources/claude-code/src/components/agents/AgentsMenu.tsx`](../../sources/claude-code/src/components/agents/AgentsMenu.tsx), [`../../sources/claude-code/src/components/agents/AgentEditor.tsx`](../../sources/claude-code/src/components/agents/AgentEditor.tsx), [`../../sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts`](../../sources/claude-code/src/tools/AgentTool/loadAgentsDir.ts), [`../../sources/claude-code/src/tools/AgentTool/agentDisplay.ts`](../../sources/claude-code/src/tools/AgentTool/agentDisplay.ts)

把这条链收束起来，`/agents` 实际是两层：

- 前台层：`AgentsMenu / AgentsList / AgentDetail / AgentEditor`
- 机制层：`agentFileUtils / validateAgent / getActiveAgentsFromList / resolveAgentOverrides`

前台层负责：

- 浏览、选择、切换模式、发起编辑

机制层负责：

- 定义规范化
- 路径治理
- 写盘原子性
- 校验
- precedence 收口

真正让 Claude Code 的 agent system 能稳定工作的，不是菜单本身，而是后面这层 definition mutation runtime。
