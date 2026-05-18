import type {
  PermissionGate,
  PermissionMode,
  RuntimeSessionState,
  TodoItem,
  TodoStatus,
  Tool,
  ToolResult,
  ToolUseContext,
} from '../runtime/contracts.js'
import { createTimestamp } from '../runtime/transcript.js'

type TodoWriteInput = {
  todos?: TodoItem[]
}

type EnterPlanModeInput = {
  reason?: string
}

type ExitPlanModeInput = {
  plan?: string
}

type ResultReportInput = {
  final_message?: string
  changes?: string[]
  verification_notes?: string[]
  unverified?: string[]
  risks?: string[]
}

export const TodoWriteTool: Tool = {
  name: 'TodoWrite',
  description:
    'Updates the session-scoped task checklist with pending, in_progress, and completed items.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description:
          'Complete replacement list of todos. Exactly one item should be in_progress unless all work is completed.',
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseTodoWriteInput(input)
    const sessionState = requireSessionState(context)
    if (!parsed.todos) return failed('TodoWrite requires todos')
    const validation = validateTodos(parsed.todos)
    if (validation) return failed(validation)

    const allDone =
      parsed.todos.length > 0 &&
      parsed.todos.every(todo => todo.status === 'completed')
    sessionState.todos = allDone ? [] : parsed.todos.map(todo => ({ ...todo }))
    await appendSessionState(context, sessionState)

    const reminder =
      allDone && parsed.todos.length >= 3 && !hasVerificationTodo(parsed.todos)
        ? '\n\nAll todos are complete. Add verification evidence before final handoff.'
        : ''

    return ok(`Updated ${parsed.todos.length} todos.${reminder}`, {
      oldTodos: [],
      newTodos: parsed.todos,
      storedTodos: sessionState.todos,
    })
  },
}

