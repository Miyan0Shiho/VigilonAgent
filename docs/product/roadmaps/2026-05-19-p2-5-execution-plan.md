# P2.5 Runtime Governance Execution Plan

- 日期：2026-05-19
- 状态：OPEN / execution plan
- 主规格：[`../2026-05-19-p2-5-runtime-governance.md`](../2026-05-19-p2-5-runtime-governance.md)
- 参考：`docs/claudecode-research/library/mechanisms/12-memdir-and-session-memory.md`
- 参考：`docs/claudecode-research/library/mechanisms/63-session-memory-compaction-autocompact-and-post-compact-restoration-runtime.md`
- 参考：`docs/claudecode-research/library/mechanisms/70-bash-tool-sandbox-permission-and-transcript-runtime.md`
- 参考：`docs/claudecode-research/library/mechanisms/51-agent-definitions-selection-spawn-and-handoff-runtime.md`
- 参考：`docs/claudecode-research/library/mechanisms/58-agent-invocation-task-host-and-background-lifecycle-bridge.md`
- 参考：`docs/claudecode-research/library/mechanisms/79-taskstop-tool-stoptask-shared-kill-path-and-sdk-bookend-runtime.md`

## 1. 执行原则

P2.5 的改动必须先解释 runtime state，再写工具行为。不要做点对点兜底：

- 不为某个 probe 加特判。
- 不用 prompt 句子掩盖 runtime 状态缺失。
- 不把 `ResultReport` 当成唯一完成路径。
- 不把 fake-model acceptance 当真实机制完成。
- 不绕过 permission / transcript / compact 语义。

每个实现 PR 或工作块都要回答：

1. 这条链路在 Claude Code 里解决什么问题？
2. Vigilon 当前缺的 runtime state 是什么？
3. 新状态如何进入 transcript、resume、compact 和 final report？
4. 失败时模型、人类、后续 Agent 分别能看到什么？

## 2. Milestone A：P2.5 Baseline And Gap Lock

目标：让后续工作有一个不可漂移的入口基线。

交付：

- `docs/product/2026-05-19-p2-5-runtime-governance.md`
- `docs/product/roadmaps/2026-05-19-p2-5-execution-plan.md`
- `pnpm phase2.5:baseline`

验收：

- baseline gate 验证四条链路都被显式描述。
- baseline gate 输出当前 implementation status 和 known gaps。
- baseline gate 不允许输出 `closed` / `complete` 之类完成口径。

## 3. Milestone B：Memory Runtime

目标：把 session memory 从 resume helper 推进到受治理的 runtime subsystem。

实现方向：

- 增加 session memory manifest：记录 memory path、source transcript、source event count、freshness、last summarized event。
- 增加 typed session-memory sections 和 semantic fingerprint，用于 drift inspection。
- 增加 manual summary / refresh 操作，优先 CLI，TUI 只显示入口。
- 增加 view / edit / delete 命令或等价工具。
- 增加 drift caveat：stale memory 进入模型时必须被标注为可能过时。
- 明确禁止自动写长期记忆；长期 memory 如要出现，必须是 file-backed、typed、可审计，并通过 promotion policy。

Probe：

- 创建一段长 session，生成 memory。
- resume 后确认模型看到 memory 和 stale/fresh 标记。
- 修改 transcript 后确认 memory 变 stale，并报告 changed semantic anchors。
- 删除 memory 后确认不会注入旧事实。
- 手动 promote 一条长期记忆，确认写入 index、topic file 和 manifest。
- 尝试 promote 临时工具噪音，确认被 policy 拒绝且不写入 manifest。

Gate 草案：

```bash
pnpm phase2.5:memory-probe
pnpm phase2.5:provider-memory-probe
```

当前已落地的 Milestone B slice：

