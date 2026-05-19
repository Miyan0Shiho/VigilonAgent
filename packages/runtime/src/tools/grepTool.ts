import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { isUncPath, resolveToolPath, toRelativeToolPath } from './path.js'

const execFileAsync = promisify(execFile)
const DEFAULT_HEAD_LIMIT = 250
const BROAD_QUERY_FILE_THRESHOLD = 80
const BROAD_QUERY_GROUP_LIMIT = 12
const DEFAULT_DIRECTORIES_TO_EXCLUDE = [
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
]

type GrepInput = {
  pattern?: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'content' | 'files_with_matches' | 'count'
  '-A'?: number
  '-B'?: number
  '-C'?: number
  context?: number
  '-n'?: boolean
  '-i'?: boolean
  head_limit?: number
  offset?: number
  multiline?: boolean
  projectIgnore?: string[]
}

export const GrepTool: Tool = {
  name: 'Grep',
  description:
    'Searches local file contents with ripgrep using structured, paginated arguments.',
  readOnly: true,
  inputJsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for.' },
      path: { type: 'string', description: 'File or directory to search.' },
      glob: { type: 'string', description: 'Glob filter such as *.ts.' },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
      },
      head_limit: { type: 'number' },
      offset: { type: 'number' },
      '-i': { type: 'boolean' },
      '-n': { type: 'boolean' },
      multiline: { type: 'boolean' },
    },
    required: ['pattern'],
    additionalProperties: true,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseGrepInput(input)
    if (!parsed.pattern) {
      return failed('Grep requires pattern')
    }

    const searchPath = resolveToolPath(context.cwd, parsed.path ?? '.')
    if (isUncPath(searchPath)) {
      return failed('UNC paths are not supported by the local Grep tool')
    }
    const searchStat = await stat(searchPath).catch(error => {
      throw new Error(formatPathError('Path does not exist', parsed.path ?? '.', error))
    })

    const permission = await context.permissionGate.requestPermission({
      action: 'read',
      subject: searchPath,
      risk: 'low',
      reason: 'Search local file contents',
    })
    if (!permission.allowed) {
      return failed(permission.reason)
    }

    const outputMode = parsed.output_mode ?? 'files_with_matches'
    const args = buildRipgrepArgs(
      { ...parsed, projectIgnore: context.projectConfig?.ignore },
      outputMode,
    )
    const target = toRipgrepTarget(context.cwd, searchPath)
    const lines = await runRipgrep([...args, target], context.cwd, context.abortSignal)
    const offset = normalizeOffset(parsed.offset)
    const { items, appliedLimit } = applyHeadLimit(lines, parsed.head_limit, offset)

    if (outputMode === 'content') {
      const content = items
        .map(line => relativizeRipgrepLine(context.cwd, line, false))
        .join('\n')
      return ok(withPagination(content || 'No matches found', appliedLimit, offset), {
        mode: outputMode,
        numLines: items.length,
        appliedLimit,
        appliedOffset: offset || undefined,
      })
    }

    if (outputMode === 'count') {
      const countLines = items.map(line =>
        relativizeRipgrepLine(context.cwd, line, true),
      )
      const { numFiles, numMatches } = summarizeCounts(countLines)
      const summary = `\n\nFound ${numMatches} total ${numMatches === 1 ? 'occurrence' : 'occurrences'} across ${numFiles} ${numFiles === 1 ? 'file' : 'files'}.`
      return ok(withPagination(countLines.join('\n') || 'No matches found', appliedLimit, offset) + summary, {
        mode: outputMode,
        numFiles,
        numMatches,
        appliedLimit,
        appliedOffset: offset || undefined,
      })
    }

    const allFilenames = lines.map(filePath => normalizeRipgrepPath(context.cwd, filePath))
    if (
      isBroadGrepQuery({
        parsed,
        outputMode,
        resultCount: allFilenames.length,
        directoryGroupCount: groupPathsByDirectory(allFilenames).length,
      })
    ) {
      return ok(formatBroadGrepResult(allFilenames, parsed.pattern), {
        mode: outputMode,
        filenames: allFilenames.slice(0, DEFAULT_HEAD_LIMIT),
        numFiles: allFilenames.length,
        appliedLimit,
        appliedOffset: offset || undefined,
        broadQuery: true,
        directoryGroups: groupPathsByDirectory(allFilenames),
      })
    }

    const filenames = items.map(filePath => normalizeRipgrepPath(context.cwd, filePath))
    const content =
      filenames.length === 0
        ? 'No files found'
        : `Found ${filenames.length} ${filenames.length === 1 ? 'file' : 'files'}${formatPagination(appliedLimit, offset)}\n${filenames.join('\n')}`
    return ok(content, {
      mode: outputMode,
      filenames,
      numFiles: filenames.length,
      appliedLimit,
      appliedOffset: offset || undefined,
    })
  },
}

