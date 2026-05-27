import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, realpath, writeFile } from 'node:fs/promises'
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeTurnInput,
  AgentRuntimeTurnResult,
  ModelClient,
  ModelResponse,
  PermissionGate,
  PreToolUseHook,
  RuntimeProjectConfig,
  ToolResult,
  ToolUseContext,
  Tool,
  TranscriptStore,
  FileReadingLimits,
  PermissionMode,
  ResultReport,
  RuntimeSessionState,
  RuntimeSessionSnapshot,
  RuntimeSkill,
  RuntimeOperator,
  ActiveSkillRuntimeState,
  WebFetchRuntimeOptions,
  SubagentRunRequest,
  SubagentRunResult,
  SubagentTaskHost,
  SubagentLifecycleEvent,
  TaskManager,
  TranscriptEvent,
  PermissionOrigin,
  SubagentGitWorktreeMetadata,
  SubagentWorktreeDiff,
  RequestCacheSnapshot,
  CompactTokenPreflightMetadata,
} from './contracts.js'
import { buildModelContextWindow } from './context.js'
import { runPreToolUseHooks } from './hooks.js'
import { createMutablePermissionGate } from './permissions.js'
import {
  buildLlmRequestEvent,
  buildLlmResponseEvent,
  buildRequestStabilityEvent,
  filterModelVisibleEvents,
} from './requestAudit.js'
import {
  buildForkedRequestEvents,
  buildRequestCacheSnapshot,
  selectRequestCacheTools,
} from './requestCache.js'
import { injectSkillListing } from './skills.js'
import { ToolRegistry } from './tools.js'
import { createSubagentRunner } from './subagent-runner.js'
import {
  InMemoryTranscriptStore,
  JsonlTranscriptStore,
  createSessionId,
  createTimestamp,
  getProjectSessionDir,
  restoreSessionStateFromEvents,
} from './transcript.js'
import {
  buildSessionMemoryInjection,
  getSessionMemoryPath,
  isSessionMemoryFresh,
  readSessionMemory,
} from './sessionMemory.js'
import {
  injectProjectConfig,
  injectOperatorGuidance,
  mergePromptDerivedProjectConfig,
  derivePromptIgnorePatterns,
  expandPromptIgnoreToken,
  isLikelyIgnorablePathPart,
  injectSessionMemory,
  injectCapabilityReplay,
  injectRuntimeProgress,
  injectActiveTask,
  countLeadingRuntimeStateEvents,
  loadSessionMemory,
  getTranscriptPathForStore,
  buildSystemPrompt,
  buildStaticSystemPrompt,
  buildDynamicContext,
} from './context-injection.js'

import { createLSPServerManager, type LSPServerManager } from '../services/lsp/LSPServerManager.js'
import { DEFAULT_LSP_CONFIGS } from '../services/lsp/config.js'
import { checkForLSPDiagnostics } from '../services/lsp/LSPDiagnosticRegistry.js'
import { createTaskManager } from './taskManager.js'
import { resolveTaskStopRequestPath } from './taskControl.js'
import {
  compactTranscript,
  evaluateAutoCompactTranscript,
  resolveCompactContextWindowBudget,
} from './compact.js'
import { createToolRegistry } from './tools.js'

const AUTO_COMPACT_THRESHOLD = 30
const REACTIVE_EVENT_COUNT = 10
const AUTO_COMPACT_TOKEN_BUDGET = 24_000
const AUTO_COMPACT_PRESSURE_THRESHOLD = 0.85

const MUTATING_TOOLS = new Set(['Write', 'Edit', 'Bash', 'ApplyPatch'])

async function saveAutoSnapshot(cwd: string): Promise<void> {
  const snapDir = path.join(cwd, '.vigilon', 'snapshots', 'auto')
  await mkdir(snapDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '_')
  const patchPath = path.join(snapDir, `${timestamp}.patch`)
  try {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('git', ['diff', '--binary', 'HEAD'], {
      cwd, maxBuffer: 10 * 1024 * 1024, timeout: 5_000,
    })
    if (stdout) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(patchPath, stdout, 'utf8')
    }
  } catch {
    // Auto-snapshot is best-effort — never block the tool
  }
}

class AsyncEventQueue<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(value: T | undefined) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(item)
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(undefined)
    }
  }

  next(): Promise<T | undefined> {
    const item = this.items.shift()
    if (item) return Promise.resolve(item)
    if (this.closed) return Promise.resolve(undefined)
    return new Promise(resolve => {
      this.waiters.push(resolve)
    })
  }

  drain(): T[] {
    return this.items.splice(0, this.items.length)
  }
}

