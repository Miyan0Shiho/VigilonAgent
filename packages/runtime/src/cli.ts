import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { createDeepSeekModelClient } from './model/deepseek.js'
import { createVigilonAgentRuntime } from './runtime/agentLoop.js'
import { createPhase1RuntimeBaseline } from './runtime/baseline.js'
import type {
  AskUserQuestionInput,
  AgentRuntimeEvent,
  AgentRuntimeTurnResult,
  BackgroundTask,
  LocalAgentDefinition,
  ModelClient,
  PermissionDecision,
  PermissionGate,
  PermissionMode,
  PermissionOrigin,
  PermissionRequest,
  PreToolUseHook,
  RuntimeProjectConfig,
  RuntimeOperator,
  RuntimeSessionSnapshot,
  RuntimeSessionSummary,
  SubagentWorktreeApply,
  SubagentWorktreeDiff,
  Tool,
} from './runtime/contracts.js'
import {
  loadRuntimeMcpTools,
  type LoadedRuntimeMcp,
} from './runtime/mcp.js'
import {
  createPermissionResolutionCoordinator,
  decidePermission,
} from './runtime/permissions.js'
import { buildPermissionOriginSummary } from './runtime/permissionOrigins.js'
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
  resumeSessionFromTranscript,
} from './runtime/transcript.js'
import {
  compactTranscript,
  estimateCompactTokenPressure,
  resolveCompactContextWindowBudget,
} from './runtime/compact.js'
import {
  buildCompactMemoryReadiness,
  deleteSessionMemory,
  ensureFreshSessionMemory,
  generateSessionMemoryFromSnapshot,
  getSessionMemoryEventPointer,
  getSessionMemoryPath,
  inspectSessionMemory,
  isSessionMemoryFresh,
  readSessionMemoryExtractionStatus,
  scheduleSessionMemoryExtraction,
  writeSessionMemory,
} from './runtime/sessionMemory.js'
import {
  loadAgentCatalog,
} from './runtime/agentDefinitions.js'
import { createTaskManager } from './runtime/taskManager.js'
import { writeTaskStopRequest } from './runtime/taskControl.js'
import {
  promoteLongTermMemory,
  type LongTermMemoryKind,
} from './runtime/projectMemory.js'
import {
  buildProjectInstructionsGuidance,
  loadProjectInstructions,
  type ProjectInstructions,
} from './runtime/projectInstructions.js'
import { CORE_TOOLS, createCoreToolRegistry } from './tools/coreTools.js'
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
  projectInstructions: ProjectInstructions
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
    if (command === 'init') {
      await initProject(args.slice(1), io.stdout, io.env)
      return 0
    }
    if (command === 'tools') {
      await printTools(args.slice(1), io.stdout, io.env)
      return 0
    }
    if (command === 'sessions') {
      await printSessions(args.slice(1), io.stdout, io.env)
      return 0
    }
    if (command === 'agents') {
      await printAgents(args.slice(1), io.stdout, io.env, io, deps)
      return 0
    }
    if (command === 'summary') {
      await summarizeSession(args.slice(1), io.stdout, io.env)
      return 0
    }
    if (command === 'memory') {
      await manageSessionMemory(args.slice(1), io.stdout, io.env, deps)
      return 0
    }
    if (command === 'compact') {
      await compactSession(args.slice(1), io.stdout, io.env, deps)
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
    buildProjectInstructionsGuidance,
    loadProjectInstructions,
    createTaskManager,
    runCli,
    VIGILON_RUNTIME_VERSION,
  }
}

