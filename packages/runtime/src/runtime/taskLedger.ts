import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TASK_LEDGER_FILENAME = 'task-ledger.json'

export type ScheduledTask = {
  id: string
  goal: string
  status: 'pending' | 'running' | 'done' | 'failed'
  createdAt: string
  nextCheckAt?: string
  lastRunAt?: string
  maxTokens?: number
  tokensUsed: number
}

export type TaskLedger = {
  tasks: ScheduledTask[]
  updatedAt: string
}

export async function readTaskLedger(cwd: string): Promise<TaskLedger> {
  const ledgerPath = path.join(cwd, '.vigilon', TASK_LEDGER_FILENAME)
  try {
    const raw = await readFile(ledgerPath, 'utf-8')
    return JSON.parse(raw) as TaskLedger
  } catch {
    return { tasks: [], updatedAt: new Date().toISOString() }
  }
}

export async function writeTaskLedger(cwd: string, ledger: TaskLedger): Promise<void> {
  const dir = path.join(cwd, '.vigilon')
  await mkdir(dir, { recursive: true })
  ledger.updatedAt = new Date().toISOString()
  await writeFile(path.join(dir, TASK_LEDGER_FILENAME), JSON.stringify(ledger, null, 2))
}

export async function addTask(
  cwd: string,
  task: Omit<ScheduledTask, 'id' | 'createdAt' | 'tokensUsed'>,
): Promise<ScheduledTask> {
  const ledger = await readTaskLedger(cwd)
  const entry: ScheduledTask = {
    ...task,
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    tokensUsed: 0,
  }
  ledger.tasks.push(entry)
  await writeTaskLedger(cwd, ledger)
  return entry
}

export async function updateTask(
  cwd: string,
  taskId: string,
  patch: Partial<Pick<ScheduledTask, 'status' | 'tokensUsed' | 'nextCheckAt' | 'lastRunAt'>>,
): Promise<ScheduledTask | null> {
  const ledger = await readTaskLedger(cwd)
  const task = ledger.tasks.find(t => t.id === taskId)
  if (!task) return null
  Object.assign(task, patch)
  await writeTaskLedger(cwd, ledger)
  return task
}

export function listPendingTasks(ledger: TaskLedger): ScheduledTask[] {
  return ledger.tasks.filter(t => t.status === 'pending')
}
