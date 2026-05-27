# Phase 2：Claude Code Core Capability Alignment

- 日期：2026-05-18
- 状态：**REOPENED / NOT CLOSED** (2026-05-19 重新打开；此前“核心能力已补齐”的表述只证明模块和脚本存在，不能证明深层能力已经对齐 Claude Code)
- 依据：`docs/product/roadmaps/2026-05-18-p2-p3-execution-plan.md`
- 覆盖审计：`docs/product/2026-05-18-phase-2-claude-code-coverage-audit.md`
- 前提：Phase 1 Solo Runtime Core Parity 已完成，`packages/runtime` 是主开发入口，`packages/claude-code` 和 `docs/claudecode-research/` 是 copy-first 参考材料。
- 目标：把 Vigilon 从“可运行的 Solo Runtime”推进到“机制、行为、失败语义和上下文治理尽可能接近 Claude Code 核心能力”的阶段。

## 0. 2026-05-19 重新打开说明

Phase 2 当前不能再被称为 closed。原因不是“没有这些功能”，而是很多功能仍停留在表层或最小实现：

- 有 `Read/Grep/Glob/LSP/ToolSearch/Compact/AskUser/TaskStop/Notebook/Config` 等入口，不等于已经具备 Claude Code 对应机制的深层优势。
- 有 scripted acceptance，不等于真实复杂任务中能稳定建立代码理解、恢复失败、控制上下文污染并留下可接手日志。
- 有 request/transcript 事件，不等于已经做到 Claude Code 式的 prompt cache/request stability、deferred capability delta、post-compact restoration。
- 有 TUI 事件展示，不等于 Phase 3 已经获得 Claude Code 的信息层级、等待感、工具进度感和可操作性。

从 2026-05-19 起，Phase 2 的完成口径恢复为本文件原本定义的门槛：必须证明深层机制对齐，而不是证明功能名存在。此前的 closed 文档只能作为阶段性实现记录，不能作为阶段完成证据。

## 1. 阶段定义

Phase 2 不再解决“有没有主循环、工具、权限、transcript、resume”这类地基问题。Phase 1 已经证明主链可以跑通。

Phase 2 的定义是：

**Claude Code Core Capability Alignment：对齐 Claude Code 核心能力的行为语义，而不是继续堆模块。**

它的含义是：

- LLM transport、工具池、搜索、读取、结构化代码智能、编辑、写入、Bash、WebFetch、Notebook、AskUser、TaskStop、Todo、Plan、Transcript、Resume、Compact、Memory、Skill、MCP、ToolSearch、Hook、Subagent 都要进入机制级对齐或显式延期。
- 对齐重点是状态流、权限边界、失败语义、上下文进入方式、恢复一致性和可接手性。
- 每个能力都必须能在真实仓库任务中体现，不接受只存在于单元测试或 demo 命令里。
- 继续保持个人开发者 Solo Runtime 边界，不进入企业化产品系统。
- 不做 Vigilon 独有 Agent 社会，不做 Codex 级桌面自动化，不做 daily-driver 产品外壳。

Phase 2 的判断标准不是“功能清单完成了多少”，而是：

1. 模型是否能用更少、更准的搜索和读取建立代码理解。
2. 模型是否能用 LSP / structural code intelligence 处理 definition、references、symbols、diagnostics，而不只依赖文本 grep。
3. 工具失败后是否能继续推进任务，而不是打断运行时。
4. 权限、计划、todo、验证和最终报告是否处在同一条 runtime 状态链里。
5. transcript / resume / compact 后，任务事实、工具发现状态、MCP instructions、计划和 memory 是否仍然一致。
6. API 请求、工具 schema、prompt cache 和 context budget 是否稳定可解释。
7. 后续 Agent 是否能从产物和记录中快速接手。

## 2. Copy-First 机制设计要求

Phase 2 的 copy-first 要求比 Phase 1 更严格。

任何 Phase 2 具体功能设计都必须先回答：

1. Claude Code 源码或 `docs/claudecode-research/` 中对应机制是什么？
2. Claude Code 的状态流是什么？
3. Claude Code 的工具输入、输出、错误和 transcript 记录是什么？
4. Claude Code 的权限边界在哪里？
5. Vigilon 哪些部分必须完整复刻，哪些部分因为 Solo Runtime 可以简化？
6. 简化后是否仍然保留任务完成能力、恢复能力和审计能力？

Phase 2 不接受“自己摸索一个差不多”的搜索、压缩、记忆、工具安全、MCP、Skill 或 Subagent 设计。

Phase 2 也不接受把 Claude Code 的机制改名后偷换掉。例如：

