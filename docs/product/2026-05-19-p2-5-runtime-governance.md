# P2.5 Runtime Governance

- 日期：2026-05-19
- 状态：**OPEN / NOT CLOSED**
- 范围：`packages/runtime` 为实现主线，`packages/tui` 只作为内部验证面，`packages/claude-code` 与 `docs/claudecode-research/` 作为 copy-first 参考。
- 目标：把 Vigilon 从“有工具、有 transcript、有 scripted probes”推进到“长任务能被记住、压缩、安全执行，并能托管多个执行单元”的 runtime governance 阶段。

## 1. 为什么 P2.5 独立出来

P2.5 不是搜索链路优化。搜索链路已经有足够的基础工具和边界探针，当前更大的风险在四条治理链：

1. **Memory Runtime**：任务怎样形成可恢复、可审计、不过度污染 prompt 的记忆。
2. **Context / Compact Runtime**：长上下文怎样被压缩、恢复和继续执行，而不是简单摘要。
3. **Safety / Sandbox Runtime**：模型怎样安全使用 Bash、文件写入、后台任务和扩展工具。
4. **Subagent / Task Host Runtime**：主 Agent 怎样把工作交给子执行单元，并保留权限、transcript、stop/resume 和 handoff 语义。

此前 Phase 2 的 closure 文档只能证明若干入口和 scripted acceptance 存在，不能证明这些治理链已经接近 Claude Code 的深层机制。因此 P2.5 的完成口径必须从“功能存在”改为“机制闭环可复查”。

## 2. 当前真实状态

### Memory Runtime

当前 Vigilon 有 `sessionMemory.ts`：

- 能写 `.memory.md`。
- 能记录 `sessionId`、`generatedAt`、`sourceEventCount`。
- 能写 `.memory.manifest.json`，记录 memory path、transcript path、source event count、last summarized event。
- manifest 会记录 typed session-memory sections 和 semantic fingerprint。
- CLI 已有 `memory status/view/write/edit/delete/refresh`。
- `memory refresh --background` 会通过 session-memory extraction worker 排队刷新 session memory，并写 `.memory.extraction.json` sidecar，记录 queued/running/completed/failed/skipped、source event pointer、memory/manifest path 和输出摘要。
- resume 时能注入 `<vigilon_session_memory>`。
- `inspectSessionMemory()` 会基于 event count 和 typed semantic anchors 输出 fresh/stale、semantic drift 和 drift caveat；传入 `groundingModel` 时，会把 session memory 与当前 transcript evidence 交给模型校验，并返回 `groundingValidation`。
- stale memory 注入时会带 `<vigilon_memory_drift_caveat>`。
- `validateSessionMemoryGrounding()` 返回 `vigilon.session-memory-grounding` metadata，记录 status、modelId、source/current event count、semantic drift status、evidence event count、supported/contradicted/missing claims 和 reason。
- `memory validate <session-id> [--refresh]` 提供独立 provider/model-grounded readiness gate：可刷新 session memory、执行 grounding validation，并输出 `ready`、`blockingReasons`、`validationRequired` 和 grounding evidence。
- `projectMemory.ts` 提供手动长期记忆 promotion：`user` / `feedback` / `project` / `reference` 四类 taxonomy。
- 长期记忆写入 `.vigilon/memory/MEMORY.md`、`topics/<type>/<topic>.md` 和 `memory.manifest.json`。
- promotion policy 会拒绝 secrets、临时工具噪音和可从仓库直接推导的代码结构；CLI 通过 `memory promote` 手动触发，不自动写长期记忆。

这已经把 session memory 从单个摘要文件推进到可审计的 session-memory store，但还不是完整记忆系统。缺口：

- 长期记忆 promotion policy 已有第一版本地规则，但 promotion 本身还没有 provider/model-grounded validation。
- session memory 已有 model-grounded validation contract，并能进入 compact readiness；live provider-backed validation 是显式门禁/操作员选择，不是默认本地 probe。
- 没有 memory -> skill / agent 的整理闭环。

### Context / Compact Runtime

