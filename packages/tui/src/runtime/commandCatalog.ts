export type TuiCommandName =
  | 'new'
  | 'help'
  | 'clear'
  | 'sessions'
  | 'agents'
  | 'compact'
  | 'details'
  | 'open'
  | 'resume'
  | 'approve'
  | 'doctor'
  | 'quit'

export type TuiCommandDefinition = {
  name: TuiCommandName
  usage: string
  summary: string
  aliases?: string[]
  argumentHint?: string
}

export type ParsedTuiCommand = {
  definition: TuiCommandDefinition
  args: string
  token: string
}

const COMMANDS: readonly TuiCommandDefinition[] = [
  {
    name: 'new',
    usage: '/new <prompt>',
    summary: 'Start a fresh agent task; plain text does the same thing.',
    argumentHint: 'prompt',
  },
  {
    name: 'help',
    usage: '/help',
    summary: 'Show available operator commands.',
  },
  {
    name: 'clear',
    usage: '/clear',
    summary: 'Clear visible turn output without deleting transcripts.',
  },
  {
    name: 'sessions',
    usage: '/sessions',
    summary: 'Refresh the session/task panel.',
  },
  {
    name: 'agents',
    usage: '/agents [inspect|resume|apply|stop] <session> <task-id> [args]',
    summary: 'List, inspect, resume, apply/check/rollback, or stop local subagent tasks.',
    argumentHint: 'inspect|resume|apply|stop',
  },
  {
    name: 'compact',
    usage: '/compact <index|session-id> [--validate-memory] [budget args]',
    summary: 'Run governed memory-first compact for a session and show readiness metadata.',
    argumentHint: 'index|session-id',
  },
  {
    name: 'details',
    usage: '/details',
    summary: 'Toggle detailed tool activity in the current turn.',
  },
  {
    name: 'open',
    usage: '/open <index|session-id>',
    summary: 'Inspect recent transcript events for a session.',
    argumentHint: 'index|session-id',
  },
  {
    name: 'resume',
    usage: '/resume <index|session-id> [prompt]',
    summary: 'Continue a prior session with optional follow-up text.',
    argumentHint: 'index|session-id',
  },
  {
    name: 'approve',
    usage: '/approve <index|session-id> [prompt]',
    summary: 'Approve a pending plan and continue execution.',
    argumentHint: 'index|session-id',
  },
  {
    name: 'doctor',
    usage: '/doctor',
    summary: 'Show runtime health, settings, skills, and MCP loading.',
  },
  {
    name: 'quit',
    usage: '/quit',
    summary: 'Exit the TUI.',
    aliases: ['quit', 'exit'],
  },
]

export function listTuiCommands(): readonly TuiCommandDefinition[] {
  return COMMANDS
}

export function parseTuiCommand(input: string): ParsedTuiCommand | null {
  const raw = input.trim()
  if (!raw) return null
  const [token = '', ...parts] = raw.split(/\s+/)
  const normalized = normalizeCommandToken(token)
  const definition = COMMANDS.find(command =>
    command.name === normalized ||
    command.aliases?.some(alias => normalizeCommandToken(alias) === normalized),
  )
  if (!definition) return null
  const prefixLength = token.length
  return {
    definition,
    args: raw.slice(prefixLength).trim(),
    token,
  }
}

export function getCommandSuggestions(input: string): TuiCommandDefinition[] {
  const raw = input.trimStart()
  if (!raw.startsWith('/')) return []
  const [token = ''] = raw.split(/\s+/, 1)
  const query = normalizeCommandToken(token)
  if (!query) return [...COMMANDS]
  return COMMANDS.filter(command =>
    command.name.startsWith(query) ||
    command.aliases?.some(alias => normalizeCommandToken(alias).startsWith(query)),
  )
}

export function formatCommandHelpLines(): string[] {
  return COMMANDS.map(command => `${command.usage.padEnd(36, ' ')} ${command.summary}`)
}

export function firstCommandSuggestion(input: string): TuiCommandDefinition | undefined {
  return getCommandSuggestions(input)[0]
}

function normalizeCommandToken(token: string): string {
  return token.trim().replace(/^\/+/, '').toLowerCase()
}
