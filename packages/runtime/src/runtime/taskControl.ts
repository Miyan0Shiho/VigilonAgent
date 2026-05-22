import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { BackgroundTask } from './contracts.js'

export type TaskStopRequester = 'runtime' | 'cli' | 'tui'

export type TaskStopRequest = {
  version: 1
  taskId: string
  requestedAt: string
  requester: TaskStopRequester
  reason: string
}

export function resolveTaskStopRequestPath(
  task: Pick<BackgroundTask, 'id' | 'transcriptPath'>,
): string | undefined {
  if (!task.transcriptPath) return undefined
  return `${task.transcriptPath}.stop.json`
}

export async function writeTaskStopRequest(
  task: Pick<BackgroundTask, 'id' | 'transcriptPath'>,
  input: {
    requester: TaskStopRequester
    reason?: string
    requestedAt?: string
  },
): Promise<{ path: string; request: TaskStopRequest }> {
  const stopRequestPath = resolveTaskStopRequestPath(task)
  if (!stopRequestPath) {
    throw new Error(`task has no transcript path for cross-process stop: ${task.id}`)
  }
  const request: TaskStopRequest = {
    version: 1,
    taskId: task.id,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    requester: input.requester,
    reason: input.reason ?? 'operator requested task stop',
  }
  await mkdir(path.dirname(stopRequestPath), { recursive: true })
  await writeFile(stopRequestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  return { path: stopRequestPath, request }
}

export async function readTaskStopRequest(
  task: Pick<BackgroundTask, 'id' | 'transcriptPath'>,
): Promise<TaskStopRequest | null> {
  const stopRequestPath = resolveTaskStopRequestPath(task)
  if (!stopRequestPath) return null
  let raw: string
  try {
    raw = await readFile(stopRequestPath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  const parsed = JSON.parse(raw) as Partial<TaskStopRequest>
  if (
    parsed.version !== 1 ||
    parsed.taskId !== task.id ||
    typeof parsed.requestedAt !== 'string' ||
    typeof parsed.requester !== 'string'
  ) {
    return null
  }
  return {
    version: 1,
    taskId: parsed.taskId,
    requestedAt: parsed.requestedAt,
    requester: parsed.requester as TaskStopRequester,
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'operator requested task stop',
  }
}

export async function taskStopRequestExists(
  task: Pick<BackgroundTask, 'id' | 'transcriptPath'>,
): Promise<boolean> {
  const stopRequestPath = resolveTaskStopRequestPath(task)
  if (!stopRequestPath) return false
  try {
    await access(stopRequestPath)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