- Claude Code 研究文档中没有独立命名的 `ASTTool` 原生机制；对应能力是 `LSPTool`、`documentSymbol`、`workspace/symbol`、definition、references、implementation、call hierarchy 和 passive diagnostics。
- Vigilon 可以用 AST / tree-sitter / ts-morph 做本地 fallback 或索引加速，但必须对齐 Claude Code 的 LSP/code-intelligence 语义：只读、权限检查、ignore 过滤、结果清洗、预算、transcript、deferred loading 和 diagnostics attachment。
- `/compact` 不是摘要命令，而是 context-management 状态迁移协议。
- ToolSearch 不是普通搜索工具，而是 deferred tool schema materialization 和恢复枢纽。

允许改写和优化，但顺序必须是：

1. 先抄机制。
2. 再完整改写为 Vigilon runtime。
3. 最后再做优化、合并和产品化。

## 3. Must Align：必须机制级对齐

这些能力是 Phase 2 的核心。缺少任意一类，Phase 2 都不能算完成。

| 能力域 | Claude Code 机制对齐点 | Vigilon Phase 2 验收标准 |
| --- | --- | --- |
| LLM Transport / API Runtime | `claude.ts` 不是薄 SDK adapter；它负责 request params、tool schema 编译、message normalization、streaming block accumulation、retry/fallback、context overflow、usage 和 tracing | DeepSeek V4 请求层必须有稳定 tool schema、streaming/tool_use 组包、错误分类、重试/降级、context overflow 处理和 transcript 事件 |
| Tool Pool / ToolUseContext | built-in tools contiguous prefix、permission-filtered tool pool、MCP 合并、ToolUseContext 横切会话状态 | 工具池顺序和 schema 稳定；所有工具通过统一上下文拿 cwd、权限、消息、read cache、hook、MCP、settings、abort signal |
| Deferred Tool Discovery / ToolSearch | deferred tools、`tool_reference`、`deferred_tools_delta`、`mcp_instructions_delta`、discovered set、schema-not-sent recovery | 大工具池和 MCP 工具不直接污染主 prompt；模型能按需加载工具 schema；compact 后 discovered tools 不丢；schema 未发送时有可恢复提示 |
| Prompt Cache / Request Stability | prompt cache break detection 跟踪 system/tools/cache_control/model/betas/effort/fast mode 等变化，并用 usage 做二阶段判定 | 请求前后能审计工具 schema、system prompt、cache policy 和模型参数变化；context 优化不能变成不可解释的 cache churn |
| Search / Context Ingress | FileRead / Grep / Glob 不是普通工具，而是上下文入口；要有路径保护、ignore 合并、结果预算、重复读取控制和友好错误 | 陌生仓库中能定位跨文件实现；搜索结果数量可控；大结果不会污染上下文；读过的文件不会反复塞入 model context |
| File Read Runtime | read state、路径 guard、二进制/图片/PDF/缺失文件处理、内容截断、补充块和重复读取语义 | 读取行为可预测；错误可解释；大文件有预算；transcript 中能区分原始读取、摘要和替换记录 |
| Grep / Glob Runtime | ripgrep 参数合成、ignore 规则合并、结果 cap、分页、路径校验、UI 展示和 model 数据分离 | 模型能用少量搜索建立代码理解；搜索失败和无结果有可恢复解释；默认不搜索噪音目录 |
| LSP / Structural Code Intelligence | `LSPTool` 延迟加载、runtime health、只读权限、`didOpen` side effect、definition/references/symbols/call hierarchy、结果清洗、被动 diagnostics attachment | 支持 go-to-definition、references、symbols 或等价结构化代码智能；LSP 不可用时可降级；AST fallback 不能绕过权限、ignore、预算和 transcript |
| Edit / Write Safety | stale check、anchor mismatch、quote normalization、atomic write、read-before-write、diff metadata | 并发修改不会被静默覆盖；写入前后可审计；失败原因进入模型循环；用户能看到可信 diff |
| Notebook Read / Edit | `.ipynb` 不是普通 JSON；读取编译成 cell IR，编辑按 cell id / cell-N、insert/replace/delete 和 large-output guard 运行 | 能结构化读取 notebook；能安全编辑 cell；大 output 不污染上下文；未读或 stale notebook 不允许写 |
| Bash Runtime | sandbox / permission / timeout / interrupt / stdout-stderr budget / dangerous command classifier | 长命令不会挂死；危险命令进权限 gate；大输出被预算化；命令失败能继续进入修复循环 |
| TaskStop / Abort Control | `TaskStopTool`、`stopTask()`、task host kill、SDK bookend、shell/agent 不同终止语义 | 长任务和后台任务可停止；stop 走共享 kill path；不会丢终态事件；shell kill 噪音被控制 |
| WebFetch Runtime | domain gate、redirect policy、preflight/cache、markdown transform、secondary model summary、domain permission | 公共网页抓取有域名权限和 redirect 边界；大页面先摘要；失败和 egress block 可解释 |
| AskUser / Operator Clarification | `AskUserQuestion` 是 operator loop：问卷 DSL、preview、permission queue、continuation signal | 模型能在信息不足时结构化询问用户；回答作为 tool_result 回流；不会伪造成普通文本对话 |
| Plan Mode | EnterPlanMode / ExitPlanMode 是 runtime phase transition，不只是提示词格式 | 高风险任务能进入 plan；plan 阶段写操作受限；用户拒绝计划后不会继续执行 |
| Todo / Task Semantics | TodoWrite 是 session checklist 和 verification nudge，不是普通 markdown list | todo 状态能驱动执行与最终报告；结束前检查未完成项、验证证据和残余风险 |
| Transcript / Resume | session storage 是任务事实底座，记录消息、工具调用、工具结果、权限决定、错误、计划和最终报告 | 中断后能恢复同一任务；后续 Agent 能根据 transcript 接手；记录能解释 compact 和 content replacement |
| Compact / Context Management | session-memory -> reactive -> legacy 三路径、autocompact circuit breaker、API invariant 修复、post-compact cleanup、capability delta replay | compact 后任务状态、权限、todo、计划、验证笔记、memory、MCP instructions、deferred tools、discovered tools 仍一致 |
| Memory Runtime | session memory、manual summary、memory freshness、memory injection boundary | session memory 帮助 resume 和 compact；记忆可查看、可编辑、可删除；不黑盒写入长期记忆 |
| Skill Runtime | skill loading、frontmatter、allowed tools、path triggers、skill context injection | 本地 skill 能进入同一条 tool loop；skill 不能越过 allowed tools；触发和注入有来源 |
| MCP Runtime | dynamic tool synthesis、resource list/read、progress/result/error surface、binary persistence boundary | 本地 MCP server 可稳定暴露工具；MCP 失败进入模型上下文；resource 读取有权限和预算边界 |
| Hook / Permission Pipeline | PreToolUse hook、permission classifier、dialog pipeline、block/allow/ask 结果入 transcript | hook 能阻止工具执行；权限决定可审计；工具不能绕过统一 gate |
| Config / Runtime Mutation | `ConfigTool` 是受限 settings tool，走 supported registry、source routing、validate/coerce、disk write、immediate AppState effect | P2 至少支持本地配置可审计 mutation，或明确保持 CLI/config-file only；不能让模型任意改 settings |
| Result Report / Handoff | final response 对齐 todo、验证、改动、未验证项、风险和下一步 | 每次真实任务结束都留下可接手结果，不只说“完成了” |
| Subagent / AgentTool Foundation | agent definition、selection、spawn、handoff、subagent transcript、result protocol | 主 Agent 能把有限子任务交给同步 local subagent；子任务结果结构化返回；权限边界可解释 |

