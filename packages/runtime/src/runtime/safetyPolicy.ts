import type { PermissionPolicyMetadata } from './contracts.js'

export type BashSedEditSurrogate = {
  kind: 'sed-edit'
  filePath: string
  pattern: string
  replacement: string
  global: boolean
}

export type BashSafetyEvaluation = {
  risk: 'low' | 'medium' | 'high'
  sandboxDecision: PermissionPolicyMetadata['sandboxDecision']
  readOnly: boolean
  reason: string
  findings: string[]
  subcommands: PermissionPolicyMetadata['subcommands']
  pathRefs: string[]
  sedEdit?: BashSedEditSurrogate
  permissionMetadata: PermissionPolicyMetadata
}

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
const SAFE_FLAGS: Record<string, Set<string>> = {
  cat: new Set(['-n', '-b', '-s', '-A', '-E', '-T']),
  head: new Set(['-n', '-c', '-q', '-v']),
  tail: new Set(['-n', '-c', '-q', '-v']),
  ls: new Set(['-a', '-A', '-l', '-h', '-R', '-1', '-d']),
  rg: new Set(['-n', '--line-number', '-i', '--ignore-case', '-S', '--smart-case', '-l', '--files', '--hidden']),
  grep: new Set(['-n', '-i', '-R', '-r', '-l', '-E', '-F']),
  find: new Set(['-maxdepth', '-mindepth', '-name', '-type', '-print', '-not', '!']),
  wc: new Set(['-l', '-w', '-c', '-m']),
  sed: new Set(['-n', '-E', '-e']),
}

export function evaluateBashSafetyPolicy(command: string): BashSafetyEvaluation {
  const findings: string[] = []
  const subcommandTexts = splitShellSubcommands(command)
  const subcommands: BashSafetyEvaluation['subcommands'] = []
  const pathRefs = new Set<string>()

  if (subcommandTexts.length === 0) {
    return buildEvaluation({
      risk: 'medium',
      sandboxDecision: 'ask',
      readOnly: false,
      reason: 'empty_or_unparseable_command',
      findings: ['Command could not be parsed into subcommands.'],
      subcommands,
      pathRefs: [],
    })
  }

  if (subcommandTexts.length > 5) {
    findings.push('compound_command_too_many_subcommands')
  }
  if (hasShellInjectionFeature(command)) {
    findings.push('shell_expansion_or_injection_feature')
  }
  if (hasUnquotedOutputRedirection(command)) {
    findings.push('output_redirection')
  }

  let sawMedium = false
  let sawHigh = false
  let sawWrite = false
  let sedEdit: BashSedEditSurrogate | undefined

  for (const subcommand of subcommandTexts) {
    const words = shellWords(subcommand)
    const executable = words[0] ?? ''
    const operation = classifyOperation(executable, words)
    for (const pathRef of extractPathRefs(words)) pathRefs.add(pathRef)
    subcommands.push({ command: subcommand, executable, operation })

    if (!executable) {
      sawMedium = true
      continue
    }
    if (HIGH_RISK_COMMANDS.has(executable)) {
      sawHigh = true
      findings.push(`high_risk_command:${executable}`)
      continue
    }
    if (SHELL_WRAPPERS.has(executable)) {
      sawMedium = true
      findings.push(`shell_wrapper:${executable}`)
      continue
    }
    if (WRITE_COMMANDS.has(executable)) {
      sawWrite = true
      sawMedium = true
      findings.push(`write_command:${executable}`)
      continue
    }
    if (executable === 'sed' && words.some(word => /^-[^-]*i/.test(word))) {
      sawWrite = true
      sawMedium = true
      sedEdit = parseSedEdit(words)
      findings.push(sedEdit ? 'sed_edit_surrogate' : 'sed_edit_unparseable')
      continue
    }
    if (executable === 'git') {
      if (!READ_ONLY_GIT_SUBCOMMANDS.has(words[1] ?? '')) {
        sawMedium = true
        findings.push('git_mutating_or_unknown_subcommand')
      }
      continue
    }
    if (!LOW_RISK_COMMANDS.has(executable)) {
      sawMedium = true
      findings.push(`unknown_command:${executable}`)
      continue
    }
    if (!flagsAreSafe(executable, words)) {
      sawMedium = true
      findings.push(`unsafe_flags:${executable}`)
    }
  }

  if (findings.includes('shell_expansion_or_injection_feature') || findings.includes('compound_command_too_many_subcommands')) {
    sawMedium = true
  }
  if (findings.includes('output_redirection')) {
    sawWrite = true
    sawMedium = true
  }

  const readOnly = !sawWrite && !sawHigh && !sawMedium
  const risk = sawHigh ? 'high' : sawMedium || sawWrite ? 'medium' : 'low'
  const sandboxDecision =
    sawHigh
      ? 'denied'
      : readOnly
        ? 'sandboxed'
        : sedEdit
          ? 'ask'
          : risk === 'medium'
            ? 'ask'
            : 'sandboxed'
  return buildEvaluation({
    risk,
    sandboxDecision,
    readOnly,
    reason:
      sandboxDecision === 'denied'
        ? 'high-risk shell command is denied before execution'
        : sedEdit
          ? 'sed -i is converted to a permission-gated file edit surrogate'
          : readOnly
            ? 'command matches read-only shell policy'
            : 'command requires explicit approval before unsandboxed execution',
    findings,
    subcommands,
    pathRefs: [...pathRefs],
    sedEdit,
  })
}

