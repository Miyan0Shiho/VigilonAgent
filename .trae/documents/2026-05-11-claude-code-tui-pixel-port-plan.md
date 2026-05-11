# Claude Code TUI 像素级复刻首阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` 或按任务顺序内联执行。所有步骤使用检查清单推进，并在每个阶段完成后进行一次可运行性验证。

**Goal:** 在 `packages/tui` 中建立一个与 `docs/superpowers/research/sources/claude-code/src` 的 TUI 相关目录尽量一一对应的可运行复刻骨架，同时同步沉淀模块级文档与后端依赖账本，作为后续逐文件抄写 Claude Code 实现的工作台。

**Architecture:** 保持“源码镜像区”与“自研实现区”分离：`docs/superpowers/research/sources/claude-code` 继续作为只读研究镜像，`packages/tui` 作为真正的实现落点。迁移时优先保留 Claude Code 的目录边界、入口结构与 TUI 运行路径，对暂未纳入的一切后端能力统一抽象为接口、适配器或 mock 占位，保证前端 TUI 可以先独立编译与逐步接线。

**Tech Stack:** TypeScript、React、Ink 风格 TUI 组件边界、Node CLI 入口、Monorepo 目录约束、模块级 Markdown 文档。

---

## Summary

- 本计划只覆盖第一个可执行子项目：`Claude Code TUI 复刻优先`。
- 本阶段目标不是完成整个 Vigilon Agent，也不是纳入真实后端执行链路。
- 本阶段强调三个产物同时成立：
  1. `packages/tui` 下的 Claude Code TUI 一比一映射式目录骨架；
  2. 逐批迁移时同步产出的模块文档；
  3. 一份明确的“后端依赖接口账本”，为后续纳入 planner/executor/tool runtime 做准备。
- 默认不修改 `docs/superpowers/research/sources/claude-code`，该目录始终作为上游研究基准。

## Current State Analysis

### 仓库现状

- 根目录当前仅有 [README.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/README.md) 与 `docs/`，尚未存在 `packages/`、`package.json`、`Cargo.toml` 或任何可运行产品代码。
- [2026-05-11-initial-setup-design.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/specs/2026-05-11-initial-setup-design.md) 已定义目标式 Monorepo 结构：`packages/core`、`packages/web`、`packages/shared`，但未给终端 UI 预留实际包。
- [GIT_RULES.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/specs/GIT_RULES.md) 要求原子提交、分阶段 `[WIP]` checkpoint、非 WIP 提交带 `Agent-Task` 与 `Agent-Decision` trailers。

### 上游源码基线

- Claude Code 还原源码位于 [claude-code](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/sources/claude-code)。
- 第一阶段直接相关的源目录已存在：
  - `src/entrypoints/`
  - `src/components/`
  - `src/hooks/`
  - `src/ink/`
  - `src/commands/`
  - `src/context/`
  - `src/constants/`
  - `src/main.tsx`
  - `src/Tool.ts`
  - `src/Task.ts`
  - `src/commands.ts`
  - `src/context.ts`
- 研究文档已对 TUI、权限、生态、执行反馈做过索引，尤其是 [claude-code.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/notes/projects/claude-code.md) 与 [ux.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/topics/ux.md)。

### 已锁定的产品决策

- 首个子项目：`TUI 复刻优先`
- 迁移策略：`一比一映射`
- 文档粒度：`按模块文档`
- 目标目录：`packages/tui`

## Proposed Changes

### 1. 建立 Monorepo 最小骨架

**新增目录**

- `packages/tui/`
- `packages/shared/`
- `packages/core/`
- `docs/tui/`

**新增文件**

- `package.json`
- `pnpm-workspace.yaml` 或等价 workspace 配置文件
- `tsconfig.base.json`
- `packages/tui/package.json`
- `packages/tui/tsconfig.json`
- `packages/tui/src/`
- `packages/shared/package.json`
- `packages/shared/tsconfig.json`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

**原因**

