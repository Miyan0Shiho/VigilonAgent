# Claude Code 全源码后端优先像素级迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` 或按任务顺序内联执行。执行时必须严格遵守“后端优先、镜像式落盘、最小额外设计、Anthropic 专有依赖只做等位替换挂点”的约束。

**Goal:** 在当前 Monorepo 中以 `packages/core/src` 为主战场，对 `docs/superpowers/research/sources/claude-code/src` 做一次覆盖完整产品栈的后端优先像素级迁移总规划，先完整迁入运行时、工具、任务、桥接、远程、服务与安全体系，再把 TUI 作为最后一波接回。

**Architecture:** 采用“全源码总图 + 分波次执行”的迁移方式，但不采用“先重构再迁移”的做法。`packages/core/src` 尽量一比一镜像 Claude Code 的 `src/` 目录边界与文件命名，`packages/shared` 只在确有跨包复用需求时承载公共协议，`packages/tui` 只在后端主干稳定后回接；Anthropic 专有能力不提前重写成自定义架构，而是在镜像文件中保留最小等位替换点，并记录到替换账本。

**Tech Stack:** TypeScript、Node.js、Monorepo、Vitest、Claude Code 上游 TypeScript 源码镜像、模块级迁移文档、替换账本与等价性验证。

---

## Summary

- 本计划不是单一“先做一个包”的小计划，而是一份覆盖 Claude Code 完整产品栈的总迁移计划。
- 执行顺序采用分波次，是为了防止实现偏移，不是为了缩小范围；总范围仍然覆盖上游完整 `src/`。
- 迁移原则已经锁定：
  - 后端优先
  - `packages/core/src` 镜像式落盘
  - 核心后端继续使用 TypeScript
  - 尽量完全按照 Claude Code 实现去走
  - Anthropic 专有服务先像素级复刻调用边界，再为 DeepSeek 替换预留挂点
  - `deepseek-tui` 只作为后续替换原则，不作为当前本地前置源码基线
- 当前仓库里已经存在一批 `packages/tui` 试探性代码；本计划要求它从“架构驱动源”降级为“暂存试验物”，后续不得反向定义 `packages/core` 的结构。

## Current State Analysis

### 当前仓库状态

- 根目录已存在 workspace 骨架：
  - `package.json`
  - `pnpm-workspace.yaml`
  - `tsconfig.base.json`
  - `packages/core/`
  - `packages/shared/`
  - `packages/tui/`
- 现有 `packages/core/src` 只有最小占位 `index.ts`，还没有任何 Claude Code 后端镜像结构。
- 现有 `packages/shared/src/contracts` 只覆盖了一小批 TUI 探索期协议，不足以承载 Claude Code 完整运行时。
- 现有 `packages/tui/src` 只包含 `App.tsx`、`main.tsx`、若干基础 hooks/commands 与 mock runtime，属于 TUI 优先方案留下的探索性资产。
- 现有计划文件 [2026-05-11-claude-code-tui-pixel-port-plan.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/.trae/documents/2026-05-11-claude-code-tui-pixel-port-plan.md) 明确把“完整后端迁移”列为当时的 out-of-scope，这与本次方向已经冲突。

### 上游 Claude Code 源码基线

- 上游完整源码镜像位于 [claude-code](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/sources/claude-code/src)。
- 当前已确认的重要后端/运行时目录包括：
  - `src/tools/`
  - `src/tasks/`
  - `src/services/`
  - `src/utils/`
  - `src/state/`
  - `src/bridge/`
  - `src/remote/`
  - `src/server/`
  - `src/entrypoints/`
  - `src/cli/`
  - `src/constants/`
  - `src/types/`
  - `src/bootstrap/`
  - `src/memdir/`
  - `src/migrations/`
  - `src/keybindings/`
  - `src/plugins/`
- 当前已确认的重要根级运行时文件包括：
  - `src/setup.ts`
  - `src/Tool.ts`
  - `src/Task.ts`
  - `src/tools.ts`
  - `src/commands.ts`
  - `src/context.ts`
  - `src/history.ts`
  - `src/QueryEngine.ts`
  - `src/cost-tracker.ts`
  - `src/costHook.ts`
  - `src/projectOnboardingState.ts`
  - `src/replLauncher.tsx`

