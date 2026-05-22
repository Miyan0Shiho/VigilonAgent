import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  OperatorShellDeps,
  OperatorShellIO,
  TuiAgentDetail,
  TuiAgentDefinitionRow,
  TuiAgentTaskNotification,
  TuiAgentTaskRow,
  TuiAgentView,
  TuiCompactResult,
  TuiHandoff,
  TuiOptions,
  TuiRuntimeAdapter,
  TuiRuntimeEvent,
  TuiSessionDetail,
  TuiSessionSummary,
  TuiToolActivity,
} from './types.js'
import type { LineReader } from './lineReader.js'

type RuntimeModule = Record<string, any>

const PERMISSION_MODES = new Set(['read-only', 'ask', 'accept-edits', 'bypass-local'])

export async function createNodeRuntimeAdapter(input: {
  args: string[]
  io: OperatorShellIO
  deps: OperatorShellDeps
  reader: LineReader
}): Promise<TuiRuntimeAdapter> {
  const runtime = (input.deps.runtimeModule as RuntimeModule | undefined) ?? await importRuntime()
  const parsed = parseOptions(input.args)
  const resolved = await resolveOptions(runtime, parsed, input.io.env)
  const taskManager = runtime.createTaskManager()
  const notificationListeners = new Set<(event: TuiRuntimeEvent) => void>()
  const deliveredTaskNotificationKeys = new Set<string>()
  const unsubscribeTaskManager = typeof taskManager.subscribe === 'function'
    ? taskManager.subscribe((event: any) => {
        const notification = taskManagerEventToTuiNotification(event)
        if (!notification) return
        deliveredTaskNotificationKeys.add(taskNotificationKey(notification))
        emitAgentNotification(notificationListeners, {
          type: 'agent-notification',
          notification,
        })
      })
    : () => {}

  return {
    options: resolved,
    async close() {
      unsubscribeTaskManager()
      await taskManager.shutdown?.()
      resolved.mcp?.close?.()
    },
    subscribeAgentTaskNotifications(listener: (event: TuiRuntimeEvent) => void): () => void {
      notificationListeners.add(listener)
      void replayAgentTaskNotifications({
        runtime,
        resolved,
        listener,
        notificationListeners,
        deliveredTaskNotificationKeys,
      })
      return () => {
        notificationListeners.delete(listener)
      }
    },
    async doctor() {
      const baseline = runtime.createPhase1RuntimeBaseline()
      return {
        status: input.io.env.DEEPSEEK_API_KEY ? 'ok' : 'warning',
        package: '@vigilon/runtime',
        version: runtime.VIGILON_RUNTIME_VERSION,
        phase: baseline.phase,
        cwd: resolved.cwd,
        sessionsDir: runtime.getProjectSessionDir(resolved.cwd, resolved.sessionsDir),
        permissionMode: resolved.permissionMode,
        model: resolved.model ?? input.io.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        deepseekApiKeyPresent: Boolean(input.io.env.DEEPSEEK_API_KEY),
        settingsSources: resolved.settings.loadedSources.map((source: { path: string }) => source.path),
        loadedSkillCount: resolved.skills.skills.length,
        loadedMcpToolCount: resolved.mcp.tools.length,
      }
    },
    async listSessions() {
      return runtime.listSessions({
        cwd: resolved.cwd,
        sessionsDir: resolved.sessionsDir,
      }) as Promise<TuiSessionSummary[]>
    },
    async openSession(selector: string) {
      const sessions = await runtime.listSessions({
        cwd: resolved.cwd,
        sessionsDir: resolved.sessionsDir,
      }) as TuiSessionSummary[]
      const session = resolveSessionSelector(selector, sessions)
      if (!session) return null
      const events = await runtime.readTranscriptFile(session.transcriptPath)
      return {
        session,
        recentEvents: events.slice(-12).map((event: unknown) => formatTranscriptEvent(event)),
      } satisfies TuiSessionDetail
    },
    async listAgents() {
      return buildAgentView(runtime, resolved)
    },
    async inspectAgentTask(sessionSelector: string, taskId: string) {
      const detail = await inspectAgentTask(runtime, resolved, sessionSelector, taskId)
      if (!detail) return null
      const view = await buildAgentView(runtime, resolved)
      return {
        ...view,
        detail,
      }
    },
    async resumeAgentTask({ sessionSelector, taskId, prompt }) {
      const sessions = await runtime.listSessions({
        cwd: resolved.cwd,
        sessionsDir: resolved.sessionsDir,
      }) as TuiSessionSummary[]
      const session = resolveSessionSelector(sessionSelector, sessions)
      if (!session) return null
      const stdout = createStringWriter()
      const exitCode = await runtime.runCli(
        [
          'agents',
          'resume',
          session.sessionId,
          taskId,
          ...(prompt.trim() ? prompt.trim().split(/\s+/) : ['continue']),
          '--cwd',
          resolved.cwd,
          ...(resolved.sessionsDir ? ['--sessions-dir', resolved.sessionsDir] : []),
          '--permission-mode',
          resolved.permissionMode ?? 'ask',
          ...(resolved.model ? ['--model', resolved.model] : []),
          ...(resolved.deepseekBaseUrl ? ['--deepseek-base-url', resolved.deepseekBaseUrl] : []),
        ],
        {
          stdout,
          stderr: input.io.stderr,
          stdin: input.io.stdin,
          env: input.io.env,
        },
        input.deps,
      )
      if (exitCode !== 0) {
        throw new Error(`agents resume failed with exit code ${exitCode}`)
      }
      const parsed = JSON.parse(stdout.text)
      const detail = await inspectAgentTask(runtime, resolved, session.sessionId, taskId)
      const view = await buildAgentView(runtime, resolved)
      return {
        ...view,
        detail: detail
          ? {
              ...detail,
              resumeResult: {
                status: String(parsed.status ?? 'unknown'),
                finalMessage: String(parsed.finalMessage ?? ''),
              },
            }
          : undefined,
      }
    },
    async stopAgentTask(sessionSelector: string, taskId: string) {
      const detail = await stopAgentTask(runtime, resolved, taskManager, sessionSelector, taskId)
      if (!detail) return null
      const view = await buildAgentView(runtime, resolved)
      return {
        ...view,
        detail,
      }
    },
    async applyAgentTask(sessionSelector: string, taskId: string, applyArgs: string[] = []) {
      const sessions = await runtime.listSessions({
        cwd: resolved.cwd,
        sessionsDir: resolved.sessionsDir,
      }) as TuiSessionSummary[]
      const session = resolveSessionSelector(sessionSelector, sessions)
      if (!session) return null
      const stdout = createStringWriter()
      const exitCode = await runtime.runCli(
        [
          'agents',
          'apply',
          session.sessionId,
          taskId,
          ...applyArgs,
          '--cwd',
          resolved.cwd,
          ...(resolved.sessionsDir ? ['--sessions-dir', resolved.sessionsDir] : []),
        ],
        {
          stdout,
          stderr: input.io.stderr,
          stdin: input.io.stdin,
          env: input.io.env,
        },
        input.deps,
      )
      if (exitCode !== 0) {
        throw new Error(`agents apply failed with exit code ${exitCode}`)
      }
      const parsed = JSON.parse(stdout.text)
      const detail = await inspectAgentTask(runtime, resolved, session.sessionId, taskId)
      const view = await buildAgentView(runtime, resolved)
      return {
        ...view,
        detail: detail
          ? {
              ...detail,
              applyResult: {
                status: String(parsed.status ?? 'unknown'),
                message: String(parsed.apply?.error ?? `source apply ${parsed.status ?? 'unknown'}`),
              },
            }
          : undefined,
      }
    },
    async compactSession({ sessionSelector, args = [] }) {
      const sessions = await runtime.listSessions({
        cwd: resolved.cwd,
        sessionsDir: resolved.sessionsDir,
      }) as TuiSessionSummary[]
      const session = resolveSessionSelector(sessionSelector, sessions)
      if (!session) return null
      const stdout = createStringWriter()
      const exitCode = await runtime.runCli(
        [
          'compact',
          session.sessionId,
          ...args,
          '--cwd',
          resolved.cwd,
          ...(resolved.sessionsDir ? ['--sessions-dir', resolved.sessionsDir] : []),
          ...(resolved.model ? ['--model', resolved.model] : []),
          ...(resolved.deepseekBaseUrl ? ['--deepseek-base-url', resolved.deepseekBaseUrl] : []),
        ],
        {
          stdout,
          stderr: input.io.stderr,
          stdin: input.io.stdin,
          env: input.io.env,
        },
        input.deps,
      )
      if (exitCode !== 0) {
        throw new Error(`compact failed with exit code ${exitCode}`)
      }
      return JSON.parse(stdout.text) as TuiCompactResult
    },
    async runTask({ prompt, sessionSelector, approvePlan = false, onEvent }) {
      const sessions = await runtime.listSessions({
        cwd: resolved.cwd,
        sessionsDir: resolved.sessionsDir,
      }) as TuiSessionSummary[]
      const selectedSession = sessionSelector
        ? resolveSessionSelector(sessionSelector, sessions)
        : undefined
      const resume = selectedSession
        ? await runtime.resumeSessionById({
            sessionId: selectedSession.sessionId,
            cwd: resolved.cwd,
            sessionsDir: resolved.sessionsDir,
          })
        : undefined
      const transcript = selectedSession
        ? new runtime.JsonlTranscriptStore({
            transcriptPath: resume.transcriptPath,
            sessionId: resume.sessionId,
          })
        : new runtime.JsonlTranscriptStore({
            cwd: resolved.cwd,
            sessionsDir: resolved.sessionsDir,
            sessionId: resolved.sessionId,
          })

      if (approvePlan && resume) {
        await approvePendingPlan(runtime, {
          resume,
          transcript,
          permissionMode: resolved.permissionMode,
        })
        resume.sessionState.phase = 'execute'
        resume.sessionState.permissionMode = resolved.permissionMode
        resume.sessionState.approvedPlan = resume.sessionState.pendingPlan
        resume.sessionState.pendingPlan = undefined
        resume.sessionState.prePlanPermissionMode = undefined
      }

      const toolNames = new Map<string, string>()
      const permissionGate = createTuiPermissionGate({
        runtime,
        mode: resolved.permissionMode,
        transcript,
        reader: input.reader,
        onEvent,
      })
      const operator = createTuiOperator({
        reader: input.reader,
        onEvent,
      })
      const modelClient =
        input.deps.createModelClient?.(input.io.env) ??
        runtime.createDeepSeekModelClient({
          apiKey: input.io.env.DEEPSEEK_API_KEY,
          baseUrl: resolved.deepseekBaseUrl ?? input.io.env.DEEPSEEK_BASE_URL,
          model: resolved.model ?? input.io.env.DEEPSEEK_MODEL,
        })
      const agent = runtime.createVigilonAgentRuntime({
        modelClient,
        tools: runtime.createCoreToolRegistry({
          skills: resolved.skills.skills,
          mcpTools: resolved.mcp.tools,
          allowedTools: resolved.projectConfig.allowedTools,
        }),
        transcript,
        permissionMode: resolved.permissionMode,
        preToolUseHooks: resolved.preToolUseHooks,
        skills: resolved.skills.skills,
        projectConfig: resolved.projectConfig,
        operator,
        permissionGate,
        maxTurns: resolved.maxTurns,
        resume,
        taskManager,
        operatorGuidance: [
          'You are running inside the Vigilon Operator TUI.',
          'Do not keep re-checking once the task is answered or verified.',
          'When you have a user-facing conclusion, answer directly in the final assistant message.',
          'Use ResultReport only when a structured audit handoff is useful; it is optional for ordinary answers.',
          buildRuntimeProjectInstructionsGuidance(runtime, resolved.projectInstructions) ?? '',
        ].join('\n'),
        stopAfterResultReport: true,
      })

      onEvent({ type: 'user', content: prompt })
      let turnResult: any
      for await (const event of agent.runTurn({
        prompt,
        cwd: resolved.cwd,
        abortSignal: new AbortController().signal,
      })) {
        if (event.type === 'model-request-started') {
          onEvent({ type: 'working', content: 'model request started' })
        }
        if (event.type === 'model-response-received') {
          if (event.response.reasoningContent) {
            onEvent({
              type: 'assistant',
              content: event.response.content,
              reasoning: event.response.reasoningContent,
            })
          } else if (event.response.content) {
            onEvent({ type: 'assistant', content: event.response.content })
          }
        }
        if (event.type === 'tool-started') {
          toolNames.set(event.call.id, event.call.name)
          onEvent({
            type: 'tool',
            activity: {
              id: event.call.id,
              name: event.call.name,
              status: 'running',
              summary: summarizeToolInput(event.call.name, event.call.input),
            },
          })
        }
        if (event.type === 'tool-finished') {
          const name = toolNames.get(event.result.toolCallId) ?? event.result.toolCallId
          const activity = {
            id: event.result.toolCallId,
            name,
            status: event.result.ok ? 'ok' : 'error',
            summary: summarizeToolResult(name, event.result),
            detail: event.result.ok ? undefined : event.result.content,
          } satisfies TuiToolActivity
          onEvent({ type: 'tool', activity })
          await emitRecentHookBlocks(runtime, transcript, onEvent)
        }
        if (event.type === 'subagent-lifecycle') {
          onEvent({
            type: 'subagent',
            status: event.event.status,
            agentName: event.event.agentName,
            taskId: event.event.taskId,
            summary: event.event.summary ?? event.event.finalMessage ?? '',
          })
        }
        if (event.type === 'turn-finished') {
          turnResult = event.result
        }
      }
      if (!turnResult) throw new Error('runtime finished without turn result')
      const handoff = buildHandoff(turnResult, transcript.transcriptPath)
      onEvent({ type: 'handoff', handoff })
      return {
        sessionId: transcript.sessionId,
        transcriptPath: transcript.transcriptPath,
        events: [],
        handoff,
      }
    },
  }
}

