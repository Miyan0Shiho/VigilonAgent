import { access } from 'node:fs/promises'
import type { BashSafetyEvaluation } from './safetyPolicy.js'

const MACOS_SANDBOX_EXEC = '/usr/bin/sandbox-exec'
const READ_ONLY_SANDBOX_PROFILE = [
  '(version 1)',
  '(allow process*)',
  '(allow file-read*)',
  '(deny file-write*)',
  '(deny network*)',
].join('\n')

export type BashSandboxRuntimeMetadata = {
  requested: boolean
  enforced: boolean
  adapter: 'macos-sandbox-exec' | 'none'
  reason: string
  originalCommand: string
  executedCommand: string
  profile?: string
}

export type BashSandboxExecution = {
  command: string
  metadata: BashSandboxRuntimeMetadata
}

export async function prepareBashSandboxExecution(options: {
  command: string
  policy: BashSafetyEvaluation
  platform?: NodeJS.Platform
  sandboxExecPath?: string
}): Promise<BashSandboxExecution> {
  const platform = options.platform ?? process.platform
  const sandboxExecPath = options.sandboxExecPath ?? MACOS_SANDBOX_EXEC
  const requested =
    options.policy.sandboxDecision === 'sandboxed' && options.policy.readOnly

  if (!requested) {
    return {
      command: options.command,
      metadata: {
        requested: false,
        enforced: false,
        adapter: 'none',
        reason: 'bash safety policy did not request OS sandbox enforcement',
        originalCommand: options.command,
        executedCommand: options.command,
      },
    }
  }

  if (platform !== 'darwin') {
    return {
      command: options.command,
      metadata: {
        requested: true,
        enforced: false,
        adapter: 'none',
        reason: `no supported OS sandbox adapter for platform ${platform}`,
        originalCommand: options.command,
        executedCommand: options.command,
      },
    }
  }

  if (!(await fileExists(sandboxExecPath))) {
    return {
      command: options.command,
      metadata: {
        requested: true,
        enforced: false,
        adapter: 'none',
        reason: `${sandboxExecPath} is not available`,
        originalCommand: options.command,
        executedCommand: options.command,
      },
    }
  }

  const wrapped = [
    shellQuote(sandboxExecPath),
    '-p',
    shellQuote(READ_ONLY_SANDBOX_PROFILE),
    '/bin/sh',
    '-lc',
    shellQuote(options.command),
  ].join(' ')
  return {
    command: wrapped,
    metadata: {
      requested: true,
      enforced: true,
      adapter: 'macos-sandbox-exec',
      reason: 'read-only Bash command is executed through sandbox-exec with file writes and network denied',
      originalCommand: options.command,
      executedCommand: wrapped,
      profile: READ_ONLY_SANDBOX_PROFILE,
    },
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
