import { test, expect, describe, vi } from 'vitest';
import { TaskStopTool } from '../src/tools/taskStopTool';
import type { ToolUseContext } from '../src/runtime/contracts';

describe('TaskStopTool', () => {
  test('should route task termination through the shared stop path', async () => {
    const mockTaskManager = {
      stopTask: vi.fn().mockResolvedValue(true),
      killTask: vi.fn().mockResolvedValue(true),
    } as any;

    const context = {
      taskManager: mockTaskManager,
    } as unknown as ToolUseContext;

    const result = await TaskStopTool.invoke({ taskId: 'task-123' }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain('shared stop path');
    expect(mockTaskManager.stopTask).toHaveBeenCalledWith('task-123');
    expect(mockTaskManager.killTask).not.toHaveBeenCalled();
  });

  test('should fail if taskId is not found', async () => {
    const mockTaskManager = {
      stopTask: vi.fn().mockResolvedValue(false),
    } as any;

    const context = {
      taskManager: mockTaskManager,
    } as unknown as ToolUseContext;

    const result = await TaskStopTool.invoke({ taskId: 'task-unknown' }, context);

    expect(result.ok).toBe(false);
    expect(result.content).toContain('not found');
    expect(mockTaskManager.stopTask).toHaveBeenCalledWith('task-unknown');
  });

  test('should fail if taskId is missing', async () => {
    const context = {} as ToolUseContext;
    const result = await TaskStopTool.invoke({}, context);
    expect(result.ok).toBe(false);
  });
});
