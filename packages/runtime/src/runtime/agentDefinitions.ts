import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type {
  AgentCatalog,
  AgentCatalogEntry,
  AgentDefinitionSource,
  LocalAgentDefinition,
  PermissionMode,
  SubagentHostKind,
} from './contracts.js'

const AGENT_SOURCE_PRECEDENCE: AgentDefinitionSource[] = [
  'built-in',
  'plugin',
  'user',
  'project',
  'local',
  'flag',
  'managed',
]

const BUILT_IN_AGENTS: LocalAgentDefinition[] = [
  {
    name: 'general-purpose',
    description: 'General focused local subagent for bounded implementation or investigation tasks',
    systemPrompt: 'You are a focused local subagent. Keep the task bounded and return a concrete handoff. Do not re-read files already read. Reference earlier results directly.',
    allowedTools: ['Read', 'Grep', 'Glob', 'Bash', 'ResultReport'],
    maxTurns: 10,
    source: 'built-in',
    sourceScope: 'runtime',
    memory: 'inherit',
    background: false,
  },
]

type AgentSourceLocation = {
  source: AgentDefinitionSource
  dir?: string
  scope?: string
  definitions?: LocalAgentDefinition[]
}

export async function readLocalAgentDefinition(
  cwd: string,
  agentName: string,
): Promise<LocalAgentDefinition> {
  const catalog = await loadAgentCatalog({ cwd })
  const definition = catalog.active.find(agent => agent.name === agentName)
  if (!definition) {
    throw new Error(`Local agent not found: ${agentName}`)
  }
  return definition
}

export async function loadAgentCatalog(options: {
  cwd: string
  env?: NodeJS.ProcessEnv
  includeGlobal?: boolean
  flagAgents?: LocalAgentDefinition[]
}): Promise<AgentCatalog> {
  const byKey = new Map<string, AgentCatalogEntry[]>()
  for (const location of await getAgentSourceLocations(options)) {
    const definitions = location.definitions
      ? location.definitions
      : await readAgentDefinitionsFromDir(location)
    for (const definition of definitions) {
      const entries = byKey.get(definition.name) ?? []
      entries.push({ definition })
      byKey.set(definition.name, entries)
    }
  }

  const entries: AgentCatalogEntry[] = []
  const active: LocalAgentDefinition[] = []
  for (const sourceEntries of byKey.values()) {
    const winner = sourceEntries.at(-1)
    if (!winner) continue
    active.push(winner.definition)
    for (const entry of sourceEntries) {
      entries.push(
        entry === winner
          ? entry
          : {
              ...entry,
              overriddenBy: winner.definition.source,
            },
      )
    }
  }
  return {
    active: active.sort((a, b) => a.name.localeCompare(b.name)),
    entries: entries.sort((a, b) =>
      a.definition.name.localeCompare(b.definition.name) ||
      sourceRank(a.definition.source) - sourceRank(b.definition.source),
    ),
    precedence: [...AGENT_SOURCE_PRECEDENCE],
  }
}

async function readAgentDefinitionsFromDir(
  location: AgentSourceLocation & { dir?: string },
): Promise<LocalAgentDefinition[]> {
  if (!location.dir) return []
  let entries
  try {
    entries = await readdir(location.dir, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  const definitions = await Promise.all(
    entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async entry => {
        const filePath = path.join(location.dir!, entry.name)
        return readAgentDefinitionFile({
          filePath,
          fallbackName: path.basename(entry.name, '.md'),
          source: location.source,
          sourceScope: location.scope,
        })
      }),
  )
  return definitions
}

async function readAgentDefinitionFile(options: {
  filePath: string
  fallbackName: string
  source: AgentDefinitionSource
  sourceScope?: string
}): Promise<LocalAgentDefinition> {
  const { filePath, fallbackName, source, sourceScope } = options
  const raw = await readFile(filePath, 'utf8')
  const parsed = parseAgentMarkdown(raw)
  return {
    name: parsed.name ?? fallbackName,
    description: parsed.description ?? `Local agent ${parsed.name ?? fallbackName}`,
    systemPrompt: parsed.body.trim(),
    allowedTools: parsed.allowedTools,
    maxTurns: parsed.maxTurns ?? 10,
    source,
    sourceScope,
    sourcePath: filePath,
    permissionMode: parsed.permissionMode,
    model: parsed.model,
    effort: parsed.effort,
    memory: parsed.memory,
    background: parsed.background,
    host: parsed.host,
  }
}

async function getAgentSourceLocations(options: {
  cwd: string
  env?: NodeJS.ProcessEnv
  includeGlobal?: boolean
  flagAgents?: LocalAgentDefinition[]
}): Promise<AgentSourceLocation[]> {
  const includeGlobal =
    options.includeGlobal ?? options.env?.VIGILON_DISABLE_GLOBAL_SETTINGS !== '1'
  const locations: AgentSourceLocation[] = [
    { source: 'built-in', definitions: BUILT_IN_AGENTS },
  ]
  if (includeGlobal) {
    locations.push(
      ...await pluginAgentLocations(
        options.env?.VIGILON_USER_PLUGINS_DIR ?? path.join(homedir(), '.vigilon', 'plugins'),
        'user-plugins',
      ),
      {
        source: 'user',
        dir: options.env?.VIGILON_USER_AGENTS_DIR ?? path.join(homedir(), '.vigilon', 'agents'),
        scope: 'user',
      },
    )
  }
  locations.push(
    ...await pluginAgentLocations(path.join(options.cwd, '.vigilon', 'plugins'), 'project-plugins'),
    { source: 'project', dir: path.join(options.cwd, '.vigilon', 'agents'), scope: 'project' },
    { source: 'local', dir: path.join(options.cwd, '.vigilon', 'agents.local'), scope: 'local' },
  )
  if (options.flagAgents?.length) {
    locations.push({
      source: 'flag',
      scope: 'flag',
      definitions: options.flagAgents.map(agent => ({
        ...agent,
        source: 'flag',
        sourceScope: agent.sourceScope ?? 'flag',
      })),
    })
  }
  const managedDir =
    options.env?.VIGILON_MANAGED_AGENTS_DIR ??
    (includeGlobal ? path.join(homedir(), '.vigilon', 'agents.managed') : undefined)
  if (managedDir) {
    locations.push({ source: 'managed', dir: managedDir, scope: 'managed' })
  }
  locations.push({
    source: 'managed',
    dir: path.join(options.cwd, '.vigilon', 'agents.managed'),
    scope: 'project-managed',
  })
  return locations
}

async function pluginAgentLocations(root: string, scopePrefix: string): Promise<AgentSourceLocation[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  return entries
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({
      source: 'plugin' as const,
      dir: path.join(root, entry.name, 'agents'),
      scope: `${scopePrefix}:${entry.name}`,
    }))
}

