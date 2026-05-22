# Claude Code 全源码复制与最小适配三步总计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` 或逐任务内联执行。本计划只允许 3 个总波次，原则固定为“先复制、再适配、最后验收闭环”，禁止在执行阶段自行做结构性重构。

**Goal:** 将 `docs/superpowers/research/sources/claude-code/src` 的完整产品栈按原有目录边界复制到 `packages/core/src` 与 `packages/tui/src`，然后仅对 DeepSeek V4 模型接入、Anthropic 专有服务和少量产品常量做最小必要适配，尽快形成一个可运行的 DeepSeek 版 Claude Code。

**Architecture:** 第一原则是复制而不是重写。`packages/core/src` 承接 Claude Code 后端、运行时、工具系统、任务系统、服务层与桥接层；`packages/tui/src` 承接 TUI、命令层、Ink 层与交互组件；只有真正稳定的跨包协议才抽到 `packages/shared`。遇到 Anthropic 专有依赖时优先保留调用链与接口位置，先做等位适配层，再参考 GitHub 外部知识 `deepseek-tui` 做后续替换。

**Tech Stack:** TypeScript、Node.js、React、Ink、Monorepo、Vitest、Claude Code 本地源码镜像、DeepSeek V4 适配层、模块级映射与替换账本。

---

## Summary

- 这份计划不再把“跨语言迁移”作为目标。
- 这份计划把“学习 Claude Code 实现”与“尽快产出可用产品”统一为同一条路线：
  - **完整复制**
  - **最小适配**
  - **最后才做必要替换**
- 复制范围明确覆盖：
  - `packages/core/src`
  - `packages/tui/src`
  - `packages/shared/src` 中少量稳定协议
- 当前仓库里的 `packages/tui` 最小试探性实现不再作为主线设计依据，后续执行时以 Claude Code 原源码复制结果为准。
- 整体只分 **3 步**，满足用户约束。

## Current State Analysis

### 当前工作区状态

- 根工作区已有基础工程文件：
  - [package.json](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/package.json)
  - [pnpm-workspace.yaml](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/pnpm-workspace.yaml)
  - [tsconfig.base.json](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/tsconfig.base.json)
- 当前包结构已存在：
  - `packages/core`
  - `packages/shared`
  - `packages/tui`
- `packages/core/src` 当前仅有极小起步文件：
  - `packages/core/src/index.ts`
- `packages/tui/src` 当前是一个最小试探性 TUI：
  - `entrypoints/cli.tsx`
  - `main.tsx`
  - `components/*`
  - `hooks/*`
  - `commands/*`
  - `adapters/runtimeAdapter.ts`
- 这说明仓库目前已经有“可运行工作区”，但还没有进入“完整复制 Claude Code 产品栈”的阶段。

### Claude Code 上游源码真实范围

- 本地完整源码镜像位于 [claude-code](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/sources/claude-code)。
- 已确认上游并不是“后端 + TUI 两小块”，而是完整产品栈，至少包含：
  - `src/tools/`
  - `src/tasks/`
  - `src/services/`
  - `src/utils/`
  - `src/state/`
  - `src/bridge/`
  - `src/remote/`
  - `src/server/`
  - `src/commands/`
  - `src/components/`
  - `src/hooks/`
  - `src/ink/`
  - `src/context/`
  - `src/constants/`
  - `src/types/`
  - `src/keybindings/`
  - `src/plugins/`
  - `src/migrations/`
  - `src/memdir/`
  - `src/entrypoints/`
  - `src/Tool.ts`
  - `src/Task.ts`
  - `src/tools.ts`
  - `src/context.ts`
  - `src/commands.ts`
  - `src/QueryEngine.ts`
  - `src/main.tsx`

### 已有研究与约束

- [README.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/README.md) 已明确产品目标是：
  - DeepSeek V4 模型能力
  - Claude Code 架构秩序
  - Codex 级体验