- `sessionMemory.ts` 会同时写 `.memory.md` 和 `.memory.manifest.json`。
- manifest 记录 memory path、transcript path、source event count、last summarized event、typed sections 和 semantic fingerprint。
- CLI 暴露 `memory status/view/write/edit/delete/refresh`，用于查看、手动编辑、删除和刷新 session memory。
- `memory refresh --background` 会通过 session-memory extraction worker 排队刷新，并写 `.memory.extraction.json` sidecar，记录 queued/running/completed/failed/skipped、source event pointer、memory/manifest path 和输出摘要。
- `inspectSessionMemory()` 会基于当前 transcript event count 和 typed semantic anchors 输出 fresh/stale、semantic drift 和 drift caveat；传入 `groundingModel` 时，会把 session memory 与当前 transcript evidence 交给模型校验，并返回 `groundingValidation`。
- stale memory 注入模型时包含 `<vigilon_memory_drift_caveat>`。
- `validateSessionMemoryGrounding()` 会返回 `vigilon.session-memory-grounding` metadata：status、modelId、source/current event count、semantic drift status、evidence event count、supported/contradicted/missing claims 和 reason。
- `memory validate <session-id> [--refresh]` 是独立 readiness gate：可刷新 session memory、执行 provider/model-grounded validation，并输出 `ready`、`blockingReasons`、`validationRequired` 和 grounding evidence。
- `pnpm phase2.5:provider-memory-probe` 强制跑真实 DeepSeek provider grounding；只有 provider 返回 `supported` 且带 usage metadata 时才作为 provider-backed memory validation closure evidence。
- `projectMemory.ts` 提供 `user` / `feedback` / `project` / `reference` 四类长期记忆 taxonomy。
- 长期记忆 promotion 写入 `.vigilon/memory/MEMORY.md`、topic file 和 `memory.manifest.json`，并记录 source session metadata。
- `memory promote` 是手动入口；promotion policy 会拒绝 secrets、临时工具噪音和可从仓库直接推导的代码结构。
- `pnpm phase2.5:memory-probe` 覆盖 background extraction worker terminal status、manifest、typed sections、semantic fingerprint、model-grounded memory validation metadata、fresh injection、stale semantic drift inspection、stale caveat injection、manual long-term promotion、promotion rejection 和 deletion。
- `pnpm phase2.5:provider-memory-probe` 覆盖 live provider-backed session-memory grounding、provider usage metadata 和 readiness gate metadata。

仍未完成：

- 默认本地 probe 仍使用 synthetic model 验证 contract；真实 provider 证据已拆到 `pnpm phase2.5:provider-memory-probe`，没有 API key 或 provider 未返回 supported 时不能当 closure evidence。
- memory -> skill / agent 的自动整理闭环。

## 4. Milestone C：Context / Compact Runtime

目标：把 compact 从 transcript marker 推进到 context-management 状态迁移。

实现方向：

- 建立 compact strategy router：session-memory / reactive / legacy。
- 增加 auto compact failure counter。
- 增加 recursion/query-source gate，避免 compact 自己触发 compact。
- 增加 preserved segment metadata：head / anchor / tail 或 Vigilon 等价 cursor。
- 增加 post-compact cleanup hook。
- 把 capability replay 从临时 user 注入推进为明确 runtime event 或 metadata。

Probe：

- manual compact 后 resume，确认 todo、plan、verification、discovered tools、memory freshness 保留。
- auto compact 失败多次后熔断。
- compact 不切断 tool_use / tool_result。
- compact 后第一轮请求能恢复能力声明。

Gate 草案：

```bash
pnpm phase2.5:compact-probe
```

当前已落地的 Milestone C slice：

