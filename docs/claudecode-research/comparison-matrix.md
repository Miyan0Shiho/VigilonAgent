# 三项目对比矩阵（聚焦：Agent 规划/执行机制）

> 项目根：  
> - Claude Code：`research/sources/claude-code/`  
> - OpenClaw：`research/sources/openclaw/`  
> - Hermes Agent：`research/sources/hermes-agent/`

## 1) Agent Loop 结构（回合制/事件驱动/后台任务）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | UI 驱动的回合式交互（Ink/React），并通过任务系统支持后台/远程 agent 执行。 | `sources/claude-code/src/main.tsx`；`sources/claude-code/src/tasks/`；`sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` |
| OpenClaw | 以“Gateway 控制面 + 任务系统”为核心，任务 run/flow 作为后台执行与通知的统一抽象；agent 能力通过 runtime seam 懒加载注入。 | `sources/openclaw/src/tasks/task-executor.ts`；`sources/openclaw/src/tasks/task-registry.ts`；`sources/openclaw/src/plugins/runtime/runtime-agent.ts`；`sources/openclaw/AGENTS.md` |
| Hermes Agent | `AIAgent` 作为主循环实体：每轮 API 调用后解析 `tool_calls` 并执行（支持顺序/并行），再回填到 messages 继续下一轮。 | `sources/hermes-agent/run_agent.py`（`class AIAgent`、`_execute_tool_calls`、`_execute_tool_calls_concurrent`） |

## 2) 计划表示与 gate（plan→execute 是否强制、如何校验）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | 显式 “Plan Mode” 强 gate：先产出计划文件→`ExitPlanMode` 请求用户审批→再进入执行；计划内容可从 transcript/附件恢复。 | `sources/claude-code/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`；`sources/claude-code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`；`sources/claude-code/src/utils/plans.ts` |
| OpenClaw | “Plan”更多体现为**结构化 payload**（如 system-run 的 `payload.plan`）与任务/flow 的生命周期约束；偏工程化流程 gate（wizard/doctor）而非统一的“plan mode”。 | `sources/openclaw/src/test-utils/system-run-prepare-payload.ts`（`payload.plan.*`）；`sources/openclaw/src/tasks/task-executor.ts` |
| Hermes Agent | 计划表示以 `todo` 工具（结构化 todo 列表）+ prompt 约束为主；工具执行前有 hook/审批/安全兜底（可视为“软 gate”）。 | `sources/hermes-agent/tools/todo_tool.py`；`sources/hermes-agent/run_agent.py`（`function_name == "todo"` 分支、`_invoke_tool` pre-hook block） |

## 3) 工具系统（注册/发现/schema、动态注入：插件/MCP/skills）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | ToolUseContext 统一携带 tools/MCP/权限/状态；工具集合集中在 `tools.ts` 组装；MCP 作为动态扩展工具面。 | `sources/claude-code/src/Tool.ts`；`sources/claude-code/src/tools.ts`；`sources/claude-code/src/services/mcp/` |
| OpenClaw | manifest-first + plugin-sdk 边界清晰：插件通过 contracts/registry 注入能力；core 通过 runtime seam 与 registry 加载能力（强调扩展隔离）。 | `sources/openclaw/AGENTS.md`（plugin boundary）；`sources/openclaw/src/plugins/`；`sources/openclaw/src/plugin-sdk/`；`sources/openclaw/src/plugins/runtime/runtime-registry-loader.ts` |
| Hermes Agent | “模块自注册”工具体系：`tools/*.py` import 时调用 `registry.register()`；registry 提供 toolset 归属、schema、handler、check_fn；MCP 工具可动态刷新。 | `sources/hermes-agent/tools/registry.py`；`sources/hermes-agent/tools/mcp_tool.py`；`sources/hermes-agent/model_tools.py` |

## 4) 执行控制（shell/文件/网络/浏览器；超时/中断/回滚/审批）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | Bash/File 等工具有显式权限/安全策略与只读校验；并与 UI 权限审批联动。 | `sources/claude-code/src/tools/BashTool/`（`bashSecurity.ts`、`bashPermissions.ts`、`readOnlyValidation.ts`）；`sources/claude-code/src/tools/FileEditTool/` |
| OpenClaw | 在 gateway HTTP surface 上对高风险工具默认 deny；工具风险表与审计逻辑集中维护。 | `sources/openclaw/src/security/dangerous-tools.ts`；`sources/openclaw/src/security/audit.ts` |
| Hermes Agent | 工具执行支持中断（interrupt）、并行线程池、长任务心跳；对写文件/patch/破坏性 terminal 命令有 checkpoint 保护；并支持审批工具。 | `sources/hermes-agent/run_agent.py`（`_interrupt_requested`、checkpoint 分支、并行执行）；`sources/hermes-agent/tools/approval.py` |

