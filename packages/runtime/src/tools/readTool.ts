import { readFile, stat } from 'node:fs/promises'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import {
  isBlockedDevicePath,
  isUncPath,
  resolveToolPath,
  toRelativeToolPath,
} from './path.js'

const DEFAULT_MAX_SIZE_BYTES = 256 * 1024
const DEFAULT_MAX_LINES = 2_000
const DEFAULT_READ_IGNORE_PATTERNS = [
  '.vigilon/**',
  '**/.vigilon/**',
  '.trae/**',
  '**/.trae/**',
  'node_modules/**',
  '**/node_modules/**',
  'dist/**',
  '**/dist/**',
  'build/**',
  '**/build/**',
  'coverage/**',
  '**/coverage/**',
]
const FILE_UNCHANGED_STUB =
  'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.'

type ReadInput = {
  file_path?: string
  offset?: number
  limit?: number
}

export const ReadTool: Tool = {
  name: 'Read',
  description:
    'Reads a local text file and returns cat -n style line-numbered content. Respects project ignore patterns. If the same unchanged file range was already read, returns a file_unchanged stub telling the model to use the earlier Read result.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or cwd-relative path to the file to read.',
      },
      offset: {
        type: 'number',
        description: '1-based line number to start reading from.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read.',
      },
    },
    required: ['file_path'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseReadInput(input)
    if (!parsed.file_path) {
      return failed('Read requires file_path')
    }

    const filePath = resolveToolPath(context.cwd, parsed.file_path)
    if (isUncPath(filePath)) {
      return failed('UNC paths are not supported by the local Read tool')
    }
    if (isBlockedDevicePath(filePath)) {
      return failed(`Refusing to read blocked device path: ${filePath}`)
    }
    const relativePath = toRelativeToolPath(context.cwd, filePath)
    if (
      isProjectIgnored(relativePath, [
        ...DEFAULT_READ_IGNORE_PATTERNS,
        ...(context.projectConfig?.ignore ?? []),
      ])
    ) {
      return failed(`Read path is ignored by project config: ${relativePath}`)
    }

	    const permission = await context.permissionGate.requestPermission({
	      action: 'read',
	      subject: filePath,
	      risk: 'low',
	      reason: 'Read local file content',
	      origin: withToolPermissionOrigin(context.permissionOrigin, 'Read'),
	    })
    if (!permission.allowed) {
      return failed(permission.reason)
    }

    const fileStat = await stat(filePath).catch(error => {
      throw new Error(formatFileError('File does not exist', parsed.file_path!, error))
    })
    if (!fileStat.isFile()) {
      return failed(`Path is not a file: ${parsed.file_path}`)
    }

    const maxSizeBytes =
      context.fileReadingLimits?.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES
    if (fileStat.size > maxSizeBytes && parsed.limit === undefined) {
      return failed(
        `File is too large to read in full (${fileStat.size} bytes > ${maxSizeBytes} bytes). Use offset and limit.`,
      )
    }

    const offset = normalizeOffset(parsed.offset)
    const hadExplicitRange = parsed.offset !== undefined || parsed.limit !== undefined
    const limit = normalizeLimit(
      parsed.limit ?? context.fileReadingLimits?.maxLines ?? DEFAULT_MAX_LINES,
    )
    const previous = context.readFileState?.get(filePath)
    if (
      previous &&
      previous.mtimeMs === fileStat.mtimeMs &&
      previous.offset === offset &&
      previous.limit === limit
    ) {
      return ok(FILE_UNCHANGED_STUB, {
        filePath,
        type: 'file_unchanged',
      })
    }

    // If we already have a full read of this file, serve requested range from cache
    if (
      previous &&
      previous.mtimeMs === fileStat.mtimeMs &&
      previous.fullRead &&
      hadExplicitRange
    ) {
      const cachedLines = previous.content.split(/\r?\n/)
      const startIndex = offset - 1
      const selected = cachedLines.slice(startIndex, startIndex + limit)
      if (selected.length > 0) {
        const formatted = addLineNumbers(selected, offset)
        const isComplete = startIndex + selected.length >= cachedLines.length
        const suffix = isComplete
          ? '\n[End of file]'
          : `\n[Lines ${offset}-${offset + selected.length - 1} of ${cachedLines.length}]`
        return ok(formatted + suffix, {
          filePath,
          type: 'text',
          startLine: offset,
          numLines: selected.length,
          totalLines: cachedLines.length,
          servedFromCache: true,
        })
      }
    }

    const buffer = await readFile(filePath)
    if (isProbablyBinary(buffer)) {
      return failed('This tool cannot read binary files.')
    }

    const content = buffer.toString('utf8')
    const lines = content.split(/\r?\n/)
    const startIndex = offset - 1
    const selected = lines.slice(startIndex, startIndex + limit)
    const formatted = addLineNumbers(selected, offset)
    context.readFileState?.set(filePath, {
      content: selected.join('\n'),
      mtimeMs: fileStat.mtimeMs,
      offset,
      limit,
      fullRead: offset === 1 && startIndex + selected.length >= lines.length,
    })

    const isComplete = startIndex + selected.length >= lines.length
    if (isComplete) {
      return ok(`[Read full file: ${lines.length} lines]\n\n${formatted}`, {
        filePath,
        type: 'text',
        startLine: offset,
        numLines: selected.length,
        totalLines: lines.length,
      })
    }

    const suffix = hadExplicitRange
      ? `\n\n[Showing lines ${offset}-${offset + selected.length - 1} of ${lines.length}. Use offset and limit to continue.]`
      : `\n\n[Truncated at ${lines.length} lines. ${lines.length - (offset + selected.length - 1)} lines remaining. Use offset and limit to continue.]`
    return ok(formatted + suffix, {
      filePath,
      type: 'text',
      startLine: offset,
      numLines: selected.length,
      totalLines: lines.length,
    })
  },
}

function parseReadInput(input: unknown): ReadInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    file_path:
      typeof value.file_path === 'string' ? value.file_path : undefined,
    offset: typeof value.offset === 'number' ? value.offset : undefined,
    limit: typeof value.limit === 'number' ? value.limit : undefined,
  }
}

function normalizeOffset(offset: number | undefined): number {
  return Number.isInteger(offset) && offset && offset > 0 ? offset : 1
}

function normalizeLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) return DEFAULT_MAX_LINES
  return limit
}

function addLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, index) => `${String(startLine + index).padStart(6, ' ')}\t${line}`)
    .join('\n')
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000))
  return sample.includes(0)
}

function isProjectIgnored(relativePath: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => globToRegex(pattern).test(relativePath))
}

function globToRegex(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    const next = pattern[i + 1]
    const afterNext = pattern[i + 2]
    if (char === '*' && next === '*' && afterNext === '/') {
      source += '(?:.*/)?'
      i += 2
    } else if (char === '*' && next === '*') {
      source += '.*'
      i += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += escapeRegex(char)
    }
  }
  source += '$'
  return new RegExp(source)
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return {
    toolCallId: '',
    ok: true,
    content,
    metadata,
  }
}

function failed(content: string): ToolResult {
  return {
    toolCallId: '',
    ok: false,
    content,
  }
}

function formatFileError(
  prefix: string,
  displayPath: string,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${prefix}: ${displayPath}. ${message}`
}
