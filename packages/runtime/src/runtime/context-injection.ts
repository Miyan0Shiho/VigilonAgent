import { createTimestamp } from './transcript.js'
import {
  buildSessionMemoryInjection,
  getSessionMemoryPath,
  isSessionMemoryFresh,
  readSessionMemory,
} from './sessionMemory.js'
import type {
  TranscriptStore,
  TranscriptEvent,
  RuntimeProjectConfig,
  RuntimeSessionState,
  RuntimeSessionSnapshot,
  RuntimeOperator,
  RuntimeSkill,
  ActiveSkillRuntimeState,
  CompactTokenPreflightMetadata,
  FileReadingLimits,
} from './contracts.js'

export function buildSystemPrompt(options: {
  cwd: string
  permissionMode?: string
  projectConfig?: RuntimeProjectConfig
  skills?: readonly RuntimeSkill[]
  projectInstructions?: string
  maxTurns?: number
}): string {
  const sections: string[] = []

  // Identity
  sections.push(`You are Vigilon, a local coding agent. You help users with software engineering tasks by reading, editing, and running code.
Your tools give you direct access to the filesystem — read files, search code, run shell commands, and edit files.`)

  // Core workflow
  sections.push(`## Workflow
1. Understand the task — read relevant files before acting.
2. Plan — for multi-step work, use TodoWrite to track progress.
3. Execute with dedicated tools — prefer Read/Write/Edit over bash cat/sed/awk; prefer Grep/Glob over find/grep.
4. Verify — run tests or check your output.
5. Stop — give a final answer once you have enough evidence. Do not keep searching after the answer is clear.
6. Do not re-read files you already have in this conversation. Reference the earlier result directly.`)

  // Tool guidance
  sections.push(`## Tools
- Call multiple independent tools in parallel in a single response.
- Use Agent to delegate focused subtasks to subagents. Subagents have their own transcript and restricted tools.
- Use Bash for verification or shell-only tasks, not for file reading/searching.
- Use ResultReport only when a structured audit handoff is useful.`)

  // Code rules
  sections.push(`## Code
- Only change what the task requires. No extra refactoring, abstractions, or config.
- Follow the existing code style in each file.
- Write secure code — no command injection, XSS, SQL injection.
- Do not add error handling for scenarios that cannot happen.
- Do not create new files when editing an existing one would work.`)

  // Project context
  const projectLines: string[] = [`cwd: ${options.cwd}`]
  if (options.permissionMode) {
    projectLines.push(`permission mode: ${options.permissionMode}`)
  }
  if (options.maxTurns !== undefined) {
    projectLines.push(`max turns: ${options.maxTurns}`)
  }
  if (options.projectConfig?.ignore.length) {
    projectLines.push(`ignored paths: ${options.projectConfig.ignore.join(', ')}`)
  }
  if (options.projectConfig?.defaultCommands && Object.keys(options.projectConfig.defaultCommands).length > 0) {
    projectLines.push(`default commands: ${Object.entries(options.projectConfig.defaultCommands).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  }
  sections.push(`## Project\n${projectLines.join('\n')}`)

  // Project instructions (AGENTS.md, VIGILON.md)
  if (options.projectInstructions?.trim()) {
    sections.push(`## Project Instructions\n${options.projectInstructions.trim()}`)
  }

  // Skills
  if (options.skills?.length) {
    const skillLines = options.skills
      .filter(s => !s.disableModelInvocation)
      .map(s => `- ${s.name}: ${s.description}`)
    if (skillLines.length > 0) {
      sections.push(`## Available Skills\n${skillLines.join('\n')}`)
    }
  }

  return sections.join('\n\n')
}

export function injectProjectConfig(
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

export function injectOperatorGuidance(
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

export function mergePromptDerivedProjectConfig(
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

export function derivePromptIgnorePatterns(prompt: string): string[] {
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

export function expandPromptIgnoreToken(token: string): string[] {
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

export function isLikelyIgnorablePathPart(part: string): boolean {
  return (
    part.startsWith('.') ||
    /^(?:research|archive|archives|archived|dist|build|coverage|node_modules|tmp|temp)$/iu.test(
      part,
    )
  )
}

export function injectSessionMemory(
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

export function injectCapabilityReplay(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  sessionState: RuntimeSessionState,
  shouldInject: boolean,
  readFilePaths?: string[],
  _searchCount?: { grep: number; glob: number },
): Awaited<ReturnType<TranscriptStore['readAll']>> {
  if (!shouldInject && !readFilePaths?.length) return events

  const replayLines: string[] = []
  if (readFilePaths?.length) {
    replayLines.push(`already_read_files="${readFilePaths.join(', ')}"`)
    replayLines.push('Do not re-read these files. Their full content is already in your context from earlier results.')
  }
  if (_searchCount && (_searchCount.grep + _searchCount.glob) >= 5) {
    replayLines.push(`search_count=${_searchCount.grep + _searchCount.glob} (grep=${_searchCount.grep}, glob=${_searchCount.glob})`)
    replayLines.push('You have done many searches. Stop searching now — synthesize what you have and move to the next step.')
  }
  if (!shouldInject) {
    // Still inject the read file list even if there's nothing else to replay
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
    return [replayEvent, ...events]
  }
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

export function injectRuntimeProgress(
  events: Awaited<ReturnType<TranscriptStore['readAll']>>,
  sessionState: RuntimeSessionState,
  _maxTurns?: number,
  _currentTurn?: number,
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
  if (_maxTurns !== undefined && _currentTurn !== undefined && _currentTurn > _maxTurns * 0.6) {
    lines.push(`turn=${_currentTurn}/${_maxTurns}`)
    lines.push('You are past the halfway point. Stop exploring — consolidate your findings and produce your output now. If you need to write a file, do it immediately.')
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

export function injectActiveTask(
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

export function countLeadingRuntimeStateEvents(
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

export async function loadSessionMemory(options: {
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

export function getTranscriptPathForStore(
  transcript: TranscriptStore,
): string | undefined {
  return 'transcriptPath' in transcript ? transcript.transcriptPath : undefined
}