export const EnterPlanModeTool: Tool = {
  name: 'EnterPlanMode',
  description:
    'Transitions the session into read-only planning mode before implementation.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string' },
    },
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseEnterPlanModeInput(input)
    const sessionState = requireSessionState(context)
    if (sessionState.phase === 'plan') {
      return ok('Already in plan mode.', {
        phase: sessionState.phase,
      })
    }

    sessionState.phase = 'plan'
    sessionState.prePlanPermissionMode = sessionState.permissionMode
    sessionState.permissionMode = 'read-only'
    setPermissionMode(context.permissionGate, 'read-only')
    await appendSessionState(context, sessionState)

    return ok(
      [
        'Entered plan mode.',
        'Explore and design only; implementation writes are blocked until ExitPlanMode approves a plan.',
        parsed.reason ? `Reason: ${parsed.reason}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      {
        phase: 'plan',
        prePlanPermissionMode: sessionState.prePlanPermissionMode,
      },
    )
  },
}

export const ExitPlanModeTool: Tool = {
  name: 'ExitPlanMode',
  description:
    'Submits an implementation plan and returns the session from plan mode to execution mode.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      plan: { type: 'string' },
    },
    required: ['plan'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseExitPlanModeInput(input)
    const sessionState = requireSessionState(context)
    if (sessionState.phase !== 'plan') {
      return failed('ExitPlanMode can only be used while the session is in plan mode.')
    }
    if (!parsed.plan?.trim()) {
      return failed('ExitPlanMode requires a non-empty plan.')
    }

    const restoredMode = sessionState.prePlanPermissionMode ?? 'ask'
    setPermissionMode(context.permissionGate, restoredMode)
    const approval = await context.permissionGate.requestPermission({
      action: 'plan-approval',
      subject: 'Exit plan mode',
      risk: 'medium',
      reason: 'Approve implementation plan and return to execution mode',
    })
    if (!approval.allowed) {
      setPermissionMode(context.permissionGate, 'read-only')
      sessionState.pendingPlan = parsed.plan
      await appendSessionState(context, sessionState)
      return failed(
        [
          'Plan approval is required before leaving plan mode.',
          approval.reason,
          '',
          parsed.plan,
        ].join('\n'),
        {
          phase: 'plan',
          awaitingApproval: true,
          plan: parsed.plan,
        },
      )
    }

    sessionState.phase = 'execute'
    sessionState.permissionMode = restoredMode
    sessionState.approvedPlan = parsed.plan
    sessionState.pendingPlan = undefined
    sessionState.prePlanPermissionMode = undefined
    setPermissionMode(context.permissionGate, restoredMode)
    await appendSessionState(context, sessionState)

    return ok(`Plan approved for execution.\n\n${parsed.plan}`, {
      phase: 'execute',
      approvedPlan: parsed.plan,
      permissionMode: restoredMode,
    })
  },
}

export const ResultReportTool: Tool = {
  name: 'ResultReport',
  description:
    'Records the final handoff report with changes, verification, unverified work, and risks.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      final_message: { type: 'string' },
      changes: {
        type: 'array',
        description: 'Concrete changes made. If none, explicitly say none.',
      },
      verification_notes: {
        type: 'array',
        description: 'Verification commands or evidence. If none, explicitly say none.',
      },
      unverified: {
        type: 'array',
        description: 'Known unverified items. If none, explicitly say none.',
      },
      risks: {
        type: 'array',
        description: 'Remaining risks or caveats. If none, explicitly say none.',
      },
    },
    required: ['final_message', 'changes', 'verification_notes', 'unverified', 'risks'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseResultReportInput(input)
    const sessionState = requireSessionState(context)
    const validation = validateResultReport(parsed)
    if (validation) return failed(validation)

    sessionState.verificationNotes = parsed.verification_notes ?? []
    sessionState.handoffReport = {
      finalMessage: parsed.final_message ?? '',
      changes: parsed.changes ?? [],
      verified: parsed.verification_notes ?? [],
      unverified: parsed.unverified ?? [],
      risks: parsed.risks ?? [],
    }
    await appendSessionState(context, sessionState)

    return ok(parsed.final_message ?? 'Result report recorded.', {
      handoffReport: sessionState.handoffReport,
      verificationNotes: sessionState.verificationNotes,
      todos: sessionState.todos,
      approvedPlan: sessionState.approvedPlan,
    })
  },
}

function validateTodos(todos: TodoItem[]): string | null {
  const ids = new Set<string>()
  let inProgress = 0
  for (const todo of todos) {
    if (!todo.id.trim()) return 'Every todo needs an id.'
    if (ids.has(todo.id)) return `Duplicate todo id: ${todo.id}`
    ids.add(todo.id)
    if (!todo.content.trim()) return `Todo ${todo.id} needs content.`
    if (!isTodoStatus(todo.status)) {
      return `Todo ${todo.id} has invalid status: ${String(todo.status)}`
    }
    if (todo.status === 'in_progress') inProgress += 1
  }
  const allDone = todos.length > 0 && todos.every(todo => todo.status === 'completed')
  if (!allDone && inProgress > 1) {
    return 'At most one todo can be in_progress.'
  }
  return null
}

function hasVerificationTodo(todos: TodoItem[]): boolean {
  return todos.some(todo => /verif|test|验证|测试/i.test(todo.content))
}

function requireSessionState(context: ToolUseContext): RuntimeSessionState {
  if (!context.sessionState) {
    throw new Error('ToolUseContext.sessionState is required for session tools')
  }
  return context.sessionState
}

async function appendSessionState(
  context: ToolUseContext,
  sessionState: RuntimeSessionState,
): Promise<void> {
  await context.transcript.append({
    type: 'session-state',
    phase: sessionState.phase,
    permissionMode: sessionState.permissionMode,
    prePlanPermissionMode: sessionState.prePlanPermissionMode ?? null,
    todos: sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: sessionState.approvedPlan ?? null,
    pendingPlan: sessionState.pendingPlan ?? null,
    handoffReport: sessionState.handoffReport
      ? cloneHandoffReport(sessionState.handoffReport)
      : null,
    verificationNotes: [...sessionState.verificationNotes],
    backgroundTasks: [...(sessionState.backgroundTasks ?? [])],
    discoveredToolNames: [...(sessionState.discoveredToolNames ?? [])],
    mcpInstructions: [...(sessionState.mcpInstructions ?? [])],
    memoryFreshness: sessionState.memoryFreshness ?? null,
    timestamp: createTimestamp(),
  })
}

function cloneHandoffReport(
  report: NonNullable<RuntimeSessionState['handoffReport']>,
): NonNullable<RuntimeSessionState['handoffReport']> {
  return {
    finalMessage: report.finalMessage,
    changes: [...report.changes],
    verified: [...report.verified],
    unverified: [...report.unverified],
    risks: [...report.risks],
  }
}

function setPermissionMode(
  permissionGate: PermissionGate,
  mode: PermissionMode,
): void {
  if ('setMode' in permissionGate && typeof permissionGate.setMode === 'function') {
    permissionGate.setMode(mode)
  }
}

function parseTodoWriteInput(input: unknown): TodoWriteInput {
  if (!input || typeof input !== 'object') return {}
  const todos = (input as Record<string, unknown>).todos
  return {
    todos: Array.isArray(todos)
      ? todos
          .map(todo => normalizeTodo(todo))
          .filter((todo): todo is TodoItem => todo !== null)
      : undefined,
  }
}

function normalizeTodo(todo: unknown): TodoItem | null {
  if (!todo || typeof todo !== 'object') return null
  const value = todo as Record<string, unknown>
  return {
    id: typeof value.id === 'string' ? value.id : '',
    content: typeof value.content === 'string' ? value.content : '',
    status: isTodoStatus(value.status) ? value.status : (value.status as TodoStatus),
    activeForm:
      typeof value.activeForm === 'string' ? value.activeForm : undefined,
  }
}

function isTodoStatus(status: unknown): status is TodoStatus {
  return status === 'pending' || status === 'in_progress' || status === 'completed'
}

function parseEnterPlanModeInput(input: unknown): EnterPlanModeInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    reason: typeof value.reason === 'string' ? value.reason : undefined,
  }
}

function parseExitPlanModeInput(input: unknown): ExitPlanModeInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    plan: typeof value.plan === 'string' ? value.plan : undefined,
  }
}

function parseResultReportInput(input: unknown): ResultReportInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    final_message:
      typeof value.final_message === 'string' ? value.final_message : undefined,
    changes: parseStringArray(value.changes),
    verification_notes: parseStringArray(value.verification_notes),
    unverified: parseStringArray(value.unverified),
    risks: parseStringArray(value.risks),
  }
}

function validateResultReport(input: ResultReportInput): string | null {
  if (!input.final_message?.trim()) {
    return 'ResultReport requires final_message.'
  }
  const missing = [
    ['changes', input.changes],
    ['verification_notes', input.verification_notes],
    ['unverified', input.unverified],
    ['risks', input.risks],
  ]
    .filter(([, value]) => !hasExplicitEntry(value as string[] | undefined))
    .map(([field]) => field)
  if (missing.length > 0) {
    return `ResultReport requires explicit non-empty entries for: ${missing.join(', ')}. Use an explicit "None" entry when nothing applies.`
  }
  return null
}

function hasExplicitEntry(value: string[] | undefined): boolean {
  return Array.isArray(value) && value.some(item => item.trim().length > 0)
}

function parseStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
}

function failed(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: false, content, metadata }
}
