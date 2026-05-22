import { describe, expect, it } from 'vitest'
import {
  buildPermissionOriginSummary,
  renderPermissionOriginSummary,
} from '../src/runtime/permissionOrigins.js'
import type { TranscriptEvent } from '../src/index.js'

describe('permission origin summaries', () => {
  it('aggregates subagent permission events by action, origin, tool, and decision', () => {
    const events: TranscriptEvent[] = [
      {
        type: 'permission',
        request: {
          action: 'bash',
          subject: 'pnpm test',
          risk: 'medium',
          reason: 'Run tests',
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
          resolution: {
            id: 'perm-1',
            coordinator: 'resolve-once',
            status: 'resolved',
            source: 'operator',
            requestKey: 'key-1',
            queuedAt: '2026-05-21T00:00:00Z',
            resolvedAt: '2026-05-21T00:00:01Z',
          },
        },
        timestamp: '2026-05-21T00:00:01Z',
      },
      {
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
          resolution: {
            id: 'perm-2',
            coordinator: 'resolve-once',
            status: 'resolved',
            source: 'permission-mode',
            requestKey: 'key-2',
            queuedAt: '2026-05-21T00:00:02Z',
            resolvedAt: '2026-05-21T00:00:03Z',
          },
        },
        timestamp: '2026-05-21T00:00:03Z',
      },
    ]

    const summary = buildPermissionOriginSummary(events)

    expect(summary).toMatchObject({
      totalRequests: 2,
      allowed: 1,
      denied: 1,
      actions: expect.arrayContaining([
        { action: 'bash', count: 1, allowed: 1, denied: 0 },
        { action: 'write', count: 1, allowed: 0, denied: 1 },
      ]),
      agents: [
        {
          agentId: 'researcher',
          agentRole: 'subagent',
          parentAgentId: 'main',
          count: 2,
          allowed: 1,
          denied: 1,
          tools: ['Bash', 'Write'],
        },
      ],
      tools: expect.arrayContaining([
        { toolName: 'Bash', count: 1, allowed: 1, denied: 0 },
        { toolName: 'Write', count: 1, allowed: 0, denied: 1 },
      ]),
      resolutionSources: expect.arrayContaining([
        { source: 'operator', count: 1 },
        { source: 'permission-mode', count: 1 },
      ]),
      latest: expect.objectContaining({
        action: 'write',
        subject: 'report.md',
        allowed: false,
        origin: expect.objectContaining({
          agentRole: 'subagent',
          parentAgentId: 'main',
        }),
      }),
    })
    expect(renderPermissionOriginSummary(summary)).toEqual(
      expect.arrayContaining([
        'permissions=2 allow=1 deny=1',
        expect.stringContaining('permissionOrigins=subagent:researcher<-main count=2 allow=1 deny=1 tools=Bash,Write'),
      ]),
    )
  })
})
