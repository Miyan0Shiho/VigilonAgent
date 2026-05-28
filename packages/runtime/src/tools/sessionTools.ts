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
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { createTimestamp } from '../runtime/transcript.js'
import { addTask, updateTask } from '../runtime/taskLedger.js'

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
	      origin: withToolPermissionOrigin(context.permissionOrigin, 'ExitPlanMode'),
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
    retainedTasks: [...(sessionState.retainedTasks ?? [])],
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

// ---------------------------------------------------------------------------
// Goal tools — matches Codex /goal + Claude Code /goal model
// Model can create and mark complete; pause/resume are user-controlled.
// ---------------------------------------------------------------------------

export const CreateGoalTool: Tool = {
  name: 'create_goal',
  description:
    'Creates a persistent goal that the agent will work toward autonomously ' +
    'across turns until complete or budget exhausted. Fails if a goal already exists.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: 'Clear, measurable goal description' },
      token_budget: { type: 'number', description: 'Optional max tokens for this goal' },
    },
    required: ['objective'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const state = context.sessionState
    if (!state) return failed('Session state unavailable.')

    const { objective, token_budget } = input as { objective: string; token_budget?: number }
    if (!objective?.trim()) return failed('create_goal requires a non-empty objective.')

    if (state.goal && state.goal.status === 'active') {
      return failed(
        `A goal is already active: "${state.goal.objective}". ` +
        'Pause or complete it before creating a new one.',
      )
    }

    const now = new Date().toISOString()
    state.goal = {
      objective: objective.trim(),
      tokenBudget: token_budget,
      tokensUsed: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    // Persist to task ledger for cross-session durability
    addTask(context.cwd, {
      goal: objective.trim(),
      status: 'running',
      maxTokens: token_budget,
    }).then(task => {
      state.goal!.ledgerTaskId = task.id
    }).catch(() => { /* best-effort, ledger is non-critical */ })

    const budgetMsg = token_budget ? ` (budget: ${token_budget.toLocaleString()} tokens)` : ''
    return ok(`Goal created: "${objective}"${budgetMsg}. The agent will continue working until complete or budget exhausted.`)
  },
}

export const GetGoalTool: Tool = {
  name: 'get_goal',
  description: 'Returns the current goal, if any.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async invoke(_input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const state = context.sessionState
    if (!state) return failed('Session state unavailable.')
    const goal = state.goal
    if (!goal) return ok('No active goal.')
    const pct = goal.tokenBudget ? ((goal.tokensUsed / goal.tokenBudget) * 100).toFixed(1) : null
    const usage = pct ? ` (${pct}% of budget used)` : ''
    return ok(
      [
        `Goal: "${goal.objective}"`,
        `Status: ${goal.status}`,
        `Tokens used: ${goal.tokensUsed.toLocaleString()}${usage}`,
        `Created: ${goal.createdAt}`,
      ].join('\n'),
      { goal },
    )
  },
}

export const UpdateGoalTool: Tool = {
  name: 'update_goal',
  description: 'Updates the goal status. The model can only mark a goal complete.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['complete'], description: 'Only "complete" is allowed' },
    },
    required: ['status'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const state = context.sessionState
    if (!state) return failed('Session state unavailable.')
    const { status } = input as { status: string }
    if (status !== 'complete') {
      return failed('update_goal can only mark a goal complete. Use /goal pause in the CLI to pause.')
    }
    const goal = state.goal
    if (!goal || goal.status !== 'active') {
      return failed('No active goal to complete.')
    }
    goal.status = 'complete'
    goal.updatedAt = new Date().toISOString()

    // Update task ledger
    if (goal.ledgerTaskId) {
      updateTask(context.cwd, goal.ledgerTaskId, { status: 'done' })
        .catch(() => { /* best-effort */ })
    }

    return ok(`Goal complete: "${goal.objective}" (${goal.tokensUsed.toLocaleString()} tokens used)`)
  },
}

// ---------------------------------------------------------------------------
// Self-verification tool — Generator ≠ Evaluator pattern
// Spawns an independent evaluator subagent to review the current work.
// ---------------------------------------------------------------------------

export const SelfVerifyTool: Tool = {
  name: 'self_verify',
  description:
    'Spawns an independent evaluator subagent to review the current work. ' +
    'The evaluator checks for bugs, missing edge cases, style issues, and ' +
    'correctness. Always use this before claiming a task is complete.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      context: {
        type: 'string',
        description: 'What was done — file paths changed, task completed, tests run.',
      },
      focus: {
        type: 'string',
        description: 'Specific areas to check (e.g. "error handling", "edge cases", "performance").',
      },
    },
    required: ['context'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { context: taskContext, focus } = input as { context: string; focus?: string }
    if (!taskContext?.trim()) return failed('self_verify requires a context description.')

    if (!context.runSubagent) {
      return ok(
        'Self-verification unavailable (no subagent runner configured).\n' +
        'Manual review checklist:\n' +
        '- Are all changed files syntactically correct?\n' +
        '- Do edge cases have test coverage?\n' +
        '- Is error handling explicit (no silent failures)?\n' +
        '- Are there any leftover debug logs or TODO comments?',
      )
    }

    const focusLine = focus ? `\nFocus especially on: ${focus}` : ''
    const task = [
      'You are an independent code reviewer. Your ONLY job is to find problems.',
      'Do NOT suggest improvements that are merely cosmetic.',
      'Review this work critically:',
      '',
      taskContext,
      focusLine,
      '',
      'Report your findings as:',
      '1. Bugs or potential bugs (severity: critical/high/medium/low)',
      '2. Missing edge cases',
      '3. Style or convention issues',
      'If you find NO issues, say "No issues found." explicitly.',
    ].join('\n')

    const result = await context.runSubagent({
      definition: {
        name: 'evaluator',
        description: 'Independent code reviewer. Finds problems, not praise.',
        systemPrompt: 'You are an independent code reviewer. Find problems. Be specific.',
        allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
        maxTurns: 5,
        source: 'built-in' as const,
      },
      task,
      cwd: context.cwd,
      parentAgentId: 'main',
    })

    if (result.status === 'completed') {
      const msg = result.finalMessage || 'Evaluator completed.'
      return ok(msg, {
        evaluatorResult: msg,
        hasIssues: !msg.includes('No issues found'),
      })
    }
    return failed(`Evaluator failed: ${result.finalMessage || 'unknown error'}`)
  },
}
