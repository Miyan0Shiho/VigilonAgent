# Claude Code 全源码后端优先迁移三步总计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` 或逐任务内联执行。本计划只允许 3 个总波次，执行时严格保持“先镜像、后替换、最后接 TUI”的顺序，避免在多轮改写中偏离 Claude Code 原实现。

**Goal:** 在 `packages/core/src` 中以镜像式目录结构对 Claude Code 完整产品栈做后端优先的像素级迁移规划，最大化保留原源码边界、调用链和实现顺序，并把 `deepseek-tui` 仅作为 GitHub 外部替换知识用于后续 Anthropic 专有服务替换。

**Architecture:** 第一原则不是重构，而是复刻。`docs/superpowers/research/sources/claude-code/src` 继续作为只读上游基线，`packages/core/src` 作为后端主落点，优先镜像 `tools/`、`tasks/`、`bridge/`、`remote/`、`state/`、`services/`、`utils/`、`entrypoints/` 等目录；仅在确有必要时把公共协议沉到 `packages/shared`。所有 Anthropic 专有接口先保留等位边界和替换挂点，替换原则参考 GitHub 外部知识 `deepseek-tui`，但不把它作为本轮计划的本地依赖。

**Tech Stack:** TypeScript、Node.js、Monorepo、Vitest、Claude Code 源码镜像、模块级迁移文档、接口替换账本。

---

## Summary

- 这是一份**全源码迁移总图**，不是只做某个单点功能，也不是只做 TUI。
- 整体计划只分 **3 步**，满足你的约束。
- 迁移原则固定为：
  - `TypeScript 一比一`
  - `packages/core/src` 镜像式落盘
  - `后端优先`
  - `尽量完全按 Claude Code 实现走`
  - `Anthropic 专有服务先保留等位接口，后续参考 deepseek-tui 做 DeepSeek 替换`
- 当前仓库已经存在一小段试探性 `packages/tui` 起步代码，但这次总计划将其降级为**第三步接入面**，不再作为主线。

## Current State Analysis

### 仓库现状

- 根工作区已存在：
  - [package.json](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/package.json)
  - [pnpm-workspace.yaml](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/pnpm-workspace.yaml)
  - [tsconfig.base.json](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/tsconfig.base.json)
- 当前包结构已存在：
  - `packages/core`
  - `packages/shared`
  - `packages/tui`
- 其中 `packages/tui` 已有最小入口、组件和测试，但这些文件当前仍属于“前端先行的试探性落点”，与现在的“后端优先、全源码镜像迁移”方向不一致。

### Claude Code 上游源码真实范围

- 本地完整基线位于 [claude-code](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/sources/claude-code)。
- 已确认这不是单纯 TUI 项目，而是完整产品栈，至少包含以下后端/运行时核心目录：
  - `src/tools/`
  - `src/tasks/`
  - `src/bridge/`
  - `src/remote/`
  - `src/server/`
  - `src/state/`
  - `src/services/`
  - `src/utils/`
  - `src/constants/`
  - `src/types/`
  - `src/entrypoints/`
  - `src/commands/`
  - `src/QueryEngine.ts`
  - `src/Tool.ts`
  - `src/Task.ts`
  - `src/context.ts`
  - `src/tools.ts`
- 这意味着如果先按自定义 `planner/executor/tools/shared` 理想结构重组，会在迁移一开始就偏离原实现。

### 已有研究结论

- [claude-code.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/notes/projects/claude-code.md) 已明确指出 Claude Code 的真正核心是：
  - `Tool.ts` / `tools.ts` 工具系统
  - `Task.ts` / `tasks/` 任务系统
  - `state/AppStateStore.ts` 会话状态
  - `tools/EnterPlanModeTool` / `ExitPlanModeTool` 计划-执行门禁
  - `services/mcp/`、`utils/permissions/`、`services/tools/` 等运行时骨架
- 这与本次“后端先迁”方向一致。

### 外部知识边界

- 仓库中**没有** `deepseek-tui` 本地源码或镜像。
- 当前只能把 `deepseek-tui` 作为 GitHub 外部知识来定义未来替换原则，不能把它作为本轮计划的本地事实来源。

## Proposed Changes

## Step 1: 建立 Claude Code 后端镜像骨架与总映射账本

**目标**