async function importRuntime(): Promise<RuntimeModule> {
  const specifier = '@vigilon/runtime'
  return import(specifier)
}

function taskManagerEventToTuiNotification(event: any): TuiAgentTaskNotification | null {
  if (event?.type !== 'task-terminal') return null
  const task = event.task
  if (!task || task.type !== 'subagent' || task.background !== true) return null
  return {
    sessionId: task.parentSessionId,
    taskId: String(task.id),
    agentName: task.agentName,
    status: String(task.status ?? event.terminal?.status ?? 'completed'),
    background: task.background === true,
    transcriptPath: task.transcriptPath,
    terminalReason: task.terminalReason ?? event.terminal?.terminalReason,
    outputSummary: task.outputSummary ?? event.terminal?.outputSummary,
    completedAt: task.completedAt ?? event.terminal?.completedAt ?? event.timestamp,
  }
}

async function replayAgentTaskNotifications(input: {
  runtime: RuntimeModule
  resolved: any
  listener: (event: TuiRuntimeEvent) => void
  notificationListeners: Set<(event: TuiRuntimeEvent) => void>
  deliveredTaskNotificationKeys: Set<string>
}): Promise<void> {
  let sessions: TuiSessionSummary[]
  try {
    sessions = await input.runtime.listSessions({
      cwd: input.resolved.cwd,
      sessionsDir: input.resolved.sessionsDir,
    }) as TuiSessionSummary[]
  } catch {
    return
  }
  for (const session of sessions) {
    let snapshot: any
    try {
      snapshot = await input.runtime.resumeSessionById({
        sessionId: session.sessionId,
        cwd: input.resolved.cwd,
        sessionsDir: input.resolved.sessionsDir,
      })
    } catch {
      continue
    }
    for (const task of snapshot.sessionState?.retainedTasks ?? []) {
      const notification = retainedTaskToReplayNotification(session.sessionId, task)
      if (!notification) continue
      const key = taskNotificationKey(notification)
      if (input.deliveredTaskNotificationKeys.has(key)) continue
      input.deliveredTaskNotificationKeys.add(key)
      if (!input.notificationListeners.has(input.listener)) continue
      try {
        input.listener({
          type: 'agent-notification',
          notification,
        })
      } catch {
        // Replay is observational and must not break adapter subscription.
      }
    }
  }
}

