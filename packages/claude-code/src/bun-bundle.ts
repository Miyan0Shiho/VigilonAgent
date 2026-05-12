/**
 * Mock for bun:bundle feature flags
 */
export function feature(name: string): boolean {
  // Default to true for most features to enable them during study
  const features: Record<string, boolean> = {
    'VOICE_MODE': false,
    'LSP_ENABLED': true,
    'MCP_ENABLED': true,
    'DUMP_SYSTEM_PROMPT': true,
    'DAEMON': false,
    'BRIDGE_MODE': false,
    'BG_SESSIONS': false,
    'TEMPLATES': false,
    'EXTRACT_MEMORIES': false,
    'REACTIVE_COMPACT': false,
    'CONTEXT_COLLAPSE': false,
    'BYOC_ENVIRONMENT_RUNNER': true,
    'SELF_HOSTED_RUNNER': true,
    'ABLATION_BASELINE': false,
    'TRANSCRIPT_CLASSIFIER': true,
  };
  return features[name] ?? false;
}

// Runtime Mock for build-time MACRO
if (typeof globalThis !== 'undefined' && !(globalThis as any).MACRO) {
  (globalThis as any).MACRO = {
    VERSION: '2.1.88-vigilon',
    IS_LOCAL: true,
  };
}
