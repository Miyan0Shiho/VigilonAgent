# Claude Code 深度研究文档库 V2

## 定位

本目录是 `claude-code-deep-dive` 的 V2 入口层与证据层初稿，用于把旧版研究骨架升级为更适合长期维护、顺序阅读与 agent 检索的研究库。

## 当前已存在文档

| 状态 | 文档 | 作用 |
| --- | --- | --- |
| 已存在 | [README.md](./README.md) | 说明研究库定位、边界、当前基线与缺口 |
| 已存在 | [master-index.md](./master-index.md) | 按问题域组织入口、证据与源码 |
| 已存在 | [reading-paths.md](./reading-paths.md) | 提供人类阅读路径与 agent 调研路径 |
| 已存在 | [glossary.md](./glossary.md) | 统一术语，避免跨卷册概念漂移 |
| 已存在 | [evidence/evidence-ledger.md](./evidence/evidence-ledger.md) | 记录 A/B/C 级结论、漂移与缺口 |
| 已存在 | [evidence/doc-to-source-map.md](./evidence/doc-to-source-map.md) | 从文档规划反推源码入口 |
| 已存在 | [evidence/source-to-doc-map.md](./evidence/source-to-doc-map.md) | 从源码入口反推当前文档与规划落点 |
| 已存在 | [evidence/function-index.md](./evidence/function-index.md) | 函数级观察点索引 |
| 已存在 | [evidence/variable-state-index.md](./evidence/variable-state-index.md) | 状态与关键变量索引 |
| 已存在 | [evidence/external-sources.md](./evidence/external-sources.md) | 外部资料与旧稿底稿台账 |
| 已存在 | [users/04.md](./users/04.md) | 集成商与自动化流水线画像 |
| 已存在 | [synthesis/01-04.md](./synthesis/01-04.md) | 画像模式、规避项与机会点综合提炼 |
| 已存在 | [../figures/index.md](../figures/index.md) | 图谱索引初稿，登记现有 SVG 资产与回链状态 |

## 当前规划文档

以下文档尚未创建，当前只在映射页中保留规划位，避免把“未来卷册”误读成“已存在正文”。

| 状态 | 规划文档族 | 说明 |
| --- | --- | --- |
| 规划中 | `architecture/*` | 入口装配、运行时内核、UI/REPL/Ink 等架构卷册 |
| 规划中 | `implementation/*` | CLI dispatch、输入预处理、query engine、query loop 等实现卷册 |
| 规划中 | `mechanisms/*` | tools、skills、MCP、tasks、observability 等机制卷册 |
| 规划中 | `product/*` | 工作流与模式等产品层卷册 |

## 本轮范围

- 建立 V2 研究库的统一入口、阅读导航与证据层。
- 把旧版 deep dive 中可复用的问题域、入口文件和主题层次迁移到新目录。
- 用当前仓库的 `packages/claude-code/src/**` 核实第一批 A/B/C 级证据，避免直接照搬旧稿路径假设。
- 为后续产品层、架构层、实现层、机制层卷册准备双向映射、函数索引和状态索引。

## 研究对象

### 一级主轴

- `packages/claude-code/src/entrypoints/cli.tsx`
- `packages/claude-code/src/main.tsx`
- `packages/claude-code/src/QueryEngine.ts`
- `packages/claude-code/src/query.ts`
- `packages/claude-code/src/Tool.ts`
- `packages/claude-code/src/tools.ts`
- `packages/claude-code/src/utils/processUserInput/processUserInput.ts`
- `packages/claude-code/src/utils/sessionStorage.ts`

### 二级延展

- `packages/claude-code/src/services/api/**`
- `packages/claude-code/src/services/mcp/**`
- `packages/claude-code/src/skills/**`
- `packages/claude-code/src/tasks/**`
- `packages/claude-code/src/screens/**`
- `packages/claude-code/src/ink/**`
- `packages/claude-code/src/utils/queryProfiler.ts`
- `packages/claude-code/src/utils/startupProfiler.ts`

## 已确认的 V2 基线

- CLI 入口不是单一路径，而是以 `main()` 为核心的 fast-path 分发层，先处理 `--version`、bridge、daemon、background sessions、runner、tmux/worktree 等轻量入口，再进入完整主程序。
- `main.tsx` 是高成本装配层，承担 settings、policy limits、MCP、plugins、skills、LSP、REPL 启动等初始化责任。
- `QueryEngine.submitMessage()` 连接输入预处理、system prompt 组装、会话持久化与 `query()` 主循环，是非交互或 SDK 模式的会话级中枢。
- `query.ts` 内部的 `State`、`query()`、`queryLoop()` 承担 turn 级执行复杂度，包括 budget、microcompact、工具结果替换、stop hooks 与递归调用控制。
- `ToolUseContext` 不是“工具元数据”，而是运行时枢纽，既携带 tools、commands、MCP、thinking、permissions 等上下文，也携带 app state 与内容替换等执行期状态。
- `sessionStorage.ts` 采用 JSONL transcript 作为恢复底座，并显式处理 compact boundary、subagent transcript、content replacement 和 resume 相关路径。

## 与旧版 deep dive 的关系

可复用的部分：

- 问题域组织方式：产品面、系统骨架、query loop、工具与技能、权限与扩展、任务与会话、REPL/Ink、可观测性。
- 入口文件集合与总索引结构。
- 官方资料与源码的双向映射思路。

本轮主动修正的部分：

- 所有 V2 证据条目以 `packages/claude-code/src/**` 的当前路径为准，不沿用旧稿中简写的 `src/**` 作为最终事实表达。
- 旧稿里部分“无源码即推论”的判断，在 V2 中降为 B/C 级或移入缺口列表。
- 对 `processUserInput`、`QueryEngine.submitMessage`、`ToolUseContext`、`sessionStorage` 这类关键符号，优先下钻到函数与状态级，而非只写模块职责。

## 使用方式

- 从 [master-index.md](./master-index.md) 进入问题导航
- 从 [reading-paths.md](./reading-paths.md) 选择阅读路径
- 从 [glossary.md](./glossary.md) 对齐术语，避免不同卷册混用概念。
- 从 [evidence/](./evidence/) 进入证据与映射
- 从 [figures/index.md](./figures/index.md) 查看 V2 核心 SVG 图谱 (01-10)

## 当前缺口

- 仍未展开 V2 的产品层、架构层、实现层、机制层正文卷册；当前只有入口层与证据层。
- 尚未系统覆盖 `remote/`、`bridge/`、`voice/`、`buddy/`、`plugins/`、`analytics/` 的细化调用链。
- 旧版 deep dive 中的任务流样本还没有迁移为 V2 语义下的“阅读路径 + 证据回链”结构。
- 仓库内已存在共享 SVG 图谱，但 V2 仍未完成“图谱 -> 文档”和“文档 -> 图谱”的系统回链。

## 写作规则

- 事实、解释、判断分层书写。
- 高价值结论优先绑定具体文件、函数、状态或调用链。
- 旧版 deep dive 只作为参考底稿，不作为自动继承的事实来源。
- 缺口必须显式记录在证据页，不能藏在叙述性文字里。
