import type {
  PermissionDecision,
  PermissionGate,
  PermissionMode,
  PermissionRequest,
  PermissionResolutionMetadata,
  TranscriptStore,
} from './contracts.js'
import { createTimestamp } from './transcript.js'

export type LocalPermissionGateOptions = {
  mode?: PermissionMode
  transcript?: TranscriptStore
}

export type PermissionResolutionSource =
  | 'safety-policy'
  | 'permission-mode'
  | 'operator'

export type PermissionResolutionResult = {
  decision: PermissionDecision
  source: PermissionResolutionSource
}

export type PermissionResolver = (
  request: PermissionRequest,
) => Promise<PermissionResolutionResult> | PermissionResolutionResult

export type PermissionResolutionCoordinator = {
  resolve(
    request: PermissionRequest,
    resolver: PermissionResolver,
  ): Promise<PermissionDecision>
}

export function createLocalPermissionGate(
  options: LocalPermissionGateOptions = {},
): PermissionGate {
  let mode = options.mode ?? 'ask'
  const coordinator = createPermissionResolutionCoordinator()

  return {
    async requestPermission(
      request: PermissionRequest,
    ): Promise<PermissionDecision> {
      const decision = await coordinator.resolve(request, currentRequest => ({
        decision: decidePermission(mode, currentRequest),
        source: currentRequest.policy?.sandboxDecision === 'denied'
          ? 'safety-policy'
          : 'permission-mode',
      }))
      await options.transcript?.append({
        type: 'permission',
        request,
        decision,
        timestamp: createTimestamp(),
      })
      return decision
    },
  }
}

export function createMutablePermissionGate(
  options: LocalPermissionGateOptions = {},
): PermissionGate & {
  setMode(mode: PermissionMode): void
  getMode(): PermissionMode
} {
  let mode = options.mode ?? 'ask'
  const coordinator = createPermissionResolutionCoordinator()
  return {
    setMode(nextMode: PermissionMode) {
      mode = nextMode
    },
    getMode() {
      return mode
    },
    async requestPermission(
      request: PermissionRequest,
    ): Promise<PermissionDecision> {
      const decision = await coordinator.resolve(request, currentRequest => ({
        decision: decidePermission(mode, currentRequest),
        source: currentRequest.policy?.sandboxDecision === 'denied'
          ? 'safety-policy'
          : 'permission-mode',
      }))
      await options.transcript?.append({
        type: 'permission',
        request,
        decision,
        timestamp: createTimestamp(),
      })
      return decision
    },
  }
}

export function createPermissionResolutionCoordinator(): PermissionResolutionCoordinator {
  const inFlight = new Map<
    string,
    {
      id: string
      queuedAt: string
      promise: Promise<PermissionResolutionResult>
    }
  >()

  return {
    async resolve(
      request: PermissionRequest,
      resolver: PermissionResolver,
    ): Promise<PermissionDecision> {
      const requestKey = buildPermissionRequestKey(request)
      const existing = inFlight.get(requestKey)
      if (existing) {
        const resolvedAt = createTimestamp()
        const result = await existing.promise
        return withResolution(result.decision, {
          id: existing.id,
          coordinator: 'resolve-once',
          status: 'joined',
          source: 'coordinator',
          requestKey,
          queuedAt: existing.queuedAt,
          resolvedAt,
        })
      }

      const id = createPermissionResolutionId(requestKey)
      const queuedAt = createTimestamp()
      const promise = Promise.resolve(resolver(request))
      inFlight.set(requestKey, { id, queuedAt, promise })
      try {
        const result = await promise
        const resolvedAt = createTimestamp()
        return withResolution(result.decision, {
          id,
          coordinator: 'resolve-once',
          status: 'resolved',
          source: result.source,
          requestKey,
          queuedAt,
          resolvedAt,
        })
      } finally {
        inFlight.delete(requestKey)
      }
    },
  }
}

export function buildPermissionRequestKey(request: PermissionRequest): string {
  return JSON.stringify({
    action: request.action,
    subject: request.subject,
    risk: request.risk,
    origin: request.origin
      ? {
          agentId: request.origin.agentId,
          agentRole: request.origin.agentRole,
          parentAgentId: request.origin.parentAgentId,
          toolName: request.origin.toolName,
        }
      : null,
    policy: request.policy
      ? {
          kind: request.policy.kind,
          risk: request.policy.risk,
          sandboxDecision: request.policy.sandboxDecision,
          readOnly: request.policy.readOnly,
          reason: request.policy.reason,
          findings: request.policy.findings,
          pathRefs: request.policy.pathRefs,
          surrogate: request.policy.surrogate,
        }
      : null,
  })
}

function withResolution(
  decision: PermissionDecision,
  resolution: PermissionResolutionMetadata,
): PermissionDecision {
  return {
    ...decision,
    resolution,
  }
}

function createPermissionResolutionId(requestKey: string): string {
  let hash = 0
  for (let index = 0; index < requestKey.length; index += 1) {
    hash = (hash * 31 + requestKey.charCodeAt(index)) >>> 0
  }
  return `perm-${hash.toString(16).padStart(8, '0')}`
}

export function decidePermission(
  mode: PermissionMode,
  request: PermissionRequest,
): PermissionDecision {
  const withRequestMetadata = (
    decision: Omit<PermissionDecision, 'origin' | 'policy'>,
  ): PermissionDecision => ({
    ...decision,
    ...(request.origin ? { origin: request.origin } : {}),
    ...(request.policy ? { policy: request.policy } : {}),
  })

  if (request.policy?.sandboxDecision === 'denied') {
    return withRequestMetadata({
      allowed: false,
      reason: `safety policy denied action: ${request.policy.reason}`,
    })
  }

  if (mode === 'bypass-local') {
    return withRequestMetadata({
      allowed: true,
      reason: 'bypass-local mode allows local actions',
    })
  }

  if (mode === 'read-only') {
    const allowed =
      request.action === 'read' ||
      request.action === 'ask-user' ||
      (request.action === 'bash' && request.risk === 'low')
    return {
      ...(request.origin ? { origin: request.origin } : {}),
      ...(request.policy ? { policy: request.policy } : {}),
      allowed,
      reason: allowed
        ? request.action === 'ask-user'
          ? 'read-only mode allows structured operator clarification'
          : 'read-only mode allows read actions and low-risk shell observations'
        : 'read-only mode blocks mutating actions',
    }
  }

  if (mode === 'accept-edits') {
    const allowed =
      request.action === 'read' ||
      request.action === 'ask-user' ||
      request.action === 'plan-approval' ||
      ((request.action === 'write' || request.action === 'edit') &&
        request.risk === 'low')
    return {
      ...(request.origin ? { origin: request.origin } : {}),
      ...(request.policy ? { policy: request.policy } : {}),
      allowed,
      reason:
        request.action === 'plan-approval'
          ? 'accept-edits mode allows approved plans to enter execution'
          : allowed
            ? 'accept-edits mode allows low-risk local reads and edits'
            : 'accept-edits mode requires explicit approval for this action',
    }
  }

  return withRequestMetadata({
    allowed:
      (request.risk === 'low' && request.action === 'read') ||
      request.action === 'ask-user',
    reason:
      request.action === 'ask-user'
        ? 'ask mode allows structured operator clarification'
        : request.risk === 'low' && request.action === 'read'
        ? 'ask mode auto-allows low-risk reads in the non-interactive shell'
        : 'ask mode blocks actions until an interactive approval surface exists',
  })
}