function retainedTaskToReplayNotification(
  sessionId: string,
  task: any,
): TuiAgentTaskNotification | null {
  if (!task || task.type !== 'subagent' || task.background !== true) return null
  if (!task.status || task.status === 'running') return null
  return {
    sessionId,
    taskId: String(task.id),
    agentName: task.agentName,
    status: String(task.status),
    background: true,
    transcriptPath: task.transcriptPath,
    terminalReason: task.terminalReason,
    outputSummary: task.outputSummary,
    completedAt: task.completedAt,
    replayed: true,
    source: 'transcript-replay',
  }
}

function taskNotificationKey(notification: TuiAgentTaskNotification): string {
  return [
    notification.sessionId ?? '',
    notification.taskId,
    notification.status,
    notification.completedAt ?? '',
    notification.terminalReason ?? '',
  ].join('\0')
}

function emitAgentNotification(
  listeners: Set<(event: TuiRuntimeEvent) => void>,
  event: TuiRuntimeEvent,
): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // A notification subscriber should not break the shared task host lifecycle.
    }
  }
}

function parseOptions(args: string[]): TuiOptions {
  const parsed: TuiOptions = {
    cwd: discoverWorkspaceRoot(process.cwd()) ?? process.cwd(),
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') parsed.cwd = requireValue(args, ++index, arg)
    else if (arg === '--sessions-dir') parsed.sessionsDir = requireValue(args, ++index, arg)
    else if (arg === '--permission-mode') {
      const value = requireValue(args, ++index, arg)
      if (!PERMISSION_MODES.has(value)) throw new Error(`Unsupported permission mode: ${value}`)
      parsed.permissionMode = value
    } else if (arg === '--max-turns') parsed.maxTurns = parsePositiveInteger(requireValue(args, ++index, arg))
    else if (arg === '--model') parsed.model = requireValue(args, ++index, arg)
    else if (arg === '--deepseek-base-url') parsed.deepseekBaseUrl = requireValue(args, ++index, arg)
    else if (arg === '--session-id') parsed.sessionId = requireValue(args, ++index, arg)
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
  }
  return parsed
}

