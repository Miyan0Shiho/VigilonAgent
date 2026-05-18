import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'

const execAsync = promisify(exec)
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_CHARS = 20_000
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
      return ok(formatShellOutput(stdout, stderr, maxOutputChars), {
        exitCode: 0,
        truncated: stdout.length + stderr.length > maxOutputChars,
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
          formatShellOutput(
            shellError.stdout ?? '',
            shellError.stderr ?? shellError.message ?? '',
            maxOutputChars,
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