export type VigilonAgentRuntimeOptions = {
  modelClient: ModelClient
  tools?: ToolRegistry
  transcript?: TranscriptStore
  permissionGate?: PermissionGate
  preToolUseHooks?: PreToolUseHook[]
  skills?: readonly RuntimeSkill[]
  maxTurns?: number
  fileReadingLimits?: FileReadingLimits
  globLimits?: {
    maxResults?: number
  }
  bashLimits?: {
    timeoutMs?: number
    maxOutputChars?: number
  }
  projectConfig?: RuntimeProjectConfig
  operator?: RuntimeOperator
  toolResultReplacementLimit?: number
  permissionMode?: PermissionMode
  resume?: RuntimeSessionSnapshot
  lspServerManager?: LSPServerManager
  taskManager?: TaskManager
  webFetch?: WebFetchRuntimeOptions
  operatorGuidance?: string
  stopAfterResultReport?: boolean
  permissionOrigin?: PermissionOrigin
  autoCompactTokenBudget?: number
  autoCompactPressureThreshold?: number
  forkRequestCacheSnapshot?: RequestCacheSnapshot
  /** Shell command to run after mutating tools. */
  harnessCommand?: string
  /** Override reasoning depth. 'high' forces thinking=high on every model request. */
  effort?: 'low' | 'medium' | 'high'
}