### 依赖和研究资料现状

- 当前仓库有 Claude Code 研究索引 [claude-code.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/notes/projects/claude-code.md)，已明确指向：
  - `Tool.ts` / `tools.ts` 工具系统
  - `Task.ts` / `tasks/` 任务系统
  - `state/AppStateStore.ts` 会话状态
  - `services/mcp/` 扩展系统
  - `utils/permissions/` 安全与审批
  - `setup.ts` / `cli/update.ts` / `services/api/*` 等发布与服务侧关键点
- 当前仓库没有本地 `deepseek-tui` 源码镜像或研究资料，因此任何 DeepSeek 替换都必须被视为后续替换原则，而不是可立即对照的本地真相源。

## Proposed Changes

### 1. 把总迁移目标从 “TUI 优先” 切换为 “Core 镜像优先”

**涉及文件**

- 修改：`README.md`
- 修改：`package.json`
- 修改：`packages/core/package.json`
- 修改：`packages/shared/package.json`
- 修改：`packages/tui/package.json`
- 新增：`docs/core/README.md`
- 新增：`docs/core/source-to-target-master-map.md`
- 新增：`docs/core/proprietary-replacement-ledger.md`
- 新增：`docs/core/waves.md`

**What**

- 明确仓库当前主目标从 “先建立可运行 TUI” 切换到 “先建立完整后端镜像与运行时骨架”。
- 给 `docs/core/` 建立总迁移控制面，避免迁移路径继续被散落在 `docs/tui/` 与旧计划里。

**Why**

- 用户明确指出过去多轮计划导致实现偏移，希望避免“为了可运行而过早自行设计”。
- Claude Code 的 TUI 深度依赖后端主循环、工具事件、权限、任务与 bridge，如果后端不先完整落盘，TUI 只能不断靠 mock 扭曲接口。

**How**

- `README.md` 把主叙事改为 “Claude Code 全源码镜像迁移，后端先行”。
- `docs/core/source-to-target-master-map.md` 维护“上游 `src/**` -> 本仓 `packages/core/src/**` / `packages/tui/src/**` / `packages/shared/src/**`”的全量映射。
- `docs/core/proprietary-replacement-ledger.md` 单独记录 Anthropic 专有能力的替换挂点，不允许散落在各模块文档中。

### 2. 在 `packages/core/src` 下建立与 Claude Code `src/` 对齐的镜像目录

**涉及目录**

- 新增：`packages/core/src/bootstrap/`
- 新增：`packages/core/src/bridge/`
- 新增：`packages/core/src/cli/`
- 新增：`packages/core/src/commands/`
- 新增：`packages/core/src/constants/`
- 新增：`packages/core/src/context/`
- 新增：`packages/core/src/entrypoints/`
- 新增：`packages/core/src/hooks/`
- 新增：`packages/core/src/keybindings/`
- 新增：`packages/core/src/memdir/`
- 新增：`packages/core/src/migrations/`
- 新增：`packages/core/src/plugins/`
- 新增：`packages/core/src/remote/`
- 新增：`packages/core/src/server/`
- 新增：`packages/core/src/services/`
- 新增：`packages/core/src/state/`
- 新增：`packages/core/src/tasks/`
- 新增：`packages/core/src/tools/`
- 新增：`packages/core/src/types/`
- 新增：`packages/core/src/utils/`

**涉及根级文件**

- 新增：`packages/core/src/setup.ts`
- 新增：`packages/core/src/Tool.ts`
- 新增：`packages/core/src/Task.ts`
- 新增：`packages/core/src/tools.ts`
- 新增：`packages/core/src/commands.ts`
- 新增：`packages/core/src/context.ts`
- 新增：`packages/core/src/history.ts`
- 新增：`packages/core/src/QueryEngine.ts`
- 新增：`packages/core/src/cost-tracker.ts`
- 新增：`packages/core/src/costHook.ts`
- 新增：`packages/core/src/projectOnboardingState.ts`
- 新增：`packages/core/src/replLauncher.tsx`

