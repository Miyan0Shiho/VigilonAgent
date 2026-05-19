import path from 'node:path'
import { createHash } from 'node:crypto'
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
  TaskManager,
  TranscriptEvent,
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
import { compactTranscript, shouldAutoCompactTranscript } from './compact.js'
import { createToolRegistry } from './tools.js'

const AUTO_COMPACT_THRESHOLD = 30
const REACTIVE_EVENT_COUNT = 10

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
        await taskManager.shutdown()
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
        if (
          shouldAutoCompactTranscript(allEvents, {
            threshold: AUTO_COMPACT_THRESHOLD,
          })
        ) {
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
            sessionState,
            reactiveEventCount: REACTIVE_EVENT_COUNT,
            strategy: memory?.content ? 'session-memory' : 'reactive',
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
        const visibleEvents = filterModelVisibleEvents(
          injectOperatorGuidance(
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
          ),
        )
        const visibleTools = selectVisibleTools(
          tools.list(),
          sessionState,
        )
        const visibleToolNames = new Set(visibleTools.map(tool => tool.name))

        const requestAuditEvent = buildLlmRequestEvent({
          events: await transcript.readAll(),
          visibleEvents,
          tools: visibleTools,
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
          timestamp: createTimestamp(),
        })
        await transcript.append(requestAuditEvent)

        // Capture Request Stability State
        sessionState.systemPrompt = visibleEvents.find(e => e.type === 'assistant' || e.type === 'user')?.content // Simplification
        sessionState.toolSchema = JSON.stringify(visibleTools.map(t => ({ name: t.name, description: t.description, schema: t.inputJsonSchema })))
        sessionState.modelParams = { model: options.modelClient.id }

        const requestStartedAt = Date.now()
        const response = await options.modelClient.createMessage({
          messages: visibleEvents,
          tools: visibleTools,
          abortSignal: input.abortSignal,
        })
        const responseAuditEvent = buildLlmResponseEvent({
          request: requestAuditEvent,
          stopReason: response.stopReason,
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
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
          const result =
            hookDecision.outcome === 'block'
              ? createFailedToolResult(
                  call.id,
                  `PreToolUse hook blocked ${call.name}: ${hookDecision.reason}`,
                )
              : tool
                ? await invokeTool(tool.invoke(call.input, context), call.id)
                : createFailedToolResult(call.id, `Unknown tool: ${call.name}`)

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
}): (request: SubagentRunRequest) => Promise<SubagentRunResult> {
  return async (request: SubagentRunRequest): Promise<SubagentRunResult> => {
    const subagentSessionId = `${sanitizeForPath(request.definition.name)}-${createSessionId()}`
    const transcriptPath = getSubagentTranscriptPath({
      cwd: request.cwd,
      parentTranscript: options.parentTranscript,
      agentName: request.definition.name,
      sessionId: subagentSessionId,
    })
    const transcript = new JsonlTranscriptStore({
      sessionId: subagentSessionId,
      transcriptPath,
    })
    const permissionGate = createSubagentPermissionGate(
      options.permissionGate,
      transcript,
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
    })

    let turnResult: AgentRuntimeTurnResult | undefined
    for await (const event of runtime.runTurn({
      prompt: buildSubagentPrompt(request),
      cwd: request.cwd,
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') {
        turnResult = event.result
      }
    }

    if (!turnResult) {
      throw new Error(`Subagent ${request.definition.name} finished without a final result.`)
    }

    return {
      status: 'completed',
      agentName: request.definition.name,
      transcriptPath,
      finalMessage: turnResult.finalMessage,
      report: turnResult.report,
    }
  }
}

function createSubagentPermissionGate(
  parent: PermissionGate,
  transcript: TranscriptStore,
): PermissionGate {
  return {
    async requestPermission(request) {
      const decision = await parent.requestPermission(request)
      await transcript.append({
        type: 'permission',
        request,
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

function buildSubagentPrompt(request: SubagentRunRequest): string {
  return [
    request.definition.systemPrompt.trim(),
    '',
    'You are running as a focused local subagent.',
    `Agent: ${request.definition.name}`,
    `Allowed tools: ${request.definition.allowedTools.join(', ') || '(none)'}`,
    '',
    'Task:',
    request.task,
  ].join('\n')
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
