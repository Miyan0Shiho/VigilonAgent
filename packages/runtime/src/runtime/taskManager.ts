import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import type { BackgroundTask, TaskManager } from './contracts.js';

export function createTaskManager(): TaskManager {
  const tasks = new Map<string, { info: BackgroundTask; process: ChildProcess }>();

  async function stopTask(taskId: string): Promise<boolean> {
    const task = tasks.get(taskId);
    if (!task) return false;

    const { process } = task;
    if (process.pid) {
      try {
        process.kill();
      } catch {
        // Best-effort stop: the shared path removes the task even if the host already exited.
      }
    }
    tasks.delete(taskId);
    return true;
  }

  return {
    get activeTasks(): BackgroundTask[] {
      return Array.from(tasks.values()).map((t) => t.info);
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
      };

      tasks.set(id, { info, process });

      process.on('exit', () => {
        tasks.delete(id);
      });

      process.on('error', () => {
        tasks.delete(id);
      });

      return id;
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