**What**

- 在 `packages/core/src` 中建立与上游几乎一一对应的目录与根文件布局。

**Why**

- 如果一开始就重组为我们理想中的 `planner/executor/tools/shared`，迁移过程会不可避免地产生“以己度人”的设计偏移。
- 镜像式落盘最能确保后续逐文件对照、diff 审核与行为等价检查。

**How**

- 先落目录与映射，不急于立即重构跨目录依赖。
- 默认目标路径规则：
  - Claude Code 后端/运行时文件：`docs/.../src/<path>` -> `packages/core/src/<path>`
  - 仅在确实跨包复用时，才把类型/协议提炼到 `packages/shared/src/`
  - TUI/Ink/UI 相关文件仍保留到最后一波迁移到 `packages/tui/src/`

### 3. 用“全量主映射 + 模块文档 + 替换账本”三层文档防止方向漂移

**涉及文件**

- 新增：`docs/core/source-to-target-master-map.md`
- 新增：`docs/core/proprietary-replacement-ledger.md`
- 新增：`docs/core/modules/runtime-kernel.md`
- 新增：`docs/core/modules/tools.md`
- 新增：`docs/core/modules/tasks.md`
- 新增：`docs/core/modules/bridge-remote.md`
- 新增：`docs/core/modules/services.md`
- 新增：`docs/core/modules/security-permissions.md`
- 新增：`docs/core/modules/state-context.md`
- 新增：`docs/core/modules/cli-entrypoints.md`
- 新增：`docs/core/modules/tui-reintegration.md`

**What**

- 建立一套完整文档控制面，专门用于约束“全源码一次性迁移”的执行秩序。

**Why**

- 这次不是缺“设计创意”，而是缺对具体实现的连续理解和不偏航的执行节奏。
- 没有主映射和替换账本时，执行者容易在局部为了可运行引入额外抽象。

**How**

- `source-to-target-master-map.md` 按上游目录树维护状态列：`未开始 / 已镜像 / 已连通 / 已替换专有依赖 / 已验收`
- `proprietary-replacement-ledger.md` 至少记录：
  - 上游文件
  - 当前目标文件
  - 专有依赖名称
  - 当前处理方式：`原样保留` / `stub` / `等位接口` / `DeepSeek 替换挂点`
  - 后续替换建议
- 每个模块文档都必须包含：
  - 上游目录边界
  - 依赖方向
  - 当前迁移波次
  - 不能擅自重构的点
  - Anthropic 专有点

### 4. 把后端迁移拆成有依赖顺序的执行波次，而不是子项目割裂

**波次总览**

1. 波次 A：工作区与镜像边界建立
2. 波次 B：基础类型、常量、状态、上下文与运行时根文件
3. 波次 C：工具系统、权限与本地执行安全边界
4. 波次 D：任务系统、工具编排、消息映射与主循环核心
5. 波次 E：Bridge / Remote / Server / CLI / EntryPoints
6. 波次 F：Services / API / OAuth / MCP / Plugins / Team Memory / Analytics
7. 波次 G：Commands / Hooks / Keybindings / 辅助运行时收口
8. 波次 H：TUI / Ink / Components / Main Loop UI 回接
9. 波次 I：Anthropic 专有点替换挂接与 DeepSeek 替换账本梳理
10. 波次 J：全仓等价性验收与历史整理

**Why**

- 这是一次完整迁移，但必须尊重源码依赖顺序。
- 如果先迁 TUI，就会继续靠 mock 定义真实后端；如果先迁服务 API，就会在基础状态机与工具框架不稳时过早改造专有依赖。

### 5. 对 Anthropic 专有实现采用“镜像文件先落位，替换点后登记”的保守策略

**重点目录**

- `packages/core/src/services/api/`
- `packages/core/src/services/oauth/`
- `packages/core/src/services/analytics/`
- `packages/core/src/bridge/`
- `packages/core/src/remote/`
- `packages/core/src/utils/auth*.ts`
- `packages/core/src/utils/user*.ts`
- `packages/core/src/services/mcp/claudeai.ts`

