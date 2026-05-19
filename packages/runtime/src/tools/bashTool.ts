import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { createTimestamp } from '../runtime/transcript.js'

const execAsync = promisify(exec)
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_CHARS = 20_000
const BROAD_SHELL_PATH_LINE_THRESHOLD = 50
const BROAD_SHELL_GROUP_LIMIT = 12
const DEFAULT_OUTPUT_IGNORE_PATTERNS = [
  '.vigilon',
  '.vigilon/**',
  '**/.vigilon/**',
  '.trae',
  '.trae/**',
  '**/.trae/**',
  'node_modules',
  'node_modules/**',
  '**/node_modules/**',
  'dist',
  'dist/**',
  '**/dist/**',
  'build',
  'build/**',
  '**/build/**',
  'coverage',
  'coverage/**',
  '**/coverage/**',
]
const LOW_RISK_COMMANDS = new Set([
  'cat',
  'head',
  'tail',
  'ls',
  'pwd',
  'echo',
  'printf',
  'rg',
  'grep',
  'find',
  'sed',
  'wc',
])
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'branch',
  'diff',
  'grep',
  'log',
  'ls-files',
  'rev-parse',
  'show',
  'status',
])
const HIGH_RISK_COMMANDS = new Set([
  'rm',
  'rmdir',
  'sudo',
  'doas',
  'pkexec',
])
const WRITE_COMMANDS = new Set([
  'chmod',
  'chown',
  'cp',
  'dd',
  'install',
  'mkdir',
  'mv',
  'tee',
  'touch',
  'truncate',
])
const SHELL_WRAPPERS = new Set([
  'bash',
  'env',
  'fish',
  'nice',
  'nohup',
  'sh',
  'stdbuf',
  'time',
  'timeout',
  'xargs',
  'zsh',
])

type BashInput = {
  command?: string
  timeout?: number
  description?: string
  background?: boolean
}

export const BashTool: Tool = {
  name: 'Bash',
  description:
    'Runs a local shell command with timeout, permission gate, and output truncation.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number' },
      description: { type: 'string' },
      background: { type: 'boolean', description: 'Run in background' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseBashInput(input)
    if (!parsed.command) return failed('Bash requires command')

    const risk = classifyRisk(parsed.command)
    const permission = await context.permissionGate.requestPermission({
      action: 'bash',
      subject: parsed.command,
      risk,
      reason: parsed.description ?? 'Run local shell command',
    })
    if (!permission.allowed) return failed(permission.reason)

    if (parsed.background) {
      const taskId = await context.taskManager.startBashTask(parsed.command, context.cwd)
      if (context.sessionState) {
        context.sessionState.backgroundTasks = context.taskManager.activeTasks.map(task => ({
          ...task,
        }))
        await context.transcript.append({
          type: 'session-state',
          phase: context.sessionState.phase,
          permissionMode: context.sessionState.permissionMode,
          prePlanPermissionMode: context.sessionState.prePlanPermissionMode ?? null,
          todos: context.sessionState.todos.map(todo => ({ ...todo })),
          approvedPlan: context.sessionState.approvedPlan ?? null,
          pendingPlan: context.sessionState.pendingPlan ?? null,
          handoffReport: context.sessionState.handoffReport
            ? {
                finalMessage: context.sessionState.handoffReport.finalMessage,
                changes: [...context.sessionState.handoffReport.changes],
                verified: [...context.sessionState.handoffReport.verified],
                unverified: [...context.sessionState.handoffReport.unverified],
                risks: [...context.sessionState.handoffReport.risks],
              }
            : null,
          verificationNotes: [...context.sessionState.verificationNotes],
          backgroundTasks: context.sessionState.backgroundTasks.map(task => ({ ...task })),
          discoveredToolNames: [...context.sessionState.discoveredToolNames],
          toolReferenceDeltas: [...context.sessionState.toolReferenceDeltas],
          mcpInstructions: [...context.sessionState.mcpInstructions],
          activeSkill: context.sessionState.activeSkill
            ? { ...context.sessionState.activeSkill }
            : null,
          memoryFreshness: context.sessionState.memoryFreshness ?? null,
          systemPrompt: context.sessionState.systemPrompt ?? null,
          toolSchema: context.sessionState.toolSchema ?? null,
          modelParams: context.sessionState.modelParams ?? null,
          timestamp: createTimestamp(),
        })
      }
      return ok(`Command started in background. Task ID: ${taskId}`, {
        taskId,
        status: 'running',
      })
    }

    const timeout =
      parsed.timeout ?? context.bashLimits?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxOutputChars =
      context.bashLimits?.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS

    try {
      const { stdout, stderr } = await execAsync(parsed.command, {
        cwd: context.cwd,
        signal: context.abortSignal,
        timeout,
        maxBuffer: Math.max(maxOutputChars * 4, 1024 * 1024),
      })
      const filtered = filterProjectIgnoredShellOutput(
        stdout,
        stderr,
        context.projectConfig?.ignore ?? [],
      )
      const broadScan = formatBroadShellScanOutput(parsed.command, filtered.stdout)
      return ok(formatShellOutput(broadScan.stdout, filtered.stderr, maxOutputChars), {
        exitCode: 0,
        truncated: broadScan.stdout.length + filtered.stderr.length > maxOutputChars,
        ...(broadScan.detected
          ? {
              broadShellScan: true,
              ...(broadScan.summarized
                ? { directoryGroups: broadScan.directoryGroups }
                : {}),
            }
          : {}),
        ...(filtered.filteredLines > 0
          ? { filteredProjectIgnoredLines: filtered.filteredLines }
          : {}),
      })
    } catch (error) {
      const shellError = error as {
        stdout?: string
        stderr?: string
        code?: number | string
        signal?: string
        message?: string
      }
      return {
        toolCallId: '',
        ok: false,
        content:
          formatFilteredShellError(
            shellError.stdout ?? '',
            shellError.stderr ?? shellError.message ?? '',
            maxOutputChars,
            context.projectConfig?.ignore ?? [],
          ) || `Command failed with code ${String(shellError.code ?? shellError.signal ?? 'unknown')}`,
        metadata: {
          exitCode: shellError.code,
          signal: shellError.signal,
        },
      }
    }
  },
}

