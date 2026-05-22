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
}

export function createVigilonAgentRuntime(
  options: VigilonAgentRuntimeOptions,
): AgentRuntime {
  const tools = options.tools ?? new ToolRegistry()
  const transcript = options.transcript ?? new InMemoryTranscriptStore()
  const lspServerManager = options.lspServerManager ?? createLSPServerManager()
  const taskManager = options.taskManager ?? createTaskManager()
  
  // Initialize LSP manager if it hasn't been initialized
  if (lspServerManager.getAllServers().size === 0) {
    void lspServerManager.initialize(DEFAULT_LSP_CONFIGS)
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
    skills: options.skills,
    toolResultReplacementLimit: options.toolResultReplacementLimit,
    taskManager,
    sessionState,
  })

  return {
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

        while (!maxTurns || turns < maxTurns) {
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
          const preflightRequestEvents = injectOperatorGuidance(
            injectProjectConfig(
              injectSkillListing(
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
                    ),
                    input.prompt,
                    turnProjectConfig,
                  ),
                  sessionState,
                ),
                options.skills ?? [],
              ),
              turnProjectConfig,
            ),
            options.operatorGuidance,
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
        const requestEvents = injectOperatorGuidance(
          injectProjectConfig(
            injectSkillListing(
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
                  ),
                  input.prompt,
                  turnProjectConfig,
                ),
                sessionState,
              ),
              options.skills ?? [],
            ),
            turnProjectConfig,
          ),
          options.operatorGuidance,
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
          skills: options.skills,
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

        if (response.toolCalls.length === 0) {
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

        for (const call of response.toolCalls) {
          await transcript.append({
            type: 'tool-call',
            call,
            timestamp: createTimestamp(),
          })
          yield { type: 'tool-started', call }

          const tool = tools.find(call.name)
          if (!visibleToolNames.has(call.name)) {
            if (tool?.deferred) {
              const result = createFailedToolResult(
                call.id,
                [
                  `Deferred tool schema was not sent for ${tool.name}.`,
                  'Call ToolSearch first to materialize this tool schema, then retry the tool call.',
                ].join('\n'),
              )
              await transcript.append({
                type: 'tool-result',
                result,
                timestamp: createTimestamp(),
              })
              yield { type: 'tool-finished', result }
              continue
            }
            const result = createFailedToolResult(
              call.id,
              [
                `Tool ${call.name} is not available in the current model request.`,
                `Available tools: ${[...visibleToolNames].join(', ') || '(none)'}`,
              ].join('\n'),
            )
            await transcript.append({
              type: 'tool-result',
              result,
              timestamp: createTimestamp(),
            })
            yield { type: 'tool-finished', result }
            continue
          }
          if (
            tool &&
            sessionState.activeSkill &&
            !sessionState.activeSkill.allowedTools.includes(tool.name)
          ) {
            const result = createFailedToolResult(
              call.id,
              [
                `Tool ${tool.name} is blocked by active skill ${sessionState.activeSkill.name}.`,
                `Allowed tools: ${sessionState.activeSkill.allowedTools.join(', ') || '(none)'}`,
              ].join('\n'),
            )
            await transcript.append({
              type: 'tool-result',
              result,
              timestamp: createTimestamp(),
            })
            yield { type: 'tool-finished', result }
            continue
          }
          if (tool?.deferred && !sessionState.discoveredToolNames.includes(tool.name)) {
            const result = createFailedToolResult(
              call.id,
              [
                `Deferred tool schema was not sent for ${tool.name}.`,
                'Call ToolSearch first to materialize this tool schema, then retry the tool call.',
              ].join('\n'),
            )
            await transcript.append({
              type: 'tool-result',
              result,
              timestamp: createTimestamp(),
            })
            yield { type: 'tool-finished', result }
            continue
          }
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
            result = createFailedToolResult(
              call.id,
              `PreToolUse hook blocked ${call.name}: ${hookDecision.reason}`,
            )
          } else if (tool) {
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
            let toolSettled = false
            void toolPromise.then(
              () => {
                toolSettled = true
                lifecycleQueue.close()
              },
              () => {
                toolSettled = true
                lifecycleQueue.close()
              },
            )
            while (!toolSettled) {
              const lifecycleEvent = await lifecycleQueue.next()
              if (lifecycleEvent) {
                yield { type: 'subagent-lifecycle', event: lifecycleEvent }
              }
            }
            for (const lifecycleEvent of lifecycleQueue.drain()) {
              yield { type: 'subagent-lifecycle', event: lifecycleEvent }
            }
            result = await toolPromise
          } else {
            result = createFailedToolResult(call.id, `Unknown tool: ${call.name}`)
          }

          await transcript.append({
            type: 'tool-result',
            result,
            timestamp: createTimestamp(),
          })

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

          yield { type: 'tool-finished', result }
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

      if (maxTurns !== undefined && turns >= maxTurns && stopReason === 'tool_use') {
        finalMessage =
          finalMessage || `Stopped after reaching maxTurns (${maxTurns})`
        stopReason = 'max_tokens'
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

function injectProjectConfig(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  config: RuntimeProjectConfig | undefined,
): Awaited<ReturnType<TranscriptStore['readAll']>> {
  if (
    !config ||
    (config.ignore.length === 0 &&
      Object.keys(config.defaultCommands).length === 0 &&
      !config.allowedTools)
  ) {
    return events
  }
  return [
    {
      type: 'project-config',
      config,
      timestamp: createTimestamp(),
    },
    ...events,
  ]
}

function injectOperatorGuidance(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  guidance: string | undefined,
): Awaited<ReturnType<TranscriptStore['readAll']>> {
  if (!guidance?.trim()) return events
  return [
    {
      type: 'user',
      content: `<vigilon_operator_guidance>\n${guidance.trim()}\n</vigilon_operator_guidance>`,
      timestamp: createTimestamp(),
    },
    ...events,
  ]
}

function mergePromptDerivedProjectConfig(
  config: RuntimeProjectConfig | undefined,
  prompt: string,
): RuntimeProjectConfig | undefined {
  const derivedIgnore = derivePromptIgnorePatterns(prompt)
  if (derivedIgnore.length === 0) return config

  const base: RuntimeProjectConfig = config ?? {
    ignore: [],
    defaultCommands: {},
  }
  const ignore = [...base.ignore]
  for (const pattern of derivedIgnore) {
    if (!ignore.includes(pattern)) ignore.push(pattern)
  }
  return {
    ...base,
    ignore,
    defaultCommands: { ...base.defaultCommands },
    allowedTools: base.allowedTools ? [...base.allowedTools] : undefined,
  }
}

function derivePromptIgnorePatterns(prompt: string): string[] {
  const segments = prompt.match(
    /(?:不(?:要)?搜索|不要查|别搜|排除|忽略|exclude|ignore|skip|do not search|don't search|without searching)[^，。；;,\n]*/giu,
  )
  if (!segments) return []

  const patterns: string[] = []
  for (const segment of segments) {
    const cleaned = segment
      .replace(
        /^(?:不(?:要)?搜索|不要查|别搜|排除|忽略|exclude|ignore|skip|do not search|don't search|without searching)\s*/iu,
        '',
      )
      .split(/(?:等|目录|文件夹|噪音|noise|dirs?|directories?)/iu)[0]
    const tokens = cleaned.match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*/g) ?? []
    for (const token of tokens) {
      for (const pathPattern of expandPromptIgnoreToken(token)) {
        if (!patterns.includes(pathPattern)) patterns.push(pathPattern)
      }
    }
  }
  return patterns
}

function expandPromptIgnoreToken(token: string): string[] {
  const normalized = token.replace(/^\.?\//, '').replace(/\/+$/, '')
  if (!normalized || normalized === '.' || normalized === '..') return []
  const parts = normalized.split('/').filter(Boolean)
  const candidates = new Set<string>()
  candidates.add(`${normalized}/**`)
  candidates.add(`**/${normalized}/**`)

  for (const part of parts) {
    if (!isLikelyIgnorablePathPart(part)) continue
    candidates.add(`${part}/**`)
    candidates.add(`**/${part}/**`)
    if (/research/iu.test(part)) {
      candidates.add('*research*')
      candidates.add('*research*/**')
      candidates.add('**/*research*')
      candidates.add('**/*research*/**')
    }
  }
  return [...candidates]
}

function isLikelyIgnorablePathPart(part: string): boolean {
  return (
    part.startsWith('.') ||
    /^(?:research|archive|archives|archived|dist|build|coverage|node_modules|tmp|temp)$/iu.test(
      part,
    )
  )
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

function createSubagentRunner(options: {
  modelClient: ModelClient
  tools: ToolRegistry
  parentTranscript: TranscriptStore
  permissionGate: PermissionGate
  preToolUseHooks?: PreToolUseHook[]
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
  skills?: readonly RuntimeSkill[]
  toolResultReplacementLimit?: number
  taskManager: TaskManager
  sessionState: RuntimeSessionState
}): (request: SubagentRunRequest) => Promise<SubagentRunResult> {
  return async (request: SubagentRunRequest): Promise<SubagentRunResult> => {
    const subagentSessionId = `${sanitizeForPath(request.definition.name)}-${createSessionId()}`
    const host = await prepareSubagentExecutionHost({
      request,
      parentTranscript: options.parentTranscript,
      sessionId: subagentSessionId,
    })
    const transcriptPath = getSubagentTranscriptPath({
      cwd: host.sourceCwd,
      parentTranscript: options.parentTranscript,
      agentName: request.definition.name,
      sessionId: subagentSessionId,
    })
    const transcript = new JsonlTranscriptStore({
      sessionId: subagentSessionId,
      transcriptPath,
    })
    const permissionOrigin: PermissionOrigin = {
      agentId: `agent:${request.definition.name}:${subagentSessionId}`,
      agentRole: 'subagent',
      parentAgentId: request.parentAgentId ?? 'main',
    }
    const taskHost: SubagentTaskHost = {
      taskId: subagentSessionId,
      status: 'running',
      background: request.definition.background === true,
      transcriptPath,
      cwd: host.cwd,
      host: host.type,
      worktreePath: host.type !== 'local' ? host.cwd : undefined,
      gitWorktree: host.gitWorktree,
      sourceCwd: host.sourceCwd,
      startedAt: createTimestamp(),
      registeredWithTaskManager: true,
      stopPath: 'shared-task-manager',
      stopRequestPath: resolveTaskStopRequestPath({
        id: subagentSessionId,
        transcriptPath,
      }),
    }
    const subagentAbortController = new AbortController()
    await options.taskManager.startSubagentTask({
      taskId: taskHost.taskId,
      agentName: request.definition.name,
      transcriptPath,
      cwd: host.cwd,
      host: host.type,
      worktreePath: host.type !== 'local' ? host.cwd : undefined,
      gitWorktree: host.gitWorktree,
      sourceCwd: host.sourceCwd,
      background: taskHost.background,
      parentAgentId: permissionOrigin.parentAgentId,
      parentSessionId: options.parentTranscript.sessionId,
      stopRequestPath: taskHost.stopRequestPath,
      abortController: subagentAbortController,
    })
    const emitLifecycle = async (
      event: Omit<
        SubagentLifecycleEvent,
        'taskId' | 'agentName' | 'background' | 'transcriptPath' | 'parentAgentId' | 'timestamp'
      >,
    ): Promise<void> => {
      const timestamp = createTimestamp()
      const lifecycleEvent: SubagentLifecycleEvent = {
        taskId: taskHost.taskId,
        agentName: request.definition.name,
        background: taskHost.background,
        transcriptPath,
        cwd: host.cwd,
        host: host.type,
        worktreePath: host.type !== 'local' ? host.cwd : undefined,
        gitWorktree: host.gitWorktree,
        sourceCwd: host.sourceCwd,
        parentAgentId: permissionOrigin.parentAgentId,
        timestamp,
        ...event,
      }
      await options.parentTranscript.append({
        type: 'subagent-lifecycle',
        event: lifecycleEvent,
        timestamp,
      })
      await request.lifecycle?.emit(lifecycleEvent)
    }
    await emitLifecycle({
      status: 'started',
      summary: `Subagent ${request.definition.name} registered with shared task manager.`,
    })
    const permissionGate = createSubagentPermissionGate(
      options.permissionGate,
      transcript,
      permissionOrigin,
    )
    const runtime = createVigilonAgentRuntime({
      modelClient: options.modelClient,
      tools: createToolRegistry(
        filterAllowedSubagentTools(
          options.tools.list(),
          request.definition.allowedTools,
        ),
      ),
      transcript,
      permissionGate,
      preToolUseHooks: options.preToolUseHooks,
      maxTurns: request.definition.maxTurns,
      fileReadingLimits: options.fileReadingLimits,
      globLimits: options.globLimits,
      bashLimits: options.bashLimits,
      projectConfig: options.projectConfig,
      operator: options.operator,
      skills: options.skills,
      toolResultReplacementLimit: options.toolResultReplacementLimit,
      permissionOrigin,
      forkRequestCacheSnapshot: request.requestCacheSnapshot,
    })

    const runSubagentTurn = async (): Promise<SubagentRunResult> => {
      let turnResult: AgentRuntimeTurnResult | undefined
      try {
        for await (const event of runtime.runTurn({
          prompt: buildSubagentPrompt(request, host),
          cwd: host.cwd,
          abortSignal: subagentAbortController.signal,
        })) {
          if (event.type === 'model-request-started') {
            await emitLifecycle({
              status: 'model-request-started',
              modelId: options.modelClient.id,
              summary: `Subagent ${request.definition.name} requested model output.`,
            })
          }
          if (event.type === 'model-response-received') {
            await emitLifecycle({
              status: 'model-response-received',
              modelId: options.modelClient.id,
              stopReason: event.response.stopReason,
              toolCallCount: event.response.toolCalls.length,
              summary: event.response.content
                ? truncateText(event.response.content, 500)
                : `Subagent model response stopReason=${event.response.stopReason}.`,
            })
          }
          if (event.type === 'tool-started') {
            await emitLifecycle({
              status: 'tool-started',
              toolCallId: event.call.id,
              toolName: event.call.name,
              summary: `Subagent ${request.definition.name} started ${event.call.name}.`,
            })
          }
          if (event.type === 'tool-finished') {
            await emitLifecycle({
              status: 'tool-finished',
              toolCallId: event.result.toolCallId,
              toolOk: event.result.ok,
              summary: truncateText(event.result.content, 500),
            })
          }
          if (event.type === 'turn-finished') {
            turnResult = event.result
          }
        }
      } catch (error) {
        const worktreeDiff = await finalizeSubagentExecutionHost(host, transcriptPath)
        await emitLifecycle({
          status: 'failed',
          worktreeDiff,
          finalMessage: error instanceof Error ? error.message : String(error),
          summary: `Subagent ${request.definition.name} failed before final handoff.`,
        })
        await options.taskManager.completeTask(taskHost.taskId, {
          status: 'failed',
          terminalReason: 'subagent_runtime_error',
          outputSummary: error instanceof Error ? error.message : String(error),
          worktreeDiff,
        })
        throw error
      }

      if (!turnResult) {
        if (subagentAbortController.signal.aborted) {
          const worktreeDiff = await finalizeSubagentExecutionHost(host, transcriptPath)
          const stoppedResult: SubagentRunResult = {
            status: 'stopped',
            agentName: request.definition.name,
            transcriptPath,
            finalMessage: `Subagent ${request.definition.name} stopped before producing a final result.`,
            report: {
              status: 'stopped',
              finalMessage: `Subagent ${request.definition.name} stopped before producing a final result.`,
              todos: [],
              warnings: ['Subagent stopped through shared task manager path.'],
              verificationNotes: [],
              fileChanges: [],
              toolResults: [],
            },
            taskHost: {
              ...taskHost,
              status: 'stopped',
              worktreeDiff,
              completedAt: createTimestamp(),
            },
            permissionOrigin,
            ...(request.memorySnapshot ? { memorySnapshot: request.memorySnapshot } : {}),
            ...(request.catalog ? { catalog: request.catalog } : {}),
          }
          await options.taskManager.completeTask(taskHost.taskId, {
            status: 'stopped',
            terminalReason: 'subagent_aborted_before_final_result',
            outputSummary: stoppedResult.finalMessage,
            worktreeDiff,
          })
          await emitLifecycle({
            status: 'stopped',
            worktreeDiff,
            finalMessage: stoppedResult.finalMessage,
            summary: stoppedResult.finalMessage,
          })
          return stoppedResult
        }
        const error = new Error(`Subagent ${request.definition.name} finished without a final result.`)
        await options.taskManager.completeTask(taskHost.taskId, {
          status: 'failed',
          terminalReason: 'subagent_missing_final_result',
          outputSummary: error.message,
        })
        await emitLifecycle({
          status: 'failed',
          finalMessage: error.message,
          summary: error.message,
        })
        throw error
      }

      const worktreeDiff = await finalizeSubagentExecutionHost(host, transcriptPath)
      const completedResult: SubagentRunResult = {
        status: 'completed',
        agentName: request.definition.name,
        transcriptPath,
        finalMessage: turnResult.finalMessage,
        report: turnResult.report,
        taskHost: {
          ...taskHost,
          status: 'completed',
          worktreeDiff,
          completedAt: createTimestamp(),
        },
        permissionOrigin,
        ...(request.memorySnapshot ? { memorySnapshot: request.memorySnapshot } : {}),
        ...(request.catalog ? { catalog: request.catalog } : {}),
      }
      await options.taskManager.completeTask(taskHost.taskId, {
        status: 'completed',
        terminalReason: 'subagent_completed',
        outputSummary: completedResult.finalMessage,
        worktreeDiff,
      })
      await emitLifecycle({
        status: 'completed',
        worktreeDiff,
        finalMessage: completedResult.finalMessage,
        summary: truncateText(completedResult.finalMessage, 500),
      })
      return completedResult
    }

    if (taskHost.background) {
      void runSubagentTurn()
        .catch(async error => {
          await transcript.append({
            type: 'assistant',
            content: `Background subagent ${request.definition.name} failed: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: createTimestamp(),
          })
        })
        .finally(async () => {
          await appendTaskLifecycleSessionState({
            transcript: options.parentTranscript,
            sessionState: options.sessionState,
            taskManager: options.taskManager,
          })
        })
      const finalMessage = `Subagent ${request.definition.name} started in background. Task ID: ${taskHost.taskId}`
      await emitLifecycle({
        status: 'running-handoff',
        finalMessage,
        summary: finalMessage,
      })
      return {
        status: 'running',
        agentName: request.definition.name,
        transcriptPath,
        finalMessage,
        report: {
          status: 'running',
          finalMessage,
          todos: [],
          warnings: ['Background subagent is still running; use TaskStop with taskHost.taskId to stop it.'],
          verificationNotes: [],
          fileChanges: [],
          toolResults: [],
        },
        taskHost,
        permissionOrigin,
        ...(request.memorySnapshot ? { memorySnapshot: request.memorySnapshot } : {}),
        ...(request.catalog ? { catalog: request.catalog } : {}),
      }
    }

    return runSubagentTurn()
  }
}

async function appendTaskLifecycleSessionState(options: {
  transcript: TranscriptStore
  sessionState: RuntimeSessionState
  taskManager: TaskManager
}): Promise<void> {
  options.sessionState.backgroundTasks = options.taskManager.activeTasks.map(task => ({
    ...task,
  }))
  options.sessionState.retainedTasks = options.taskManager.retainedTasks.map(task => ({
    ...task,
  }))
  await options.transcript.append({
    type: 'session-state',
    phase: options.sessionState.phase,
    permissionMode: options.sessionState.permissionMode,
    prePlanPermissionMode: options.sessionState.prePlanPermissionMode ?? null,
    todos: options.sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: options.sessionState.approvedPlan ?? null,
    pendingPlan: options.sessionState.pendingPlan ?? null,
    handoffReport: options.sessionState.handoffReport
      ? {
          finalMessage: options.sessionState.handoffReport.finalMessage,
          changes: [...options.sessionState.handoffReport.changes],
          verified: [...options.sessionState.handoffReport.verified],
          unverified: [...options.sessionState.handoffReport.unverified],
          risks: [...options.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [...options.sessionState.verificationNotes],
    backgroundTasks: options.sessionState.backgroundTasks.map(task => ({ ...task })),
    retainedTasks: options.sessionState.retainedTasks.map(task => ({ ...task })),
    discoveredToolNames: [...options.sessionState.discoveredToolNames],
    toolReferenceDeltas: [...options.sessionState.toolReferenceDeltas],
    mcpInstructions: [...options.sessionState.mcpInstructions],
    activeSkill: options.sessionState.activeSkill
      ? { ...options.sessionState.activeSkill }
      : null,
    memoryFreshness: options.sessionState.memoryFreshness ?? null,
    systemPrompt: options.sessionState.systemPrompt ?? null,
    toolSchema: options.sessionState.toolSchema ?? null,
    modelParams: options.sessionState.modelParams ?? null,
    timestamp: createTimestamp(),
  })
}

function createSubagentPermissionGate(
  parent: PermissionGate,
  transcript: TranscriptStore,
  origin: PermissionOrigin,
): PermissionGate {
  return {
    async requestPermission(request) {
      const requestWithOrigin = {
        ...request,
        origin: request.origin ?? origin,
      }
      const decision = await parent.requestPermission(requestWithOrigin)
      await transcript.append({
        type: 'permission',
        request: requestWithOrigin,
        decision,
        timestamp: createTimestamp(),
      })
      return decision
    },
  }
}

function filterAllowedSubagentTools(
  tools: readonly ReturnType<ToolRegistry['list']>[number][],
  allowedTools: readonly string[],
) {
  const allowed = new Set(allowedTools)
  return tools.filter(tool => allowed.has(tool.name))
}

type SubagentExecutionHost = {
  type: 'local' | 'worktree' | 'git-worktree'
  cwd: string
  sourceCwd: string
  baselinePath?: string
  gitWorktree?: SubagentGitWorktreeMetadata
}

async function prepareSubagentExecutionHost(input: {
  request: SubagentRunRequest
  parentTranscript: TranscriptStore
  sessionId: string
}): Promise<SubagentExecutionHost> {
  const host = input.request.definition.host ?? 'local'
  if (host === 'local') {
    return {
      type: 'local',
      cwd: input.request.cwd,
      sourceCwd: input.request.cwd,
    }
  }
  if (host === 'git-worktree') {
    return prepareGitSubagentWorktree(input)
  }

  const worktreePath = path.join(
    resolveSubagentWorktreeRoot(input.request.cwd, input.parentTranscript),
    sanitizeForPath(input.request.definition.name),
    input.sessionId,
  )
  const baselinePath = `${worktreePath}.baseline`
  await mkdir(path.dirname(worktreePath), { recursive: true })
  await cp(input.request.cwd, baselinePath, {
    recursive: true,
    force: true,
    dereference: false,
    filter: source => shouldCopyIntoSubagentWorktree(input.request.cwd, worktreePath, source),
  })
  await cp(input.request.cwd, worktreePath, {
    recursive: true,
    force: true,
    dereference: false,
    filter: source => shouldCopyIntoSubagentWorktree(input.request.cwd, worktreePath, source),
  })
  return {
    type: 'worktree',
    cwd: worktreePath,
    sourceCwd: input.request.cwd,
    baselinePath,
  }
}

async function prepareGitSubagentWorktree(input: {
  request: SubagentRunRequest
  parentTranscript: TranscriptStore
  sessionId: string
}): Promise<SubagentExecutionHost> {
  const gitRootRaw = (await execFileStrict('git', ['-C', input.request.cwd, 'rev-parse', '--show-toplevel'])).stdout.trim()
  if (!gitRootRaw) {
    throw new Error(`git-worktree subagent host requires a git repository: ${input.request.cwd}`)
  }
  const gitRoot = await realpath(gitRootRaw)
  const sourceCwdReal = await realpath(input.request.cwd)
  const baseHead = (await execFileStrict('git', ['-C', gitRoot, 'rev-parse', 'HEAD'])).stdout.trim()
  const baseBranch = (await execFileStrict('git', ['-C', gitRoot, 'branch', '--show-current'])).stdout.trim() || undefined
  const relativeCwd = path.relative(gitRoot, sourceCwdReal)
  if (relativeCwd.startsWith('..') || path.isAbsolute(relativeCwd)) {
    throw new Error(`git-worktree subagent cwd is outside git root: ${input.request.cwd}`)
  }
  const worktreeRoot = path.join(
    resolveSubagentWorktreeRoot(input.request.cwd, input.parentTranscript),
    'git',
    sanitizeForPath(input.request.definition.name),
    input.sessionId,
  )
  const branchName = `vigilon/subagent/${sanitizeForPath(input.request.definition.name)}/${input.sessionId}`
  await mkdir(path.dirname(worktreeRoot), { recursive: true })
  await execFileStrict('git', [
    '-C',
    gitRoot,
    'worktree',
    'add',
    '-b',
    branchName,
    worktreeRoot,
    baseHead,
  ])
  const cwd = relativeCwd ? path.join(worktreeRoot, relativeCwd) : worktreeRoot
  return {
    type: 'git-worktree',
    cwd,
    sourceCwd: input.request.cwd,
    baselinePath: gitRoot,
    gitWorktree: {
      gitRoot,
      worktreePath: worktreeRoot,
      branchName,
      baseHead,
      baseBranch,
    },
  }
}

async function finalizeSubagentExecutionHost(
  host: SubagentExecutionHost,
  transcriptPath: string,
): Promise<SubagentWorktreeDiff | undefined> {
  if (host.type === 'git-worktree' && host.gitWorktree) {
    return finalizeGitSubagentWorktree(host, transcriptPath)
  }
  if (host.type !== 'worktree' || !host.baselinePath) return undefined
  const patchPath = `${transcriptPath}.worktree.patch`
  try {
    const [patch, nameStatus] = await Promise.all([
      execFileAllowingDiff('git', [
        'diff',
        '--no-index',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        host.baselinePath,
        host.cwd,
      ]),
      execFileAllowingDiff('git', [
        'diff',
        '--no-index',
        '--name-status',
        host.baselinePath,
        host.cwd,
      ]),
    ])
    const normalizedPatch = normalizeNoIndexPatch({
      patch: patch.stdout,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
    })
    await writeFile(patchPath, normalizedPatch, 'utf8')
    const changedFiles = parseWorktreeNameStatus({
      raw: nameStatus.stdout,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
    })
    const lineStats = countPatchLineStats(normalizedPatch)
    return {
      strategy: 'copy-baseline-diff',
      status: changedFiles.length > 0 ? 'changed' : 'clean',
      sourceCwd: host.sourceCwd,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
      patchPath,
      filesChanged: changedFiles.length,
      additions: lineStats.additions,
      deletions: lineStats.deletions,
      changedFiles,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(patchPath, `worktree diff failed: ${message}\n`, 'utf8')
    return {
      strategy: 'copy-baseline-diff',
      status: 'failed',
      sourceCwd: host.sourceCwd,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
      patchPath,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      changedFiles: [],
      error: message,
    }
  }
}

async function finalizeGitSubagentWorktree(
  host: SubagentExecutionHost,
  transcriptPath: string,
): Promise<SubagentWorktreeDiff> {
  const gitWorktree = host.gitWorktree
  if (!gitWorktree) throw new Error('git worktree metadata missing from subagent host')
  const patchPath = `${transcriptPath}.worktree.patch`
  try {
    const [patch, nameStatus] = await Promise.all([
      execFileAllowingDiff('git', [
        '-C',
        host.cwd,
        'diff',
        '--binary',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        'HEAD',
      ]),
      execFileAllowingDiff('git', [
        '-C',
        host.cwd,
        'diff',
        '--name-status',
        'HEAD',
      ]),
    ])
    await writeFile(patchPath, patch.stdout, 'utf8')
    const changedFiles = parseGitNameStatus(nameStatus.stdout)
    const lineStats = countPatchLineStats(patch.stdout)
    return {
      strategy: 'git-worktree-diff',
      status: changedFiles.length > 0 ? 'changed' : 'clean',
      sourceCwd: host.sourceCwd,
      baselinePath: gitWorktree.gitRoot,
      baselineRef: gitWorktree.baseHead,
      worktreePath: gitWorktree.worktreePath,
      patchPath,
      gitWorktree,
      filesChanged: changedFiles.length,
      additions: lineStats.additions,
      deletions: lineStats.deletions,
      changedFiles,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(patchPath, `git worktree diff failed: ${message}\n`, 'utf8')
    return {
      strategy: 'git-worktree-diff',
      status: 'failed',
      sourceCwd: host.sourceCwd,
      baselinePath: gitWorktree.gitRoot,
      baselineRef: gitWorktree.baseHead,
      worktreePath: gitWorktree.worktreePath,
      patchPath,
      gitWorktree,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      changedFiles: [],
      error: message,
    }
  }
}

function parseGitNameStatus(raw: string): SubagentWorktreeDiff['changedFiles'] {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [statusCode = '', firstPath = '', secondPath = ''] = line.split('\t')
      return {
        status: mapWorktreeStatus(statusCode),
        path: secondPath || firstPath,
      }
    })
}

async function execFileAllowingDiff(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === 'number'
        ? (error as { code: number }).code
        : 0
      if (error && code !== 1) {
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function execFileStrict(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function normalizeNoIndexPatch(input: {
  patch: string
  baselinePath: string
  worktreePath: string
}): string {
  const baseline = stripLeadingSlash(path.resolve(input.baselinePath))
  const worktree = stripLeadingSlash(path.resolve(input.worktreePath))
  return input.patch
    .split('\n')
    .map(line =>
      line
        .replaceAll(`a/${baseline}/`, 'a/')
        .replaceAll(`b/${baseline}/`, 'b/')
        .replaceAll(`a/${worktree}/`, 'a/')
        .replaceAll(`b/${worktree}/`, 'b/'),
    )
    .join('\n')
}

function parseWorktreeNameStatus(input: {
  raw: string
  baselinePath: string
  worktreePath: string
}): SubagentWorktreeDiff['changedFiles'] {
  return input.raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [statusCode = '', firstPath = '', secondPath = ''] = line.split('\t')
      const status = mapWorktreeStatus(statusCode)
      const rawPath = secondPath || firstPath
      return {
        status,
        path: normalizeWorktreeDiffPath(rawPath, input.baselinePath, input.worktreePath),
      }
    })
}

function mapWorktreeStatus(statusCode: string): SubagentWorktreeDiff['changedFiles'][number]['status'] {
  const code = statusCode[0]
  if (code === 'A') return 'added'
  if (code === 'M') return 'modified'
  if (code === 'D') return 'deleted'
  if (code === 'R') return 'renamed'
  if (code === 'C') return 'copied'
  if (code === 'T') return 'typechange'
  return 'unknown'
}

function normalizeWorktreeDiffPath(
  rawPath: string,
  baselinePath: string,
  worktreePath: string,
): string {
  const resolved = path.resolve(rawPath)
  for (const root of [baselinePath, worktreePath]) {
    const relative = path.relative(path.resolve(root), resolved)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative
  }
  return rawPath
}

function countPatchLineStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}

function resolveSubagentWorktreeRoot(cwd: string, parentTranscript: TranscriptStore): string {
  if (
    parentTranscript.transcriptPath &&
    !isPathInside(cwd, path.dirname(parentTranscript.transcriptPath))
  ) {
    return path.join(path.dirname(parentTranscript.transcriptPath), 'subagent-worktrees')
  }
  return path.join(path.dirname(cwd), `${path.basename(cwd)}.subagent-worktrees`)
}

function shouldCopyIntoSubagentWorktree(
  sourceRoot: string,
  worktreePath: string,
  source: string,
): boolean {
  if (path.resolve(source) !== path.resolve(sourceRoot) && isPathInside(source, worktreePath)) {
    return false
  }
  const relative = path.relative(sourceRoot, source)
  if (!relative) return true
  const [firstPart] = relative.split(path.sep)
  return firstPart !== '.git' &&
    firstPart !== '.vigilon' &&
    firstPart !== '.sessions' &&
    firstPart !== 'node_modules'
}

function isPathInside(candidateParent: string, child: string): boolean {
  const relative = path.relative(path.resolve(candidateParent), path.resolve(child))
  return relative === '' || Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function buildSubagentPrompt(
  request: SubagentRunRequest,
  host: SubagentExecutionHost,
): string {
  return [
    request.definition.systemPrompt.trim(),
    '',
    'You are running as a focused local subagent.',
    `Agent: ${request.definition.name}`,
    `Agent source: ${request.definition.source}`,
    `Execution host: ${host.type}`,
    host.type !== 'local'
      ? `Worktree cwd: ${host.cwd}`
      : `Cwd: ${host.cwd}`,
    host.type !== 'local'
      ? `Source cwd: ${host.sourceCwd}`
      : undefined,
    host.gitWorktree
      ? `Git worktree branch: ${host.gitWorktree.branchName}`
      : undefined,
    host.gitWorktree
      ? `Git worktree base HEAD: ${host.gitWorktree.baseHead}`
      : undefined,
    `Allowed tools: ${request.definition.allowedTools.join(', ') || '(none)'}`,
    request.memorySnapshot
      ? [
          '',
          '<vigilon_subagent_memory_snapshot>',
          request.memorySnapshot.freshness
            ? `freshness="${request.memorySnapshot.freshness}"`
            : undefined,
          request.memorySnapshot.sourceEventCount !== undefined
            ? `source_event_count="${request.memorySnapshot.sourceEventCount}"`
            : undefined,
          request.memorySnapshot.summary,
          request.memorySnapshot.longTerm
            ? [
                '',
                '<vigilon_subagent_long_term_memory>',
                `index_path="${request.memorySnapshot.longTerm.indexPath}"`,
                `manifest_path="${request.memorySnapshot.longTerm.manifestPath}"`,
                `entry_count="${request.memorySnapshot.longTerm.entryCount}"`,
                ...request.memorySnapshot.longTerm.entries.map(entry =>
                  [
                    `<entry id="${entry.id}" type="${entry.kind}" topic="${escapePromptAttribute(entry.topic)}" created_at="${entry.createdAt}">`,
                    entry.content,
                    '</entry>',
                  ].join('\n'),
                ),
                '</vigilon_subagent_long_term_memory>',
              ].join('\n')
            : undefined,
          '</vigilon_subagent_memory_snapshot>',
        ].filter(Boolean).join('\n')
      : '',
    '',
    'Task:',
    request.task,
  ].join('\n')
}

function escapePromptAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getSubagentTranscriptPath(options: {
  cwd: string
  parentTranscript: TranscriptStore
  agentName: string
  sessionId: string
}): string {
  const parentPath = getTranscriptPathForStore(options.parentTranscript)
  const baseDir = parentPath
    ? path.join(path.dirname(parentPath), 'subagents')
    : path.join(getProjectSessionDir(options.cwd), 'subagents')
  return path.join(
    baseDir,
    sanitizeForPath(options.agentName),
    `${options.sessionId}.jsonl`,
  )
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
}

function truncateText(value: string | undefined, maxChars: number): string {
  if (!value) return ''
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
}

function injectSessionMemory(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  memory: Parameters<typeof buildSessionMemoryInjection>[0] | undefined,
  fresh: boolean,
  shouldInject: boolean,
): Awaited<ReturnType<TranscriptStore['readAll']>> {
  if (!memory || !shouldInject) return events
  return [
    buildSessionMemoryInjection(memory, fresh ? 'fresh' : 'stale'),
    ...events,
  ]
}

function injectCapabilityReplay(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  sessionState: RuntimeSessionState,
  shouldInject: boolean,
): Awaited<ReturnType<TranscriptStore['readAll']>> {
  if (!shouldInject) return events

  const replayLines: string[] = []
  if (sessionState.discoveredToolNames.length > 0) {
    replayLines.push(`discovered_tools="${sessionState.discoveredToolNames.join(', ')}"`)
  }
  if (sessionState.toolReferenceDeltas.length > 0) {
    replayLines.push(
      ...sessionState.toolReferenceDeltas.map(
        delta =>
          `tool_reference name="${delta.name}" schema_hash="${delta.schemaHash}" reason="${delta.reason}"`,
      ),
    )
  }
  if (sessionState.activeSkill) {
    replayLines.push(
      `active_skill="${sessionState.activeSkill.name}" allowed_tools="${sessionState.activeSkill.allowedTools.join(', ')}"`,
    )
  }
  if (sessionState.mcpInstructions.length > 0) {
    replayLines.push(...sessionState.mcpInstructions.map(line => `mcp_instruction="${line}"`))
  }
  if (sessionState.approvedPlan) {
    replayLines.push(`approved_plan="${sessionState.approvedPlan}"`)
  }
  if (sessionState.pendingPlan) {
    replayLines.push(`pending_plan="${sessionState.pendingPlan}"`)
  }
  if (sessionState.memoryFreshness) {
    replayLines.push(`memory_freshness="${sessionState.memoryFreshness}"`)
  }
  if (sessionState.backgroundTasks.length > 0) {
    replayLines.push(
      ...sessionState.backgroundTasks.map(task =>
        `background_task id=${JSON.stringify(task.id)} type=${JSON.stringify(task.type)} status=${JSON.stringify(task.status ?? 'running')} agent=${JSON.stringify(task.agentName ?? '')} transcript=${JSON.stringify(task.transcriptPath ?? '')}`,
      ),
    )
  }
  if ((sessionState.retainedTasks ?? []).length > 0) {
    replayLines.push(
      ...(sessionState.retainedTasks ?? []).map(task =>
        `retained_task id=${JSON.stringify(task.id)} type=${JSON.stringify(task.type)} status=${JSON.stringify(task.status ?? '')} agent=${JSON.stringify(task.agentName ?? '')} reason=${JSON.stringify(task.terminalReason ?? '')} output=${JSON.stringify(task.outputSummary ?? '')} transcript=${JSON.stringify(task.transcriptPath ?? '')}`,
      ),
    )
  }
  if (sessionState.verificationNotes.length > 0) {
    replayLines.push(...sessionState.verificationNotes.map(note => `verification_note="${note}"`))
  }
  if (replayLines.length === 0) return events

  const replayEvent: Extract<TranscriptEvent, { type: 'user' }> = {
    type: 'user',
    content: [
      '<vigilon_capability_replay>',
      ...replayLines,
      '</vigilon_capability_replay>',
    ].join('\n'),
    timestamp: createTimestamp(),
  }
  const firstEvent = events[0]
  if (
    firstEvent?.type === 'user' &&
    firstEvent.content.includes('<vigilon_session_memory')
  ) {
    return [firstEvent, replayEvent, ...events.slice(1)]
  }
  return [replayEvent, ...events]
}

function injectRuntimeProgress(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  sessionState: RuntimeSessionState,
): Awaited<ReturnType<TranscriptStore['readAll']>> {
  const lines: string[] = []
  if (sessionState.phase !== 'execute') {
    lines.push(`phase="${sessionState.phase}"`)
  }
  if (sessionState.approvedPlan) {
    lines.push(`approved_plan=${JSON.stringify(sessionState.approvedPlan)}`)
  }
  if (sessionState.pendingPlan) {
    lines.push(`pending_plan=${JSON.stringify(sessionState.pendingPlan)}`)
  }
  const incompleteTodos = sessionState.todos.filter(todo => todo.status !== 'completed')
  if (incompleteTodos.length > 0) {
    lines.push('current_todos:')
    lines.push(
      ...incompleteTodos.map(
        todo =>
          `- ${todo.status} ${todo.id}: ${todo.activeForm?.trim() || todo.content}`,
      ),
    )
    lines.push(
      'Do not give a final answer while pending or in_progress todos remain unless you are explicitly reporting a blocker or changed task scope.',
    )
  }
  if (sessionState.verificationNotes.length > 0) {
    lines.push('verification_notes:')
    lines.push(...sessionState.verificationNotes.map(note => `- ${note}`))
  }
  if (lines.length === 0) return events

  const progressEvent: Extract<TranscriptEvent, { type: 'user' }> = {
    type: 'user',
    content: [
      '<vigilon_runtime_progress>',
      ...lines,
      '</vigilon_runtime_progress>',
    ].join('\n'),
    timestamp: createTimestamp(),
  }
  const insertAfter = events.findIndex(
    event =>
      event.type === 'user' &&
      event.content.includes('<vigilon_capability_replay>'),
  )
  if (insertAfter >= 0) {
    return [
      ...events.slice(0, insertAfter + 1),
      progressEvent,
      ...events.slice(insertAfter + 1),
    ]
  }
  return [progressEvent, ...events]
}

function injectActiveTask(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  prompt: string,
  config: RuntimeProjectConfig | undefined,
): Awaited<ReturnType<TranscriptStore['readAll']>> {
  const lines = [
    '<vigilon_active_task>',
    `original_user_task=${JSON.stringify(prompt)}`,
    'Keep subsequent tool use and the final answer anchored to this task. Do not drift into adjacent reference code, examples, or implementation summaries unless the user asked for that comparison.',
  ]
  if (config?.ignore.length) {
    lines.push(`ignored_path_patterns=${JSON.stringify(config.ignore)}`)
    lines.push('Respect ignored path patterns as hard task boundaries for search, reading, and summaries.')
  }
  lines.push('</vigilon_active_task>')

  const taskEvent: Extract<TranscriptEvent, { type: 'user' }> = {
    type: 'user',
    content: lines.join('\n'),
    timestamp: createTimestamp(),
  }

  const insertAfter = countLeadingRuntimeStateEvents(events)
  return [
    ...events.slice(0, insertAfter),
    taskEvent,
    ...events.slice(insertAfter),
  ]
}

function countLeadingRuntimeStateEvents(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
): number {
  let index = 0
  while (index < events.length) {
    const event = events[index]
    if (
      event?.type === 'compact-boundary' ||
      (event?.type === 'user' &&
        (event.content.includes('<vigilon_session_memory') ||
          event.content.includes('<vigilon_capability_replay>') ||
          event.content.includes('<vigilon_runtime_progress>')))
    ) {
      index += 1
      continue
    }
    break
  }
  return index
}

async function loadSessionMemory(options: {
  cwd: string
  sessionsDir?: string
  transcriptPath?: string
  sessionId?: string
  eventCount: number
}): Promise<
  | {
      record: Parameters<typeof buildSessionMemoryInjection>[0]
      fresh: boolean
      content: string
    }
  | undefined
> {
  if (!options.sessionId) return undefined
  const memoryPath = getSessionMemoryPath({
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    transcriptPath: options.transcriptPath,
    sessionId: options.sessionId,
  })
  const record = await readSessionMemory(memoryPath)
  if (!record) return undefined
  return {
    record,
    fresh: isSessionMemoryFresh(record, options.eventCount),
    content: record.content,
  }
}

function getTranscriptPathForStore(
  transcript: TranscriptStore,
): string | undefined {
  return 'transcriptPath' in transcript ? transcript.transcriptPath : undefined
}

export function syncPermissionModeFromSession(
  sessionState: RuntimeSessionState,
  permissionGate: PermissionGate,
): void {
  if ('setMode' in permissionGate && typeof permissionGate.setMode === 'function') {
    permissionGate.setMode(sessionState.permissionMode)
  }
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

function isFileChangeType(value: unknown): value is 'create' | 'update' {
  return value === 'create' || value === 'update'
}
