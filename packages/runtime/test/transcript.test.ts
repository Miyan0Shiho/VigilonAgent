import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCoreToolRegistry,
  compactTranscript,
  createVigilonAgentRuntime,
  JsonlTranscriptStore,
  listSessions,
  readTranscriptFile,
  restoreSessionStateFromEvents,
  resumeSessionFromTranscript,
  type ModelClient,
  type TranscriptEvent,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('transcript persistence', () => {
  it('round-trips JSONL events and lists sessions for the active project', async () => {
    const cwd = await createTempRoot('vigilon-transcript-project-')
    const sessionsDir = await createTempRoot('vigilon-transcript-sessions-')
    const store = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'session-a',
    })

    await store.append({
      type: 'user',
      content: 'hello',
      timestamp: '2026-05-17T00:00:00.000Z',
    })
    await store.append({
      type: 'assistant',
      content: 'world',
      timestamp: '2026-05-17T00:00:01.000Z',
    })

    expect(await readTranscriptFile(store.transcriptPath)).toEqual([
      {
        type: 'user',
        content: 'hello',
        timestamp: '2026-05-17T00:00:00.000Z',
      },
      {
        type: 'assistant',
        content: 'world',
        timestamp: '2026-05-17T00:00:01.000Z',
      },
    ])
    expect(await listSessions({ cwd, sessionsDir })).toMatchObject([
      {
        sessionId: 'session-a',
        eventCount: 2,
        status: 'recoverable',
        title: 'hello',
        firstUserMessage: 'hello',
        finalMessage: 'world',
      },
    ])
  })

  it('derives workbench-facing session summary fields from transcript state', async () => {
    const cwd = await createTempRoot('vigilon-transcript-summary-project-')
    const sessionsDir = await createTempRoot('vigilon-transcript-summary-sessions-')
    const store = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'plan-waiting',
    })

    await store.append({
      type: 'user',
      content: 'Plan the runtime packaging work',
      timestamp: '2026-05-18T00:00:00.000Z',
    })
    await store.append({
      type: 'session-state',
      phase: 'plan',
      permissionMode: 'read-only',
      prePlanPermissionMode: 'accept-edits',
      todos: [
        { id: 'spec', content: 'Write plan', status: 'completed' },
        { id: 'verify', content: 'Run checks', status: 'pending' },
      ],
      pendingPlan: '1. Package\n2. Verify',
      verificationNotes: ['pnpm typecheck'],
      timestamp: '2026-05-18T00:00:01.000Z',
    })

    expect(await listSessions({ cwd, sessionsDir })).toMatchObject([
      {
        sessionId: 'plan-waiting',
        status: 'waiting_approval',
        pendingPlan: '1. Package\n2. Verify',
        verificationCount: 1,
        completedTodoCount: 1,
        remainingTodoCount: 1,
      },
    ])
  })

  it('restores task, plan, permission, and verification state from transcript events', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'tool-call',
        call: {
          id: 'todo-1',
          name: 'TodoWrite',
          input: {
            todos: [
              { id: 'inspect', content: 'Inspect code', status: 'completed' },
              { id: 'test', content: 'Run tests', status: 'completed' },
            ],
          },
        },
        timestamp: '2026-05-17T00:00:00.000Z',
      },
      {
        type: 'session-state',
        phase: 'plan',
        permissionMode: 'read-only',
        prePlanPermissionMode: 'bypass-local',
        todos: [{ id: 'plan', content: 'Write plan', status: 'in_progress' }],
        pendingPlan: '1. Inspect\n2. Edit',
        handoffReport: {
          finalMessage: 'handoff',
          changes: ['No code changes'],
          verified: ['pnpm phase1:baseline passed'],
          unverified: ['None'],
          risks: ['None'],
        },
        timestamp: '2026-05-17T00:00:01.000Z',
      },
      {
        type: 'tool-call',
        call: {
          id: 'report-1',
          name: 'ResultReport',
          input: { verification_notes: ['pnpm phase1:baseline passed'] },
        },
        timestamp: '2026-05-17T00:00:02.000Z',
      },
    ]

    expect(restoreSessionStateFromEvents(events)).toMatchObject({
      phase: 'plan',
      permissionMode: 'read-only',
      prePlanPermissionMode: 'bypass-local',
      todos: [{ id: 'plan', content: 'Write plan', status: 'in_progress' }],
      pendingPlan: '1. Inspect\n2. Edit',
      handoffReport: {
        finalMessage: 'handoff',
        changes: ['No code changes'],
        verified: ['pnpm phase1:baseline passed'],
        unverified: ['None'],
        risks: ['None'],
      },
      verificationNotes: ['pnpm phase1:baseline passed'],
    })
  })

  it('does not restore a blocked ExitPlanMode tool-call as approved execution', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'session-state',
        phase: 'plan',
        permissionMode: 'read-only',
        prePlanPermissionMode: 'ask',
        pendingPlan: '1. Inspect\n2. Edit',
        timestamp: '2026-05-17T00:00:00.000Z',
      },
      {
        type: 'tool-call',
        call: {
          id: 'exit-plan',
          name: 'ExitPlanMode',
          input: { plan: '1. Inspect\n2. Edit' },
        },
        timestamp: '2026-05-17T00:00:01.000Z',
      },
      {
        type: 'tool-result',
        result: {
          toolCallId: 'exit-plan',
          ok: false,
          content: 'Plan approval is required before leaving plan mode.',
          metadata: {
            awaitingApproval: true,
            plan: '1. Inspect\n2. Edit',
          },
        },
        timestamp: '2026-05-17T00:00:02.000Z',
      },
    ]

    const state = restoreSessionStateFromEvents(events)
    expect(state).toMatchObject({
      phase: 'plan',
      permissionMode: 'read-only',
      prePlanPermissionMode: 'ask',
      pendingPlan: '1. Inspect\n2. Edit',
    })
    expect(state.approvedPlan).toBeUndefined()
  })

  it('resumes a runtime turn with prior transcript and session state', async () => {
    const cwd = await createTempRoot('vigilon-transcript-runtime-')
    const transcriptPath = path.join(cwd, 'sessions', 'resume-session.jsonl')
    await mkdir(path.dirname(transcriptPath), { recursive: true })

    const firstStore = new JsonlTranscriptStore({
      transcriptPath,
      sessionId: 'resume-session',
    })
    const firstModel: ModelClient = {
      id: 'first-model',
      async createMessage(request) {
        const hasTodoResult = request.messages.some(
          event => event.type === 'tool-result' && event.result.toolCallId === 'todo-1',
        )
        return hasTodoResult
          ? { content: 'first done', toolCalls: [], stopReason: 'end_turn' }
          : {
              content: '',
              toolCalls: [
                {
                  id: 'todo-1',
                  name: 'TodoWrite',
                  input: {
                    todos: [
                      {
                        id: 'resume',
                        content: 'Keep resumed state',
                        status: 'in_progress',
                      },
                    ],
                  },
                },
              ],
              stopReason: 'tool_use',
            }
      },
    }
    await drainRuntime(
      createVigilonAgentRuntime({
        modelClient: firstModel,
        tools: createCoreToolRegistry(),
        transcript: firstStore,
      }),
      cwd,
      'first turn',
    )

    const resume = await resumeSessionFromTranscript(transcriptPath)
    expect(resume.sessionState.todos).toMatchObject([
      { id: 'resume', status: 'in_progress' },
    ])

    const observedRequests: string[][] = []
    const secondModel: ModelClient = {
      id: 'second-model',
      async createMessage(request) {
        observedRequests.push(request.messages.map(event => event.type))
        return {
          content: 'second done',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const secondStore = new JsonlTranscriptStore({
      transcriptPath,
      sessionId: 'resume-session',
    })
    const result = await drainRuntime(
      createVigilonAgentRuntime({
        modelClient: secondModel,
        tools: createCoreToolRegistry(),
        transcript: secondStore,
        resume,
      }),
      cwd,
      'second turn',
    )

    expect(observedRequests[0]).toEqual([
      'user',
      'assistant',
      'tool-call',
      'session-state',
      'tool-result',
      'assistant',
      'user',
    ])
    expect(result?.report.todos).toMatchObject([
      { id: 'resume', status: 'in_progress' },
    ])
  })

  it('records compact boundaries with summary metadata for resume', async () => {
    const cwd = await createTempRoot('vigilon-transcript-compact-')
    const store = new JsonlTranscriptStore({
      transcriptPath: path.join(cwd, 'compact-session.jsonl'),
      sessionId: 'compact-session',
    })
    await store.append({
      type: 'user',
      content: 'old context',
      timestamp: '2026-05-17T00:00:00.000Z',
    })

    const boundary = await compactTranscript({
      transcript: store,
      summary: 'Old context was summarized.',
      trigger: 'manual',
      userContext: 'user requested compact',
    })
    const resume = await resumeSessionFromTranscript(store.transcriptPath)

    expect(boundary.metadata).toMatchObject({
      trigger: 'manual',
      preEventCount: 1,
      messagesSummarized: 1,
      userContext: 'user requested compact',
    })
    expect(resume.events.at(-1)).toMatchObject({
      type: 'compact-boundary',
      summary: 'Old context was summarized.',
      metadata: {
        trigger: 'manual',
        preEventCount: 1,
        messagesSummarized: 1,
      },
    })
  })

  it('restores pending plan, MCP instructions, and memory freshness from compact metadata', async () => {
    const cwd = await createTempRoot('vigilon-transcript-compact-state-')
    const store = new JsonlTranscriptStore({
      transcriptPath: path.join(cwd, 'compact-state.jsonl'),
      sessionId: 'compact-state',
    })
    await store.append({
      type: 'user',
      content: 'resume from compact state',
      timestamp: '2026-05-17T00:00:00.000Z',
    })

    await compactTranscript({
      transcript: store,
      summary: 'State-heavy context was summarized.',
      trigger: 'manual',
      sessionState: {
        phase: 'plan',
        permissionMode: 'read-only',
        prePlanPermissionMode: 'ask',
        todos: [{ id: 'resume', content: 'Resume work', status: 'in_progress' }],
        approvedPlan: '1. Keep state aligned',
        pendingPlan: '2. Resume compact replay',
        handoffReport: undefined,
        verificationNotes: ['Ran focused checks'],
        backgroundTasks: [],
        discoveredToolNames: ['LSP'],
        mcpInstructions: ['Use the filesystem MCP server for descriptors.'],
        memoryFreshness: 'stale',
      } as any,
    })

    const resume = await resumeSessionFromTranscript(store.transcriptPath)

    expect(resume.sessionState).toMatchObject({
      phase: 'plan',
      approvedPlan: '1. Keep state aligned',
      pendingPlan: '2. Resume compact replay',
      verificationNotes: ['Ran focused checks'],
      discoveredToolNames: ['LSP'],
    })
    expect((resume.sessionState as any).mcpInstructions).toEqual([
      'Use the filesystem MCP server for descriptors.',
    ])
    expect((resume.sessionState as any).memoryFreshness).toBe('stale')
  })

  it('records compact strategy and capability deltas in compact metadata', async () => {
    const cwd = await createTempRoot('vigilon-transcript-compact-delta-')
    const store = new JsonlTranscriptStore({
      transcriptPath: path.join(cwd, 'compact-delta.jsonl'),
      sessionId: 'compact-delta',
    })
    await store.append({
      type: 'user',
      content: 'compact with deltas',
      timestamp: '2026-05-18T00:00:00Z',
    })

    await compactTranscript({
      transcript: store,
      summary: 'memory summary',
      strategy: 'session-memory',
      sessionState: {
        phase: 'execute',
        permissionMode: 'ask',
        todos: [],
        verificationNotes: [],
        backgroundTasks: [],
        discoveredToolNames: ['LSP'],
        toolReferenceDeltas: [
          {
            name: 'LSP',
            reason: 'ToolSearch materialized LSP',
            schemaHash: 'hash',
            discoveredAt: '2026-05-18T00:00:00Z',
          },
        ],
        mcpInstructions: [],
        activeSkill: {
          name: 'reader',
          allowedTools: ['Read'],
          activatedAt: '2026-05-18T00:00:00Z',
        },
      },
    })

    const resume = await resumeSessionFromTranscript(store.transcriptPath)
    expect(resume.sessionState.toolReferenceDeltas).toHaveLength(1)
    expect(resume.sessionState.activeSkill).toMatchObject({
      name: 'reader',
      allowedTools: ['Read'],
    })
    const boundary = resume.events.at(-1)
    expect(boundary).toMatchObject({
      type: 'compact-boundary',
      metadata: {
        toolReferenceDeltas: [
          expect.objectContaining({ name: 'LSP' }),
        ],
        modelParams: expect.objectContaining({
          compactStrategy: 'session-memory',
        }),
      },
    })
  })
})

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function drainRuntime(
  runtime: ReturnType<typeof createVigilonAgentRuntime>,
  cwd: string,
  prompt: string,
) {
  let result
  for await (const event of runtime.runTurn({
    prompt,
    cwd,
    abortSignal: new AbortController().signal,
  })) {
    if (event.type === 'turn-finished') result = event.result
  }
  return result
}