- 当前仓库没有任何可运行工程；若不先建立最小 workspace，后续“逐文件抄写”只能停留在文档和散落源码层面，无法获得编译反馈。
- 虽然本阶段以后端讨论为主，但 `packages/shared` 与 `packages/core` 必须作为命名与接口承载位存在，否则 `packages/tui` 无法稳定声明依赖边界。

**实现方式**

- 根 workspace 仅做最小配置，不一次性引入与后续阶段无关的工程复杂度。
- `packages/tui` 作为第一阶段唯一要求可编译/可启动的包。
- `packages/shared` 只承载最少量跨包类型与接口定义。
- `packages/core` 只创建目录、包元信息与接口占位，不实现真实执行内核。

### 2. 在 `packages/tui` 中建立与 Claude Code 对齐的目录映射

**新增目录**

- `packages/tui/src/entrypoints/`
- `packages/tui/src/components/`
- `packages/tui/src/hooks/`
- `packages/tui/src/ink/`
- `packages/tui/src/commands/`
- `packages/tui/src/context/`
- `packages/tui/src/constants/`
- `packages/tui/src/adapters/`
- `packages/tui/src/contracts/`

**对齐基线**

- 对齐来源：`docs/superpowers/research/sources/claude-code/src`
- 一比一迁移优先级：
  1. `entrypoints/cli.tsx`、`main.tsx`
  2. `components/App.tsx`、`Messages.tsx`、`Message.tsx`、`TextInput.tsx`、`StatusLine.tsx`
  3. `ink/` 基础渲染层
  4. `hooks/` 中直接服务 TUI 主循环与输入的 Hook
  5. `commands/` 中 `/help`、`/clear`、`/theme`、`/cost` 这类更偏前端可见的命令入口

**原因**

- 用户要求“逐文件逐代码像素级抄 Claude Code”，因此文件边界的稳定性比“先抽象出更优设计”更重要。
- 但上游 TUI 对后端耦合很深，不能盲目照搬所有引用；需要在不破坏目录对照关系的前提下引入本地适配层。

**实现方式**

- 保留尽可能接近上游的目录与文件名。
- 对所有直接依赖后端会话、工具运行、权限系统、远程会话、API 服务的引用，不直接篡改调用点语义，而是通过 `src/adapters/` 与 `src/contracts/` 建立“本地替身接口”。
- 当某个上游文件依赖链过深、不适合第一阶段直接迁移时，允许：
  - 在原目标路径放置薄包装文件；
  - 把不可用能力重定向到 `contracts` 中声明的接口；
  - 在模块文档中记录“未纳入原因、缺失依赖、后续接入点”。

### 3. 明确 TUI 与后端的接口账本

**新增文件**

- `packages/shared/src/contracts/session.ts`
- `packages/shared/src/contracts/messages.ts`
- `packages/shared/src/contracts/tools.ts`
- `packages/shared/src/contracts/permissions.ts`
- `packages/shared/src/contracts/tasks.ts`
- `docs/tui/backend-interface-ledger.md`

**原因**

- 用户明确提出“前端先复用 Claude Code 的 TUI，后端先纳入讨论”。
- 如果没有接口账本，TUI 复刻过程会把缺失能力散落成大量临时 mock，后续无法系统性接后端。

**实现方式**

- 以 `packages/tui` 中真实遇到的依赖缺口为驱动，不预先设计完整后端。
- 每增加一个 TUI 模块，就把它依赖的后端能力登记到 `backend-interface-ledger.md`，字段至少包含：
  - 上游文件路径
  - Vigilon 目标文件路径
  - 所需能力名称
  - 输入/输出结构
  - 当前状态：`stub` / `mock` / `adapter-ready` / `connected`
  - 后续接入建议归属：`packages/core` 或 `packages/shared`

### 4. 建立模块级迁移文档机制

**新增文档目录**

- `docs/tui/modules/entrypoints.md`
- `docs/tui/modules/components.md`
- `docs/tui/modules/hooks.md`
- `docs/tui/modules/ink.md`
- `docs/tui/modules/commands.md`

**原因**