function sourceRank(source: AgentDefinitionSource): number {
  return AGENT_SOURCE_PRECEDENCE.indexOf(source)
}

function parseAgentMarkdown(content: string): {
  name?: string
  description?: string
  allowedTools: string[]
  maxTurns?: number
  permissionMode?: PermissionMode
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh'
  memory?: 'inherit' | 'none'
  background?: boolean
  host?: SubagentHostKind
  body: string
} {
  if (!content.startsWith('---\n')) {
    return { allowedTools: [], body: content }
  }

  const end = content.indexOf('\n---\n', 4)
  if (end === -1) {
    return { allowedTools: [], body: content }
  }

  const frontmatter = content.slice(4, end)
  const body = content.slice(end + 5)
  const lines = frontmatter.split(/\r?\n/)
  const allowedTools: string[] = []
  let name: string | undefined
  let description: string | undefined
  let maxTurns: number | undefined
  let permissionMode: PermissionMode | undefined
  let model: string | undefined
  let effort: 'low' | 'medium' | 'high' | 'xhigh' | undefined
  let memory: 'inherit' | 'none' | undefined
  let background: boolean | undefined
  let host: SubagentHostKind | undefined
  let inAllowedTools = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('name:')) {
      name = normalizeScalar(trimmed.slice('name:'.length).trim())
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('description:')) {
      description = normalizeScalar(trimmed.slice('description:'.length).trim())
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('maxTurns:')) {
      const value = Number(trimmed.slice('maxTurns:'.length).trim())
      if (Number.isInteger(value) && value > 0) maxTurns = value
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('permissionMode:')) {
      const value = trimmed.slice('permissionMode:'.length).trim()
      if (isPermissionMode(value)) permissionMode = value
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('model:')) {
      model = trimmed.slice('model:'.length).trim() || undefined
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('effort:')) {
      const value = trimmed.slice('effort:'.length).trim()
      if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
        effort = value
      }
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('memory:')) {
      const value = trimmed.slice('memory:'.length).trim()
      if (value === 'inherit' || value === 'none') memory = value
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('background:')) {
      const value = trimmed.slice('background:'.length).trim()
      if (value === 'true') background = true
      if (value === 'false') background = false
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('host:')) {
      const value = trimmed.slice('host:'.length).trim()
      if (value === 'local' || value === 'worktree' || value === 'git-worktree') host = value
      inAllowedTools = false
      continue
    }
    if (trimmed === 'allowedTools:' || trimmed === 'tools:') {
      inAllowedTools = true
      continue
    }
    if (inAllowedTools && trimmed.startsWith('- ')) {
      allowedTools.push(trimmed.slice(2).trim())
      continue
    }
    inAllowedTools = false
  }

  return {
    name,
    description,
    allowedTools,
    maxTurns,
    permissionMode,
    model,
    effort,
    memory,
    background,
    host,
    body,
  }
}

function normalizeScalar(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === 'read-only' ||
    value === 'ask' ||
    value === 'accept-edits' ||
    value === 'bypass-local'
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
