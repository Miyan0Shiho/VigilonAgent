import type {
  HookDecision,
  PreToolUseHook,
  ToolCall,
  TranscriptStore,
} from './contracts.js'
import { createTimestamp } from './transcript.js'

export type RunPreToolUseHooksOptions = {
  hooks: readonly PreToolUseHook[]
  toolCall: ToolCall
  cwd: string
  transcript: TranscriptStore
}

export async function runPreToolUseHooks(
  options: RunPreToolUseHooksOptions,
): Promise<HookDecision> {
  for (const hook of options.hooks) {
    const decision = await hook.evaluate({
      hookEventName: 'PreToolUse',
      toolCall: options.toolCall,
      cwd: options.cwd,
    })
    await options.transcript.append({
      type: 'hook',
      hookEventName: 'PreToolUse',
      hookName: hook.name,
      toolCall: options.toolCall,
      decision,
      timestamp: createTimestamp(),
    })
    if (decision.outcome === 'block') return decision
  }
  return { outcome: 'allow', reason: 'No PreToolUse hook blocked the tool call' }
}
