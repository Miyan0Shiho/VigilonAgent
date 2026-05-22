import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentInventoryTool, type ToolUseContext } from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('AgentInventoryTool', () => {
  it('lists catalog override relationships and task lifecycle state', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-agent-inventory-'))
    tempRoots.push(cwd)
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await mkdir(path.join(cwd, '.vigilon', 'agents.local'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
      [
        '---',
        'description: Project researcher',
        'maxTurns: 2',
        'allowedTools:',
        '  - Read',
        '---',
        'Project researcher prompt.',
      ].join('\n'),
      'utf8',
    )
	    await writeFile(
	      path.join(cwd, '.vigilon', 'agents.local', 'researcher.md'),
      [
        '---',
        'description: Local researcher override',
        'maxTurns: 4',
        'memory: none',
        'background: true',
        'allowedTools:',
        '  - Grep',
        '---',
        'Local researcher prompt.',
      ].join('\n'),
	      'utf8',
	    )
	    const runningTranscriptPath = path.join(cwd, 'researcher-running.jsonl')
	    const finishedTranscriptPath = path.join(cwd, 'researcher-finished.jsonl')
	    await writeFile(
	      runningTranscriptPath,
	      `${JSON.stringify({
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
	        timestamp: '2026-05-20T00:00:00Z',
	      })}\n`,
	      'utf8',
	    )
	    await writeFile(
	      finishedTranscriptPath,
	      `${JSON.stringify({
	        type: 'permission',
	        request: {
	          action: 'write',
	          subject: 'report.md',
	          risk: 'high',
	          reason: 'Write report',
	          origin: {
	            agentId: 'researcher',
	            agentRole: 'subagent',
	            parentAgentId: 'main',
	            toolName: 'Write',
	          },
	        },
	        decision: {
	          allowed: false,
	          reason: 'read-only mode blocks mutating actions',
	        },
	        timestamp: '2026-05-20T00:00:01Z',
	      })}\n`,
	      'utf8',
	    )

	    const context = {
      cwd,
      taskManager: {
        activeTasks: [
          {
            id: 'agent-running-1',
            type: 'subagent',
            command: 'subagent:researcher',
            startTime: '2026-05-20T00:00:00Z',
            status: 'running',
            background: true,
            agentName: 'researcher',
	            transcriptPath: runningTranscriptPath,
            parentAgentId: 'main',
          },
        ],
        retainedTasks: [],
      },
      sessionState: {
        retainedTasks: [
          {
            id: 'agent-finished-1',
            type: 'subagent',
            command: 'subagent:researcher',
            startTime: '2026-05-20T00:00:01Z',
            status: 'completed',
            background: true,
            agentName: 'researcher',
	            transcriptPath: finishedTranscriptPath,
            parentAgentId: 'main',
            completedAt: '2026-05-20T00:00:02Z',
            terminalReason: 'subagent_completed',
            outputSummary: 'Researcher completed.',
            worktreeDiff: {
              strategy: 'copy-baseline-diff',
              status: 'changed',
              sourceCwd: cwd,
              baselinePath: '/tmp/baseline',
              worktreePath: '/tmp/worktree',
              patchPath: '/tmp/researcher-finished.patch',
              filesChanged: 1,
              additions: 1,
              deletions: 0,
              changedFiles: [{ path: 'report.md', status: 'added' }],
              sourceApply: {
                strategy: 'git-apply-after-baseline-check',
                mode: 'apply',
                status: 'applied',
                sourceCwd: cwd,
                baselinePath: '/tmp/baseline',
                worktreePath: '/tmp/worktree',
                patchPath: '/tmp/researcher-finished.patch',
                threeWay: false,
                filesChanged: 1,
                checkedFiles: ['report.md'],
                appliedFiles: ['report.md'],
                skippedFiles: [],
                appliedAt: '2026-05-20T00:00:03Z',
              },
            },
          },
        ],
      },
      permissionGate: { requestPermission: vi.fn() },
      transcript: { append: vi.fn(), readAll: vi.fn(), replace: vi.fn() },
      lspServerManager: {},
      tools: { list: () => [], find: () => undefined },
    } as unknown as ToolUseContext

    const result = await AgentInventoryTool.invoke({}, context)

    expect(result.ok).toBe(true)
    expect(result.content).toContain('source precedence: built-in -> plugin -> user -> project -> local -> flag -> managed')
    expect(result.content).toContain('researcher')
    expect(result.content).toContain('overriddenBy=local')
    expect(result.content).toContain('agent-running-1')
	    expect(result.content).toContain('agent-finished-1')
	    expect(result.content).toContain('sourceApply=applied:1 files')
	    expect(result.content).toContain('permissions=1 allow=0 deny=1')
	    expect(result.content).toContain('permissionOrigins=subagent:researcher<-main count=1 allow=0 deny=1 tools=Write')
	    expect(result.metadata).toMatchObject({
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
        active: expect.arrayContaining([
          expect.objectContaining({
            name: 'researcher',
            source: 'local',
            allowedTools: ['Grep'],
            background: true,
            memory: 'none',
          }),
        ]),
        entries: expect.arrayContaining([
          expect.objectContaining({
            name: 'researcher',
            source: 'project',
            active: false,
            overriddenBy: 'local',
          }),
        ]),
      },
      tasks: {
        active: expect.arrayContaining([
          expect.objectContaining({
            id: 'agent-running-1',
            status: 'running',
          }),
        ]),
	        retained: expect.arrayContaining([
	          expect.objectContaining({
	            id: 'agent-finished-1',
	            status: 'completed',
	            outputSummary: 'Researcher completed.',
	            permissionSummary: expect.objectContaining({
	              totalRequests: 1,
	              denied: 1,
	              agents: [
	                expect.objectContaining({
	                  agentRole: 'subagent',
	                  parentAgentId: 'main',
	                  tools: ['Write'],
	                }),
	              ],
	            }),
	          }),
	        ]),
      },
    })
  })
})