- [claude-code.md](file:///Users/liuminxuan/.trae/worktrees/VigilonAgent/feat-rewrite-claude-code-7ykfCe/docs/superpowers/research/notes/projects/claude-code.md) 已指出 Claude Code 核心秩序来自：
  - 工具系统
  - 任务系统
  - 状态存储
  - Plan/Execute gate
  - MCP / 权限 / 工具调度
- 仓库当前没有 `deepseek-tui` 本地源码，因此它只能作为外部知识，不能作为计划中的本地输入源。

### 已锁定方向

- 方向不再是“语言改写”。
- 方向改为：
  - **Claude Code 全源码复制**
  - **TUI 也先复制**
  - **仅做最小必要适配**
  - **Anthropic 专有服务与模型层改成适用 DeepSeek V4**

## Proposed Changes

## Step 1: 完整复制 Claude Code 产品栈并建立复制/适配账本

**目标**

- 把 Claude Code `src/` 的完整产品栈按目录边界复制进我们自己的工作区。
- 不在这一步做“大脑重构”，只做目录映射、复制规则、覆盖策略和适配账本。
- 明确哪些文件是“原样复制”，哪些文件是“复制后立刻需要替换/适配”。

**目标落点**

- 后端与运行时主落点：
  - `packages/core/src/Tool.ts`
  - `packages/core/src/Task.ts`
  - `packages/core/src/tools.ts`
  - `packages/core/src/context.ts`
  - `packages/core/src/commands.ts`
  - `packages/core/src/QueryEngine.ts`
  - `packages/core/src/tools/**`
  - `packages/core/src/tasks/**`
  - `packages/core/src/services/**`
  - `packages/core/src/utils/**`
  - `packages/core/src/state/**`
  - `packages/core/src/bridge/**`
  - `packages/core/src/remote/**`
  - `packages/core/src/server/**`
  - `packages/core/src/constants/**`
  - `packages/core/src/types/**`
  - `packages/core/src/keybindings/**`
  - `packages/core/src/plugins/**`
  - `packages/core/src/migrations/**`
  - `packages/core/src/memdir/**`
  - `packages/core/src/entrypoints/init.ts`
  - `packages/core/src/entrypoints/mcp.ts`
- TUI 与交互主落点：
  - `packages/tui/src/main.tsx`
  - `packages/tui/src/entrypoints/cli.tsx`
  - `packages/tui/src/components/**`
  - `packages/tui/src/hooks/**`
  - `packages/tui/src/commands/**`
  - `packages/tui/src/ink/**`
  - `packages/tui/src/context/**`
  - `packages/tui/src/buddy/**`
- 共享层只承接稳定协议：
  - `packages/shared/src/contracts/messages.ts`
  - `packages/shared/src/contracts/tasks.ts`
  - `packages/shared/src/contracts/tools.ts`
  - `packages/shared/src/contracts/permissions.ts`
  - `packages/shared/src/contracts/session.ts`
  - `packages/shared/src/contracts/mcp.ts`
  - `packages/shared/src/contracts/model.ts`

**创建文档**

- `docs/migration/source-to-target-map.md`
- `docs/migration/copy-policy.md`
- `docs/migration/anthropic-replacement-ledger.md`
- `docs/migration/modules/core-runtime.md`
- `docs/migration/modules/tui-runtime.md`
- `docs/migration/modules/model-and-services.md`

**复制规则**

- 原则 1：优先保留文件名、目录名、模块边界、导入关系。
- 原则 2：如果文件本质上属于 TUI，就复制到 `packages/tui/src`；如果本质上属于后端或运行时，就复制到 `packages/core/src`。
- 原则 3：只有在两个包都稳定消费的协议才抽到 `packages/shared`。
- 原则 4：第一步不主动优化逻辑，不主动改名，不主动拆分文件。
- 原则 5：当前 `packages/tui` 试探性文件视为临时实现，后续允许被上游复制结果覆盖或替换。

**账本字段**

- `source-to-target-map.md` 至少记录：
  - 上游文件
  - 目标文件
  - 归属包：`core` / `tui` / `shared`
  - 状态：`copy-as-is` / `copy-and-adapt` / `copy-later`
  - 依赖方向
- `anthropic-replacement-ledger.md` 至少记录：
  - 上游文件
  - 目标文件
  - Anthropic 专有依赖类型
  - 当前策略：`copy-first` / `stub-after-copy` / `replace-in-step-2`
  - 替换目标：`deepseek-v4` / `local-runtime` / `disabled`
  - 外部参考：`deepseek-tui-github`

**完成定义**

- `packages/core/src` 与 `packages/tui/src` 都有完整镜像落点计划，而不是只规划后端。
- 所有上游核心目录都进入映射账本。
- 复制策略与覆盖当前试探性代码的策略已写清楚。

## Step 2: 在复制结果上做最小必要适配，替换模型层与 Anthropic 专有服务

**目标**

- 不重写 Claude Code 主体逻辑，只在复制结果之上替换必须替换的东西。
- 让核心运行时和 TUI 都能在我们的环境中逐步编译、运行并接入 DeepSeek V4。

**优先适配面**

1. 模型层与 API 客户端
   - `packages/core/src/services/api/**`
   - `packages/core/src/services/claudeAiLimits.ts`
   - `packages/core/src/services/claudeAiLimitsHook.ts`
   - `packages/core/src/utils/api.ts`
   - `packages/core/src/utils/model/**`
   - `packages/core/src/commands/model/**`
2. 认证、会话与 Anthropic 账户专有能力
   - `packages/core/src/services/oauth/**`
   - `packages/core/src/constants/oauth.ts`
   - `packages/core/src/utils/auth*.ts`
   - `packages/core/src/commands/login/**`
   - `packages/core/src/commands/logout/**`
   - `packages/core/src/services/remoteManagedSettings/**`
3. Anthropic 产品与品牌绑定项
   - `packages/core/src/constants/product.ts`
   - `packages/core/src/constants/messages.ts`
   - `packages/core/src/constants/system.ts`
   - `packages/core/src/constants/prompts.ts`
   - `packages/tui/src/components/**` 中直接出现 Anthropic/Claude 文案的位置
4. 使用量、速率限制、遥测与专有后台
   - `packages/core/src/services/analytics/**`
   - `packages/core/src/services/api/usage.ts`
   - `packages/core/src/services/api/bootstrap.ts`
   - `packages/core/src/services/api/sessionIngress.ts`
   - `packages/core/src/cost-tracker.ts`
5. TUI 与运行时耦合面
   - `packages/tui/src/main.tsx`
   - `packages/tui/src/components/App.tsx`
   - `packages/tui/src/hooks/useMainLoopModel.ts` 相关接入点
   - `packages/tui/src/commands/**` 中与账户、模型、任务、MCP 绑定的命令

**适配原则**

- 先复制，再改。
- 不把“适配”扩大成“重构”。
- 能通过 wrapper / adapter / provider 替换的，不直接改大段业务逻辑。
- 能通过常量替换解决的，不去重写调用链。
- 任何需要大幅改写的 Anthropic 专有能力，都先保留边界并写进 `anthropic-replacement-ledger.md`。

**建议适配文件**

- `packages/shared/src/contracts/model.ts`
- `packages/core/src/adapters/model/DeepSeekV4Client.ts`
- `packages/core/src/adapters/auth/`
- `packages/core/src/adapters/usage/`
- `packages/core/src/adapters/product/`
- `packages/tui/src/adapters/runtime/`

**测试与验证重点**

- 核心测试：
  - 模型请求/响应映射
  - 工具注册与任务调度不因模型替换而断裂
  - 权限链路不因服务替换而失效
  - TUI 主循环仍能消费真实运行时
- 重点验证文件示例：
  - `packages/core/src/services/api/**/__tests__/*.test.ts`
  - `packages/core/src/tools/**/__tests__/*.test.ts`
  - `packages/core/src/tasks/**/__tests__/*.test.ts`
  - `packages/tui/src/**/__tests__/*.test.tsx`

**完成定义**

- Claude Code 主体代码已复制到本地包结构。
- 模型层已不再硬绑定 Anthropic。
- 核心专有服务已被替换、stub 或禁用，并有明确账本记录。
- TUI 与后端都能在“复制后适配”的基础上启动关键链路。

## Step 3: 形成可运行的 DeepSeek 版 Claude Code 闭环并清理偏差

**目标**

- 将复制后的 `core + tui` 串成完整工作闭环。
- 把仍残留的临时兼容层、重复占位、旧试探性实现清理到最小。
- 验证最终系统已是“Claude Code 骨架 + DeepSeek V4 核心模型”的可运行版本。

**主要工作**

- 清理 `packages/tui` 中与复制结果冲突的旧试探性实现
- 对齐 `packages/core` 与 `packages/tui` 的共享协议
- 恢复并验证关键命令链路：
  - `help`
  - `model`
  - `login/logout` 或其替代入口
  - `tasks`
  - `mcp`
  - `plan`
  - `review`
- 校正 TUI 中的状态线、工具进度、权限弹窗、消息展示
- 校正品牌、默认模型、产品常量和文案
- 把所有“仍未替换但保留边界”的专有能力汇总成最后的后续清单

**主要文件**

- `packages/core/src/**`
- `packages/tui/src/**`
- `packages/shared/src/contracts/**`
- `docs/migration/anthropic-replacement-ledger.md`
- `docs/migration/final-gap-list.md`
- `docs/migration/runtime-validation.md`

**验收闭环**

- `packages/core` 可 `typecheck`
- `packages/core` 可 `build`
- `packages/tui` 可 `typecheck`
- `packages/tui` 可 `build`
- 关键测试集通过
- CLI/TUI 可以跑通至少一条真实的 DeepSeek V4 交互链路
- 关键工具、任务、权限、状态展示链路不断裂

**完成定义**

- 当前工作区不再是“Claude Code 研究仓 + 小型试验 TUI”
- 而是“基于 Claude Code 完整复制结果、已完成最小必要 DeepSeek 适配的可运行产品骨架”

## Assumptions & Decisions

- 决策：不做跨语言改写，主干保持 TypeScript。
- 决策：TUI 也先复制，不再后置为单独阶段。
- 决策：执行策略从“迁移重写”改为“完整复制 + 最小必要适配”。
- 决策：当前 `packages/tui` 试探性代码允许被复制结果覆盖。
- 决策：`deepseek-tui` 只作为 GitHub 外部知识，不是当前仓库内的本地基线。
- 决策：整体计划严格限制为 3 步。
- 假设：当前本地 Claude Code 镜像是可用于复制的唯一可信源码基线。
- 假设：产品最重要的不是“代码长得和我们理想架构一样”，而是“不要因为多余设计导致产品不可用”。

## Risks & Mitigations

- 风险：直接复制全源码后，工作区会非常庞大。
  - 缓解：通过 `source-to-target-map.md` 管理复制范围和状态，避免失控。
- 风险：复制后会和当前 `packages/tui` 试探性实现冲突。
  - 缓解：在第一步就明确“以上游复制结果为准”，旧实现只保留到第三步清理。
- 风险：Anthropic 专有服务过多，导致适配面扩散。
  - 缓解：统一记账，优先 adapter 化，不在主干逻辑里到处打补丁。
- 风险：为了适配 DeepSeek V4 而过早改动太多上游逻辑。
  - 缓解：坚持“复制后再改，且只改必要边界”。
- 风险：外部知识 `deepseek-tui` 不在本地，替换依据不完整。
  - 缓解：只把它作为替换参考，不把它写成本轮执行前置条件。

## Verification Steps

### Step 1 验证

- 检查 `docs/migration/source-to-target-map.md` 是否覆盖 `core + tui` 两边的上游核心目录。
- 检查 `docs/migration/copy-policy.md` 是否明确复制、覆盖和 shared 抽取规则。
- 检查 `docs/migration/anthropic-replacement-ledger.md` 是否列出专有依赖和替换策略。

### Step 2 验证

- `packages/core` 的 `typecheck`、`build`、测试通过
- `packages/tui` 的 `typecheck`、`build`、测试通过
- DeepSeek V4 模型接入链路可用
- 关键 Anthropic 专有依赖已被替换、stub 或禁用

### Step 3 验证

- CLI/TUI 跑通至少一条真实 DeepSeek V4 交互链路
- 工具、任务、权限、消息流、状态线形成闭环
- 旧试探性实现已清理或被复制结果替代
- `final-gap-list.md` 清楚记录剩余未完成替换项

## Out Of Scope

- 现在就把 Claude Code 改造成我们理想中的全新架构
- 现在就引入 `deepseek-tui` 本地源码并混入复制主线
- 在计划阶段直接决定所有 Anthropic 专有能力的最终长期设计
- 在核心闭环跑通前扩展 Web 前端或额外产品形态
