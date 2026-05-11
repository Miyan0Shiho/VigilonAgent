/**
 * Stub for missing message types
 */

export type MessageOrigin = 'local' | 'remote';

export type SystemMessageLevel = 'info' | 'warn' | 'error';

export interface Message {
  id: string;
  type: string;
}

export interface UserMessage extends Message {
  type: 'user';
  content: any;
}

export interface AssistantMessage extends Message {
  type: 'assistant';
  content: any;
}

export interface SystemMessage extends Message {
  type: 'system';
  level: SystemMessageLevel;
  content: string;
}

export type NormalizedMessage = UserMessage | AssistantMessage | SystemMessage;
export type NormalizedUserMessage = UserMessage;
export type NormalizedAssistantMessage = AssistantMessage;

export interface AttachmentMessage extends Message { type: 'attachment' }
export interface ProgressMessage extends Message { type: 'progress' }
export interface SystemAgentsKilledMessage extends Message { type: 'system_agents_killed' }
export interface SystemAPIErrorMessage extends Message { type: 'system_api_error' }
export interface SystemApiMetricsMessage extends Message { type: 'system_api_metrics' }
export interface SystemAwaySummaryMessage extends Message { type: 'system_away_summary' }
export interface SystemBridgeStatusMessage extends Message { type: 'system_bridge_status' }
export interface SystemCompactBoundaryMessage extends Message { type: 'system_compact_boundary' }
export interface SystemInformationalMessage extends Message { type: 'system_informational' }
export interface SystemLocalCommandMessage extends Message { type: 'system_local_command' }
export interface SystemMemorySavedMessage extends Message { type: 'system_memory_saved' }
export interface SystemMicrocompactBoundaryMessage extends Message { type: 'system_microcompact_boundary' }
export interface SystemPermissionRetryMessage extends Message { type: 'system_permission_retry' }
export interface SystemScheduledTaskFireMessage extends Message { type: 'system_scheduled_task_fire' }
export interface SystemStopHookSummaryMessage extends Message { type: 'system_stop_hook_summary' }
export interface SystemTurnDurationMessage extends Message { type: 'system_turn_duration' }
export interface TombstoneMessage extends Message { type: 'tombstone' }
export interface ToolUseSummaryMessage extends Message { type: 'tool_use_summary' }

export type PartialCompactDirection = 'up' | 'down';
export type StopHookInfo = any;
export type StreamEvent = any;
export type RequestStartEvent = any;
