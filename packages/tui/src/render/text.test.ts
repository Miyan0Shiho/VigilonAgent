import { describe, expect, it } from 'vitest'
import { renderAgentView, renderCompactResult } from './text.js'
import type { TuiAgentView, TuiCompactResult } from '../runtime/types.js'

describe('renderAgentView', () => {
  it('renders catalog, retained task, lifecycle, and resume evidence', () => {
    const rendered = renderAgentView({
      cwd: '/repo',
      sourcePrecedence: ['built-in', 'plugin', 'user', 'project', 'local', 'flag', 'managed'],
      definitions: [
        {
          name: 'researcher',
          source: 'local',
          description: 'Repo investigator',
          active: true,
          allowedTools: ['Read', 'Grep'],
        },
      ],
      tasks: [
        {
          sessionId: 'session-123456789',
          id: 'task-abcdef',
          agentName: 'researcher',
          status: 'completed',
          transcriptPath: '/repo/.vigilon/sessions/subagent.jsonl',
          outputSummary: 'Subagent inspected runtime state.',
          worktreeDiff: {
            status: 'changed',
            filesChanged: 1,
            additions: 1,
            deletions: 0,
            patchPath: '/repo/.vigilon/sessions/subagent.jsonl.worktree.patch',
            changedFiles: ['subagent-output.txt'],
            sourceApply: {
              status: 'applied',
              filesChanged: 1,
              appliedAt: '2026-05-20T00:00:03Z',
            },
          },
        },
      ],
      detail: {
        parentSessionId: 'session-123456789',
        task: {
          sessionId: 'session-123456789',
          id: 'task-abcdef',
          agentName: 'researcher',
          status: 'completed',
          worktreeDiff: {
            status: 'changed',
            filesChanged: 1,
            additions: 1,
            deletions: 0,
            patchPath: '/repo/.vigilon/sessions/subagent.jsonl.worktree.patch',
            changedFiles: ['subagent-output.txt'],
            sourceApply: {
              status: 'applied',
              filesChanged: 1,
            },
          },
        },
	        transcriptPath: '/repo/.vigilon/sessions/subagent.jsonl',
	        recentEvents: ['assistant: done'],
	        lifecycleEvents: ['completed agent=researcher task=task-abcdef'],
	        permissionSummary: {
	          totalRequests: 1,
	          allowed: 1,
	          denied: 0,
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
	          resolutionSources: [{ source: 'operator', count: 1 }],
	          latest: {
	            timestamp: '2026-05-21T00:00:00Z',
	            action: 'bash',
	            subject: 'pnpm test',
	            risk: 'medium',
	            allowed: true,
	            reason: 'operator approved',
	            origin: {
	              agentId: 'researcher',
	              agentRole: 'subagent',
	              parentAgentId: 'main',
	              toolName: 'Bash',
	            },
	          },
	        },
	        resumeResult: {
          status: 'completed',
          finalMessage: 'resumed cleanly',
        },
        stopResult: {
          ok: true,
          message: 'Stopped live subagent task task-abcdef through the shared task manager.',
        },
        applyResult: {
          status: 'applied',
          message: 'source apply applied',
        },
      },
    } satisfies TuiAgentView)

    expect(rendered).toContain('1 active definitions')
    expect(rendered).toContain('researcher · local')
    expect(rendered).toContain('/agents inspect session-123456789 task-abcdef')
    expect(rendered).toContain('lifecycle completed agent=researcher task=task-abcdef')
	    expect(rendered).toContain('resume completed: resumed cleanly')
	    expect(rendered).toContain('permissions 1 · allow 1 · deny 0 · bash:1')
	    expect(rendered).toContain('origins subagent:researcher<-main 1/1/0 · Bash')
	    expect(rendered).toContain('latest permission bash allow pnpm test')
	    expect(rendered).toContain('stop ok: Stopped live subagent task task-abcdef')
    expect(rendered).toContain('source apply applied · 1 files')
    expect(rendered).toContain('/agents apply session-123456789 task-abcdef --check')
    expect(rendered).toContain('--files subagent-output.txt')
    expect(rendered).toContain('apply applied: source apply applied')
  })
})

describe('renderCompactResult', () => {
  it('renders memory readiness, grounding, token pressure, and route evidence', () => {
    const rendered = renderCompactResult({
      sessionId: 'session-compact',
      transcriptPath: '/repo/.vigilon/sessions/session-compact.jsonl',
      compacted: true,
      summarySource: 'refreshed-session-memory',
      eventCount: 4,
      memoryReadiness: {
        before: null,
        after: 'fresh',
        ready: true,
        blockingReasons: [],
        validationRequired: true,
        refreshed: true,
        groundingValidation: {
          status: 'supported',
          modelId: 'deepseek:deepseek-v4-flash',
          reason: 'Provider grounded the memory against transcript evidence.',
        },
      },
      boundary: {
        route: {
          strategy: 'session-memory',
          reason: 'summary_available_without_custom_context',
        },
        tokenPressure: {
          tokenCountSource: 'provider-input-token-preflight',
          estimatedTokens: 900,
          tokenBudget: 1000,
          reason: 'token_pressure_exceeded',
        },
        postCompactCleanup: {
          completed: true,
        },
      },
    } satisfies TuiCompactResult)

    expect(rendered).toContain('compact   session-compact')
    expect(rendered).toContain('memory fresh · ready yes · refreshed yes')
    expect(rendered).toContain('grounding supported · deepseek:deepseek-v4-flash')
    expect(rendered).toContain('tokens provider-input-token-preflight · 900 / 1000')
    expect(rendered).toContain('route session-memory · cleanup complete')
  })
})