async function resolveOptions(runtime: RuntimeModule, parsed: TuiOptions, env: NodeJS.ProcessEnv): Promise<any> {
  const settings = await runtime.loadRuntimeSettings({ cwd: parsed.cwd, env })
  const skills = await runtime.loadRuntimeSkills({
    cwd: parsed.cwd,
    env,
    skillDirs: settings.settings.skillDirs,
  })
  const mcp = await runtime.loadRuntimeMcpTools({
    cwd: parsed.cwd,
    env,
    servers: settings.settings.mcpServers,
  })
  const projectConfig = runtime.normalizeProjectConfig(settings.settings.project)
  projectConfig.ignore = withTuiDefaultIgnore(projectConfig.ignore)
  const projectInstructions = typeof runtime.loadProjectInstructions === 'function'
    ? await runtime.loadProjectInstructions({ cwd: parsed.cwd })
    : { sources: [] }
  return {
    ...parsed,
    sessionsDir:
      parsed.sessionsDir ??
      settings.settings.sessionsDir ??
      path.join(parsed.cwd, '.vigilon', 'sessions'),
    permissionMode: parsed.permissionMode ?? settings.settings.permissionMode ?? 'ask',
    maxTurns: parsed.maxTurns ?? settings.settings.maxTurns,
    model: parsed.model ?? settings.settings.model,
    deepseekBaseUrl: parsed.deepseekBaseUrl ?? settings.settings.deepseekBaseUrl,
    settings,
    skills,
    mcp,
    projectConfig,
    projectInstructions,
    preToolUseHooks: runtime.createSettingsPreToolUseHooks(settings.settings),
  }
}

function buildRuntimeProjectInstructionsGuidance(
  runtime: RuntimeModule,
  projectInstructions: unknown,
): string | undefined {
  if (typeof runtime.buildProjectInstructionsGuidance !== 'function') return undefined
  return runtime.buildProjectInstructionsGuidance(projectInstructions)
}

