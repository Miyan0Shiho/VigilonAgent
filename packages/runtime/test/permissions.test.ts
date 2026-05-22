import { describe, expect, it } from 'vitest'
import {
  createLocalPermissionGate,
  createPermissionResolutionCoordinator,
  InMemoryTranscriptStore,
  type PermissionRequest,
} from '../src/index.js'

describe('permission resolution coordinator', () => {
  it('resolves duplicate in-flight permission requests once and joins later callers', async () => {
    const coordinator = createPermissionResolutionCoordinator()
    const request: PermissionRequest = {
      action: 'bash',
      subject: 'echo shared',
      risk: 'medium',
      reason: 'shared permission prompt',
    }
    let resolverCalls = 0

    const [first, second] = await Promise.all([
      coordinator.resolve(request, async () => {
        resolverCalls += 1
        await new Promise(resolve => setTimeout(resolve, 10))
        return {
          decision: { allowed: false, reason: 'operator denied once' },
          source: 'operator',
        }
      }),
      coordinator.resolve(request, async () => {
        resolverCalls += 1
        return {
          decision: { allowed: true, reason: 'should not run' },
          source: 'operator',
        }
      }),
    ])

    expect(resolverCalls).toBe(1)
    expect(first).toMatchObject({
      allowed: false,
      reason: 'operator denied once',
      resolution: {
        coordinator: 'resolve-once',
        status: 'resolved',
        source: 'operator',
      },
    })
    expect(second).toMatchObject({
      allowed: false,
      reason: 'operator denied once',
      resolution: {
        coordinator: 'resolve-once',
        status: 'joined',
        source: 'coordinator',
      },
    })
    expect(second.resolution?.id).toBe(first.resolution?.id)
    expect(second.resolution?.requestKey).toBe(first.resolution?.requestKey)
  })

  it('records resolve-once metadata in permission transcript events', async () => {
    const transcript = new InMemoryTranscriptStore('permission-resolution')
    const gate = createLocalPermissionGate({ mode: 'read-only', transcript })
    const request: PermissionRequest = {
      action: 'bash',
      subject: 'sh -c "echo wrapped"',
      risk: 'medium',
      reason: 'wrapper needs approval',
    }

    const [first, second] = await Promise.all([
      gate.requestPermission(request),
      gate.requestPermission(request),
    ])
    const permissions = (await transcript.readAll()).filter(
      event => event.type === 'permission',
    )

    expect(first.resolution?.status).toBe('resolved')
    expect(second.resolution?.status).toBe('joined')
    expect(permissions).toHaveLength(2)
    expect(permissions.map(event => event.decision.resolution?.status)).toEqual([
      'resolved',
      'joined',
    ])
  })
})
