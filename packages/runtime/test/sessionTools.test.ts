import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCoreToolRegistry,
  createMutablePermissionGate,
  createVigilonAgentRuntime,
  EnterPlanModeTool,
  ExitPlanModeTool,
  InMemoryTranscriptStore,
  ResultReportTool,
  TodoWriteTool,
  WriteTool,
  type ModelClient,
  type RuntimeSessionState,
  type ToolUseContext,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    tempRoots.map(root => rm(root, { recursive: true, force: true })),
  )
  tempRoots.length = 0
})

describe('session tools', () => {
  it('core registry includes task and plan tools before mutating execution tools', () => {
    expect(createCoreToolRegistry().list().map(tool => tool.name)).toEqual([
      'Read',
      'Glob',
      'Grep',
      'ToolSearch',
      'LSP',
      'TaskStop',
      'Agent',
      'Config',
      'WebFetch',
      'AskUserQuestion',
      'Notebook',
      'TodoWrite',
      'EnterPlanMode',
      'ExitPlanMode',
      'Write',
      'Edit',
      'Bash',
      'ResultReport',
    ])
  })

  it('TodoWrite stores a session checklist and clears all-completed lists', async () => {
    const context = createContext(await createFixture({}))

    const active = await TodoWriteTool.invoke(
      {
        todos: [
          {
            id: '1',
            content: 'Inspect code',
            activeForm: 'Inspecting code',
            status: 'in_progress',
          },
          { id: '2', content: 'Run tests', status: 'pending' },
        ],
      },
      context,
    )
    expect(active.ok).toBe(true)
    expect(context.sessionState?.todos).toHaveLength(2)

    const invalid = await TodoWriteTool.invoke(
      {
        todos: [
          { id: '1', content: 'A', status: 'in_progress' },
          { id: '2', content: 'B', status: 'in_progress' },
        ],
      },
      context,
    )
    const complete = await TodoWriteTool.invoke(
      {
        todos: [
          { id: '1', content: 'Inspect code', status: 'completed' },
          { id: '2', content: 'Apply change', status: 'completed' },
          { id: '3', content: 'Ship result', status: 'completed' },
        ],
      },
      context,
    )

    expect(invalid.ok).toBe(false)
    expect(invalid.content).toContain('At most one todo')
    expect(complete.ok).toBe(true)
    expect(complete.content).toContain('verification evidence')
    expect(context.sessionState?.todos).toEqual([])
    expect((await context.transcript.readAll()).map(event => event.type)).toContain(
      'session-state',
    )
  })

  it('EnterPlanMode blocks writes until ExitPlanMode restores execution permissions', async () => {
    const cwd = await createFixture({ 'src/app.ts': 'old\n' })
    const context = createContext(cwd, { permissionMode: 'bypass-local' })

    const entered = await EnterPlanModeTool.invoke({ reason: 'large change' }, context)
    const blockedWrite = await WriteTool.invoke(
      { file_path: 'src/plan-blocked.ts', content: 'nope\n' },
      context,
    )
    const exited = await ExitPlanModeTool.invoke(
      { plan: '1. Edit files\n2. Run tests' },
      context,
    )
    const allowedWrite = await WriteTool.invoke(
      { file_path: 'src/after-plan.ts', content: 'ok\n' },
      context,
    )

    expect(entered.ok).toBe(true)
    expect(context.sessionState?.phase).toBe('execute')
    expect(blockedWrite.ok).toBe(false)
    expect(blockedWrite.content).toContain('read-only mode blocks')
    expect(exited.ok).toBe(true)
    expect(exited.metadata).toMatchObject({ permissionMode: 'bypass-local' })
    expect(allowedWrite.ok).toBe(true)
    expect(await readFile(path.join(cwd, 'src/after-plan.ts'), 'utf8')).toBe('ok\n')
  })

  it('ExitPlanMode waits for plan approval in non-auto-approved permission modes', async () => {
    const cwd = await createFixture({})
    const context = createContext(cwd, { permissionMode: 'ask' })

    await EnterPlanModeTool.invoke({ reason: 'needs design' }, context)
    const exited = await ExitPlanModeTool.invoke(
      { plan: '1. Inspect\n2. Edit\n3. Verify' },
      context,
    )

    expect(exited.ok).toBe(false)
    expect(exited.content).toContain('Plan approval is required')
    expect(exited.metadata).toMatchObject({
      phase: 'plan',
      awaitingApproval: true,
      plan: '1. Inspect\n2. Edit\n3. Verify',
    })
    expect(context.sessionState?.phase).toBe('plan')
    expect(context.sessionState?.permissionMode).toBe('read-only')
    expect(context.sessionState?.pendingPlan).toBe('1. Inspect\n2. Edit\n3. Verify')
    expect(
      (await context.transcript.readAll()).filter(event => event.type === 'permission'),
    ).toHaveLength(1)
    expect((await context.transcript.readAll()).at(-1)).toMatchObject({
      type: 'session-state',
      phase: 'plan',
      pendingPlan: '1. Inspect\n2. Edit\n3. Verify',
    })
  })

  it('ResultReport records verification notes and runtime report exposes them', async () => {
    const cwd = await createFixture({})
    const modelClient: ModelClient = {
      id: 'fake',
      async createMessage(request) {
        const hasReport = request.messages.some(
          message =>
            message.type === 'tool-result' &&
            message.result.toolCallId === 'report_1',
        )
        return hasReport
          ? { content: 'final', toolCalls: [], stopReason: 'end_turn' }
          : {
              content: '',
              toolCalls: [
                {
                  id: 'report_1',
                  name: 'ResultReport',
                  input: {
                    final_message: 'done',
                    changes: ['Updated runtime report handoff fields'],
                    verification_notes: ['pnpm phase1:baseline passed'],
                    unverified: ['None'],
                    risks: ['None'],
                  },
                },
              ],
              stopReason: 'tool_use',
            }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      permissionMode: 'bypass-local',
    })

    let report
    for await (const event of runtime.runTurn({
      prompt: 'finish',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') report = event.result.report
    }

    expect(report).toMatchObject({
      status: 'completed',
      finalMessage: 'final',
      verificationNotes: ['pnpm phase1:baseline passed'],
      handoffReport: {
        finalMessage: 'done',
        changes: ['Updated runtime report handoff fields'],
        verified: ['pnpm phase1:baseline passed'],
        unverified: ['None'],
        risks: ['None'],
      },
    })
  })

  it('ResultReport requires explicit changes, verification, unverified work, and risks', async () => {
    const cwd = await createFixture({})
    const context = createContext(cwd, { permissionMode: 'bypass-local' })

    const incomplete = await ResultReportTool.invoke(
      {
        final_message: 'done',
        verification_notes: ['pnpm test'],
      },
      context,
    )
    const complete = await ResultReportTool.invoke(
      {
        final_message: 'done',
        changes: ['No code changes'],
        verification_notes: ['pnpm test'],
        unverified: ['None'],
        risks: ['None'],
      },
      context,
    )

    expect(incomplete.ok).toBe(false)
    expect(incomplete.content).toContain('changes')
    expect(incomplete.content).toContain('unverified')
    expect(incomplete.content).toContain('risks')
    expect(complete.ok).toBe(true)
    expect(context.sessionState?.handoffReport).toMatchObject({
      changes: ['No code changes'],
      verified: ['pnpm test'],
      unverified: ['None'],
      risks: ['None'],
    })
  })
})

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-runtime-session-'))
  tempRoots.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  return root
}

function createContext(
  cwd: string,
  options: { permissionMode?: 'read-only' | 'ask' | 'accept-edits' | 'bypass-local' } = {},
): ToolUseContext {
  const transcript = new InMemoryTranscriptStore()
  const permissionMode = options.permissionMode ?? 'ask'
  const sessionState: RuntimeSessionState = {
    phase: 'execute',
    permissionMode,
    todos: [],
    verificationNotes: [],
  }
  return {
    cwd,
    abortSignal: new AbortController().signal,
    transcript,
    permissionGate: createMutablePermissionGate({ mode: permissionMode, transcript }),
    sessionState,
    readFileState: new Map(),
  }
}