- 用户要求“在这个过程中写一些文档到 docs 文件夹中”，并强调这是理解 Claude Code 实现的过程。
- 模块级文档是学习效率与执行成本的平衡点；按文件写会过重，只写总览又不足以支撑后续逐步接线。

**实现方式**

- 每份模块文档至少包含：
  - 模块目的
  - 上游目录映射
  - 当前已迁移文件清单
  - 关键依赖关系
  - 与后端耦合点
  - 本阶段保留/裁剪说明
  - 下一批推荐迁移文件

### 5. 为“逐文件抄写”建立执行顺序与完成定义

**阶段顺序**

1. `workspace + packages/tui` 骨架可编译
2. CLI 入口与 `main.tsx` 跑通，哪怕先接 mock store
3. `components` 基础渲染链路可显示消息列表、输入框、状态栏
4. `ink` 渲染基础层迁入并替换临时实现
5. `hooks` 与 `commands` 补齐最小交互闭环
6. 第一轮 TUI 模块文档与接口账本补全

**完成定义**

- 存在一个可启动的 `packages/tui` 命令入口。
- TUI 至少可展示：
  - 顶层 App 壳
  - 消息区域
  - 文本输入
  - 状态行
- 至少存在一条 mock 会话数据流，可驱动界面渲染。
- 至少完成一批关键文件的“源文件 -> 目标文件”映射清单。
- `docs/tui/` 下已存在模块文档与接口账本，且与代码状态一致。

## File-Level Execution Plan

### Task 1: 初始化工作区与包边界

**创建/修改**

- `package.json`
- `pnpm-workspace.yaml` 或等价 workspace 清单
- `tsconfig.base.json`
- `packages/tui/package.json`
- `packages/tui/tsconfig.json`
- `packages/core/package.json`
- `packages/shared/package.json`

**目标**

- 仓库具备最小 Monorepo 可执行结构。
- 不引入与首阶段无关的新依赖；若必须新增依赖，执行时需单独审批。

### Task 2: 建立 TUI 映射索引

**创建**

- `docs/tui/source-to-target-map.md`

**目标**

- 记录上游 TUI 相关文件与目标路径的一一映射关系。
- 将文件分为四类：
  - `直接迁移`
  - `迁移但需适配`
  - `暂缓`
  - `不纳入首阶段`

### Task 3: 搭起 `entrypoints` 与 `main.tsx`

**来源基线**

- `docs/superpowers/research/sources/claude-code/src/entrypoints/cli.tsx`
- `docs/superpowers/research/sources/claude-code/src/main.tsx`

**创建/修改**

- `packages/tui/src/entrypoints/cli.tsx`
- `packages/tui/src/main.tsx`
- `packages/tui/src/contracts/app-runtime.ts`
- `packages/tui/src/adapters/runtimeAdapter.ts`

**目标**

- 保留上游入口组织方式。
- 将缺失的运行时能力统一落到 adapter/contracts，而不是散落在组件内部临时 mock。

### Task 4: 迁入最小可见 UI 组件链

**来源基线**

- `components/App.tsx`
- `components/Messages.tsx`
- `components/Message.tsx`
- `components/TextInput.tsx`
- `components/StatusLine.tsx`

**创建/修改**

- `packages/tui/src/components/App.tsx`
- `packages/tui/src/components/Messages.tsx`
- `packages/tui/src/components/Message.tsx`
- `packages/tui/src/components/TextInput.tsx`
- `packages/tui/src/components/StatusLine.tsx`
- `packages/shared/src/contracts/messages.ts`

**目标**

- 跑通“消息显示 + 输入 + 状态线”的最小 TUI 闭环。
- 组件中不得直接硬编码后端细节；统一走 shared/contracts。

### Task 5: 迁入 `ink` 基础能力

**来源基线**

- `ink/components/*`
- `ink/*.ts(x)`

**创建/修改**

- `packages/tui/src/ink/**`
- `docs/tui/modules/ink.md`

**目标**

- 尽量复用 Claude Code 的 Ink 分层，而不是直接用极简临时代码替代。
- 对无法立即接入的输入/焦点/事件系统，在文档中写清楚缺失能力与后续接入方式。