- 在不重构、不重命名、不预先“优化设计”的前提下，把 Claude Code 的后端/运行时主体目录完整映射到 `packages/core/src`。
- 同时建立一份全源码级别的迁移账本，明确每个目录和文件的状态、依赖、专有替换点和执行波次。

**主要文件与目录**

- 创建或扩展：
  - `packages/core/src/entrypoints/`
  - `packages/core/src/tools/`
  - `packages/core/src/tasks/`
  - `packages/core/src/bridge/`
  - `packages/core/src/remote/`
  - `packages/core/src/server/`
  - `packages/core/src/state/`
  - `packages/core/src/services/`
  - `packages/core/src/utils/`
  - `packages/core/src/constants/`
  - `packages/core/src/types/`
  - `packages/core/src/commands/`
  - `packages/core/src/memdir/`
  - `packages/core/src/keybindings/`
  - `packages/core/src/plugins/`
  - `packages/core/src/migrations/`
- 创建文档：
  - `docs/core/source-to-target-map.md`
  - `docs/core/anthropic-replacement-ledger.md`
  - `docs/core/modules/runtime-core.md`
  - `docs/core/modules/tools.md`
  - `docs/core/modules/tasks.md`
  - `docs/core/modules/bridge-remote.md`
  - `docs/core/modules/services-state-utils.md`

**为什么先做这一步**

- 你要求“一次性、完整、全面”地规划全源码迁移，但又限制整体只分 3 步。
- 因此第一步不能直接写业务代码，而必须先把**全量地图**做完整，否则后两步一定会因依赖遗漏而偏移。
- 这一步的产物是后续执行的唯一真相源，不允许执行时再自由发挥。

**这一步覆盖的上游真实基线**

- `src/Tool.ts`
- `src/Task.ts`
- `src/tools.ts`
- `src/context.ts`
- `src/commands.ts`
- `src/QueryEngine.ts`
- `src/entrypoints/*`
- `src/tools/**`
- `src/tasks/**`
- `src/bridge/**`
- `src/remote/**`
- `src/server/**`
- `src/state/**`
- `src/services/**`
- `src/utils/**`
- `src/constants/**`
- `src/types/**`

**执行规则**

- `packages/core/src` 默认按上游目录结构落盘。
- 除非某文件只包含纯共享类型，否则不提前抽到 `packages/shared`。
- 对每个上游目录都标记以下信息：
  - `直接镜像`
  - `镜像但需环境适配`
  - `镜像但需专有服务占位`
  - `第三步才接 TUI`
- 所有 Anthropic 专有点统一登记进 `anthropic-replacement-ledger.md`，字段至少包括：
  - 上游文件
  - 目标文件
  - 专有依赖种类
  - 当前策略：`keep-boundary` / `stub` / `replace-later`
  - 未来替换原则：`deepseek-tui-external-reference`

**完成定义**

- `docs/core/source-to-target-map.md` 覆盖 Claude Code 全源码核心目录，而不是只覆盖 TUI。
- `docs/core/anthropic-replacement-ledger.md` 明确列出所有已识别专有服务边界。
- `packages/core/src` 目录层级与 Claude Code `src/` 建立一一对应框架。

## Step 2: 后端主干像素级迁移并跑通无 TUI 运行时

**目标**

- 把 Claude Code 的后端核心运行时从“目录映射”推进到“可编译、可测试、可无 TUI 运行”。
- 本步只接后端主干，不追求最终 UI，可通过 CLI/测试 harness 驱动核心链路。

**优先迁移顺序**

1. 核心类型与状态
   - `src/types/**`
   - `src/constants/**`
   - `src/state/**`
   - `src/Task.ts`
   - `src/Tool.ts`
   - `src/tools.ts`
2. 工具与权限系统
   - `src/tools/BashTool/**`
   - `src/tools/FileReadTool/**`
   - `src/tools/FileEditTool/**`
   - `src/tools/FileWriteTool/**`
   - `src/tools/GlobTool/**`
   - `src/tools/GrepTool/**`
   - `src/tools/WebFetchTool/**`
   - `src/tools/WebSearchTool/**`
   - `src/tools/AskUserQuestionTool/**`
   - `src/tools/TodoWriteTool/**`
   - `src/tools/EnterPlanModeTool/**`
   - `src/tools/ExitPlanModeTool/**`
   - `src/utils/permissions/**`
