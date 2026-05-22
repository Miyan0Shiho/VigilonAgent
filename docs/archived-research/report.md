# 三项目源码深度调研报告（Claude Code / OpenClaw / Hermes Agent）

> 归档说明：本报告是历史研究记录。原始 source mirrors 已在 Whiteboard Agent Alpha 清理中从 Git 工作树移除，并压缩到本机 `.local-archives/vigilon-reference-mirrors-20260522-2132.tar.gz`。文中的 `sources/...` 路径是归档期证据路径，不再保证是当前仓库中的可打开路径。
>
> 本报告聚焦：**Agent 规划/执行机制**。  
> 版本锁定见：[notes/sources-lock.md](notes/sources-lock.md)；对比矩阵见：[comparison-matrix.md](comparison-matrix.md)；关键索引见：[notes/projects/claude-code.md](notes/projects/claude-code.md) / [openclaw.md](notes/projects/openclaw.md) / [hermes-agent.md](notes/projects/hermes-agent.md)（通用总目录见：[notes/catalog.md](notes/catalog.md)）。
>
> 导航目录：[`notes/catalog.md`](notes/catalog.md)；兼容入口：[`notes/catalog.solo.md`](notes/catalog.solo.md)

## 0. 摘要（你应该先看什么）
三者都覆盖“模型调用→工具执行→回填→下一轮”的核心闭环，但在“规划表示”“执行安全”“扩展边界”的工程取向上明显不同：
- **Claude Code**：把“先计划再执行”工程化成显式 Plan Mode（Enter/Exit Plan Mode 工具 + 用户审批 gate + plan 文件持久化/恢复）。优势是强约束、可控、适合高风险代码改动场景。
- **OpenClaw**：以“控制面（Gateway）+ 插件体系（plugin-sdk/contracts）+ 任务/flow”为骨架，更像一个**长期在线的个人助手平台**；规划更多体现为结构化 payload 与任务系统的生命周期，而不是统一 Plan Mode。
- **Hermes Agent**：以 `AIAgent` 为核心 loop，用 **tool registry 自注册 + toolset 能力门控 + 并行 tool_calls 执行** 做工程化；规划常用 `todo` 工具表达，同时强调“自我改进/技能系统/委派”。

## 1. 方法（保证可复核）
1) 固定 9 个对齐维度（见 `comparison-matrix.md`），每个维度输出：**一句话结论 + 证据（文件/函数/文档 URL）**。  
2) 对每个项目建立“关键文件索引”（`notes/projects/*.md`），保证任何结论都能回跳到具体入口。
3) 把“规划/执行”拆为 4 个关键环节抽取证据：  
   - 规划表示（plan/todo/结构化 payload）  
   - 工具选择与注入（registry/MCP/plugin-sdk）  
   - 执行控制（权限/审批/沙箱/并行/回滚/中断）  
   - 结果回填（tool result → messages/状态机 → 下一轮）

## 2. Claude Code：Plan Mode 作为一级能力（强 gate）
> 代码索引：`notes/projects/claude-code.md`

### 2.1 规划表示：plan 文件 + transcript 可恢复
Claude Code 把“计划”实体化为 plan 文件，并将其纳入会话可恢复资产：  
- `EnterPlanMode` / `ExitPlanMode` 工具定义了完整的人机协议（何时澄清、何时写计划、何时请求批准）。  
- `utils/plans.ts` 展示了计划内容的三种恢复路径：从 tool_use 输入、从 user message 的 `planContent` 字段、以及从 `plan_file_reference` 附件恢复。

