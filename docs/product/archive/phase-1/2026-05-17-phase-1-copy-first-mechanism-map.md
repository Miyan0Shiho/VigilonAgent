# Phase 1：Copy-First Mechanism Map

- 日期：2026-05-17
- 状态：Phase 1 机制设计约束
- 目的：把“具体功能设计优先抄 Claude Code 源码实现”固化为开发规则，避免 Phase 1 在搜索、上下文、记忆和工具实现上重新摸索。

## 1. 核心原则

Phase 1 的具体功能设计遵循三步：

1. **先抄**：先阅读 Claude Code 源码拆解和对应源码链路，按它的运行时分层、状态流、权限边界和失败语义设计 Vigilon 的第一版。
2. **再改写**：只在适配 Vigilon 的个人本地 Solo Runtime、DeepSeek V4、现有代码结构时改写，不为了“显得原创”改写。
3. **再优化**：只有在 Claude Code baseline 已跑通、验收任务能稳定闭环后，才做搜索精度、上下文成本、记忆策略、UI 体验、多 Agent 等优化。

这不是代码逐字复制，而是机制级复刻：先复刻 Claude Code 已经验证过的 runtime 秩序，再换成 Vigilon 自己的实现。

## 2. 设计门槛

任何 Phase 1 的具体功能设计，在进入实现前必须回答：

- Claude Code 对应机制在哪里？
- 对应研究文档是哪几篇？
- Claude Code 的状态流是什么？
- Claude Code 的权限边界是什么？
- Claude Code 的失败语义是什么？
- Vigilon 第一版要完整保留哪些行为？
- 哪些行为因为 Solo Runtime 定位要删除或简化？
- 验收任务如何证明不是臆想实现？

如果不能回答这些问题，默认不进入实现。

## 3. 机制对照表

