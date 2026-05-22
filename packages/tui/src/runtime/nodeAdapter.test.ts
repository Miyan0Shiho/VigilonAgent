import { describe, expect, it } from 'vitest'
import { createNodeRuntimeAdapter } from './nodeAdapter.js'
import type { OperatorShellDeps, OperatorShellIO } from './types.js'

describe('createNodeRuntimeAdapter agent task lifecycle', () => {
  it('stops a live in-process subagent host and appends parent session state', async () => {
    const appended: any[] = []
    const activeTasks = [
      {
        id: 'task-1',
        type: 'subagent',
        command: 'subagent:researcher',
        startTime: '2026-05-21T00:00:00Z',
        status: 'running',
        background: true,
        agentName: 'researcher',
        transcriptPath: '/tmp/subagent.jsonl',
        parentAgentId: 'main',
        parentSessionId: 'parent-session',
      },
    ]
    const retainedTasks: any[] = []
    const runtimeModule = {
      async loadRuntimeSettings() {
        return {
          settings: {
            skillDirs: [],
            mcpServers: {},
            project: {},
          },
          loadedSources: [],
        }
      },
      async loadRuntimeSkills() {
        return { skills: [] }
      },
      async loadRuntimeMcpTools() {
        return { tools: [], close() {} }
      },
      normalizeProjectConfig() {
        return { allowedTools: [], ignore: [] }
      },
      createSettingsPreToolUseHooks() {
        return []
      },
      async loadAgentCatalog() {
        return {
          precedence: ['built-in', 'plugin', 'user', 'project', 'local', 'flag', 'managed'],
          active: [],
          entries: [
            {
              definition: {
                name: 'researcher',
                source: 'local',
                description: 'Researcher',
                allowedTools: [],
                maxTurns: 2,
              },
            },
          ],
        }
      },
	      createTaskManager() {
	        return {
          get activeTasks() {
            return activeTasks
          },
          get retainedTasks() {
            return retainedTasks
          },
	          async stopTask(taskId: string) {
            const index = activeTasks.findIndex(task => task.id === taskId)
            if (index === -1) return false
            const [task] = activeTasks.splice(index, 1)
            retainedTasks.push({
              ...task,
              status: 'stopped',
              completedAt: '2026-05-21T00:00:01Z',
              terminalReason: 'stopped_by_shared_task_manager',
            })
	            return true
	          },
	          subscribe() {
	            return () => {}
	          },
	          async shutdown() {},
	        }
	      },
      async listSessions() {
        return [
          {
            sessionId: 'parent-session',
            transcriptPath: '/tmp/parent.jsonl',
            eventCount: 1,
            status: 'running',
            verificationCount: 0,
            completedTodoCount: 0,
            remainingTodoCount: 0,
            backgroundTaskCount: 1,
            hasHandoffReport: false,
          },
        ]
      },
      async resumeSessionById() {
        return {
          sessionId: 'parent-session',
          transcriptPath: '/tmp/parent.jsonl',
          sessionState: {
            phase: 'execute',
            permissionMode: 'bypass-local',
            todos: [],
            verificationNotes: [],
	            backgroundTasks: activeTasks.map(task => ({ ...task })),
	            retainedTasks: retainedTasks.map(task => ({ ...task })),
            discoveredToolNames: [],
            toolReferenceDeltas: [],
            mcpInstructions: [],
          },
        }
      },
	      async readTranscriptFile(transcriptPath: string) {
	        if (transcriptPath === '/tmp/parent.jsonl') {
          return [
            {
              type: 'subagent-lifecycle',
              event: {
                taskId: 'task-1',
                agentName: 'researcher',
                status: 'running-handoff',
              },
            },
	          ]
	        }
	        return [
	          { type: 'assistant', content: 'still running' },
	          {
	            type: 'permission',
	            request: {
	              action: 'bash',
	              subject: 'pnpm test',
	              risk: 'medium',
	              reason: 'Run validation',
	              origin: {
	                agentId: 'researcher',
	                agentRole: 'subagent',
	                parentAgentId: 'main',
	                toolName: 'Bash',
	              },
	            },
	            decision: {
	              allowed: true,
	              reason: 'operator approved',
	            },
	            timestamp: '2026-05-21T00:00:00Z',
	          },
	        ]
	      },
	      buildPermissionOriginSummary(events: any[]) {
	        const permissionEvents = events.filter(event => event.type === 'permission')
	        return {
	          totalRequests: permissionEvents.length,
	          allowed: permissionEvents.filter(event => event.decision.allowed).length,
	          denied: permissionEvents.filter(event => !event.decision.allowed).length,
	          actions: [{ action: 'bash', count: 1, allowed: 1, denied: 0 }],
	          risks: [{ risk: 'medium', count: 1, allowed: 1, denied: 0 }],
	          agents: [
	            {
	              agentId: 'researcher',
	              agentRole: 'subagent',
	              parentAgentId: 'main',
	              count: 1,
	              allowed: 1,
	              denied: 0,
	              tools: ['Bash'],
	            },
	          ],
	          tools: [{ toolName: 'Bash', count: 1, allowed: 1, denied: 0 }],
	          resolutionSources: [{ source: 'unknown', count: 1 }],
	          latest: {
	            timestamp: '2026-05-21T00:00:00Z',
	            action: 'bash',
	            subject: 'pnpm test',
	            risk: 'medium',
	            allowed: true,
	            reason: 'operator approved',
	            origin: permissionEvents[0]?.request.origin,
	          },
	        }
	      },
      JsonlTranscriptStore: class {
        constructor(readonly options: Record<string, string>) {}
        async append(event: any) {
          appended.push(event)
        }
      },
      createTimestamp() {
        return '2026-05-21T00:00:02Z'
      },
    }
    const adapter = await createNodeRuntimeAdapter({
      args: ['--cwd', '/repo', '--permission-mode', 'bypass-local'],
      io: createIo(),
      deps: { runtimeModule } satisfies OperatorShellDeps,
      reader: {
        async question() {
          return ''
        },
        close() {},
      },
    })

    const view = await adapter.stopAgentTask('parent-session', 'task-1')

	    expect(view?.detail?.stopResult).toEqual({
	      ok: true,
	      message: 'Stopped live subagent task task-1 through the shared task manager.',
	    })
	    expect(view?.detail?.permissionSummary).toMatchObject({
	      totalRequests: 1,
	      allowed: 1,
	      agents: [
	        expect.objectContaining({
	          agentRole: 'subagent',
	          parentAgentId: 'main',
	          tools: ['Bash'],
	        }),
	      ],
	    })
    expect(appended).toEqual([
      expect.objectContaining({
        type: 'session-state',
        backgroundTasks: [],
        retainedTasks: [
          expect.objectContaining({
            id: 'task-1',
            status: 'stopped',
            parentSessionId: 'parent-session',
          }),
        ],
      }),
    ])
  })

  it('runs governed compact through the runtime CLI with memory validation args', async () => {
    const cliCalls: any[] = []
    const runtimeModule = {
      async loadRuntimeSettings() {
        return {
          settings: {
            skillDirs: [],
            mcpServers: {},
            project: {},
          },
          loadedSources: [],
        }
      },
      async loadRuntimeSkills() {
        return { skills: [] }
      },
      async loadRuntimeMcpTools() {
        return { tools: [], close() {} }
      },
      normalizeProjectConfig() {
        return { allowedTools: [], ignore: [] }
      },
      createSettingsPreToolUseHooks() {
        return []
      },
      createTaskManager() {
        return {
          get activeTasks() {
            return []
          },
          get retainedTasks() {
            return []
          },
          subscribe() {
            return () => {}
          },
          async shutdown() {},
        }
      },
      async listSessions() {
        return [
          {
            sessionId: 'compact-session',
            transcriptPath: '/tmp/compact-session.jsonl',
            eventCount: 5,
            status: 'running',
            verificationCount: 0,
            completedTodoCount: 0,
            remainingTodoCount: 0,
            backgroundTaskCount: 0,
            hasHandoffReport: false,
          },
        ]
      },
      async loadAgentCatalog() {
        return {
          precedence: [],
          active: [],
          entries: [],
        }
      },
      async runCli(argv: string[], io: OperatorShellIO) {
        cliCalls.push(argv)
        io.stdout.write(JSON.stringify({
          sessionId: 'compact-session',
          transcriptPath: '/tmp/compact-session.jsonl',
          compacted: true,
          summarySource: 'refreshed-session-memory',
          memoryReadiness: {
            after: 'fresh',
            ready: true,
            blockingReasons: [],
            validationRequired: true,
            refreshed: true,
            groundingValidation: {
              status: 'supported',
              modelId: 'fixture-grounding-model',
            },
          },
          boundary: {
            route: { strategy: 'session-memory' },
            postCompactCleanup: { completed: true },
          },
          eventCount: 6,
        }))
        return 0
      },
    }
    const adapter = await createNodeRuntimeAdapter({
      args: ['--cwd', '/repo', '--sessions-dir', '/sessions', '--model', 'deepseek-v4-flash'],
      io: createIo(),
      deps: { runtimeModule } satisfies OperatorShellDeps,
      reader: {
        async question() {
          return ''
        },
        close() {},
      },
    })

    const result = await adapter.compactSession({
      sessionSelector: 'compact',
      args: ['--validate-memory', '--token-budget', '1000'],
    })

    expect(result).toMatchObject({
      sessionId: 'compact-session',
      compacted: true,
      memoryReadiness: {
        ready: true,
        groundingValidation: {
          status: 'supported',
        },
      },
    })
    expect(cliCalls).toEqual([
      [
        'compact',
        'compact-session',
        '--validate-memory',
        '--token-budget',
        '1000',
        '--cwd',
        '/repo',
        '--sessions-dir',
        '/sessions',
        '--model',
        'deepseek-v4-flash',
      ],
    ])
  })

  it('pushes background subagent terminal notifications without an /agents refresh', async () => {
    const taskListeners: Array<(event: any) => void> = []
    const runtimeModule = {
      async loadRuntimeSettings() {
        return {
          settings: {
            skillDirs: [],
            mcpServers: {},
            project: {},
          },
          loadedSources: [],
        }
      },
      async loadRuntimeSkills() {
        return { skills: [] }
      },
      async loadRuntimeMcpTools() {
        return { tools: [], close() {} }
      },
      normalizeProjectConfig() {
        return { allowedTools: [], ignore: [] }
      },
      createSettingsPreToolUseHooks() {
        return []
      },
      createTaskManager() {
        return {
          get activeTasks() {
            return []
          },
          get retainedTasks() {
            return []
          },
          subscribe(listener: (event: any) => void) {
            taskListeners.push(listener)
            return () => {
              const index = taskListeners.indexOf(listener)
              if (index >= 0) taskListeners.splice(index, 1)
            }
          },
          async shutdown() {},
        }
      },
      async listSessions() {
        return []
      },
      async loadAgentCatalog() {
        return {
          precedence: ['built-in', 'plugin', 'user', 'project', 'local', 'flag', 'managed'],
          active: [],
          entries: [],
        }
      },
    }
    const adapter = await createNodeRuntimeAdapter({
      args: ['--cwd', '/repo', '--permission-mode', 'bypass-local'],
      io: createIo(),
      deps: { runtimeModule } satisfies OperatorShellDeps,
      reader: {
        async question() {
          return ''
        },
        close() {},
      },
    })
    const notifications: any[] = []
    const unsubscribe = adapter.subscribeAgentTaskNotifications(event => notifications.push(event))

    taskListeners[0]?.({
      type: 'task-terminal',
      task: {
        id: 'task-bg',
        type: 'subagent',
        command: 'subagent:finisher',
        startTime: '2026-05-21T00:00:00Z',
        status: 'completed',
        background: true,
        agentName: 'finisher',
        transcriptPath: '/tmp/finisher.jsonl',
        parentSessionId: 'parent-session',
        terminalReason: 'subagent_completed',
        outputSummary: 'Background finisher completed.',
        completedAt: '2026-05-21T00:00:03Z',
      },
      terminal: {
        status: 'completed',
        terminalReason: 'subagent_completed',
        outputSummary: 'Background finisher completed.',
      },
      timestamp: '2026-05-21T00:00:03Z',
    })
    taskListeners[0]?.({
      type: 'task-terminal',
      task: {
        id: 'task-sync',
        type: 'subagent',
        command: 'subagent:researcher',
        startTime: '2026-05-21T00:00:00Z',
        status: 'completed',
        background: false,
        agentName: 'researcher',
      },
      terminal: {
        status: 'completed',
        terminalReason: 'subagent_completed',
      },
      timestamp: '2026-05-21T00:00:04Z',
    })

    expect(notifications).toEqual([
      {
        type: 'agent-notification',
        notification: {
          sessionId: 'parent-session',
          taskId: 'task-bg',
          agentName: 'finisher',
          status: 'completed',
          background: true,
          transcriptPath: '/tmp/finisher.jsonl',
          terminalReason: 'subagent_completed',
          outputSummary: 'Background finisher completed.',
          completedAt: '2026-05-21T00:00:03Z',
        },
      },
    ])

    unsubscribe()
    taskListeners[0]?.({
      type: 'task-terminal',
      task: {
        id: 'task-bg-2',
        type: 'subagent',
        command: 'subagent:finisher',
        startTime: '2026-05-21T00:00:00Z',
        status: 'completed',
        background: true,
      },
      terminal: {
        status: 'completed',
        terminalReason: 'subagent_completed',
      },
      timestamp: '2026-05-21T00:00:05Z',
    })
    expect(notifications).toHaveLength(1)
  })

  it('replays retained background subagent notifications from transcript state on subscribe', async () => {
    const runtimeModule = {
      async loadRuntimeSettings() {
        return {
          settings: {
            skillDirs: [],
            mcpServers: {},
            project: {},
          },
          loadedSources: [],
        }
      },
      async loadRuntimeSkills() {
        return { skills: [] }
      },
      async loadRuntimeMcpTools() {
        return { tools: [], close() {} }
      },
      normalizeProjectConfig() {
        return { allowedTools: [], ignore: [] }
      },
      createSettingsPreToolUseHooks() {
        return []
      },
      createTaskManager() {
        return {
          get activeTasks() {
            return []
          },
          get retainedTasks() {
            return []
          },
          subscribe() {
            return () => {}
          },
          async shutdown() {},
        }
      },
      async listSessions() {
        return [
          {
            sessionId: 'parent-session',
            transcriptPath: '/tmp/parent.jsonl',
            eventCount: 4,
            status: 'completed',
            verificationCount: 0,
            completedTodoCount: 0,
            remainingTodoCount: 0,
            backgroundTaskCount: 0,
            retainedTaskCount: 1,
            hasHandoffReport: false,
          },
        ]
      },
      async resumeSessionById() {
        return {
          sessionId: 'parent-session',
          transcriptPath: '/tmp/parent.jsonl',
          sessionState: {
            phase: 'execute',
            permissionMode: 'bypass-local',
            todos: [],
            verificationNotes: [],
            backgroundTasks: [],
            retainedTasks: [
              {
                id: 'task-replay',
                type: 'subagent',
                command: 'subagent:finisher',
                startTime: '2026-05-21T00:00:00Z',
                status: 'completed',
                background: true,
                agentName: 'finisher',
                transcriptPath: '/tmp/finisher.jsonl',
                parentSessionId: 'parent-session',
                completedAt: '2026-05-21T00:00:03Z',
                terminalReason: 'subagent_completed',
                outputSummary: 'Background finisher completed.',
              },
            ],
            discoveredToolNames: [],
            toolReferenceDeltas: [],
            mcpInstructions: [],
          },
        }
      },
      async loadAgentCatalog() {
        return {
          precedence: ['built-in', 'plugin', 'user', 'project', 'local', 'flag', 'managed'],
          active: [],
          entries: [],
        }
      },
    }
    const adapter = await createNodeRuntimeAdapter({
      args: ['--cwd', '/repo', '--permission-mode', 'bypass-local'],
      io: createIo(),
      deps: { runtimeModule } satisfies OperatorShellDeps,
      reader: {
        async question() {
          return ''
        },
        close() {},
      },
    })
    const notifications: any[] = []
    adapter.subscribeAgentTaskNotifications(event => notifications.push(event))
    await waitFor(() => notifications.length === 1, 250)

    expect(notifications).toEqual([
      {
        type: 'agent-notification',
        notification: {
          sessionId: 'parent-session',
          taskId: 'task-replay',
          agentName: 'finisher',
          status: 'completed',
          background: true,
          transcriptPath: '/tmp/finisher.jsonl',
          terminalReason: 'subagent_completed',
          outputSummary: 'Background finisher completed.',
          completedAt: '2026-05-21T00:00:03Z',
          replayed: true,
          source: 'transcript-replay',
        },
      },
    ])
  })
})

function createIo(): OperatorShellIO {
  return {
    stdout: { write: () => true } as any,
    stderr: { write: () => true } as any,
    env: {},
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