## 4. Solo Simplified：必须保留，但不能企业化

Phase 2 仍然模拟严肃公司的工程纪律，但不模拟公司组织系统。

| 机制 | Phase 2 简化边界 | 不做什么 |
| --- | --- | --- |
| Settings / Project Config | 保留本机和项目级配置，覆盖模型、权限默认值、工具开关、ignore、默认命令 | 不做组织级策略中心 |
| Permission Modes | 保留少数清晰本地模式，并让工具、hook、MCP、skill 统一走 gate | 不做企业权限矩阵 |
| LSP / AST | 优先复刻 LSP/code-intelligence runtime；AST/tree-sitter 只能作为本地 fallback 或加速层 | 不把 AST 另起一套绕过权限和 transcript 的搜索系统 |
| Hooks | 保留本地 PreToolUse 规则和脚本拦截 | 不做 hook marketplace 或远程策略下发 |
| MCP | 支持本地 server、tool、resource、错误面和 transcript | 不做 OAuth、企业 server 管理或 marketplace |
| Skills | 支持本地 skill、allowed tools、触发规则、上下文注入 | 不做 skill 商店、发布流和复杂信任治理 |
| Memory | 保留 session memory 和可编辑文件记忆 | 不做黑盒自动长期记忆或云同步 |
| WebFetch | 支持公共网页读取、域名权限、redirect 边界和摘要 | 不做登录态浏览器替代品 |
| Notebook | 支持 `.ipynb` cell 级读写和大输出保护 | 不做完整 Jupyter UI |
| AskUser | 支持轻量结构化澄清问题 | 不做复杂表单系统 |
| Subagent | 保留同步 local subagent 和结构化 handoff | 不做 teammate、swarm、remote agent、worktree host |
| Observability | 保留 transcript、验证摘要、失败原因和可接手记录 | 不做商业 telemetry、growth analytics 或企业审计报表 |

