import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Dirent } from 'node:fs'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { isUncPath, resolveToolPath, toRelativeToolPath } from './path.js'

const DEFAULT_MAX_RESULTS = 100
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '.jj',
  '.sl',
  '.vigilon',
  '.trae',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

type GlobInput = {
  pattern?: string
  path?: string
}

export const GlobTool: Tool = {
  name: 'Glob',
  description:
    'Finds files by glob pattern under a directory and returns relative paths.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match files against.',
      },
      path: {
        type: 'string',
        description: 'Directory to search. Defaults to cwd.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseGlobInput(input)
    if (!parsed.pattern) {
      return failed('Glob requires pattern')
    }

    const root = resolveToolPath(context.cwd, parsed.path ?? '.')
    if (isUncPath(root)) {
      return failed('UNC paths are not supported by the local Glob tool')
    }
    const rootStat = await stat(root).catch(error => {
      throw new Error(formatPathError('Directory does not exist', parsed.path ?? '.', error))
    })
    if (!rootStat.isDirectory()) {
      return failed(`Path is not a directory: ${parsed.path ?? root}`)
    }

    const permission = await context.permissionGate.requestPermission({
      action: 'read',
      subject: root,
      risk: 'low',
      reason: 'Enumerate local file paths',
    })
    if (!permission.allowed) {
      return failed(permission.reason)
    }

    const maxResults = context.globLimits?.maxResults ?? DEFAULT_MAX_RESULTS
    const matcher = createGlobMatcher(parsed.pattern)
    const ignoreMatchers = (context.projectConfig?.ignore ?? []).map(createGlobMatcher)
    const matches: string[] = []
    let truncated = false
    await walk(root, async filePath => {
      const relativeFromRoot = path.relative(root, filePath).split(path.sep).join('/')
      const relativeFromCwd = toRelativeToolPath(context.cwd, filePath)
      if (isIgnored(relativeFromRoot, relativeFromCwd, ignoreMatchers)) {
        return true
      }
      if (matcher(relativeFromRoot) || matcher(relativeFromCwd)) {
        matches.push(relativeFromCwd)
        if (matches.length >= maxResults) {
          truncated = true
          return false
        }
      }
      return true
    }, context.abortSignal)

    matches.sort()
    const content =
      matches.length === 0
        ? 'No files found'
        : [
            ...matches,
            ...(truncated
              ? [
                  '(Results are truncated. Consider using a more specific path or pattern.)',
                ]
              : []),
          ].join('\n')
    return {
      toolCallId: '',
      ok: true,
      content,
      metadata: {
        filenames: matches,
        numFiles: matches.length,
        truncated,
      },
    }
  },
}

function isIgnored(
  relativeFromRoot: string,
  relativeFromCwd: string,
  ignoreMatchers: Array<(value: string) => boolean>,
): boolean {
  return ignoreMatchers.some(
    matcher => matcher(relativeFromRoot) || matcher(relativeFromCwd),
  )
}

async function walk(
  dir: string,
  onFile: (filePath: string) => Promise<boolean>,
  abortSignal: AbortSignal,
): Promise<boolean> {
  if (abortSignal.aborted) return false
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return true
  }

  for (const entry of entries) {
    if (abortSignal.aborted) return false
    if (entry.isDirectory() && DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const shouldContinue = await walk(fullPath, onFile, abortSignal)
      if (!shouldContinue) return false
    } else if (entry.isFile()) {
      const shouldContinue = await onFile(fullPath)
      if (!shouldContinue) return false
    }
  }
  return true
}

function createGlobMatcher(pattern: string): (value: string) => boolean {
  const regex = globToRegex(pattern)
  return value => regex.test(value)
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
    } else if (char === '{') {
      const close = pattern.indexOf('}', i)
      if (close !== -1) {
        const choices = pattern
          .slice(i + 1, close)
          .split(',')
          .map(escapeRegex)
          .join('|')
        source += `(?:${choices})`
        i = close
      } else {
        source += escapeRegex(char)
      }
    } else {
      source += escapeRegex(char ?? '')
    }
  }
  return new RegExp(`${source}$`)
}

function parseGlobInput(input: unknown): GlobInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    pattern: typeof value.pattern === 'string' ? value.pattern : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

function failed(content: string): ToolResult {
  return { toolCallId: '', ok: false, content }
}

function formatPathError(
  prefix: string,
  displayPath: string,
  error: unknown,
): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${prefix}: ${displayPath}. ${message}`
}