function isBroadGrepQuery(options: {
  parsed: GrepInput
  outputMode: 'content' | 'files_with_matches' | 'count'
  resultCount: number
  directoryGroupCount: number
}): boolean {
  if (options.outputMode !== 'files_with_matches') return false
  if (options.parsed.offset !== undefined) return false
  if (options.parsed.head_limit === 0) return false
  if (options.resultCount < BROAD_QUERY_FILE_THRESHOLD) return false
  if (options.directoryGroupCount < 2) return false
  return isLowSpecificityPattern(options.parsed.pattern ?? '')
}

function isLowSpecificityPattern(pattern: string): boolean {
  const literalChars = pattern.replace(/\\.|[^\p{L}\p{N}_-]/gu, '')
  return literalChars.length <= 24
}

function formatBroadGrepResult(filenames: readonly string[], pattern: string | undefined): string {
  const groups = groupPathsByDirectory(filenames)
  return [
    `Broad Grep query${pattern ? ` for "${pattern}"` : ''} matched ${filenames.length} files.`,
    'Directory groups:',
    ...groups.slice(0, BROAD_QUERY_GROUP_LIMIT).map(group => `- ${group.directory}: ${group.count}`),
    '',
    'Rerun Grep with a narrower `path`, `glob`, `type`, or more specific pattern before reading files.',
  ].join('\n')
}

