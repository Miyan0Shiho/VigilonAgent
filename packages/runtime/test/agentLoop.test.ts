import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  createLocalPermissionGate,
  createCoreToolRegistry,
  createToolRegistry,
  createTaskManager,
  createVigilonAgentRuntime,
  InMemoryTranscriptStore,
  JsonlTranscriptStore,
  WriteTool,
  type ModelClient,
  type PreToolUseHook,
  type Tool,
  type TranscriptEvent,
} from '../src/index.js'

const execFileAsync = promisify(execFile)

describe('createVigilonAgentRuntime', () => {
  it('feeds tool results back into the next model request', async () => {
    const requestMessageTypes: string[][] = []
    const observedRequests: TranscriptEvent[][] = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        observedRequests.push(request.messages)
        requestMessageTypes.push(request.messages.map(message => message.type))
        if (requestMessageTypes.length === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'toolu_1',
                name: 'echo',
                input: { text: 'ok' },
              },
            ],
            stopReason: 'tool_use',
          }
        }

        return {
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const tool: Tool = {
      name: 'echo',
      description: 'Echo input',
      inputJsonSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      async invoke(input) {
        return {
          toolCallId: 'toolu_1',
          ok: true,
          content: JSON.stringify(input),
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([tool]),
    })

    const events: string[] = []
    for await (const event of runtime.runTurn({
      prompt: 'run echo',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      events.push(event.type)
    }

    expect(events).toEqual([
      'model-request-started',
      'model-response-received',
      'tool-started',
      'tool-finished',
      'model-request-started',
      'model-response-received',
      'turn-finished',
    ])
    expect(requestMessageTypes).toEqual([
      ['user', 'user'],
      ['user', 'user', 'assistant', 'tool-call', 'tool-result'],
    ])
    const activeTask = observedRequests[1]?.find(
      event =>
        event.type === 'user' &&
        event.content.includes('<vigilon_active_task>'),
    )
    expect(activeTask?.content).toContain('original_user_task="run echo"')
  })

  it('injects model-facing skill listing and supports Skill tool result feedback', async () => {
    const observedRequests: TranscriptEvent[][] = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        observedRequests.push(request.messages)
        if (observedRequests.length === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'skill-1',
                name: 'Skill',
                input: { skill: 'review', args: 'diff' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry({
        skills: [
          {
            name: 'review',
            description: 'Review code changes',
            content: 'Review with $ARGUMENTS.',
            path: '/repo/.vigilon/skills/review/SKILL.md',
            root: '/repo/.vigilon/skills/review',
            source: 'project',
            allowedTools: [],
            disableModelInvocation: false,
            userInvocable: false,
          },
        ],
      }),
      skills: [
        {
          name: 'review',
          description: 'Review code changes',
          content: 'Review with $ARGUMENTS.',
          path: '/repo/.vigilon/skills/review/SKILL.md',
          root: '/repo/.vigilon/skills/review',
          source: 'project',
          allowedTools: [],
          disableModelInvocation: false,
          userInvocable: false,
        },
      ],
    })

    for await (const _event of runtime.runTurn({
      prompt: 'use review skill',
      cwd: '/repo',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect(observedRequests[0]?.[0]).toMatchObject({
      type: 'user',
      content: expect.stringContaining('review: Review code changes'),
    })
    const toolResult = observedRequests[1]?.find(event => event.type === 'tool-result')
    expect(toolResult).toMatchObject({
      type: 'tool-result',
      result: {
        ok: true,
        content: expect.stringContaining('### Skill: review'),
      },
    })
  })

  it('applies skill allowedTools as a runtime tool-pool gate after Skill loads', async () => {
    const observedToolSets: string[][] = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        observedToolSets.push(request.tools.map(tool => tool.name))
        if (observedToolSets.length === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'skill-1',
                name: 'Skill',
                input: { skill: 'reader' },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
      },
    }
    const readerSkill = {
      name: 'reader',
      description: 'Read-only repo inspection',
      content: 'Use only allowed tools.',
      path: '/repo/.vigilon/skills/reader/SKILL.md',
      root: '/repo/.vigilon/skills/reader',
      source: 'project' as const,
      allowedTools: ['Read', 'Grep'],
      disableModelInvocation: false,
      userInvocable: false,
    }

    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry({ skills: [readerSkill] }),
      skills: [readerSkill],
    })

    for await (const _event of runtime.runTurn({
      prompt: 'use reader skill',
      cwd: '/repo',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect(observedToolSets[0]).toContain('Skill')
    expect(observedToolSets[1]).toEqual(['Read', 'Grep'])
  })

  it('restores discovered LSP tools into the runtime request loop', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-lsp-loop-'))
    await mkdir(path.join(cwd, 'src'), { recursive: true })
    await writeFile(path.join(cwd, 'src', 'app.ts'), 'export const runTask = () => {}\n')
    const observedToolSets: string[][] = []
    const observedToolResults: string[] = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        observedToolSets.push(request.tools.map(tool => tool.name))
        const lspResult = request.messages.find(
          event =>
            event.type === 'tool-result' &&
            event.result.toolCallId === 'lsp-1',
        )
        if (lspResult?.type === 'tool-result') {
          observedToolResults.push(lspResult.result.content)
        }

        if (observedToolSets.length === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'tool-search-1',
                name: 'ToolSearch',
                input: { query: 'lsp' },
              },
            ],
            stopReason: 'tool_use',
          }
        }

        if (observedToolSets.length === 2) {
          const toolSearchResult = request.messages.find(
            event =>
              event.type === 'tool-result' &&
              event.result.toolCallId === 'tool-search-1',
          )
          expect(toolSearchResult).toMatchObject({
            type: 'tool-result',
            result: {
              ok: true,
              metadata: {
                discoveredTools: ['LSP'],
              },
            },
          })
          return {
            content: '',
            toolCalls: [
              {
                id: 'lsp-1',
                name: 'LSP',
                input: {
                  action: 'call_hierarchy',
                  filePath: 'src/app.ts',
                  line: 1,
                  character: 1,
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }

        return {
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const mockServer = {
      start: vi.fn(async () => undefined),
      sendNotification: vi.fn(async () => undefined),
      config: { languages: ['typescript'] },
    }
    const lspServerManager = {
      initialize: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      getAllServers: vi.fn(() => new Map([['ts', mockServer as any]])),
      getServerForFile: vi.fn(() => mockServer as any),
      getFileContent: vi.fn(async () => 'export const runTask = () => {}\n'),
      callHierarchy: vi.fn(async () => ({
        item: { name: 'runTask', kind: 12, uri: 'file:///src/app.ts' },
        incoming: [
          {
            from: { name: 'scheduleTask', kind: 12, uri: 'file:///src/entry.ts' },
          },
        ],
        outgoing: [
          {
            to: { name: 'stopTask', kind: 12, uri: 'file:///src/stop.ts' },
          },
        ],
      })),
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      permissionMode: 'bypass-local',
      lspServerManager: lspServerManager as any,
    })

    for await (const _event of runtime.runTurn({
      prompt: 'Find the LSP tool and inspect the call hierarchy',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect(observedToolSets[0]).toContain('ToolSearch')
    expect(observedToolSets[0]).not.toContain('LSP')
    expect(observedToolSets[1]).toContain('ToolSearch')
    expect(observedToolSets[1]).toContain('LSP')
    expect(observedToolResults).toHaveLength(1)
    expect(observedToolResults[0]).toContain('incoming calls')
    expect(observedToolResults[0]).toContain('scheduleTask')
  })

  it('replays compact-restored capabilities into the first resumed request', async () => {
    const observedRequests: Array<{ tools: string[]; contents: string[] }> = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        observedRequests.push({
          tools: request.tools.map(tool => tool.name),
          contents: request.messages
            .filter(
              (message): message is Extract<typeof message, { type: 'user' | 'assistant' }> =>
                'content' in message,
            )
            .map(message => message.content),
        })
        return {
          content: 'done',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      permissionMode: 'bypass-local',
      resume: {
        sessionId: 'resume-capability-replay',
        events: [
          {
            type: 'compact-boundary',
            summary: 'Previous work was compacted.',
            metadata: {
              trigger: 'manual',
              preEventCount: 6,
              messagesSummarized: 6,
              discoveredToolNames: ['LSP'],
              approvedPlan: 'Restore compact state',
              pendingPlan: 'Investigate compact replay',
              verificationNotes: ['Ran focused checks'],
              mcpInstructions: ['Use the filesystem MCP server for descriptors.'],
              memoryFreshness: 'stale',
            } as any,
            timestamp: '2026-05-18T00:00:00Z',
          },
        ] as any,
        sessionState: {
          phase: 'plan',
          permissionMode: 'read-only',
          prePlanPermissionMode: 'ask',
          todos: [],
          approvedPlan: 'Restore compact state',
          pendingPlan: 'Investigate compact replay',
          handoffReport: undefined,
          verificationNotes: ['Ran focused checks'],
          backgroundTasks: [],
          retainedTasks: [
            {
              id: 'agent-finished-1',
              type: 'subagent',
              command: 'subagent:finisher',
              startTime: '2026-05-18T00:00:00Z',
              status: 'completed',
              background: true,
              agentName: 'finisher',
              transcriptPath: '/tmp/project/.vigilon/subagents/finisher.jsonl',
              completedAt: '2026-05-18T00:00:02Z',
              terminalReason: 'subagent_completed',
              outputSummary: 'Background finisher completed.',
            },
          ],
          discoveredToolNames: ['LSP'],
          mcpInstructions: ['Use the filesystem MCP server for descriptors.'],
          memoryFreshness: 'stale',
        } as any,
      },
    })

    for await (const _event of runtime.runTurn({
      prompt: 'continue with restored capabilities',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect(observedRequests[0]?.tools).toContain('LSP')
    expect(
      observedRequests[0]?.contents.some(
        content =>
          content.includes('<vigilon_capability_replay') &&
          content.includes('Investigate compact replay') &&
          content.includes('filesystem MCP server') &&
          content.includes('retained_task id="agent-finished-1"') &&
          content.includes('output="Background finisher completed."') &&
          content.includes('memory_freshness="stale"'),
      ),
    ).toBe(true)
  })

  it('runs a local subagent with filtered tools and an isolated transcript', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-subagent-'))
    const sessionsDir = path.join(cwd, '.sessions')
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
      [
        '---',
        'description: Runtime investigator',
        'maxTurns: 3',
        'allowedTools:',
        '  - Read',
        '  - Grep',
        '---',
        'You are a focused runtime investigator.',
      ].join('\n'),
      'utf8',
    )
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'parent-session',
    })
    const observedToolSets: string[][] = []
    const observedCachePrefixes: Array<NonNullable<Parameters<ModelClient['createMessage']>[0]['cachePrefix']>> = []
    let requestCount = 0
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        requestCount += 1
        observedToolSets.push(request.tools.map(tool => tool.name))
        if (request.cachePrefix) observedCachePrefixes.push(request.cachePrefix)
        if (requestCount === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'agent-1',
                name: 'Agent',
                input: {
                  agent: 'researcher',
                  task: 'Inspect the runtime regressions',
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        if (requestCount === 2) {
          expect(request.tools.map(tool => tool.name)).toEqual(observedToolSets[0])
          expect(request.tools.map(tool => tool.name)).toEqual(
            expect.arrayContaining(['Agent', 'Read', 'Grep']),
          )
          const subagentPrompt = request.messages.find(
            event =>
              event.type === 'user' &&
              event.content.includes('You are a focused runtime investigator.'),
          )
          expect(subagentPrompt).toMatchObject({
            type: 'user',
            content: expect.stringContaining('You are a focused runtime investigator.'),
          })
          expect(subagentPrompt).toMatchObject({
            content: expect.stringContaining('Inspect the runtime regressions'),
          })
          return {
            content: 'Subagent found the regression source.',
            toolCalls: [],
            stopReason: 'end_turn',
          }
        }
        return {
          content: 'Delegation complete.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const taskManager = createTaskManager()
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      transcript,
      taskManager,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript,
      }),
    })

    const runtimeEvents = []
    for await (const event of runtime.runTurn({
      prompt: 'delegate the regression investigation',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      runtimeEvents.push(event)
    }

    expect(observedToolSets[0]).toContain('Agent')
    expect(observedCachePrefixes[1]).toMatchObject({
      source: 'fork-shared-prefix',
      parentCanonicalPrefixHash: observedCachePrefixes[0]?.canonicalPrefixHash,
    })
    const lifecycleEvents = runtimeEvents
      .filter(event => event.type === 'subagent-lifecycle')
      .map(event => event.event)
    expect(lifecycleEvents.map(event => event.status)).toEqual(
      expect.arrayContaining([
        'started',
        'model-request-started',
        'model-response-received',
        'completed',
      ]),
    )
    expect(lifecycleEvents[0]).toMatchObject({
      agentName: 'researcher',
      background: false,
      status: 'started',
    })
    const parentEvents = await transcript.readAll()
    expect(parentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'subagent-lifecycle',
          event: expect.objectContaining({
            agentName: 'researcher',
            status: 'completed',
            finalMessage: 'Subagent found the regression source.',
          }),
        }),
      ]),
    )
    const agentResult = parentEvents.find(
      event =>
        event.type === 'tool-result' &&
        event.result.metadata?.agentName === 'researcher',
    )
    expect(agentResult).toMatchObject({
      type: 'tool-result',
      result: {
        ok: true,
        metadata: {
          agentName: 'researcher',
          status: 'completed',
        },
      },
    })
    const transcriptPath = (agentResult as Extract<typeof agentResult, { type: 'tool-result' }>)
      ?.result.metadata?.transcriptPath
    expect(typeof transcriptPath).toBe('string')
    expect(transcriptPath).toContain(`${path.sep}subagents${path.sep}`)
    expect(taskManager.retainedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'subagent',
          agentName: 'researcher',
          parentSessionId: transcript.sessionId,
          status: 'completed',
        }),
      ]),
    )
  })

  it('runs a worktree-hosted subagent from an isolated cwd with host metadata', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-subagent-worktree-'))
    const sessionsDir = path.join(cwd, '.sessions')
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await writeFile(path.join(cwd, 'marker.txt'), 'source marker\n', 'utf8')
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'worker.md'),
      [
        '---',
        'description: Worktree worker',
        'maxTurns: 3',
        'host: worktree',
        'allowedTools:',
        '  - Bash',
        '---',
        'You are a focused worktree subagent.',
      ].join('\n'),
      'utf8',
    )
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'worktree-parent-session',
    })
    let requestCount = 0
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        requestCount += 1
        if (requestCount === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'agent-worktree-1',
                name: 'Agent',
                input: {
                  agent: 'worker',
                  task: 'Verify worktree isolation.',
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        if (requestCount === 2) {
          expect(request.tools.map(tool => tool.name)).toEqual(
            expect.arrayContaining(['Agent', 'Bash']),
          )
          const subagentPrompt = request.messages.find(
            event =>
              event.type === 'user' &&
              event.content.includes('Execution host: worktree'),
          )
          expect(subagentPrompt).toMatchObject({
            type: 'user',
            content: expect.stringContaining('Execution host: worktree'),
          })
          return {
            content: '',
            toolCalls: [
              {
                id: 'worktree-bash-1',
                name: 'Bash',
                input: {
                  command: 'pwd && test -f marker.txt && test ! -d .git && test ! -d .vigilon && printf subagent-output > subagent-output.txt',
                  description: 'Verify worktree cwd and copied source files',
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        if (requestCount === 3) {
          return {
            content: 'Worktree isolation verified.',
            toolCalls: [],
            stopReason: 'end_turn',
          }
        }
        const toolResult = request.messages.find(event => event.type === 'tool-result')
        expect(toolResult).toMatchObject({
          type: 'tool-result',
          result: {
            ok: true,
            metadata: {
              status: 'completed',
              taskHost: {
                host: 'worktree',
                worktreeDiff: {
                  status: 'changed',
                  filesChanged: 1,
                },
              },
            },
          },
        })
        return {
          content: 'Parent observed worktree handoff.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      transcript,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript,
      }),
    })

    for await (const _event of runtime.runTurn({
      prompt: 'delegate to worktree subagent',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      // Drain events.
    }

    const parentEvents = await transcript.readAll()
    const agentResult = parentEvents.find(
      event =>
        event.type === 'tool-result' &&
        event.result.metadata?.agentName === 'worker',
    )
    expect(agentResult).toMatchObject({
      type: 'tool-result',
      result: {
        metadata: {
          taskHost: {
            host: 'worktree',
            sourceCwd: cwd,
          },
        },
      },
    })
    const metadata = (agentResult as Extract<typeof agentResult, { type: 'tool-result' }>).result.metadata
    expect(metadata?.taskHost?.cwd).toContain('subagent-worktrees')
    expect(metadata?.taskHost?.worktreePath).toBe(metadata?.taskHost?.cwd)
    expect(metadata?.taskHost?.worktreeDiff?.patchPath).toContain('.worktree.patch')
    expect(metadata?.taskHost?.worktreeDiff?.changedFiles).toEqual([
      {
        path: 'subagent-output.txt',
        status: 'added',
      },
    ])
    const patch = await readFile(metadata?.taskHost?.worktreeDiff?.patchPath as string, 'utf8')
    expect(patch).toContain('diff --git a/subagent-output.txt b/subagent-output.txt')
    expect(patch).toContain('+subagent-output')
  })

  it('runs a git-worktree-hosted subagent on a real branch with HEAD provenance', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-subagent-git-worktree-'))
    await mkdir(path.join(cwd, '.vigilon', 'agents.local'), { recursive: true })
    await writeFile(path.join(cwd, 'marker.txt'), 'git worktree marker\n', 'utf8')
    await execFileAsync('git', ['init'], { cwd })
    await execFileAsync('git', ['config', 'user.email', 'vigilon@example.test'], { cwd })
    await execFileAsync('git', ['config', 'user.name', 'Vigilon Test'], { cwd })
    await execFileAsync('git', ['add', 'marker.txt'], { cwd })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd })
    const { stdout: baseHead } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents.local', 'worker.md'),
      [
        '---',
        'description: Git worktree worker',
        'maxTurns: 2',
        'host: git-worktree',
        'allowedTools:',
        '  - Bash',
        '---',
        'You are a focused git worktree subagent.',
      ].join('\n'),
      'utf8',
    )
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionId: 'git-worktree-parent-session',
    })
    let requestCount = 0
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        requestCount += 1
        if (requestCount === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'agent-git-worktree-1',
                name: 'Agent',
                input: {
                  agent: 'worker',
                  task: 'Verify git worktree isolation.',
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        if (requestCount === 2) {
          const subagentPrompt = request.messages.find(
            event =>
              event.type === 'user' &&
              event.content.includes('Execution host: git-worktree'),
          )
          expect(subagentPrompt).toMatchObject({
            type: 'user',
            content: expect.stringContaining('Execution host: git-worktree'),
          })
          expect(subagentPrompt).toMatchObject({
            type: 'user',
            content: expect.stringContaining('Git worktree base HEAD:'),
          })
          return {
            content: '',
            toolCalls: [
              {
                id: 'git-worktree-bash-1',
                name: 'Bash',
                input: {
                  command: 'test -f marker.txt && test -f .git && printf git-output > git-output.txt && git add git-output.txt',
                  description: 'Verify git worktree host isolation and stage output',
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        if (requestCount === 3) {
          return {
            content: 'Git worktree isolation verified.',
            toolCalls: [],
            stopReason: 'end_turn',
          }
        }
        const toolResult = request.messages.find(event => event.type === 'tool-result')
        expect(toolResult).toMatchObject({
          type: 'tool-result',
          result: {
            ok: true,
            metadata: {
              taskHost: {
                host: 'git-worktree',
                gitWorktree: {
                  baseHead: baseHead.trim(),
                },
              },
            },
          },
        })
        return {
          content: 'Parent observed git worktree handoff.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      transcript,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript,
      }),
    })

    for await (const _event of runtime.runTurn({
      prompt: 'delegate to git worktree subagent',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      // Drain events.
    }

    const parentEvents = await transcript.readAll()
    const agentResult = parentEvents.find(
      event =>
        event.type === 'tool-result' &&
        event.result.metadata?.agentName === 'worker',
    )
    const metadata = (agentResult as Extract<typeof agentResult, { type: 'tool-result' }>).result.metadata
    expect(metadata?.taskHost?.host).toBe('git-worktree')
    expect(metadata?.taskHost?.gitWorktree?.branchName).toContain('vigilon/subagent/worker/')
    expect(metadata?.taskHost?.gitWorktree?.baseHead).toBe(baseHead.trim())
    expect(metadata?.taskHost?.worktreeDiff?.strategy).toBe('git-worktree-diff')
    expect(metadata?.taskHost?.worktreeDiff?.baselineRef).toBe(baseHead.trim())
    expect(metadata?.taskHost?.worktreeDiff?.changedFiles).toEqual([
      {
        path: 'git-output.txt',
        status: 'added',
      },
    ])
    const patch = await readFile(metadata?.taskHost?.worktreeDiff?.patchPath as string, 'utf8')
    expect(patch).toContain('diff --git a/git-output.txt b/git-output.txt')
    expect(patch).toContain('+git-output')
    await expect(readFile(path.join(cwd, 'git-output.txt'), 'utf8')).rejects.toThrow()
  })

  it('passes a shared ToolUseContext with permission and transcript state', async () => {
    const transcript = new InMemoryTranscriptStore()
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        const hasToolResult = request.messages.some(
          message => message.type === 'tool-result',
        )
        return hasToolResult
          ? { content: 'finished', toolCalls: [], stopReason: 'end_turn' }
          : {
              content: '',
              toolCalls: [{ id: 'toolu_2', name: 'read_file', input: {} }],
              stopReason: 'tool_use',
            }
      },
    }
    const tool: Tool = {
      name: 'read_file',
      description: 'Read a file',
      readOnly: true,
      async invoke(_input, context) {
        expect(context.cwd).toBe('/tmp/project')
        const decision = await context.permissionGate.requestPermission({
          action: 'read',
          subject: 'README.md',
          risk: 'low',
          reason: 'read file contents',
        })
        return {
          toolCallId: 'toolu_2',
          ok: decision.allowed,
          content: decision.reason,
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([tool]),
      transcript,
      permissionGate: createLocalPermissionGate({
        mode: 'read-only',
        transcript,
      }),
    })

    for await (const _event of runtime.runTurn({
      prompt: 'read README',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    const events = await transcript.readAll()
    expect(events.map(event => event.type)).toContain('permission')
    expect(findPermission(events)?.decision.allowed).toBe(true)
  })

  it('builds model requests from the latest compact boundary plus preserved suffix', async () => {
    const transcript = new InMemoryTranscriptStore()
    await transcript.append({
      type: 'user',
      content: 'old user',
      timestamp: '2026-05-17T00:00:00Z',
    })
    await transcript.append({
      type: 'assistant',
      content: 'old assistant',
      timestamp: '2026-05-17T00:00:01Z',
    })
    await transcript.append({
      type: 'compact-boundary',
      summary: 'Earlier work was summarized.',
      metadata: {
        trigger: 'manual',
        preEventCount: 2,
        messagesSummarized: 2,
      },
      timestamp: '2026-05-17T00:00:02Z',
    })
    await transcript.append({
      type: 'user',
      content: 'preserved suffix',
      timestamp: '2026-05-17T00:00:03Z',
    })

    const requestMessageTypes: string[][] = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        requestMessageTypes.push(request.messages.map(message => message.type))
        return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
      },
    }
    const runtime = createVigilonAgentRuntime({ modelClient, transcript })

    for await (const _event of runtime.runTurn({
      prompt: 'continue',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect(requestMessageTypes).toEqual([
      ['compact-boundary', 'user', 'user', 'user'],
    ])
  })

  it('persists tool-result content replacement decisions before the next model request', async () => {
    const transcript = new InMemoryTranscriptStore()
    const observedToolResults: string[] = []
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        for (const event of request.messages) {
          if (event.type === 'tool-result') observedToolResults.push(event.result.content)
        }
        if (observedToolResults.length === 0) {
          return {
            content: '',
            toolCalls: [{ id: 'large-call', name: 'large_output', input: {} }],
            stopReason: 'tool_use',
          }
        }
        return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
      },
    }
    const tool: Tool = {
      name: 'large_output',
      description: 'Returns large output',
      async invoke() {
        return {
          toolCallId: 'large-call',
          ok: true,
          content: 'x'.repeat(80),
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([tool]),
      transcript,
      toolResultReplacementLimit: 20,
    })

    for await (const _event of runtime.runTurn({
      prompt: 'run large tool',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect(observedToolResults).toHaveLength(1)
    expect(observedToolResults[0]).toContain('vigilon_tool_result_replaced')
    expect((await transcript.readAll()).map(event => event.type)).toContain(
      'content-replacement',
    )
  })

  it('uses model input-token preflight for auto compact when no usage anchor exists', async () => {
    const transcript = new InMemoryTranscriptStore()
    await transcript.append({
      type: 'user',
      content: 'existing context with no provider usage anchor',
      timestamp: '2026-05-17T00:00:00Z',
    })
    const preflightRequests: Array<{ eventCount: number; toolCount: number }> = []
    const modelClient: ModelClient = {
      id: 'fake-provider:model-a',
      async countInputTokens(request) {
        preflightRequests.push({
          eventCount: request.messages.length,
          toolCount: request.tools.length,
        })
        return {
          ok: true,
          source: 'provider-chat-completion-usage',
          inputTokens: 900,
          usage: {
            inputTokens: 900,
            totalTokens: 901,
            cacheReadInputTokens: 700,
            cacheCreationInputTokens: 200,
          },
        }
      },
      async createMessage() {
        return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      transcript,
      autoCompactTokenBudget: 1_000,
      autoCompactPressureThreshold: 0.8,
    })

    for await (const _event of runtime.runTurn({
      prompt: 'continue',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect(preflightRequests).toHaveLength(1)
    const boundary = (await transcript.readAll()).find(
      (event): event is Extract<TranscriptEvent, { type: 'compact-boundary' }> =>
        event.type === 'compact-boundary',
    )
    expect(boundary?.metadata.tokenPressure).toMatchObject({
      estimatedTokens: 900,
      tokenBudget: 1000,
      tokenCountSource: 'provider-input-token-preflight',
      reason: 'token_pressure_exceeded',
      contextBudget: {
        estimator: {
          kind: 'provider-input-token-preflight',
          modelId: 'fake-provider:model-a',
          provider: 'fake-provider',
          inputTokens: 900,
          totalTokens: 901,
          cacheReadInputTokens: 700,
          cacheCreationInputTokens: 200,
        },
      },
    })
  })

  it('summarizes file diffs in the final result report', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-agentloop-diff-'))
    const transcript = new InMemoryTranscriptStore()
    try {
      const modelClient: ModelClient = {
        id: 'fake-model',
        async createMessage(request) {
          const hasWriteResult = request.messages.some(
            event => event.type === 'tool-result' && event.result.toolCallId === 'write-1',
          )
          return hasWriteResult
            ? { content: 'done', toolCalls: [], stopReason: 'end_turn' }
            : {
                content: '',
                toolCalls: [
                  {
                    id: 'write-1',
                    name: 'Write',
                    input: {
                      file_path: 'src/generated.ts',
                      content: 'export const value = 1\n',
                    },
                  },
                ],
                stopReason: 'tool_use',
              }
        },
      }
      const runtime = createVigilonAgentRuntime({
        modelClient,
        tools: createToolRegistry([WriteTool]),
        transcript,
        permissionMode: 'bypass-local',
      })

      let result
      for await (const event of runtime.runTurn({
        prompt: 'write file',
        cwd,
        abortSignal: new AbortController().signal,
      })) {
        if (event.type === 'turn-finished') result = event.result
      }

      expect(result?.report.fileChanges).toMatchObject([
        {
          toolCallId: 'write-1',
          toolName: 'Write',
          type: 'create',
        },
      ])
      expect(result?.report.fileChanges[0]?.diff).toContain(
        '+++ b/src/generated.ts',
      )
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('runs PreToolUse hooks and returns a blocked tool result without invoking the tool', async () => {
    const transcript = new InMemoryTranscriptStore()
    let invoked = false
    const hook: PreToolUseHook = {
      name: 'block-write',
      async evaluate(request) {
        expect(request.hookEventName).toBe('PreToolUse')
        expect(request.toolCall.name).toBe('write_file')
        return { outcome: 'block', reason: 'writes disabled by hook' }
      },
    }
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        const hasBlockedResult = request.messages.some(
          event =>
            event.type === 'tool-result' &&
            event.result.content.includes('writes disabled by hook'),
        )
        return hasBlockedResult
          ? { content: 'blocked', toolCalls: [], stopReason: 'end_turn' }
          : {
              content: '',
              toolCalls: [{ id: 'hook-call-1', name: 'write_file', input: {} }],
              stopReason: 'tool_use',
            }
      },
    }
    const tool: Tool = {
      name: 'write_file',
      description: 'Should not run',
      async invoke() {
        invoked = true
        return { toolCallId: '', ok: true, content: 'ran' }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([tool]),
      transcript,
      preToolUseHooks: [hook],
    })

    let result
    for await (const event of runtime.runTurn({
      prompt: 'try write',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') result = event.result
    }

    const events = await transcript.readAll()
    expect(invoked).toBe(false)
    expect(events.find(event => event.type === 'hook')).toMatchObject({
      hookName: 'block-write',
      decision: { outcome: 'block', reason: 'writes disabled by hook' },
    })
    expect(result?.report.toolResults).toContainEqual(
      expect.objectContaining({
        toolCallId: 'hook-call-1',
        ok: false,
        content: expect.stringContaining('PreToolUse hook blocked write_file'),
      }),
    )
  })

  it('records allow decisions from PreToolUse hooks before invoking the tool', async () => {
    const transcript = new InMemoryTranscriptStore()
    const hook: PreToolUseHook = {
      name: 'allow-echo',
      async evaluate() {
        return { outcome: 'allow', reason: 'echo is allowed' }
      },
    }
    const modelClient: ModelClient = {
      id: 'fake-model',
      async createMessage(request) {
        const hasResult = request.messages.some(
          event => event.type === 'tool-result' && event.result.toolCallId === 'echo-1',
        )
        return hasResult
          ? { content: 'done', toolCalls: [], stopReason: 'end_turn' }
          : {
              content: '',
              toolCalls: [{ id: 'echo-1', name: 'echo', input: {} }],
              stopReason: 'tool_use',
            }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([
        {
          name: 'echo',
          description: 'Echo',
          async invoke() {
            return { toolCallId: '', ok: true, content: 'echo result' }
          },
        },
      ]),
      transcript,
      preToolUseHooks: [hook],
    })

    for await (const _event of runtime.runTurn({
      prompt: 'echo',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      // Drain the runtime stream.
    }

    expect((await transcript.readAll()).filter(event => event.type === 'hook')).toMatchObject([
      {
        hookName: 'allow-echo',
        decision: { outcome: 'allow', reason: 'echo is allowed' },
      },
    ])
  })

  it('stops consistently after maxTurns when tool use keeps continuing', async () => {
    const modelClient: ModelClient = {
      id: 'looping-model',
      async createMessage() {
        return {
          content: '',
          toolCalls: [{ id: randomUUID(), name: 'echo', input: {} }],
          stopReason: 'tool_use',
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([
        {
          name: 'echo',
          description: 'Echo',
          async invoke() {
            return { toolCallId: '', ok: true, content: 'again' }
          },
        },
      ]),
      maxTurns: 2,
    })

    let result
    for await (const event of runtime.runTurn({
      prompt: 'loop',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') result = event.result
    }

    expect(result).toMatchObject({
      turns: 4,
      stopReason: 'max_turns',
      finalMessage: expect.stringContaining('safety limit'),
      report: { status: 'stopped' },
    })
  })

  it('does not apply an implicit 16-turn cap when maxTurns is omitted', async () => {
    let requests = 0
    const modelClient: ModelClient = {
      id: 'long-running-model',
      async createMessage() {
        requests += 1
        if (requests > 16) {
          return { content: 'done after implicit cap would have fired', toolCalls: [], stopReason: 'end_turn' }
        }
        return {
          content: '',
          toolCalls: [{ id: randomUUID(), name: 'echo', input: {} }],
          stopReason: 'tool_use',
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createToolRegistry([
        {
          name: 'echo',
          description: 'Echo',
          async invoke() {
            return { toolCallId: '', ok: true, content: 'again' }
          },
        },
      ]),
    })

    let result
    for await (const event of runtime.runTurn({
      prompt: 'loop past old cap',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') result = event.result
    }

    expect(requests).toBe(17)
    expect(result).toMatchObject({
      turns: 17,
      stopReason: 'end_turn',
      finalMessage: 'done after implicit cap would have fired',
      report: { status: 'completed' },
    })
  })

  it('does not force ResultReport on the final maxTurns request', async () => {
    const seenRequests: Array<{ messages: TranscriptEvent[]; tools: string[] }> = []
    const modelClient: ModelClient = {
      id: 'max-turns-model',
      async createMessage(request) {
        seenRequests.push({
          messages: request.messages,
          tools: request.tools.map(tool => tool.name),
        })
        if (seenRequests.length === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'echo-1', name: 'echo', input: {} }],
            stopReason: 'tool_use',
          }
        }
        return { content: 'natural final answer', toolCalls: [], stopReason: 'end_turn' }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      permissionMode: 'bypass-local',
      maxTurns: 2,
      stopAfterResultReport: true,
    })

    let result
    for await (const event of runtime.runTurn({
      prompt: 'produce a report',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') result = event.result
    }

    expect(seenRequests[0]?.tools).toContain('Read')
    expect(seenRequests[1]?.tools).toContain('Read')
    expect(seenRequests[1]?.tools).toContain('ResultReport')
    expect(
      seenRequests[1]?.messages.every(
        message =>
          message.type !== 'user' ||
          !message.content.includes('<vigilon_handoff_deadline>'),
      ),
    ).toBe(true)
    expect(result).toMatchObject({
      turns: 2,
      stopReason: 'end_turn',
      finalMessage: 'natural final answer',
      report: {
        status: 'completed',
      },
    })
  })

  it('keeps maxTurns as an explicit stop instead of generating a fallback report', async () => {
    const modelClient: ModelClient = {
      id: 'continuing-tool-model',
      async createMessage() {
        return {
          content: '',
          toolCalls: [
            {
              id: 'grep-1',
              name: 'Grep',
              input: { pattern: 'still searching' },
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
      maxTurns: 2,
      stopAfterResultReport: true,
    })

    let result
    for await (const event of runtime.runTurn({
      prompt: 'produce a report',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') result = event.result
    }

    expect(result).toMatchObject({
      turns: 4,
      stopReason: 'max_turns',
      finalMessage: expect.stringContaining('safety limit'),
      report: {
        status: 'stopped',
      },
    })
    expect(result?.report.handoffReport).toBeUndefined()
  })

  it('treats a text-only final answer as the result without requiring ResultReport', async () => {
    const modelClient: ModelClient = {
      id: 'text-only-final-model',
      async createMessage() {
        return {
          content: 'Natural language final answer.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      stopAfterResultReport: true,
    })

    let result
    for await (const event of runtime.runTurn({
      prompt: 'answer with a report',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') result = event.result
    }

    expect(result).toMatchObject({
      turns: 1,
      stopReason: 'end_turn',
      finalMessage: 'Natural language final answer.',
      report: {
        status: 'completed',
      },
    })
    expect(result?.report.handoffReport).toBeUndefined()
  })

  it('surfaces incomplete todos as warnings without changing final-result completion', async () => {
    let requestCount = 0
    const observedRequests: TranscriptEvent[][] = []
    const modelClient: ModelClient = {
      id: 'unfinished-todo-model',
      async createMessage(request) {
        observedRequests.push(request.messages)
        requestCount += 1
        if (requestCount === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'todo-1',
                name: 'TodoWrite',
                input: {
                  todos: [
                    { id: 'search', content: 'Search the repo', status: 'in_progress' },
                    { id: 'report', content: 'Write the answer', status: 'pending' },
                  ],
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: 'Natural language final answer with unfinished work.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      },
    }
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
    })

    let result
    for await (const event of runtime.runTurn({
      prompt: 'answer with visible task progress',
      cwd: '/tmp/project',
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') result = event.result
    }

    expect(result).toMatchObject({
      turns: 2,
      stopReason: 'end_turn',
      report: {
        status: 'completed',
        warnings: [
          expect.stringContaining('Assistant ended with 2 incomplete todo(s)'),
        ],
      },
    })
    const secondRequestProgress = observedRequests[1]?.find(
      event =>
        event.type === 'user' &&
        event.content.includes('<vigilon_runtime_progress>'),
    )
    expect(secondRequestProgress?.content).toContain('current_todos:')
    expect(secondRequestProgress?.content).toContain('- in_progress search: Search the repo')
    expect(secondRequestProgress?.content).toContain('- pending report: Write the answer')
    expect(secondRequestProgress?.content).toContain('Do not give a final answer')
  })
})

function findPermission(events: TranscriptEvent[]) {
  return events.find(event => event.type === 'permission')
}