function classifyRisk(command: string): 'low' | 'medium' | 'high' {
  const subcommands = splitShellSubcommands(command)
  if (subcommands.length === 0) return 'medium'
  if (hasUnquotedOutputRedirection(command)) return 'medium'

  let sawMedium = false
  for (const subcommand of subcommands) {
    const words = shellWords(subcommand)
    const firstWord = words[0] ?? ''
    if (!firstWord) continue
    if (HIGH_RISK_COMMANDS.has(firstWord)) return 'high'
    if (WRITE_COMMANDS.has(firstWord) || SHELL_WRAPPERS.has(firstWord)) {
      sawMedium = true
      continue
    }
    if (firstWord === 'sed' && words.some(word => /^-[^-]*i/.test(word))) {
      sawMedium = true
      continue
    }
    if (firstWord === 'git') {
      if (!READ_ONLY_GIT_SUBCOMMANDS.has(words[1] ?? '')) sawMedium = true
      continue
    }
    if (!LOW_RISK_COMMANDS.has(firstWord)) sawMedium = true
  }

  return sawMedium ? 'medium' : 'low'
}

function splitShellSubcommands(command: string): string[] {
  const subcommands: string[] = []
  let current = ''
  let quote: "'" | '"' | '`' | null = null
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ''
    const next = command[index + 1] ?? ''
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (
      char === ';' ||
      char === '\n' ||
      char === '|' ||
      (char === '&' && next === '&') ||
      (char === '|' && next === '|')
    ) {
      if (current.trim()) subcommands.push(current.trim())
      current = ''
      if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
        index += 1
      }
      continue
    }
    current += char
  }
  if (current.trim()) subcommands.push(current.trim())
  return subcommands
}

function hasUnquotedOutputRedirection(command: string): boolean {
  let quote: "'" | '"' | '`' | null = null
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ''
    const previous = command[index - 1] ?? ''
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '>' && previous !== '-') return true
  }
  return false
}

function shellWords(command: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: "'" | '"' | '`' | null = null
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ''
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) words.push(current)
  return words
}

function formatShellOutput(
  stdout: string,
  stderr: string,
  maxOutputChars: number,
): string {
  const parts = []
  if (stdout) parts.push(`<stdout>\n${stdout.trimEnd()}\n</stdout>`)
  if (stderr) parts.push(`<stderr>\n${stderr.trimEnd()}\n</stderr>`)
  const output = parts.join('\n')
  if (output.length <= maxOutputChars) return output || '(No output)'
  return `${output.slice(0, maxOutputChars)}\n[Output truncated to ${maxOutputChars} characters]`
}

