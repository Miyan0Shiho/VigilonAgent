# Claude Code（claude-code）关键文件索引（聚焦：规划/执行机制）

> 代码根目录：`research/`

## 1) 入口（CLI / 初始化）

- `src/entrypoints/cli.tsx`：CLI 入口（命令行启动/解析后进入交互 UI）
- `src/main.tsx`：主 UI/主循环入口（REPL/Ink 渲染 + 交互状态驱动）
- `src/commands/`：所有命令（`/review`、`/commit`、`/ultraplan` 等）

## 2) Agent 主循环 / 会话驱动

- `src/hooks/useMainLoopModel.ts`：主循环选择的模型/策略（影响每轮调用与工具）
- `src/components/App.tsxh`、`src/components/Messages.tsx`：对话渲染与回合推进（与 tool-progress/UI 强绑定）
- `src/state/AppStateStore.ts`：会话级状态存储（任务、权限、工具、UI 状态等统一落点）

## 3) 计划模式（Plan Mode）与“先计划再执行”Gate

- `src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`：进入 Plan Mode 的工具实现
- `src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`：退出 Plan Mode + 请求用户审批 + 写回 plan 文件
- `src/tools/EnterPlanModeTool/prompt.ts`、`src/tools/ExitPlanModeTool/prompt.ts`：计划模式的系统级指令与交互约束
- `src/utils/plans.ts`：计划内容的恢复/持久化/快照（例如从 transcript 恢复、远程会话 snapshot）

## 4) 工具系统（Tool registry / ToolUseContext / MCP）

- `src/Tool.ts`：`ToolUseContext`（工具/权限/MCP/状态更新/中断等的枢纽上下文）
- `src/tools.ts`：工具集合的组装（包含 plan mode 相关工具挂载、feature flags 等）
- `src/services/mcp/`：MCP 连接、资源与工具注入（动态扩展工具面）
- `src/utils/messages/mappers.ts`：把消息/工具调用在“UI ↔ API payload”之间映射/规范化（包含对 ExitPlanMode 输入注入等）

## 5) 权限/审批与安全边界

- `src/types/permissions.ts`：权限模式、规则结构、结果类型
- `src/utils/permissions/`：权限判定与拒绝追踪（denial tracking/classifier decision 等）
- `src/components/permissions/`：权限弹窗/审批 UI（例如 ExitPlanMode 的审批 UI）

## 6) 任务模型与后台执行（Tasks）

- `src/Task.ts`：任务状态机与终态判断（taskId / status / type）
- `src/tasks/`：后台任务实现（含本地会话、远程 agent task、输出落盘 transcript 等）
  - `src/tasks/LocalMainSessionTask.ts`：典型“后台化主会话任务”的实现样例
  - `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx`：远程/代理执行时的计划审批、轮询与状态管理

## 7) 记忆/上下文治理

- `src/memdir/`：记忆索引/扫描/相关性检索（memory directory）
- `src/utils/fileHistory.ts`、`src/utils/fileStateCache.ts`：文件状态与历史（支持差分、重复读写去重、上下文压缩）
- `src/hooks/useAwaySummary.ts`、`src/hooks/useContextSuggestions.ts`：上下文压缩/建议注入类机制

## 8) 可观测性（日志/成本/进度）

- `src/cost-tracker.ts`、`src/costHook.ts`：成本与 token/预算追踪
- `src/types/tools.ts`：工具进度事件结构（Bash/MCP/TaskOutput 等）
- `src/components/AgentProgressLine.tsx`、`src/components/ToolUseLoader.tsx`：执行进度可视化

***

## 0) 10 分钟跳读路线（新增专题：安全/生态/交互/优化/发布/文档/隐私/评测）

> 目标：快速定位“除了 Agent 规划/执行机制之外”的高信号入口文件。

- 安全（Security）：
  1. `src/types/permissions.ts`
  2. `src/utils/permissions/permissions.ts`
  3. `src/utils/permissions/pathValidation.ts`
  4. `src/tools/BashTool/bashSecurity.ts`
- 扩展（Ecosystem）：
  1. `src/tools/SkillTool/SkillTool.ts`
  2. `src/tools/AgentTool/loadAgentsDir.ts`
  3. `src/tools/AgentTool/runAgent.ts`（agent 级 MCP server 生命周期）
  4. `src/services/mcp/*`
- 交互（UX）：
  1. `src/main.tsx`
  2. `src/components/permissions/*`
  3. `src/keybindings/loadUserBindings.ts`
  4. `src/ink/parse-keypress.ts`
- 优化（Optimizations）：
  1. `src/ink/optimizer.ts`
  2. `src/utils/fileStateCache.ts`
  3. `src/cost-tracker.ts`
- 发布（Release）：
  1. `src/cli/update.ts`
  2. `src/utils/autoUpdater.ts`
  3. `src/utils/releaseNotes.ts`