**What**

- 先尽量镜像原始文件结构、函数名、输入输出与调用顺序。
- 只有遇到明确的 Anthropic 专有网络、登录、鉴权、统计、发布链路时，才额外标记替换点。

**Why**

- 用户要求“先做像素级复刻”，而不是先做 DeepSeek 版本的架构重写。
- 过早把专有模块改造成我们自己的 provider 层，会让后续无法判断偏差到底来自上游逻辑还是我们的新设计。

**How**

- 第一轮迁移中，允许使用：
  - `stub`：仅保证类型与调用链存在
  - `noop`：仅在不影响主链路结构时使用
  - `env-gated fallback`：用环境变量切换真实逻辑或替换逻辑
- 不允许在未登记到账本的前提下，直接把上游 Anthropic 服务改造成全新抽象层。

### 6. 把现有 `packages/tui` 降级为后续回接对象，而不是当前架构输入

**涉及文件**

- 修改：`packages/tui/package.json`
- 修改：`packages/tui/src/**`
- 修改：`docs/tui/**`
- 新增：`docs/core/modules/tui-reintegration.md`

**What**

- 当前已存在的 `packages/tui` 起步代码不删除，但在迁移顺序上退到波次 H。

**Why**

- 这些文件目前以 mock runtime 和前端最小闭环为主，不能作为 `packages/core` 的真实接口依据。
- 如果继续沿着这些 mock 扩展，会再次形成“前端先定义后端”的偏移。

**How**

- 波次 H 之前，`packages/tui` 只允许做兼容性修正，不允许扩展为正式架构。
- 真正的接口源头必须来自 `packages/core/src` 镜像后的运行时与状态系统。

## File-Level Execution Plan

### Task 1: 建立全仓迁移控制面并冻结旧方向

**Files**

- Modify: `README.md`
- Create: `docs/core/README.md`
- Create: `docs/core/source-to-target-master-map.md`
- Create: `docs/core/proprietary-replacement-ledger.md`
- Create: `docs/core/waves.md`

- [ ] 记录当前仓库已有 `packages/tui` 仅为探索性资产，不再作为架构起点。
- [ ] 在 `docs/core/source-to-target-master-map.md` 中按上游 `src/` 真实目录树初始化全量映射骨架。
- [ ] 在 `docs/core/waves.md` 中固定波次 A-J 与依赖顺序，禁止执行期临时改序。
- [ ] 明确 `deepseek-tui` 只作为替换原则，不作为本地前置依赖。

### Task 2: 在 `packages/core/src` 下建立镜像目录与根级骨架

**Files**

- Modify: `packages/core/package.json`
- Modify: `packages/core/tsconfig.json`
- Create: `packages/core/src/setup.ts`
- Create: `packages/core/src/Tool.ts`
- Create: `packages/core/src/Task.ts`
- Create: `packages/core/src/tools.ts`
- Create: `packages/core/src/commands.ts`
- Create: `packages/core/src/context.ts`
- Create: `packages/core/src/history.ts`
- Create: `packages/core/src/QueryEngine.ts`
- Create: `packages/core/src/cost-tracker.ts`
- Create: `packages/core/src/costHook.ts`
- Create: `packages/core/src/projectOnboardingState.ts`
- Create: `packages/core/src/replLauncher.tsx`
- Create: `packages/core/src/{bootstrap,bridge,cli,commands,constants,context,entrypoints,hooks,keybindings,memdir,migrations,plugins,remote,server,services,state,tasks,tools,types,utils}/`

- [ ] 先建立目录和空文件边界，保证目标路径与上游路径一一对照。
- [ ] 调整 `packages/core` 编译配置，让后续能单独 typecheck/build。
- [ ] 在映射文档中把所有根级运行时文件标记为波次 B-C 的必经项。

### Task 3: 迁移基础类型、常量、bootstrap、state 与最小上下文

**Files**

