import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';
import { createTimestamp } from '../runtime/transcript.js';

export const TaskStopTool: Tool = {
  name: 'TaskStop',
  description: 'Terminates a background task (e.g., a server started with Bash background=true).',
  inputJsonSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'The unique ID of the task to terminate' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { taskId } = input as { taskId: string };
    if (!taskId) return failed('taskId is required');

    const success = await context.taskManager.stopTask(taskId);
    if (success) {
      if (context.sessionState) {
        context.sessionState.backgroundTasks = context.taskManager.activeTasks.map(task => ({
          ...task,
        }));
        await context.transcript.append({
          type: 'session-state',
          phase: context.sessionState.phase,
          permissionMode: context.sessionState.permissionMode,
          prePlanPermissionMode: context.sessionState.prePlanPermissionMode ?? null,
          todos: context.sessionState.todos.map(todo => ({ ...todo })),
          approvedPlan: context.sessionState.approvedPlan ?? null,
          pendingPlan: context.sessionState.pendingPlan ?? null,
          handoffReport: context.sessionState.handoffReport
            ? {
                finalMessage: context.sessionState.handoffReport.finalMessage,
                changes: [...context.sessionState.handoffReport.changes],
                verified: [...context.sessionState.handoffReport.verified],
                unverified: [...context.sessionState.handoffReport.unverified],
                risks: [...context.sessionState.handoffReport.risks],
              }
            : null,
          verificationNotes: [...context.sessionState.verificationNotes],
          backgroundTasks: context.sessionState.backgroundTasks.map(task => ({ ...task })),
          discoveredToolNames: [...context.sessionState.discoveredToolNames],
          toolReferenceDeltas: [...context.sessionState.toolReferenceDeltas],
          mcpInstructions: [...context.sessionState.mcpInstructions],
          activeSkill: context.sessionState.activeSkill
            ? { ...context.sessionState.activeSkill }
            : null,
          memoryFreshness: context.sessionState.memoryFreshness ?? null,
          systemPrompt: context.sessionState.systemPrompt ?? null,
          toolSchema: context.sessionState.toolSchema ?? null,
          modelParams: context.sessionState.modelParams ?? null,
          timestamp: createTimestamp(),
        });
      }
      return ok(`Task ${taskId} terminated through the shared stop path.`);
    } else {
      return failed(`Task ${taskId} not found or could not be terminated.`);
    }
  },
};

function ok(content: string): ToolResult {
  return { toolCallId: '', ok: true, content };
}

function failed(content: string): ToolResult {
  return { toolCallId: '', ok: false, content };
}
