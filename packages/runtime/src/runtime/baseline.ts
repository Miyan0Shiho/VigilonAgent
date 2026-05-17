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
  'result-report',
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

export type Phase1ExcludedSurface = (typeof PHASE1_EXCLUDED_SURFACES)[number]

export type Phase1RuntimeBaseline = {
  phase: 'phase-1'
  runtime: 'solo-runtime'
  sourcePolicy: 'copy-first-claude-code-mechanisms'
  includedCapabilities: readonly Phase1IncludedCapability[]
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
