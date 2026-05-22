import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

type Check = {
  name: string
  passed: boolean
  evidence: string
}

type ImplementationSignal = {
  area: 'memory' | 'compact' | 'safety' | 'subagent'
  status: 'foundation_present' | 'gap_locked'
  evidence: string[]
  knownGaps: string[]
}

const SPEC_PATH = 'docs/product/2026-05-19-p2-5-runtime-governance.md'
const PLAN_PATH = 'docs/product/roadmaps/2026-05-19-p2-5-execution-plan.md'
const README_PATH = 'docs/product/README.md'
const ROOT_PACKAGE_PATH = 'package.json'
const RUNTIME_PACKAGE_PATH = 'packages/runtime/package.json'

async function main(): Promise<void> {
  const root = discoverWorkspaceRoot(process.cwd()) ?? path.resolve(process.cwd())
  const files = await readRequiredFiles(root, [
    SPEC_PATH,
    PLAN_PATH,
    README_PATH,
    ROOT_PACKAGE_PATH,
    RUNTIME_PACKAGE_PATH,
    'packages/runtime/src/runtime/sessionMemory.ts',
    'packages/runtime/src/runtime/projectMemory.ts',
    'packages/runtime/src/cli.ts',
    'packages/runtime/scripts/phase25-provider-memory-probe.ts',
    'packages/runtime/src/runtime/contracts.ts',
    'packages/runtime/src/runtime/requestAudit.ts',
    'packages/runtime/src/runtime/compact.ts',
    'packages/runtime/src/runtime/postCompactStateRegistry.ts',
    'packages/runtime/src/model/deepseek.ts',
	    'packages/runtime/src/runtime/context.ts',
	    'packages/runtime/src/runtime/permissions.ts',
	    'packages/runtime/src/runtime/permissionOrigins.ts',
	    'packages/runtime/src/runtime/safetyPolicy.ts',
    'packages/runtime/src/runtime/sandbox.ts',
    'packages/runtime/src/tools/bashTool.ts',
    'packages/runtime/src/runtime/agentDefinitions.ts',
    'packages/runtime/src/tools/agentInventoryTool.ts',
    'packages/runtime/src/tools/agentTool.ts',
    'packages/runtime/src/tools/taskStopTool.ts',
    'packages/runtime/src/runtime/taskControl.ts',
    'packages/runtime/src/runtime/taskManager.ts',
    'packages/runtime/src/runtime/transcript.ts',
    'packages/runtime/src/runtime/agentLoop.ts',
    'packages/tui/src/runtime/commandCatalog.ts',
    'packages/tui/src/runtime/nodeAdapter.ts',
    'packages/tui/src/components/InteractiveOperatorShell.tsx',
    'packages/tui/src/render/text.ts',
  ])

  const checks: Check[] = [
    fileExistsCheck(root, SPEC_PATH),
    fileExistsCheck(root, PLAN_PATH),
    containsCheck(files[SPEC_PATH], 'spec declares P2.5 open', 'OPEN / NOT CLOSED'),
    containsCheck(files[SPEC_PATH], 'spec includes memory runtime domain', 'Memory Runtime'),
    containsCheck(files[SPEC_PATH], 'spec includes context compact domain', 'Context / Compact Runtime'),
    containsCheck(files[SPEC_PATH], 'spec includes safety sandbox domain', 'Safety / Sandbox Runtime'),
    containsCheck(files[SPEC_PATH], 'spec includes subagent task host domain', 'Subagent / Task Host Runtime'),
    containsCheck(files[SPEC_PATH], 'spec forbids baseline as closure', '不证明 P2.5 完成'),
    containsCheck(files[PLAN_PATH], 'plan defines memory probe', 'pnpm phase2.5:memory-probe'),
    containsCheck(files[PLAN_PATH], 'plan defines provider memory probe', 'pnpm phase2.5:provider-memory-probe'),
    containsCheck(files[PLAN_PATH], 'plan defines compact probe', 'pnpm phase2.5:compact-probe'),
    containsCheck(files[PLAN_PATH], 'plan defines safety probe', 'pnpm phase2.5:safety-probe'),
    containsCheck(files[PLAN_PATH], 'plan defines subagent probe', 'pnpm phase2.5:subagent-probe'),
    containsCheck(files[PLAN_PATH], 'plan defines cache probe', 'pnpm phase2.5:cache-probe'),
    containsCheck(files[PLAN_PATH], 'plan defines provider cache probe', 'pnpm phase2.5:provider-cache-probe'),
    containsCheck(files[PLAN_PATH], 'plan defines integrated governance probe', 'pnpm phase2.5:governance-probe'),
    containsCheck(files[README_PATH], 'README links P2.5 spec', '2026-05-19 P2.5 Runtime Governance'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes baseline script', '"phase2.5:baseline"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes baseline script', '"phase2.5:baseline"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes memory probe script', '"phase2.5:memory-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes memory probe script', '"phase2.5:memory-probe"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes provider memory probe script', '"phase2.5:provider-memory-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes provider memory probe script', '"phase2.5:provider-memory-probe"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes compact probe script', '"phase2.5:compact-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes compact probe script', '"phase2.5:compact-probe"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes safety probe script', '"phase2.5:safety-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes safety probe script', '"phase2.5:safety-probe"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes subagent probe script', '"phase2.5:subagent-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes subagent probe script', '"phase2.5:subagent-probe"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes cache probe script', '"phase2.5:cache-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes cache probe script', '"phase2.5:cache-probe"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes provider cache probe script', '"phase2.5:provider-cache-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes provider cache probe script', '"phase2.5:provider-cache-probe"'),
    containsCheck(files[ROOT_PACKAGE_PATH], 'root package exposes governance probe script', '"phase2.5:governance-probe"'),
    containsCheck(files[RUNTIME_PACKAGE_PATH], 'runtime package exposes governance probe script', '"phase2.5:governance-probe"'),
  ]

  const implementationSignals: ImplementationSignal[] = [
    {
      area: 'memory',
      status: 'foundation_present',
      evidence: [
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'writes file-backed session memory', 'writeSessionMemory'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'writes session memory manifest', 'SessionMemoryManifest'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'parses typed session-memory sections', 'parseSessionMemorySections'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'records semantic memory fingerprints', 'semanticFingerprint'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'inspects live memory freshness', 'inspectSessionMemory'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'inspects typed semantic drift', 'semanticDrift'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'validates memory against transcript evidence with a model', 'validateSessionMemoryGrounding'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records model-grounded memory validation metadata', 'MemoryGroundingValidationMetadata'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'attaches memory grounding validation to compact readiness', 'groundingValidation'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records compact readiness gate state', 'blockingReasons'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'schedules background session-memory extraction', 'scheduleSessionMemoryExtraction'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'records extraction worker terminal status', 'SessionMemoryExtractionRecord'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'writes extraction worker sidecar status', '.memory.extraction.json'),
        signal(files['packages/runtime/src/runtime/projectMemory.ts'], 'defines typed long-term memory taxonomy', 'LongTermMemoryKind'),
        signal(files['packages/runtime/src/runtime/projectMemory.ts'], 'evaluates long-term memory promotion policy', 'evaluateLongTermMemoryPromotion'),
        signal(files['packages/runtime/src/runtime/projectMemory.ts'], 'writes file-backed project memory index', 'getProjectMemoryIndexPath'),
        signal(files['packages/runtime/src/runtime/projectMemory.ts'], 'writes project memory manifest', 'ProjectMemoryManifest'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'deletes memory and manifest together', 'deleteSessionMemory'),
        signal(files['packages/runtime/src/cli.ts'], 'exposes CLI memory command surface', 'manageSessionMemory'),
        signal(files['packages/runtime/src/cli.ts'], 'exposes background memory refresh CLI', 'memory refresh'),
        signal(files['packages/runtime/src/cli.ts'], 'exposes provider-grounded memory validation CLI', 'memory validate'),
        signal(files['packages/runtime/scripts/phase25-provider-memory-probe.ts'], 'defines live provider-backed memory validation gate', 'Provider Memory Validation Runtime'),
        signal(files['packages/runtime/scripts/phase25-provider-memory-probe.ts'], 'requires provider evidence for closure', 'closureEvidence'),
        signal(files['packages/runtime/scripts/phase25-provider-memory-probe.ts'], 'checks provider usage metadata during memory grounding', 'providerUsagePresent'),
        signal(files['packages/runtime/src/cli.ts'], 'exposes manual long-term memory promotion', 'memory promote'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'injects vigilon_session_memory', '<vigilon_session_memory'),
        signal(files['packages/runtime/src/runtime/sessionMemory.ts'], 'injects stale memory drift caveat', '<vigilon_memory_drift_caveat>'),
      ],
      knownGaps: [
        'Model-grounded session-memory validation now exists for inspection, memory validate, compact readiness, and compact CLI/TUI --validate-memory. Live provider-backed validation is separated into pnpm phase2.5:provider-memory-probe and only counts as closure evidence when the provider returns supported grounding with usage metadata.',
        'Manual typed long-term memory promotion exists; automatic memory -> skill / agent / compact organization remains future work.',
      ],
    },
    {
      area: 'compact',
      status: 'foundation_present',
      evidence: [
        signal(files['packages/runtime/src/runtime/compact.ts'], 'records compact-boundary metadata', 'compact-boundary'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'records compact route metadata', 'CompactRouteMetadata'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'evaluates auto-compact gates', 'evaluateAutoCompactTranscript'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'evaluates token pressure compact gates', 'estimateCompactTokenPressure'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'uses provider usage anchors for compact token pressure', 'provider-usage-plus-delta-estimate'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'uses provider input-token preflight for compact token pressure', 'provider-input-token-preflight'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'preflights provider input tokens before first usage anchor', 'countInputTokens'),
        signal(files['packages/runtime/src/model/deepseek.ts'], 'implements DeepSeek provider token preflight via usage', 'countInputTokens'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records compact token pressure metadata', 'CompactTokenPressureMetadata'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records compact token count source metadata', 'tokenCountSource'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records provider/model context-window budget metadata', 'CompactContextWindowBudgetMetadata'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'resolves provider/model context-window budgets', 'resolveCompactContextWindowBudget'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records compact memory readiness metadata', 'CompactMemoryReadinessMetadata'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records compact memory readiness blocking reasons', 'blockingReasons'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'writes compact memory readiness into boundary metadata', 'memoryReadiness'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records memory grounding inside compact readiness metadata', 'MemoryGroundingValidationMetadata'),
        signal(files['packages/runtime/src/cli.ts'], 'exposes compact memory validation CLI flag', '--validate-memory'),
        signal(files['packages/runtime/src/cli.ts'], 'blocks compact when required memory grounding is unsupported', 'compact memory readiness blocked'),
        signal(files['packages/runtime/src/cli.ts'], 'waits for session-memory extraction before compact', 'ensureFreshSessionMemory'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'records preserved segment metadata', 'preservedSegment'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records preserved segment event refs', 'CompactPreservedEventRefMetadata'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'uses deterministic compact event fingerprints', 'deterministicCompactEventId'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'runs post-compact cleanup operations', 'runPostCompactCleanup'),
        signal(files['packages/runtime/src/runtime/postCompactStateRegistry.ts'], 'uses registry-driven post-compact cleanup', 'PostCompactStateRegistry'),
        signal(files['packages/runtime/src/runtime/postCompactStateRegistry.ts'], 'records runtime state scope and compact policy', 'policy:'),
        signal(files['packages/runtime/src/runtime/postCompactStateRegistry.ts'], 'preserves read-before-write safety state during cleanup', 'preserve-safety-state'),
        signal(files['packages/runtime/src/runtime/compact.ts'], 'has latest-boundary auto-compact guard', 'shouldAutoCompactTranscript'),
        signal(files['packages/runtime/src/cli.ts'], 'exposes manual compact command surface', 'vigilon compact'),
        signal(files['packages/tui/src/runtime/commandCatalog.ts'], 'exposes TUI compact command surface', '/compact <index|session-id>'),
        signal(files['packages/tui/src/runtime/nodeAdapter.ts'], 'routes TUI compact through runtime CLI', 'compactSession'),
        signal(files['packages/tui/src/components/InteractiveOperatorShell.tsx'], 'handles TUI compact commands', 'runCompactCommand'),
        signal(files['packages/tui/src/render/text.ts'], 'renders compact readiness evidence', 'renderCompactResult'),
        signal(files['packages/runtime/src/runtime/context.ts'], 'has tool result content replacement', 'content-replacement'),
      ],
      knownGaps: [
        'Provider/model context-window budgeting is explicit in metadata; token pressure now prefers provider input-token preflight when no usage anchor exists and provider-reported llm-response usage plus bounded delta estimate after anchors exist. Offline tokenizer parity remains future work because DeepSeek documents usage results and demo tokenizer assets rather than a dedicated count-tokens endpoint.',
        'Runtime cache/state registry exists for current compact state classes; exhaustive registration of future runtime caches remains ongoing governance work.',
        'Preserved segment metadata now records deterministic head/anchor/tail event refs; full transcript-wide event IDs remain future work.',
        'Manual compact CLI and TUI /compact command surface exist; richer compact history/inspection UI remains future work.',
      ],
    },
    {
      area: 'safety',
      status: 'foundation_present',
      evidence: [
        signal(files['packages/runtime/src/runtime/permissions.ts'], 'has local permission modes', 'PermissionMode'),
	        signal(files['packages/runtime/src/runtime/permissions.ts'], 'has resolve-once permission coordinator', 'createPermissionResolutionCoordinator'),
	        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records permission resolution metadata', 'PermissionResolutionMetadata'),
	        signal(files['packages/runtime/src/runtime/permissionOrigins.ts'], 'aggregates permission origin summaries', 'buildPermissionOriginSummary'),
	        signal(files['packages/runtime/src/runtime/safetyPolicy.ts'], 'evaluates bash safety policy', 'evaluateBashSafetyPolicy'),
        signal(files['packages/runtime/src/runtime/safetyPolicy.ts'], 'records sandbox decision metadata', 'sandboxDecision'),
        signal(files['packages/runtime/src/runtime/sandbox.ts'], 'prepares OS sandbox execution for read-only Bash', 'prepareBashSandboxExecution'),
        signal(files['packages/runtime/src/runtime/sandbox.ts'], 'uses macOS sandbox-exec adapter', 'macos-sandbox-exec'),
        signal(files['packages/runtime/src/runtime/safetyPolicy.ts'], 'tracks shell findings', 'findings'),
        signal(files['packages/runtime/src/runtime/safetyPolicy.ts'], 'detects sed edit surrogate', 'sed_edit_surrogate'),
        signal(files['packages/runtime/src/tools/bashTool.ts'], 'attaches policy metadata to Bash results', 'safetyPolicy'),
        signal(files['packages/runtime/src/tools/bashTool.ts'], 'has timeout and output budget', 'DEFAULT_TIMEOUT_MS'),
      ],
      knownGaps: [
        'macOS read-only Bash sandbox adapter exists; Linux/Windows adapters remain future work.',
        'Shell grammar validation is local and partial, not a full shell AST parser.',
	        'Resolve-once permission coordinator exists; interactive dialog queue UI remains future work.',
      ],
    },
    {
      area: 'subagent',
      status: 'foundation_present',
      evidence: [
        signal(files['packages/runtime/src/tools/agentTool.ts'], 'has AgentTool local delegation', 'Delegates a focused subtask'),
        signal(files['packages/runtime/src/model/deepseek.ts'] ?? '', 'maps DeepSeek prompt cache usage', 'prompt_cache_hit_tokens'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records provider cache response metadata', 'cacheReadInputTokens'),
        signal(files['packages/runtime/src/runtime/requestAudit.ts'], 'audits provider cache read drops', 'provider_cache_read_drop_without_shape_change'),
        signal(files['packages/runtime/src/runtime/agentDefinitions.ts'], 'loads source-aware agent catalog', 'loadAgentCatalog'),
        signal(files['packages/runtime/src/runtime/agentDefinitions.ts'], 'records agent source precedence', 'AGENT_SOURCE_PRECEDENCE'),
        signal(files['packages/runtime/src/runtime/agentDefinitions.ts'], 'scans plugin agent source directories', 'pluginAgentLocations'),
        signal(files['packages/runtime/src/runtime/agentDefinitions.ts'], 'scans user agent source directories', 'VIGILON_USER_AGENTS_DIR'),
        signal(files['packages/runtime/src/runtime/agentDefinitions.ts'], 'scans managed agent source directories', 'VIGILON_MANAGED_AGENTS_DIR'),
        signal(files['packages/runtime/src/runtime/agentDefinitions.ts'], 'accepts flag source agent definitions', 'flagAgents'),
        signal(files['packages/runtime/src/runtime/agentDefinitions.ts'], 'parses local/worktree/git-worktree agent host definitions', 'git-worktree'),
        signal(files['packages/runtime/src/tools/agentInventoryTool.ts'], 'exposes agent inventory tool', 'AgentInventory'),
        signal(files['packages/runtime/src/cli.ts'], 'exposes CLI agent inventory', 'vigilon agents'),
	        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'creates subagent permission origin', 'agentRole: \'subagent\''),
	        signal(files['packages/runtime/src/runtime/permissionOrigins.ts'], 'summarizes subagent permission origins from transcript events', 'renderPermissionOriginSummary'),
        signal(files['packages/runtime/src/tools/agentTool.ts'], 'passes subagent memory snapshot', 'memorySnapshot'),
        signal(files['packages/runtime/src/tools/agentTool.ts'], 'loads long-term memory for subagent handoff', 'readProjectMemorySnapshot'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'] ?? '', 'injects subagent long-term memory prompt block', '<vigilon_subagent_long_term_memory>'),
        signal(files['packages/runtime/src/tools/agentTool.ts'], 'returns task host metadata', 'taskHost'),
        signal(files['packages/runtime/src/runtime/taskManager.ts'], 'has background bash task manager', 'startBashTask'),
        signal(files['packages/runtime/src/runtime/taskManager.ts'], 'registers subagent task hosts', 'startSubagentTask'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'registers subagents with shared task manager', 'registeredWithTaskManager'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'returns running handoff for background subagents', 'Background subagent is still running'),
        signal(files['packages/runtime/src/tools/agentTool.ts'], 'persists background subagent task state', 'persistBackgroundTaskSnapshot'),
        signal(files['packages/runtime/src/runtime/taskManager.ts'], 'retains task terminal state', 'retainedTasks'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'replays retained task state after resume', 'retained_task'),
        signal(files['packages/runtime/src/tools/taskStopTool.ts'], 'TaskStop uses shared stop path', 'shared stop path'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'] ?? '', 'has subagent runner', 'createSubagentRunner'),
	        signal(files['packages/runtime/src/cli.ts'], 'inspects retained subagent transcripts', 'buildSubagentOutputStream'),
	        signal(files['packages/runtime/src/cli.ts'], 'returns subagent permission summary in parent inspect', 'permissionSummary'),
        signal(files['packages/runtime/src/cli.ts'], 'resumes retained subagent tasks', 'runSubagentResumeTurn'),
        signal(files['packages/runtime/src/cli.ts'], 'writes parent retained state after subagent resume', 'appendResumedSubagentTaskState'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'defines subagent lifecycle events', 'SubagentLifecycleEvent'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'writes transcript-backed subagent lifecycle events', 'subagent-lifecycle'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'streams subagent lifecycle during tool execution', 'subagentLifecycle'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'prepares copied worktree execution hosts', 'prepareSubagentExecutionHost'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'prepares git-native worktree execution hosts', 'prepareGitSubagentWorktree'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'finalizes worktree diff artifacts', 'finalizeSubagentExecutionHost'),
        signal(files['packages/runtime/src/runtime/agentLoop.ts'], 'records git worktree branch provenance', 'branchName'),
        signal(files['packages/runtime/src/cli.ts'], 'applies worktree diffs after baseline drift check', 'git-apply-after-baseline-check'),
        signal(files['packages/runtime/src/cli.ts'], 'supports check-only worktree apply', '--check'),
        signal(files['packages/runtime/src/cli.ts'], 'supports partial worktree apply', '--files'),
        signal(files['packages/runtime/src/cli.ts'], 'supports rollback worktree apply', '--rollback'),
        signal(files['packages/runtime/src/cli.ts'], 'supports three-way worktree apply mode', '--3way'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records worktree task host metadata', 'worktreePath'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records worktree diff metadata', 'SubagentWorktreeDiff'),
        signal(files['packages/runtime/src/runtime/contracts.ts'], 'records source apply metadata', 'SubagentWorktreeApply'),
	        signal(files['packages/runtime/src/runtime/taskManager.ts'], 'retains subagent execution cwd and host metadata', 'sourceCwd'),
	        signal(files['packages/runtime/src/runtime/taskManager.ts'], 'records parent session id on task hosts', 'parentSessionId'),
	        signal(files['packages/runtime/src/runtime/taskControl.ts'], 'writes cross-process subagent stop requests', 'writeTaskStopRequest'),
	        signal(files['packages/runtime/src/runtime/taskManager.ts'], 'observes cross-process subagent stop requests', 'readTaskStopRequest'),
	        signal(files['packages/runtime/src/runtime/transcript.ts'], 'replays background subagent terminal state from lifecycle events', 'applySubagentLifecycleToState'),
		        signal(files['packages/runtime/src/runtime/taskManager.ts'], 'publishes task terminal lifecycle subscriptions', 'subscribe(listener'),
		        signal(files['packages/tui/src/runtime/commandCatalog.ts'], 'exposes TUI /agents command', '/agents [inspect|resume|apply|stop]'),
		        signal(files['packages/tui/src/runtime/nodeAdapter.ts'], 'backs TUI agents view with runtime catalog and session task state', 'buildAgentView'),
		        signal(files['packages/tui/src/runtime/nodeAdapter.ts'], 'aggregates child permission origins for TUI task detail', 'buildPermissionOriginSummary'),
	        signal(files['packages/tui/src/runtime/nodeAdapter.ts'], 'keeps one TUI task host registry across turns', 'const taskManager = runtime.createTaskManager()'),
		        signal(files['packages/tui/src/runtime/nodeAdapter.ts'], 'subscribes TUI adapter to background subagent terminal notifications', 'subscribeAgentTaskNotifications'),
		        signal(files['packages/tui/src/runtime/nodeAdapter.ts'], 'replays cross-process background subagent notifications from transcript state', 'replayAgentTaskNotifications'),
		        signal(files['packages/tui/src/runtime/nodeAdapter.ts'], 'stops live TUI subagent tasks through shared task manager', 'stopAgentTask'),
		        signal(files['packages/tui/src/render/text.ts'], 'renders interactive worktree merge command choices', 'formatMergeCommands'),
	        signal(files['packages/tui/src/components/InteractiveOperatorShell.tsx'], 'pushes background subagent completion into the live TUI stream', 'background subagent'),
	        signal(files['packages/tui/src/components/InteractiveOperatorShell.tsx'], 'routes TUI /agents inspect resume and stop actions', 'runAgentsCommand'),
		        signal(files['packages/tui/src/render/text.ts'], 'renders TUI agent inventory and task detail', 'renderAgentView'),
		        signal(files['packages/tui/src/render/text.ts'], 'renders parent-visible permission origin summaries', 'latest permission'),
      ],
      knownGaps: [
        'Source-aware catalog now mirrors the Claude Code precedence shape for built-in/plugin/user/project/local/flag/managed using local file/env sources; remote enterprise policy distribution is intentionally outside the solo runtime boundary.',
        'Task-host registration exists for foreground/background local subagents, copied worktree hosts, and explicit git-native worktree hosts with branch/HEAD provenance; apply lifecycle supports check-only, partial file selection, three-way mode, rollback, structured conflict details, and TUI command choices. Byte-identical prefix/cache-sharing is now probe-covered for forked subagents, and provider-backed cache-hit validation is separated into pnpm phase2.5:provider-cache-probe.',
	        'TaskStop can stop registered subagent task hosts; retained terminal/output state and CLI inspect/resume exist for retained subagent transcripts.',
		        'AgentInventory, CLI inventory, and TUI /agents inventory/inspect/resume/apply/stop exist; cross-process live stop is implemented through transcript-adjacent stop-request files observed by the running task host, while already-dead processes remain inspect/resume only.',
		        'Subagent lifecycle emits runtime events and transcript records; TUI subscribes to live notifications and replays terminal background notifications from transcript-derived retained task state.',
      ],
    },
  ]

  const failures = checks.filter(check => !check.passed)
  const result = {
    phase: 'P2.5 Runtime Governance',
    status: failures.length === 0 ? 'baseline_ok' : 'baseline_failed',
    closureEvidence: false,
    message:
      failures.length === 0
        ? 'Baseline artifacts and entry gate are present. This does not prove P2.5 completion.'
        : 'Baseline artifacts are incomplete. Fix failed checks before implementation work is treated as scoped.',
    checks,
    implementationSignals,
    nextRequiredGates: [
      'pnpm phase2.5:memory-probe',
      'pnpm phase2.5:provider-memory-probe',
      'pnpm phase2.5:compact-probe',
      'pnpm phase2.5:safety-probe',
      'pnpm phase2.5:subagent-probe',
      'pnpm phase2.5:cache-probe',
      'pnpm phase2.5:provider-cache-probe',
      'pnpm phase2.5:governance-probe',
    ],
  }

  console.log(JSON.stringify(result, null, 2))
  if (failures.length > 0) process.exitCode = 1
}

function discoverWorkspaceRoot(startCwd: string): string | undefined {
  let current = path.resolve(startCwd)
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function readRequiredFiles(
  root: string,
  relativePaths: readonly string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(root, relativePath)
    files[relativePath] = existsSync(absolutePath)
      ? await readFile(absolutePath, 'utf8')
      : ''
  }
  return files
}

function fileExistsCheck(root: string, relativePath: string): Check {
  const absolutePath = path.join(root, relativePath)
  return {
    name: `${relativePath} exists`,
    passed: existsSync(absolutePath),
    evidence: absolutePath,
  }
}

function containsCheck(content: string, name: string, expected: string): Check {
  return {
    name,
    passed: content.includes(expected),
    evidence: expected,
  }
}

function signal(content: string, label: string, needle: string): string {
  return content.includes(needle)
    ? `${label}: present (${needle})`
    : `${label}: missing (${needle})`
}

void main()
