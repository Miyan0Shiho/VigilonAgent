# Vigilon Agent 产品定位与能力边界

- 日期：2026-05-17
- 状态：预产品化基线
- 目的：让后续人类开发者和 Agent 开发者快速理解 Vigilon Agent 的产品灵魂、第一阶段目标与能力边界。

## 1. 一句话定位

Vigilon Agent 是一个任务优先的超级个人助手：用户交给它一个目标，它负责在可控边界内调动代码编写、代码库理解、资料调研、本地电脑操作、外部工具和多 Agent 协作，把任务推进到可验证的完成状态。

它的第一性身份不是聊天机器人，也不只是 Coding Agent，而是一个以本地工作环境为核心的 personal agent runtime。Coding 是第一阶段最重要、最成熟、最可验证的落地点，因为代码、终端、文件系统、Git 和测试天然适合形成闭环。

## 2. 产品灵魂

### 2.1 任务解决优先

Vigilon 的核心价值不是回答得像人，而是把事情做成。

优先级顺序是：

1. 任务能否完成。
2. 完成过程是否可验证、可恢复、可审计。
3. 用户是否能清楚理解 Agent 正在做什么、为什么这么做、哪里需要人类确认。
4. 界面和表达是否让这个过程更高效、更可信。

这意味着 Vigilon 不应围绕“模型能说什么”组织产品，而应围绕“runtime 能在什么权限边界内完成什么任务闭环”组织产品。

### 2.2 代码是能力放大器，不是唯一目的

Vigilon 先从 Claude Code/Codex 类 coding workflow 出发，但产品边界不止于写代码。

代码能力承担三类角色：

- 作为交付物：实现功能、修 bug、写测试、做重构、生成脚本。
- 作为操作手段：用脚本整理文件、分析数据、批量处理任务、调度工具。
- 作为验证手段：运行测试、检查日志、复现问题、生成可重复实验。

因此，Coding Agent 是 Vigilon 的基础形态；超级个人助手是 Vigilon 的目标形态。

### 2.3 Claude Code 是第一阶段骨架

第一阶段的工程策略是优先复刻 Claude Code 的成熟产品骨架，而不是从零发明 agent runtime。

必须优先复刻的不是表层命令名，而是这些已经被验证的核心秩序：

- Plan / Execute 分离。
- 工具池、MCP、skills 的统一装配。
- 权限模式、审批弹窗、allow/deny 规则和高风险操作 gate。
- transcript 中心的会话持久化、resume、压缩边界和可恢复任务上下文。
- 文件、shell、搜索、任务列表、计划模式和结果报告的闭环。

同时，Claude Code 中的 remote/bridge、企业治理、多用户协作、teammate approval、marketplace、billing、telemetry、多端产品面不属于 Vigilon Phase 1。它们只作为源码研究材料存在，不作为当前实现目标。

具体功能设计必须 copy-first：先按 Claude Code 源码机制实现，再按 Vigilon 的 Solo Runtime 目标改写和优化。尤其是搜索链路、上下文压缩链路、记忆链路和具体工具实现，禁止在未对照 Claude Code 源码机制前自行摸索。

只有这条基线站稳后，再讨论 Vigilon 独有的产品语言、个人助手能力和 Agent 社会。

### 2.4 Codex 是体验标尺

Codex 的价值不是“更好看”，而是任务过程的产品叙事更完整。

Vigilon 的体验目标是：

- 任务入口清楚。
- 过程状态清楚。
- 工具调用、权限等待、错误、恢复路径清楚。
- 结果呈现能让用户立刻判断是否完成。
- 长任务、后台任务、多 Agent 任务不会变成黑盒。

Claude Code 提供 runtime 秩序，Codex 提供产品完成度标尺。

### 2.5 Agent 社会是后续扩展方向

Vigilon 不应只把 subagent 当作工具调用的一种包装，而要逐步发展成可治理的 Agent 社会。

但 Agent 社会不是第一阶段的主线。它必须建立在 Claude Code Core Parity for Solo Runtime 之后：

