# Claude Code V2 术语表

## 配套入口

- 当前入口： [README.md](./README.md)、[master-index.md](./master-index.md)、[reading-paths.md](./reading-paths.md)
- 证据页： [evidence-ledger.md](./evidence/evidence-ledger.md)、[function-index.md](./evidence/function-index.md)、[variable-state-index.md](./evidence/variable-state-index.md)
- 图谱页： [figures/index.md](./figures/index.md)
- 规划卷册：统一以 [doc-to-source-map.md](./evidence/doc-to-source-map.md) 为准；本页不把规划词条误写成已存在正文

## 产品术语

| 术语 | 定义 | 当前源码锚点 | 备注 |
| --- | --- | --- | --- |
| fast-path | 在完整主程序装载前就提前分发并退出的轻量入口路径 | `packages/claude-code/src/entrypoints/cli.tsx` | 如 `--version`、bridge、daemon、background session、runner 等 |
| 完整主程序 | 进入 `main.tsx` 后的高成本初始化与运行模式 | `packages/claude-code/src/main.tsx` | 初始化 settings、policy、plugins、skills、REPL 等 |
| query loop | 单次任务/会话中的核心 agent 执行循环 | `packages/claude-code/src/query.ts` | 主要由 `query()` 和 `queryLoop()` 构成 |
| headless / SDK 模式 | 不依赖交互式 REPL、由 `QueryEngine` 驱动的会话执行模式 | `packages/claude-code/src/QueryEngine.ts` | 适合解释 API/SDK 侧链路 |

## 运行时术语

| 术语 | 定义 | 当前源码锚点 | 备注 |
| --- | --- | --- | --- |
| `ToolUseContext` | 工具执行、状态更新、MCP、通知、内容替换等运行时上下文对象 | `packages/claude-code/src/Tool.ts` | 是运行时枢纽，不只是工具描述 |
| `State` | `queryLoop()` 内跨迭代传递的可变状态容器 | `packages/claude-code/src/query.ts` | 持有 `messages`、`toolUseContext`、budget 相关状态 |
| `mutableMessages` | `QueryEngine` 内跨 turn 持有的消息数组 | `packages/claude-code/src/QueryEngine.ts` | 与 `State.messages` 相关，但生命周期更外层 |
| `messagesForQuery` | `queryLoop()` 内送往模型前的消息视图 | `packages/claude-code/src/query.ts` | 可能经过 content replacement、snip、microcompact |
| transcript | 写入磁盘的 JSONL 会话记录 | `packages/claude-code/src/utils/sessionStorage.ts` | 是恢复与追溯的关键底座 |

## 工具与扩展术语

| 术语 | 定义 | 当前源码锚点 | 备注 |
| --- | --- | --- | --- |
| built-in tools | 代码内置工具集合 | `packages/claude-code/src/tools.ts` | 由 `getAllBaseTools()` / `getTools()` 暴露 |
| MCP tools | 来自 MCP server 的工具 | `packages/claude-code/src/services/mcp/**` | 与 built-in tools 在工具池层合流 |
| tool pool | 模型可见的最终工具集合 | `packages/claude-code/src/tools.ts` | `assembleToolPool()` 是关键合流点 |
| skill | 独立加载的能力包或提示资源 | `packages/claude-code/src/skills/**` | 旧版研究中已视为核心扩展能力 |
| subagent / task | 子代理与任务执行单元 | `packages/claude-code/src/tasks/**`, `packages/claude-code/src/tools/AgentTool/**` | 需继续核实与 transcript / session 的关系 |

## 状态与会话术语

| 术语 | 定义 | 当前源码锚点 | 备注 |
| --- | --- | --- | --- |
| compact boundary | 会话压缩后的边界标记 | `packages/claude-code/src/query.ts`, `packages/claude-code/src/utils/sessionStorage.ts` | 与恢复、保留段和 transcript 写入顺序相关 |
| content replacement | 对工具结果做预算约束和替换记录的机制 | `packages/claude-code/src/query.ts`, `packages/claude-code/src/utils/sessionStorage.ts` | `recordContentReplacement()` 是关键证据点 |
| session persistence | 将会话状态写入 transcript 并支持恢复的能力 | `packages/claude-code/src/bootstrap/state.ts`, `packages/claude-code/src/utils/sessionStorage.ts` | 当前已确认是 V2 核心能力 |
| subagent transcript | 主会话之外为 agent/task 生成的 transcript | `packages/claude-code/src/utils/sessionStorage.ts` | 已看到路径组织逻辑，尚未完整写出生命周期 |

## 用户与治理术语

| 术语 | 定义 | 当前源码锚点 | 备注 |
| --- | --- | --- | --- |
| permission context | 工具授权、deny/allow 规则与工作目录边界 | `packages/claude-code/src/Tool.ts`, `packages/claude-code/src/tools.ts` | 直接影响工具可见性和执行行为 |
| policy limits | 组织级策略限制 | `packages/claude-code/src/main.tsx`, `packages/claude-code/src/services/policyLimits/index.ts` | bridge、remote control 等能力会受其控制 |
| hooks | prompt 或执行过程中的可插入控制点 | `packages/claude-code/src/utils/hooks/**`, `packages/claude-code/src/utils/processUserInput/processUserInput.ts` | 用户输入提交流程已确认会执行 hooks |
| observability | 启动、query、API 等路径的 profiling / logging 能力 | `packages/claude-code/src/utils/queryProfiler.ts`, `packages/claude-code/src/utils/startupProfiler.ts`, `packages/claude-code/src/services/api/claude.ts` | 当前代码库已有现成基座 |
