import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { isUncPath, resolveToolPath } from './path.js'
import { createLineDiff } from './writeTool.js'

type EditInput = {
  file_path?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
}

export const EditTool: Tool = {
  name: 'Edit',
  description:
    'Edits a local text file by replacing an exact old_string anchor with new_string.',
  actionClass: 'needs-confirmation' as const,
  securityTier: 'confirm' as const,
  inputJsonSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['file_path', 'old_string', 'new_string'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseEditInput(input)
    if (!parsed.file_path) return failed('Edit requires file_path')
    if (parsed.old_string === undefined) return failed('Edit requires old_string')
    if (parsed.new_string === undefined) return failed('Edit requires new_string')
    if (parsed.old_string === parsed.new_string) {
      return failed('old_string and new_string must be different')
    }

    const filePath = resolveToolPath(context.cwd, parsed.file_path)
    if (isUncPath(filePath)) {
      return failed('UNC paths are not supported by the local Edit tool')
    }
    if (filePath.endsWith('.ipynb')) {
      return failed('Use a notebook-specific editor for .ipynb files.')
    }

    const existing = await readExistingText(filePath)
    if (!existing.exists && parsed.old_string !== '') {
      return failed('File does not exist. Use Write to create a new file.')
    }
    if (existing.exists) {
      const stale = validateReadBeforeEdit(filePath, existing, context)
      if (stale) return failed(stale)
    }

	    const permission = await context.permissionGate.requestPermission({
	      action: existing.exists ? 'edit' : 'write',
	      subject: filePath,
	      risk: existing.exists ? 'medium' : 'low',
	      reason: existing.exists
	        ? 'Edit existing local file'
	        : 'Create local file from empty edit anchor',
	      origin: withToolPermissionOrigin(context.permissionOrigin, 'Edit'),
	    })
    if (!permission.allowed) return failed(permission.reason)

    const before = existing.exists ? existing.content : ''
    const replacement = applyReplacement(
      before,
      parsed.old_string,
      parsed.new_string,
      parsed.replace_all === true,
    )
    if (!replacement.ok) return failed(replacement.error)

    await mkdir(path.dirname(filePath), { recursive: true })
    await atomicWriteFile(filePath, replacement.content)
    const fileStat = await stat(filePath)
    context.readFileState?.set(filePath, {
      content: replacement.content,
      mtimeMs: fileStat.mtimeMs,
      offset: 1,
      fullRead: true,
    })

    return ok(`${existing.exists ? 'Updated' : 'Created'} ${parsed.file_path}`, {
      type: existing.exists ? 'update' : 'create',
      filePath,
      replacements: replacement.count,
      diff: createLineDiff(before, replacement.content, {
        filePath: parsed.file_path,
      }),
    })
  },
}

function applyReplacement(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
):
  | { ok: true; content: string; count: number }
  | { ok: false; error: string } {
  if (oldString === '') {
    if (content !== '') {
      return {
        ok: false,
        error: 'old_string is empty but target file is not empty. Use Write for full replacement.',
      }
    }
    return { ok: true, content: newString, count: 1 }
  }

  const actual = findActualString(content, oldString)
  if (!actual) {
    return { ok: false, error: 'old_string was not found in the file.' }
  }
  const matches = countOccurrences(content, actual)
  if (matches > 1 && !replaceAll) {
    return {
      ok: false,
      error:
        'old_string appears multiple times. Provide a more specific anchor or set replace_all.',
    }
  }
  return {
    ok: true,
    content: replaceAll
      ? content.split(actual).join(newString)
      : content.replace(actual, newString),
    count: replaceAll ? matches : 1,
  }
}

function findActualString(content: string, oldString: string): string | null {
  if (content.includes(oldString)) return oldString
  const normalizedContent = normalizeQuotes(content)
  const normalizedOld = normalizeQuotes(oldString)
  const index = normalizedContent.indexOf(normalizedOld)
  if (index === -1) return null
  return content.slice(index, index + oldString.length)
}

function normalizeQuotes(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}

function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = 0
  while ((index = content.indexOf(needle, index)) !== -1) {
    count += 1
    index += needle.length
  }
  return count
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

function validateReadBeforeEdit(
  filePath: string,
  existing: { content: string; mtimeMs: number },
  context: ToolUseContext,
): string | null {
  const lastRead = context.readFileState?.get(filePath)
  if (!lastRead?.fullRead) {
    return 'File has not been fully read yet. Read it before editing it.'
  }
  if (lastRead.mtimeMs !== existing.mtimeMs && lastRead.content !== existing.content) {
    return 'File changed since it was last read. Read it again before editing.'
  }
  return null
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.vigilon-tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}

function parseEditInput(input: unknown): EditInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    file_path: typeof value.file_path === 'string' ? value.file_path : undefined,
    old_string:
      typeof value.old_string === 'string' ? value.old_string : undefined,
    new_string:
      typeof value.new_string === 'string' ? value.new_string : undefined,
    replace_all:
      typeof value.replace_all === 'boolean' ? value.replace_all : undefined,
  }
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
