# Claude Code V2 函数索引

本页收录“最值得先读”的函数，不追求穷尽，而追求能快速串起主链。

## 配套入口

- 主导航： [master-index.md](../master-index.md)、[reading-paths.md](../reading-paths.md)
- 证据页： [evidence-ledger.md](./evidence-ledger.md)、[variable-state-index.md](./variable-state-index.md)
- 映射页： [doc-to-source-map.md](./doc-to-source-map.md)、[source-to-doc-map.md](./source-to-doc-map.md)

| 符号 | 文件 | 责任 | 关键状态或变量 | 上游 | 下游 | 相关文档 |
| --- | --- | --- | --- | --- | --- | --- |
| `main()` | `packages/claude-code/src/entrypoints/cli.tsx` | CLI 入口分发；在加载完整主程序前处理 fast-path | `args` | `node` / `claude` CLI 进程启动 | 动态导入 bridge、daemon、bg、runner 或完整 CLI | [README.md](../README.md), [master-index.md](../master-index.md) |
| `submitMessage()` | `packages/claude-code/src/QueryEngine.ts` | 会话级提交：组装 system prompt、执行输入预处理、写 transcript、进入 `query()` | `mutableMessages`, `processUserInputContext`, `persistSession` | SDK 或 headless 调用方 | `processUserInput()`, `recordTranscript()`, `query()` | [reading-paths.md](../reading-paths.md), [evidence-ledger.md](./evidence-ledger.md) |
| `processUserInput()` | `packages/claude-code/src/utils/processUserInput/processUserInput.ts` | prompt 预处理；执行 hooks 并决定 `shouldQuery` | `input`, `mode`, `context`, `messages`, `querySource` | `submitMessage()` 或 REPL 提交路径 | `processUserInputBase()`, hooks 执行、消息构造 | [reading-paths.md](../reading-paths.md), [source-to-doc-map.md](./source-to-doc-map.md) |
| `query()` | `packages/claude-code/src/query.ts` | `queryLoop()` 的外层包装；负责 consumed command 生命周期完成标记 | `consumedCommandUuids` | `QueryEngine.submitMessage()`、REPL 查询入口 | `queryLoop()` | [reading-paths.md](../reading-paths.md), [evidence-ledger.md](./evidence-ledger.md) |
| `queryLoop()` | `packages/claude-code/src/query.ts` | turn 级循环；执行上下文整理、budget、compact、API 请求、工具执行与续轮控制 | `state`, `messagesForQuery`, `taskBudgetRemaining`, `toolUseContext` | `query()` | `applyToolResultBudget()`, `microcompact()`, API streaming, tool execution | [reading-paths.md](../reading-paths.md), [variable-state-index.md](./variable-state-index.md) |
| `getAllBaseTools()` | `packages/claude-code/src/tools.ts` | 定义当前环境下所有可能可见的 built-in tools | `process.env`, feature gates | `getToolsForDefaultPreset()`, `getTools()` | built-in tool 列表 | [glossary.md](../glossary.md), [source-to-doc-map.md](./source-to-doc-map.md) |
| `getTools()` | `packages/claude-code/src/tools.ts` | 根据 simple mode、deny rules、REPL 模式过滤 built-in tools | `permissionContext`, `allowedTools` | `assembleToolPool()`, 其他工具选择路径 | 最终 built-in tools | [glossary.md](../glossary.md), [evidence-ledger.md](./evidence-ledger.md) |
| `assembleToolPool()` | `packages/claude-code/src/tools.ts` | 把 built-in tools 与 MCP tools 合并为模型可见工具池 | `permissionContext`, `mcpTools` | REPL / Agent 运行时 | 合并后的工具集合 | [glossary.md](../glossary.md), [source-to-doc-map.md](./source-to-doc-map.md) |
| `isTranscriptMessage()` | `packages/claude-code/src/utils/sessionStorage.ts` | 定义哪些 entry 属于 transcript message | `entry.type` | transcript 读写链路 | transcript 过滤和加载 | [evidence-ledger.md](./evidence-ledger.md), [variable-state-index.md](./variable-state-index.md) |
| `getTranscriptPath()` | `packages/claude-code/src/utils/sessionStorage.ts` | 生成当前 session transcript 路径 | `getSessionProjectDir()`, `getSessionId()` | transcript 写入和加载 | 具体 JSONL 文件路径 | [reading-paths.md](../reading-paths.md), [variable-state-index.md](./variable-state-index.md) |
| `getAgentTranscriptPath()` | `packages/claude-code/src/utils/sessionStorage.ts` | 生成 subagent transcript 路径 | `agentTranscriptSubdirs`, `sessionId` | subagent 或 task 持久化链路 | 具体 agent JSONL 文件路径 | [evidence-ledger.md](./evidence-ledger.md), [source-to-doc-map.md](./source-to-doc-map.md) |
| `recordContentReplacement()` | `packages/claude-code/src/utils/sessionStorage.ts` | 持久化工具结果替换记录 | content replacement records | `queryLoop()` 中 budget 替换路径 | sidecar / transcript 关联记录 | [glossary.md](../glossary.md), [variable-state-index.md](./variable-state-index.md) |
| `loadTranscriptFromFile()` | `packages/claude-code/src/utils/sessionStorage.ts` | 从磁盘恢复 transcript | transcript file, JSONL parser | resume / 恢复路径 | 会话加载与恢复 | [master-index.md](../master-index.md), [doc-to-source-map.md](./doc-to-source-map.md) |
| `queryCheckpoint()` | `packages/claude-code/src/utils/queryProfiler.ts` | 为 query 路径打 checkpoint | checkpoint name | `query.ts`, `processUserInput()`, API 路径 | profiling report | [README.md](../README.md), [evidence-ledger.md](./evidence-ledger.md) |
| `profileCheckpoint()` | `packages/claude-code/src/utils/startupProfiler.ts` | 为启动路径打 checkpoint | checkpoint name | `entrypoints/cli.tsx`, `main.tsx`, `init.ts` | startup report / Statsig logging | [README.md](../README.md), [evidence-ledger.md](./evidence-ledger.md) |

## 优先补充的函数族

| 函数族 | 原因 | 当前状态 | 规划落点 |
| --- | --- | --- | --- |
| `services/api/claude.ts` 中真正发起 streaming 请求的函数 | 关系到 TTFT、tool schema、betas、tracing | 只完成文件级确认，待补函数级索引 | [implementation/01-08.md](../implementation/01-08.md) |
| `services/mcp/client.ts` / `config.ts` / `MCPConnectionManager.tsx` | 关系到 MCP 生命周期和工具合流 | 已确认入口文件存在，待补函数级索引 | [mechanisms/01-07.md](../mechanisms/01-07.md) |
| `tasks/**` 与 `tools/AgentTool/**` 中 session 相关函数 | 关系到 subagent 或 task 生命周期 | 已确认 `LocalAgentTask`、`RemoteAgentTask`、`LocalMainSessionTask` 存在，待补主链 | [mechanisms/01-07.md](../mechanisms/01-07.md) |
