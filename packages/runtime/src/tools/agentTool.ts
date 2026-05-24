import type { SubagentRunResult, Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { loadAgentCatalog } from '../runtime/agentDefinitions.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { readProjectMemorySnapshot } from '../runtime/projectMemory.js'
import { createTimestamp } from '../runtime/transcript.js'

export const AgentTool: Tool = {
  name: 'Agent',
  description:
    'Delegates focused subtasks to local sub-agents. Use "task" for a single task or "tasks" array to run multiple in parallel.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Agent name from the source-aware Vigilon agent catalog.',
      },
      task: {
        type: 'string',
        description: 'A focused subtask for the delegated agent to complete.',
      },
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description: 'Multiple subtasks to run concurrently in parallel sub-agents. Use instead of "task" for parallel work.',
      },
      maxTurns: {
        type: 'number',
        description: 'Optional max turns override for this subagent run.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseAgentInput(input)
    if (!context.runSubagent) {
      return failed('Agent runtime is not configured with subagent execution support.')
    }
    const taskList: string[] = parsed.tasks?.length
      ? parsed.tasks
      : parsed.task ? [parsed.task] : []
    if (!parsed.agent || taskList.length === 0) {
      return failed('Agent requires non-empty "agent" and either "task" or "tasks".')
    }

    const catalog = await loadAgentCatalog({ cwd: context.cwd })
    const definition = catalog.active.find(a => a.name === parsed.agent)
    if (!definition) {
      return failed(`Local agent not found: ${parsed.agent}`)
    }

    const effectiveDefinition = parsed.maxTurns !== undefined
      ? { ...definition, maxTurns: parsed.maxTurns }
      : definition

    const parentOrigin = withToolPermissionOrigin(context.permissionOrigin, 'Agent')
    const permission = await context.permissionGate.requestPermission({
      action: 'external-tool',
      subject: `local subagent:${parsed.agent}${taskList.length > 1 ? ` (${taskList.length} tasks)` : ''}`,
      risk: 'medium',
      reason: `Delegate ${taskList.length} task(s) to local subagent ${parsed.agent}`,
      origin: parentOrigin,
    })
    if (!permission.allowed) {
      return failed(`Agent permission denied: ${permission.reason}`)
    }

    // Concurrent dispatch for multiple tasks
    if (taskList.length > 1) {
      const results = await Promise.all(taskList.map(t =>
        context.runSubagent!({
          definition: effectiveDefinition,
          task: t,
          cwd: context.cwd,
          parentAgentId: parentOrigin.agentId,
          lifecycle: context.subagentLifecycle,
        })
      ))
      const summaries = results.map((r, i) => `  ${i + 1}. ${r.finalMessage}`).join('\n')
      return {
        toolCallId: '', ok: true,
        content: `${taskList.length} sub-agents completed concurrently:\n${summaries}`,
        metadata: { agentName: effectiveDefinition.name, taskCount: taskList.length },
      }
    }

    // Single task — original path
    const task = taskList[0]!
    const memorySnapshot = effectiveDefinition.memory === 'none'
      ? undefined
      : await buildSubagentMemorySnapshot(context)
    const result = await context.runSubagent({
      definition: effectiveDefinition,
      task,
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
          active: result.catalog?.active.map(a => ({
            name: a.name, source: a.source, sourceScope: a.sourceScope, description: a.description,
          })) ?? [],
          entries: result.catalog?.entries.map(e => ({
            name: e.definition.name, source: e.definition.source,
            sourceScope: e.definition.sourceScope, overriddenBy: e.overriddenBy,
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
  if (!freshness && !context.sessionState?.approvedPlan &&
      context.sessionState?.verificationNotes.length === 0 &&
      projectMemory.entries.length === 0) {
    return undefined
  }
  return {
    ...(freshness ? { freshness } : {}),
    ...(projectMemory.entries.length ? {
      longTerm: {
        indexPath: projectMemory.indexPath,
        manifestPath: projectMemory.manifestPath,
        entryCount: projectMemory.entryCount,
        entries: projectMemory.entries.map(e => ({
          id: e.id, kind: e.kind, topic: e.topic, content: e.content,
          createdAt: e.createdAt, sourceSessionId: e.source.sessionId,
        })),
      },
    } : {}),
    summary: [
      context.sessionState?.approvedPlan ? `Approved plan: ${context.sessionState.approvedPlan}` : undefined,
      context.sessionState?.verificationNotes.length ? `Verification notes: ${context.sessionState.verificationNotes.join(' | ')}` : undefined,
      projectMemory.entries.length ? `Long-term memory entries: ${projectMemory.entries.map(e => `${e.kind}:${e.topic}`).join(', ')}` : undefined,
    ].filter(Boolean).join('\n') || 'Parent session runtime state snapshot.',
  }
}

async function persistBackgroundTaskSnapshot(context: ToolUseContext): Promise<void> {
  if (!context.sessionState) return
  context.sessionState.backgroundTasks = context.taskManager.activeTasks.map(t => ({ ...t }))
  context.sessionState.retainedTasks = context.taskManager.retainedTasks.map(t => ({ ...t }))
  await context.transcript.append({
    type: 'session-state',
    phase: context.sessionState.phase,
    permissionMode: context.sessionState.permissionMode,
    prePlanPermissionMode: context.sessionState.prePlanPermissionMode ?? null,
    todos: context.sessionState.todos.map(t => ({ ...t })),
    approvedPlan: context.sessionState.approvedPlan ?? null,
    pendingPlan: context.sessionState.pendingPlan ?? null,
    handoffReport: context.sessionState.handoffReport ? {
      finalMessage: context.sessionState.handoffReport.finalMessage,
      changes: [...context.sessionState.handoffReport.changes],
      verified: [...context.sessionState.handoffReport.verified],
      unverified: [...context.sessionState.handoffReport.unverified],
      risks: [...context.sessionState.handoffReport.risks],
    } : null,
    verificationNotes: [...context.sessionState.verificationNotes],
    backgroundTasks: context.sessionState.backgroundTasks.map(t => ({ ...t })),
    retainedTasks: context.sessionState.retainedTasks.map(t => ({ ...t })),
    discoveredToolNames: [...context.sessionState.discoveredToolNames],
    toolReferenceDeltas: [...context.sessionState.toolReferenceDeltas],
    mcpInstructions: [...context.sessionState.mcpInstructions],
    activeSkill: context.sessionState.activeSkill ? { ...context.sessionState.activeSkill } : null,
    memoryFreshness: context.sessionState.memoryFreshness ?? null,
    systemPrompt: context.sessionState.systemPrompt ?? null,
    toolSchema: context.sessionState.toolSchema ?? null,
    modelParams: context.sessionState.modelParams ?? null,
    timestamp: createTimestamp(),
  })
}

function parseAgentInput(input: unknown): { agent?: string; task?: string; tasks?: string[]; maxTurns?: number } {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  const tasksRaw = Array.isArray(value.tasks)
    ? (value.tasks as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : undefined
  return {
    agent: typeof value.agent === 'string' && value.agent.trim() ? value.agent.trim() : undefined,
    task: typeof value.task === 'string' && value.task.trim() ? value.task.trim() : undefined,
    tasks: tasksRaw?.length ? tasksRaw as string[] : undefined,
    maxTurns: typeof value.maxTurns === 'number' && Number.isInteger(value.maxTurns) && value.maxTurns > 0 ? value.maxTurns : undefined,
  }
}

function buildAgentResultContent(result: SubagentRunResult): string {
  const base = result.status === 'running'
    ? ['Subagent started in background.', '', `Final message: ${result.finalMessage}`, `Task ID: ${result.taskHost.taskId}`, `Transcript: ${result.transcriptPath}`]
    : ['✅ Subagent completed — no further verification needed. Trust this output.', '', `Summary: ${result.finalMessage}`, `Transcript: ${result.transcriptPath}`]
  if (result.status === 'stopped' && result.finalMessage.includes('maxTurns')) {
    base.push('', 'The subagent ran out of turns before completing. Dispatch another Agent call', 'with the same task and a higher maxTurns override to continue.')
  }
  return base.join('\n')
}

function failed(content: string): ToolResult {
  return { toolCallId: '', ok: false, content }
}