- 主 Agent 负责目标理解、拆解、风险判断和最终交付。
- 子 Agent 负责明确、有限、可回收的子任务。
- 每个 Agent 的权限、工具、上下文和输出都可追踪。
- 并行协作必须可停止、可恢复、可审计。

## 3. 能力边界

### 3.1 第一阶段必须拥有的能力

| 能力面 | 产品含义 | 第一阶段边界 |
| --- | --- | --- |
| 代码库理解 | 能快速读懂项目结构、定位文件、追踪实现 | 以 Claude Code 的 file/search/read 路径为基线 |
| 文件编辑 | 能安全修改、创建、重写文件 | 需要 diff、staleness 检查、权限 gate |
| Shell 执行 | 能运行测试、构建、脚本和诊断命令 | 高风险命令必须审批，输出必须进入 transcript |
| 计划模式 | 能先分析和计划，再进入执行 | 高风险或大范围改动必须 Plan/Approve |
| 会话持久化 | 能恢复、继续、分叉、压缩上下文 | transcript 是事实底座 |
| 权限治理 | 用户能决定 Agent 能做什么 | permission mode、allow/deny、policy 是一等能力 |
| 工具扩展 | 能接入 MCP、skills、hooks 的最小闭环 | 扩展必须进入统一 ToolUseContext；subagents 后置 |
| 结果验证 | 完成任务后能给出验证证据 | 测试、命令输出、文件 diff、剩余风险 |

### 3.2 第二阶段扩展能力

| 能力面 | 产品含义 | 边界 |
| --- | --- | --- |
| Codex 级过程 UI | 更清晰呈现任务状态和操作过程 | 不牺牲 runtime 严肃性 |
| 本地电脑操作 | 操作 GUI、浏览器、桌面应用 | 必须带人类审批和可见反馈 |
| 深度调研 | 搜索网页、读文档、汇总报告 | 必须引用来源，区分事实与推断 |
| 个人知识与记忆 | 记住偏好、项目习惯、长期任务 | 需要可编辑、可审计、可删除 |
| 自动化与提醒 | 后台跟进、定时检查、持续监控 | 必须有清晰生命周期和停止入口 |

### 3.3 第三阶段扩展能力

| 能力面 | 产品含义 | 边界 |
| --- | --- | --- |
| Agent 社会 | 多 Agent 分工、协作、交接、复盘 | 主 Agent 保持最终责任 |
| 跨应用工作流 | 邮件、日历、Notion、GitHub、Linear 等 | 外部账户和敏感操作必须最小权限 |
| 个人操作系统感 | 从任务入口到执行网络的一体化体验 | 不能变成不可解释的全自动黑盒 |

## 4. 非目标

Vigilon 当前不做这些定位：

- 不做普通聊天产品。
- 不做只会生成代码片段的代码补全工具。
- 不做没有本地执行能力的云端问答助手。
- 不做一开始就完全自主行动的黑盒代理。
- 不做为了“独特”而放弃 Claude Code 已验证秩序的重写实验。
- 不把 UI 皮肤当作产品核心。
- 不把多 Agent 并行当作早期复杂度炫技。

## 5. 产品阶段

### Phase 0：产品灵魂对齐

目标：固定定位、能力边界、不可妥协原则和阅读入口。

交付物：

- 本文档。
- README 产品叙事更新。
- 后续开发 Agent 的项目接手指引。

### Phase 1：Claude Code Core Parity for Solo Runtime

目标：基于已拆解的 Claude Code 源码，复刻一个面向个人开发者的可用、可信、可恢复的本地 agent runtime。

阶段路线图：`docs/product/2026-05-17-phase-1-solo-runtime-parity-checklist.md`

这个阶段复刻 Claude Code 的核心任务闭环、执行秩序和安全边界，但明确不复刻企业级产品包袱。Vigilon 要模拟公司级工程纪律，不模拟公司级组织系统。

验收标准：