export function createVigilonAgentRuntime(
  options: VigilonAgentRuntimeOptions,
): AgentRuntime {
  const tools = options.tools ?? new ToolRegistry()
  const transcript = options.transcript ?? new InMemoryTranscriptStore()
  const lspServerManager = options.lspServerManager ?? createLSPServerManager()
  const taskManager = options.taskManager ?? createTaskManager()

  // Mutable skills container for /reload-skills support
  const skillsRef: { current: readonly RuntimeSkill[] } = {
    current: options.skills ?? [],
  }
  
  // Initialize LSP manager if it hasn't been initialized
  if (lspServerManager.getAllServers().size === 0) {
    lspServerManager.initialize(DEFAULT_LSP_CONFIGS).catch(err =>
      console.error('LSP initialization failed:', err),
    )
  }

  const sessionState: RuntimeSessionState =
    options.resume?.sessionState ??
    restoreSessionStateFromEvents(
      options.resume?.events ?? [],
      options.permissionMode ?? 'ask',
    )
  sessionState.discoveredToolNames = sessionState.discoveredToolNames ?? []
  sessionState.toolReferenceDeltas = sessionState.toolReferenceDeltas ?? []
  sessionState.mcpInstructions = sessionState.mcpInstructions ?? []
  sessionState.permissionMode =
    sessionState.permissionMode ?? options.permissionMode ?? 'ask'
  const mutablePermissionGate = createMutablePermissionGate({
    mode: sessionState.permissionMode,
    transcript,
  })
  const permissionGate = options.permissionGate ?? mutablePermissionGate
  const maxTurns = options.maxTurns
  const readFileState = new Map()
  const searchCount = { grep: 0, glob: 0 }
  const lspOpenFileState = new Set<string>()
  syncPermissionModeFromSession(sessionState, permissionGate)
  const runSubagent = createSubagentRunner({
    modelClient: options.modelClient,
    tools,
    parentTranscript: transcript,
    permissionGate,
    preToolUseHooks: options.preToolUseHooks,
    fileReadingLimits: options.fileReadingLimits,
    globLimits: options.globLimits,
    bashLimits: options.bashLimits,
    projectConfig: options.projectConfig,
    operator: options.operator,
    skills: skillsRef.current,
    toolResultReplacementLimit: options.toolResultReplacementLimit,
    taskManager,
    sessionState,
  })

  return {
    reloadSkills(skills: readonly RuntimeSkill[]) {
      skillsRef.current = skills
    },
    async *runTurn(
      input: AgentRuntimeTurnInput,
    ): AsyncIterable<AgentRuntimeEvent> {
      await transcript.append({
        type: 'user',
        content: input.prompt,
        timestamp: createTimestamp(),
      })

      let finalMessage = ''
      let stopReason: ModelResponse['stopReason'] = 'end_turn'
      let turns = 0
      const turnProjectConfig = mergePromptDerivedProjectConfig(
        options.projectConfig,
        input.prompt,
      )
      let resourcesCleaned = false
      const cleanupResources = async (): Promise<void> => {
        if (resourcesCleaned) return
        resourcesCleaned = true
        await lspServerManager.shutdown()
      }

      try {
        await lspServerManager.initialize(DEFAULT_LSP_CONFIGS)

        // Static prefix + dynamic suffix in one system message.
        // DeepSeek's prefix cache keeps the static part across turns.
        const systemPrompt = buildStaticSystemPrompt() + '\n\n' + buildDynamicContext({
          cwd: input.cwd,
          permissionMode: options.permissionMode,
          projectConfig: turnProjectConfig,
          skills: skillsRef.current,
          projectInstructions: options.operatorGuidance,
        })

        // Circuit breaker at 50 turns — only catches true infinite loops
      while (turns < (maxTurns !== undefined ? maxTurns + 2 : 50)) {
        turns += 1
        // Check for and append LSP diagnostics
        const pendingLspDiagnostics = checkForLSPDiagnostics()
        for (const diagnostic of pendingLspDiagnostics) {
          await transcript.append({
            type: 'lsp-diagnostics',
            serverName: diagnostic.serverName,
            files: diagnostic.files,
            timestamp: createTimestamp(),
          })
        }

        // Auto-compaction check
        const allEvents = await transcript.readAll()
        const autoCompactContextBudget = resolveCompactContextWindowBudget({
          tokenBudget:
            options.autoCompactTokenBudget ?? AUTO_COMPACT_TOKEN_BUDGET,
          budgetSource: options.autoCompactTokenBudget === undefined
            ? 'runtime-default-token-budget'
            : 'explicit-token-budget',
          modelId: options.modelClient.id,
          pressureThreshold:
            options.autoCompactPressureThreshold ?? AUTO_COMPACT_PRESSURE_THRESHOLD,
        })
        let compactEvaluation = evaluateAutoCompactTranscript(allEvents, {
          threshold: AUTO_COMPACT_THRESHOLD,
          querySource: 'main',
          contextBudget: autoCompactContextBudget,
        })
        if (
          compactEvaluation.tokenPressure?.tokenCountSource ===
            'runtime-char-estimate' &&
          options.modelClient.countInputTokens
        ) {
          const preflightSessionMemory = await loadSessionMemory({
            cwd: input.cwd,
            sessionsDir: undefined,
            transcriptPath: getTranscriptPathForStore(transcript),
            sessionId: options.resume?.sessionId ?? transcript.sessionId,
            eventCount: allEvents.length,
          })
          if (preflightSessionMemory) {
            sessionState.memoryFreshness = preflightSessionMemory.fresh
              ? 'fresh'
              : 'stale'
          }
          const preflightContextWindow = buildModelContextWindow(allEvents, {
            toolResultReplacementLimit: options.toolResultReplacementLimit,
          })
          const preflightRequestEvents = injectSkillListing(
            injectRuntimeProgress(
              injectActiveTask(
                injectCapabilityReplay(
                  injectSessionMemory(
                    preflightContextWindow.events,
                    preflightSessionMemory?.record,
                    preflightSessionMemory?.fresh ?? false,
                    Boolean(options.resume),
                  ),
                  sessionState,
                  Boolean(options.resume),
                  [...readFileState.keys()], searchCount,
                ),
                input.prompt,
                turnProjectConfig,
              ),
              sessionState,
              maxTurns,
              turns,
            ),
            skillsRef.current,
          )
          const preflightVisibleEvents = filterModelVisibleEvents(
            buildForkedRequestEvents({
              parentSnapshot: options.forkRequestCacheSnapshot,
              childEvents: preflightRequestEvents,
            }),
          )
          const preflightVisibleTools = selectVisibleTools(
            tools.list(),
            sessionState,
          )
          const preflightRequestTools = selectRequestCacheTools({
            parentSnapshot: options.forkRequestCacheSnapshot,
            childTools: preflightVisibleTools,
          })
          const tokenPreflight = await resolveCompactTokenPreflight({
            modelClient: options.modelClient,
            messages: preflightVisibleEvents,
            tools: preflightRequestTools,
            abortSignal: input.abortSignal,
            systemPrompt,
          })
          compactEvaluation = evaluateAutoCompactTranscript(allEvents, {
            threshold: AUTO_COMPACT_THRESHOLD,
            querySource: 'main',
            contextBudget: autoCompactContextBudget,
            tokenPreflight,
          })
        }
        if (compactEvaluation.shouldCompact) {
          const memory = await loadSessionMemory({
            cwd: input.cwd,
            sessionsDir: undefined,
            transcriptPath: getTranscriptPathForStore(transcript),
            sessionId: options.resume?.sessionId ?? transcript.sessionId,
            eventCount: allEvents.length,
          })
          await compactTranscript({
            transcript,
            summary:
              memory?.content ?? 'Auto-compacting transcript to optimize context window.',
            trigger: 'auto',
            querySource: 'main',
            sessionState,
            reactiveEventCount: REACTIVE_EVENT_COUNT,
            strategy: memory?.content ? 'session-memory' : 'reactive',
            tokenPressure: compactEvaluation.tokenPressure,
            cleanupState: {
              lspOpenFileState,
              readFileState,
            },
          })
        }

        yield { type: 'model-request-started' }

        const transcriptEvents = await transcript.readAll()
        const contextWindow = buildModelContextWindow(transcriptEvents, {
          toolResultReplacementLimit: options.toolResultReplacementLimit,
        })
        if (contextWindow.newContentReplacements.length > 0) {
          await transcript.append({
            type: 'content-replacement',
            replacements: contextWindow.newContentReplacements,
            timestamp: createTimestamp(),
          })
        }
        const sessionMemory = await loadSessionMemory({
          cwd: input.cwd,
          sessionsDir: undefined,
          transcriptPath:
            options.resume?.transcriptPath ?? getTranscriptPathForStore(transcript),
          sessionId: options.resume?.sessionId ?? transcript.sessionId,
          eventCount: transcriptEvents.length,
        })
        if (sessionMemory) {
          sessionState.memoryFreshness = sessionMemory.fresh ? 'fresh' : 'stale'
        }
        const requestEvents = injectSkillListing(
          injectRuntimeProgress(
            injectActiveTask(
              injectCapabilityReplay(
                injectSessionMemory(
                  contextWindow.events,
                  sessionMemory?.record,
                  sessionMemory?.fresh ?? false,
                  Boolean(options.resume),
                ),
                sessionState,
                Boolean(options.resume),
                  [...readFileState.keys()], searchCount,
              ),
              input.prompt,
              turnProjectConfig,
            ),
            sessionState,
            maxTurns,
            turns,
          ),
          skillsRef.current,
        )
        const visibleEvents = filterModelVisibleEvents(
          buildForkedRequestEvents({
            parentSnapshot: options.forkRequestCacheSnapshot,
            childEvents: requestEvents,
          }),
        )
        const visibleTools = selectVisibleTools(
          tools.list(),
          sessionState,
        )
        const requestTools = selectRequestCacheTools({
          parentSnapshot: options.forkRequestCacheSnapshot,
          childTools: visibleTools,
        })
        const visibleToolNames = new Set(requestTools.map(tool => tool.name))

        const requestAuditEvent = buildLlmRequestEvent({
          events: await transcript.readAll(),
          visibleEvents,
          tools: requestTools,
          model: options.modelClient.id,
          compacted: contextWindow.compacted,
          compactBoundaryIndex: contextWindow.compactBoundaryIndex,
          droppedEventCount: contextWindow.droppedEventCount,
          compactCapability: {
            discoveredToolNames: sessionState.discoveredToolNames,
            toolReferenceDeltas: sessionState.toolReferenceDeltas,
            approvedPlan: sessionState.approvedPlan,
            pendingPlan: sessionState.pendingPlan,
            verificationNotes: sessionState.verificationNotes,
            mcpInstructions: sessionState.mcpInstructions,
            activeSkill: sessionState.activeSkill,
            memoryFreshness: sessionState.memoryFreshness,
          },
          projectConfig: turnProjectConfig,
          skills: skillsRef.current,
          cachePrefixSource: options.forkRequestCacheSnapshot
            ? 'fork-shared-prefix'
            : 'request',
          cachePrefixSharedEventCount:
            options.forkRequestCacheSnapshot?.visibleEvents.length,
          parentCachePrefixHash:
            options.forkRequestCacheSnapshot?.cachePrefix.canonicalPrefixHash,
          timestamp: createTimestamp(),
        })
        await transcript.append(requestAuditEvent)
        const requestCacheSnapshot = buildRequestCacheSnapshot({
          model: options.modelClient.id,
          visibleEvents,
          tools: requestTools,
          cachePrefix: requestAuditEvent.cachePrefix,
        })

        // Capture Request Stability State
        sessionState.systemPrompt = visibleEvents.find(e => e.type === 'assistant' || e.type === 'user')?.content // Simplification
        sessionState.toolSchema = JSON.stringify(requestTools.map(t => ({ name: t.name, description: t.description, schema: t.inputJsonSchema })))
        sessionState.modelParams = { model: options.modelClient.id }

        const requestStartedAt = Date.now()
        const response = await options.modelClient.createMessage({
          messages: visibleEvents,
          tools: requestTools,
          cachePrefix: requestAuditEvent.cachePrefix ?? undefined,
          abortSignal: input.abortSignal,
          systemPrompt,
          ...(options.effort === 'high' ? { thinking: 'high' as const } : {}),
        })
        const responseAuditEvent = buildLlmResponseEvent({
          request: requestAuditEvent,
          stopReason: response.stopReason,
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          totalTokens: response.usage?.totalTokens,
          cacheReadInputTokens: response.usage?.cacheReadInputTokens,
          cacheCreationInputTokens: response.usage?.cacheCreationInputTokens,
          durationMs: Date.now() - requestStartedAt,
          toolCallCount: response.toolCalls.length,
          assistantChars: response.content.length,
          reasoningChars: response.reasoningContent?.length,
          errorMessage: response.stopReason === 'error' ? response.content : undefined,
          timestamp: createTimestamp(),
        })
        await transcript.append(responseAuditEvent)
        const requestStabilityEvent = buildRequestStabilityEvent({
          events: await transcript.readAll(),
          currentRequest: requestAuditEvent,
          currentResponse: responseAuditEvent,
          timestamp: createTimestamp(),
        })
        if (requestStabilityEvent) {
          await transcript.append(requestStabilityEvent)
          yield { type: 'cache-stability-change', event: requestStabilityEvent }
        }

        stopReason = response.stopReason
        if (
          response.content ||
          response.reasoningContent ||
          response.toolCalls.length > 0
        ) {
          finalMessage = response.content
          await transcript.append({
            type: 'assistant',
            content: response.content,
            reasoningContent: response.reasoningContent,
            toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
            timestamp: createTimestamp(),
            usage: response.usage,
          })
        }
        yield { type: 'model-response-received', response }

        // Track goal token usage
        if (sessionState.goal?.status === 'active' && response.usage) {
          sessionState.goal.tokensUsed +=
            (response.usage.inputTokens ?? 0) + (response.usage.outputTokens ?? 0)
          sessionState.goal.updatedAt = createTimestamp()
          if (
            sessionState.goal.tokenBudget != null &&
            sessionState.goal.tokensUsed >= sessionState.goal.tokenBudget
          ) {
            sessionState.goal.status = 'budget_limited'
          }
        }

        if (response.toolCalls.length === 0) {
          // Goal continuation: if goal is active and model stopped naturally,
          // inject a minimal continuation prompt to keep it going.
          const goal = sessionState.goal
          if (goal?.status === 'active') {
            await transcript.append({
              type: 'user',
              content:
                'Continue working toward the goal. If complete, call update_goal with status complete.',
              timestamp: createTimestamp(),
            })
            continue
          }
          break
        }

        const context: ToolUseContext = {
          cwd: input.cwd,
          abortSignal: input.abortSignal,
          permissionGate,
          transcript,
          sessionState,
          permissionOrigin:
            options.permissionOrigin ?? {
              agentId: 'main',
              agentRole: 'main',
            },
          readFileState,
          lspOpenFileState,
          fileReadingLimits: options.fileReadingLimits,
          globLimits: options.globLimits,
          bashLimits: options.bashLimits,
          projectConfig: turnProjectConfig,
          operator: options.operator,
          webFetch: options.webFetch,
          lspServerManager,
          taskManager,
          runSubagent,
          requestCacheSnapshot,
          tools,
        }

        // Partition tool calls: read-only tools can run in parallel within a
        // partition; write/destructive tools each get their own serial partition.
        // Mirrors Claude Code StreamingToolExecutor partition model.
        const partitions = partitionToolCalls(response.toolCalls, tools)

        for (const partition of partitions) {
          const isParallel = partition.length > 1

          if (isParallel) {
            // Parallel execution for read-only tools within the same partition.
            // Each tool's transcript writes and yields are independent.
            const results = await Promise.all(
              partition.map(call =>
                executeToolCall(call, {
                  tools,
                  visibleToolNames,
                  sessionState,
                  context,
                  options,
                  searchCount,
                  transcript,
                  input,
                  harnessCommand: options.harnessCommand,
                }),
              ),
            )

            for (const genResult of results) {
              for (const event of genResult.events) {
                yield event
              }
              // Apply post-execution side effects in order (discoveredTools etc.)
              applyToolSideEffects(genResult, sessionState, tools)
            }
          } else {
            const call = partition[0]
            const genResult = await executeToolCall(call, {
              tools,
              visibleToolNames,
              sessionState,
              context,
              options,
              searchCount,
              transcript,
              input,
              harnessCommand: options.harnessCommand,
            })

            for (const event of genResult.events) {
              yield event
            }
            applyToolSideEffects(genResult, sessionState, tools)
          }
        }

        if (
          options.stopAfterResultReport &&
          sessionState.handoffReport
        ) {
          finalMessage = sessionState.handoffReport.finalMessage
          stopReason = 'end_turn'
          break
        }

        if (input.abortSignal.aborted) {
          stopReason = 'error'
          finalMessage = 'Turn aborted'
          break
        }
      }

      if (maxTurns !== undefined && turns >= maxTurns + 2 && stopReason === 'tool_use') {
        finalMessage =
          finalMessage || 'Task stopped: safety limit reached.'
        stopReason = 'max_turns'
      }

      const events = await transcript.readAll()
      const result: AgentRuntimeTurnResult = {
        finalMessage,
        events,
        stopReason,
        turns,
        report: buildResultReport(finalMessage, stopReason, events, sessionState),
      }
      await cleanupResources()
      yield { type: 'turn-finished', result }
    } finally {
      await cleanupResources()
    }
    },
  }
}