| Vigilon Phase 1 机制 | Claude Code 优先蓝本 | 研究入口 | 第一版保留 | 第一版简化或删除 |
| --- | --- | --- | --- | --- |
| 主 Agent Loop | `QueryEngine.submitMessage()`、`query.ts`、`processUserInput()` | `implementation/02-input-processing-and-command-dispatch.md`、`implementation/03-query-loop-and-recovery.md`、`implementation/01-08.md` | 用户输入预处理、模型循环、tool use、tool result 回填、错误回填、stop/recovery | 先不做 remote/headless/多入口完整产品面 |
| Tool Registry / ToolUseContext | `Tool.ts` 的 `ToolUseContext`，工具、MCP、hooks、状态更新的汇流点 | `mechanisms/02-tool-pool-and-tool-use-context.md`、`synthesis/01-04.md` | cwd、权限、配置、abort、UI 回调、session、MCP 工具统一进入上下文 | 不做企业 policySettings 的完整治理面 |
| 搜索链路 | `FileReadTool`、`GrepTool`、`GlobTool`、`WebSearchTool` 的分层 | `mechanisms/32-file-read-grep-and-websearch-runtime.md`、`mechanisms/94-greptool-ripgrep-arg-synthesis-ignore-merging-and-pagination-runtime.md`、`mechanisms/95-globtool-path-validation-result-capping-and-grep-ui-reuse-runtime.md` | 本地 read/search 优先；尊重 ignore；限制输出；区分模型可消费结果和 UI 展示；支持 pagination / head limit | WebSearch 先不作为 Must Have；不做 provider 生态和联网策略复杂化 |
| 文件读取 | `FileReadTool` 的多类型读取、路径保护、去重和补充块 | `mechanisms/91-fileread-image-pdf-dedup-and-supplemental-block-runtime.md`、`mechanisms/92-fileread-skill-triggers-memory-freshness-and-session-analytics-sidecars.md`、`mechanisms/93-fileread-path-guards-unc-screenshot-recovery-and-friendly-miss-runtime.md` | 路径校验、缺失友好错误、大文件截断、重复读取控制、transcript 记录 | Phase 1 先聚焦文本文件；图片/PDF/notebook 可后置 |
| 文件编辑 | `FileEditTool` 的 anchor edit、staleness、quote normalization、atomic write | `mechanisms/87-fileedit-tool-staleness-quote-normalization-and-atomic-write-runtime.md`、`mechanisms/03-file-editing-and-shell-execution.md` | 编辑前 stale 检查；局部替换失败必须可解释；原子写；diff；权限 gate | 先不做完整 LSP/VSCode sidecar |
| 文件写入 | `FileWriteTool` 的 full replacement / create-overwrite / diff runtime | `mechanisms/88-filewrite-tool-full-replacement-create-overwrite-and-diff-runtime.md` | read-before-write、完整替换与创建区分、diff、transcript、权限 gate | 先不做复杂编辑器集成 sidecar |
| Shell 执行 | `BashTool` 的 schema、sandbox、permission、path guard、transcript runtime | `mechanisms/70-bash-tool-sandbox-permission-and-transcript-runtime.md` | timeout、interrupt、危险命令审批、stdout/stderr 截断、路径保护、写操作识别、结果进入 transcript | 先不做完整 sandbox 矩阵和后台任务 host |
| Todo / TaskList | `TodoWriteTool` 与 session checklist / verification nudge | `mechanisms/72-todowrite-tool-session-checklist-and-verification-nudge-runtime.md`、`mechanisms/10-task-list-and-ownership.md` | todo 是任务状态，不是普通 markdown；最终报告要对齐 todo 和验证 | 不做公司项目管理系统 |
| Plan Mode | `EnterPlanModeTool`、`ExitPlanModeV2Tool`、permission mode `plan` | `mechanisms/73-enter-plan-mode-gating-transition-and-read-only-runtime.md`、`mechanisms/69-exit-plan-mode-and-partially-visible-review-artifact-operator-loops.md`、`product/04-plans-governance-and-enterprise.md` | Plan 是 runtime phase transition；计划阶段实现读写受限；退出计划必须有明确 handoff；用户确认后进入执行 | 不做 teammate/leader approval、remote approval、企业 review artifact |
| Transcript / Resume | `sessionStorage.ts` JSONL transcript、content replacement、compact boundary、subagent transcript | `implementation/04-session-storage-and-resume.md`、`implementation/01-08.md`、`product/03-workflows-and-modes.md` | transcript 是事实底座；消息、工具、结果、权限、错误、压缩边界都可恢复 | subagent/background transcript 可先预留结构，具体能力后置 |
| 上下文压缩链路 | `applyToolResultBudget()`、`recordContentReplacement()`、`snipCompactIfNeeded()`、`microcompact()`、`/compact` | `implementation/03-query-loop-and-recovery.md`、`commands/07-memory-skills-plan-tasks-and-compact.md`、`mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`、`architecture/39-compaction-warnings-boundaries-and-post-compact-feedback-surfaces.md` | 工具输出预算、内容替换记录、compact boundary、压缩后状态恢复；压缩是会话状态迁移，不只是摘要 | reactive compact、复杂 UI workbench、cache-sharing hooks 可后置 |
| 记忆链路 | memdir、session memory、post-compact restoration、skills memory | `mechanisms/12-memdir-and-session-memory.md`、`mechanisms/62-session-memory-prompt-template-waiting-and-manual-summary-runtime.md`、`mechanisms/64-session-memory-away-summary-and-skillify-consumer-runtime.md`、`mechanisms/07-skills-and-memory.md` | Phase 1 先保留 session memory / summary / resume 所需记忆；长期记忆必须可编辑、可审计 | 不做自动梦境、复杂长期记忆治理、跨设备记忆同步 |
| 权限与 Hooks | permission runtime、hooks、classifier、dialog pipeline、policy settings | `mechanisms/04-permissions-hooks-and-policy.md`、`mechanisms/23-permission-runtime-hooks-classifier-and-dialog-pipeline.md`、`mechanisms/40-policy-settings-runtime-governance-across-env-hooks-permissions-mcp-and-plugins.md` | 本地 permission mode、allow/deny、PreToolUse hook、风险动作 gate | 不做 managed enterprise policy、组织级下发、marketplace governance |
| MCP | 动态工具合成、resource list/read、binary persistence | `mechanisms/05-mcp-integration.md`、`mechanisms/84-mcp-tool-dynamic-tool-synthesis-progress-elicitation-and-result-runtime.md`、`mechanisms/77-mcp-resource-listing-reading-and-binary-persistence-runtime.md` | 本地 MCP 配置、工具加载、调用、错误展示、资源读取的最小闭环 | 不做 OAuth、远程 marketplace、企业 server 管理 |
| Skills | skill loading、frontmatter、tool/path/model/hook 约束 | `mechanisms/11-skills-runtime-and-loading.md`、`mechanisms/44-dynamic-skills-model-only-skills-and-host-safe-command-gates.md`、`mechanisms/67-plugin-skill-trust-boundaries-hooks-and-shell-runtime.md` | 本地 skills 读取、显式注入、工具边界声明 | 不做 skill 商店、插件市场、复杂信任分发 |
| Subagents / AgentTool | `AgentTool` definition loader、prompt router、spawn host、result protocol | `mechanisms/51-agent-definitions-selection-spawn-and-handoff-runtime.md`、`mechanisms/53-local-agent-task-retention-panel-and-notification-runtime.md`、`mechanisms/06-tasks-subagents-and-background.md` | Phase 1 只要求主 runtime 预留 transcript/task 边界；后续做 subagent 时必须按 AgentTool 主链复刻 | 不作为 Phase 1 首轮 Must Have；不做 remote/teammate/worktree host |

