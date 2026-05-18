import { test, expect, describe, vi } from 'vitest';
import { createTaskManager } from '../src/runtime/taskManager';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('TaskManager', () => {
  test('should start and kill a bash task', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.pid = 123;
    mockProcess.kill = vi.fn();
    mockProcess.unref = vi.fn();
    (spawn as any).mockReturnValue(mockProcess);

    const manager = createTaskManager();
    const taskId = await manager.startBashTask('sleep 10', '/tmp');
    
    expect(taskId).toBeDefined();
    expect(manager.activeTasks.length).toBe(1);
    expect(manager.activeTasks[0].id).toBe(taskId);

    const killed = await manager.killTask(taskId);
    expect(killed).toBe(true);
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(manager.activeTasks.length).toBe(0);
  });

  test('should handle process exit', async () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.pid = 124;
    mockProcess.unref = vi.fn();
    (spawn as any).mockReturnValue(mockProcess);

    const manager = createTaskManager();
    const taskId = await manager.startBashTask('sleep 1', '/tmp');
    
    expect(manager.activeTasks.length).toBe(1);
    
    mockProcess.emit('exit');
    expect(manager.activeTasks.length).toBe(0);
  });

  test('should return false when killing non-existent task', async () => {
    const manager = createTaskManager();
    const killed = await manager.killTask('non-existent');
    expect(killed).toBe(false);
  });
});