function discoverWorkspaceRoot(startCwd: string): string | undefined {
  let current = path.resolve(startCwd)
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function withTuiDefaultIgnore(ignore: readonly string[]): string[] {
  const defaults = ['.vigilon/sessions/**', '**/.vigilon/sessions/**']
  return [...ignore, ...defaults.filter(pattern => !ignore.includes(pattern))]
}

function createTuiPermissionGate(input: {
  runtime: RuntimeModule
  mode: string
  transcript: any
  reader: LineReader
  onEvent: (event: TuiRuntimeEvent) => void
}) {
  let currentMode = input.mode
  return {
    setMode(nextMode: string) {
      currentMode = nextMode
    },
    getMode() {
      return currentMode
    },
    async requestPermission(request: any) {
      let decision = input.runtime.decidePermission(currentMode, request)
      if (!decision.allowed) {
        input.onEvent({
          type: 'permission',
          lines: [
            `action: ${request.action}`,
            `risk: ${request.risk}`,
            `subject: ${request.subject}`,
            `reason: ${request.reason}`,
            'decision: [y] allow / [n] deny / [s] allow similar',
          ],
        })
        const raw = (await input.reader.question({
          kind: 'permission',
          title: 'Permission required',
          lines: [
            `action: ${request.action}`,
            `risk: ${request.risk}`,
            `subject: ${request.subject}`,
            `reason: ${request.reason}`,
          ],
          choices: [
            { key: '1', label: 'Allow', value: 'y', description: 'Allow this tool call once.' },
            { key: '2', label: 'Deny', value: 'n', description: 'Deny this tool call.' },
            { key: '3', label: 'Allow similar', value: 's', description: 'Promote this permission mode for similar calls.' },
          ],
        })).trim().toLowerCase()
        if (raw === 's' || raw === 'similar') {
          currentMode = request.action === 'write' || request.action === 'edit'
            ? 'accept-edits'
            : 'bypass-local'
          decision = {
            allowed: true,
            reason: `operator approved and promoted session permission mode to ${currentMode}`,
          }
        } else if (raw === 'y' || raw === 'yes') {
          decision = { allowed: true, reason: 'operator approved in TUI' }
        } else {
          decision = { allowed: false, reason: 'operator denied in TUI' }
        }
      }
      await input.transcript.append({
        type: 'permission',
        request,
        decision,
        timestamp: input.runtime.createTimestamp(),
      })
      return decision
    },
  }
}

function createTuiOperator(input: {
  reader: LineReader
  onEvent: (event: TuiRuntimeEvent) => void
}) {
  return {
    async askQuestions(questionInput: any) {
      const answers: Record<string, string> = {}
      for (const question of questionInput.questions ?? []) {
        input.onEvent({
          type: 'ask-user',
          lines: [
            `${question.header}: ${question.question}`,
            ...(question.options ?? []).map(
              (option: any, index: number) => `${index + 1}. ${option.label} - ${option.description}`,
            ),
          ],
        })
        const raw = (await input.reader.question({
          kind: 'question',
          title: `${question.header}: ${question.question}`,
          lines: [
            `${question.header}: ${question.question}`,
          ],
          choices: (question.options ?? []).map((option: any, index: number) => ({
            key: String(index + 1),
            label: String(option.label),
            value: String(option.label),
            description: typeof option.description === 'string' ? option.description : undefined,
          })),
        })).trim()
        const resolved = resolveAnswer(raw, question.options ?? [])
        if (!resolved) return null
        answers[question.question] = resolved
      }
      return {
        questions: questionInput.questions,
        answers,
        ...(questionInput.annotations ? { annotations: questionInput.annotations } : {}),
      }
    },
  }
}

async function approvePendingPlan(runtime: RuntimeModule, input: {
  resume: any
  transcript: any
  permissionMode: string
}) {
  const pendingPlan = input.resume.sessionState.pendingPlan?.trim()
  if (!pendingPlan || input.resume.sessionState.phase !== 'plan') {
    throw new Error('resume session has no pending plan to approve')
  }
  await input.transcript.append({
    type: 'session-state',
    phase: 'execute',
    permissionMode: input.permissionMode,
    prePlanPermissionMode: null,
    todos: input.resume.sessionState.todos.map((todo: any) => ({ ...todo })),
    approvedPlan: pendingPlan,
    pendingPlan: null,
    handoffReport: input.resume.sessionState.handoffReport
      ? {
          finalMessage: input.resume.sessionState.handoffReport.finalMessage,
          changes: [...input.resume.sessionState.handoffReport.changes],
          verified: [...input.resume.sessionState.handoffReport.verified],
          unverified: [...input.resume.sessionState.handoffReport.unverified],
          risks: [...input.resume.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [...input.resume.sessionState.verificationNotes],
    timestamp: runtime.createTimestamp(),
  })
}

async function emitRecentHookBlocks(
  runtime: RuntimeModule,
  transcript: any,
  onEvent: (event: TuiRuntimeEvent) => void,
) {
  const events = await transcript.readAll()
  const hook = [...events].reverse().find((event: any) => event.type === 'hook')
  if (!hook || hook.__tuiSeen) return
  hook.__tuiSeen = true
  onEvent({
    type: 'hook',
    lines: [
      `hook: ${hook.hookName}`,
      `tool: ${hook.toolCall?.name ?? 'unknown'}`,
      `decision: ${hook.decision?.outcome ?? 'unknown'}`,
      `reason: ${hook.decision?.reason ?? ''}`,
    ],
  })
}

function buildHandoff(result: any, transcriptPath: string): TuiHandoff {
  const currentTurnEvents = getCurrentTurnEvents(result.events)
  const currentTurnHandoff = currentTurnCalledResultReport(currentTurnEvents)
    ? result.report.handoffReport
    : undefined
  const finalMessage = result.finalMessage || currentTurnHandoff?.finalMessage || ''
  const changedFiles = currentTurnHandoff?.changes?.length
    ? currentTurnHandoff.changes
    : collectCurrentTurnFileChanges(currentTurnEvents)
  const verification = currentTurnHandoff?.verified?.length
    ? currentTurnHandoff.verified
    : []
  const missing = !finalMessage?.trim()
  return {
    status: result.report.status,
    finalMessage,
    changedFiles,
    verification,
    unverified: currentTurnHandoff?.unverified?.length
      ? currentTurnHandoff.unverified
      : currentTurnHandoff
        ? ['None']
        : ['No structured ResultReport was recorded.'],
    risks: currentTurnHandoff?.risks?.length
      ? currentTurnHandoff.risks
      : currentTurnHandoff
        ? ['None']
        : ['No structured ResultReport was recorded.'],
    todos: result.report.todos.map((todo: any) => `${todo.status}:${todo.content}`),
    transcriptPath,
    nextAction: result.report.status === 'completed'
      ? 'Review transcript or continue with /resume.'
      : 'Use /open then /resume to recover.',
    missing,
  }
}

function getCurrentTurnEvents(events: readonly any[]): readonly any[] {
  const lastUserIndex = findLastIndex(events, event => event?.type === 'user')
  return events.slice(Math.max(0, lastUserIndex))
}

function currentTurnCalledResultReport(events: readonly any[]): boolean {
  return events
    .some(event => event?.type === 'tool-call' && event.call?.name === 'ResultReport')
}

function collectCurrentTurnFileChanges(events: readonly any[]): string[] {
  const toolCallsById = new Map(
    events
      .filter(event => event?.type === 'tool-call')
      .map(event => [event.call?.id, event.call?.name]),
  )
  return events
    .filter(event => event?.type === 'tool-result')
    .flatMap(event => {
      const result = event.result
      const metadata = result?.metadata
      if (
        !result?.ok ||
        typeof metadata?.filePath !== 'string' ||
        (metadata.type !== 'create' && metadata.type !== 'update')
      ) {
        return []
      }
      const toolName = toolCallsById.get(result.toolCallId) ?? 'unknown'
      return [`${metadata.type} ${metadata.filePath} (${toolName})`]
    })
}

function findLastIndex<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index] as T)) return index
  }
  return -1
}