当前 Vigilon 有：

- `compact-boundary`。
- reactive tail 保留。
- assistant tool-call group split guard。
- content replacement。
- capability replay 文本注入。
- auto compact 的 latest-boundary 熔断。
- compact route metadata：记录 session-memory / reactive / legacy 策略、fallback 和触发来源。
- auto compact gate：能阻止 compact/session_memory 来源递归触发，并能按连续失败计数熔断。
- token-pressure auto compact evaluation：基于显式 provider/model context-window budget metadata 计算 effective input budget，再估算 compact boundary 之后的 context token pressure，并在超过预算比例时优先触发 auto compact。
- provider input-token preflight：当当前 transcript 还没有 provider `llm-response` usage anchor，runtime 可通过 `ModelClient.countInputTokens()` 对即将发送的 model-visible messages/tools 做 provider preflight，并把 provider 返回的 input tokens 写入 compact pressure metadata。
- provider usage anchored token pressure：如果 transcript 中已有 provider 返回的 `llm-response` usage，compact token pressure 会把最近一次 provider usage 作为 context token 锚点，只对 usage 之后新增事件做 delta 估算，并在 metadata 中记录 requestId、responseEventIndex、base input/output/cache tokens、delta chars 和 delta estimated tokens。
- preserved segment metadata：记录 requested / adjusted split index、preserved event count、API invariant adjustment，并为 head / anchor / tail 事件记录 deterministic event fingerprint ref。
- post-compact runtime state registry：compact 后的 context-window rebuild、content-replacement window recalculation、capability replay、LSP open-file cache clear、read-before-write safety preserve 和 compact-state discard 都通过 registry 声明 scope、policy、action 和计数后统一执行。
- manual compact CLI：`vigilon compact <session-id>` 会先检查 session memory readiness，必要时通过 session-memory extraction worker 刷新并等待 terminal status，再写 compact boundary，并返回 route、preserved segment、cleanup、memory freshness 和 extraction readiness metadata。
- `vigilon compact <session-id> --validate-memory` 会把 grounding status 升级为 session-memory route 门禁：当 provider/model validation 返回 contradicted / unknown 时拒绝写 compact boundary，而不是把 unsupported memory 当 summary 继续压缩。
- TUI `/compact <index|session-id> [--validate-memory] ...` 复用同一 runtime compact CLI 路径，并显示 memory readiness、grounding status、token pressure、route、cleanup 和 transcript path。

但它还不是 Claude Code 式 context-management runtime。缺口：

- token/context pressure 已有 provider/model context-window budget metadata、reserved output/system/tool/safety budget、provider input-token preflight、provider usage anchor 和 transcript metadata；provider preflight 失败时会显式回退到 runtime heuristic 并记录失败原因。DeepSeek 当前没有 dedicated count-tokens endpoint，后续缺口是 offline tokenizer parity / tokenizer artifact 治理。
- auto compact failure counter 和 recursion/query-source gates 已有纯 runtime evaluation；还没有跨 turn 持久化失败计数。
- runtime cache/state registry 已覆盖当前 compact state classes；后续新增 runtime cache 必须显式注册 compact policy，不能绕过 registry。
- preserved segment metadata 已有 head / anchor / tail deterministic event refs；完整 transcript-wide event ID 体系仍未完成。
- 没有 compact 后 capability delta / MCP instruction / agent listing 的正式恢复协议。

### Safety / Sandbox Runtime

当前 Vigilon 有：

- `read-only` / `ask` / `accept-edits` / `bypass-local` permission modes。
- Bash 粗粒度 risk classification。
- timeout、输出截断、background bash task。
- PreToolUse deny hook。
- `evaluateBashSafetyPolicy()`：输出 risk、sandbox decision、read-only、findings、subcommands、path refs。
- macOS read-only Bash sandbox adapter：当本地 policy 判定为 sandboxed read 时，通过 `sandbox-exec` 禁止 file-write 和 network。
- Bash permission request / transcript event 会携带 `policy` 和 main-agent `origin`。
- permission gate 进入 resolve-once coordinator：相同 in-flight request 只解析一次，joined request 共享同一个 resolution id，并在 transcript decision 里记录 `PermissionResolutionMetadata`。
- high-risk destructive command 会在 safety policy 层 fail closed，即使 `bypass-local` 也不能绕过。
- `sed -i` 的窄子集会转成 permission-gated edit surrogate，返回 diff，而不是直接跑 shell write。

