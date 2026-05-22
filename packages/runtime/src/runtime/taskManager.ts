import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import type { BackgroundTask, TaskManager, TaskManagerEvent, TaskTerminalUpdate } from './contracts.js';
import { readTaskStopRequest, resolveTaskStopRequestPath } from './taskControl.js';

export function createTaskManager(): TaskManager {
  const tasks = new Map<string, {
    info: BackgroundTask
    stop: () => void
    stopPoll?: NodeJS.Timeout
  }>();
  const retainedTasks = new Map<string, BackgroundTask>();
  const listeners = new Set<(event: TaskManagerEvent) => void>();

  async function stopTask(
    taskId: string,
    terminalReason = 'stopped_by_shared_task_manager',
    stopRequestedAt?: string,
  ): Promise<boolean> {
    const task = tasks.get(taskId);
    if (!task) return false;

    try {
      task.stop();
    } catch {
      // Best-effort stop: the shared path removes the task even if the host already exited.
    }
    retainTask(task.info, {
      status: 'stopped',
      terminalReason,
      ...(stopRequestedAt ? { stopRequestedAt } : {}),
    });
    if (task.stopPoll) clearInterval(task.stopPoll);
    tasks.delete(taskId);
    return true;
  }

  async function completeTask(
    taskId: string,
    terminal?: TaskTerminalUpdate,
  ): Promise<boolean> {
    const task = tasks.get(taskId);
    if (!task) return false;
    retainTask(task.info, terminal ?? {
      status: 'completed',
      terminalReason: 'completed',
    });
    if (task.stopPoll) clearInterval(task.stopPoll);
    return tasks.delete(taskId);
  }

  function retainTask(task: BackgroundTask, terminal: TaskTerminalUpdate): void {
    const completedAt = terminal.completedAt ?? new Date().toISOString();
    const retainedTask: BackgroundTask = {
      ...task,
      status: terminal.status,
      completedAt,
      terminalReason: terminal.terminalReason,
      outputSummary: terminal.outputSummary,
      worktreeDiff: terminal.worktreeDiff ?? task.worktreeDiff,
      stopRequestPath: task.stopRequestPath,
      stopRequestedAt: terminal.stopRequestedAt ?? task.stopRequestedAt,
    };
    const retainedTerminal: TaskTerminalUpdate = {
      ...terminal,
      completedAt,
    };
    retainedTasks.set(task.id, retainedTask);
    while (retainedTasks.size > 50) {
      const oldest = retainedTasks.keys().next().value;
      if (!oldest) break;
      retainedTasks.delete(oldest);
    }
    notify({
      type: 'task-terminal',
      task: retainedTask,
      terminal: retainedTerminal,
      timestamp: completedAt,
    });
  }

  function notify(event: TaskManagerEvent): void {
    for (const listener of listeners) {
      try {
        listener({
          ...event,
          task: { ...event.task },
          terminal: { ...event.terminal },
        });
      } catch {
        // Task lifecycle notifications are observational; a UI subscriber must not break retention.
      }
    }
  }

  return {
    get activeTasks(): BackgroundTask[] {
      return Array.from(tasks.values()).map((t) => t.info);
    },

    get retainedTasks(): BackgroundTask[] {
      return Array.from(retainedTasks.values());
    },

    subscribe(listener: (event: TaskManagerEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async startBashTask(command: string, cwd: string): Promise<string> {
      const id = randomUUID();
      const process = spawn(command, {
        shell: true,
        cwd,
        stdio: 'pipe',
        detached: true,
      });

      // Unref to allow the parent process to exit if needed
      process.unref();

      const info: BackgroundTask = {
        id,
        type: 'bash',
        command,
        startTime: new Date().toISOString(),
        status: 'running',
        background: true,
      };

      tasks.set(id, {
        info,
        stop: () => {
          if (process.pid) process.kill();
        },
      });

      process.on('exit', (code, signal) => {
        retainTask(info, {
          status: !signal && (code === 0 || code === undefined) ? 'completed' : 'failed',
          terminalReason: signal
            ? `process_signal:${signal}`
            : `process_exit:${code ?? 'unknown'}`,
        });
        tasks.delete(id);
      });

      process.on('error', (error) => {
        retainTask(info, {
          status: 'failed',
          terminalReason: 'process_error',
          outputSummary: error instanceof Error ? error.message : String(error),
        });
        tasks.delete(id);
      });

      return id;
    },

    async startSubagentTask(task): Promise<string> {
      const stopRequestPath = task.stopRequestPath ?? resolveTaskStopRequestPath({
        id: task.taskId,
        transcriptPath: task.transcriptPath,
      });
      const info: BackgroundTask = {
        id: task.taskId,
        type: 'subagent',
        command: `subagent:${task.agentName}`,
        startTime: new Date().toISOString(),
        status: 'running',
        background: task.background,
        agentName: task.agentName,
        transcriptPath: task.transcriptPath,
        cwd: task.cwd,
        host: task.host ?? 'local',
        worktreePath: task.worktreePath,
        gitWorktree: task.gitWorktree,
        sourceCwd: task.sourceCwd,
        parentAgentId: task.parentAgentId,
        parentSessionId: task.parentSessionId,
        stopRequestPath,
      };

      const taskRecord: {
        info: BackgroundTask
        stop: () => void
        stopPoll?: NodeJS.Timeout
      } = {
        info,
        stop: () => {
          task.abortController.abort();
        },
      };
      if (stopRequestPath) {
        taskRecord.stopPoll = setInterval(() => {
          void readTaskStopRequest(info)
            .then(request => {
              if (!request) return
              void stopTask(
                task.taskId,
                `cross_process_stop_request:${request.requester}`,
                request.requestedAt,
              )
            })
            .catch(() => {
              // Stop-request polling is a control-plane affordance; transient
              // file errors must not crash the running subagent.
            })
        }, 250)
        taskRecord.stopPoll.unref?.()
      }

      tasks.set(task.taskId, taskRecord);

      return task.taskId;
    },

    async completeTask(taskId: string, terminal?: TaskTerminalUpdate): Promise<boolean> {
      return completeTask(taskId, terminal);
    },

    async stopTask(taskId: string): Promise<boolean> {
      return stopTask(taskId);
    },

    async killTask(taskId: string): Promise<boolean> {
      return stopTask(taskId);
    },

    async shutdown(): Promise<void> {
      const taskIds = Array.from(tasks.keys());
      await Promise.all(taskIds.map(taskId => stopTask(taskId)));
    },
  };
}