- Create: `packages/core/src/types/**`
- Create: `packages/core/src/constants/**`
- Create: `packages/core/src/bootstrap/state.ts`
- Create: `packages/core/src/state/AppState.tsx`
- Create: `packages/core/src/state/AppStateStore.ts`
- Create: `packages/core/src/state/onChangeAppState.ts`
- Create: `packages/core/src/state/selectors.ts`
- Create: `packages/core/src/state/store.ts`
- Create: `packages/core/src/state/teammateViewHelpers.ts`
- Create: `packages/core/src/context/**`
- Create: `packages/shared/src/**`（仅当出现跨包复用的稳定协议）
- Create: `docs/core/modules/state-context.md`

- [ ] 优先迁移不会强依赖 UI 的基础类型、常量和状态模型。
- [ ] 保留与上游一致的命名、导出和目录粒度。
- [ ] 只在出现真实跨包需求时才把协议抽到 `packages/shared`，禁止预先抽象。
- [ ] 为状态与上下文模块写清楚依赖方向和后续被 TUI 消费的接口面。

### Task 4: 迁移工具系统、权限模型与本地执行安全边界

**Files**

- Create: `packages/core/src/tools/AgentTool/**`
- Create: `packages/core/src/tools/AskUserQuestionTool/**`
- Create: `packages/core/src/tools/BashTool/**`
- Create: `packages/core/src/tools/FileReadTool/**`
- Create: `packages/core/src/tools/FileEditTool/**`
- Create: `packages/core/src/tools/FileWriteTool/**`
- Create: `packages/core/src/tools/GlobTool/**`
- Create: `packages/core/src/tools/GrepTool/**`
- Create: `packages/core/src/tools/LSPTool/**`
- Create: `packages/core/src/tools/MCPTool/**`
- Create: `packages/core/src/tools/SkillTool/**`
- Create: `packages/core/src/tools/TodoWriteTool/**`
- Create: `packages/core/src/tools/WebFetchTool/**`
- Create: `packages/core/src/tools/WebSearchTool/**`
- Create: `packages/core/src/utils/permissions/**`
- Create: `packages/core/src/utils/shell/**`
- Create: `docs/core/modules/tools.md`
- Create: `docs/core/modules/security-permissions.md`

- [ ] 以 `Tool.ts` + `tools.ts` 为中心迁移工具注册、工具上下文与权限决策链。
- [ ] 优先迁高风险工具：Bash、FileEdit、FileRead、MCP、Agent、Skill。
- [ ] 权限、只读校验、路径校验、安全语义必须跟着工具一起迁，不允许“先跑起来再补安全”。
- [ ] 在模块文档中标记哪些工具完全可以原样镜像，哪些工具有 Anthropic 或平台专有依赖。

### Task 5: 迁移任务系统、编排层与主循环后端核心

**Files**

- Create: `packages/core/src/tasks/**`
- Create: `packages/core/src/services/tools/**`
- Create: `packages/core/src/utils/task/**`
- Create: `packages/core/src/utils/messages/**`
- Create: `packages/core/src/utils/plans.ts`（如上游存在）
- Create: `packages/core/src/utils/toolResultStorage.ts`
- Create: `packages/core/src/utils/fileStateCache.ts`
- Create: `packages/core/src/utils/fileHistory.ts`
- Create: `packages/core/src/utils/conversationRecovery.ts`
- Create: `docs/core/modules/runtime-kernel.md`
- Create: `docs/core/modules/tasks.md`

- [ ] 以 `Task.ts`、`tasks/`、`services/tools/`、`utils/task/` 为中心建立任务状态机与工具执行编排。
- [ ] 把 transcript、tool result、file state、conversation recovery 这类“具体实现细节”前置迁入，避免后续 TUI 再反向定义它们。
- [ ] 将 plan mode、任务输出、后台会话这些后端职责从一开始就视为核心，不视为后续增强项。

### Task 6: 迁移 Bridge / Remote / Server / CLI / EntryPoints

**Files**

- Create: `packages/core/src/bridge/**`
- Create: `packages/core/src/remote/**`
- Create: `packages/core/src/server/**`
- Create: `packages/core/src/cli/**`
- Create: `packages/core/src/entrypoints/**`
- Create: `docs/core/modules/bridge-remote.md`
- Create: `docs/core/modules/cli-entrypoints.md`