## 4. 高风险链路拆解要求

下面三条链路是 Phase 1 最容易走偏的地方。它们不能靠“简单实现一个版本”通过。

### 4.1 搜索链路

Claude Code 的搜索不是“grep 一下返回文本”，而是：

- `GlobTool` 负责候选路径枚举和路径边界。
- `GrepTool` 负责 ripgrep 参数合成、ignore 合并、输出模式、分页和截断。
- `FileReadTool` 负责真正进入上下文的文件内容读取、去重、路径保护和友好错误。
- UI 展示和模型输入不是同一个对象。

Vigilon 第一版必须保持这条分层。后续优化搜索质量时，也应先优化这条链路里的 ranking、pagination、context packing，而不是另起一套脱离工具上下文的搜索系统。

### 4.2 上下文压缩链路

Claude Code 的 compact 不是“让模型总结一下历史”，而是会话状态迁移：

- 工具结果先有预算控制。
- 超预算内容被替换时要记录 replacement。
- compact 后有明确 boundary。
- resume 必须知道哪些内容是原始 transcript，哪些内容是 compact 后摘要。
- 压缩后要恢复必要能力附件和状态。

Vigilon 第一版可以简化压缩策略，但不能省掉 replacement / boundary / resume consistency 这些语义。

### 4.3 记忆链路

Claude Code 的记忆不是一块永久 prompt 文本，而是 session memory、memdir、skills memory、compact restoration 等多层机制。

Vigilon Phase 1 不急着做复杂长期记忆，但必须先把 session memory 和 transcript/resume/compact 的关系做对。长期记忆后续只能建立在可编辑、可审计、可删除的本地文件或结构化存储上，不能在 Phase 1 里做黑盒自动记忆。

## 5. 实现顺序调整

Phase 1 的实现顺序应从“功能名列表”调整为“Claude Code 机制链路复刻”：

1. `processUserInput -> QueryEngine -> query loop -> tool call -> tool result` 主链。
2. `ToolUseContext -> permission gate -> transcript` 横切链路。
3. `Read / Grep / Glob` 搜索与上下文入口。
4. `Edit / Write / Bash` 真实执行与风险控制。
5. `Todo / PlanMode / ResultReport` 任务秩序。
6. `sessionStorage -> resume -> compact boundary` 可恢复链路。
7. `local settings -> project config -> hooks -> MCP -> skills` 轻量扩展。

Subagents、background tasks、worktree、remote、web research、长期记忆、Agent 社会都必须等这条主链稳定后再进入。

## 6. 验收方式

每个机制的验收都必须同时包含三层：

- **Claude Code 对照**：说明参考了哪个源码机制和研究文档。
- **Vigilon 行为**：展示当前实现如何保留该机制的状态流、权限边界和失败语义。
- **真实任务验证**：用一个本地仓库任务证明它能在主 Agent Loop 中工作，而不是孤立单元测试。

Phase 1 的目标不是发明一个“看起来也能用”的 agent，而是先得到一个 Claude Code core runtime 的个人本地版本。