function selectVisibleTools(
  allTools: readonly Tool[],
  sessionState: RuntimeSessionState,
): Tool[] {
  const activeAllowed = sessionState.activeSkill
    ? new Set(sessionState.activeSkill.allowedTools)
    : undefined
  return allTools.filter(tool => {
    if (activeAllowed && !activeAllowed.has(tool.name)) return false
    if (!tool.deferred) return true
    return sessionState.discoveredToolNames.includes(tool.name)
  })
}


function truncateText(value: string | undefined, maxChars: number): string {
  if (!value) return ''
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
}

async function invokeTool(
  pending: Promise<ToolResult>,
  expectedToolCallId: string,
): Promise<ToolResult> {
  try {
    const result = await pending
    return {
      ...result,
      toolCallId: result.toolCallId || expectedToolCallId,
    }
  } catch (error) {
    return createFailedToolResult(
      expectedToolCallId,
      error instanceof Error ? error.message : String(error),
    )
  }
}

function createFailedToolResult(toolCallId: string, content: string): ToolResult {
  return {
    toolCallId,
    ok: false,
    content,
  }
}

function hashToolSchema(tool: Tool): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputJsonSchema: tool.inputJsonSchema,
        readOnly: tool.readOnly ?? false,
      }),
    )
    .digest('hex')
}

