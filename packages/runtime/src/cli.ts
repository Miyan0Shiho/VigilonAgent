import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { createDeepSeekModelClient } from './model/deepseek.js'
import { createVigilonAgentRuntime } from './runtime/agentLoop.js'
import { createPhase1RuntimeBaseline } from './runtime/baseline.js'
import type {
  AskUserQuestionInput,
  AgentRuntimeEvent,
  AgentRuntimeTurnResult,
  ModelClient,
  PermissionDecision,
  PermissionGate,
  PermissionMode,
  PermissionRequest,
  PreToolUseHook,
  RuntimeProjectConfig,
  RuntimeOperator,
  RuntimeSessionSnapshot,
  RuntimeSessionSummary,
} from './runtime/contracts.js'
import {
  loadRuntimeMcpTools,
  type LoadedRuntimeMcp,
} from './runtime/mcp.js'
import { decidePermission } from './runtime/permissions.js'
import {
  createSettingsPreToolUseHooks,
  loadRuntimeSettings,
  normalizeProjectConfig,
  type LoadedRuntimeSettings,
} from './runtime/settings.js'
import {
  loadRuntimeSkills,
  type LoadedRuntimeSkills,
} from './runtime/skills.js'
import {
  JsonlTranscriptStore,
  createTimestamp,
  getProjectSessionDir,
  listSessions,
  readTranscriptFile,
  resumeSessionById,
} from './runtime/transcript.js'
import {
  generateSessionMemoryFromSnapshot,
  getSessionMemoryPath,
  isSessionMemoryFresh,
  writeSessionMemory,
} from './runtime/sessionMemory.js'
import { createCoreToolRegistry } from './tools/coreTools.js'
import { VIGILON_RUNTIME_VERSION } from './version.js'

type CliIO = {
  stdout: Pick<NodeJS.WriteStream, 'write'>
  stderr: Pick<NodeJS.WriteStream, 'write'>
  stdin?: NodeJS.ReadableStream
  env: NodeJS.ProcessEnv
}

type CliDeps = {
  createModelClient?: (env: NodeJS.ProcessEnv) => ModelClient
}

type QuestionReader = {
  question(prompt: string): Promise<string>
  close(): void
}

type ParsedOptions = {
  cwd: string
  sessionsDir?: string
  permissionMode?: PermissionMode
  maxTurns?: number
  sessionId?: string
  model?: string
  deepseekBaseUrl?: string
  approvePlan?: boolean
  prompt: string
}

type ResolvedOptions = Omit<ParsedOptions, 'permissionMode'> & {
  permissionMode: PermissionMode
  settings: LoadedRuntimeSettings
  skills: LoadedRuntimeSkills
  mcp: LoadedRuntimeMcp
  projectConfig: RuntimeProjectConfig
  preToolUseHooks: PreToolUseHook[]
}

const PERMISSION_MODES = new Set<PermissionMode>([
  'read-only',
  'ask',
  'accept-edits',
  'bypass-local',
])