- 文档与 DX（DX+Docs）：
  1. `src/components/HelpV2/HelpV2.tsx`
  2. `src/setup.ts`
  3. `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts`
- 隐私与遥测（Privacy+Telemetry）：
  1. `src/services/analytics/index.ts`
  2. `src/utils/sanitization.ts`
  3. `src/utils/releaseNotes.ts`（essential-only 网络策略）
- 评测与基准（Evaluation+Benchmarks）：
  1. `src/tools/AgentTool/built-in/verificationAgent.ts`
  2. `src/utils/doctorDiagnostic.ts`
  3. `src/commands/insights.ts`

***

## 9) 安全与权限模型（Security）

专题文档：`research/topics/security.md`（Evidence IDs：SEC-CC-001 \~ SEC-CC-012）

关键文件（建议阅读顺序）：

1. `src/types/permissions.ts`（权限模式/决策类型）
2. `src/utils/permissions/permissions.ts`（规则匹配 + ask/deny 规则提取）
3. `src/utils/permissions/pathValidation.ts`（路径写入 gate）
4. `src/tools/BashTool/bashSecurity.ts`（Bash 安全规则常量）
5. `src/tools/BashTool/bashPermissions.ts`（Bash 权限决策）

***

## 10) 扩展与生态（Ecosystem）

专题文档：`research/topics/ecosystem.md`（Evidence IDs：ECO-CC-001 \~ ECO-CC-012）

关键文件（建议阅读顺序）：

1. `src/tools/SkillTool/SkillTool.ts`（MCP skills 过滤 + fork 执行 + remote skill feature gate）
2. `src/tools/AgentTool/loadAgentsDir.ts`（agent 定义 schema：含 mcpServers、requiredMcpServers）
3. `src/tools/AgentTool/runAgent.ts`（agent 级 MCP server 初始化与 cleanup；plugin-only customization）
4. `src/tools/AgentTool/forkSubagent.ts`（fork 扩展：prompt cache sharing）

***

## 11) 产品与交互（UX）

专题文档：`research/topics/ux.md`（Evidence IDs：UX-CC-001 \~ UX-CC-012）

关键文件（建议阅读顺序）：

1. `src/main.tsx`（主交互入口）
2. `src/types/tools.ts` + `src/components/AgentProgressLine.tsx`（执行反馈 UI）
3. `src/components/permissions/*`（审批交互）
4. `src/keybindings/validate.ts`（配置校验与告警格式化）

***

## 12) 优化细节（Optimizations）

专题文档：`research/topics/optimizations.md`（Evidence IDs：OPT-CC-001 \~ OPT-CC-012）

关键文件（建议阅读顺序）：

1. `src/ink/optimizer.ts`（渲染 patch 优化规则）
2. `src/utils/fileStateCache.ts`（LRU + size limit + merge/clone）
3. `src/cost-tracker.ts`（成本/用量/缓存 token 与 FPS 指标）

***

## 13) 版本/发布/分发（Release）

专题文档：`research/topics/release.md`（Evidence IDs：REL-CC-001 \~ REL-CC-012）

关键文件（建议阅读顺序）：

1. `src/cli/update.ts`（update 命令：installMethod 纠偏、doctor 前置、native updater、completion 重建）
2. `src/utils/autoUpdater.ts`（min/max version gate、lock、权限检查）
3. `src/utils/releaseNotes.ts`（changelog 缓存与 essential-only 策略）

***

## 14) 开发者体验与文档机制（DX+Docs）

专题文档：`research/topics/dx-docs.md`（Evidence IDs：DXD-CC-001 \~ DXD-CC-012）

关键文件（建议阅读顺序）：

1. `src/components/HelpV2/HelpV2.tsx`（Help 信息架构与快捷键）
2. `src/setup.ts`（Node gate、UDS inbox feature gate、终端恢复、worktree gate）
3. `src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts`（官方文档 map + guided browsing）

***

## 15) 隐私/遥测/数据治理（Privacy+Telemetry）

专题文档：`research/topics/privacy-telemetry.md`（Evidence IDs：PRI-CC-001 \~ PRI-CC-012）

关键文件（建议阅读顺序）：

1. `src/services/analytics/index.ts`（metadata 类型门禁、_PROTO_ PII 路由与剥离）
2. `src/utils/sanitization.ts`（隐藏字符/不可见注入防护）
3. `src/components/SentryErrorBoundary.ts`（错误边界：避免崩溃传播）

***

## 16) 评测与基准体系（Evaluation+Benchmarks）

专题文档：`research/topics/evaluation-benchmarks.md`（Evidence IDs：EVA-CC-001 \~ EVA-CC-012）

关键文件（建议阅读顺序）：

1. `src/tools/AgentTool/built-in/verificationAgent.ts`（验收 gate：对抗式验证模板）
2. `src/utils/doctorDiagnostic.ts`（环境诊断：安装形态/多安装冲突）
3. `src/commands/insights.ts`（会话洞察：结构化指标与汇总）