function isActiveSkillRuntimeState(value: unknown): value is ActiveSkillRuntimeState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === 'string' &&
    Array.isArray(record.allowedTools) &&
    record.allowedTools.every(item => typeof item === 'string') &&
    typeof record.activatedAt === 'string'
  )
}

function isToolReferenceDelta(value: unknown): value is RuntimeSessionState['toolReferenceDeltas'][number] {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.name === 'string' &&
    typeof record.reason === 'string' &&
    typeof record.schemaHash === 'string' &&
    typeof record.discoveredAt === 'string'
  )
}

async function resolveCompactTokenPreflight(options: {
  modelClient: ModelClient
  messages: TranscriptEvent[]
  tools: Tool[]
  abortSignal: AbortSignal
  systemPrompt?: string
}): Promise<CompactTokenPreflightMetadata | undefined> {
  if (!options.modelClient.countInputTokens) return undefined
  const provider = providerFromModelClientId(options.modelClient.id)
  const common = {
    source: 'model-client-count-input-tokens' as const,
    modelId: options.modelClient.id,
    ...(provider ? { provider } : {}),
    requestEventCount: options.messages.length,
    toolCount: options.tools.length,
  }
  const result = await options.modelClient.countInputTokens({
    messages: options.messages,
    tools: options.tools,
    abortSignal: options.abortSignal,
    systemPrompt: options.systemPrompt,
  })
  if (result.ok) {
    return {
      status: 'ok',
      ...common,
      inputTokens: result.inputTokens,
      ...(result.usage?.totalTokens !== undefined
        ? { totalTokens: result.usage.totalTokens }
        : {}),
      ...(result.usage?.cacheReadInputTokens !== undefined
        ? { cacheReadInputTokens: result.usage.cacheReadInputTokens }
        : {}),
      ...(result.usage?.cacheCreationInputTokens !== undefined
        ? { cacheCreationInputTokens: result.usage.cacheCreationInputTokens }
        : {}),
    }
  }
  if (result.errorKind === 'context_overflow') {
    return {
      status: 'context-overflow',
      ...common,
      errorMessage: result.errorMessage,
    }
  }
  return {
    status: 'failed',
    ...common,
    errorKind: result.errorKind,
    errorMessage: result.errorMessage,
  }
}