- 能进入交互式主会话。
- 能读、搜、改、写文件。
- 能执行 shell 并记录结果。
- 能在高风险操作前请求权限。
- 能进入 plan mode 并等待用户确认。
- 能保存 transcript 并 resume。
- 能管理 task/todo 状态。
- 能接入 MCP/skills/hooks 的最小闭环。
- 不做 remote / bridge / multi-user / enterprise / admin / billing / telemetry / marketplace。

### Phase 2：Vigilon Experience

目标：在不破坏 runtime 秩序的前提下，把过程体验提升到 Codex 级。

验收标准：

- 用户能直观看到任务状态、工具状态、权限等待、错误恢复。
- 长任务和后台任务有稳定入口。
- 结果报告比命令行流水更适合交付。
- UI 不是装饰，而是降低控制成本和理解成本。

### Phase 3：Personal Assistant Expansion

目标：从 coding workflow 扩展到个人任务 workflow。

验收标准：

- 支持本地电脑操作、浏览器操作和资料调研。
- 支持个人记忆、项目记忆、长期任务。
- 支持可控的自动化、提醒和监控。

### Phase 4：Agent Society

目标：形成可治理的多 Agent 协作系统。

验收标准：

- 子 Agent 可创建、分工、停止、恢复。
- 子 Agent 的权限和上下文边界明确。
- 主 Agent 能汇总、校验、整合结果。
- 用户能理解每个 Agent 的职责、进度和产出。

## 6. 北极星指标

Vigilon 的产品质量应围绕这些指标判断：

- 任务完成率：用户交给它的真实任务有多少能闭环完成。
- 可验证完成率：完成后有多少能给出测试、输出、diff 或来源证据。
- 恢复可靠性：中断、压缩、后台、跨会话后能否继续。
- 权限精度：该拦的拦，该自动的自动，少打断但不越权。
- 本地真实感：它是否真正理解当前机器、仓库、文件和环境状态。
- 接手速度：新的人类或 Agent 是否能快速理解项目目标与当前阶段。
- 协作杠杆：多 Agent/工具是否减少主任务成本，而不是增加协调成本。

## 7. 对后续 Agent 的接手要求

后续任何开发 Vigilon 的 Agent，应先按这个顺序阅读：

1. `README.md`
2. `docs/product/2026-05-17-product-positioning-and-boundary.md`
3. `docs/claudecode-research/README.md`
4. `docs/claudecode-research/library/master-index.md`
5. `docs/product/2026-05-17-phase-1-solo-runtime-parity-checklist.md`
6. `docs/product/2026-05-17-phase-1-copy-first-mechanism-map.md`
7. 与当前任务直接相关的 `docs/claudecode-research/library/product/`、`mechanisms/`、`architecture/` 文档

接手时必须遵守：

- 先对齐产品定位，再做实现。
- 先查 Claude Code 源码和研究文档，再提出 runtime 改造。
- 具体功能先按 Claude Code 源码机制复刻，再考虑 Vigilon 改写和优化。
- Phase 1 不追求差异化，优先追求 Claude Code core runtime 在个人本地环境中可运行、可恢复、可验证。
- 不为了短期功能绕过权限、transcript、resume、tool context 等基础秩序。
- 每次实现都要说明它属于哪个产品阶段，推进了哪个能力面。
- 每个 Phase 1 任务必须标记为 Must Have、Solo Simplified 或 Explicitly Excluded。

## 8. 当前决策

本轮预产品化将 Vigilon 从“代码代理产品”升级定义为“任务优先的超级个人助手”，但第一阶段仍以 Claude Code Core Parity for Solo Runtime 为硬目标。

这个决策带来的直接影响：

- README 不能只把 Vigilon 描述为 Coding Agent。
- 架构文档需要把 coding runtime 视为基础形态，而不是最终边界。
- Claude Code core runtime 复刻是当前主线，不应被过早的 UI、Agent 社会、remote/bridge 或泛个人助手想象打断。
- 后续能力扩展必须回到任务闭环、权限治理、可恢复性和可验证性四个核心标准。
