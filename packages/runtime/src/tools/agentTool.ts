import type { SubagentRunResult, Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { loadAgentCatalog } from '../runtime/agentDefinitions.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { readProjectMemorySnapshot } from '../runtime/projectMemory.js'
import { createTimestamp } from '../runtime/transcript.js'

export const AgentTool: Tool = {
  name: 'Agent',
  description:
    'Delegates a focused subtask to a local subagent with its own transcript and restricted tool access.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Agent name from the source-aware Vigilon agent catalog.',
      },
      task: {
        type: 'string',
        description: 'Focused subtask for the delegated agent to complete.',
      },
    },
    required: ['agent', 'task'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseAgentInput(input)
    if (!parsed.agent || !parsed.task) {
      return failed('Agent requires non-empty "agent" and "task" fields.')
    }
    if (!context.runSubagent) {
      return failed('Agent runtime is not configured with subagent execution support.')
    }

    const catalog = await loadAgentCatalog({ cwd: context.cwd })
    const definition = catalog.active.find(agent => agent.name === parsed.agent)
    if (!definition) {
      return failed(`Local agent not found: ${parsed.agent}`)
    }

    const parentOrigin = withToolPermissionOrigin(context.permissionOrigin, 'Agent')
    const permission = await context.permissionGate.requestPermission({
      action: 'external-tool',
      subject: `local subagent:${parsed.agent}`,
      risk: 'medium',
      reason: `Delegate a focused task to local subagent ${parsed.agent}`,
      origin: parentOrigin,
    })
    if (!permission.allowed) {
      return failed(`Agent permission denied: ${permission.reason}`)
    }

    const memorySnapshot = definition.memory === 'none'
      ? undefined
      : await buildSubagentMemorySnapshot(context)
    const result = await context.runSubagent({
      definition,
      task: parsed.task,
      cwd: context.cwd,
      catalog,
      memorySnapshot,
      parentAgentId: parentOrigin.agentId,
      lifecycle: context.subagentLifecycle,
      requestCacheSnapshot: context.requestCacheSnapshot,
    })
    if (result.status === 'running') {
      await persistBackgroundTaskSnapshot(context)
    }

    return {
      toolCallId: '',
      ok: true,
      content: buildAgentResultContent(result),
      metadata: {
        status: result.status,
        agentName: result.agentName,
        transcriptPath: result.transcriptPath,
        taskHost: result.taskHost,
        permissionOrigin: result.permissionOrigin,
        memorySnapshot: result.memorySnapshot,
        catalog: {
          active: result.catalog?.active.map(agent => ({
            name: agent.name,
            source: agent.source,
            sourceScope: agent.sourceScope,
            description: agent.description,
          })) ?? [],
          entries: result.catalog?.entries.map(entry => ({
            name: entry.definition.name,
            source: entry.definition.source,
            sourceScope: entry.definition.sourceScope,
            overriddenBy: entry.overriddenBy,
          })) ?? [],
          precedence: result.catalog?.precedence ?? [],
        },
        report: result.report,
      },
    }
  },
}

async function buildSubagentMemorySnapshot(
  context: ToolUseContext,
): Promise<NonNullable<Parameters<NonNullable<ToolUseContext['runSubagent']>>[0]['memorySnapshot']> | undefined> {
  const freshness = context.sessionState?.memoryFreshness
  const projectMemory = await readProjectMemorySnapshot(context.cwd)
  if (
    !freshness &&
    !context.sessionState?.approvedPlan &&
    context.sessionState?.verificationNotes.length === 0 &&
    projectMemory.entries.length === 0
  ) {
    return undefined
  }
  return {
    ...(freshness ? { freshness } : {}),
    ...(projectMemory.entries.length
      ? {
          longTerm: {
            indexPath: projectMemory.indexPath,
            manifestPath: projectMemory.manifestPath,
            entryCount: projectMemory.entryCount,
            entries: projectMemory.entries.map(entry => ({
              id: entry.id,
              kind: entry.kind,
              topic: entry.topic,
              content: entry.content,
              createdAt: entry.createdAt,
              sourceSessionId: entry.source.sessionId,
            })),
          },
        }
      : {}),
    summary: [
      context.sessionState?.approvedPlan
        ? `Approved plan: ${context.sessionState.approvedPlan}`
        : undefined,
      context.sessionState?.verificationNotes.length
        ? `Verification notes: ${context.sessionState.verificationNotes.join(' | ')}`
        : undefined,
      projectMemory.entries.length
        ? `Long-term memory entries: ${projectMemory.entries.map(entry => `${entry.kind}:${entry.topic}`).join(', ')}`
        : undefined,
    ].filter(Boolean).join('\n') || 'Parent session runtime state snapshot.',
  }
}

async function persistBackgroundTaskSnapshot(context: ToolUseContext): Promise<void> {
  if (!context.sessionState) return
  context.sessionState.backgroundTasks = context.taskManager.activeTasks.map(task => ({
    ...task,
  }))
  context.sessionState.retainedTasks = context.taskManager.retainedTasks.map(task => ({
    ...task,
  }))
  await context.transcript.append({
    type: 'session-state',
    phase: context.sessionState.phase,
    permissionMode: context.sessionState.permissionMode,
    prePlanPermissionMode: context.sessionState.prePlanPermissionMode ?? null,
    todos: context.sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: context.sessionState.approvedPlan ?? null,
    pendingPlan: context.sessionState.pendingPlan ?? null,
    handoffReport: context.sessionState.handoffReport
      ? {
          finalMessage: context.sessionState.handoffReport.finalMessage,
          changes: [...context.sessionState.handoffReport.changes],
          verified: [...context.sessionState.handoffReport.verified],
          unverified: [...context.sessionState.handoffReport.unverified],
          risks: [...context.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [...context.sessionState.verificationNotes],
    backgroundTasks: context.sessionState.backgroundTasks.map(task => ({ ...task })),
    retainedTasks: context.sessionState.retainedTasks.map(task => ({ ...task })),
    discoveredToolNames: [...context.sessionState.discoveredToolNames],
    toolReferenceDeltas: [...context.sessionState.toolReferenceDeltas],
    mcpInstructions: [...context.sessionState.mcpInstructions],
    activeSkill: context.sessionState.activeSkill
      ? { ...context.sessionState.activeSkill }
      : null,
    memoryFreshness: context.sessionState.memoryFreshness ?? null,
    systemPrompt: context.sessionState.systemPrompt ?? null,
    toolSchema: context.sessionState.toolSchema ?? null,
    modelParams: context.sessionState.modelParams ?? null,
    timestamp: createTimestamp(),
  })
}

function parseAgentInput(input: unknown): { agent?: string; task?: string } {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    agent:
      typeof value.agent === 'string' && value.agent.trim()
        ? value.agent.trim()
        : undefined,
    task:
      typeof value.task === 'string' && value.task.trim()
        ? value.task.trim()
        : undefined,
  }
}

function buildAgentResultContent(result: SubagentRunResult): string {
  if (result.status === 'running') {
    return [
      'Subagent started in background.',
      '',
      `Final message: ${result.finalMessage}`,
      `Task ID: ${result.taskHost.taskId}`,
      `Transcript: ${result.transcriptPath}`,
    ].join('\n')
  }
  return [
    'Subagent completed the delegated task.',
    '',
    `Final message: ${result.finalMessage}`,
    `Transcript: ${result.transcriptPath}`,
  ].join('\n')
}

function failed(content: string): ToolResult {
  return {
    toolCallId: '',
    ok: false,
    content,
  }
}