## 5. Explicitly Excluded：Phase 2 明确不做

Phase 2 要克制。它只补齐 Claude Code 核心能力，不提前进入产品外壳或差异化系统。

| 排除项 | 排除原因 |
| --- | --- |
| Daily-driver TUI / 完整交互产品化 | 属于 Phase 3，Phase 2 只确保核心能力可靠 |
| Codex 级桌面操作、本地应用自动化、长期自动任务 | 属于 Phase 4，当前会稀释 Claude Code core 对齐 |
| Vigilon Agent 社会、多 Agent 协作组织、角色社会 | 属于 Phase 5，必须建立在 P2 可治理能力之上 |
| Remote / Bridge | 当前个人开发者本地 runtime 不需要 |
| Multi-user / Enterprise / Admin | 不服务个人开发者任务闭环 |
| Billing / License / Subscription | 非商业化阶段无意义 |
| Marketplace | MCP / skills 先本地加载，不做生态分发 |
| 商业 telemetry / growth analytics | 不提高任务完成率，增加噪音和风险 |
| 完整 worktree host / background task 产品面 | Phase 2 只做同步 local subagent foundation |
| 品牌装饰、companion 人设、趣味化外壳 | 不提高核心任务解决能力 |

## 6. Phase 2 验收任务

Phase 2 的验收必须是真实任务链路，而不是模块存在性检查。

标准验收场景：

1. 给 Vigilon 一个陌生 TypeScript / JavaScript 仓库。
2. 用户提出一个跨文件 bugfix 或小功能任务。
3. Vigilon 能用 Grep / Glob / Read 建立代码理解，且搜索次数和上下文污染可控。
4. Vigilon 能用 LSP / structural code intelligence 找 definition、references、symbols 或 diagnostics；如果没有 LSP server，能解释降级路径。
5. Vigilon 能进入 plan mode，并在计划阶段限制写操作。
6. Vigilon 能维护 todo，并让 todo 与执行和最终报告对齐。
7. Vigilon 能编辑或写入文件，并在 stale、anchor mismatch、并发修改时给出可恢复错误。
8. Vigilon 能运行 Bash 验证命令，处理 timeout、interrupt、危险命令审批、大输出预算和 task stop。
9. Vigilon 能在需要外部资料时通过 WebFetch 读取公共网页，并遵守域名权限、redirect 和摘要边界。
10. Vigilon 能结构化读取和编辑 `.ipynb`，大 output 不污染上下文。
11. Vigilon 能在信息不足时通过 AskUser 结构化询问用户，并把回答作为 tool result 继续任务。
12. 所有消息、工具调用、工具结果、权限决定、hook 结果、错误、计划、todo、验证进入 transcript。
13. 中断后能 resume 并继续同一任务。
14. compact 后能恢复任务状态、权限、todo、计划、验证笔记、memory、MCP instructions、deferred tools 和 discovered tools。
15. 一个本地 skill、一个本地 MCP 工具和一个 deferred tool 能进入同一条 tool loop。
16. 一个同步 local subagent 能完成有限子任务，并把结构化结果交回主 Agent。
17. 请求层能解释 tool schema 变化、context overflow、prompt cache break 或等价请求稳定性事件。
18. 最终报告说明改动、验证、未验证项、剩余风险和 todo 状态。

如果这条链路稳定，Phase 2 才算成立。

## 7. 开发切片

### P2.0 LLM Transport And Tool Schema Stability

- 对齐 API request / streaming / retry / fallback / message normalization / tool schema 编译。
- 重点补 DeepSeek V4 tool calling 的 streaming block accumulation、tool_use pairing、context overflow、retry 和错误分类。
- 验收同一真实任务中能解释模型请求、工具 schema、失败恢复和 transcript 事件。

### P2.1 Search, Context Ingress And Code Intelligence

- 对齐 FileRead / Grep / Glob 的上下文入口语义。
- 对齐 LSP/code-intelligence runtime，而不是只做文本搜索。
- 重点补路径保护、ignore 合并、重复读取控制、结果预算、分页、友好错误、definition/references/symbols/diagnostics。
- AST/tree-sitter/ts-morph 可以作为 Vigilon fallback，但必须挂在同一套权限、预算、ignore、transcript 和 compact 语义下。
- 验收一个陌生仓库跨文件定位任务，并至少使用一次结构化代码智能或清晰降级。

