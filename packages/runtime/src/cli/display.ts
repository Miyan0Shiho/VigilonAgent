import type {
  AgentRuntimeEvent,
  AgentRuntimeTurnResult,
  RuntimeSessionSummary,
} from '../runtime/contracts.js'
import { createPhase1RuntimeBaseline } from '../runtime/baseline.js'
import { getProjectSessionDir } from '../runtime/transcript.js'
import { readTranscriptFile } from '../runtime/transcript.js'
import { VIGILON_RUNTIME_VERSION } from '../version.js'
import type { ResolvedOptions } from './parse.js'

export function renderDoctor(
  output: Pick<NodeJS.WriteStream, 'write'>,
  parsed: ResolvedOptions,
  env: NodeJS.ProcessEnv,
): void {
  const baseline = createPhase1RuntimeBaseline()
  output.write(
    [
      '',
      'Doctor',
      `version: ${VIGILON_RUNTIME_VERSION}`,
      `cwd: ${parsed.cwd}`,
      `session root: ${getProjectSessionDir(parsed.cwd, parsed.sessionsDir)}`,
      `default permission: ${parsed.permissionMode}`,
      `model: ${parsed.model ?? env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'}`,
      `api key: ${env.DEEPSEEK_API_KEY ? 'present' : 'missing'}`,
      `settings sources: ${parsed.settings.loadedSources.map(source => source.path).join(', ') || 'none'}`,
      `skills loaded: ${parsed.skills.skills.length}`,
      `mcp tools loaded: ${parsed.mcp.tools.length}`,
      `phase baseline: ${baseline.phase} (${baseline.includedCapabilities.length} included / ${baseline.excludedSurfaces.length} excluded)`,
    ].join('\n') + '\n',
  )
}

export function formatTranscriptEvent(event: Awaited<ReturnType<typeof readTranscriptFile>>[number]): string {
  switch (event.type) {
    case 'user':
      return `- user: ${truncateText(event.content, 120)}`
    case 'assistant':
      return `- assistant: ${truncateText(event.content, 120)}`
    case 'tool-call':
      return `- tool-call: ${event.call.name}`
    case 'tool-result':
      return `- tool-result: ${event.result.ok ? 'ok' : 'error'} ${truncateText(event.result.content, 100)}`
    case 'permission':
      return `- permission: ${event.request.action} => ${event.decision.allowed ? 'allow' : 'deny'}`
    case 'session-state':
      return `- session-state: phase=${event.phase} todos=${event.todos?.length ?? 0}`
    case 'compact-boundary':
      return `- compact: ${truncateText(event.summary, 100)}`
    case 'llm-response':
      return `- llm-response: ${event.status} ${event.stopReason}`
    case 'request-stability':
      return `- stability: ${event.classification}`
    case 'subagent-lifecycle':
      return `- subagent: ${event.event.agentName} ${event.event.status} ${truncateText(event.event.summary ?? event.event.finalMessage, 100)}`
    case 'lsp-diagnostics':
      return `- lsp-diagnostics: ${event.serverName} (${event.files.length} files)`
    case 'hook':
      return `- hook: ${event.hookName} => ${event.decision.outcome}`
    case 'project-config':
      return '- project-config'
    case 'content-replacement':
      return `- content-replacement: ${event.replacements.length}`
    case 'llm-request':
      return `- llm-request: ${event.model} tools=${event.toolCount}`
    default:
      return '- event'
  }
}

export function formatRuntimeEvent(event: AgentRuntimeEvent): string {
  switch (event.type) {
    case 'model-request-started':
      return '[model] request started'
    case 'model-response-received':
      return `[model] stop=${event.response.stopReason} toolCalls=${event.response.toolCalls.length} message=${truncateText(event.response.content, 120)}`
    case 'tool-started':
      return `[tool:start] ${event.call.name} ${truncateText(JSON.stringify(event.call.input), 120)}`
    case 'tool-finished':
      return `[tool:${event.result.ok ? 'ok' : 'error'}] ${truncateText(event.result.content, 140)}`
    case 'subagent-lifecycle':
      return `[subagent:${event.event.status}] ${event.event.agentName} ${truncateText(event.event.summary ?? event.event.finalMessage, 120)}`
    case 'turn-finished':
      return `[turn] ${event.result.report.status} turns=${event.result.turns}`
    default:
      return '[event]'
  }
}

export function formatFinalWorkbenchReport(
  result: AgentRuntimeTurnResult,
  transcriptPath: string,
): string {
  const handoff = result.report.handoffReport
  const changes =
    handoff?.changes.length
      ? handoff.changes
      : result.report.fileChanges.map(change => `${change.type} ${change.filePath}`)
  const verified =
    handoff?.verified.length ? handoff.verified : result.report.verificationNotes
  const unverified =
    handoff?.unverified.length
      ? handoff.unverified
      : ['No explicit unverified items were recorded.']
  const risks =
    handoff?.risks.length ? handoff.risks : ['No explicit risks were recorded.']
  return [
    '',
    'Result handoff',
    `status: ${result.report.status}`,
    `transcript: ${transcriptPath}`,
    `final message: ${result.finalMessage}`,
    `changes: ${changes.length > 0 ? changes.join(' | ') : 'None recorded'}`,
    `verified: ${verified.length > 0 ? verified.join(' | ') : 'None recorded'}`,
    `unverified: ${unverified.join(' | ')}`,
    `risks: ${risks.join(' | ')}`,
    `warnings: ${result.report.warnings.length > 0 ? result.report.warnings.join(' | ') : 'None'}`,
    `todos: ${
      result.report.todos.length > 0
        ? result.report.todos.map(todo => `${todo.status}:${todo.content}`).join(' | ')
        : 'None'
    }`,
    `next: ${
      result.report.status === 'completed'
        ? 'Review the transcript or continue from /resume if more work is needed.'
        : 'Use /open or /resume to inspect and continue this session.'
    }`,
  ].join('\n')
}

export function renderPanel(
  title: string,
  lines: string[],
  status: string,
): string {
  const body = lines.map(line => `  ${line}`).join('\n')
  return [
    `┌─ ${title} (${status})`,
    body,
    '└',
  ].join('\n')
}

export function row(label: string, value: string): string {
  return `${label.padEnd(14, ' ')} ${value}`
}

export function sectionTitle(title: string): string {
  return `${title}:`
}

export function statusBadge(status: RuntimeSessionSummary['status']): string {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  if (status === 'waiting_approval') return 'waiting approval'
  return 'recoverable'
}

export function truncateText(value: string | undefined, maxChars: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`
}
