export const PHASE1_INCLUDED_CAPABILITIES = [
  'agent-loop',
  'deepseek-v4-tool-calling',
  'tool-use-context',
  'permission-gate',
  'transcript-store',
  'resume',
  'read-tool',
  'grep-tool',
  'glob-tool',
  'edit-tool',
  'write-tool',
  'bash-tool',
  'todo-tool',
  'plan-mode',
  'context-governance',
  'local-settings',
  'pretooluse-hook',
  'mcp-loading',
  'skill-loading',
  'result-report',
] as const

export const PHASE2_INCLUDED_CAPABILITIES = [
  ...PHASE1_INCLUDED_CAPABILITIES,
  'llm-transport-streaming-retry',
  'deferred-tool-discovery',
  'tool-reference-delta-replay',
  'request-stability-audit',
  'lsp-structural-code-intelligence',
  'webfetch-domain-cache-summary',
  'notebook-cell-read-edit-insert-delete',
  'ask-user-question',
  'task-stop-shared-path',
  'config-runtime-mutation',
  'skill-allowed-tools-runtime-gate',
  'subagent-foundation',
] as const

export const PHASE1_EXCLUDED_SURFACES = [
  'remote-bridge',
  'multi-user',
  'enterprise-admin',
  'billing-license',
  'commercial-telemetry',
  'marketplace',
  'managed-policy',
  'desktop-mobile-slack-surfaces',
] as const

export type Phase1IncludedCapability =
  (typeof PHASE1_INCLUDED_CAPABILITIES)[number]
export type Phase2IncludedCapability =
  (typeof PHASE2_INCLUDED_CAPABILITIES)[number]

export type Phase1ExcludedSurface = (typeof PHASE1_EXCLUDED_SURFACES)[number]

export type Phase1RuntimeBaseline = {
  phase: 'phase-1'
  runtime: 'solo-runtime'
  sourcePolicy: 'copy-first-claude-code-mechanisms'
  includedCapabilities: readonly Phase1IncludedCapability[]
  excludedSurfaces: readonly Phase1ExcludedSurface[]
}

export type Phase2RuntimeBaseline = {
  phase: 'phase-2'
  runtime: 'claude-code-core-capability-alignment'
  sourcePolicy: 'copy-first-claude-code-mechanisms'
  includedCapabilities: readonly Phase2IncludedCapability[]
  excludedSurfaces: readonly Phase1ExcludedSurface[]
}

export function createPhase1RuntimeBaseline(): Phase1RuntimeBaseline {
  return {
    phase: 'phase-1',
    runtime: 'solo-runtime',
    sourcePolicy: 'copy-first-claude-code-mechanisms',
    includedCapabilities: PHASE1_INCLUDED_CAPABILITIES,
    excludedSurfaces: PHASE1_EXCLUDED_SURFACES,
  }
}

export function createPhase2RuntimeBaseline(): Phase2RuntimeBaseline {
  return {
    phase: 'phase-2',
    runtime: 'claude-code-core-capability-alignment',
    sourcePolicy: 'copy-first-claude-code-mechanisms',
    includedCapabilities: PHASE2_INCLUDED_CAPABILITIES,
    excludedSurfaces: PHASE1_EXCLUDED_SURFACES,
  }
}
