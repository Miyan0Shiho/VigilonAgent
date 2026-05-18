import type {
  PermissionDecision,
  PermissionGate,
  PermissionMode,
  PermissionRequest,
  TranscriptStore,
} from './contracts.js'
import { createTimestamp } from './transcript.js'

export type LocalPermissionGateOptions = {
  mode?: PermissionMode
  transcript?: TranscriptStore
}

export function createLocalPermissionGate(
  options: LocalPermissionGateOptions = {},
): PermissionGate {
  let mode = options.mode ?? 'ask'

  return {
    async requestPermission(
      request: PermissionRequest,
    ): Promise<PermissionDecision> {
      const decision = decidePermission(mode, request)
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
      const decision = decidePermission(mode, request)
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

export function decidePermission(
  mode: PermissionMode,
  request: PermissionRequest,
): PermissionDecision {
  if (mode === 'bypass-local') {
    return { allowed: true, reason: 'bypass-local mode allows local actions' }
  }

  if (mode === 'read-only') {
    const allowed =
      request.action === 'read' ||
      request.action === 'ask-user' ||
      (request.action === 'bash' && request.risk === 'low')
    return {
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
      allowed,
      reason:
        request.action === 'plan-approval'
          ? 'accept-edits mode allows approved plans to enter execution'
          : allowed
            ? 'accept-edits mode allows low-risk local reads and edits'
            : 'accept-edits mode requires explicit approval for this action',
    }
  }

  return {
    allowed:
      (request.risk === 'low' && request.action === 'read') ||
      request.action === 'ask-user',
    reason:
      request.action === 'ask-user'
        ? 'ask mode allows structured operator clarification'
        : request.risk === 'low' && request.action === 'read'
        ? 'ask mode auto-allows low-risk reads in the non-interactive shell'
        : 'ask mode blocks actions until an interactive approval surface exists',
  }
}