export async function runCli(
  argv = process.argv.slice(2),
  io: CliIO = {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin.isTTY ? process.stdin : undefined,
    env: process.env,
  },
  deps: CliDeps = {},
): Promise<number> {
  const args = argv.filter(arg => arg !== '--')
  if (args.includes('--version') || args.includes('-v')) {
    io.stdout.write(`${VIGILON_RUNTIME_VERSION}\n`)
    return 0
  }

  const command = args[0]
  try {
    if (!command && io.stdin) {
      await runWorkbench([], io, deps)
      return 0
    }
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      printHelp(io.stdout)
      return 0
    }
    if (command === 'doctor') {
      await runDoctor(args.slice(1), io.stdout, io.env)
      return 0
    }
    if (command === 'sessions') {
      await printSessions(args.slice(1), io.stdout, io.env)
      return 0
    }
    if (command === 'summary') {
      await summarizeSession(args.slice(1), io.stdout, io.env)
      return 0
    }
    if (command === 'run') {
      await runPrompt(args.slice(1), io.stdout, io.env, io, deps)
      return 0
    }
    if (command === 'resume') {
      await resumePrompt(args.slice(1), io.stdout, io.env, io, deps)
      return 0
    }
    if (command === 'tui') {
      return runExternalTui(args.slice(1), io, deps)
    }

    io.stderr.write(`Unknown command: ${command}\n`)
    printHelp(io.stderr)
    return 1
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

async function runExternalTui(
  args: string[],
  io: CliIO,
  deps: CliDeps,
): Promise<number> {
  const specifier = '@vigilon/tui'
  let tui: {
    runTui: (argv: string[], io: CliIO, deps: CliDeps) => Promise<number>
  }
  try {
    tui = await import(specifier) as typeof tui
  } catch {
    const fallbackSpecifier = new URL('../../tui/src/index.ts', import.meta.url).href
    tui = await import(fallbackSpecifier) as typeof tui
  }
  return tui.runTui(args, io, {
    ...deps,
    runtimeModule: createRuntimeModuleForTui(),
  } as CliDeps)
}

function createRuntimeModuleForTui(): Record<string, unknown> {
  return {
    createPhase1RuntimeBaseline,
    createDeepSeekModelClient,
    createVigilonAgentRuntime,
    loadRuntimeMcpTools,
    decidePermission,
    createSettingsPreToolUseHooks,
    loadRuntimeSettings,
    normalizeProjectConfig,
    loadRuntimeSkills,
    JsonlTranscriptStore,
    createTimestamp,
    getProjectSessionDir,
    listSessions,
    readTranscriptFile,
    resumeSessionById,
    createCoreToolRegistry,
    VIGILON_RUNTIME_VERSION,
  }
}

function printHelp(output: Pick<NodeJS.WriteStream, 'write'>): void {
  output.write(`Vigilon Runtime ${VIGILON_RUNTIME_VERSION}

Usage:
  vigilon --version
  vigilon doctor
  vigilon tui [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>]
  vigilon sessions [--cwd <path>] [--sessions-dir <path>]
  vigilon summary <session-id> [--cwd <path>] [--sessions-dir <path>]
  vigilon run <prompt...> [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>] [--deepseek-base-url <url>] [--max-turns <n>]
  vigilon resume <session-id> <prompt...> [--approve-plan] [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>] [--deepseek-base-url <url>] [--max-turns <n>]

Permission modes: read-only, ask, accept-edits, bypass-local
Interactive workbench: plain text starts a new task; /resume, /approve, /open, /doctor, /refresh, /quit manage sessions.
Plan approval: resume <session-id> --approve-plan "continue..." promotes a pending plan from transcript state before running the next turn.
Settings files: ~/.vigilon/settings.json, <cwd>/.vigilon/settings.json, <cwd>/.vigilon/settings.local.json
Local MCP servers: configure mcpServers in settings files
`)
}

function printDoctor(output: Pick<NodeJS.WriteStream, 'write'>): void {
  const baseline = createPhase1RuntimeBaseline()
  writeJson(output, {
    status: 'ok',
    package: '@vigilon/runtime',
    version: VIGILON_RUNTIME_VERSION,
    phase: baseline.phase,
    sourcePolicy: baseline.sourcePolicy,
    includedCapabilities: baseline.includedCapabilities.length,
    excludedSurfaces: baseline.excludedSurfaces.length,
  })
}

async function runDoctor(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parsed = await resolveOptions(
    parseOptions(args, { requirePrompt: false }),
    env,
  )
  const baseline = createPhase1RuntimeBaseline()
  writeJson(output, {
    status: env.DEEPSEEK_API_KEY ? 'ok' : 'warning',
    package: '@vigilon/runtime',
    version: VIGILON_RUNTIME_VERSION,
    phase: baseline.phase,
    sourcePolicy: baseline.sourcePolicy,
    includedCapabilities: baseline.includedCapabilities.length,
    excludedSurfaces: baseline.excludedSurfaces.length,
    cwd: parsed.cwd,
    sessionsDir: getProjectSessionDir(parsed.cwd, parsed.sessionsDir),
    permissionMode: parsed.permissionMode,
    model: parsed.model ?? env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
    deepseekApiKeyPresent: Boolean(env.DEEPSEEK_API_KEY),
    settingsSources: parsed.settings.loadedSources,
    loadedSkillCount: parsed.skills.skills.length,
    loadedMcpToolCount: parsed.mcp.tools.length,
    configuredMcpServerCount: Object.keys(parsed.settings.settings.mcpServers ?? {}).length,
  })
  parsed.mcp.close()
}

async function printSessions(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parsed = await resolveOptions(
    parseOptions(args, { requirePrompt: false }),
    env,
  )
  writeJson(output, {
    sessions: await listSessions({
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
    }),
  })
}

async function summarizeSession(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const sessionId = args[0]
  if (!sessionId || sessionId.startsWith('-')) {
    throw new Error('summary requires a session id')
  }
  const parsed = await resolveOptions(
    parseOptions(args.slice(1), { requirePrompt: false }),
    env,
  )
  const snapshot = await resumeSessionById({
    sessionId,
    cwd: parsed.cwd,
    sessionsDir: parsed.sessionsDir,
  })
  const memory = generateSessionMemoryFromSnapshot(snapshot)
  const memoryPath = getSessionMemoryPath({
    cwd: parsed.cwd,
    sessionsDir: parsed.sessionsDir,
    sessionId: snapshot.sessionId,
    transcriptPath: snapshot.transcriptPath,
  })
  await writeSessionMemory(memoryPath, memory)
  writeJson(output, {
    sessionId: snapshot.sessionId,
    transcriptPath: snapshot.transcriptPath,
    memoryPath,
    sourceEventCount: memory.sourceEventCount,
    fresh: isSessionMemoryFresh(memory, snapshot.events.length),
    generatedAt: memory.generatedAt,
  })
  parsed.mcp.close()
}

async function runWorkbench(
  args: string[],
  io: CliIO,
  deps: CliDeps,
): Promise<void> {
  if (!io.stdin) {
    throw new Error('tui requires an interactive stdin surface')
  }

  const parsed = await resolveOptions(
    parseOptions(args, { requirePrompt: false }),
    io.env,
  )
  const reader = createBufferedQuestionReader(io.stdin)

  try {
    while (true) {
      const sessions = await listSessions({
        cwd: parsed.cwd,
        sessionsDir: parsed.sessionsDir,
      })
      renderWorkbench(io.stdout, parsed, sessions)
      let raw: string
      try {
        io.stdout.write('vigilon> ')
        raw = (await reader.question('')).trim()
      } catch {
        return
      }
      if (!raw) continue
      if (raw === '/quit' || raw === 'quit' || raw === 'exit') return
      if (raw === '/refresh') continue
      if (raw === '/doctor') {
        renderDoctor(io.stdout, parsed, io.env)
        continue
      }
      if (raw.startsWith('/open ')) {
        await renderSessionDetail(io.stdout, parsed, sessions, raw.slice('/open '.length).trim())
        continue
      }
      if (raw.startsWith('/resume ')) {
        await runWorkbenchResume({
          command: raw.slice('/resume '.length).trim(),
          parsed,
          io,
          deps,
          reader,
          approvePlan: false,
        })
        continue
      }
      if (raw.startsWith('/approve ')) {
        await runWorkbenchResume({
          command: raw.slice('/approve '.length).trim(),
          parsed,
          io,
          deps,
          reader,
          approvePlan: true,
        })
        continue
      }

      const prompt =
        raw.startsWith('/new ') ? raw.slice('/new '.length).trim() : raw
      if (!prompt) continue
      await runWorkbenchTask({
        prompt,
        parsed,
        io,
        deps,
        reader,
      })
    }
  } finally {
    parsed.mcp.close()
    reader.close()
  }
}

function createBufferedQuestionReader(
  input: NodeJS.ReadableStream,
): QuestionReader {
  const iterator = input[Symbol.asyncIterator]()
  let buffer = ''
  const lines: string[] = []

  async function readLine(): Promise<string> {
    while (lines.length === 0) {
      const next = await iterator.next()
      if (next.done) {
        if (buffer.length > 0) {
          const trailing = buffer
          buffer = ''
          return trailing
        }
        throw new Error('EOF')
      }
      buffer += String(next.value)
      const normalized = buffer.replace(/\r\n/g, '\n')
      const parts = normalized.split('\n')
      buffer = parts.pop() ?? ''
      lines.push(...parts)
    }
    return lines.shift() ?? ''
  }

  return {
    async question() {
      return readLine()
    },
    close() {},
  }
}

function renderWorkbench(
  output: Pick<NodeJS.WriteStream, 'write'>,
  parsed: ResolvedOptions,
  sessions: Awaited<ReturnType<typeof listSessions>>,
): void {
  const body = [
    row('Workspace', parsed.cwd),
    row('Sessions', getProjectSessionDir(parsed.cwd, parsed.sessionsDir)),
    row(
      'Runtime',
      `permission=${parsed.permissionMode} model=${parsed.model ?? 'auto'} maxTurns=${parsed.maxTurns ?? 'unbounded'}`,
    ),
    '',
    sectionTitle('Active Sessions'),
    ...formatSessionRows(sessions),
    '',
    sectionTitle('Commands'),
    '  <prompt>                         start a new task',
    '  /new <prompt>                    start a new task explicitly',
    '  /resume <index|session-id> ...    continue an existing session',
    '  /approve <index|session-id> ...   approve pending plan and continue',
    '  /open <index|session-id>          inspect transcript preview',
    '  /doctor | /refresh | /quit',
  ]
  output.write(
    `\n${renderPanel('Vigilon Operator Workbench', body, 'ready')}\n`,
  )
}

function formatSessionRows(sessions: RuntimeSessionSummary[]): string[] {
  if (sessions.length === 0) {
    return ['  no sessions yet']
  }
  return sessions.slice(0, 8).flatMap((session, index) => {
    const status = statusBadge(session.status)
    const title = truncateText(session.title ?? session.sessionId, 48)
    const meta = [
      `id=${session.sessionId}`,
      `todos=${session.remainingTodoCount}`,
      `verify=${session.verificationCount}`,
      `bg=${session.backgroundTaskCount}`,
      session.hasHandoffReport ? 'handoff=yes' : 'handoff=no',
    ].join('  ')
    return [
      `  ${String(index + 1).padStart(2, ' ')}  ${status.padEnd(16, ' ')} ${title}`,
      `      ${meta}`,
      session.lastAction ? `      last ${truncateText(session.lastAction, 76)}` : '',
    ].filter(Boolean)
  })
}

async function renderSessionDetail(
  output: Pick<NodeJS.WriteStream, 'write'>,
  parsed: ResolvedOptions,
  sessions: Awaited<ReturnType<typeof listSessions>>,
  selector: string,
): Promise<void> {
  const session = resolveSessionSelector(selector, sessions)
  if (!session) {
    output.write(`No session matched: ${selector}\n`)
    return
  }
  const events = await readTranscriptFile(session.transcriptPath)
  output.write(
    renderPanel('Session Detail', [
      row('Session', session.sessionId),
      row('Status', session.status),
      row('Title', session.title ?? 'untitled'),
      session.pendingPlan ? row('Pending plan', session.pendingPlan) : '',
      session.finalMessage ? row('Assistant', truncateText(session.finalMessage, 88)) : '',
      session.lastAction ? row('Last action', truncateText(session.lastAction, 88)) : '',
      row('Handoff', session.hasHandoffReport ? 'recorded' : 'missing'),
      '',
      sectionTitle('Recent Transcript'),
      ...events.slice(-8).map(event => formatTranscriptEvent(event)),
    ].filter(Boolean), session.status) + '\n',
  )
}

async function runWorkbenchResume({
  command,
  parsed,
  io,
  deps,
  reader,
  approvePlan,
}: {
  command: string
  parsed: ResolvedOptions
  io: CliIO
  deps: CliDeps
  reader: QuestionReader
  approvePlan: boolean
}): Promise<void> {
  const [selector, ...promptParts] = command.split(' ').filter(Boolean)
  if (!selector) {
    io.stdout.write(`${approvePlan ? '/approve' : '/resume'} requires a session id or index\n`)
    return
  }
  const sessions = await listSessions({
    cwd: parsed.cwd,
    sessionsDir: parsed.sessionsDir,
  })
  const session = resolveSessionSelector(selector, sessions)
  if (!session) {
    io.stdout.write(`No session matched: ${selector}\n`)
    return
  }
  await runWorkbenchTask({
    prompt:
      promptParts.join(' ').trim() ||
      'Continue with the approved plan.',
    parsed,
    io,
    deps,
    reader,
    sessionId: session.sessionId,
    approvePlan,
  })
}

async function runWorkbenchTask({
  prompt,
  parsed,
  io,
  deps,
  reader,
  sessionId,
  approvePlan = false,
}: {
  prompt: string
  parsed: ResolvedOptions
  io: CliIO
  deps: CliDeps
  reader: QuestionReader
  sessionId?: string
  approvePlan?: boolean
}): Promise<void> {
  const resume =
    sessionId === undefined
      ? undefined
      : await resumeSessionById({
          sessionId,
          cwd: parsed.cwd,
          sessionsDir: parsed.sessionsDir,
        })
  const activeTranscript =
    sessionId === undefined
      ? new JsonlTranscriptStore({
          cwd: parsed.cwd,
          sessionsDir: parsed.sessionsDir,
        })
      : new JsonlTranscriptStore({
          transcriptPath: resume?.transcriptPath,
          sessionId,
        })

  if (approvePlan && resume) {
    await approvePendingPlan({
      resume,
      transcript: activeTranscript,
      permissionMode: parsed.permissionMode,
    })
    resume.sessionState.phase = 'execute'
    resume.sessionState.permissionMode = parsed.permissionMode
    resume.sessionState.approvedPlan = resume.sessionState.pendingPlan
    resume.sessionState.pendingPlan = undefined
    resume.sessionState.prePlanPermissionMode = undefined
  }

  const permissionGate = createWorkbenchPermissionGate({
    mode: parsed.permissionMode,
    transcript: activeTranscript,
    output: io.stdout,
    reader,
  })
  const operator = createWorkbenchOperator(io.stdout, reader)

  io.stdout.write(
    `${renderPanel('Task Started', [
      row('Session', sessionId ?? 'new session'),
      row('Prompt', truncateText(prompt, 88)),
    ], 'running')}\n`,
  )

  const result = await runRuntimeTurn(
    { ...parsed, prompt },
    activeTranscript,
    io.env,
    io,
    deps,
    resume,
    { permissionGate, operator, onEvent: event => io.stdout.write(`${formatRuntimeEvent(event)}\n`) },
  )
  io.stdout.write(`${formatFinalWorkbenchReport(result, activeTranscript.transcriptPath)}\n`)
}

function resolveSessionSelector(
  selector: string,
  sessions: Awaited<ReturnType<typeof listSessions>>,
) {
  const byIndex = Number(selector)
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= sessions.length) {
    return sessions[byIndex - 1]
  }
  return sessions.find(
    session =>
      session.sessionId === selector || session.sessionId.startsWith(selector),
  )
}