function printHelp(output: Pick<NodeJS.WriteStream, 'write'>): void {
  output.write(`Vigilon Runtime ${VIGILON_RUNTIME_VERSION}

Usage:
  vigilon --version
  vigilon doctor
  vigilon init [--cwd <path>] [--force] [--model <name>] [--permission-mode <mode>]
  vigilon tools [--cwd <path>]
  vigilon tui [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>]
  vigilon sessions [--cwd <path>] [--sessions-dir <path>]
  vigilon agents [--cwd <path>]
  vigilon agents inspect <parent-session-id> <task-id> [--cwd <path>] [--sessions-dir <path>]
  vigilon agents resume <parent-session-id> <task-id> <prompt...> [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>]
  vigilon agents apply <parent-session-id> <task-id> [--check] [--files <a,b>] [--3way] [--rollback] [--cwd <path>] [--sessions-dir <path>]
  vigilon agents stop <parent-session-id> <task-id> [--cwd <path>] [--sessions-dir <path>]
  vigilon summary <session-id> [--cwd <path>] [--sessions-dir <path>]
  vigilon memory <status|view|write|edit|delete|refresh|validate> <session-id> [--content <markdown>] [--background] [--refresh] [--cwd <path>] [--sessions-dir <path>]
  vigilon memory refresh <session-id> [--background] [--cwd <path>] [--sessions-dir <path>]
  vigilon memory validate <session-id> [--refresh] [--model <name>] [--deepseek-base-url <url>] [--cwd <path>] [--sessions-dir <path>]
  vigilon memory promote <session-id> --type <user|feedback|project|reference> --topic <name> --content <markdown> [--cwd <path>] [--sessions-dir <path>]
  vigilon compact <session-id> [--summary <markdown>] [--validate-memory] [--reactive-events <n>] [--context-window <n>|--token-budget <n>] [--output-reserve <n>] [--system-reserve <n>] [--tool-schema-reserve <n>] [--safety-margin <n>] [--pressure-threshold <ratio>] [--cwd <path>] [--sessions-dir <path>]
  vigilon run <prompt...> [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>] [--deepseek-base-url <url>] [--max-turns <n>]
  vigilon resume <session-id> <prompt...> [--approve-plan] [--cwd <path>] [--sessions-dir <path>] [--permission-mode <mode>] [--model <name>] [--deepseek-base-url <url>] [--max-turns <n>]

Permission modes: read-only, ask, accept-edits, bypass-local
Interactive workbench: plain text starts a new task; /resume, /approve, /open, /doctor, /refresh, /quit manage sessions.
Plan approval: resume <session-id> --approve-plan "continue..." promotes a pending plan from transcript state before running the next turn.
Settings files: ~/.vigilon/settings.json, <cwd>/.vigilon/settings.json, <cwd>/.vigilon/settings.local.json
Project instructions: AGENTS.md, VIGILON.md, <cwd>/.vigilon/instructions.md
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

async function initProject(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parsed = parseInitOptions(args, env)
  const vigilonDir = path.join(parsed.cwd, '.vigilon')
  const settingsPath = path.join(vigilonDir, 'settings.json')
  const agentsDir = path.join(vigilonDir, 'agents')
  const skillsDir = path.join(vigilonDir, 'skills')
  const instructionsPath = path.join(parsed.cwd, 'AGENTS.md')

  await mkdir(vigilonDir, { recursive: true })
  await mkdir(agentsDir, { recursive: true })
  await mkdir(skillsDir, { recursive: true })

  const defaultCommands = await detectDefaultCommands(parsed.cwd)
  const settings = {
    model: parsed.model,
    permissionMode: parsed.permissionMode,
    project: {
      ignore: [
        'node_modules/**',
        'dist/**',
        'build/**',
        'coverage/**',
        '.git/**',
        '.vigilon/sessions/**',
        '**/.vigilon/sessions/**',
      ],
      defaultCommands,
    },
  }
  const settingsWrite = await writeTextFileIfAllowed(
    settingsPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    parsed.force,
  )
  const instructionsWrite = await writeTextFileIfAllowed(
    instructionsPath,
    buildDefaultAgentsInstructions(),
    parsed.force,
  )

  writeJson(output, {
    status: 'ok',
    cwd: parsed.cwd,
    created: [
      ...settingsWrite.created,
      ...instructionsWrite.created,
      agentsDir,
      skillsDir,
    ],
    skipped: [
      ...settingsWrite.skipped,
      ...instructionsWrite.skipped,
    ],
    settingsPath,
    instructionsPath,
    defaultCommands,
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

async function printTools(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parsed = await resolveOptions(
    parseOptions(args, { requirePrompt: false }),
    env,
  )
  try {
    const registry = createCoreToolRegistry({
      skills: parsed.skills.skills,
      mcpTools: parsed.mcp.tools,
      allowedTools: parsed.projectConfig.allowedTools,
    })
    writeJson(output, {
      cwd: parsed.cwd,
      allowedTools: parsed.projectConfig.allowedTools ?? null,
      effectiveToolCount: registry.list().length,
      coreTools: CORE_TOOLS.map(formatToolForListing),
      mcpTools: parsed.mcp.tools.map(formatToolForListing),
      skills: parsed.skills.skills.map(skill => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        path: skill.path,
        allowedTools: skill.allowedTools,
        userInvocable: skill.userInvocable,
      })),
    })
  } finally {
    parsed.mcp.close()
  }
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

async function printAgents(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
  io?: Pick<CliIO, 'stdin' | 'stderr'>,
  deps: CliDeps = {},
): Promise<void> {
  if (args[0] === 'inspect') {
    await inspectAgentTask(args.slice(1), output, env)
    return
  }
  if (args[0] === 'resume') {
    if (!io) throw new Error('agents resume requires CLI IO')
    await resumeAgentTask(args.slice(1), output, env, io, deps)
    return
  }
  if (args[0] === 'apply') {
    await applyAgentTask(args.slice(1), output, env)
    return
  }
  if (args[0] === 'stop') {
    await stopPersistedAgentTask(args.slice(1), output, env)
    return
  }
  const parsed = await resolveOptions(
    parseOptions(args, { requirePrompt: false }),
    env,
  )
  const catalog = await loadAgentCatalog({ cwd: parsed.cwd, env })
  writeJson(output, {
    cwd: parsed.cwd,
    sourcePrecedence: catalog.precedence,
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
      active: !entry.overriddenBy,
      overriddenBy: entry.overriddenBy,
    })),
  })
  parsed.mcp.close()
}

async function inspectAgentTask(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parentSessionId = args[0]
  const taskId = args[1]
  if (!parentSessionId || parentSessionId.startsWith('-') || !taskId || taskId.startsWith('-')) {
    throw new Error('agents inspect requires: <parent-session-id> <task-id>')
  }
  const parsed = await resolveOptions(
    parseOptions(args.slice(2), { requirePrompt: false }),
    env,
  )
  try {
    const parent = await resumeSessionById({
      sessionId: parentSessionId,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
    })
    const task = findSubagentTask(parent.sessionState, taskId)
    const transcriptPath = requireSubagentTranscriptPath(task)
    const events = await readTranscriptFile(transcriptPath)
    const permissionSummary = buildPermissionOriginSummary(events)
    writeJson(output, {
      parentSessionId: parent.sessionId,
      task,
      transcriptPath,
      eventCount: events.length,
      permissionSummary,
      outputStream: buildSubagentOutputStream(events),
      lastEvents: events.slice(-12).map(formatTranscriptEvent),
    })
  } finally {
    parsed.mcp.close()
  }
}

async function resumeAgentTask(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
  io: Pick<CliIO, 'stdin' | 'stderr'>,
  deps: CliDeps,
): Promise<void> {
  const parentSessionId = args[0]
  const taskId = args[1]
  if (!parentSessionId || parentSessionId.startsWith('-') || !taskId || taskId.startsWith('-')) {
    throw new Error('agents resume requires: <parent-session-id> <task-id> <prompt...>')
  }
  const raw = parseOptions(args.slice(2), { requirePrompt: true })
  const parsed = await resolveOptions(raw, env)
  try {
    const parent = await resumeSessionById({
      sessionId: parentSessionId,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
    })
    const task = findSubagentTask(parent.sessionState, taskId)
    const transcriptPath = requireSubagentTranscriptPath(task)
    const agentName = task.agentName
    if (!agentName) throw new Error(`subagent task ${taskId} has no agent name`)
    const catalog = await loadAgentCatalog({ cwd: parsed.cwd })
    const definition = catalog.active.find(agent => agent.name === agentName)
    if (!definition) throw new Error(`active agent definition not found for ${agentName}`)
    const subagentResume = await resumeSessionFromTranscript(transcriptPath)
    const transcript = new JsonlTranscriptStore({
      transcriptPath: subagentResume.transcriptPath,
      sessionId: subagentResume.sessionId,
    })
    const result = await runSubagentResumeTurn({
      parsed,
      transcript,
      resume: subagentResume,
      definition,
      task,
      env,
      io,
      deps,
    })
    const events = await transcript.readAll()
    const updatedTask = await appendResumedSubagentTaskState({
      parent,
      task,
      result,
    })
    writeJson(output, {
      parentSessionId: parent.sessionId,
      taskId: task.id,
      agentName,
      transcriptPath: subagentResume.transcriptPath,
      status: result.report.status,
      finalMessage: result.finalMessage,
      task: updatedTask,
      outputStream: buildSubagentOutputStream(events),
    })
  } finally {
    parsed.mcp.close()
  }
}

async function runSubagentResumeTurn({
  parsed,
  transcript,
  resume,
  definition,
  task,
  env,
  io,
  deps,
}: {
  parsed: ResolvedOptions
  transcript: JsonlTranscriptStore
  resume: RuntimeSessionSnapshot
  definition: LocalAgentDefinition
  task: BackgroundTask
  env: NodeJS.ProcessEnv
  io: Pick<CliIO, 'stdin' | 'stderr'>
  deps: CliDeps
}): Promise<AgentRuntimeTurnResult> {
  const modelClient =
    deps.createModelClient?.(env) ??
    createDeepSeekModelClient({
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: parsed.deepseekBaseUrl ?? env.DEEPSEEK_BASE_URL,
      model: definition.model ?? parsed.model ?? env.DEEPSEEK_MODEL,
    })
  const permissionOrigin: PermissionOrigin = {
    agentId: `agent:${definition.name}:${resume.sessionId}`,
    agentRole: 'subagent',
    parentAgentId: task.parentAgentId ?? 'main',
  }
  const runtime = createVigilonAgentRuntime({
    modelClient,
    tools: createCoreToolRegistry({
      skills: parsed.skills.skills,
      mcpTools: parsed.mcp.tools,
      allowedTools: definition.allowedTools,
    }),
    transcript,
    permissionMode: definition.permissionMode ?? parsed.permissionMode,
    preToolUseHooks: parsed.preToolUseHooks,
    skills: parsed.skills.skills,
    projectConfig: parsed.projectConfig,
    operator: createCliOperator(io),
    permissionGate: createCliPermissionGate({
      mode: definition.permissionMode ?? parsed.permissionMode,
      transcript,
      stdin: (definition.permissionMode ?? parsed.permissionMode) === 'ask' ? io.stdin : undefined,
      stderr: io.stderr,
    }),
    maxTurns: parsed.maxTurns ?? definition.maxTurns,
    resume,
    operatorGuidance: [
      buildCliOperatorGuidance(parsed),
      `<vigilon_subagent_resume agent="${escapePromptAttribute(definition.name)}" task_id="${escapePromptAttribute(task.id)}">`,
      `parent_agent="${escapePromptAttribute(task.parentAgentId ?? 'main')}"`,
      `previous_status="${escapePromptAttribute(task.status ?? 'unknown')}"`,
      `previous_reason="${escapePromptAttribute(task.terminalReason ?? '')}"`,
      '</vigilon_subagent_resume>',
    ].join('\n'),
    stopAfterResultReport: true,
    permissionOrigin,
  })

  let result: AgentRuntimeTurnResult | undefined
  for await (const event of runtime.runTurn({
    prompt: parsed.prompt,
    cwd: parsed.cwd,
    abortSignal: new AbortController().signal,
  })) {
    if (event.type === 'turn-finished') result = event.result
  }
  if (!result) throw new Error('subagent resume finished without a turn result')
  return result
}

async function appendResumedSubagentTaskState({
  parent,
  task,
  result,
}: {
  parent: RuntimeSessionSnapshot
  task: BackgroundTask
  result: AgentRuntimeTurnResult
}): Promise<BackgroundTask> {
  const outputSummary =
    result.finalMessage || result.report.finalMessage || 'Subagent resume finished without a final message.'
  const status = mapSubagentResumeTaskStatus(result.report.status)
  const updatedTask: BackgroundTask = {
    ...task,
    status,
    completedAt: createTimestamp(),
    terminalReason: `subagent_resume_${result.report.status}`,
    outputSummary,
  }
  const retainedById = new Map(
    (parent.sessionState.retainedTasks ?? []).map(existing => [existing.id, existing]),
  )
  retainedById.set(updatedTask.id, updatedTask)
  const retainedTasks = Array.from(retainedById.values())
  const backgroundTasks = parent.sessionState.backgroundTasks.filter(
    existing => existing.id !== updatedTask.id,
  )
  parent.sessionState.backgroundTasks = backgroundTasks
  parent.sessionState.retainedTasks = retainedTasks

  const parentTranscript = new JsonlTranscriptStore({
    transcriptPath: parent.transcriptPath,
    sessionId: parent.sessionId,
  })
  await parentTranscript.append({
    type: 'session-state',
    phase: parent.sessionState.phase,
    permissionMode: parent.sessionState.permissionMode,
    prePlanPermissionMode: parent.sessionState.prePlanPermissionMode ?? null,
    todos: parent.sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: parent.sessionState.approvedPlan ?? null,
    pendingPlan: parent.sessionState.pendingPlan ?? null,
    handoffReport: parent.sessionState.handoffReport
      ? {
          finalMessage: parent.sessionState.handoffReport.finalMessage,
          changes: [...parent.sessionState.handoffReport.changes],
          verified: [...parent.sessionState.handoffReport.verified],
          unverified: [...parent.sessionState.handoffReport.unverified],
          risks: [...parent.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [...parent.sessionState.verificationNotes],
    backgroundTasks: backgroundTasks.map(existing => ({ ...existing })),
    retainedTasks: retainedTasks.map(existing => ({ ...existing })),
    discoveredToolNames: [...parent.sessionState.discoveredToolNames],
    toolReferenceDeltas: [...parent.sessionState.toolReferenceDeltas],
    mcpInstructions: [...parent.sessionState.mcpInstructions],
    activeSkill: parent.sessionState.activeSkill
      ? { ...parent.sessionState.activeSkill }
      : null,
    memoryFreshness: parent.sessionState.memoryFreshness ?? null,
    systemPrompt: parent.sessionState.systemPrompt ?? null,
    toolSchema: parent.sessionState.toolSchema ?? null,
    modelParams: parent.sessionState.modelParams ?? null,
    timestamp: createTimestamp(),
  })
  return updatedTask
}

async function applyAgentTask(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parentSessionId = args[0]
  const taskId = args[1]
  if (!parentSessionId || parentSessionId.startsWith('-') || !taskId || taskId.startsWith('-')) {
    throw new Error('agents apply requires: <parent-session-id> <task-id>')
  }
  const applyOptions = parseAgentApplyArgs(args.slice(2))
  const parsed = await resolveOptions(
    parseOptions(applyOptions.optionArgs, { requirePrompt: false }),
    env,
  )
  try {
    const parent = await resumeSessionById({
      sessionId: parentSessionId,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
    })
    const task = findSubagentTask(parent.sessionState, taskId)
    const diff = requireSubagentWorktreeDiff(task)
    const apply = await applySubagentWorktreeDiff(diff, applyOptions)
    const updatedTask = await appendAppliedSubagentTaskState({
      parent,
      task,
      apply,
    })
    writeJson(output, {
      parentSessionId: parent.sessionId,
      taskId: task.id,
      agentName: task.agentName,
      status: apply.status,
      applied: apply.status === 'applied' || apply.status === 'clean' || apply.status === 'rolled_back',
      apply,
      task: updatedTask,
    })
  } finally {
    parsed.mcp.close()
  }
}

async function stopPersistedAgentTask(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parentSessionId = args[0]
  const taskId = args[1]
  if (!parentSessionId || parentSessionId.startsWith('-') || !taskId || taskId.startsWith('-')) {
    throw new Error('agents stop requires: <parent-session-id> <task-id>')
  }
  const parsed = await resolveOptions(
    parseOptions(args.slice(2), { requirePrompt: false }),
    env,
  )
  try {
    const parent = await resumeSessionById({
      sessionId: parentSessionId,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
    })
    const task = findSubagentTask(parent.sessionState, taskId)
    if (task.status && task.status !== 'running') {
      writeJson(output, {
        parentSessionId: parent.sessionId,
        taskId: task.id,
        agentName: task.agentName,
        status: task.status,
        requested: false,
        message: `subagent task is already ${task.status}`,
        task,
      })
      return
    }
    const stop = await writeTaskStopRequest(task, {
      requester: 'cli',
      reason: 'agents stop requested from a separate runtime process',
    })
    const updatedTask = await appendStopRequestedSubagentTaskState({
      parent,
      task,
      stopRequestPath: stop.path,
      stopRequestedAt: stop.request.requestedAt,
    })
    writeJson(output, {
      parentSessionId: parent.sessionId,
      taskId: task.id,
      agentName: task.agentName,
      status: 'requested',
      requested: true,
      stopRequest: {
        path: stop.path,
        requestedAt: stop.request.requestedAt,
        requester: stop.request.requester,
      },
      message: `stop requested for subagent task ${task.id}`,
      task: updatedTask,
    })
  } finally {
    parsed.mcp.close()
  }
}

type AgentApplyOptions = {
  optionArgs: string[]
  mode: 'check' | 'apply' | 'rollback'
  threeWay: boolean
  files?: string[]
}

function parseAgentApplyArgs(args: string[]): AgentApplyOptions {
  const optionArgs: string[] = []
  let mode: AgentApplyOptions['mode'] = 'apply'
  let threeWay = false
  let files: string[] | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--check') {
      mode = 'check'
      continue
    }
    if (arg === '--rollback') {
      mode = 'rollback'
      continue
    }
    if (arg === '--3way') {
      threeWay = true
      continue
    }
    if (arg === '--files') {
      const value = requireValue(args, (index += 1), '--files')
      files = value
        .split(',')
        .map(file => file.trim())
        .filter(Boolean)
      continue
    }
    optionArgs.push(arg)
  }
  return { optionArgs, mode, threeWay, files }
}

async function appendAppliedSubagentTaskState({
  parent,
  task,
  apply,
}: {
  parent: RuntimeSessionSnapshot
  task: BackgroundTask
  apply: SubagentWorktreeApply
}): Promise<BackgroundTask> {
  const worktreeDiff = {
    ...task.worktreeDiff,
    sourceApply: apply,
  } as SubagentWorktreeDiff
  const updatedTask: BackgroundTask = {
    ...task,
    worktreeDiff,
  }
  const retainedById = new Map(
    (parent.sessionState.retainedTasks ?? []).map(existing => [existing.id, existing]),
  )
  retainedById.set(updatedTask.id, updatedTask)
  const retainedTasks = Array.from(retainedById.values())
  const backgroundTasks = parent.sessionState.backgroundTasks.map(existing =>
    existing.id === updatedTask.id ? updatedTask : existing,
  )
  parent.sessionState.backgroundTasks = backgroundTasks
  parent.sessionState.retainedTasks = retainedTasks

  const parentTranscript = new JsonlTranscriptStore({
    transcriptPath: parent.transcriptPath,
    sessionId: parent.sessionId,
  })
  await parentTranscript.append({
    type: 'session-state',
    phase: parent.sessionState.phase,
    permissionMode: parent.sessionState.permissionMode,
    prePlanPermissionMode: parent.sessionState.prePlanPermissionMode ?? null,
    todos: parent.sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: parent.sessionState.approvedPlan ?? null,
    pendingPlan: parent.sessionState.pendingPlan ?? null,
    handoffReport: parent.sessionState.handoffReport
      ? {
          finalMessage: parent.sessionState.handoffReport.finalMessage,
          changes: [...parent.sessionState.handoffReport.changes],
          verified: [...parent.sessionState.handoffReport.verified],
          unverified: [...parent.sessionState.handoffReport.unverified],
          risks: [...parent.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [
      ...parent.sessionState.verificationNotes,
      `subagent worktree apply ${apply.status}: ${task.id} (${apply.filesChanged} files)`,
    ],
    backgroundTasks: backgroundTasks.map(existing => ({ ...existing })),
    retainedTasks: retainedTasks.map(existing => ({ ...existing })),
    discoveredToolNames: [...parent.sessionState.discoveredToolNames],
    toolReferenceDeltas: [...parent.sessionState.toolReferenceDeltas],
    mcpInstructions: [...parent.sessionState.mcpInstructions],
    activeSkill: parent.sessionState.activeSkill
      ? { ...parent.sessionState.activeSkill }
      : null,
    memoryFreshness: parent.sessionState.memoryFreshness ?? null,
    systemPrompt: parent.sessionState.systemPrompt ?? null,
    toolSchema: parent.sessionState.toolSchema ?? null,
    modelParams: parent.sessionState.modelParams ?? null,
    timestamp: createTimestamp(),
  })
  return updatedTask
}

async function appendStopRequestedSubagentTaskState({
  parent,
  task,
  stopRequestPath,
  stopRequestedAt,
}: {
  parent: RuntimeSessionSnapshot
  task: BackgroundTask
  stopRequestPath: string
  stopRequestedAt: string
}): Promise<BackgroundTask> {
  const updatedTask: BackgroundTask = {
    ...task,
    stopRequestPath,
    stopRequestedAt,
  }
  const backgroundTasks = parent.sessionState.backgroundTasks.map(existing =>
    existing.id === updatedTask.id ? updatedTask : existing,
  )
  parent.sessionState.backgroundTasks = backgroundTasks

  const parentTranscript = new JsonlTranscriptStore({
    transcriptPath: parent.transcriptPath,
    sessionId: parent.sessionId,
  })
  await parentTranscript.append({
    type: 'session-state',
    phase: parent.sessionState.phase,
    permissionMode: parent.sessionState.permissionMode,
    prePlanPermissionMode: parent.sessionState.prePlanPermissionMode ?? null,
    todos: parent.sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: parent.sessionState.approvedPlan ?? null,
    pendingPlan: parent.sessionState.pendingPlan ?? null,
    handoffReport: parent.sessionState.handoffReport
      ? {
          finalMessage: parent.sessionState.handoffReport.finalMessage,
          changes: [...parent.sessionState.handoffReport.changes],
          verified: [...parent.sessionState.handoffReport.verified],
          unverified: [...parent.sessionState.handoffReport.unverified],
          risks: [...parent.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [
      ...parent.sessionState.verificationNotes,
      `subagent stop requested: ${task.id}`,
    ],
    backgroundTasks: backgroundTasks.map(existing => ({ ...existing })),
    retainedTasks: (parent.sessionState.retainedTasks ?? []).map(existing => ({ ...existing })),
    discoveredToolNames: [...parent.sessionState.discoveredToolNames],
    toolReferenceDeltas: [...parent.sessionState.toolReferenceDeltas],
    mcpInstructions: [...parent.sessionState.mcpInstructions],
    activeSkill: parent.sessionState.activeSkill
      ? { ...parent.sessionState.activeSkill }
      : null,
    memoryFreshness: parent.sessionState.memoryFreshness ?? null,
    systemPrompt: parent.sessionState.systemPrompt ?? null,
    toolSchema: parent.sessionState.toolSchema ?? null,
    modelParams: parent.sessionState.modelParams ?? null,
    timestamp: createTimestamp(),
  })
  return updatedTask
}

function requireSubagentWorktreeDiff(task: BackgroundTask): SubagentWorktreeDiff {
  if (task.type !== 'subagent') {
    throw new Error(`task is not a subagent task: ${task.id}`)
  }
  if (!task.worktreeDiff) {
    throw new Error(`subagent task has no worktree diff: ${task.id}`)
  }
  if (task.worktreeDiff.status === 'failed') {
    throw new Error(`subagent worktree diff failed: ${task.worktreeDiff.error ?? task.id}`)
  }
  return task.worktreeDiff
}

async function applySubagentWorktreeDiff(
  diff: SubagentWorktreeDiff,
  options: Pick<AgentApplyOptions, 'mode' | 'threeWay' | 'files'>,
): Promise<SubagentWorktreeApply> {
  const appliedAt = createTimestamp()
  const requestedFiles = options.files?.length ? [...new Set(options.files)] : undefined
  const selected = selectWorktreeDiffFiles(diff, requestedFiles)
  const checkedFiles = selected.selectedFiles.map(file => file.path)
  const base = {
    strategy: 'git-apply-after-baseline-check' as const,
    mode: options.mode,
    sourceCwd: diff.sourceCwd,
    baselinePath: diff.baselinePath,
    baselineRef: diff.baselineRef,
    worktreePath: diff.worktreePath,
    patchPath: diff.patchPath,
    gitWorktree: diff.gitWorktree,
    threeWay: options.threeWay,
    filesChanged: checkedFiles.length,
    checkedFiles,
    requestedFiles,
    appliedFiles: [] as string[],
    skippedFiles: selected.skippedFiles,
    appliedAt,
  }
  if (selected.missingFiles.length > 0) {
    return {
      ...base,
      status: 'failed',
      conflicts: selected.missingFiles,
      conflictDetails: selected.missingFiles.map(file => ({
        path: file,
        reason: 'missing_from_diff',
        detail: 'requested file is not present in the subagent worktree diff',
      })),
      error: `requested files are not present in worktree diff: ${selected.missingFiles.join(', ')}`,
    }
  }
  if (diff.status === 'clean' || checkedFiles.length === 0) {
    return {
      ...base,
      status: 'clean',
    }
  }

  const invalidPaths = checkedFiles.filter(file => !isSafeRelativePatchPath(file))
  if (invalidPaths.length > 0) {
    return {
      ...base,
      status: 'failed',
      conflicts: invalidPaths,
      conflictDetails: invalidPaths.map(file => ({
        path: file,
        reason: 'unsafe_path',
        detail: 'patch path is absolute or contains parent traversal',
      })),
      error: `worktree diff contains unsafe paths: ${invalidPaths.join(', ')}`,
    }
  }

  const conflicts = await findSourceBaselineConflicts(diff, checkedFiles, options.mode)
  if (conflicts.length > 0) {
    return {
      ...base,
      status: 'conflict',
      conflicts,
      conflictDetails: conflicts.map(file => ({
        path: file,
        reason: 'source_changed_from_baseline',
        detail: 'source cwd no longer matches the subagent baseline for this file',
      })),
      error: 'source cwd no longer matches the subagent baseline for changed files',
    }
  }

  const checkArgs = buildGitApplyArgs(diff, {
    mode: options.mode === 'rollback' ? 'rollback-check' : 'check',
    files: checkedFiles,
    threeWay: options.threeWay,
  })
  const applyArgs = buildGitApplyArgs(diff, {
    mode: options.mode === 'rollback' ? 'rollback' : 'apply',
    files: checkedFiles,
    threeWay: options.threeWay,
  })
  try {
    await execFileStrict('git', checkArgs, {
      cwd: diff.sourceCwd,
    })
    if (options.mode === 'check') {
      return {
        ...base,
        status: 'checked',
      }
    }
    await execFileStrict('git', applyArgs, {
      cwd: diff.sourceCwd,
    })
    return {
      ...base,
      status: options.mode === 'rollback' ? 'rolled_back' : 'applied',
      appliedFiles: checkedFiles,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ...base,
      status: 'failed',
      conflicts: checkedFiles,
      conflictDetails: checkedFiles.map(file => ({
        path: file,
        reason: 'apply_check_failed',
        detail: message,
      })),
      error: message,
    }
  }
}

function selectWorktreeDiffFiles(
  diff: SubagentWorktreeDiff,
  requestedFiles: string[] | undefined,
): {
  selectedFiles: SubagentWorktreeDiff['changedFiles']
  skippedFiles: string[]
  missingFiles: string[]
} {
  if (!requestedFiles?.length) {
    return {
      selectedFiles: diff.changedFiles,
      skippedFiles: [],
      missingFiles: [],
    }
  }
  const requested = new Set(requestedFiles)
  const selectedFiles = diff.changedFiles.filter(file => requested.has(file.path))
  const selected = new Set(selectedFiles.map(file => file.path))
  return {
    selectedFiles,
    skippedFiles: diff.changedFiles
      .map(file => file.path)
      .filter(file => !selected.has(file)),
    missingFiles: requestedFiles.filter(file => !selected.has(file)),
  }
}

function buildGitApplyArgs(
  diff: SubagentWorktreeDiff,
  options: {
    mode: 'check' | 'apply' | 'rollback-check' | 'rollback'
    files: string[]
    threeWay: boolean
  },
): string[] {
  const args = ['apply', '--whitespace=nowarn']
  if (options.mode === 'check' || options.mode === 'rollback-check') args.push('--check')
  if (options.mode === 'rollback' || options.mode === 'rollback-check') args.push('-R')
  if (options.threeWay && options.mode !== 'rollback' && options.mode !== 'rollback-check') {
    args.push('--3way')
  }
  if (options.files.length < diff.changedFiles.length) {
    for (const file of options.files) args.push(`--include=${file}`)
    args.push('--exclude=*')
  }
  args.push(diff.patchPath)
  return args
}

async function findSourceBaselineConflicts(
  diff: SubagentWorktreeDiff,
  checkedFiles: string[],
  mode: AgentApplyOptions['mode'],
): Promise<string[]> {
  if (diff.strategy === 'git-worktree-diff' && diff.baselineRef) {
    return findGitSourceBaselineConflicts(diff, checkedFiles, mode)
  }
  const conflicts: string[] = []
  const byPath = new Map(diff.changedFiles.map(file => [file.path, file]))
  for (const relativePath of checkedFiles) {
    const file = byPath.get(relativePath)
    if (!file) continue
    const baselineFile = path.join(diff.baselinePath, relativePath)
    const sourceFile = path.join(diff.sourceCwd, relativePath)
    if (file.status === 'added') {
      if (mode === 'rollback') {
        if (!await pathExists(sourceFile)) conflicts.push(relativePath)
        continue
      }
      if (await pathExists(sourceFile)) conflicts.push(relativePath)
      continue
    }
    const [baseline, source] = await Promise.all([
      readOptionalFile(baselineFile),
      readOptionalFile(sourceFile),
    ])
    if (!baseline || !source || Buffer.compare(baseline, source) !== 0) {
      conflicts.push(relativePath)
    }
  }
  return conflicts
}

async function findGitSourceBaselineConflicts(
  diff: SubagentWorktreeDiff,
  checkedFiles: string[],
  mode: AgentApplyOptions['mode'],
): Promise<string[]> {
  const conflicts: string[] = []
  const byPath = new Map(diff.changedFiles.map(file => [file.path, file]))
  for (const relativePath of checkedFiles) {
    const file = byPath.get(relativePath)
    if (!file) continue
    if (file.status === 'added') {
      if (mode === 'rollback') {
        if (!await pathExists(path.join(diff.sourceCwd, relativePath))) conflicts.push(relativePath)
        continue
      }
      if (await pathExists(path.join(diff.sourceCwd, relativePath))) conflicts.push(relativePath)
      continue
    }
    try {
      await execFileStrict('git', ['diff', '--quiet', diff.baselineRef as string, '--', relativePath], {
        cwd: diff.sourceCwd,
      })
    } catch {
      conflicts.push(relativePath)
    }
  }
  return conflicts
}

function isSafeRelativePatchPath(value: string): boolean {
  return Boolean(value) &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes('..')
}

async function readOptionalFile(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch {
    return null
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function execFileStrict(
  file: string,
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd: options.cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr.trim() || error.message
        reject(new Error(message))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function mapSubagentResumeTaskStatus(
  status: AgentRuntimeTurnResult['report']['status'],
): NonNullable<BackgroundTask['status']> {
  if (status === 'completed') return 'completed'
  if (status === 'stopped') return 'stopped'
  return 'failed'
}

function findSubagentTask(
  sessionState: RuntimeSessionSnapshot['sessionState'],
  taskId: string,
): BackgroundTask {
  const candidates = [
    ...sessionState.backgroundTasks,
    ...(sessionState.retainedTasks ?? []),
  ].filter(task => task.type === 'subagent')
  const exact = candidates.find(task => task.id === taskId)
  if (exact) return exact
  const prefixMatches = candidates.filter(task => task.id.startsWith(taskId))
  if (prefixMatches.length === 1 && prefixMatches[0]) return prefixMatches[0]
  if (prefixMatches.length > 1) {
    throw new Error(`subagent task selector is ambiguous: ${taskId}`)
  }
  throw new Error(`subagent task not found: ${taskId}`)
}

function requireSubagentTranscriptPath(task: BackgroundTask): string {
  if (task.type !== 'subagent') {
    throw new Error(`task is not a subagent task: ${task.id}`)
  }
  if (!task.transcriptPath) {
    throw new Error(`subagent task has no transcript path: ${task.id}`)
  }
  return task.transcriptPath
}

function buildSubagentOutputStream(
  events: Awaited<ReturnType<typeof readTranscriptFile>>,
): Array<Record<string, unknown>> {
  const stream: Array<Record<string, unknown>> = []
  for (const [index, event] of events.entries()) {
    const base = {
      index,
      timestamp: 'timestamp' in event ? event.timestamp : undefined,
    }
    switch (event.type) {
      case 'user':
        stream.push({
          ...base,
          kind: 'prompt',
          content: truncateText(event.content, 500),
        })
        break
      case 'assistant':
        stream.push({
          ...base,
          kind: 'assistant',
          content: event.content,
          toolCalls: event.toolCalls?.map(call => ({
            id: call.id,
            name: call.name,
          })) ?? [],
        })
        break
      case 'tool-call':
        stream.push({
          ...base,
          kind: 'tool-call',
          tool: event.call.name,
          toolCallId: event.call.id,
          input: event.call.input,
        })
        break
      case 'tool-result':
        stream.push({
          ...base,
          kind: 'tool-result',
          toolCallId: event.result.toolCallId,
          ok: event.result.ok,
          content: truncateText(event.result.content, 2000),
          metadata: event.result.metadata,
        })
        break
      case 'permission':
        stream.push({
          ...base,
          kind: 'permission',
          action: event.request.action,
          subject: event.request.subject,
          allowed: event.decision.allowed,
          origin: event.request.origin,
          policy: event.request.policy,
        })
        break
      case 'llm-response':
        stream.push({
          ...base,
          kind: 'llm-response',
          status: event.status,
          stopReason: event.stopReason,
          toolCallCount: event.toolCallCount,
        })
        break
      case 'subagent-lifecycle':
        stream.push({
          ...base,
          kind: 'subagent-lifecycle',
          event: event.event,
        })
        break
      default:
        break
    }
  }
  return stream
}

function escapePromptAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
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
  await writeSessionMemory(memoryPath, memory, {
    transcriptPath: snapshot.transcriptPath,
    sourceLastEvent: getSessionMemoryEventPointer(
      snapshot.events,
      memory.sourceEventCount,
    ),
  })
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

async function manageSessionMemory(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
  deps: CliDeps = {},
): Promise<void> {
  const operation = args[0]
  const sessionId = args[1]
  if (
    !operation ||
    !['status', 'view', 'write', 'edit', 'delete', 'refresh', 'validate', 'promote'].includes(operation) ||
    !sessionId ||
    sessionId.startsWith('-')
  ) {
    throw new Error('memory requires: <status|view|write|edit|delete|refresh|validate|promote> <session-id>')
  }

  const { optionArgs, content, memoryKind, topic, background, refreshBeforeValidate } = parseMemoryOperationArgs(args.slice(2))
  const parsed = await resolveOptions(
    parseOptions(optionArgs, { requirePrompt: false }),
    env,
  )
  try {
    const snapshot = await resumeSessionById({
      sessionId,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
    })
    const memoryPath = getSessionMemoryPath({
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
    })

    if (operation === 'promote') {
      if (!content?.trim()) {
        throw new Error('memory promote requires --content')
      }
      if (!memoryKind) {
        throw new Error('memory promote requires --type')
      }
      if (!topic?.trim()) {
        throw new Error('memory promote requires --topic')
      }
      const result = await promoteLongTermMemory({
        cwd: parsed.cwd,
        kind: memoryKind,
        topic,
        content,
        source: {
          sessionId: snapshot.sessionId,
          transcriptPath: snapshot.transcriptPath,
          sourceEventCount: snapshot.events.length,
        },
      })
      writeJson(output, {
        sessionId: snapshot.sessionId,
        promoted: result.promoted,
        decision: result.decision,
        entry: result.entry,
        manifestPath: result.manifest.manifestPath,
        indexPath: result.manifest.indexPath,
        entryCount: result.manifest.entries.length,
      })
      return
    }

    if (operation === 'delete') {
      await deleteSessionMemory(memoryPath)
      writeJson(output, {
        sessionId: snapshot.sessionId,
        memoryPath,
        deleted: true,
      })
      return
    }

    if (operation === 'refresh') {
      const scheduled = await scheduleSessionMemoryExtraction({
        snapshot,
        cwd: parsed.cwd,
        sessionsDir: parsed.sessionsDir,
        trigger: 'manual',
        force: true,
      })
      if (background) {
        writeJson(output, {
          sessionId: snapshot.sessionId,
          queued: true,
          background: true,
          extraction: scheduled.job,
        })
        return
      }
      const extraction = await scheduled.completion
      writeJson(output, {
        sessionId: snapshot.sessionId,
        queued: false,
        background: false,
        extraction,
        memory: await inspectSessionMemory({
          snapshot,
          cwd: parsed.cwd,
          sessionsDir: parsed.sessionsDir,
          includeContent: true,
        }),
      })
      return
    }

    if (operation === 'validate') {
      const groundingModel =
        deps.createModelClient?.(env) ??
        createDeepSeekModelClient({
          apiKey: env.DEEPSEEK_API_KEY,
          baseUrl: parsed.deepseekBaseUrl ?? env.DEEPSEEK_BASE_URL,
          model: parsed.model ?? env.DEEPSEEK_MODEL,
        })
      if (refreshBeforeValidate) {
        const ensured = await ensureFreshSessionMemory({
          snapshot,
          cwd: parsed.cwd,
          sessionsDir: parsed.sessionsDir,
          trigger: 'manual',
          groundingModel,
        })
        writeJson(output, {
          sessionId: snapshot.sessionId,
          validated: Boolean(ensured.after.groundingValidation),
          providerGrounded: true,
          readiness: ensured.readiness,
          memory: ensured.after,
        })
        return
      }

      const before = await inspectSessionMemory({
        snapshot,
        cwd: parsed.cwd,
        sessionsDir: parsed.sessionsDir,
        includeContent: false,
      })
      const after = await inspectSessionMemory({
        snapshot,
        cwd: parsed.cwd,
        sessionsDir: parsed.sessionsDir,
        includeContent: true,
        groundingModel,
      })
      const extraction = await readSessionMemoryExtractionStatus(memoryPath)
      const readiness = buildCompactMemoryReadiness({
        before,
        after,
        refreshed: false,
        extraction,
      })
      writeJson(output, {
        sessionId: snapshot.sessionId,
        validated: Boolean(after.groundingValidation),
        providerGrounded: true,
        readiness,
        memory: after,
      })
      return
    }

    if (operation === 'write' || operation === 'edit') {
      if (!content?.trim()) {
        throw new Error(`memory ${operation} requires --content`)
      }
      const memory = {
        sessionId: snapshot.sessionId,
        generatedAt: createTimestamp(),
        sourceEventCount: snapshot.events.length,
        content,
      }
      await writeSessionMemory(memoryPath, memory, {
        transcriptPath: snapshot.transcriptPath,
        sourceLastEvent: getSessionMemoryEventPointer(
          snapshot.events,
          memory.sourceEventCount,
        ),
      })
    }

    const inspection = await inspectSessionMemory({
      snapshot,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
      includeContent: operation === 'view' || operation === 'write' || operation === 'edit',
    })
    writeJson(output, {
      ...inspection,
      extraction: await readSessionMemoryExtractionStatus(memoryPath),
    })
  } finally {
    parsed.mcp.close()
  }
}

async function compactSession(
  args: string[],
  output: Pick<NodeJS.WriteStream, 'write'>,
  env: NodeJS.ProcessEnv,
  deps: CliDeps = {},
): Promise<void> {
  const sessionId = args[0]
  if (!sessionId || sessionId.startsWith('-')) {
    throw new Error('compact requires a session id')
  }
  const {
    optionArgs,
    summary,
    reactiveEventCount,
    tokenBudget,
    contextWindowTokens,
    reservedOutputTokens,
    reservedSystemTokens,
    reservedToolSchemaTokens,
    safetyMarginTokens,
    pressureThreshold,
    validateMemory,
  } = parseCompactOperationArgs(args.slice(1))
  const parsed = await resolveOptions(
    parseOptions(optionArgs, { requirePrompt: false }),
    env,
  )
  try {
    const memoryGroundingModel = validateMemory
      ? deps.createModelClient?.(env) ??
        createDeepSeekModelClient({
          apiKey: env.DEEPSEEK_API_KEY,
          baseUrl: parsed.deepseekBaseUrl ?? env.DEEPSEEK_BASE_URL,
          model: parsed.model ?? env.DEEPSEEK_MODEL,
        })
      : undefined
    const snapshot = await resumeSessionById({
      sessionId,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
    })
    const memoryPath = getSessionMemoryPath({
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
    })
    const beforeMemory = await inspectSessionMemory({
      snapshot,
      cwd: parsed.cwd,
      sessionsDir: parsed.sessionsDir,
      includeContent: true,
    })

    let compactSummary = summary?.trim()
    let summarySource: 'operator-summary' | 'fresh-session-memory' | 'refreshed-session-memory'
    let refreshedMemory = false
    let ensuredMemoryResult: Awaited<ReturnType<typeof ensureFreshSessionMemory>> | undefined

    if (compactSummary) {
      summarySource = 'operator-summary'
    } else if (
      beforeMemory.exists &&
      beforeMemory.freshness === 'fresh' &&
      beforeMemory.content?.trim()
    ) {
      compactSummary = beforeMemory.content
      summarySource = 'fresh-session-memory'
    } else {
      const ensuredMemory = await ensureFreshSessionMemory({
        snapshot,
        cwd: parsed.cwd,
        sessionsDir: parsed.sessionsDir,
        trigger: 'compact',
        groundingModel: memoryGroundingModel,
      })
      if (!ensuredMemory.record?.content.trim()) {
        throw new Error('compact could not obtain fresh session memory')
      }
      compactSummary = ensuredMemory.record.content
      summarySource = 'refreshed-session-memory'
      refreshedMemory = true
      ensuredMemoryResult = ensuredMemory
    }

    const compactStore = new JsonlTranscriptStore({
      transcriptPath: snapshot.transcriptPath,
      sessionId: snapshot.sessionId,
    })
    const compactEvents = await compactStore.readAll()
    const contextBudget =
      tokenBudget !== undefined || contextWindowTokens !== undefined
        ? resolveCompactContextWindowBudget({
            tokenBudget,
            modelId: parsed.model ?? parsed.settings.settings.model ?? 'deepseek-v4-flash',
            provider: 'deepseek',
            contextWindowTokens,
            reservedOutputTokens,
            reservedSystemTokens,
            reservedToolSchemaTokens,
            safetyMarginTokens,
            pressureThreshold,
          })
        : undefined
    const tokenPressure =
      contextBudget !== undefined
        ? estimateCompactTokenPressure(compactEvents, {
            contextBudget,
          })
        : undefined
    const afterMemory =
      ensuredMemoryResult?.after ??
      await inspectSessionMemory({
        snapshot,
        cwd: parsed.cwd,
        sessionsDir: parsed.sessionsDir,
        includeContent: true,
        groundingModel: memoryGroundingModel,
      })
    const extraction =
      ensuredMemoryResult?.extraction ?? await readSessionMemoryExtractionStatus(memoryPath)
    const memoryReadiness =
      ensuredMemoryResult?.readiness ??
      buildCompactMemoryReadiness({
        before: beforeMemory,
        after: afterMemory,
        refreshed: refreshedMemory,
        extraction,
      })
    if (
      validateMemory &&
      summarySource !== 'operator-summary' &&
      !memoryReadiness.ready
    ) {
      throw new Error(
        `compact memory readiness blocked: ${memoryReadiness.blockingReasons.join(', ') || 'unknown'}`,
      )
    }
    const boundary = await compactTranscript({
      transcript: compactStore,
      summary: compactSummary,
      trigger: 'manual',
      querySource: 'main',
      userContext: summarySource === 'operator-summary' ? compactSummary : undefined,
      reactiveEventCount,
      sessionState: {
        ...snapshot.sessionState,
        memoryFreshness: afterMemory.freshness ?? snapshot.sessionState.memoryFreshness,
      },
      tokenPressure,
      memoryReadiness,
    })
    const compactedEvents = await compactStore.readAll()

    writeJson(output, {
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
      compacted: true,
      summarySource,
      memoryReadiness: {
        ...memoryReadiness,
      },
      boundary: {
        timestamp: boundary.timestamp,
        trigger: boundary.metadata.trigger,
        route: boundary.metadata.compactRoute,
        preEventCount: boundary.metadata.preEventCount,
        messagesSummarized: boundary.metadata.messagesSummarized,
        preservedSegment: boundary.metadata.preservedSegment,
        postCompactCleanup: boundary.metadata.postCompactCleanup,
        tokenPressure: boundary.metadata.tokenPressure,
        contextBudget: boundary.metadata.tokenPressure?.contextBudget,
        memoryReadiness: boundary.metadata.memoryReadiness,
        memoryFreshness: boundary.metadata.memoryFreshness,
      },
      eventCount: compactedEvents.length,
    })
  } finally {
    parsed.mcp.close()
  }
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
      `retained=${session.retainedTaskCount}`,
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
  const coordinator = createPermissionResolutionCoordinator()
  return {
    setMode(nextMode: PermissionMode) {
      currentMode = nextMode
    },
    getMode() {
      return currentMode
    },
    async requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
      const decision = await coordinator.resolve(request, async currentRequest => {
        let decision = decidePermission(currentMode, currentRequest)
        if (!decision.allowed) {
          const prompt = await promptWorkbenchPermission(currentRequest, reader, output)
          if (prompt === 'allow-similar') {
            currentMode = deriveSimilarPermissionMode(currentRequest)
            decision = {
              allowed: true,
              reason: `operator approved and promoted session permission mode to ${currentMode}`,
              ...(currentRequest.origin ? { origin: currentRequest.origin } : {}),
              ...(currentRequest.policy ? { policy: currentRequest.policy } : {}),
            }
          } else if (prompt === 'allow') {
            decision = {
              allowed: true,
              reason: 'operator approved in workbench',
              ...(currentRequest.origin ? { origin: currentRequest.origin } : {}),
              ...(currentRequest.policy ? { policy: currentRequest.policy } : {}),
            }
          } else {
            decision = {
              allowed: false,
              reason: 'operator denied in workbench',
              ...(currentRequest.origin ? { origin: currentRequest.origin } : {}),
              ...(currentRequest.policy ? { policy: currentRequest.policy } : {}),
            }
          }
          return { decision, source: 'operator' }
        }
        return {
          decision,
          source: currentRequest.policy?.sandboxDecision === 'denied'
            ? 'safety-policy'
            : 'permission-mode',
        }
      })
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
    case 'subagent-lifecycle':
      return `[subagent:${event.event.status}] ${event.event.agentName} ${truncateText(event.event.summary ?? event.event.finalMessage, 120)}`
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

function parseInitOptions(
  args: string[],
  env: NodeJS.ProcessEnv,
): {
  cwd: string
  force: boolean
  model: string
  permissionMode: PermissionMode
} {
  let cwd = process.cwd()
  let force = false
  let model = env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
  let permissionMode: PermissionMode = 'ask'
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') {
      cwd = requireValue(args, ++index, '--cwd')
      continue
    }
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--model') {
      model = requireValue(args, ++index, '--model')
      continue
    }
    if (arg === '--permission-mode') {
      const value = requireValue(args, ++index, '--permission-mode')
      if (!PERMISSION_MODES.has(value as PermissionMode)) {
        throw new Error(`Unsupported permission mode: ${value}`)
      }
      permissionMode = value as PermissionMode
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return { cwd, force, model, permissionMode }
}

function parseMemoryOperationArgs(args: string[]): {
  optionArgs: string[]
  content?: string
  memoryKind?: LongTermMemoryKind
  topic?: string
  background: boolean
  refreshBeforeValidate: boolean
} {
  const optionArgs: string[] = []
  let content: string | undefined
  let memoryKind: LongTermMemoryKind | undefined
  let topic: string | undefined
  let background = false
  let refreshBeforeValidate = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--background') {
      background = true
      continue
    }
    if (arg === '--refresh') {
      refreshBeforeValidate = true
      continue
    }
    if (arg === '--content') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('--content requires a value')
      }
      content = value
      index += 1
      continue
    }
    if (arg === '--type') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('--type requires a value')
      }
      if (!['user', 'feedback', 'project', 'reference'].includes(value)) {
        throw new Error(`Unsupported long-term memory type: ${value}`)
      }
      memoryKind = value as LongTermMemoryKind
      index += 1
      continue
    }
    if (arg === '--topic') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('--topic requires a value')
      }
      topic = value
      index += 1
      continue
    }
    optionArgs.push(arg)
  }
  return { optionArgs, content, memoryKind, topic, background, refreshBeforeValidate }
}

function parseCompactOperationArgs(args: string[]): {
  optionArgs: string[]
  summary?: string
  validateMemory: boolean
  reactiveEventCount: number
  tokenBudget?: number
  contextWindowTokens?: number
  reservedOutputTokens?: number
  reservedSystemTokens?: number
  reservedToolSchemaTokens?: number
  safetyMarginTokens?: number
  pressureThreshold?: number
} {
  const optionArgs: string[] = []
  let summary: string | undefined
  let validateMemory = false
  let reactiveEventCount = 12
  let tokenBudget: number | undefined
  let contextWindowTokens: number | undefined
  let reservedOutputTokens: number | undefined
  let reservedSystemTokens: number | undefined
  let reservedToolSchemaTokens: number | undefined
  let safetyMarginTokens: number | undefined
  let pressureThreshold: number | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--summary') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('--summary requires a value')
      }
      summary = value
      index += 1
      continue
    }
    if (arg === '--validate-memory') {
      validateMemory = true
      continue
    }
    if (arg === '--reactive-events') {
      reactiveEventCount = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--reactive-events'),
      )
      continue
    }
    if (arg === '--token-budget') {
      tokenBudget = parsePositiveInteger(
        requireValue(args, (index += 1), '--token-budget'),
      )
      continue
    }
    if (arg === '--context-window') {
      contextWindowTokens = parsePositiveInteger(
        requireValue(args, (index += 1), '--context-window'),
      )
      continue
    }
    if (arg === '--output-reserve') {
      reservedOutputTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--output-reserve'),
      )
      continue
    }
    if (arg === '--system-reserve') {
      reservedSystemTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--system-reserve'),
      )
      continue
    }
    if (arg === '--tool-schema-reserve') {
      reservedToolSchemaTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--tool-schema-reserve'),
      )
      continue
    }
    if (arg === '--safety-margin') {
      safetyMarginTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--safety-margin'),
      )
      continue
    }
    if (arg === '--pressure-threshold') {
      pressureThreshold = parsePositiveRatio(
        requireValue(args, (index += 1), '--pressure-threshold'),
      )
      continue
    }
    optionArgs.push(arg)
  }
  return {
    optionArgs,
    summary,
    validateMemory,
    reactiveEventCount,
    tokenBudget,
    contextWindowTokens,
    reservedOutputTokens,
    reservedSystemTokens,
    reservedToolSchemaTokens,
    safetyMarginTokens,
    pressureThreshold,
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
  const projectInstructions = buildProjectInstructionsGuidance(parsed.projectInstructions)
  if (projectInstructions) {
    guidance.push(projectInstructions)
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
  const projectInstructions = await loadProjectInstructions({ cwd: parsed.cwd })
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
    projectInstructions,
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

function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got: ${value}`)
  }
  return parsed
}