3. 任务、调度与执行主循环
   - `src/tasks/**`
   - `src/services/tools/**`
   - `src/utils/task/**`
   - `src/utils/messages/**`
   - `src/utils/systemPrompt.ts`
   - `src/utils/handlePromptSubmit.ts`
   - `src/hooks/useMainLoopModel.ts` 对应的后端依赖部分
4. 桥接、远程与可选服务
   - `src/bridge/**`
   - `src/remote/**`
   - `src/server/**`
   - `src/services/mcp/**`
   - `src/services/lsp/**`
   - `src/services/api/**`
   - `src/services/oauth/**`

**主要目标文件**

- `packages/core/src/Tool.ts`
- `packages/core/src/Task.ts`
- `packages/core/src/tools.ts`
- `packages/core/src/state/AppStateStore.ts`
- `packages/core/src/state/store.ts`
- `packages/core/src/tasks/LocalMainSessionTask.ts`
- `packages/core/src/tasks/LocalShellTask/LocalShellTask.tsx`
- `packages/core/src/tasks/LocalAgentTask/LocalAgentTask.tsx`
- `packages/core/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`
- `packages/core/src/services/tools/toolOrchestration.ts`
- `packages/core/src/services/tools/toolExecution.ts`
- `packages/core/src/services/mcp/MCPConnectionManager.tsx`
- `packages/core/src/utils/settings/**`
- `packages/core/src/utils/permissions/**`
- `packages/core/src/bridge/**`

**`packages/shared` 在这一步的边界**

- 只允许承载真正跨包稳定的协议：
  - `packages/shared/src/contracts/tools.ts`
  - `packages/shared/src/contracts/tasks.ts`
  - `packages/shared/src/contracts/permissions.ts`
  - `packages/shared/src/contracts/messages.ts`
  - `packages/shared/src/contracts/session.ts`
  - `packages/shared/src/contracts/mcp.ts`
  - `packages/shared/src/contracts/bridge.ts`
- 如果某类型只被 `packages/core` 使用，则继续留在 `packages/core/src/types/`，不提前抽象。

**Anthropic 专有依赖处理规则**

- 本步不“提前 DeepSeek 化”。
- 对以下内容优先保留边界和调用链：
  - `services/api/**`
  - `oauth/**`
  - `analytics/**`
  - `claudeAiLimits*`
  - `remote managed settings`
  - 某些 `bridge` / `remote` 会话服务
- 能本地替代的只做最薄占位：
  - transport interface
  - auth provider interface
  - model client interface
  - usage / quota provider interface
- 所有替代决策必须写回 `anthropic-replacement-ledger.md`，未来再参考 GitHub 上的 `deepseek-tui` 外部知识替换，不在本步擅自改主干语义。

**测试与验证要求**

- 先写失败测试，再补最小实现。
- 重点测试文件示例：
  - `packages/core/src/tools/BashTool/__tests__/bashSecurity.test.ts`
  - `packages/core/src/utils/permissions/__tests__/permissions.test.ts`
  - `packages/core/src/state/__tests__/AppStateStore.test.ts`
  - `packages/core/src/tasks/__tests__/LocalMainSessionTask.test.ts`
  - `packages/core/src/services/tools/__tests__/toolOrchestration.test.ts`
- 本步完成时至少能验证：
  - 工具注册与权限判定可运行
  - 任务生命周期可推进
  - 会话状态可持久化/恢复
  - CLI 级无 TUI 主循环可启动

**完成定义**

- `packages/core` 能独立 `typecheck`、`build`、`test`
- 核心工具系统、任务系统、状态系统和权限系统已进入真实代码，不再只是目录壳
- Anthropic 专有边界被清楚隔离，而不是散落在任意调用点

## Step 3: 把已迁移后端重新接入 TUI、命令层与外部替换面

**目标**

- 在第二步的后端主干稳定后，再让 `packages/tui` 回来对接真实 `packages/core`。
- 这一步不是重新设计 TUI，而是把之前试探性 TUI 壳替换成“消费真实后端”的薄界面层。
- 同时为未来使用 `deepseek-tui` 外部知识替换 Anthropic 专有服务留出明确适配面。

**主要文件与目录**

