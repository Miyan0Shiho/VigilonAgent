import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';

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

    const success = await context.taskManager.killTask(taskId);
    if (success) {
      return ok(`Task ${taskId} terminated successfully.`);
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