function providerFromModelClientId(modelClientId: string): string | undefined {
  const separatorIndex = modelClientId.indexOf(':')
  if (separatorIndex <= 0) return undefined
  return modelClientId.slice(0, separatorIndex)
}

function buildResultReport(
  finalMessage: string,
  stopReason: ModelResponse['stopReason'],
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  sessionState: RuntimeSessionState,
): ResultReport {
  const toolCallsById = new Map(
    events
      .filter(event => event.type === 'tool-call')
      .map(event => [event.call.id, event.call.name]),
  )
  const toolResults = events
    .filter(event => event.type === 'tool-result')
    .map(event => ({
      toolCallId: event.result.toolCallId,
      ok: event.result.ok,
      content: event.result.content,
    }))
  const fileChanges = events
    .filter(event => event.type === 'tool-result')
    .flatMap(event => {
      const metadata = event.result.metadata
      if (
        !event.result.ok ||
        typeof metadata?.filePath !== 'string' ||
        !isFileChangeType(metadata.type) ||
        typeof metadata.diff !== 'string' ||
        !metadata.diff
      ) {
        return []
      }
      return [
        {
          toolCallId: event.result.toolCallId,
          toolName: toolCallsById.get(event.result.toolCallId) ?? 'unknown',
          filePath: metadata.filePath,
          type: metadata.type,
          diff: metadata.diff,
        },
      ]
    })
  const warnings = buildResultWarnings(stopReason, sessionState)
  return {
    status: stopReason === 'error' ? 'error' : stopReason === 'end_turn' ? 'completed' : 'stopped',
    finalMessage,
    todos: [...sessionState.todos],
    warnings,
    approvedPlan: sessionState.approvedPlan,
    handoffReport: sessionState.handoffReport
      ? {
          finalMessage: sessionState.handoffReport.finalMessage,
          changes: [...sessionState.handoffReport.changes],
          verified: [...sessionState.handoffReport.verified],
          unverified: [...sessionState.handoffReport.unverified],
          risks: [...sessionState.handoffReport.risks],
        }
      : undefined,
    verificationNotes: [...sessionState.verificationNotes],
    fileChanges,
    toolResults,
  }
}

