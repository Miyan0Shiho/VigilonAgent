import { test, expect, describe, vi } from 'vitest';
import { createTaskManager } from '../src/runtime/taskManager';
import { writeTaskStopRequest } from '../src/runtime/taskControl';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
    expect(manager.retainedTasks).toMatchObject([
      {
        id: taskId,
        type: 'bash',
        status: 'stopped',
        terminalReason: 'stopped_by_shared_task_manager',
      },
    ]);
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
    expect(manager.retainedTasks).toMatchObject([
      {
        id: taskId,
        type: 'bash',
        status: 'completed',
        terminalReason: 'process_exit:unknown',
      },
    ]);
  });

  test('should return false when killing non-existent task', async () => {
    const manager = createTaskManager();
    const killed = await manager.killTask('non-existent');
    expect(killed).toBe(false);
  });

  test('should register and stop a subagent task through the shared path', async () => {
    const manager = createTaskManager();
    const abortController = new AbortController();
    const taskId = await manager.startSubagentTask({
      taskId: 'agent-task-1',
      agentName: 'researcher',
      transcriptPath: '/tmp/subagent.jsonl',
      cwd: '/tmp',
      background: false,
      parentAgentId: 'main',
      parentSessionId: 'parent-session',
      abortController,
    });

    expect(taskId).toBe('agent-task-1');
    expect(manager.activeTasks).toMatchObject([
      {
        id: 'agent-task-1',
        type: 'subagent',
        agentName: 'researcher',
        transcriptPath: '/tmp/subagent.jsonl',
        parentAgentId: 'main',
        parentSessionId: 'parent-session',
        status: 'running',
      },
    ]);

    const stopped = await manager.stopTask(taskId);
    expect(stopped).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(manager.activeTasks.length).toBe(0);
    expect(manager.retainedTasks).toMatchObject([
      {
        id: 'agent-task-1',
        type: 'subagent',
        status: 'stopped',
        terminalReason: 'stopped_by_shared_task_manager',
        agentName: 'researcher',
      },
    ]);
  });

  test('should complete a subagent task without aborting it', async () => {
    const manager = createTaskManager();
    const abortController = new AbortController();
    const notifications: any[] = [];
    manager.subscribe(event => notifications.push(event));
    await manager.startSubagentTask({
      taskId: 'agent-task-2',
      agentName: 'researcher',
      transcriptPath: '/tmp/subagent.jsonl',
      cwd: '/tmp',
      background: false,
      abortController,
    });

    expect(await manager.completeTask('agent-task-2', {
      status: 'completed',
      terminalReason: 'subagent_completed',
      outputSummary: 'Subagent completed the delegated task.',
    })).toBe(true);
    expect(abortController.signal.aborted).toBe(false);
    expect(manager.activeTasks.length).toBe(0);
    expect(manager.retainedTasks).toMatchObject([
      {
        id: 'agent-task-2',
        type: 'subagent',
        status: 'completed',
        terminalReason: 'subagent_completed',
        outputSummary: 'Subagent completed the delegated task.',
      },
    ]);
    expect(notifications).toMatchObject([
      {
        type: 'task-terminal',
        task: {
          id: 'agent-task-2',
          type: 'subagent',
          agentName: 'researcher',
          status: 'completed',
          terminalReason: 'subagent_completed',
        },
        terminal: {
          status: 'completed',
          terminalReason: 'subagent_completed',
          outputSummary: 'Subagent completed the delegated task.',
        },
      },
    ]);
  });

  test('should unsubscribe task terminal notifications', async () => {
    const manager = createTaskManager();
    const notifications: any[] = [];
    const unsubscribe = manager.subscribe(event => notifications.push(event));
    const abortController = new AbortController();
    await manager.startSubagentTask({
      taskId: 'agent-task-unsubscribed',
      agentName: 'researcher',
      transcriptPath: '/tmp/subagent.jsonl',
      cwd: '/tmp',
      background: true,
      abortController,
    });

    unsubscribe();

    expect(await manager.completeTask('agent-task-unsubscribed', {
      status: 'completed',
      terminalReason: 'subagent_completed',
    })).toBe(true);
    expect(notifications).toEqual([]);
  });

  test('should preserve background subagent task metadata until stopped', async () => {
    const manager = createTaskManager();
    const abortController = new AbortController();
    await manager.startSubagentTask({
      taskId: 'agent-task-bg',
      agentName: 'watcher',
      transcriptPath: '/tmp/watcher.jsonl',
      cwd: '/tmp',
      background: true,
      parentAgentId: 'main',
      abortController,
    });

    expect(manager.activeTasks).toMatchObject([
      {
        id: 'agent-task-bg',
        type: 'subagent',
        agentName: 'watcher',
        transcriptPath: '/tmp/watcher.jsonl',
        parentAgentId: 'main',
        status: 'running',
        background: true,
      },
    ]);

    expect(await manager.stopTask('agent-task-bg')).toBe(true);
    expect(abortController.signal.aborted).toBe(true);
    expect(manager.retainedTasks).toMatchObject([
      {
        id: 'agent-task-bg',
        type: 'subagent',
        status: 'stopped',
        background: true,
        terminalReason: 'stopped_by_shared_task_manager',
      },
    ]);
  });

  test('should honor a cross-process subagent stop request file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vigilon-task-stop-'));
    try {
      const manager = createTaskManager();
      const abortController = new AbortController();
      const transcriptPath = path.join(root, 'subagent.jsonl');
      await manager.startSubagentTask({
        taskId: 'agent-task-cross-process',
        agentName: 'watcher',
        transcriptPath,
        cwd: root,
        background: true,
        parentAgentId: 'main',
        abortController,
      });

      await writeTaskStopRequest({
        id: 'agent-task-cross-process',
        transcriptPath,
      }, {
        requester: 'cli',
        requestedAt: '2026-05-21T00:00:05.000Z',
        reason: 'test stop request',
      });
      await waitFor(() => abortController.signal.aborted, 750);

      expect(abortController.signal.aborted).toBe(true);
      expect(manager.activeTasks.length).toBe(0);
      expect(manager.retainedTasks).toMatchObject([
        {
          id: 'agent-task-cross-process',
          status: 'stopped',
          terminalReason: 'cross_process_stop_request:cli',
          stopRequestedAt: '2026-05-21T00:00:05.000Z',
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('should shutdown and clear all active tasks', async () => {
    const firstProcess = new EventEmitter() as any;
    firstProcess.pid = 201;
    firstProcess.kill = vi.fn();
    firstProcess.unref = vi.fn();

    const secondProcess = new EventEmitter() as any;
    secondProcess.pid = 202;
    secondProcess.kill = vi.fn();
    secondProcess.unref = vi.fn();

    (spawn as any)
      .mockReturnValueOnce(firstProcess)
      .mockReturnValueOnce(secondProcess);

    const manager = createTaskManager();
    await manager.startBashTask('sleep 10', '/tmp');
    await manager.startBashTask('sleep 20', '/tmp');

    expect(manager.activeTasks.length).toBe(2);

    await manager.shutdown();

    expect(firstProcess.kill).toHaveBeenCalled();
    expect(secondProcess.kill).toHaveBeenCalled();
    expect(manager.activeTasks.length).toBe(0);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