- [ ] 按上游目录完整迁入 `bridge`、`remote`、`server`、`cli`、`entrypoints`。
- [ ] 保留 `cli.tsx`、`init.ts`、`mcp.ts`、structured/remote IO 等入口层级，不提前合并。
- [ ] 把 JWT、session、trustedDevice、remote trigger 等专有依赖逐项登记到账本，而不是先删逻辑。

### Task 7: 迁移 Services / MCP / API / OAuth / Plugins / Memory / Analytics

**Files**

- Create: `packages/core/src/services/api/**`
- Create: `packages/core/src/services/mcp/**`
- Create: `packages/core/src/services/oauth/**`
- Create: `packages/core/src/services/analytics/**`
- Create: `packages/core/src/services/plugins/**`
- Create: `packages/core/src/services/teamMemorySync/**`
- Create: `packages/core/src/services/remoteManagedSettings/**`
- Create: `packages/core/src/services/settingsSync/**`
- Create: `packages/core/src/services/lsp/**`
- Create: `packages/core/src/memdir/**`
- Create: `packages/core/src/plugins/**`
- Create: `docs/core/modules/services.md`

- [ ] 先镜像服务结构与调用路径，再决定哪些点需要本地替换。
- [ ] 所有 Anthropic API、OAuth、analytics 相关文件必须逐项登记到账本。
- [ ] MCP、LSP、plugin、team memory 等生态能力要跟着主运行时一起迁入，避免后期变成“补丁系统”。

### Task 8: 迁移 Commands / Hooks / Keybindings / 其他辅助运行时目录

**Files**

- Create: `packages/core/src/commands/**`
- Create: `packages/core/src/hooks/**`
- Create: `packages/core/src/keybindings/**`
- Create: `packages/core/src/migrations/**`
- Create: `packages/core/src/utils/**`（补齐余下未迁项）
- Create: `docs/core/modules/cli-entrypoints.md`

- [ ] 先迁与后端强耦合的命令，如 `plan`、`tasks`、`mcp`、`model`、`review`、`commit`、`statusline`。
- [ ] Hook 不按“是否 React hook”分类，而按“是否属于主循环/状态驱动逻辑”分类处理。
- [ ] keybindings、migrations、settings 变化检测等辅助系统也纳入完整镜像，而不是留作零碎后续项。

### Task 9: 在后端镜像稳定后，回接 TUI / Ink / Components / Main Loop UI

**Files**

- Modify: `packages/tui/src/**`
- Create: `packages/tui/src/entrypoints/**`
- Create: `packages/tui/src/components/**`
- Create: `packages/tui/src/hooks/**`
- Create: `packages/tui/src/ink/**`
- Create: `packages/tui/src/context/**`
- Modify: `docs/tui/**`
- Create: `docs/core/modules/tui-reintegration.md`

- [ ] 以已经镜像完成的 `packages/core/src` 为真实依赖，逐步替换现有 `packages/tui` 中的 mock runtime。
- [ ] 回接顺序必须跟随 `main.tsx`、`App.tsx`、`Messages.tsx`、`TextInput.tsx`、`StatusLine.tsx`、`ink/**` 的真实依赖。
- [ ] 禁止再以 `packages/tui` 的临时接口反向要求 `packages/core` 变形。

### Task 10: 完成专有依赖替换账本、DeepSeek 替换挂点与全仓验收

**Files**

- Modify: `docs/core/proprietary-replacement-ledger.md`
- Create: `docs/core/runtime-equivalence-checklist.md`
- Modify: `packages/core/src/services/api/**`
- Modify: `packages/core/src/services/oauth/**`
- Modify: `packages/core/src/services/analytics/**`
- Modify: `packages/core/src/bridge/**`
- Modify: `packages/core/src/remote/**`
- Modify: `packages/core/src/entrypoints/**`

- [ ] 为每个专有依赖确定当前状态：`镜像保留` / `stub` / `可替换` / `已替换为 DeepSeek 挂点`
- [ ] 把 `deepseek-tui` 参考原则写成替换说明，但不伪造本地镜像或代码依据。
- [ ] 用等价性清单对根入口、工具执行、任务状态、权限判定、MCP 接入、远程桥接和 TUI 回接做逐项验收。

