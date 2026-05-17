# Claude Code V2 变量与状态索引

本页聚焦“跨阶段传递且影响行为”的关键状态，而不是所有局部变量。

## 配套入口

- 主导航： [master-index.md](../master-index.md)、[reading-paths.md](../reading-paths.md)、[glossary.md](../glossary.md)
- 证据页： [evidence-ledger.md](./evidence-ledger.md)、[function-index.md](./function-index.md)

| 名称 | 文件 | 类型或形态 | 作用 | 主要读写位置 | 关联文档 |
| --- | --- | --- | --- | --- | --- |
| `args` | `packages/claude-code/src/entrypoints/cli.tsx` | `string[]` | CLI fast-path 分发条件的输入向量 | `main()` | [README.md](../README.md), [master-index.md](../master-index.md) |
| `mutableMessages` | `packages/claude-code/src/QueryEngine.ts` | `Message[]` | `QueryEngine` 跨 turn 持有的消息数组 | `constructor`, `submitMessage()` | [reading-paths.md](../reading-paths.md), [function-index.md](./function-index.md) |
| `processUserInputContext` | `packages/claude-code/src/QueryEngine.ts` | `ProcessUserInputContext` | 连接输入预处理、app state、工具上下文与模型配置 | `submitMessage()` | [function-index.md](./function-index.md), [evidence-ledger.md](./evidence-ledger.md) |
| `persistSession` | `packages/claude-code/src/QueryEngine.ts` | `boolean` | 决定 transcript 是否在当前会话中持久化 | `submitMessage()` | [evidence-ledger.md](./evidence-ledger.md), [reading-paths.md](../reading-paths.md) |
| `messages` | `packages/claude-code/src/query.ts` | `Message[]` | query loop 中的事实流主数组 | `State`, 每轮解构 | [function-index.md](./function-index.md), [reading-paths.md](../reading-paths.md) |
| `toolUseContext` | `packages/claude-code/src/query.ts`, `packages/claude-code/src/Tool.ts` | `ToolUseContext` | 工具、状态、权限、MCP、内容替换等运行时枢纽 | `State`, `queryLoop()` 更新与透传 | [glossary.md](../glossary.md), [evidence-ledger.md](./evidence-ledger.md) |
| `State` | `packages/claude-code/src/query.ts` | 结构化 loop state | 汇总跨轮状态：`messages`、`toolUseContext`、compact / budget / recovery 等 | `queryLoop()` | [glossary.md](../glossary.md), [function-index.md](./function-index.md) |
| `messagesForQuery` | `packages/claude-code/src/query.ts` | `Message[]` 派生视图 | 送往模型前的消息视图，会经历 replacement、snip、microcompact | `queryLoop()` | [evidence-ledger.md](./evidence-ledger.md), [reading-paths.md](../reading-paths.md) |
| `taskBudgetRemaining` | `packages/claude-code/src/query.ts` | `number | undefined` | compact 后继续维持 task budget 语义 | `queryLoop()` | [evidence-ledger.md](./evidence-ledger.md), [function-index.md](./function-index.md) |
| `contentReplacementState` | `packages/claude-code/src/Tool.ts` | `ContentReplacementState` | 工具结果预算替换的会话级状态 | `ToolUseContext`, `queryLoop()` | [glossary.md](../glossary.md), [evidence-ledger.md](./evidence-ledger.md) |
| `agentTranscriptSubdirs` | `packages/claude-code/src/utils/sessionStorage.ts` | `Map<string, string>` | 管理 subagent transcript 的分目录归属 | `getAgentTranscriptPath()` 等 | [function-index.md](./function-index.md), [evidence-ledger.md](./evidence-ledger.md) |
| `MAX_TRANSCRIPT_READ_BYTES` | `packages/claude-code/src/utils/sessionStorage.ts` | `number` | transcript 读取的安全上限 | transcript load / read path | [evidence-ledger.md](./evidence-ledger.md), [master-index.md](../master-index.md) |
| `ENABLED` | `packages/claude-code/src/utils/queryProfiler.ts` | `boolean` | 控制 query profiling 是否启用 | `startQueryProfile()`, `queryCheckpoint()` | [README.md](../README.md), [master-index.md](../master-index.md) |
| `DETAILED_PROFILING` | `packages/claude-code/src/utils/startupProfiler.ts` | `boolean` | 控制 startup profiling 是否输出详细报告 | `profileCheckpoint()`, `profileReport()` | [README.md](../README.md), [master-index.md](../master-index.md) |
| `AppState` | `packages/claude-code/src/state/AppStateStore.ts` | 会话级结构化状态树 | 统一承接 task frontend、settings、bridge、plugin、MCP、notifications 与 companion surface 的全局真相源 | `getDefaultAppState()`, `createAppStateStore()` | [architecture/41-state-management-store-provider-selector-and-sync-runtime.md](../architecture/41-state-management-store-provider-selector-and-sync-runtime.md), [architecture/42-buddy-companion-sprite-footer-and-intro-attachment-runtime.md](../architecture/42-buddy-companion-sprite-footer-and-intro-attachment-runtime.md) |
| `footerSelection` | `packages/claude-code/src/state/AppStateStore.ts` | `FooterItem \| null` | 记录 footer 当前 focus 的 pill，并把键盘导航与输入提交绑定到统一前台模式机 | `getDefaultAppState()`, `PromptInput.tsx`, `onChangeAppState.ts` | [architecture/31-task-frontend-selection-and-view-state-machine.md](../architecture/31-task-frontend-selection-and-view-state-machine.md), [architecture/32-footer-steering-and-pill-navigation-runtime.md](../architecture/32-footer-steering-and-pill-navigation-runtime.md), [architecture/41-state-management-store-provider-selector-and-sync-runtime.md](../architecture/41-state-management-store-provider-selector-and-sync-runtime.md) |
| `companionReaction` | `packages/claude-code/src/state/AppStateStore.ts` | `CompanionReaction \| null` | 让 REPL 事件侧与 CompanionSprite 渲染侧通过全局状态同步 companion 反应 | `getDefaultAppState()`, `REPL.tsx`, `CompanionSprite.tsx` | [architecture/42-buddy-companion-sprite-footer-and-intro-attachment-runtime.md](../architecture/42-buddy-companion-sprite-footer-and-intro-attachment-runtime.md), [architecture/41-state-management-store-provider-selector-and-sync-runtime.md](../architecture/41-state-management-store-provider-selector-and-sync-runtime.md) |

## 状态关系速记

### 会话外层

- `QueryEngine.mutableMessages` 代表跨 turn 的会话消息主存。
- `persistSession` 决定这些消息是否需要写回 transcript。

### turn 内层

- `queryLoop()` 使用 `State` 管理本轮到下一轮之间的可变状态。
- `State.messages` 是本轮主消息流，`messagesForQuery` 是送给模型前的派生视图。
- `toolUseContext` 同时承接工具执行期环境与内容替换、通知、状态更新接口。

### 磁盘与恢复层

- `sessionStorage.ts` 的 transcript 路径函数把 session / subagent 的 JSONL 写入位置结构化。
- `MAX_TRANSCRIPT_READ_BYTES` 等阈值说明恢复链路有明确的防 OOM 边界。

## 当前缺口

| 状态 | 缺口说明 |
| --- | --- |
| MCP 连接状态 | 还未把 `services/mcp/**` 内的连接状态对象纳入索引 |
| task / agent 运行态 | 还未把 `tasks/**` 中的 task 状态对象纳入索引 |