function buildResultWarnings(
  stopReason: ModelResponse['stopReason'],
  sessionState: RuntimeSessionState,
): string[] {
  const warnings: string[] = []
  const incompleteTodos = sessionState.todos.filter(todo => todo.status !== 'completed')
  if (stopReason === 'end_turn' && incompleteTodos.length > 0) {
    warnings.push(
      `Assistant ended with ${incompleteTodos.length} incomplete todo(s): ${incompleteTodos
        .map(todo => `${todo.status}:${todo.content}`)
        .join(' | ')}`,
    )
  }
  if (
    stopReason === 'end_turn' &&
    sessionState.approvedPlan &&
    sessionState.verificationNotes.length === 0 &&
    !sessionState.handoffReport
  ) {
    warnings.push('Assistant ended after an approved plan without recorded verification notes.')
  }
  return warnings
}

export function syncPermissionModeFromSession(
  sessionState: RuntimeSessionState,
  permissionGate: PermissionGate,
): void {
  if ('setMode' in permissionGate && typeof permissionGate.setMode === 'function') {
    permissionGate.setMode(sessionState.permissionMode)
  }
}

function isFileChangeType(value: unknown): value is 'create' | 'update' {
  return value === 'create' || value === 'update'
}

// ---------------------------------------------------------------------------
// Tool composition: partition-based parallel execution
// ---------------------------------------------------------------------------

type ToolCall = {
  name: string
  id: string
  input: unknown
}

type ToolExecutionResult = {
  call: ToolCall
  result: ToolResult
  events: AgentRuntimeEvent[]
}

type ToolExecutionContext = {
  tools: ToolRegistry
  visibleToolNames: Set<string>
  sessionState: RuntimeSessionState
  context: ToolUseContext
  options: {
    preToolUseHooks?: readonly PreToolUseHook[]
  }
  searchCount: { grep: number; glob: number }
  transcript: TranscriptStore
  input: AgentRuntimeTurnInput
  harnessCommand?: string
}

/**
 * Partition tool calls following Claude Code's StreamingToolExecutor model:
 * - Read-only tools form a single parallel partition
 * - Each write/destructive tool gets its own serial partition
 * - Partitions execute in order; within a partition, tools run concurrently
 */
function partitionToolCalls(
  calls: readonly ToolCall[],
  tools: ToolRegistry,
): ToolCall[][] {
  const partitions: ToolCall[][] = []
  let current: ToolCall[] = []

  for (const call of calls) {
    const tool = tools.find(call.name)
    const isReadOnly = tool?.readOnly === true

    if (isReadOnly) {
      current.push(call)
    } else {
      if (current.length > 0) {
        partitions.push(current)
        current = []
      }
      partitions.push([call])
    }
  }

  if (current.length > 0) partitions.push(current)
  return partitions
}