- `packages/tui/src/entrypoints/**`
- `packages/tui/src/main.tsx`
- `packages/tui/src/components/**`
- `packages/tui/src/hooks/**`
- `packages/tui/src/commands/**`
- `packages/tui/src/adapters/**`
- `packages/shared/src/contracts/**`
- `docs/tui/**`
- `docs/core/anthropic-replacement-ledger.md`
- `docs/core/modules/tui-integration.md`

**接入顺序**

1. 用 `packages/core` 替换 TUI 里的 mock runtime
2. 对接真实消息流、工具进度、任务输出和权限审批
3. 恢复上游命令层与状态线
4. 补齐 bridge/remote/session 在 UI 的展示面
5. 明确哪些 Anthropic 专有 UI 依赖未来将通过 DeepSeek 外部参考替换

**这一步不做的事**

- 不在这一步重新规划产品体验
- 不在这一步把后端再拆成新的“理想架构”
- 不在这一步直接引入 `deepseek-tui` 本地源码

**完成定义**

- `packages/tui` 不再依赖 mock runtime
- `packages/core` 与 `packages/tui` 通过共享契约连通
- Claude Code 的主链路在 Vigilon 中形成“后端主干先复刻，TUI 后接回”的完整闭环
- 所有待替换 Anthropic 专有依赖都有明确挂点和外部参考原则

## Assumptions & Decisions

- 决策：整体计划只分 3 步，不再细分为更多总阶段。
- 决策：后端核心语言固定为 `TypeScript`，最大化贴近 Claude Code 原实现。
- 决策：`packages/core/src` 采取镜像式落盘，而不是先按自定义架构重组。
- 决策：本计划优先“结构与实现完整复刻”，不是优先“立即可用替代”。
- 决策：`deepseek-tui` 仅作为 GitHub 外部知识和未来替换原则，不是当前仓库内基线。
- 假设：`docs/superpowers/research/sources/claude-code/src` 是当前唯一可信的本地完整源码基线。
- 假设：当前 `packages/tui` 中的试探性代码允许在后续执行中被降级、重接或重排，但不会主导整体架构。

## Risks & Mitigations

- 风险：全源码范围过大，执行时容易失焦。
  - 缓解：虽然总计划只分 3 步，但第一步必须把全量映射账本做实，后续执行只能按账本推进。
- 风险：过早进行“优化性重构”，导致偏离 Claude Code。
  - 缓解：镜像式落盘优先，只有稳定跨包协议才允许进入 `packages/shared`。
- 风险：Anthropic 专有依赖太多，导致后端迁移卡死。
  - 缓解：先保留等位接口和边界，不急于替换；替换原则统一记账。
- 风险：此前 `packages/tui` 的试探性实现继续牵引方向。
  - 缓解：第三步之前，TUI 仅作为消费层，不再反向定义后端结构。
- 风险：`deepseek-tui` 未本地化，替换依据不足。
  - 缓解：本计划不把它当执行前置，只作为后续外部参考。

## Verification Steps

### Step 1 验证

- 核对 `docs/core/source-to-target-map.md` 是否覆盖上游核心目录。
- 核对 `docs/core/anthropic-replacement-ledger.md` 是否列出专有依赖种类与替换策略。
- 核对 `packages/core/src` 是否已建立镜像目录骨架，而不是空泛的自定义层名。

### Step 2 验证

- 运行 `packages/core` 的 `typecheck`
- 运行 `packages/core` 的 `build`
- 运行 `packages/core` 的核心测试集
- 验证至少一条无 TUI 的 CLI/主循环链路可启动
- 验证工具注册、权限决策、任务生命周期和状态恢复四类核心能力

### Step 3 验证

- 启动 `packages/tui` 并确认其消费的是 `packages/core` 真实运行时而非 mock
- 验证消息、工具进度、任务输出、审批状态可从后端流到 TUI
- 核对 `docs/core/anthropic-replacement-ledger.md` 与实际代码替换挂点是否一致

## Out Of Scope

- 一开始就把 Claude Code 重组为我们理想中的全新架构
- 在总计划阶段直接决定所有 Anthropic 专有服务的最终 DeepSeek 替换实现
- 把 `deepseek-tui` 当作当前仓库的本地源码依赖
- 在后端主干稳定之前继续扩展 Web 前端或额外产品层设计