function parsePositiveRatio(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive ratio, got: ${value}`)
  }
  return parsed
}

async function detectDefaultCommands(cwd: string): Promise<Record<string, string>> {
  const packageJsonPath = path.join(cwd, 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  } catch {
    return {}
  }
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return {}
  const runner = await detectPackageRunner(cwd)
  const commands: Record<string, string> = {}
  for (const name of ['test', 'typecheck', 'build', 'lint']) {
    if (typeof parsed.scripts[name] === 'string') {
      commands[name] = `${runner} ${name}`
    }
  }
  return commands
}

async function detectPackageRunner(cwd: string): Promise<string> {
  if (await fileExists(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await fileExists(path.join(cwd, 'yarn.lock'))) return 'yarn'
  if (await fileExists(path.join(cwd, 'bun.lockb'))) return 'bun run'
  if (await fileExists(path.join(cwd, 'package-lock.json'))) return 'npm run'
  return 'npm run'
}

async function writeTextFileIfAllowed(
  filePath: string,
  content: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  if (!force && await fileExists(filePath)) {
    return { created: [], skipped: [filePath] }
  }
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return { created: [filePath], skipped: [] }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function buildDefaultAgentsInstructions(): string {
  return [
    '# Project Agent Instructions',
    '',
    '- Prefer small, evidence-backed changes over broad rewrites.',
    '- Use project-local tools and scripts before inventing new workflows.',
    '- Respect `.vigilon/settings.json` ignore patterns and permission mode.',
    '- Verify meaningful code changes with the narrowest relevant command first.',
    '',
  ].join('\n')
}

function formatToolForListing(tool: Tool): {
  name: string
  description: string
  readOnly: boolean
  deferred: boolean
  searchTerms: readonly string[]
} {
  return {
    name: tool.name,
    description: tool.description,
    readOnly: tool.readOnly === true,
    deferred: tool.deferred === true,
    searchTerms: tool.searchTerms ?? [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function writeJson(output: Pick<NodeJS.WriteStream, 'write'>, value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await runCli()
}