function groupPathsByDirectory(paths: readonly string[]): Array<{ directory: string; count: number }> {
  const counts = new Map<string, number>()
  for (const filePath of paths) {
    const group = directoryGroup(filePath)
    counts.set(group, (counts.get(group) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([directory, count]) => ({ directory, count }))
    .sort((a, b) => b.count - a.count || a.directory.localeCompare(b.directory))
}

function directoryGroup(filePath: string): string {
  const parts = filePath.replace(/^\.\//, '').split('/').filter(Boolean)
  if (parts.length <= 1) return '.'
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

function toRipgrepTarget(cwd: string, absolutePath: string): string {
  if (path.resolve(cwd) === path.resolve(absolutePath)) return '.'
  const relative = toRelativeToolPath(cwd, absolutePath)
  return relative
}

function buildRipgrepArgs(
  input: GrepInput,
  outputMode: 'content' | 'files_with_matches' | 'count',
): string[] {
  const args = ['--hidden']
  for (const dir of DEFAULT_DIRECTORIES_TO_EXCLUDE) {
    args.push('--glob', `!${dir}`)
    args.push('--glob', `!${dir}/**`)
    args.push('--glob', `!**/${dir}/**`)
  }
  args.push('--max-columns', '500')

  if (input.multiline) args.push('-U', '--multiline-dotall')
  if (input['-i']) args.push('-i')
  if (outputMode === 'files_with_matches') args.push('-l')
  if (outputMode === 'count') args.push('-c')
  if ((input['-n'] ?? true) && outputMode === 'content') args.push('-n')

  if (outputMode === 'content') {
    const context = input.context ?? input['-C']
    if (context !== undefined) {
      args.push('-C', String(context))
    } else {
      if (input['-B'] !== undefined) args.push('-B', String(input['-B']))
      if (input['-A'] !== undefined) args.push('-A', String(input['-A']))
    }
  }

  if (input.type) args.push('--type', input.type)
  for (const glob of splitGlobPatterns(input.glob)) {
    args.push('--glob', glob)
  }
  for (const ignored of input.projectIgnore ?? []) {
    args.push('--glob', `!${ignored}`)
  }
  if (input.pattern?.startsWith('-')) {
    args.push('-e', input.pattern)
  } else {
    args.push(input.pattern ?? '')
  }
  return args
}

async function runRipgrep(
  args: string[],
  cwd: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('rg', args, {
      cwd,
      signal: abortSignal,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.split(/\r?\n/).filter(Boolean)
  } catch (error) {
    if (isNoMatches(error)) return []
    throw error
  }
}

function splitGlobPatterns(glob: string | undefined): string[] {
  if (!glob) return []
  const patterns: string[] = []
  for (const raw of glob.split(/\s+/)) {
    if (raw.includes('{') && raw.includes('}')) {
      patterns.push(raw)
    } else {
      patterns.push(...raw.split(',').filter(Boolean))
    }
  }
  return patterns
}

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset = 0,
): { items: T[]; appliedLimit: number | undefined } {
  if (limit === 0) return { items: items.slice(offset), appliedLimit: undefined }
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + effectiveLimit)
  return {
    items: sliced,
    appliedLimit: items.length - offset > effectiveLimit ? effectiveLimit : undefined,
  }
}

function relativizeRipgrepLine(
  cwd: string,
  line: string,
  useLastColon: boolean,
): string {
  const index = useLastColon ? line.lastIndexOf(':') : line.indexOf(':')
  if (index <= 0) return line
  return normalizeRipgrepPath(cwd, line.slice(0, index)) + line.slice(index)
}

function normalizeRipgrepPath(cwd: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    return filePath.split(path.sep).join('/')
  }
  return toRelativeToolPath(cwd, filePath)
}

function summarizeCounts(lines: string[]): { numFiles: number; numMatches: number } {
  let numFiles = 0
  let numMatches = 0
  for (const line of lines) {
    const index = line.lastIndexOf(':')
    const count = index > 0 ? Number.parseInt(line.slice(index + 1), 10) : NaN
    if (!Number.isNaN(count)) {
      numFiles += 1
      numMatches += count
    }
  }
  return { numFiles, numMatches }
}

function withPagination(
  content: string,
  appliedLimit: number | undefined,
  offset: number,
): string {
  const pagination = formatPagination(appliedLimit, offset)
  return pagination ? `${content}\n\n[Showing results with pagination =${pagination}]` : content
}

function formatPagination(limit: number | undefined, offset: number): string {
  const parts: string[] = []
  if (limit !== undefined) parts.push(`limit: ${limit}`)
  if (offset > 0) parts.push(`offset: ${offset}`)
  return parts.length > 0 ? ` ${parts.join(', ')}` : ''
}

function normalizeOffset(offset: number | undefined): number {
  return Number.isInteger(offset) && offset && offset > 0 ? offset : 0
}

function parseGrepInput(input: unknown): GrepInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    pattern: typeof value.pattern === 'string' ? value.pattern : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
    glob: typeof value.glob === 'string' ? value.glob : undefined,
    type: typeof value.type === 'string' ? value.type : undefined,
    output_mode:
      value.output_mode === 'content' ||
      value.output_mode === 'files_with_matches' ||
      value.output_mode === 'count'
        ? value.output_mode
        : undefined,
    '-A': typeof value['-A'] === 'number' ? value['-A'] : undefined,
    '-B': typeof value['-B'] === 'number' ? value['-B'] : undefined,
    '-C': typeof value['-C'] === 'number' ? value['-C'] : undefined,
    context: typeof value.context === 'number' ? value.context : undefined,
    '-n': typeof value['-n'] === 'boolean' ? value['-n'] : undefined,
    '-i': typeof value['-i'] === 'boolean' ? value['-i'] : undefined,
    head_limit:
      typeof value.head_limit === 'number' ? value.head_limit : undefined,
    offset: typeof value.offset === 'number' ? value.offset : undefined,
    multiline: typeof value.multiline === 'boolean' ? value.multiline : undefined,
  }
}

function isNoMatches(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 1
  )
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
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