这已经把 Bash 从单纯 risk 字符串推进到可审计的 policy decision，并有首个 OS-level read-only sandbox adapter。缺口：

- sandbox adapter 目前只覆盖 macOS `sandbox-exec` 的 read-only Bash；Linux/Windows adapter 仍缺。
- read-only 判定已有本地 flag/path/wrapper 检查，但还不是完整 shell AST。
- shell injection / wrapper escape 检查是局部规则，不是完整 classifier。
- resolve-once permission coordinator 已有；还没有完整 interactive dialog queue UI。
- hook / user / classifier / bridge approval 还没有完整跨来源 resolver taxonomy。

### Subagent / Task Host Runtime

当前 Vigilon 有：

- `.vigilon/agents/<name>.md` local definition。
- allowed tools 和 `maxTurns`。
- 同步 local subagent。
- 独立 subagent transcript。
- 结构化 completed result。
- source-aware agent catalog：对齐 Claude Code source precedence 形状 `built-in -> plugin -> user -> project -> local -> flag -> managed`，并记录 override 关系；solo runtime 用本地 plugin/user/project/local/managed 目录、env source 和 flag definitions 承载这些来源，不引入远端企业下发。
- `AgentInventory` 工具和 `vigilon agents` CLI 能展示 active agent definitions、source precedence、override 关系、active tasks 和 retained terminal/output tasks。
- subagent permission origin：子 agent 内部权限请求会标注 `agentRole=subagent` 和 parent agent。
- parent-side permission/origin visibility：`AgentInventory`、`vigilon agents inspect` 和 TUI `/agents inspect` 会从子 transcript 聚合 permission request 总数、allow/deny、action、tool、agentRole、parentAgentId 和 latest permission。
- subagent memory snapshot：从父 session state 继承 freshness、plan、verification notes，并读取手动 promotion 后的长期 memory snapshot。
- subagent prompt 注入 `<vigilon_subagent_long_term_memory>`，包含 bounded long-term memory entries、index path、manifest path 和 source session。
- sync local subagent task host metadata：返回 task id、status、background flag、transcript path、started/completed time。
- sync local subagent 会登记到 shared task manager；`TaskStop` 能通过同一 stop path 停止已登记的 subagent task host。
- `background: true` 的 local subagent 会返回 running handoff，不阻塞父 Agent 继续执行；父 session-state 会记录 running task，task manager 保持注册，`TaskStop` 能停止该后台 subagent host。
- task manager 会保留 terminal registry：completed / stopped / failed task 的 completedAt、terminalReason、outputSummary 和 transcript path；后台 subagent 结束后会写回 parent session-state，并在 resume capability replay 中暴露 `retained_task`。
- `vigilon agents inspect <parent-session-id> <task-id>` 能从 parent retained/background task 定位 subagent transcript，并输出 transcript-derived output stream 和 permission/origin summary。
- `vigilon agents resume <parent-session-id> <task-id> <prompt...>` 能恢复 retained subagent transcript，按原 agent definition、allowed tools、permission origin 和 parent task metadata 继续运行，并把 resume 后的 terminal state 写回 parent retained registry。
- subagent runtime 会向 parent transcript 写入 `subagent-lifecycle` 事件，并在主 runtime stream 中实时暴露 started / model / tool / running-handoff / completed / stopped / failed 生命周期状态。
- TUI `/agents` 已能从同一 runtime catalog 和 session retained/background task state 展示 inventory，并支持 `/agents inspect <session> <task-id>`、`/agents resume <session> <task-id> <prompt>` 与 `/agents apply <session> <task-id>`。
- `TaskManager` 已提供 task terminal subscription；TUI adapter 会把 in-process background subagent completed / failed / stopped 终止态主动推送成 live stream notification，并触发 session/agent view refresh。
- transcript restore 会从 `subagent-lifecycle` 终止事件反推 retained task state；TUI adapter 订阅时会从 transcript-derived retained tasks replay background completion/failed/stopped notification。
- 每个 subagent task 会生成 transcript-adjacent stop-request path；`vigilon agents stop <parent-session-id> <task-id>` 可跨进程写入 stop request，live task manager 轮询到该请求后走同一 abort/retained terminal path。
- TUI adapter 现在持有跨 turn 的 shared task manager；`/agents stop <session> <task-id>` 会优先停止当前 TUI 进程内仍然 live 的 subagent host，找不到 live host 时退到 `vigilon agents stop` 的 cross-process stop-request path，而不是伪造 stop 成功。
- agent definition 支持 `host: local | worktree | git-worktree`；`host: worktree` 会为 subagent 创建复制型隔离 cwd，跳过 `.git`、`.vigilon`、`.sessions`、`node_modules`；`host: git-worktree` 会基于当前 git `HEAD` 创建独立 branch/worktree，并把 branch、base HEAD、git root、`host`、`cwd`、`worktreePath`、`sourceCwd` 写入 task metadata 和 lifecycle event。
- worktree host 结束时会生成 baseline-to-worktree patch artifact，记录 `worktreeDiff.status`、changed files、additions/deletions 和 patch path，并在 taskHost、retained task、AgentInventory、TUI `/agents` 中可见。`vigilon agents apply <parent-session-id> <task-id>` 会先校验 source 中相关文件仍匹配 subagent baseline，再执行 `git apply --check` / `git apply`，并把 `worktreeDiff.sourceApply` 写回 parent session-state；它支持 `--check` 无副作用检查、`--files` partial apply、`--3way` 3-way apply 模式、`--rollback` 反向回滚，以及 structured conflict details。TUI `/agents` detail 会直接渲染 check / 3way / rollback / partial-files merge command choices。