### P2.2 Edit / Write / Bash Safety

- 对齐 FileEdit / FileWrite / Bash / TaskStop 的可信执行层。
- 重点补 stale check、atomic write、diff metadata、timeout、interrupt、危险命令分类、输出预算和共享 stop path。
- 验收并发修改、危险命令、大输出、长任务停止和工具失败恢复。

### P2.3 WebFetch / Notebook / AskUser Tool Parity

- 对齐 WebFetch 的 domain gate、redirect policy、cache、markdown transform 和 secondary summarization。
- 对齐 Notebook 的 cell IR、cell id、large-output guard 和 cell-level edit。
- 对齐 AskUserQuestion 的 operator loop、结构化问题、permission queue 和 continuation signal。
- 验收一次公开网页读取、一次 notebook cell 读写、一次结构化用户澄清。

### P2.4 Plan Mode And Todo Semantics

- 对齐 EnterPlanMode / ExitPlanMode / TodoWrite 的 runtime 状态语义。
- 重点让 plan、todo、权限、验证和 final report 进入同一条状态链。
- 验收计划拒绝、计划批准、todo 更新和最终报告一致性。

### P2.5 Transcript / Resume / Compact / Context Management

- 对齐 session storage、content replacement、compact boundary、session-memory compact、reactive compact、legacy compact、autocompact circuit breaker 和 post-compact restoration。
- 重点让 transcript 成为 resume、compact、人类审计、后续 Agent 接手的事实底座。
- 重点恢复 deferred tools、MCP instructions、agent listing、memory、plan attachment 和 compact boundary metadata。
- 验收中断恢复、manual compact、auto compact 和 compact 后状态一致。

### P2.6 Memory Runtime

- 对齐 session memory、manual summary、memory freshness 和 injection boundary。
- 重点建立可查看、可编辑、可删除、来源清晰的 session memory。
- 验收 memory 对 resume / compact 有帮助，但不会黑盒写入长期记忆。

### P2.7 ToolSearch / Skill / MCP / Hook Runtime

- 对齐 ToolSearch、deferred tools delta、MCP instructions delta、skill loading、MCP dynamic tool synthesis、resource list/read 和 PreToolUse hook。
- 重点让扩展机制进入同一条 tool loop、permission gate 和 transcript。
- 验收本地 skill、本地 MCP tool、deferred tool、本地 hook 同时工作且失败可恢复。

### P2.8 Prompt Cache / Request Stability Audit

- 对齐 prompt cache break detection 的思想：request 前记录 system/tools/cache/model/betas/effort 等快照，response 后用 usage 或本地指标判断异常变化。
- DeepSeek 不一定有 Anthropic prompt cache，但 Vigilon 必须有等价的 request stability audit，能解释为什么 context 成本或 schema 面突然变化。
- 验收一次工具池变化、一次 compact、一次 MCP late-connect 后的请求稳定性报告。

### P2.9 Config / Runtime Mutation

- 对齐 ConfigTool 的受限 settings registry、source routing、validate/coerce、disk write 和 immediate runtime effect。
- P2 可以简化为本地 settings tool 或 CLI/config-file command，但必须可审计、可回滚、可进入 transcript。
- 验收模型不能任意改 settings，只能改白名单键。

### P2.10 Subagent / AgentTool Foundation

- 对齐 AgentTool 的最小核心语义。
- 重点做 agent definition、sync local spawn、subagent transcript boundary 和 result protocol。
- 验收主 Agent 可委托一个明确、有限、可回收的子任务。

## 8. 实现准则

任何 Phase 2 开发任务都必须在实现前写清楚：

- 它属于 P2.0 到 P2.10 的哪个切片？
- 它对照的 Claude Code 源码机制和研究文档是什么？
- 它复刻的是状态流、权限边界、失败语义、上下文入口、恢复一致性，还是 handoff 语义？
- 它的 tool input / output / error / transcript event 如何定义？
- 它是否尊重统一 permission gate？
- 它是否会影响 resume 或 compact？
- 它是否影响 tool schema、deferred tool discovery、MCP instructions、prompt cache 或 request stability？
- 它失败时模型、人类和后续 Agent 分别能看到什么？
- 它是否有真实任务验收，而不是只有单元测试？
- 它是否仍然遵守 Solo Runtime 边界，没有提前进入 P3、P4 或 P5？

如果一个功能无法回答这些问题，默认不进入 Phase 2。