function formatBroadShellScanOutput(
  command: string,
  stdout: string,
): {
  stdout: string
  detected: boolean
  summarized: boolean
  directoryGroups?: Array<{ directory: string; count: number }>
} {
  if (!stdout || !isBroadFilesystemScanCommand(command)) {
    return { stdout, detected: false, summarized: false }
  }

  const pathLines = stdout
    .split(/\r?\n/)
    .map(line => normalizePathLikeOutputLine(line))
    .filter((line): line is string => Boolean(line))
  if (pathLines.length === 0) {
    return { stdout, detected: false, summarized: false }
  }

  const warning =
    'Broad Bash filesystem scan detected. Prefer Glob/Grep with a narrower path or pattern before reading files.'
  const groups = groupPathsByDirectory(pathLines)
  if (pathLines.length >= BROAD_SHELL_PATH_LINE_THRESHOLD && groups.length >= 2) {
    return {
      stdout: [
        warning,
        `Path-like output was summarized after ${pathLines.length} lines.`,
        'Directory groups:',
        ...groups.slice(0, BROAD_SHELL_GROUP_LIMIT).map(group => `- ${group.directory}: ${group.count}`),
      ].join('\n'),
      detected: true,
      summarized: true,
      directoryGroups: groups,
    }
  }

  return {
    stdout: `${warning}\n${stdout}`,
    detected: true,
    summarized: false,
  }
}

function isBroadFilesystemScanCommand(command: string): boolean {
  return splitShellSubcommands(command).some(subcommand => {
    const words = shellWords(subcommand)
    if (words[0] !== 'find') return false
    const target = words.find(word => !word.startsWith('-') && word !== 'find')
    return !target || target === '.' || target === './'
  })
}

function normalizePathLikeOutputLine(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed || /\s/.test(trimmed)) return undefined
  if (!/^(?:\.{1,2}\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(trimmed)) {
    return undefined
  }
  return trimmed.replace(/^\.\//, '').replace(/\/+$/, '')
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

function formatFilteredShellError(
  stdout: string,
  stderr: string,
  maxOutputChars: number,
  projectIgnore: readonly string[],
): string {
  const filtered = filterProjectIgnoredShellOutput(stdout, stderr, projectIgnore)
  return formatShellOutput(filtered.stdout, filtered.stderr, maxOutputChars)
}

function filterProjectIgnoredShellOutput(
  stdout: string,
  stderr: string,
  projectIgnore: readonly string[],
): { stdout: string; stderr: string; filteredLines: number } {
  const ignore = [...DEFAULT_OUTPUT_IGNORE_PATTERNS, ...projectIgnore]
  const matchers = ignore.map(globToRegex)
  const stdoutResult = filterProjectIgnoredLines(stdout, matchers)
  const stderrResult = filterProjectIgnoredLines(stderr, matchers)
  return {
    stdout: stdoutResult.text,
    stderr: stderrResult.text,
    filteredLines: stdoutResult.filteredLines + stderrResult.filteredLines,
  }
}

function filterProjectIgnoredLines(
  text: string,
  matchers: readonly RegExp[],
): { text: string; filteredLines: number } {
  if (!text) return { text, filteredLines: 0 }
  const trailingNewline = text.endsWith('\n')
  const kept: string[] = []
  let filteredLines = 0
  for (const line of text.split(/\r?\n/)) {
    if (line === '' && trailingNewline) continue
    if (lineContainsIgnoredPath(line, matchers)) {
      filteredLines += 1
    } else {
      kept.push(line)
    }
  }
  return {
    text: kept.join('\n') + (trailingNewline && kept.length > 0 ? '\n' : ''),
    filteredLines,
  }
}

function lineContainsIgnoredPath(line: string, matchers: readonly RegExp[]): boolean {
  const candidates = line.match(/\.?\.?\/?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*/g) ?? []
  return candidates.some(candidate => {
    const normalized = candidate.replace(/^\.?\//, '').replace(/\/+$/, '')
    return matchers.some(matcher => matcher.test(normalized))
  })
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

function parseBashInput(input: unknown): BashInput {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    command: typeof value.command === 'string' ? value.command : undefined,
    timeout: typeof value.timeout === 'number' ? value.timeout : undefined,
    description:
      typeof value.description === 'string' ? value.description : undefined,
    background: typeof value.background === 'boolean' ? value.background : undefined,
  }
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
}

function failed(content: string): ToolResult {
  return { toolCallId: '', ok: false, content }
}