function buildEvaluation(options: Omit<BashSafetyEvaluation, 'permissionMetadata'>): BashSafetyEvaluation {
  const permissionMetadata: PermissionPolicyMetadata = {
    kind: 'bash-safety',
    risk: options.risk,
    sandboxDecision: options.sandboxDecision,
    readOnly: options.readOnly,
    reason: options.reason,
    findings: options.findings,
    subcommands: options.subcommands,
    pathRefs: options.pathRefs,
    ...(options.sedEdit
      ? {
          surrogate: {
            kind: 'sed-edit',
            filePath: options.sedEdit.filePath,
          },
        }
      : {}),
  }
  return {
    ...options,
    permissionMetadata,
  }
}

function classifyOperation(
  executable: string,
  words: readonly string[],
): 'read' | 'write' | 'network' | 'unknown' {
  if (HIGH_RISK_COMMANDS.has(executable) || WRITE_COMMANDS.has(executable)) return 'write'
  if (executable === 'sed' && words.some(word => /^-[^-]*i/.test(word))) return 'write'
  if (executable === 'git' && !READ_ONLY_GIT_SUBCOMMANDS.has(words[1] ?? '')) return 'write'
  if (LOW_RISK_COMMANDS.has(executable) || executable === 'git') return 'read'
  return 'unknown'
}

function flagsAreSafe(executable: string, words: readonly string[]): boolean {
  const safeFlags = SAFE_FLAGS[executable]
  if (!safeFlags) return true
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (!word.startsWith('-') || word === '-') continue
    if (word === '--') break
    if (word.includes('=')) {
      const [flag] = word.split('=')
      if (flag && !safeFlags.has(flag)) return false
      continue
    }
    if (!safeFlags.has(word)) return false
  }
  return true
}

function parseSedEdit(words: readonly string[]): BashSedEditSurrogate | undefined {
  const expression = words.find(word => findSedSubstitution(word) !== undefined)
  const filePath = [...words].reverse().find(word => !word.startsWith('-') && word !== expression)
  if (!expression || !filePath) return undefined
  const match = findSedSubstitution(expression)
  if (!match) return undefined
  return {
    kind: 'sed-edit',
    filePath,
    pattern: match.pattern,
    replacement: match.replacement,
    global: match.flags.includes('g'),
  }
}

function findSedSubstitution(word: string): { pattern: string; replacement: string; flags: string } | undefined {
  // Find 's' followed by a non-alphanumeric delimiter, skipping address prefixes like "1s/.../" or "2,5s/.../"
  const match = word.match(/s([^a-zA-Z0-9])/)
  if (!match || match.index === undefined) return undefined
  // Reject if 's' is preceded by a letter (e.g. "basename/test")
  if (match.index > 0 && /[a-zA-Z]/.test(word[match.index - 1] ?? '')) return undefined
  const expression = word.slice(match.index)
  return parseSedSubstitution(expression)
}

function parseSedSubstitution(expression: string): {
  pattern: string
  replacement: string
  flags: string
} | undefined {
  if (!expression.startsWith('s')) return undefined
  const delimiter = expression[1]
  if (!delimiter) return undefined
  const parts: string[] = []
  let current = ''
  let escaped = false
  for (let index = 2; index < expression.length; index += 1) {
    const char = expression[index] ?? ''
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === delimiter) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (parts.length !== 2) return undefined
  return {
    pattern: parts[0] ?? '',
    replacement: parts[1] ?? '',
    flags: current,
  }
}

export function splitShellSubcommands(command: string): string[] {
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

export function shellWords(command: string): string[] {
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

function hasShellInjectionFeature(command: string): boolean {
  return /(^|[^\\])(?:\$\(|\$\{|\$\[|<\(|>\(|`)/.test(command)
}

function extractPathRefs(words: readonly string[]): string[] {
  return words.filter(word =>
    !word.startsWith('-') &&
    word !== '--' &&
    /(?:^\.{0,2}\/|\/|[.][A-Za-z0-9]+$)/.test(word),
  )
}
