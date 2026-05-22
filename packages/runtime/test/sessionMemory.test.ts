import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createVigilonAgentRuntime,
  createToolRegistry,
  deleteSessionMemory,
  generateSessionMemoryFromSnapshot,
  getSessionMemoryEventPointer,
  getSessionMemoryExtractionPath,
  JsonlTranscriptStore,
  inspectSessionMemory,
  parseSessionMemorySections,
  readSessionMemory,
  readSessionMemoryExtractionStatus,
  readSessionMemoryManifest,
  resumeSessionById,
  scheduleSessionMemoryExtraction,
  validateSessionMemoryGrounding,
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
    expect(observedRequests[0]?.[0]?.content).toContain(
      '<vigilon_memory_drift_caveat>',
    )
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

  it('records a manifest, reports stale status, and deletes governed session memory', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-session-memory-manifest-'))
    tempRoots.push(cwd)
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions')

    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'governed-memory',
    })
    await transcript.append({
      type: 'user',
      content: 'Implement memory governance',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const snapshot = await resumeSessionById({
      sessionId: 'governed-memory',
      cwd,
      sessionsDir,
    })
    const memoryPath = getSessionMemoryPath({
      cwd,
      sessionsDir,
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
    })
    await writeSessionMemory(
      memoryPath,
      {
        sessionId: snapshot.sessionId,
        generatedAt: '2026-05-18T00:00:10Z',
        sourceEventCount: snapshot.events.length,
        content: '## Current Task\nImplement memory governance',
      },
      {
        transcriptPath: snapshot.transcriptPath,
        sourceLastEvent: getSessionMemoryEventPointer(
          snapshot.events,
          snapshot.events.length,
        ),
      },
    )

    const manifest = await readSessionMemoryManifest(memoryPath)
    expect(manifest).toMatchObject({
      kind: 'vigilon.session-memory',
      sessionId: 'governed-memory',
      transcriptPath: snapshot.transcriptPath,
      sourceEventCount: 1,
      freshnessAtWrite: 'fresh',
      sourceLastEvent: {
        index: 0,
        type: 'user',
        timestamp: '2026-05-18T00:00:00Z',
      },
      sections: [
        {
          kind: 'current_task',
          heading: 'Current Task',
          content: 'Implement memory governance',
        },
      ],
      semanticFingerprint: {
        version: 1,
        currentTaskHash: expect.any(String),
        sectionHash: expect.any(String),
      },
    })

    await transcript.append({
      type: 'assistant',
      content: 'Memory changed after summary.',
      timestamp: '2026-05-18T00:00:20Z',
    })
    const staleSnapshot = await resumeSessionById({
      sessionId: 'governed-memory',
      cwd,
      sessionsDir,
    })
    const inspection = await inspectSessionMemory({
      snapshot: staleSnapshot,
      cwd,
      sessionsDir,
      includeContent: true,
    })
    expect(inspection).toMatchObject({
      exists: true,
      freshness: 'stale',
      currentEventCount: 2,
      sourceEventCount: 1,
      content: expect.stringContaining('Implement memory governance'),
    })
    expect(inspection.driftCaveat).toContain('may be outdated')
    expect(inspection.semanticDrift).toMatchObject({
      status: 'changed',
      changedAnchors: expect.arrayContaining(['current_state', 'important_files']),
    })

    await deleteSessionMemory(memoryPath)
    expect(await readSessionMemory(memoryPath)).toBeNull()
    expect(await readSessionMemoryManifest(memoryPath)).toBeNull()
  })

  it('parses typed memory sections and reports no semantic drift when anchors match', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-session-memory-typed-'))
    tempRoots.push(cwd)
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'typed-memory',
    })
    await transcript.append({
      type: 'user',
      content: 'Keep typed memory anchored',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const snapshot = await resumeSessionById({
      sessionId: 'typed-memory',
      cwd,
      sessionsDir,
    })
    const memory = generateSessionMemoryFromSnapshot(snapshot)
    const memoryPath = getSessionMemoryPath({
      cwd,
      sessionsDir,
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
    })
    await writeSessionMemory(memoryPath, memory, {
      transcriptPath: snapshot.transcriptPath,
      sourceLastEvent: getSessionMemoryEventPointer(
        snapshot.events,
        snapshot.events.length,
      ),
    })

    expect(parseSessionMemorySections(memory.content).map(section => section.kind)).toEqual([
      'current_task',
      'current_state',
      'todo_state',
      'verification_notes',
      'important_files',
      'next_step',
    ])

    const inspection = await inspectSessionMemory({
      snapshot,
      cwd,
      sessionsDir,
    })
    expect(inspection.semanticDrift).toMatchObject({
      status: 'none',
      changedAnchors: [],
    })
  })

  it('schedules background extraction with auditable terminal status', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-session-memory-worker-'))
    tempRoots.push(cwd)
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'memory-worker',
    })
    await transcript.append({
      type: 'user',
      content: 'Extract durable session memory in the background',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const snapshot = await resumeSessionById({
      sessionId: 'memory-worker',
      cwd,
      sessionsDir,
    })
    const scheduled = await scheduleSessionMemoryExtraction({
      snapshot,
      cwd,
      sessionsDir,
      trigger: 'runtime',
      queuedAt: '2026-05-18T00:00:10Z',
      jobId: 'memory-worker-job',
    })

    expect(scheduled.job).toMatchObject({
      jobId: 'memory-worker-job',
      status: 'queued',
      trigger: 'runtime',
      sourceEventCount: 1,
      sourceLastEvent: {
        index: 0,
        type: 'user',
        timestamp: '2026-05-18T00:00:00Z',
      },
    })
    expect(scheduled.statusPath).toBe(
      getSessionMemoryExtractionPath(scheduled.job.memoryPath),
    )

    const completed = await scheduled.completion
    expect(completed).toMatchObject({
      status: 'completed',
      completedAt: expect.any(String),
      memoryPath: scheduled.job.memoryPath,
      manifestPath: scheduled.job.manifestPath,
      outputSummary: 'Wrote session memory from 1 transcript events.',
    })
    expect(await readSessionMemory(scheduled.job.memoryPath)).toMatchObject({
      sessionId: 'memory-worker',
      sourceEventCount: 1,
      content: expect.stringContaining('Extract durable session memory'),
    })
    expect(await readSessionMemoryManifest(scheduled.job.memoryPath)).toMatchObject({
      kind: 'vigilon.session-memory',
      sourceEventCount: 1,
    })
    expect(await readSessionMemoryExtractionStatus(scheduled.job.memoryPath)).toMatchObject({
      status: 'completed',
      jobId: 'memory-worker-job',
      sourceEventCount: 1,
    })
  })

  it('validates session memory grounding through a model and exposes it on inspection', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-session-memory-grounding-'))
    tempRoots.push(cwd)
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'grounded-memory',
    })
    await transcript.append({
      type: 'user',
      content: 'Keep compact readiness grounded in model-checked memory.',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const snapshot = await resumeSessionById({
      sessionId: 'grounded-memory',
      cwd,
      sessionsDir,
    })
    const memory = generateSessionMemoryFromSnapshot(snapshot)
    const memoryPath = getSessionMemoryPath({
      cwd,
      sessionsDir,
      sessionId: snapshot.sessionId,
      transcriptPath: snapshot.transcriptPath,
    })
    await writeSessionMemory(memoryPath, memory, {
      transcriptPath: snapshot.transcriptPath,
      sourceLastEvent: getSessionMemoryEventPointer(
        snapshot.events,
        snapshot.events.length,
      ),
    })

    const observedPrompts: string[] = []
    const groundingModel: ModelClient = {
      id: 'fake-grounding-model',
      async createMessage(request) {
        observedPrompts.push(request.messages[0]?.type === 'user'
          ? request.messages[0].content
          : '')
        return {
          content: JSON.stringify({
            status: 'supported',
            supportedClaims: ['The current task is compact readiness grounding.'],
            contradictedClaims: [],
            missingClaims: [],
            reason: 'Transcript evidence supports the memory summary.',
          }),
          toolCalls: [],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 123,
            outputTokens: 45,
            totalTokens: 168,
          },
        }
      },
    }

    const inspection = await inspectSessionMemory({
      snapshot,
      cwd,
      sessionsDir,
      includeContent: true,
      groundingModel,
      groundingValidatedAt: '2026-05-18T00:00:10Z',
    })

    expect(observedPrompts[0]).toContain('<session_memory>')
    expect(observedPrompts[0]).toContain('<current_transcript_evidence>')
    expect(inspection.groundingValidation).toMatchObject({
      kind: 'vigilon.session-memory-grounding',
      version: 1,
      status: 'supported',
      modelId: 'fake-grounding-model',
      validatedAt: '2026-05-18T00:00:10Z',
      memorySourceEventCount: 1,
      currentEventCount: 1,
      semanticDriftStatus: 'none',
      evidenceEventCount: 1,
      supportedClaims: ['The current task is compact readiness grounding.'],
      contradictedClaims: [],
      missingClaims: [],
      reason: 'Transcript evidence supports the memory summary.',
      usage: {
        inputTokens: 123,
        outputTokens: 45,
        totalTokens: 168,
      },
    })

    const direct = await validateSessionMemoryGrounding({
      snapshot,
      record: memory,
      manifest: await readSessionMemoryManifest(memoryPath),
      model: groundingModel,
      validatedAt: '2026-05-18T00:00:11Z',
    })
    expect(direct.status).toBe('supported')
  })

  it('marks invalid model grounding responses as unknown instead of treating them as support', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-session-memory-grounding-invalid-'))
    tempRoots.push(cwd)
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'grounded-memory-invalid',
    })
    await transcript.append({
      type: 'user',
      content: 'Validate invalid grounding output.',
      timestamp: '2026-05-18T00:00:00Z',
    })
    const snapshot = await resumeSessionById({
      sessionId: 'grounded-memory-invalid',
      cwd,
      sessionsDir,
    })
    const memory = generateSessionMemoryFromSnapshot(snapshot)
    const groundingModel: ModelClient = {
      id: 'invalid-grounding-model',
      async createMessage() {
        return {
          content: 'not json',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }

    const validation = await validateSessionMemoryGrounding({
      snapshot,
      record: memory,
      model: groundingModel,
      validatedAt: '2026-05-18T00:00:12Z',
    })

    expect(validation).toMatchObject({
      status: 'unknown',
      modelId: 'invalid-grounding-model',
      reason: 'invalid_model_validation_response',
    })
  })
})