function createWorkbenchPermissionGate({
  mode,
  transcript,
  output,
  reader,
}: {
  mode: PermissionMode
  transcript: JsonlTranscriptStore
  output: Pick<NodeJS.WriteStream, 'write'>
  reader: QuestionReader
}): PermissionGate & {
  setMode(mode: PermissionMode): void
  getMode(): PermissionMode
} {
  let currentMode = mode
  return {
    setMode(nextMode: PermissionMode) {
      currentMode = nextMode
    },
    getMode() {
      return currentMode
    },
    async requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
      let decision = decidePermission(currentMode, request)
      if (!decision.allowed) {
        const prompt = await promptWorkbenchPermission(request, reader, output)
        if (prompt === 'allow-similar') {
          currentMode = deriveSimilarPermissionMode(request)
          decision = {
            allowed: true,
            reason: `operator approved and promoted session permission mode to ${currentMode}`,
          }
        } else if (prompt === 'allow') {
          decision = { allowed: true, reason: 'operator approved in workbench' }
        } else {
          decision = { allowed: false, reason: 'operator denied in workbench' }
        }
      }
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

function deriveSimilarPermissionMode(request: PermissionRequest): PermissionMode {
  if (request.action === 'write' || request.action === 'edit') {
    return 'accept-edits'
  }
  return 'bypass-local'
}

async function promptWorkbenchPermission(
  request: PermissionRequest,
  reader: QuestionReader,
  output: Pick<NodeJS.WriteStream, 'write'>,
): Promise<'allow' | 'deny' | 'allow-similar'> {
  output.write(
    `${renderPanel('Permission Required', [
      row('Action', request.action),
      row('Risk', request.risk),
      row('Subject', request.subject),
      row('Reason', request.reason),
    ], request.risk === 'high' ? 'blocked' : 'waiting')}\n`,
  )
  output.write('decision [y]es / [n]o / [s]imilar]: ')
  const answer = (await reader.question(''))
    .trim()
    .toLowerCase()
  if (answer === 's' || answer === 'similar') return 'allow-similar'
  if (answer === 'y' || answer === 'yes') return 'allow'
  return 'deny'
}

function createWorkbenchOperator(
  output: Pick<NodeJS.WriteStream, 'write'>,
  reader: QuestionReader,
): RuntimeOperator {
  return {
    async askQuestions(input: AskUserQuestionInput) {
      return promptForOperatorAnswers(input, reader, output)
    },
  }
}

async function runPrompt(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
  io: Pick<CliIO, 'stdin' | 'stderr'>,
  deps: CliDeps,
): Promise<void> {
  const parsed = await resolveOptions(
    parseOptions(args, { requirePrompt: true }),
    env,
  )
  const transcript = new JsonlTranscriptStore({
    cwd: parsed.cwd,
    sessionsDir: parsed.sessionsDir,
    sessionId: parsed.sessionId,
  })
  try {
    const result = await runRuntimeTurn(parsed, transcript, env, io, deps)
    writeTurnResult(output, transcript, result)
  } finally {
    parsed.mcp.close()
  }
}

async function resumePrompt(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
  io: Pick<CliIO, 'stdin' | 'stderr'>,
  deps: CliDeps,
): Promise<void> {
  const sessionId = args[0]
  if (!sessionId || sessionId.startsWith('-')) {
    throw new Error('resume requires a session id')
  }
  const raw = parseOptions(args.slice(1), { requirePrompt: false })
  if (!raw.prompt && !raw.approvePlan) {
    throw new Error('prompt is required')
  }
  const parsedInput = {
    ...raw,
    prompt: raw.prompt || 'Continue with the approved plan.',
  }
  const parsed = await resolveOptions(
    parsedInput,
    env,
  )
  const resume = await resumeSessionById({
    sessionId,
    cwd: parsed.cwd,
    sessionsDir: parsed.sessionsDir,
  })
  if (parsed.approvePlan) {
    parsed.permissionMode =
      raw.permissionMode ?? resume.sessionState.prePlanPermissionMode ?? parsed.permissionMode
  }
  const transcript = new JsonlTranscriptStore({
    transcriptPath: resume.transcriptPath,
    sessionId: resume.sessionId,
  })
  try {
    if (parsed.approvePlan) {
      await approvePendingPlan({ resume, transcript, permissionMode: parsed.permissionMode })
      resume.sessionState.phase = 'execute'
      resume.sessionState.permissionMode = parsed.permissionMode
      resume.sessionState.approvedPlan = resume.sessionState.pendingPlan
      resume.sessionState.pendingPlan = undefined
      resume.sessionState.prePlanPermissionMode = undefined
    }
    const result = await runRuntimeTurn(parsed, transcript, env, io, deps, resume)
    writeTurnResult(output, transcript, result)
  } finally {
    parsed.mcp.close()
  }
}

async function approvePendingPlan({
  resume,
  transcript,
  permissionMode,
}: {
  resume: RuntimeSessionSnapshot
  transcript: JsonlTranscriptStore
  permissionMode: PermissionMode
}): Promise<void> {
  const pendingPlan = resume.sessionState.pendingPlan?.trim()
  if (!pendingPlan || resume.sessionState.phase !== 'plan') {
    throw new Error('resume session has no pending plan to approve')
  }
  await transcript.append({
    type: 'session-state',
    phase: 'execute',
    permissionMode,
    prePlanPermissionMode: null,
    todos: resume.sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: pendingPlan,
    pendingPlan: null,
    handoffReport: resume.sessionState.handoffReport
      ? {
          finalMessage: resume.sessionState.handoffReport.finalMessage,
          changes: [...resume.sessionState.handoffReport.changes],
          verified: [...resume.sessionState.handoffReport.verified],
          unverified: [...resume.sessionState.handoffReport.unverified],
          risks: [...resume.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [...resume.sessionState.verificationNotes],
    timestamp: createTimestamp(),
  })
}

function createCliPermissionGate({
  mode,
  transcript,
  stdin,
  stderr,
}: {
  mode: PermissionMode
  transcript: JsonlTranscriptStore
  stdin?: NodeJS.ReadableStream
  stderr: Pick<NodeJS.WriteStream, 'write'>
}): PermissionGate & {
  setMode(mode: PermissionMode): void
  getMode(): PermissionMode
} {
  let currentMode = mode
  return {
    setMode(nextMode: PermissionMode) {
      currentMode = nextMode
    },
    getMode() {
      return currentMode
    },
    async requestPermission(
      request: PermissionRequest,
    ): Promise<PermissionDecision> {
      let decision = decidePermission(currentMode, request)
      if (!decision.allowed && currentMode === 'ask' && stdin) {
        decision = await askOperatorPermission(request, stdin, stderr)
      }
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

async function askOperatorPermission(
  request: PermissionRequest,
  stdin: NodeJS.ReadableStream,
  stderr: Pick<NodeJS.WriteStream, 'write'>,
): Promise<PermissionDecision> {
  const reader = createInterface({ input: stdin }) as unknown as QuestionReader
  try {
    const answer = await promptSinglePermissionDecision(request, reader, stderr)
    const allowed = answer === 'allow'
    return {
      allowed,
      reason: allowed
        ? 'operator approved in CLI ask mode'
        : 'operator denied in CLI ask mode',
    }
  } finally {
    reader.close()
  }
}

async function promptSinglePermissionDecision(
  request: PermissionRequest,
  reader: QuestionReader,
  output: Pick<NodeJS.WriteStream, 'write'>,
): Promise<'allow' | 'deny'> {
  output.write(
    [
      '',
      'Vigilon permission request',
      `Action: ${request.action}`,
      `Risk: ${request.risk}`,
      `Subject: ${request.subject}`,
      `Reason: ${request.reason}`,
    ].join('\n') + '\n',
  )
  output.write('Approve? Type yes to allow: ')
  const answer = (await reader.question(''))
    .trim()
    .toLowerCase()
  return answer === 'y' || answer === 'yes' ? 'allow' : 'deny'
}

async function runRuntimeTurn(
  parsed: ResolvedOptions,
  transcript: JsonlTranscriptStore,
  env: NodeJS.ProcessEnv,
  io: Pick<CliIO, 'stdin' | 'stderr'>,
  deps: CliDeps,
  resume?: Awaited<ReturnType<typeof resumeSessionById>>,
  overrides?: {
    permissionGate?: PermissionGate
    operator?: RuntimeOperator
    onEvent?: (event: AgentRuntimeEvent) => void
  },
): Promise<AgentRuntimeTurnResult> {
  const modelClient =
    deps.createModelClient?.(env) ??
    createDeepSeekModelClient({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: parsed.deepseekBaseUrl ?? env.DEEPSEEK_BASE_URL,
      model: parsed.model ?? env.DEEPSEEK_MODEL,
    })
  const runtime = createVigilonAgentRuntime({
    modelClient,
    tools: createCoreToolRegistry({
      skills: parsed.skills.skills,
      mcpTools: parsed.mcp.tools,
      allowedTools: parsed.projectConfig.allowedTools,
    }),
    transcript,
    permissionMode: parsed.permissionMode,
    preToolUseHooks: parsed.preToolUseHooks,
    skills: parsed.skills.skills,
    projectConfig: parsed.projectConfig,
    operator: overrides?.operator ?? createCliOperator(io),
    permissionGate:
      overrides?.permissionGate ??
      createCliPermissionGate({
        mode: parsed.permissionMode,
        transcript,
        stdin: parsed.permissionMode === 'ask' ? io.stdin : undefined,
        stderr: io.stderr,
      }),
    maxTurns: parsed.maxTurns,
    resume,
    operatorGuidance: buildCliOperatorGuidance(parsed),
    stopAfterResultReport: true,
  })

  let result: AgentRuntimeTurnResult | undefined
  for await (const event of runtime.runTurn({
    prompt: parsed.prompt,
    cwd: parsed.cwd,
    abortSignal: new AbortController().signal,
  })) {
    overrides?.onEvent?.(event)
    if (event.type === 'turn-finished') result = event.result
  }
  if (!result) throw new Error('runtime finished without a turn result')
  return result
}

function createCliOperator(
  io: Pick<CliIO, 'stdin' | 'stderr'>,
): RuntimeOperator | undefined {
  if (!io.stdin) return undefined
  return {
    async askQuestions(input: AskUserQuestionInput) {
      const reader = createInterface({
        input: io.stdin as NodeJS.ReadableStream,
      }) as unknown as QuestionReader
      try {
        return promptForOperatorAnswers(input, reader, io.stderr)
      } finally {
        reader.close()
      }
    },
  }
}

async function promptForOperatorAnswers(
  input: AskUserQuestionInput,
  reader: QuestionReader,
  output: Pick<NodeJS.WriteStream, 'write'>,
) {
  try {
    const answers: Record<string, string> = {}
    for (const question of input.questions) {
      output.write(
        renderPanel('Operator Question', [
          row(question.header, question.question),
          ...question.options.map(
            (option, index) =>
              `  ${index + 1}. ${option.label.padEnd(18, ' ')} ${option.description}`,
          ),
          question.multiSelect
            ? 'Answer with comma-separated option numbers or labels.'
            : 'Answer with an option number or label.',
        ], 'waiting') + '\n',
      )
      output.write('answer: ')
      const rawAnswer = (await reader.question('')).trim()
      const resolved = resolveOperatorAnswer(rawAnswer, question.options)
      if (!resolved) return null
      answers[question.question] = resolved
    }
    return {
      questions: input.questions,
      answers,
      ...(input.annotations ? { annotations: input.annotations } : {}),
    }
  } catch {
    return null
  }
}

function resolveOperatorAnswer(
  rawAnswer: string,
  options: AskUserQuestionInput['questions'][number]['options'],
): string | null {
  if (!rawAnswer) return null
  const parts = rawAnswer
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  const resolved = parts
    .map(part => {
      const byIndex = Number(part)
      if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= options.length) {
        return options[byIndex - 1]?.label ?? null
      }
      return options.find(option => option.label.toLowerCase() === part.toLowerCase())?.label ?? part
    })
    .filter((value): value is string => Boolean(value))
  return resolved.length > 0 ? resolved.join(', ') : null
}

function writeTurnResult(
  output: Pick<NodeJS.WriteStream, 'write'>,
  transcript: JsonlTranscriptStore,
  result: AgentRuntimeTurnResult,
): void {
  writeJson(output, {
    status: result.report.status,
    sessionId: transcript.sessionId,
    transcriptPath: transcript.transcriptPath,
    finalMessage: result.finalMessage,
    stopReason: result.stopReason,
    turns: result.turns,
    report: result.report,
  })
}

function renderDoctor(
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

function formatTranscriptEvent(event: Awaited<ReturnType<typeof readTranscriptFile>>[number]): string {
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

function formatRuntimeEvent(event: AgentRuntimeEvent): string {
  switch (event.type) {
    case 'model-request-started':
      return '[model] request started'
    case 'model-response-received':
      return `[model] stop=${event.response.stopReason} toolCalls=${event.response.toolCalls.length} message=${truncateText(event.response.content, 120)}`
    case 'tool-started':
      return `[tool:start] ${event.call.name} ${truncateText(JSON.stringify(event.call.input), 120)}`
    case 'tool-finished':
      return `[tool:${event.result.ok ? 'ok' : 'error'}] ${truncateText(event.result.content, 140)}`
    case 'turn-finished':
      return `[turn] ${event.result.report.status} turns=${event.result.turns}`
    default:
      return '[event]'
  }
}

function formatFinalWorkbenchReport(
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

function renderPanel(
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

function row(label: string, value: string): string {
  return `${label.padEnd(14, ' ')} ${value}`
}

function sectionTitle(title: string): string {
  return `${title}:`
}

function statusBadge(status: RuntimeSessionSummary['status']): string {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'running'
  if (status === 'waiting_approval') return 'waiting approval'
  return 'recoverable'
}

function truncateText(value: string | undefined, maxChars: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`
}

function parseOptions(
  args: string[],
  options: { requirePrompt: boolean },
): ParsedOptions {
  const promptParts: string[] = []
  let cwd = process.cwd()
  let sessionsDir: string | undefined
  let permissionMode: PermissionMode | undefined
  let maxTurns: number | undefined
  let sessionId: string | undefined
  let model: string | undefined
  let deepseekBaseUrl: string | undefined
  let approvePlan = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') {
      cwd = requireValue(args, (index += 1), '--cwd')
      continue
    }
    if (arg === '--sessions-dir') {
      sessionsDir = requireValue(args, (index += 1), '--sessions-dir')
      continue
    }
    if (arg === '--permission-mode') {
      const value = requireValue(args, (index += 1), '--permission-mode')
      if (!PERMISSION_MODES.has(value as PermissionMode)) {
        throw new Error(`Unsupported permission mode: ${value}`)
      }
      permissionMode = value as PermissionMode
      continue
    }
    if (arg === '--max-turns') {
      maxTurns = parsePositiveInteger(requireValue(args, (index += 1), '--max-turns'))
      continue
    }
    if (arg === '--model') {
      model = requireValue(args, (index += 1), '--model')
      continue
    }
    if (arg === '--deepseek-base-url') {
      deepseekBaseUrl = requireValue(args, (index += 1), '--deepseek-base-url')
      continue
    }
    if (arg === '--session-id') {
      sessionId = requireValue(args, (index += 1), '--session-id')
      continue
    }
    if (arg === '--approve-plan') {
      approvePlan = true
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }
    promptParts.push(arg)
  }

  const prompt = promptParts.join(' ').trim()
  if (options.requirePrompt && !prompt) {
    throw new Error('prompt is required')
  }
  return {
    cwd,
    sessionsDir,
    permissionMode,
    maxTurns,
    sessionId,
    model,
    deepseekBaseUrl,
    approvePlan,
    prompt,
  }
}

function buildCliOperatorGuidance(parsed: ResolvedOptions): string {
  const guidance = [
    'CLI task protocol:',
    '- There is no fixed default turn limit; keep working while useful evidence is still being gathered.',
    '- Treat user path exclusions and project ignore patterns as hard task boundaries.',
    '- For repository search, prefer Grep, Glob, Read, and LSP because they preserve project boundaries and produce bounded evidence.',
    '- Use Bash for concise verification or shell-only tasks; avoid broad repository find/ls/grep pipelines when structured tools can answer.',
    '- Keep evidence focused. Stop once the answer is supported instead of exhaustively reading adjacent files.',
    '- For report-style or multi-step tasks, provide a concrete final answer. Use ResultReport only when a structured handoff is useful for audit or resume.',
  ]
  if (parsed.maxTurns !== undefined) {
    guidance.push(
      `This run has an explicit maxTurns limit of ${parsed.maxTurns}; treat it as a protection valve, finish with a supported final answer before the limit when possible, and expect the run to stop if tool use keeps continuing at the limit.`,
    )
  }
  if (parsed.projectConfig.ignore.length > 0) {
    guidance.push(
      `Current ignored path patterns: ${parsed.projectConfig.ignore.join(', ')}`,
    )
  }
  return guidance.join('\n')
}

async function resolveOptions(
  parsed: ParsedOptions,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedOptions> {
  const settings = await loadRuntimeSettings({ cwd: parsed.cwd, env })
  const skills = await loadRuntimeSkills({
    cwd: parsed.cwd,
    env,
    skillDirs: settings.settings.skillDirs,
  })
  const mcp = await loadRuntimeMcpTools({
    cwd: parsed.cwd,
    env,
    servers: settings.settings.mcpServers,
  })
  const projectConfig = normalizeProjectConfig(settings.settings.project)
  return {
    ...parsed,
    sessionsDir: parsed.sessionsDir ?? settings.settings.sessionsDir,
    permissionMode: parsed.permissionMode ?? settings.settings.permissionMode ?? 'ask',
    maxTurns: parsed.maxTurns ?? settings.settings.maxTurns,
    model: parsed.model ?? settings.settings.model,
    deepseekBaseUrl: parsed.deepseekBaseUrl ?? settings.settings.deepseekBaseUrl,
    settings,
    skills,
    mcp,
    projectConfig,
    preToolUseHooks: createSettingsPreToolUseHooks(settings.settings),
  }
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index]
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got: ${value}`)
  }
  return parsed
}

function writeJson(output: Pick<NodeJS.WriteStream, 'write'>, value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await runCli()
}
