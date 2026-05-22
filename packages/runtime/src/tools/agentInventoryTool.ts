import { loadAgentCatalog } from '../runtime/agentDefinitions.js'
import {
  buildPermissionOriginSummary,
  renderPermissionOriginSummary,
} from '../runtime/permissionOrigins.js'
import { readTranscriptFile } from '../runtime/transcript.js'
import type {
  BackgroundTask,
  PermissionOriginSummary,
  Tool,
  ToolResult,
  ToolUseContext,
} from '../runtime/contracts.js'

type InventoryTask = BackgroundTask & {
  permissionSummary?: PermissionOriginSummary
  permissionReadError?: string
}

export const AgentInventoryTool: Tool = {
  name: 'AgentInventory',
  description:
    'Lists source-aware subagent definitions, source override relationships, and active/retained subagent task lifecycle state.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async invoke(_input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const catalog = await loadAgentCatalog({ cwd: context.cwd })
    const activeTasks = await annotateTasksWithPermissionSummaries(
      context.taskManager.activeTasks.map(task => ({ ...task })),
    )
    const retainedTasks = await annotateTasksWithPermissionSummaries(mergeTasks(
      context.taskManager.retainedTasks,
      context.sessionState?.retainedTasks ?? [],
    ))
    const metadata = {
      catalog: {
        precedence: catalog.precedence,
        active: catalog.active.map(agent => ({
          name: agent.name,
          source: agent.source,
          sourceScope: agent.sourceScope,
          sourcePath: agent.sourcePath,
          description: agent.description,
          allowedTools: agent.allowedTools,
          maxTurns: agent.maxTurns,
          memory: agent.memory ?? 'inherit',
          background: agent.background === true,
          host: agent.host ?? 'local',
          permissionMode: agent.permissionMode,
          model: agent.model,
          effort: agent.effort,
        })),
        entries: catalog.entries.map(entry => ({
          name: entry.definition.name,
          source: entry.definition.source,
          sourceScope: entry.definition.sourceScope,
          sourcePath: entry.definition.sourcePath,
          overriddenBy: entry.overriddenBy,
          active: !entry.overriddenBy,
        })),
      },
      tasks: {
        active: activeTasks,
        retained: retainedTasks,
      },
    }

    return {
      toolCallId: '',
      ok: true,
      content: renderInventory(metadata),
      metadata,
    }
  },
}

function mergeTasks(
  primary: readonly BackgroundTask[],
  fallback: readonly BackgroundTask[],
): BackgroundTask[] {
  const byId = new Map<string, BackgroundTask>()
  for (const task of fallback) byId.set(task.id, { ...task })
  for (const task of primary) byId.set(task.id, { ...task })
  return [...byId.values()]
}

async function annotateTasksWithPermissionSummaries(
  tasks: readonly BackgroundTask[],
): Promise<InventoryTask[]> {
  return Promise.all(tasks.map(async task => annotateTaskWithPermissionSummary(task)))
}

async function annotateTaskWithPermissionSummary(task: BackgroundTask): Promise<InventoryTask> {
  if (task.type !== 'subagent' || !task.transcriptPath) return { ...task }
  try {
    const events = await readTranscriptFile(task.transcriptPath)
    return {
      ...task,
      permissionSummary: buildPermissionOriginSummary(events),
    }
  } catch (error) {
    return {
      ...task,
      permissionReadError: error instanceof Error ? error.message : String(error),
    }
  }
}

function renderInventory(metadata: {
  catalog: {
    precedence: string[]
    active: Array<{
      name: string
      source: string
      sourceScope?: string
      description: string
      allowedTools: string[]
      maxTurns: number
      memory: string
      background: boolean
      host?: string
    }>
    entries: Array<{
      name: string
      source: string
      sourceScope?: string
      overriddenBy?: string
      active: boolean
    }>
  }
  tasks: {
    active: InventoryTask[]
    retained: InventoryTask[]
  }
}): string {
  return [
    'Agent inventory',
    `source precedence: ${metadata.catalog.precedence.join(' -> ')}`,
    '',
    'Active definitions:',
    ...metadata.catalog.active.map(agent =>
      [
        `- ${agent.name}`,
        `source=${formatSource(agent.source, agent.sourceScope)}`,
        `maxTurns=${agent.maxTurns}`,
        `memory=${agent.memory}`,
        `background=${agent.background}`,
        `host=${agent.host ?? 'local'}`,
        `tools=${agent.allowedTools.join(', ') || '(none)'}`,
        `description=${agent.description}`,
      ].join(' | '),
    ),
    '',
    'Override entries:',
    ...metadata.catalog.entries.map(entry =>
      `- ${entry.name} source=${formatSource(entry.source, entry.sourceScope)} ${entry.active ? 'active=true' : `overriddenBy=${entry.overriddenBy}`}`,
    ),
    '',
    'Active tasks:',
    ...(metadata.tasks.active.length
      ? metadata.tasks.active.map(renderTask)
      : ['- none']),
    '',
    'Retained tasks:',
    ...(metadata.tasks.retained.length
      ? metadata.tasks.retained.map(renderTask)
      : ['- none']),
  ].join('\n')
}

function formatSource(source: string, scope?: string): string {
  return scope ? `${source}:${scope}` : source
}

function renderTask(task: InventoryTask): string {
  return [
    `- ${task.id}`,
    `type=${task.type}`,
    `status=${task.status ?? 'running'}`,
    task.agentName ? `agent=${task.agentName}` : undefined,
    task.background !== undefined ? `background=${task.background}` : undefined,
    task.host ? `host=${task.host}` : undefined,
    task.cwd ? `cwd=${task.cwd}` : undefined,
    task.worktreePath ? `worktree=${task.worktreePath}` : undefined,
    task.worktreeDiff
      ? `worktreeDiff=${task.worktreeDiff.status}:${task.worktreeDiff.filesChanged} files +${task.worktreeDiff.additions} -${task.worktreeDiff.deletions}`
      : undefined,
    task.worktreeDiff?.patchPath ? `patch=${task.worktreeDiff.patchPath}` : undefined,
    task.worktreeDiff?.sourceApply
      ? `sourceApply=${task.worktreeDiff.sourceApply.status}:${task.worktreeDiff.sourceApply.filesChanged} files`
      : undefined,
    task.worktreeDiff?.sourceApply?.conflicts?.length
      ? `conflicts=${task.worktreeDiff.sourceApply.conflicts.join(',')}`
      : undefined,
    task.terminalReason ? `reason=${task.terminalReason}` : undefined,
    task.outputSummary ? `output=${task.outputSummary}` : undefined,
    task.permissionSummary
      ? renderPermissionOriginSummary(task.permissionSummary).join(' | ')
      : undefined,
    task.permissionReadError ? `permissionReadError=${task.permissionReadError}` : undefined,
    task.transcriptPath ? `transcript=${task.transcriptPath}` : undefined,
  ].filter(Boolean).join(' | ')
}