function resolveSessionSelector(selector: string, sessions: TuiSessionSummary[]): TuiSessionSummary | undefined {
  const byIndex = Number(selector)
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= sessions.length) {
    return sessions[byIndex - 1]
  }
  return sessions.find(session => session.sessionId === selector || session.sessionId.startsWith(selector))
}

function formatTranscriptEvent(event: any): string {
  if (event.type === 'user') return `user: ${truncate(event.content, 120)}`
  if (event.type === 'assistant') return `assistant: ${truncate(event.content, 120)}`
  if (event.type === 'tool-call') return `tool-call: ${event.call.name}`
  if (event.type === 'tool-result') return `tool-result: ${event.result.ok ? 'ok' : 'error'} ${truncate(event.result.content, 100)}`
  if (event.type === 'permission') return `permission: ${event.request.action} => ${event.decision.allowed ? 'allow' : 'deny'}`
  if (event.type === 'session-state') return `session-state: phase=${event.phase} todos=${event.todos?.length ?? 0}`
  if (event.type === 'compact-boundary') return `compact: ${truncate(event.summary, 100)}`
  if (event.type === 'hook') return `hook: ${event.hookName} => ${event.decision.outcome}`
  if (event.type === 'llm-response') return `llm-response: ${event.status} ${event.stopReason}`
  if (event.type === 'subagent-lifecycle') return `subagent: ${event.event.agentName} ${event.event.status}`
  return event.type
}

async function buildAgentView(runtime: RuntimeModule, resolved: any): Promise<TuiAgentView> {
  const catalog = await runtime.loadAgentCatalog({ cwd: resolved.cwd })
  const sessions = await runtime.listSessions({
    cwd: resolved.cwd,
    sessionsDir: resolved.sessionsDir,
  }) as TuiSessionSummary[]
  const tasks: TuiAgentTaskRow[] = []

  for (const session of sessions) {
    let snapshot: any
    try {
      snapshot = await runtime.resumeSessionById({
        sessionId: session.sessionId,
        cwd: resolved.cwd,
        sessionsDir: resolved.sessionsDir,
      })
    } catch {
      continue
    }
    tasks.push(...collectSessionSubagentTasks(session, snapshot.sessionState))
  }

  return {
    cwd: resolved.cwd,
    sourcePrecedence: catalog.precedence,
    definitions: catalog.entries.map((entry: any) => ({
      name: entry.definition.name,
      source: entry.definition.source,
      sourceScope: entry.definition.sourceScope,
      description: entry.definition.description,
      active: !entry.overriddenBy,
      overriddenBy: entry.overriddenBy,
      allowedTools: entry.definition.allowedTools,
      background: entry.definition.background === true,
      host: entry.definition.host ?? 'local',
    } satisfies TuiAgentDefinitionRow)),
    tasks,
  }
}

