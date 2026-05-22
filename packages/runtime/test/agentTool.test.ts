import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentTool,
  createTaskManager,
  InMemoryTranscriptStore,
  promoteLongTermMemory,
  type ToolUseContext,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('AgentTool', () => {
  it('loads a local agent definition and returns a structured completed result', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-agent-tool-'))
    tempRoots.push(cwd)
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
      [
        '---',
        'description: Research codebase issues',
        'maxTurns: 4',
        'allowedTools:',
        '  - Read',
        '  - Grep',
        '---',
        'You are a focused code research subagent.',
      ].join('\n'),
      'utf8',
    )
    await mkdir(path.join(cwd, '.vigilon', 'agents.local'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents.local', 'researcher.md'),
      [
        '---',
        'description: Local override researcher',
        'maxTurns: 5',
        'memory: inherit',
        'allowedTools:',
        '  - Read',
        '---',
        'You are the local override researcher.',
      ].join('\n'),
      'utf8',
    )
    await promoteLongTermMemory({
      cwd,
      kind: 'project',
      topic: 'runtime governance',
      content: 'Subagents must inherit manually promoted long-term memory evidence.',
      createdAt: '2026-05-19T00:00:00Z',
      source: {
        sessionId: 'parent-session',
        sourceEventCount: 3,
      },
    })

    const runSubagent = vi.fn(async (request: any) => ({
      status: 'completed',
      agentName: request.definition.name,
      transcriptPath: '/tmp/subagent.jsonl',
      finalMessage: 'Found likely root cause in runtime layer.',
      report: {
        status: 'completed',
        finalMessage: 'Found likely root cause in runtime layer.',
        todos: [],
        verificationNotes: ['Reviewed runtime entry points'],
        fileChanges: [],
        toolResults: [],
      },
      taskHost: {
        taskId: 'task-1',
        status: 'completed',
        background: false,
        transcriptPath: '/tmp/subagent.jsonl',
        startedAt: '2026-05-19T00:00:00Z',
        completedAt: '2026-05-19T00:00:01Z',
      },
      permissionOrigin: {
        agentId: 'agent:researcher:task-1',
        agentRole: 'subagent',
        parentAgentId: 'main',
      },
      memorySnapshot: request.memorySnapshot,
      catalog: request.catalog,
    }))

    const context = {
      cwd,
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true, reason: 'approved' })),
      },
      permissionOrigin: {
        agentId: 'main',
        agentRole: 'main',
        toolName: 'Agent',
      },
      sessionState: {
        memoryFreshness: 'stale',
        approvedPlan: 'Investigate runtime layer',
        verificationNotes: ['Parent verified transcript state'],
      },
      runSubagent,
    } as unknown as ToolUseContext

    const result = await AgentTool.invoke(
      {
        agent: 'researcher',
        task: 'Find the likely source of the runtime regressions',
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(runSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          name: 'researcher',
          description: 'Local override researcher',
          source: 'local',
          allowedTools: ['Read'],
          maxTurns: 5,
        }),
        memorySnapshot: expect.objectContaining({
          freshness: 'stale',
          summary: expect.stringContaining('Investigate runtime layer'),
          longTerm: expect.objectContaining({
            entryCount: 1,
            entries: [
              expect.objectContaining({
                kind: 'project',
                topic: 'runtime governance',
                content: expect.stringContaining('Subagents must inherit'),
                sourceSessionId: 'parent-session',
              }),
            ],
          }),
        }),
        catalog: expect.objectContaining({
          precedence: [
            'built-in',
            'plugin',
            'user',
            'project',
            'local',
            'flag',
            'managed',
          ],
          entries: expect.arrayContaining([
            expect.objectContaining({
              definition: expect.objectContaining({
                name: 'researcher',
                source: 'project',
              }),
              overriddenBy: 'local',
            }),
          ]),
        }),
      }),
    )
    expect(result.metadata).toMatchObject({
      status: 'completed',
      transcriptPath: '/tmp/subagent.jsonl',
      agentName: 'researcher',
      taskHost: {
        taskId: 'task-1',
        status: 'completed',
      },
      permissionOrigin: {
        agentRole: 'subagent',
        parentAgentId: 'main',
      },
      memorySnapshot: {
        freshness: 'stale',
        longTerm: {
          entryCount: 1,
        },
      },
      catalog: {
        precedence: [
          'built-in',
          'plugin',
          'user',
          'project',
          'local',
          'flag',
          'managed',
        ],
        entries: expect.arrayContaining([
          expect.objectContaining({
            name: 'researcher',
            source: 'project',
            overriddenBy: 'local',
          }),
        ]),
      },
    })
    expect(result.content).toContain('Found likely root cause in runtime layer.')
  })

  it('returns a running handoff and persists background subagent task state', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-agent-tool-bg-'))
    tempRoots.push(cwd)
    await mkdir(path.join(cwd, '.vigilon', 'agents.local'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents.local', 'watcher.md'),
      [
        '---',
        'description: Background watcher',
        'background: true',
        'memory: none',
        'allowedTools: []',
        '---',
        'Watch background runtime state.',
      ].join('\n'),
      'utf8',
    )

    const transcript = new InMemoryTranscriptStore()
    const taskManager = createTaskManager()
    const abortController = new AbortController()
    await taskManager.startSubagentTask({
      taskId: 'agent-watch-1',
      agentName: 'watcher',
      transcriptPath: '/tmp/watcher.jsonl',
      cwd,
      background: true,
      parentAgentId: 'main',
      abortController,
    })
    const runSubagent = vi.fn(async (request: any) => ({
      status: 'running',
      agentName: request.definition.name,
      transcriptPath: '/tmp/watcher.jsonl',
      finalMessage: 'Subagent watcher started in background. Task ID: agent-watch-1',
      report: {
        status: 'running',
        finalMessage: 'Subagent watcher started in background. Task ID: agent-watch-1',
        todos: [],
        warnings: ['Background subagent is still running.'],
        verificationNotes: [],
        fileChanges: [],
        toolResults: [],
      },
      taskHost: {
        taskId: 'agent-watch-1',
        status: 'running',
        background: true,
        transcriptPath: '/tmp/watcher.jsonl',
        startedAt: '2026-05-20T00:00:00Z',
        registeredWithTaskManager: true,
        stopPath: 'shared-task-manager',
      },
      permissionOrigin: {
        agentId: 'agent:watcher:agent-watch-1',
        agentRole: 'subagent',
        parentAgentId: 'main',
      },
      catalog: request.catalog,
    }))

    const context = {
      cwd,
      abortSignal: new AbortController().signal,
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true, reason: 'approved' })),
      },
      permissionOrigin: {
        agentId: 'main',
        agentRole: 'main',
        toolName: 'Agent',
      },
      sessionState: {
        phase: 'execute',
        permissionMode: 'bypass-local',
        todos: [],
        verificationNotes: [],
        backgroundTasks: [],
        discoveredToolNames: [],
        toolReferenceDeltas: [],
        mcpInstructions: [],
      },
      transcript,
      taskManager,
      runSubagent,
    } as unknown as ToolUseContext

    const result = await AgentTool.invoke(
      {
        agent: 'watcher',
        task: 'Watch runtime state in the background.',
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Subagent started in background.')
    expect(result.content).toContain('Task ID: agent-watch-1')
    expect(result.metadata).toMatchObject({
      status: 'running',
      taskHost: {
        taskId: 'agent-watch-1',
        status: 'running',
        background: true,
        stopPath: 'shared-task-manager',
      },
    })
    expect(context.sessionState?.backgroundTasks).toMatchObject([
      {
        id: 'agent-watch-1',
        type: 'subagent',
        background: true,
        status: 'running',
      },
    ])
    const events = await transcript.readAll()
    expect(events.some(event => event.type === 'session-state' && event.backgroundTasks?.length === 1)).toBe(true)
  })
})