- `compactTranscript()` 会写 `compactRoute` metadata，记录 session-memory / reactive / legacy 策略、fallback、trigger 和 query source。
- custom `userContext` 会关闭 session-memory 路由，退到 reactive，再退到 legacy。
- `evaluateAutoCompactTranscript()` 记录 threshold、events since boundary、query-source recursion gate 和 consecutive-failure circuit breaker。
- `evaluateAutoCompactTranscript()` 支持 provider/model context-window budget、reserved output/system/tool/safety budget 和 pressure threshold，优先用 token pressure 打开 auto compact gate，并把 `tokenPressure.contextBudget` metadata 写入 compact boundary。
- `estimateCompactTokenPressure()` 支持两条 provider/model-grounded token source：没有 usage anchor 时可使用 `ModelClient.countInputTokens()` preflight 取得 provider 返回的 input token 数，并记录 `tokenCountSource=provider-input-token-preflight`；已有 `llm-response` usage anchor 时可用最近一次 provider usage 加 bounded delta estimate，并记录 `tokenCountSource=provider-usage-plus-delta-estimate`、requestId、responseEventIndex、base input/output/cache tokens 和 delta estimator。provider preflight 失败时才显式回退到 `runtime-char-estimate`，并在 estimator metadata 记录失败原因。
- `preservedSegment` metadata 记录 requested / adjusted split index、summarized / preserved event count、API invariant adjustment，并为 head / anchor / tail 事件记录 deterministic event fingerprint ref。
- `postCompactCleanup` 由 runtime state registry 驱动：每个 compact 相关 state resource 声明 scope、policy、action 和计数；当前覆盖 context window rebuild、content replacement recalculation、capability replay、LSP open-file cache clear、read-before-write safety preserve 和 compact-state discard。
- `vigilon compact <session-id>` 提供 manual compact CLI surface：先检查 session memory readiness，必要时通过 session-memory extraction worker 刷新并等待 terminal status，再写 compact boundary，并返回 route、segment、cleanup、memory freshness 和 extraction readiness metadata。
- `vigilon compact <session-id> --validate-memory` 会在 compact 前执行 model-grounded session-memory validation，并把结果写入 `memoryReadiness.groundingValidation`；当 validation 返回 contradicted / unknown 时，session-memory route 会被 `blockingReasons` 拒绝，compact boundary 不会写入。
- TUI `/compact <index|session-id> [--validate-memory] ...` 复用 runtime CLI compact 路径，展示 memory readiness、grounding status、token pressure、route、cleanup 和 transcript path。
- `pnpm phase2.5:compact-probe` 覆盖 route、session-memory extraction readiness/wait、model-grounded memory readiness gate、unsupported memory compact blocking、provider/model context-window budget metadata、provider usage anchored token pressure、provider input-token preflight token pressure、segment head/anchor/tail event refs、registry-driven cleanup、manual compact CLI、auto gate 和 metadata restoration；TUI `/compact` surface 由 TUI unit test 和 `phase2.5:baseline` signal 覆盖。

仍未完成：

- provider/model context-window budget 协议已有 metadata 和 reserved-budget 计算；token pressure 已具备 provider input-token preflight 和 provider-reported usage anchor + bounded delta estimate 双路径。DeepSeek 官方 API 当前以 chat completion `usage` 和 demo tokenizer 包作为 token accounting 来源，没有 dedicated count-tokens endpoint；后续缺口是 offline tokenizer parity / 本地 tokenizer artifact 治理，而不是 no-anchor session 只能 heuristic。
- runtime cache/state registry 已覆盖当前 compact state classes；后续新增 runtime cache 必须注册 compact policy。
- preserved segment 已有 deterministic head/anchor/tail event refs；完整 transcript-wide event ID 体系仍未完成。
- TUI compact command surface 已接入；后续只保留更完整的 compact history/inspection UI polish。

## 5. Milestone D：Safety / Sandbox Runtime

目标：让 Bash、写文件、hook、operator approval 进入同一条安全策略链。

实现方向：

- 把 Bash risk classification 拆成 policy decision 对象。
- 增加 sandbox adapter interface，即使第一版只支持 local no-sandbox / denied / ask，也要把 decision 面抽出来。
- 增加 shell grammar checks：wrapper、redirection、substitution、dangerous path。
- 将 `sed -i` 这类 shell write 转成受控 edit surrogate 或明确 deny。
- 扩展 PreToolUse hook result，区分 hook allow / hook deny / user allow / mode allow。
- permission transcript 记录 origin：main / subagent / background task。

