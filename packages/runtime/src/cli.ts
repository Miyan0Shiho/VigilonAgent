import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { createDeepSeekModelClient } from './model/deepseek.js'
import { createVigilonAgentRuntime } from './runtime/agentLoop.js'
import { createPhase1RuntimeBaseline } from './runtime/baseline.js'
import type {
  AskUserQuestionInput,
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
  listSessions,
  resumeSessionById,
} from './runtime/transcript.js'
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
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      printHelp(io.stdout)
      return 0
    }
    if (command === 'doctor') {
      printDoctor(io.stdout)
      return 0
    }
    if (command === 'sessions') {
      await printSessions(args.slice(1), io.stdout, io.env)
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

    io.stderr.write(`Unknown command: ${command}\n`)
    printHelp(io.stderr)
    return 1
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

function printHelp(output: Pick<NodeJS.WriteStream, 'write'>): void {
  output.write(`Vigilon Runtime ${VIGILON_RUNTIME_VERSION}

Usage:
  vigilon --version
  vigilon doctor
  vigilon sessions [--cwd <path>] [--sessions-dir <path>]
  vigilon run <prompt...> [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>] [--deepseek-base-url <url>] [--max-turns <n>]
  vigilon resume <session-id> <prompt...> [--approve-plan] [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>] [--deepseek-base-url <url>] [--max-turns <n>]

Permission modes: read-only, ask, accept-edits, bypass-local
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
  stderr.write(
    [
      '',
      'Vigilon permission request',
      `Action: ${request.action}`,
      `Risk: ${request.risk}`,
      `Subject: ${request.subject}`,
      `Reason: ${request.reason}`,
      'Approve? Type yes to allow: ',
    ].join('\n'),
  )
  const rl = createInterface({ input: stdin })
  try {
    const answer = (await rl.question('')).trim().toLowerCase()
    const allowed = answer === 'y' || answer === 'yes'
    return {
      allowed,
      reason: allowed
        ? 'operator approved in CLI ask mode'
        : 'operator denied in CLI ask mode',
    }
  } finally {
    rl.close()
  }
}

async function runRuntimeTurn(
  parsed: ResolvedOptions,
  transcript: JsonlTranscriptStore,
  env: NodeJS.ProcessEnv,
  io: Pick<CliIO, 'stdin' | 'stderr'>,
  deps: CliDeps,
  resume?: Awaited<ReturnType<typeof resumeSessionById>>,
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
    operator: createCliOperator(io),
    permissionGate: createCliPermissionGate({
      mode: parsed.permissionMode,
      transcript,
      stdin: parsed.permissionMode === 'ask' ? io.stdin : undefined,
      stderr: io.stderr,
    }),
    maxTurns: parsed.maxTurns,
    resume,
  })

  let result: AgentRuntimeTurnResult | undefined
  for await (const event of runtime.runTurn({
    prompt: parsed.prompt,
    cwd: parsed.cwd,
    abortSignal: new AbortController().signal,
  })) {
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
      return promptForOperatorAnswers(input, io.stdin as NodeJS.ReadableStream, io.stderr)
    },
  }
}

async function promptForOperatorAnswers(
  input: AskUserQuestionInput,
  stdin: NodeJS.ReadableStream,
  stderr: Pick<NodeJS.WriteStream, 'write'>,
) {
  const rl = createInterface({ input: stdin })
  try {
    const answers: Record<string, string> = {}
    for (const question of input.questions) {
      stderr.write(
        [
          '',
          'Vigilon operator question',
          `${question.header}: ${question.question}`,
          ...question.options.map(
            (option, index) => `${index + 1}. ${option.label} - ${option.description}`,
          ),
          question.multiSelect
            ? 'Answer with comma-separated option numbers or labels: '
            : 'Answer with an option number or label: ',
        ].join('\n'),
      )
      const rawAnswer = (await rl.question('')).trim()
      const resolved = resolveOperatorAnswer(rawAnswer, question.options)
      if (!resolved) return null
      answers[question.question] = resolved
    }
    return {
      questions: input.questions,
      answers,
      ...(input.annotations ? { annotations: input.annotations } : {}),
    }
  } finally {
    rl.close()
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
