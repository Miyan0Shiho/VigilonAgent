import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createVigilonAgentRuntime,
  createToolRegistry,
  JsonlTranscriptStore,
  resumeSessionById,
  writeSessionMemory,
  getSessionMemoryPath,
  type ModelClient,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  const { rm: remove } = await import('node:fs/promises')
  await Promise.all(tempRoots.map(root => remove(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('session memory', () => {
  it('injects saved session memory into the first resumed model request', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-session-memory-'))
    tempRoots.push(cwd)
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions')

    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'resume-memory',
    })
    await transcript.append({
      type: 'user',
      content: 'Investigate failing tests',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const resume = await resumeSessionById({
      sessionId: 'resume-memory',
      cwd,
      sessionsDir,
    })

    const memoryPath = getSessionMemoryPath({
      cwd,
      sessionsDir,
      sessionId: resume.sessionId,
    })
    await writeSessionMemory(memoryPath, {
      sessionId: resume.sessionId,
      generatedAt: '2026-05-18T00:00:10Z',
      sourceEventCount: resume.events.length,
      content: [
        '## Current Task',
        'Fix the failing runtime tests.',
        '',
        '## Next Step',
        'Run targeted tests before full suite.',
      ].join('\n'),
    })

    const observedRequests: Array<{ type: string; content?: string }[]> = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        observedRequests.push(
          request.messages.map(message => ({
            type: message.type,
            content: 'content' in message ? message.content : undefined,
          })),
        )
        return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
      },
    }

    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([]),
      transcript: new JsonlTranscriptStore({
        transcriptPath: resume.transcriptPath,
        sessionId: resume.sessionId,
      }),
      resume,
    })

    for await (const _event of runtime.runTurn({
      prompt: 'continue',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      // Drain runtime
    }

    expect(observedRequests[0]?.[0]).toMatchObject({
      type: 'user',
      content: expect.stringContaining('<vigilon_session_memory'),
    })
    expect(observedRequests[0]?.[0]?.content).toContain('Fix the failing runtime tests.')
  })

  it('replays stale memory, pending plan, and MCP instructions into the first resumed model request', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-session-memory-stale-'))
    tempRoots.push(cwd)
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions')

    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'resume-memory-stale',
    })
    await transcript.append({
      type: 'user',
      content: 'Continue the compacted session',
      timestamp: '2026-05-18T00:00:00Z',
    })
    await transcript.append({
      type: 'assistant',
      content: 'Captured the previous state.',
      timestamp: '2026-05-18T00:00:01Z',
    })

    const resume = await resumeSessionById({
      sessionId: 'resume-memory-stale',
      cwd,
      sessionsDir,
    })
    ;(resume.sessionState as any).pendingPlan = 'Investigate compact replay'
    ;(resume.sessionState as any).mcpInstructions = [
      'Use the filesystem MCP server for schema recovery.',
    ]

    const memoryPath = getSessionMemoryPath({
      cwd,
      sessionsDir,
      sessionId: resume.sessionId,
    })
    await writeSessionMemory(memoryPath, {
      sessionId: resume.sessionId,
      generatedAt: '2026-05-18T00:00:10Z',
      sourceEventCount: 1,
      content: [
        '## Current Task',
        'Resume the compact replay flow.',
        '',
        '## Next Step',
        'Re-announce capabilities before continuing.',
      ].join('\n'),
    })

    const observedRequests: Array<{ type: string; content?: string }[]> = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        observedRequests.push(
          request.messages.map(message => ({
            type: message.type,
            content: 'content' in message ? message.content : undefined,
          })),
        )
        return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
      },
    }

    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([]),
      transcript: new JsonlTranscriptStore({
        transcriptPath: resume.transcriptPath,
        sessionId: resume.sessionId,
      }),
      resume,
    })

    for await (const _event of runtime.runTurn({
      prompt: 'continue after compact',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      // Drain runtime
    }

    expect(observedRequests[0]?.[0]).toMatchObject({
      type: 'user',
      content: expect.stringContaining('freshness="stale"'),
    })
    expect(
      observedRequests[0]?.some(
        message =>
          message.type === 'user' &&
          message.content?.includes('<vigilon_capability_replay') &&
          message.content.includes('Investigate compact replay') &&
          message.content.includes('filesystem MCP server'),
      ),
    ).toBe(true)
  })
})
