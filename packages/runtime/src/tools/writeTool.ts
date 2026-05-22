import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { isUncPath, resolveToolPath } from './path.js'

type WriteInput = {
  file_path?: string
  content?: string
}

export const WriteTool: Tool = {
  name: 'Write',
  description:
    'Creates a new local text file or replaces an existing file with complete content.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or cwd-relative path to write.',
      },
      content: {
        type: 'string',
        description: 'Complete file content to write.',
      },
    },
    required: ['file_path', 'content'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseWriteInput(input)
    if (!parsed.file_path) return failed('Write requires file_path')
    if (parsed.content === undefined) return failed('Write requires content')

    const filePath = resolveToolPath(context.cwd, parsed.file_path)
    if (isUncPath(filePath)) {
      return failed('UNC paths are not supported by the local Write tool')
    }

    const existing = await readExistingText(filePath)
    const type = existing.exists ? 'update' : 'create'
    if (existing.exists) {
      const stale = await validateReadBeforeWrite(filePath, existing, context)
      if (stale) return failed(stale)
    }

	    const permission = await context.permissionGate.requestPermission({
	      action: 'write',
	      subject: filePath,
	      risk: existing.exists ? 'medium' : 'low',
	      reason: existing.exists
	        ? 'Overwrite existing local file'
	        : 'Create local file',
	      origin: withToolPermissionOrigin(context.permissionOrigin, 'Write'),
	    })
    if (!permission.allowed) return failed(permission.reason)

    await mkdir(path.dirname(filePath), { recursive: true })
    await atomicWriteFile(filePath, parsed.content)
    const fileStat = await stat(filePath)
    context.readFileState?.set(filePath, {
      content: parsed.content,
      mtimeMs: fileStat.mtimeMs,
      offset: 1,
      fullRead: true,
    })

    return ok(`${type === 'create' ? 'Created' : 'Updated'} ${parsed.file_path}`, {
      type,
      filePath,
      originalContent: existing.exists ? existing.content : null,
      content: parsed.content,
      diff: createLineDiff(existing.exists ? existing.content : '', parsed.content, {
        filePath: parsed.file_path,
      }),
    })
  },
}

async function readExistingText(filePath: string): Promise<
  | { exists: false }
  | { exists: true; content: string; mtimeMs: number }
> {
  try {
    const [content, fileStat] = await Promise.all([
      readFile(filePath, 'utf8'),
      stat(filePath),
    ])
    if (!fileStat.isFile()) throw new Error(`Path is not a file: ${filePath}`)
    return { exists: true, content, mtimeMs: fileStat.mtimeMs }
  } catch (error) {
    if (isNotFound(error)) return { exists: false }
    throw error
  }
}

async function validateReadBeforeWrite(
  filePath: string,
  existing: { content: string; mtimeMs: number },
  context: ToolUseContext,
): Promise<string | null> {
  const lastRead = context.readFileState?.get(filePath)
  if (!lastRead?.fullRead) {
    return 'File has not been fully read yet. Read it before overwriting it.'
  }
  if (lastRead.mtimeMs !== existing.mtimeMs && lastRead.content !== existing.content) {
    return 'File changed since it was last read. Read it again before writing.'
  }
  return null
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.vigilon-tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}

function parseWriteInput(input: unknown): WriteInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    file_path: typeof value.file_path === 'string' ? value.file_path : undefined,
    content: typeof value.content === 'string' ? value.content : undefined,
  }
}

export function createLineDiff(
  before: string,
  after: string,
  options: { filePath?: string } = {},
): string {
  if (before === after) return ''
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const oldCount = Math.max(1, beforeLines.length)
  const newCount = Math.max(1, afterLines.length)
  const label = options.filePath ?? 'file'
  return [
    `--- a/${label}`,
    `+++ b/${label}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...beforeLines.map(line => `-${line}`),
    ...afterLines.map(line => `+${line}`),
  ].join('\n')
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
}

function failed(content: string): ToolResult {
  return { toolCallId: '', ok: false, content }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