证据：
- `sources/claude-code/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`
- `sources/claude-code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `sources/claude-code/src/utils/plans.ts`

### 2.2 工具系统：ToolUseContext 将“工具/权限/MCP/状态更新”绑定在一个上下文里
`ToolUseContext` 把执行系统的关键控制面都收敛到统一注入点（tools、thinkingConfig、mcpClients、权限上下文、UI 状态更新等），这使得：
- 工具可在不同执行形态（主线程、子代理、后台任务）共享统一的执行语义；
- 权限/审批与工具执行可以自然耦合（例如 plan mode 前后权限模式切换、审批 UI）。

证据：
- `sources/claude-code/src/Tool.ts`（`ToolUseContext`、`ToolPermissionContext`）
- `sources/claude-code/src/tools.ts`（工具组装/挂载）
- `sources/claude-code/src/services/mcp/`（MCP 动态工具面）

### 2.3 执行控制：Bash/File 工具有明确的安全与只读校验
Bash/文件类工具是高风险执行面，代码中可见安全/权限/只读约束的模块化拆分（例如 bashSecurity、bashPermissions、readOnlyValidation）。

证据：
- `sources/claude-code/src/tools/BashTool/`
- `sources/claude-code/src/tools/FileEditTool/`

### 2.4 任务与后台：Task 模型 + RemoteAgentTask 把“执行”当成可管理实体
任务模型（`Task.ts`）提供状态机语义；远程 agent task 里显式处理了 plan mode 的审批等待、轮询与 badge 标记，体现“计划 gate 也是执行的一部分”。

证据：
- `sources/claude-code/src/Task.ts`
- `sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`

## 3. OpenClaw：平台化（plugin first）+ 任务/flow 工程化执行
> 代码索引：`notes/projects/openclaw.md`

### 3.1 执行基本单元：TaskRecord + Flow
OpenClaw 的执行管理非常“系统工程化”：  
- `createQueuedTaskRun`/`createRunningTaskRun` 明确区分 queued/running；  
- `ensureSingleTaskFlow` 把“单任务也纳入 flow”作为可投递/可取消/可追踪的统一抽象；  
- `task-registry.ts` 中维护 tasks Map 与 delivery state，并且提供 observer event 机制（便于 UI/网关/通知对齐）。

证据：
- `sources/openclaw/src/tasks/task-executor.ts`
- `sources/openclaw/src/tasks/task-registry.ts`

### 3.2 规划表示：更多是 payload/契约，而非统一 Plan Mode
从 `system-run-prepare-payload.ts` 可以看到 OpenClaw 把“执行计划”当作结构化 payload（argv/cwd/preview），更强调**可审计的执行意图**而不是“计划文件 gate”。

证据：
- `sources/openclaw/src/test-utils/system-run-prepare-payload.ts`（`payload.plan.*`）

### 3.3 扩展与隔离：plugin-sdk/contracts 把扩展边界做成硬约束
OpenClaw 的架构文本（`AGENTS.md`）与 contracts 测试文件反复强调：扩展只能通过 plugin-sdk 公共面进入 core，避免“插件反向侵入 host internals”。这类硬约束会直接影响工具注入、执行控制与安全模型。

证据：
- `sources/openclaw/AGENTS.md`
- `sources/openclaw/src/plugin-sdk/`
- `sources/openclaw/src/plugins/contracts/`

### 3.4 安全：对高风险工具默认 deny（尤其是 HTTP surface）
`dangerous-tools.ts` 明确列出默认 deny 的高风险工具（RCE、文件破坏、会话编排等）。这意味着 OpenClaw 将“执行风险”视为控制面的一等公民。

证据：
- `sources/openclaw/src/security/dangerous-tools.ts`

## 4. Hermes Agent：tool registry 自注册 + toolset 门控 + 并行 tool_calls 执行
> 代码索引：`notes/projects/hermes-agent.md`

### 4.1 Agent Loop：AIAgent + tool_calls 回填
`run_agent.py` 将 loop 工程化为：模型响应 → 解析 tool_calls → 执行工具 → 追加 tool 结果到 messages → 继续下一轮。  
关键点是 `_execute_tool_calls` 会根据批次是否可并行来选择 sequential/concurrent 两条路径。

证据：
- `sources/hermes-agent/run_agent.py`（`class AIAgent`、`_execute_tool_calls`、`_execute_tool_calls_concurrent`）

### 4.2 工具系统：registry.register() 自注册，天然适配扩展/刷新
`tools/registry.py` 采用“工具模块 import 时自注册”的模式（通过 AST 扫描判断哪些模块会 register），并用 RLock 提供快照一致性，适配 MCP 动态刷新导致的并发读写。

证据：
- `sources/hermes-agent/tools/registry.py`（`discover_builtin_tools`、`ToolRegistry.register`、快照与锁）

### 4.3 能力门控：toolsets 把“可行动作空间”配置化
`toolsets.py` 定义了多种场景 toolset（safe/debugging/hermes-acp 等），并将工具按功能组装；这会直接影响“规划能规划什么”“执行能执行什么”。

证据：
- `sources/hermes-agent/toolsets.py`

### 4.4 执行安全与稳定性：并行执行 + checkpoint + interrupt
并行执行的实现不仅是线程池，还包含：
- interrupt：用户中断时跳过工具执行并写入 tool message；
- checkpoint：对 `write_file/patch`、破坏性 terminal 命令做 checkpoint；
- heartbeats：长并行批次期间周期性心跳避免 gateway 误杀。

证据：
- `sources/hermes-agent/run_agent.py`（`_interrupt_requested` 分支、checkpoint 分支、心跳与并行逻辑）

## 5. 横向洞见（可迁移的设计模式）
1) **“计划”落地形态决定了安全策略的强度**  
   - Claude Code：Plan Mode + 审批 gate → 强一致流程控制；  
   - Hermes：todo 工具 + toolset 门控 → 更灵活但更依赖 prompt/策略；  
   - OpenClaw：结构化 payload + task/flow → 强审计与平台化治理。

2) **工具注入的“边界”决定了系统可维护性**  
   - OpenClaw：plugin-sdk/contracts 让边界可测试、可演进；  
   - Claude Code：ToolUseContext 让执行语义集中、便于统一控制；  
   - Hermes：registry 自注册让扩展低成本，但需要更强的 shadowing/安全策略（其 registry 已做保护）。

3) **并行不是“提速开关”，而是“正确性问题”**  
   Hermes 明确区分可并行/不可并行 batch，并引入 checkpoint 与 heartbeats；这类“并行语义”是执行系统成熟的重要标志。

## 6. 建议阅读顺序（10 分钟抓住脉络）
1) `notes/sources-lock.md`（版本锁定）  
2) `comparison-matrix.md`（先看结论与证据跳转）  
3) `notes/projects/claude-code.md` → 重点：Plan Mode 与 ToolUseContext  
4) `notes/projects/openclaw.md` → 重点：task/flow 与 plugin boundary  
5) `notes/projects/hermes-agent.md` → 重点：run_agent.py 的 tool_calls 执行链路与 toolsets