Probe：

- read-only 下安全 read bash 通过，write bash 失败。
- shell wrapper 不能伪装成 read-only。
- dangerous path 不给持久 allow suggestion。
- subagent 发起的高风险命令能显示 agent origin。

Gate 草案：

```bash
pnpm phase2.5:safety-probe
```

当前已落地的 Milestone D slice：

- `evaluateBashSafetyPolicy()` 输出 risk、sandbox decision、read-only、findings、subcommands 和 path refs。
- `prepareBashSandboxExecution()` 在 macOS 上把 sandboxed read-only Bash 包进 `sandbox-exec`，禁止 file-write 和 network。
- `PermissionRequest` / `PermissionDecision` 支持 `policy` 和 `origin` metadata。
- BashTool 把 safety policy 写进 permission transcript 和 tool result metadata。
- permission gate 使用 resolve-once coordinator：相同 in-flight request 只解析一次，joined request 共享 resolution id，并在 transcript decision 里记录 resolution metadata。
- high-risk destructive command 在 policy 层 fail closed，即使 `bypass-local` 也不能执行。
- shell wrapper、redirection、unsafe flags 会进入 `ask` / blocked path，而不是被当成 low-risk read。
- `sed -i` 的窄子集转成受控 edit surrogate，写入 diff 和 readFileState。
- `pnpm phase2.5:safety-probe` 覆盖 read-only sandboxed read、macOS OS sandbox enforcement、policy/origin transcript、redirection、wrapper、destructive denial 和 sed surrogate。

仍未完成：

- Linux / Windows OS sandbox adapter。
- 完整 shell AST / classifier。
- interactive permission dialog queue UI 和完整 resolver taxonomy。

## 6. Milestone E：Subagent / Task Host Runtime

目标：从同步 helper 调用推进到可治理的本地执行单元。

实现方向：

- 扩展 agent definition：tools / model / effort / permissionMode / maxTurns / memory / background / host。
- 建立 agent catalog，至少区分 built-in 和 project/local。
- 建立 task host abstraction：id、type、status、transcript、startedAt、endedAt、terminalReason。
- 让 foreground subagent 可以被登记为 task host。
- 让 TaskStop 走共享 kill path，能处理 bash task 和 agent task。
- 给 subagent 注入 session memory snapshot、long-term memory handoff 和 permission origin。

Probe：

- 主 Agent 调用 subagent 完成有限任务。
- subagent 有独立 transcript 和 result。
- subagent 尝试越权工具被拒绝，并能解释 allowed tools。
- background-capable agent 被 TaskStop 停止后留下 terminal state。

Gate 草案：

```bash
pnpm phase2.5:subagent-probe
```

当前已落地的 Milestone E slice：

