# Claude Code V2 证据台账

**状态：已完成**
## 配套入口

- 当前入口： [README.md](../README.md)、[master-index.md](../master-index.md)、[reading-paths.md](../reading-paths.md)、[glossary.md](../glossary.md)
- 映射页： [doc-to-source-map.md](./doc-to-source-map.md)、[source-to-doc-map.md](./source-to-doc-map.md)
- 图谱页： [../figures/index.md](../figures/index.md)
- 说明：下表中的“旧版/外部补强”会区分“已存在文档”和“规划中卷册”，避免把规划稿误记为现状

## 证据等级说明

- A：已由当前仓库本地源码直接证明，能落到具体文件、函数、状态或调用链。
- B：主要由本地源码支持，但解释仍依赖旧版 deep dive 或官方文档补强。
- C：当前只看到局部实现或入口，仍需继续穿透调用链或运行时验证。

## 已确认结论

| 结论 | 证据等级 | 当前源码证据 | 旧版/外部补强 | 状态 |
| --- | --- | --- | --- | --- |
| CLI 入口是多路 fast-path 分发层，而不是“先加载全部模块再进入 TUI” | A | `packages/claude-code/src/entrypoints/cli.tsx` 的 `main()` 先处理 `--version`、bridge、daemon、background sessions、templates、runners、tmux/worktree 等分支 | 已在 [architecture/01-04.md](../architecture/01-04.md) 与 [implementation/01-08.md](../implementation/01-08.md) 中详细记录 | 已确认 |
| `main.tsx` 是高成本装配层，负责 settings、policy、MCP、plugins、skills、LSP 与运行模式初始化 | A | `packages/claude-code/src/main.tsx` 的 import 与初始化依赖链 | 已在 [architecture/01-04.md](../architecture/01-04.md) 中记录 | 已确认 |
| `QueryEngine.submitMessage()` 是 headless 或 SDK 会话级中枢，连接输入预处理、system prompt 组装、transcript 持久化与 `query()` | A | `packages/claude-code/src/QueryEngine.ts` 的 `submitMessage()` | 已在 [architecture/01-04.md](../architecture/01-04.md) 与 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| 用户输入在进入模型前会经过 `processUserInput()`，其中包含 slash command、attachments、hooks、权限模式和 `shouldQuery` 决策 | A | `packages/claude-code/src/utils/processUserInput/processUserInput.ts` | 已在 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| `query.ts` 的 `State`、`query()`、`queryLoop()` 承担真正的 agent loop 复杂度 | A | `packages/claude-code/src/query.ts` | 已在 [architecture/01-04.md](../architecture/01-04.md) 与 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| `queryLoop()` 在模型请求前会对 `messagesForQuery` 执行结果预算替换、snip、microcompact 等上下文变换 | A | `packages/claude-code/src/query.ts` 中 `applyToolResultBudget()`、`recordContentReplacement()`、`snipCompactIfNeeded()`、`microcompact()` 的调用链 | 已在 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| `ToolUseContext` 是工具、MCP、状态更新、通知与内容替换的运行时汇流点 | A | `packages/claude-code/src/Tool.ts` 的 `ToolUseContext` 类型 | 已在 [architecture/01-04.md](../architecture/01-04.md) 中记录 | 已确认 |
| 工具池不是静态列表，而是经过 base tools、simple mode、deny rules、REPL 过滤和 MCP 合池后的动态结果 | A | `packages/claude-code/src/tools.ts` 的 `getAllBaseTools()`、`getTools()`、`assembleToolPool()` | 已在 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| transcript JSONL 是恢复能力基座，且 `QueryEngine.submitMessage()` 会在进入 query loop 前先持久化用户消息以保障可恢复性 | A | `packages/claude-code/src/utils/sessionStorage.ts`, `packages/claude-code/src/QueryEngine.ts` | 已在 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| `sessionStorage.ts` 还承担 subagent transcript 路径、compact boundary、content replacement 等磁盘侧组织责任 | A | `packages/claude-code/src/utils/sessionStorage.ts` | 已在 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| 仓库已内建 query profiling 与 startup profiling，而不是完全缺失可观测性 | A | `packages/claude-code/src/utils/queryProfiler.ts`, `packages/claude-code/src/utils/startupProfiler.ts` | 已有 profiling，不是从零开始 | 已确认 |
| API streaming 层承载 betas、工具 schema、上下文管理与 tracing，是后续实现层的重要证据区 | A | `packages/claude-code/src/services/api/claude.ts` | 已在 [implementation/01-08.md](../implementation/01-08.md) 中记录 | 已确认 |
| `services/mcp/**` 与 `tasks/**` 构成扩展与多代理边界，但当前还缺少完整的会话生命周期图 | B | 目录与若干入口已确认存在 | 已在 [implementation/01-08.md](../implementation/01-08.md) 中初步穿透 | 待完善 |

## 旧稿与现状的漂移

| 主题 | 旧版表述 | 当前核查结果 | 处理方式 |
| --- | --- | --- | --- |
| 源码路径写法 | 常用 `src/...` 简写 | V2 统一改为 `packages/claude-code/src/...` 作为正式证据表达 | 已修正 |
| QueryEngine 的定位 | 旧稿称其是“会话级组装层” | 当前源码显示这一点成立，而且比旧稿更能证明 transcript 提前写入与消息持久化时序 | 已升级为 A 级 |
| ToolUseContext 的作用 | 旧稿偏模块说明 | 当前源码证明它直接承载状态更新、通知、prompt、replacement、MCP 等执行期字段 | 已升级为状态级描述 |
| 图谱状态 | 旧稿默认图谱作为补充材料，不强调索引页 | 仓库内已存在共享 SVG 图谱，但 V2 此前缺少统一索引与回链入口 | 已补 [../../figures/index.md](../../figures/index.md) 初稿 |
| observability | 旧稿主要写 queryProfiler / startupProfiler | 当前源码还显示 `services/api/claude.ts` 有 tracing / logging / checkpoint 相关入口 | 待扩展 |

## 当前缺口

| 缺口 | 原因 | 建议下一步 |
| --- | --- | --- |
| `main.tsx` 初始化顺序尚未完整写成依赖图 | 文件过大，当前只完成入口级核查 | 先拆出 settings/policy/MCP/plugins/skills/LSP 五段装配图 |
| `services/mcp/**` 还未下钻到连接建立、资源合并和权限边界 | 目前只确认目录和若干入口文件 | 从 `client.ts`、`config.ts`、`MCPConnectionManager.tsx` 开始补证 |
| `tasks/**` 与 `AgentTool/**` 的 transcript / session 关系尚未闭环 | 已确认 task 与 agent 文件存在，但未完成主链阅读 | 以 `LocalAgentTask`、`RemoteAgentTask`、`LocalMainSessionTask` 为入口 |
| REPL / Ink 状态承接层尚未迁入 V2 | 本轮只做入口文档与证据层 | 后续补 `screens/REPL.tsx`、`components/**`、`ink/**` |
| 图谱与正文仍未形成双向回链 | 新增了图谱索引，但每张图还没有稳定挂接到具体卷册 | 从 `architecture-claude-code.svg` 与 `planner-executor-sequence.svg` 先建立首批回链 |