## 5) 任务模型（任务 ID、状态机、并行/子代理）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | 任务有明确类型/状态；支持本地会话任务与远程 agent task（含计划审批流程）。 | `sources/claude-code/src/Task.ts`；`sources/claude-code/src/tasks/LocalMainSessionTask.ts`；`sources/claude-code/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` |
| OpenClaw | 任务 record + flow（父子/取消/通知投递）；并用 registry + observer 机制做状态变更广播。 | `sources/openclaw/src/tasks/task-registry.ts`；`sources/openclaw/src/tasks/task-flow-runtime-internal.js`（同目录） |
| Hermes Agent | “任务”更多体现为 tool_calls 的批次执行与 delegate subagent；并行在 tool_calls 层实现（线程池），subagent 通过 `delegate_task` 工具实现。 | `sources/hermes-agent/run_agent.py`（`_execute_tool_calls_concurrent`）；`sources/hermes-agent/tools/delegate_tool.py` |

## 6) 记忆与上下文治理（持久化、压缩/总结、检索）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | memdir 负责相关记忆检索；计划文件可被 snapshot 到 transcript 以跨压缩边界；文件状态 cache 用于避免重复注入。 | `sources/claude-code/src/memdir/`；`sources/claude-code/src/utils/plans.ts`；`sources/claude-code/src/utils/fileStateCache.ts` |
| OpenClaw | 记忆作为插件 runtime 能力（按需加载 memory runtime，提供 search manager）。 | `sources/openclaw/src/plugins/memory-runtime.ts`；`sources/openclaw/src/plugins/memory-state.ts` |
| Hermes Agent | context 压缩模块负责 token 压力管理；memory 工具与 provider manager 支持持久化写入与跨会话搜索。 | `sources/hermes-agent/agent/context_compressor.py`；`sources/hermes-agent/tools/memory_tool.py`；`sources/hermes-agent/tools/session_search_tool.py` |

## 7) 可观测性（事件流、日志、进度 UI）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | 工具进度类型（Bash/MCP/TaskOutput 等）+ React/Ink 组件展示执行进度/成本。 | `sources/claude-code/src/types/tools.ts`；`sources/claude-code/src/components/AgentProgressLine.tsx`；`sources/claude-code/src/cost-tracker.ts` |
| OpenClaw | task registry 支持 observer event；TUI 有 tool execution 组件；transcript 工具用于记录与复盘。 | `sources/openclaw/src/tasks/task-registry.ts`（observer）；`sources/openclaw/src/tui/components/tool-execution.ts`；`sources/openclaw/src/utils/transcript-tools.ts` |
| Hermes Agent | CLI 输出为主：支持 verbose 包装、并行工具执行日志、tool progress callback；并内建 session recap/insights 文档体系。 | `sources/hermes-agent/run_agent.py`（`_wrap_verbose`、tool callbacks、并行日志）；`sources/hermes-agent/agent/insights.py` |

## 8) 安全与审批（allow/deny/ask、敏感工具 gating、密钥管理）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | 权限模式与规则类型集中建模；tool 调用可触发审批 UI；并包含权限追踪/分类器决策等机制。 | `sources/claude-code/src/types/permissions.ts`；`sources/claude-code/src/components/permissions/`；`sources/claude-code/src/utils/permissions/` |
| OpenClaw | 默认 deny 高风险工具；安全审计覆盖模型卫生、节点命令等；强调“控制面安全”。 | `sources/openclaw/src/security/dangerous-tools.ts`；`sources/openclaw/src/security/audit-*.ts` |
| Hermes Agent | pre-tool-call 插件 hook 可拦截阻断；审批/allowlist 工具独立实现；依赖/版本在 pyproject 里有供应链风险注释与 pin。 | `sources/hermes-agent/run_agent.py`（`get_pre_tool_call_block_message`）；`sources/hermes-agent/tools/approval.py`；`sources/hermes-agent/pyproject.toml`（依赖 pin 注释） |

## 9) 扩展性与工程化（插件/skills、版本兼容、测试）
| 项目 | 结论（简述） | 证据（代码/文档） |
|---|---|---|
| Claude Code | tools/agents/skills 均作为一级扩展面；Enter/Exit plan mode prompt 把“先澄清→计划→审批→执行”固化为流程。 | `sources/claude-code/src/tools/AgentTool/`；`sources/claude-code/src/tools/EnterPlanModeTool/prompt.ts` |
| OpenClaw | 强 plugin SDK 合同 + contracts 测试护栏；runtime seam/lazy-load 防止扩展污染 core；文档与 AGENTS 强约束架构边界。 | `sources/openclaw/src/plugins/contracts/`；`sources/openclaw/src/plugin-sdk/`；`sources/openclaw/AGENTS.md` |
| Hermes Agent | skills 系统是产品核心（自生成/自改进）；toolsets 作为配置化能力门控；同时提供多终端后端/网关/cron 等工程化能力。 | `sources/hermes-agent/tools/skill_manager_tool.py`；`sources/hermes-agent/toolsets.py`；`sources/hermes-agent/tools/environments/`；`sources/hermes-agent/tools/cronjob_tools.py` |