async function inspectAgentTask(
  runtime: RuntimeModule,
  resolved: any,
  sessionSelector: string,
  taskId: string,
): Promise<TuiAgentDetail | null> {
  const sessions = await runtime.listSessions({
    cwd: resolved.cwd,
    sessionsDir: resolved.sessionsDir,
  }) as TuiSessionSummary[]
  const session = resolveSessionSelector(sessionSelector, sessions)
  if (!session) return null
  const snapshot = await runtime.resumeSessionById({
    sessionId: session.sessionId,
    cwd: resolved.cwd,
    sessionsDir: resolved.sessionsDir,
  })
  const task = resolveSubagentTask(snapshot.sessionState, taskId)
  if (!task) return null
  const transcriptPath = task.transcriptPath
  const transcriptEvents = transcriptPath
    ? await runtime.readTranscriptFile(transcriptPath)
    : []
  const parentEvents = await runtime.readTranscriptFile(snapshot.transcriptPath)
  const permissionSummary = runtime.buildPermissionOriginSummary(transcriptEvents)
  return {
    parentSessionId: snapshot.sessionId,
    task: {
      ...task,
      sessionId: snapshot.sessionId,
    },
    transcriptPath,
    recentEvents: transcriptEvents.slice(-10).map((event: unknown) => formatTranscriptEvent(event)),
    permissionSummary,
    lifecycleEvents: parentEvents
      .filter((event: any) => event?.type === 'subagent-lifecycle' && event.event?.taskId === task.id)
      .slice(-12)
      .map((event: any) => formatSubagentLifecycleEvent(event.event)),
  }
}

async function stopAgentTask(
  runtime: RuntimeModule,
  resolved: any,
  taskManager: any,
  sessionSelector: string,
  taskId: string,
): Promise<TuiAgentDetail | null> {
  const sessions = await runtime.listSessions({
    cwd: resolved.cwd,
    sessionsDir: resolved.sessionsDir,
  }) as TuiSessionSummary[]
  const session = resolveSessionSelector(sessionSelector, sessions)
  if (!session) return null
  const snapshot = await runtime.resumeSessionById({
    sessionId: session.sessionId,
    cwd: resolved.cwd,
    sessionsDir: resolved.sessionsDir,
  })
  const task = resolveSubagentTask(snapshot.sessionState, taskId)
  if (!task) return null

  const stopped = await taskManager.stopTask(task.id)
  let message = stopped
    ? `Stopped live subagent task ${task.id} through the shared task manager.`
    : `No live task host is registered for ${task.id}; inspect/resume remains available from transcript state.`
  if (stopped) {
    await appendTuiTaskLifecycleSessionState(runtime, {
      snapshot,
      taskManager,
    })
  } else if (task.status === 'running') {
    const stdout = createStringWriter()
    const exitCode = await runtime.runCli(
      [
        'agents',
        'stop',
        snapshot.sessionId,
        task.id,
        '--cwd',
        resolved.cwd,
        ...(resolved.sessionsDir ? ['--sessions-dir', resolved.sessionsDir] : []),
      ],
      {
        stdout,
        stderr: { write: () => true },
        env: {},
      },
      {},
    )
    if (exitCode === 0) {
      const parsed = JSON.parse(stdout.text)
      message = String(parsed.message ?? `stop requested for subagent task ${task.id}`)
    }
  }
  const detail = await inspectAgentTask(runtime, resolved, snapshot.sessionId, task.id)
  return {
    ...(detail ?? {
      parentSessionId: snapshot.sessionId,
      task: {
        ...task,
        sessionId: snapshot.sessionId,
      },
      transcriptPath: task.transcriptPath,
      recentEvents: [],
      lifecycleEvents: [],
    }),
    stopResult: {
      ok: stopped,
      message,
    },
  }
}