## Assumptions & Decisions

- 决策：本轮计划覆盖 Claude Code 完整 `src/`，而不是只做后端子集。
- 决策：执行时仍然按波次推进，但波次不是多个独立项目，而是同一总迁移计划中的依赖顺序。
- 决策：`packages/core/src` 采用镜像式落盘，而不是按 Vigilon 理想架构先重组。
- 决策：后端核心保持 TypeScript，不整体换语言。
- 决策：现有 `packages/tui` 不删除，但在后端完成前不再作为接口真相源。
- 决策：Anthropic 专有依赖优先像素级保留调用边界，再记录替换点；不提前设计大而全 provider abstraction。
- 假设：本地唯一可信的 Claude Code 源码基线是 `docs/superpowers/research/sources/claude-code/src`。
- 假设：本地当前没有 `deepseek-tui` 源码基线，因此它只能作为替换原则而不是本轮映射源。

## Risks & Mitigations

- 风险：一次性全源码迁移范围极大，执行时容易重新退回“先跑 TUI”的短路路径。
  - 缓解：用 `docs/core/waves.md` 固定波次，波次 H 之前禁止让 TUI 反向定义接口。
- 风险：执行者在镜像过程中忍不住按自定义架构重组目录。
  - 缓解：先建立全量 `source-to-target-master-map`，每个文件都必须先有映射再有修改。
- 风险：Anthropic 专有服务过早被重写为 DeepSeek 版本，导致难以判断偏差。
  - 缓解：所有替换必须先记账，再执行；没有账本项不允许随意替换。
- 风险：`packages/shared` 被提前抽象成一个新的系统中心。
  - 缓解：只允许稳定、明确跨包复用的协议进入 `packages/shared`，默认实现仍在 `packages/core/src`。
- 风险：旧的 TUI 探索文件继续膨胀，形成第二套架构。
  - 缓解：在计划和文档中明确把它降级为后续回接对象。

## Verification Steps

### 结构验证

- 验证 `packages/core/src` 是否已经覆盖上游 `src/` 的所有关键目录边界。
- 验证 `docs/core/source-to-target-master-map.md` 是否覆盖所有根级文件与主要目录。
- 验证每个上游文件都能在映射表中找到唯一目标路径或明确的“后续波次”状态。

### 编译验证

- 对每个波次执行后运行 workspace 级 `typecheck`。
- 对 `packages/core` 单独运行 build/typecheck，确认镜像文件之间的导入路径闭合。
- 在 TUI 回接前，确认 `packages/core` 不依赖 `packages/tui`。

### 行为验证

- 核验 `Tool.ts`、`tools.ts`、`Task.ts`、`tasks/**` 的核心状态迁移与工具执行路径是否可跑通。
- 核验权限/只读/路径校验链路是否在迁移早期就生效，而不是后补。
- 核验 `bridge`、`remote`、`server`、`cli` 入口至少能完成 smoke test。

### 文档验证

- 核验 `docs/core/proprietary-replacement-ledger.md` 是否覆盖所有专有网络、鉴权、遥测、远程依赖点。
- 核验模块文档是否清楚写出“不允许擅自重构”的边界。
- 核验 `docs/tui` 与 `docs/core/modules/tui-reintegration.md` 是否一致反映“后端先行，TUI 后接”。

### 最终验收

- 形成一份 `docs/core/runtime-equivalence-checklist.md`，覆盖：
  - 入口启动
  - 会话状态
  - 工具调用
  - 任务编排
  - 权限审批
  - MCP/LSP/Plugin 生态
  - Bridge/Remote/CLI
  - TUI 回接
  - Anthropic 专有替换挂点

## Out Of Scope

- 在镜像迁移开始前就做 Vigilon 自定义产品重构。
- 在没有本地 `deepseek-tui` 基线的情况下，假装已经完成 DeepSeek 全量替换设计。
- 任何与 Claude Code 完整源码迁移无关的新功能、新 UI 风格或额外产品层创新。
