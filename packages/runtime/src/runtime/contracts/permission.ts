// Permission types for Vigilon Agent runtime.

export type PermissionRequest = {
  action:
    | 'read'
    | 'write'
    | 'edit'
    | 'bash'
    | 'network'
    | 'ask-user'
    | 'external-tool'
    | 'plan-approval'
  subject: string
  risk: 'low' | 'medium' | 'high'
  reason: string
  origin?: PermissionOrigin
  policy?: PermissionPolicyMetadata
}

export type PermissionDecision = {
  allowed: boolean
  reason: string
  origin?: PermissionOrigin
  policy?: PermissionPolicyMetadata
  resolution?: PermissionResolutionMetadata
}

export type PermissionGate = {
  requestPermission(request: PermissionRequest): Promise<PermissionDecision>
}

export type PermissionResolutionMetadata = {
  id: string
  coordinator: 'resolve-once'
  status: 'resolved' | 'joined'
  source:
    | 'safety-policy'
    | 'permission-mode'
    | 'operator'
    | 'coordinator'
  requestKey: string
  queuedAt: string
  resolvedAt: string
}

export type PermissionOrigin = {
  agentId: string
  agentRole: 'main' | 'subagent'
  toolName?: string
  parentAgentId?: string
}

export type PermissionOriginActionSummary = {
  action: PermissionRequest['action']
  count: number
  allowed: number
  denied: number
}

export type PermissionOriginRiskSummary = {
  risk: PermissionRequest['risk']
  count: number
  allowed: number
  denied: number
}

export type PermissionOriginAgentSummary = {
  agentId: string
  agentRole: PermissionOrigin['agentRole']
  parentAgentId?: string
  count: number
  allowed: number
  denied: number
  tools: string[]
}

export type PermissionOriginToolSummary = {
  toolName: string
  count: number
  allowed: number
  denied: number
}

export type PermissionResolutionSourceSummary = {
  source: string
  count: number
}

export type PermissionOriginLatestRequest = {
  timestamp: string
  action: PermissionRequest['action']
  subject: string
  risk: PermissionRequest['risk']
  allowed: boolean
  reason: string
  origin?: PermissionOrigin
  policy?: PermissionPolicyMetadata
}

export type PermissionOriginSummary = {
  totalRequests: number
  allowed: number
  denied: number
  actions: PermissionOriginActionSummary[]
  risks: PermissionOriginRiskSummary[]
  agents: PermissionOriginAgentSummary[]
  tools: PermissionOriginToolSummary[]
  resolutionSources: PermissionResolutionSourceSummary[]
  latest?: PermissionOriginLatestRequest
}

export type PermissionPolicyMetadata = {
  kind: 'bash-safety'
  risk: 'low' | 'medium' | 'high'
  sandboxDecision: 'sandboxed' | 'unsandboxed' | 'ask' | 'denied'
  readOnly: boolean
  reason: string
  findings: string[]
  subcommands: Array<{
    command: string
    executable: string
    operation: 'read' | 'write' | 'network' | 'unknown'
  }>
  pathRefs: string[]
  surrogate?: {
    kind: 'sed-edit'
    filePath: string
  }
}

export type PermissionMode = 'read-only' | 'ask' | 'accept-edits' | 'bypass-local'
