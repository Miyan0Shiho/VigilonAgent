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
  TranscriptStore,
  FileReadingLimits,
  PermissionMode,
  ResultReport,
  RuntimeSessionState,
  RuntimeSessionSnapshot,
  RuntimeSkill,
  RuntimeOperator,
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
  createTimestamp,
  restoreSessionStateFromEvents,
} from './transcript.js'

import { createLSPServerManager, type LSPServerManager } from '../services/lsp/LSPServerManager.js'
import { DEFAULT_LSP_CONFIGS } from '../services/lsp/config.js'
import { checkForLSPDiagnostics } from '../services/lsp/LSPDiagnosticRegistry.js'
import { createTaskManager } from './taskManager.js'
import { compactTranscript } from './compact.js'

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
  sessionState.permissionMode =
    sessionState.permissionMode ?? options.permissionMode ?? 'ask'
  const mutablePermissionGate = createMutablePermissionGate({
    mode: sessionState.permissionMode,
    transcript,
  })
  const permissionGate = options.permissionGate ?? mutablePermissionGate
  const maxTurns = options.maxTurns ?? 16
  const readFileState = new Map()
  syncPermissionModeFromSession(sessionState, permissionGate)

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

      try {
        await lspServerManager.initialize(DEFAULT_LSP_CONFIGS)

        while (turns < maxTurns) {
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
        if (allEvents.length > AUTO_COMPACT_THRESHOLD) {
          await compactTranscript({
            transcript,
            summary: 'Auto-compacting transcript to optimize context window.',
            trigger: 'auto',
            sessionState,
            reactiveEventCount: REACTIVE_EVENT_COUNT,
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
        const visibleEvents = filterModelVisibleEvents(
          injectProjectConfig(
            injectSkillListing(contextWindow.events, options.skills ?? []),
            options.projectConfig,
          ),
        )
        const visibleTools = tools.list().filter(tool => {
          if (!tool.deferred) return true
          return sessionState.discoveredToolNames.includes(tool.name)
        })

        const requestAuditEvent = buildLlmRequestEvent({
          events: await transcript.readAll(),
          visibleEvents,
          tools: visibleTools,
          model: options.modelClient.id,
          compacted: contextWindow.compacted,
          compactBoundaryIndex: contextWindow.compactBoundaryIndex,
          droppedEventCount: contextWindow.droppedEventCount,
          projectConfig: options.projectConfig,
          skills: options.skills,
          timestamp: createTimestamp(),
        })
        await transcript.append(requestAuditEvent)
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
          fileReadingLimits: options.fileReadingLimits,
          globLimits: options.globLimits,
          bashLimits: options.bashLimits,
          projectConfig: options.projectConfig,
          operator: options.operator,
          lspServerManager,
          taskManager,
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
              }
            }
          }

          yield { type: 'tool-finished', result }
        }

        if (input.abortSignal.aborted) {
          stopReason = 'error'
          finalMessage = 'Turn aborted'
          break
        }
      }

      if (turns >= maxTurns && stopReason === 'tool_use') {
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
      yield { type: 'turn-finished', result }
    } finally {
      await lspServerManager.shutdown()
      await taskManager.shutdown()
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
  return {
    status: stopReason === 'error' ? 'error' : stopReason === 'end_turn' ? 'completed' : 'stopped',
    finalMessage,
    todos: [...sessionState.todos],
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

function isFileChangeType(value: unknown): value is 'create' | 'update' {
  return value === 'create' || value === 'update'
}