- agent definition 扩展为 runtime object：source、sourcePath、permissionMode、model、effort、memory、background。
- `loadAgentCatalog()` 建立 Claude Code-shaped `built-in -> plugin -> user -> project -> local -> flag -> managed` source precedence，并记录 override 关系；plugin/user/managed 在 solo runtime 中由本地目录和 env source 承载。
- `AgentInventory` 工具和 `vigilon agents` CLI 展示 active definitions、source precedence、override 关系、active tasks 和 retained terminal/output tasks。
- AgentTool result 返回 catalog summary、taskHost、permissionOrigin、memorySnapshot。
- subagent runtime 注入 `permissionOrigin`，子 agent 内部权限请求会在 transcript 中标注 `agentRole=subagent` 和 `parentAgentId`。
- 父侧 permission/origin 可视化已接入 `AgentInventory`、`vigilon agents inspect` 和 TUI `/agents inspect`：从子 transcript 聚合 permission request 总数、allow/deny、action、tool、agentRole、parentAgentId 和 latest permission。
- subagent prompt 注入 `<vigilon_subagent_memory_snapshot>`，继承父 session memory freshness、approved plan、verification notes。
- subagent prompt 注入 `<vigilon_subagent_long_term_memory>`，从 project memory manifest 读取 bounded long-term entries、index path 和 source session metadata。
- sync local subagent 返回 task-host metadata：task id、status、background flag、transcript path、started/completed time。
- sync local subagent 会登记到 shared task manager，`TaskStop` 能对已登记的 subagent task host 触发 abort。
- `background: true` 的 local subagent 返回 running handoff，父 session-state 记录 running task，父 turn 结束后 task manager 仍保持注册，`TaskStop` 能停止该后台 subagent host。
- task manager 保留 retained terminal/output registry：completed / stopped / failed task 的 completedAt、terminalReason、outputSummary 和 transcript path；后台 subagent 完成后会写回 parent session-state，并在 resume capability replay 暴露 `retained_task`。
- task manager 提供 task terminal subscription；TUI adapter 订阅 in-process background subagent completed / failed / stopped 终止态，并把它主动推送进 live stream notification。
- transcript restore 会从 `subagent-lifecycle` 终止事件反推 retained task state；TUI 订阅时会从 transcript-derived retained tasks replay background notification。
- `vigilon agents inspect <parent-session-id> <task-id>` 会从 parent retained/background task 定位 subagent transcript，并输出 transcript-derived output stream 和 permission/origin summary。
- `vigilon agents resume <parent-session-id> <task-id> <prompt...>` 会恢复 retained subagent transcript，按原 agent definition、allowed tools、permission origin 和 parent task metadata 继续运行，并把 resume 后的 terminal state 写回 parent retained registry。
- `vigilon agents stop <parent-session-id> <task-id>` 会写入 transcript-adjacent stop-request file；live task manager 轮询到该文件后通过同一 abort/retained terminal path 停止 subagent。
- subagent runtime 向 parent transcript 写入 `subagent-lifecycle`，并在主 runtime stream 中暴露 started / model / tool / running-handoff / completed / stopped / failed 生命周期状态。
- TUI `/agents` 使用同一 runtime catalog、session retained/background task state 和 subagent transcript，支持 inventory、inspect、resume、apply。
- TUI adapter 持有一个跨 turn shared task manager；`/agents stop` 能停止当前 TUI 进程内仍 live 的 subagent host，找不到 live host 时退到 cross-process stop-request path。
- agent definition 支持 `host: local | worktree | git-worktree`；`host: worktree` 会创建复制型隔离 cwd，跳过 `.git`、`.vigilon`、`.sessions`、`node_modules`；`host: git-worktree` 会基于当前 git `HEAD` 创建独立 branch/worktree，并把 branch、base HEAD、git root、`host`、`cwd`、`worktreePath`、`sourceCwd` 写入 task metadata 和 lifecycle event。
- worktree host 结束时会生成 baseline-to-worktree patch artifact，记录 `worktreeDiff.status`、changed files、additions/deletions 和 patch path，并在 taskHost、retained task、AgentInventory、TUI `/agents` 中可见。`vigilon agents apply` 会先校验 source 中相关文件仍匹配 subagent baseline，再执行 `git apply --check` / `git apply`，并把 `worktreeDiff.sourceApply` 写回 parent session-state；它支持 `--check` 无副作用检查、`--files` partial apply、`--3way` 3-way apply 模式、`--rollback` 反向回滚，以及 structured conflict details。TUI `/agents` detail 会渲染 check / 3way / rollback / partial-files merge command choices。
- `pnpm phase2.5:subagent-probe` 覆盖 real runtime delegation、Claude Code-shaped source precedence、catalog override、AgentInventory、session + long-term memory snapshot、permission origin、父侧 permission/origin aggregation、shared task-host registration、byte-identical fork prefix metadata、复制型 worktree host isolation、baseline-to-worktree diff artifact、baseline-checked source apply、background running handoff、retained terminal/output state、TaskStop shared stop path、cross-process stop request observation、isolated transcript、final handoff、lifecycle streaming/replay、CLI inspect/resume/apply/stop 和 transcript-derived output stream；git-native worktree branch/HEAD provenance 由 runtime unit test 与 baseline signal 覆盖，TUI `/agents` 由 TUI package typecheck/test 与 baseline signal 覆盖。
- `pnpm phase2.5:cache-probe` 覆盖 DeepSeek provider prompt-cache usage 映射、streaming `include_usage` 请求、runtime transcript cache read/create/hit-ratio 记录、forked subagent byte-identical prefix metadata、assistant usage propagation 和 provider-cache request-stability audit。
- `pnpm phase2.5:provider-cache-probe` 强制跑真实 DeepSeek provider repeated byte-identical prefix 请求；只有 provider 返回 cache-hit usage 时才作为 provider-backed cache-hit closure evidence。

