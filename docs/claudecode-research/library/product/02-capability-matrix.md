# 产品 02：能力矩阵

## 研究问题

- Claude Code 的“能力”到底是哪些一等动作，而不是哪些营销词？
- 哪些能力在本地源码中有 A 级证据，哪些更多依赖官方表述？
- 从能力矩阵看，它与单纯代码聊天助手的分界线在哪里？

## 一句话结论

Claude Code 的能力矩阵可以概括为五层：代码与文件操作、执行与验证、会话与恢复、治理与安全、扩展与生态；其中最强的一层不是“生成代码”，而是“在受控边界内完成可恢复的任务闭环”。

## 官方主张 -> 用户可见行为 -> 源码实现

| 官方主张 | 用户可见行为 | 源码实现 |
| --- | --- | --- |
| How Claude Code Works 将工具能力分成 file/search/execution/web/code intelligence | 用户能把 Claude 当成会读、会搜、会改、会执行、会查文档的 agent | `packages/claude-code/src/tools.ts` 的 `getAllBaseTools()` 暴露 `Bash`、`Read/Edit/Write`、`Glob/Grep`、`WebFetch/WebSearch`、`TodoWrite`、`Skill`、`EnterPlanMode`、MCP resource tools 等 |
| Overview 把 git、PR、tests、lint、release notes、CI 等视作常规工作流 | 用户不是在问答，而是在交付目标任务 | `BashTool`、`AskUserQuestionTool`、`TodoWriteTool`、`TaskOutputTool`、`AgentTool` 与 `QueryEngine/query.ts` 的循环共同支撑“先做再验”的工作方式 |
| Settings 与 Permission Modes 把 mode / rules / policy 视作产品主能力 | 用户能在 default / acceptEdits / plan / auto / dontAsk / bypass 之间切换控制粒度 | `packages/claude-code/src/types/permissions.ts` 与 `utils/permissions/PermissionMode.ts` 定义权限模式；`main.tsx` 暴露 `--permission-mode` |
| Sub-agents 与 Skills 文档将扩展能力定义为标准能力面 | 用户能把复杂工作拆给 subagent、用 skills 固化流程、用 hooks/MCP 连接外部系统 | `packages/claude-code/src/tools/AgentTool/loadAgentsDir.ts` 支持 `skills`、`mcpServers`、`hooks`、`memory`、`background`、`isolation` frontmatter |

## 能力矩阵

| 能力层 | 对用户意味着什么 | 关键实现 |
| --- | --- | --- |
| 代码与文件 | 读文件、改文件、生成新文件、跨目录组织内容 | `tools.ts`, `Tool.ts` |
| 搜索与理解 | 在大型代码库中找入口、追调用、读上下文 | `Glob/Grep`、`processUserInput()`、`REPL.tsx` 引用能力 |
| 执行与验证 | 跑命令、测试、验证输出、生成 structured output | `BashTool`, `QueryEngine.ts`, `query.ts` |
| 会话与恢复 | 继续之前任务、分叉、重放、远端恢复、后台运行 | `sessionStorage.ts`, `sessionRestore.ts`, `LocalMainSessionTask.ts` |
| 治理与安全 | 切换 permission mode、应用 allow/deny 规则、hooks 审计、policy 限制 | `types/permissions.ts`, `utils/hooks/**`, `utils/settings/**`, `services/policyLimits/**` |
| 扩展与生态 | 自定义 skills、subagents、MCP servers、plugins | `skills/**`, `tools/AgentTool/**`, `services/mcp/**`, `plugins/**` |

## 第一性能力与次级能力

### 第一性能力

- `getAllBaseTools()` 暴露的动作空间是产品能力的真实上限，它比 README 或 marketing 文案更接近事实。
- `assembleToolPool()` 说明产品能力不是静态列表，而是“基础工具 + deny 规则过滤 + MCP 注入”的动态结果。
- `processUserInput()` 说明“输入能力”本身也是产品能力的一部分，因为 slash commands、attachments、hooks、bridge-safe command 都在模型前发生。
- `QueryEngine.submitMessage()` 与 `query()` 说明 Claude Code 的真正卖点是把这些能力串成可连续执行的 loop。

### 次级能力

- 单个具体工具名不是能力边界，能力边界更像“用户是否可以在当前治理条件下使用某类动作”。
- 许多官方表面能力，比如 Slack、GitHub、Chrome，本质上是扩展或接入面，而不是内核能力本身。

## 官方资料与仓库证据的对照

### 一致之处

- 官方把 Claude Code 讲成“带工具的 agent”，而不是普通 chat。`ToolUseContext` 和 `tools.ts` 直接证明这一点。
- 官方把 skills、subagents、MCP、hooks 视为扩展层；`loadAgentsDir.ts` 前置支持这些 frontmatter 字段，证明扩展不是边缘功能。
- 官方把 sessions、resume、worktrees、parallel work 视为常规工作流；`sessionStorage.ts` 与 `LocalMainSessionTask.ts` 证明它们是核心基础设施。

### 漂移与保留意见

- 官方会把 code intelligence、IDE 体验、桌面差异化能力说得很完整，但本仓内更强的是 runtime 能力，而不是所有壳层 UX 细节。
- 官方的“available everywhere”更像能力分发声明；真正的能力矩阵仍由本地工具池、query loop 与治理层定义。

## 对 Vigilon 的启发

- 产品矩阵不要围绕“模型能回答什么”组织，而要围绕“runtime 能在何种边界下完成什么任务闭环”组织。
- 先构造工具池、治理层、恢复层，再谈表面 UI，才能复制 Claude Code 的成熟感。

## 当前缺口

- `services/mcp/**` 尚未写成单独矩阵，当前只确认其在能力体系中的位置。
- `plugins/**` 仍需补证，尤其是 marketplace、managed policy 与 runtime 注入之间的关系。