这已经把同步 local subagent 从单次工具调用推进到可审计执行单元，但它还不是完整多 agent runtime。缺口：

- agent catalog 已覆盖 built-in / plugin / user / project / local / flag / managed source precedence；remote enterprise policy distribution 仍明确不做。
- AgentInventory / CLI inventory / TUI `/agents` inventory-inspect-resume-apply-stop 已有；cross-process live stop 通过 stop-request 文件推进，但已经退出的进程仍只能 inspect/resume，不能 retroactively kill。
- fork subagent 已记录 byte-identical prefix metadata 和 parent canonical prefix hash；DeepSeek provider prompt cache usage 已进入 runtime usage contract、transcript `llm-response`、request-stability audit 和 `pnpm phase2.5:cache-probe`。真实 provider-backed cache-hit closure 由 `pnpm phase2.5:provider-cache-probe` 强制验证。
- background local subagent running handoff、shared stop path、live completion subscription、transcript notification replay、复制型 worktree task host、git-native worktree task host、diff artifact、baseline-checked source apply、partial apply、3-way mode、rollback、structured conflict details 和 TUI merge command choices 已有；更完整的冲突编辑器仍后置。
- long-term memory handoff 已有 bounded prompt snapshot。

## 3. P2.5 完成定义

P2.5 只有在以下四条链路都有可复查证据时才算完成。

### 3.1 Memory Runtime 完成条件

- 有 file-backed session memory store，支持 view / edit / delete。
- 有 manual summary 命令或等价 CLI/TUI 操作。
- 有 typed session-memory sections / semantic fingerprint / freshness / stale / drift caveat，不把旧 memory 当当前事实。
- 有手动 typed long-term memory promotion，且写入 file-backed index、topic files 和 manifest。
- 有提取触发条件，不能每轮黑盒写 memory。
- 有明确规则：不把可从仓库直接推导的代码结构、临时失败、隐私内容、工具噪音写入长期记忆。
- resume 和 compact 后能证明 memory 对继续任务有帮助。