仍未完成：

- provider-backed cache-hit proof 已从 subagent probe 拆出为 `pnpm phase2.5:provider-cache-probe`；没有真实 provider hit 时不能把 synthetic cache fixture 当 closure。
- 更完整的冲突编辑器；当前已有复制型 worktree host、git-native worktree host、diff artifact、baseline-checked source apply、partial apply、3-way mode、rollback、structured conflict details 和 TUI merge command choices。
- 已经退出进程的 retroactive kill；当前已有 live process 轮询 stop-request file 和 transcript-derived notification replay。
- 跨进程重启后的 live stop。

## 7. Milestone F：Integrated Governance Probe

目标：证明四条链路不是各自能跑，而是能组成一个长任务闭环。

任务形态：

```text
在一个临时 TypeScript 仓库里，先让主 Agent 制定计划，调用 subagent 调查一处跨文件问题，执行一次受限 Bash 验证，生成 session memory，触发 compact，resume 后继续完成最终报告。要求 transcript 能解释每一次权限、memory、compact、subagent 和验证状态。
```

验收：

- 有主 transcript。
- 有 subagent transcript。
- 有 memory 文件。
- 有 compact boundary。
- 有 permission events。
- 有 TaskStop 或 task terminal event。
- resume 后 final answer 与之前状态一致。
- 最终报告列出验证、未验证项、风险和 remaining todos。

Gate 草案：

```bash
pnpm phase2.5:governance-probe
```

当前已落地的 Milestone F slice：

- `phase25-governance-probe.ts` 串行运行 memory、compact、safety、subagent、cache 五个局部门禁。
- governance probe 输出每个 gate 的 command、status 和 pass/fail。
- governance probe 会创建一个临时 TypeScript repo，实际跑主 Agent -> subagent -> Bash safety permission -> session memory -> compact -> resume -> ResultReport 的合成闭环。
- integrated scenario 会保留 ignored `.vigilon/probes/phase25-governance-*` 证据目录，包含 main transcript、subagent transcript 和 memory 文件。
- governance probe 明确 `closureEvidence: false`，因为它证明的是合成集成链路和当前 slice probes，不消除各章节 known gaps。

仍未完成：

- provider-backed integrated task transcript。
- provider-backed resume 后最终报告引用 compact/memory/subagent/permission evidence。
- 把当前 slice gates 升级为 P2.5 closure evidence。

## 8. Closure 条件

P2.5 关闭前必须满足：

1. `pnpm phase2.5:baseline`
2. `pnpm phase2.5:memory-probe`
3. `pnpm phase2.5:provider-memory-probe`
4. `pnpm phase2.5:compact-probe`
5. `pnpm phase2.5:safety-probe`
6. `pnpm phase2.5:subagent-probe`
7. `pnpm phase2.5:cache-probe`
8. `pnpm phase2.5:provider-cache-probe`
9. `pnpm phase2.5:governance-probe`
10. `pnpm typecheck`
11. `pnpm --filter @vigilon/runtime test`

其中 baseline 只证明入口完整；其余 probes 才能作为 closure evidence。