async function appendTuiTaskLifecycleSessionState(runtime: RuntimeModule, input: {
  snapshot: any
  taskManager: any
}): Promise<void> {
  const sessionState = input.snapshot.sessionState
  const liveActiveTasks = input.taskManager.activeTasks
    .filter((task: any) => task.parentSessionId === input.snapshot.sessionId)
    .map((task: any) => ({ ...task }))
  const liveRetainedTasks = input.taskManager.retainedTasks
    .filter((task: any) => task.parentSessionId === input.snapshot.sessionId)
    .map((task: any) => ({ ...task }))
  const retainedIds = new Set(liveRetainedTasks.map((task: any) => task.id))
  const activeIds = new Set(liveActiveTasks.map((task: any) => task.id))
  const backgroundTasks = [
    ...sessionState.backgroundTasks.filter(
      (task: any) => !retainedIds.has(task.id) && !activeIds.has(task.id),
    ),
    ...liveActiveTasks,
  ]
  const retainedById = new Map<string, any>(
    (sessionState.retainedTasks ?? []).map((task: any) => [task.id, { ...task }]),
  )
  for (const task of liveRetainedTasks) retainedById.set(task.id, task)
  sessionState.backgroundTasks = backgroundTasks
  sessionState.retainedTasks = Array.from(retainedById.values())

  const transcript = new runtime.JsonlTranscriptStore({
    transcriptPath: input.snapshot.transcriptPath,
    sessionId: input.snapshot.sessionId,
  })
  await transcript.append({
    type: 'session-state',
    phase: sessionState.phase,
    permissionMode: sessionState.permissionMode,
    prePlanPermissionMode: sessionState.prePlanPermissionMode ?? null,
    todos: sessionState.todos.map((todo: any) => ({ ...todo })),
    approvedPlan: sessionState.approvedPlan ?? null,
    pendingPlan: sessionState.pendingPlan ?? null,
    handoffReport: sessionState.handoffReport
      ? {
          finalMessage: sessionState.handoffReport.finalMessage,
          changes: [...sessionState.handoffReport.changes],
          verified: [...sessionState.handoffReport.verified],
          unverified: [...sessionState.handoffReport.unverified],
          risks: [...sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [...sessionState.verificationNotes],
    backgroundTasks: sessionState.backgroundTasks.map((task: any) => ({ ...task })),
    retainedTasks: sessionState.retainedTasks.map((task: any) => ({ ...task })),
    discoveredToolNames: [...sessionState.discoveredToolNames],
    toolReferenceDeltas: [...sessionState.toolReferenceDeltas],
    mcpInstructions: [...sessionState.mcpInstructions],
    activeSkill: sessionState.activeSkill
      ? { ...sessionState.activeSkill }
      : null,
    memoryFreshness: sessionState.memoryFreshness ?? null,
    systemPrompt: sessionState.systemPrompt ?? null,
    toolSchema: sessionState.toolSchema ?? null,
    modelParams: sessionState.modelParams ?? null,
    timestamp: runtime.createTimestamp(),
  })
}

function collectSessionSubagentTasks(session: TuiSessionSummary, sessionState: any): TuiAgentTaskRow[] {
  return [
    ...(sessionState?.backgroundTasks ?? []),
    ...(sessionState?.retainedTasks ?? []),
  ]
    .filter((task: any) => task?.type === 'subagent')
    .map((task: any) => ({
      sessionId: session.sessionId,
      id: task.id,
      agentName: task.agentName,
      status: task.status ?? 'running',
      background: task.background === true,
      transcriptPath: task.transcriptPath,
      terminalReason: task.terminalReason,
      outputSummary: task.outputSummary,
      worktreeDiff: summarizeWorktreeDiff(task.worktreeDiff),
    } satisfies TuiAgentTaskRow))
}

function resolveSubagentTask(sessionState: any, taskId: string): TuiAgentTaskRow | null {
  const candidates = [
    ...(sessionState?.backgroundTasks ?? []),
    ...(sessionState?.retainedTasks ?? []),
  ].filter((task: any) => task?.type === 'subagent')
  const exact = candidates.find((task: any) => task.id === taskId)
  const task = exact ?? uniquePrefixMatch(candidates, taskId)
  if (!task) return null
  return {
    sessionId: '',
    id: task.id,
    agentName: task.agentName,
    status: task.status ?? 'running',
    background: task.background === true,
    transcriptPath: task.transcriptPath,
    terminalReason: task.terminalReason,
    outputSummary: task.outputSummary,
    worktreeDiff: summarizeWorktreeDiff(task.worktreeDiff),
  }
}

function summarizeWorktreeDiff(diff: any): TuiAgentTaskRow['worktreeDiff'] | undefined {
  if (!diff) return undefined
  return {
    status: diff.status,
    filesChanged: diff.filesChanged ?? 0,
    additions: diff.additions ?? 0,
    deletions: diff.deletions ?? 0,
    patchPath: diff.patchPath,
    changedFiles: Array.isArray(diff.changedFiles)
      ? diff.changedFiles.map((file: any) => String(file.path ?? file)).filter(Boolean)
      : undefined,
    sourceApply: diff.sourceApply
      ? {
          status: diff.sourceApply.status,
          filesChanged: diff.sourceApply.filesChanged ?? 0,
          appliedAt: diff.sourceApply.appliedAt,
          conflicts: diff.sourceApply.conflicts,
          error: diff.sourceApply.error,
        }
      : undefined,
  }
}

function uniquePrefixMatch(tasks: any[], taskId: string): any | null {
  const matches = tasks.filter(task => String(task.id).startsWith(taskId))
  if (matches.length > 1) throw new Error(`subagent task selector is ambiguous: ${taskId}`)
  return matches[0] ?? null
}

function createStringWriter(): Pick<NodeJS.WriteStream, 'write'> & { text: string } {
  return {
    text: '',
    write(chunk: string | Uint8Array) {
      this.text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    },
  }
}

function formatSubagentLifecycleEvent(event: any): string {
  return [
    event.status,
    event.agentName ? `agent=${event.agentName}` : '',
    event.taskId ? `task=${event.taskId}` : '',
    event.toolName ? `tool=${event.toolName}` : '',
    event.summary ? truncate(event.summary, 100) : '',
    event.finalMessage ? truncate(event.finalMessage, 100) : '',
  ].filter(Boolean).join(' ')
}

function summarizeToolInput(name: string, input: unknown): string {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  if (typeof value.file_path === 'string') return value.file_path
  if (typeof value.path === 'string') return value.path
  if (typeof value.pattern === 'string') return String(value.pattern)
  if (typeof value.command === 'string') return String(value.command)
  if (name === 'ResultReport') return 'recording final handoff'
  return truncate(JSON.stringify(input), 140)
}

function summarizeToolResult(name: string, result: any): string {
  if (name === 'ResultReport' && result.metadata?.handoffReport) return 'handoff report recorded'
  if (name === 'Read' && result.metadata?.type === 'file_unchanged') {
    return `unchanged ${result.metadata.filePath}; earlier Read result is still current`
  }
  if (result.metadata?.filePath) return `${result.metadata.type ?? 'file'} ${result.metadata.filePath}`
  return truncate(result.content, 140)
}

function resolveAnswer(raw: string, options: Array<{ label: string }>): string | null {
  if (!raw) return null
  const byIndex = Number(raw)
  if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= options.length) {
    return options[byIndex - 1]?.label ?? null
  }
  return options.find(option => option.label.toLowerCase() === raw.toLowerCase())?.label ?? raw
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index]
  if (!value || value.startsWith('-')) throw new Error(`${option} requires a value`)
  return value
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, got: ${value}`)
  return parsed
}

function truncate(value: string | undefined, maxChars: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`
}