### 3.2 Context / Compact Runtime 完成条件

- compact 路由明确：session-memory -> reactive -> legacy，或者有等价的 Vigilon 简化协议并解释差异。
- auto compact 优先按 token/context pressure 判断，而不是只看事件数。
- auto compact 有 circuit breaker 和 recursion gate。
- compact 保持 API invariant：tool_use / tool_result、streaming block、assistant tool-call group 不被切断。
- compact 后恢复 capability、MCP instructions、agent listing、plan、todo、verification、memory freshness。
- post-compact cleanup 清理会被 compact 污染的 runtime cache/state。
- 有 manual compact、auto compact、resume-after-compact 三类 probe。

### 3.3 Safety / Sandbox Runtime 完成条件

- Bash 执行进入 policy decision：sandboxed / unsandboxed / denied / ask。
- read-only shell 判定不只看命令名，还要看 flags、路径、wrapper、redirection 和 dangerous patterns。
- 高风险命令 fail closed 或进入 interactive approval。
- file write / edit / sed surrogate 共用审计和 diff 边界。
- PreToolUse hook、permission mode、operator approval、classifier 或本地规则共享同一条 permission result contract。
- 多 agent 场景下 permission origin 可解释：是谁发起、代表哪个 agent、可否升级为持久规则。

### 3.4 Subagent / Task Host Runtime 完成条件

- agent definition 是复合 runtime 对象，不只是 prompt 文本。
- agent source precedence 明确，区分 built-in / plugin / user / project / local / flag / managed 的有效面和 override 关系。
- sync local subagent 能稳定完成有限任务，并返回结构化结果。
- background-capable task host 记录 task id、status、transcript、output 和 terminal state。
- TaskStop 能停止对应 task host，不只是 background bash。
- subagent transcript、permissions、memory snapshot 和 final handoff 可被主 Agent 和用户审计。

## 4. 非目标

P2.5 仍保持 Solo Runtime 边界：

- 不做 remote / bridge。
- 不做 enterprise policy center。
- 不做 marketplace。
- 不做 teammate / swarm 产品面。
- 不做商业 telemetry。
- 不把 TUI 产品化为 daily-driver 外壳。

但这些不做不等于可以省掉治理语义。P2.5 的重点是把本地单人 runtime 做成可治理、可恢复、可审计。

## 5. 验收口径

P2.5 不接受以下证据作为完成：

- “文件存在”。
- “工具名注册了”。
- “scripted fake model 可以调用”。
- “单元测试覆盖了 happy path”。
- “最终自然语言说完成了”。

P2.5 必须留下：

- Claude Code 对照路径。
- Vigilon 当前实现路径。
- 真实或半真实任务 probe transcript。
- 失败边界说明。
- 权限和恢复语义说明。
- 可重复 gate 命令。

## 6. 初始 Gate

P2.5 的入口 gate 是：

```bash
pnpm phase2.5:baseline
```

它只证明 P2.5 设计、计划和当前差距被显式记录，不证明 P2.5 完成。

Memory Runtime 当前新增的局部门禁是：

```bash
pnpm phase2.5:memory-probe
pnpm phase2.5:provider-memory-probe
```

它证明当前 memory slice 具备后台 extraction worker 及 terminal status、manifest、typed sections、semantic fingerprint、fresh/stale inspection、semantic drift inspection、model-grounded session-memory validation metadata、`memory validate --refresh` readiness gate、stale drift caveat、manual typed long-term memory promotion policy 和 delete 语义；它仍不证明完整 P2.5 完成，也不证明长期记忆 promotion 的 provider-grounded validation、sandbox 或 subagent 治理完成。

`pnpm phase2.5:provider-memory-probe` 是真实 provider-backed memory validation gate：它强制 DeepSeek provider 对 session memory 与 bounded transcript evidence 做 grounding，且只有返回 `supported` 并带 usage metadata 时才算 provider-backed memory closure evidence。没有 API key、provider 返回 unknown/contradicted、或无 usage metadata 时都不能用 synthetic probe 代替。

Context / Compact Runtime 当前新增的局部门禁是：