### Task 6: 迁入首批 Hook 与命令

**优先来源**

- `hooks/useInputBuffer.ts`
- `hooks/useTerminalSize.ts`
- `hooks/useTextInput.ts`
- `commands/help/*`
- `commands/clear/*`
- `commands/theme/*`

**创建/修改**

- `packages/tui/src/hooks/**`
- `packages/tui/src/commands/**`
- `docs/tui/modules/hooks.md`
- `docs/tui/modules/commands.md`

**目标**

- 首阶段先迁可独立工作的前端能力，避免过早碰深度耦合的任务执行、远程会话、MCP 管理等链路。

### Task 7: 建立后端接口账本与模块文档闭环

**创建/修改**

- `docs/tui/backend-interface-ledger.md`
- `docs/tui/modules/entrypoints.md`
- `docs/tui/modules/components.md`
- `docs/tui/modules/hooks.md`
- `docs/tui/modules/commands.md`

**目标**

- 保证每次代码迁移都有文档沉淀。
- 为第二阶段“纳入后端讨论”提供明确待办，而不是靠记忆。

## Assumptions & Decisions

- 假设 `docs/superpowers/research/sources/claude-code` 是当前唯一可信的 Claude Code 本地源码基线。
- 假设第一阶段允许使用 stub/mock 维持 TUI 可编译与可渲染，但不允许因此破坏未来与 `packages/core` 的接入边界。
- 假设 `packages/tui` 是长期保留包，而非临时目录。
- 决策上优先“文件边界对齐”而不是“立即做更优重构”。
- 决策上优先“模块文档”而不是“逐文件文档”。
- 决策上把后端能力抽象为接口账本，而不是在本阶段实现真实 planner/executor。

## Risks & Mitigations

- 风险：上游 TUI 对后端耦合过深，导致直接迁移文件无法独立编译。
  - 缓解：统一通过 `adapters/` 与 `contracts/` 吸收耦合，不在组件内部硬断引用。
- 风险：一比一映射导致早期目录很多、可运行成果较慢。
  - 缓解：优先迁入口、最小组件链、基础 hooks 与 ink，而不是一次性展开全部文件。
- 风险：文档与代码逐步偏离。
  - 缓解：将“更新模块文档与接口账本”设为每一批迁移的完成条件。
- 风险：过早新增大量依赖。
  - 缓解：优先使用 TypeScript/Node 原生能力；若确需新增包，执行时单独审批。

## Verification Steps

### 结构验证

- 确认根目录存在 `packages/tui`、`packages/core`、`packages/shared` 与 `docs/tui`。
- 确认 `packages/tui/src` 内部目录能与 Claude Code TUI 关键目录形成清晰映射。
- 确认 `docs/tui/source-to-target-map.md` 与实际创建文件一致。

### 编译验证

- 安装依赖后，运行 workspace 级 TypeScript 检查。
- 单独运行 `packages/tui` 的 build/typecheck 命令。
- 确认缺失后端能力全部通过接口层暴露，不出现大量 `any` 或无归属的临时 mock。

### 运行验证

- 启动 `packages/tui` CLI 入口。
- 验证最小 TUI 壳能渲染 App、消息区、输入框与状态线。
- 验证至少一个 `/help` 或等价最小命令能在界面中触发可见反馈。

### 文档验证

- 核对 `docs/tui/modules/*.md` 是否覆盖已迁移模块。
- 核对 `docs/tui/backend-interface-ledger.md` 中的接口项是否对应真实代码引用。
- 核对 `docs/tui/source-to-target-map.md` 中每个状态分类是否有明确依据。

## Out Of Scope

- 真实 DeepSeek V4 / Claude API 接入。
- Planner / Executor / Tool Runtime 的完整实现。
- Web 前端、Gateway、Remote Session、MCP 完整能力接入。
- 对 Claude Code 全仓源码的一次性全量迁移。
- 第二阶段以后的产品设计优化与体验重塑。