async function executeToolCall(
  call: ToolCall,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  const events: AgentRuntimeEvent[] = []
  const { tools, visibleToolNames, sessionState, context, options, searchCount, transcript, input } = ctx

  await transcript.append({
    type: 'tool-call',
    call,
    timestamp: createTimestamp(),
  })
  events.push({ type: 'tool-started', call })

  const tool = tools.find(call.name)

  // -- Gate: tool not visible (deferred or unknown) --
  if (!visibleToolNames.has(call.name)) {
    const reason = tool?.deferred
      ? [
          `Deferred tool schema was not sent for ${tool.name}.`,
          'Call ToolSearch first to materialize this tool schema, then retry the tool call.',
        ].join('\n')
      : [
          `Tool ${call.name} is not available in the current model request.`,
          `Available tools: ${[...visibleToolNames].join(', ') || '(none)'}`,
        ].join('\n')
    const result = createFailedToolResult(call.id, reason)
    await transcript.append({ type: 'tool-result', result, timestamp: createTimestamp() })
    events.push({ type: 'tool-finished', result })
    return { call, result, events }
  }

  // -- Gate: blocked by active skill --
  if (tool && sessionState.activeSkill && !sessionState.activeSkill.allowedTools.includes(tool.name)) {
    const result = createFailedToolResult(
      call.id,
      [
        `Tool ${tool.name} is blocked by active skill ${sessionState.activeSkill.name}.`,
        `Allowed tools: ${sessionState.activeSkill.allowedTools.join(', ') || '(none)'}`,
      ].join('\n'),
    )
    await transcript.append({ type: 'tool-result', result, timestamp: createTimestamp() })
    events.push({ type: 'tool-finished', result })
    return { call, result, events }
  }

  // -- Gate: deferred tool not yet discovered --
  if (tool?.deferred && !sessionState.discoveredToolNames.includes(tool.name)) {
    const result = createFailedToolResult(
      call.id,
      [
        `Deferred tool schema was not sent for ${tool.name}.`,
        'Call ToolSearch first to materialize this tool schema, then retry the tool call.',
      ].join('\n'),
    )
    await transcript.append({ type: 'tool-result', result, timestamp: createTimestamp() })
    events.push({ type: 'tool-finished', result })
    return { call, result, events }
  }

  // -- PreToolUse hook --
  const hookDecision =
    tool && options.preToolUseHooks?.length
      ? await runPreToolUseHooks({
          hooks: options.preToolUseHooks,
          toolCall: call,
          cwd: input.cwd,
          transcript,
        })
      : { outcome: 'allow' as const, reason: 'No PreToolUse hook configured' }

  let result: ToolResult
  if (hookDecision.outcome === 'block') {
    result = createFailedToolResult(call.id, `PreToolUse hook blocked ${call.name}: ${hookDecision.reason}`)
  } else if (tool) {
    // -- Execute tool --
    const lifecycleQueue = new AsyncEventQueue<SubagentLifecycleEvent>()
    const toolContext: ToolUseContext = {
      ...context,
      subagentLifecycle: {
        emit(event) {
          lifecycleQueue.push(event)
        },
      },
    }
    const toolPromise = invokeTool(tool.invoke(call.input, toolContext), call.id)

    if (MUTATING_TOOLS.has(call.name)) {
      saveAutoSnapshot(input.cwd).catch(() => {})
    }
    let toolSettled = false
    void toolPromise.then(
      () => { toolSettled = true; lifecycleQueue.close() },
      () => { toolSettled = true; lifecycleQueue.close() },
    )
    while (!toolSettled) {
      const lifecycleEvent = await lifecycleQueue.next()
      if (lifecycleEvent) {
        events.push({ type: 'subagent-lifecycle', event: lifecycleEvent })
      }
    }
    for (const lifecycleEvent of lifecycleQueue.drain()) {
      events.push({ type: 'subagent-lifecycle', event: lifecycleEvent })
    }
    result = await toolPromise
  } else {
    result = createFailedToolResult(call.id, `Unknown tool: ${call.name}`)
  }

  if (result.ok) {
    if (call.name === 'Grep') searchCount.grep += 1
    if (call.name === 'Glob') searchCount.glob += 1

    // Harness: run post-mutation validation command
    if (ctx.harnessCommand && MUTATING_TOOLS.has(call.name)) {
      try {
        const { execFile } = await import('node:child_process')
        const { stderr, stdout } = await new Promise<{ stdout: string; stderr: string }>(
          (resolve, reject) => {
            execFile('sh', ['-c', ctx.harnessCommand!], {
              cwd: input.cwd,
              timeout: 30_000,
              env: { ...process.env },
            }, (err, stdout, stderr) => {
              if (err && err.killed) reject(new Error('Harness command timed out'))
              else resolve({ stdout, stderr })
            })
          },
        )
        if (stderr.trim() || stdout.trim()) {
          result = {
            ...result,
            content: result.content + '\n\n[harness] ' + ctx.harnessCommand + '\n' +
              (stderr.trim() || stdout.trim()),
          }
        }
      } catch {
        // Harness failure is non-blocking — it's feedback, not a gate
      }
    }
  }

  await transcript.append({ type: 'tool-result', result, timestamp: createTimestamp() })
  events.push({ type: 'tool-finished', result })

  return { call, result, events }
}

function applyToolSideEffects(
  execResult: ToolExecutionResult,
  sessionState: RuntimeSessionState,
  tools: ToolRegistry,
): void {
  const { result } = execResult

  if (result.metadata?.discoveredTools && Array.isArray(result.metadata.discoveredTools)) {
    for (const name of result.metadata.discoveredTools) {
      if (typeof name === 'string' && !sessionState.discoveredToolNames.includes(name)) {
        sessionState.discoveredToolNames.push(name)
        const discoveredTool = tools.find(name)
        if (discoveredTool) {
          sessionState.toolReferenceDeltas.push({
            name,
            reason: `ToolSearch materialized ${name}`,
            schemaHash: hashToolSchema(discoveredTool),
            discoveredAt: createTimestamp(),
          })
        }
      }
    }
  }
  if (result.metadata?.toolReferenceDeltas && Array.isArray(result.metadata.toolReferenceDeltas)) {
    for (const delta of result.metadata.toolReferenceDeltas) {
      if (isToolReferenceDelta(delta)) {
        const alreadyTracked = sessionState.toolReferenceDeltas.some(
          existing =>
            existing.name === delta.name &&
            existing.schemaHash === delta.schemaHash,
        )
        if (!alreadyTracked) sessionState.toolReferenceDeltas.push(delta)
      }
    }
  }
  if (result.metadata?.activeSkill && isActiveSkillRuntimeState(result.metadata.activeSkill)) {
    sessionState.activeSkill = result.metadata.activeSkill
  }
}