```bash
pnpm phase2.5:compact-probe
```

它证明当前 compact slice 具备 route metadata、session-memory extraction readiness/wait、model-grounded memory readiness gate、unsupported memory compact blocking、provider/model context-window budget metadata、provider input-token preflight、provider usage anchored token pressure、token-pressure auto compact evaluation、preserved segment head/anchor/tail event refs、registry-driven post-compact cleanup operations、manual compact CLI surface、auto compact gate 和 compact metadata restoration；TUI `/compact` surface 由 TUI unit test 和 `phase2.5:baseline` signal 覆盖。它仍不证明完整 P2.5 完成，也不证明 offline tokenizer parity、sandbox 或 subagent 治理完成。

Safety / Sandbox Runtime 当前新增的局部门禁是：

```bash
pnpm phase2.5:safety-probe
```

它证明当前 safety slice 具备 Bash safety policy metadata、sandbox decision、macOS read-only OS sandbox enforcement、read-only shell constraints、permission origin、resolve-once permission coordination、high-risk fail-closed 和 sed edit surrogate；它仍不证明完整 P2.5 完成，也不证明跨平台 sandbox adapter、interactive dialog queue UI 或完整 resolver taxonomy 完成。

Subagent / Task Host Runtime 当前新增的局部门禁是：

```bash
pnpm phase2.5:subagent-probe
```

它证明当前 subagent slice 具备 Claude Code-shaped source precedence（built-in/plugin/user/project/local/flag/managed）、override visibility、AgentInventory、session + long-term memory snapshot inheritance、subagent permission origin、父侧 transcript-derived permission/origin aggregation、shared task-host registration、byte-identical fork prefix metadata、复制型 worktree host isolation、baseline-to-worktree diff artifact、baseline-checked source apply、check-only/partial/3-way/rollback apply lifecycle、TUI merge command choices、background running handoff、retained terminal/output state、TaskStop shared stop path、cross-process stop request observation、isolated transcript、final handoff、transcript-backed lifecycle streaming/replay、retained subagent transcript 的 CLI inspect/resume/apply/stop 和 transcript-derived output stream，以及 TUI `/agents` inventory/inspect/resume/apply/stop；git-native worktree branch/HEAD provenance 和 live/transcript-replayed background completion notification 由 runtime/TUI unit test 与 baseline signal 覆盖。它仍不证明完整 P2.5 完成，也不证明已经退出进程的 retroactive kill。

Provider Cache / Prefix Sharing 当前新增的局部门禁是：

```bash
pnpm phase2.5:cache-probe
```

它证明当前 cache slice 具备 DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 到 Vigilon `ModelUsage` 的映射、streaming `include_usage` 请求、`llm-response` transcript cache read/create/hit-ratio 记录、forked subagent shared byte-identical prefix metadata、assistant usage propagation 和 provider-cache request-stability audit。默认 probe 允许没有 API key 或 provider 暂未返回 hit 时保持 inconclusive，不把网络状态当成本地 runtime 失败。

真实 provider-backed cache-hit closure gate 是：

```bash
pnpm phase2.5:provider-cache-probe
```

它要求真实 DeepSeek provider 在重复 byte-identical prefix 请求中返回 cache-hit usage；没有 hit 时 gate 失败，不能用 synthetic fixture 替代 provider-backed cache evidence。

当前五块局部门禁的集成入口是：

```bash
pnpm phase2.5:governance-probe
```

它会先串联 memory / compact / safety / subagent / cache 五个 slice probe，再运行一个合成集成场景：临时 TypeScript repo、主 Agent delegation、subagent transcript、Bash safety permission、session memory、compact boundary、resume 后 ResultReport。该 probe 会把证据保留在 ignored `.vigilon/probes/phase25-governance-*` 目录里。

它仍不证明 P2.5 closure，因为该集成场景是 synthetic fake-model probe，不是 provider-backed long-task transcript，且本文档列出的 known gaps 仍然存在。

P2.5 之后的 closure gate 必须另建，不能复用 baseline gate 冒充完成。
