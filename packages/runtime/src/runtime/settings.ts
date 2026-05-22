import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type {
  HookDecision,
  PermissionMode,
  PreToolUseHook,
  PreToolUseHookRequest,
  RuntimeMcpServerConfig,
  RuntimeProjectConfig,
} from './contracts.js'

export type RuntimeSettings = {
  permissionMode?: PermissionMode
  sessionsDir?: string
  maxTurns?: number
  model?: string
  deepseekBaseUrl?: string
  skillDirs?: string[]
  mcpServers?: Record<string, RuntimeMcpServerConfig>
  project?: Partial<RuntimeProjectConfig>
  preToolUse?: {
    deny?: PreToolUseDenyRule[]
  }
}

export type PreToolUseDenyRule = {
  toolName?: string | string[]
  reason?: string
}

export type RuntimeSettingsSource = {
  kind: 'global' | 'project' | 'local'
  path: string
}

export type LoadedRuntimeSettings = {
  settings: RuntimeSettings
  loadedSources: RuntimeSettingsSource[]
}

export type LoadRuntimeSettingsOptions = {
  cwd: string
  env?: NodeJS.ProcessEnv
  includeGlobal?: boolean
}

const PERMISSION_MODES = new Set<PermissionMode>([
  'read-only',
  'ask',
  'accept-edits',
  'bypass-local',
])

export async function loadRuntimeSettings(
  options: LoadRuntimeSettingsOptions,
): Promise<LoadedRuntimeSettings> {
  const sources = getRuntimeSettingsSources(options)
  const loadedSources: RuntimeSettingsSource[] = []
  let settings: RuntimeSettings = {}

  for (const source of sources) {
    const raw = await readOptionalJson(source.path)
    if (raw === undefined) continue
    const next = parseRuntimeSettings(raw, source.path)
    settings = mergeRuntimeSettings(settings, next)
    loadedSources.push(source)
  }

  return { settings, loadedSources }
}

export function createSettingsPreToolUseHooks(
  settings: RuntimeSettings,
): PreToolUseHook[] {
  const denyRules = settings.preToolUse?.deny ?? []
  if (denyRules.length === 0) return []

  return [
    {
      name: 'settings.preToolUse.deny',
      async evaluate(request: PreToolUseHookRequest): Promise<HookDecision> {
        const matchingRule = denyRules.find(rule =>
          toolNameMatches(rule.toolName, request.toolCall.name),
        )
        if (!matchingRule) {
          return {
            outcome: 'allow',
            reason: 'No settings PreToolUse deny rule matched this tool call',
          }
        }
        return {
          outcome: 'block',
          reason:
            matchingRule.reason ??
            `settings PreToolUse deny rule blocked ${request.toolCall.name}`,
        }
      },
    },
  ]
}

function getRuntimeSettingsSources(
  options: LoadRuntimeSettingsOptions,
): RuntimeSettingsSource[] {
  const includeGlobal =
    options.includeGlobal ?? options.env?.VIGILON_DISABLE_GLOBAL_SETTINGS !== '1'
  const sources: RuntimeSettingsSource[] = []
  if (includeGlobal) {
    sources.push({
      kind: 'global',
      path: path.join(homedir(), '.vigilon', 'settings.json'),
    })
  }
  sources.push(
    {
      kind: 'project',
      path: path.join(options.cwd, '.vigilon', 'settings.json'),
    },
    {
      kind: 'local',
      path: path.join(options.cwd, '.vigilon', 'settings.local.json'),
    },
  )
  return sources
}

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }
    throw new Error(
      `Failed to read runtime settings at ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

function parseRuntimeSettings(raw: unknown, sourcePath: string): RuntimeSettings {
  if (!isRecord(raw)) {
    throw new Error(`Runtime settings at ${sourcePath} must be a JSON object`)
  }

  const settings: RuntimeSettings = {}
  if (raw.permissionMode !== undefined) {
    if (
      typeof raw.permissionMode !== 'string' ||
      !PERMISSION_MODES.has(raw.permissionMode as PermissionMode)
    ) {
      throw new Error(
        `Runtime settings at ${sourcePath} contain unsupported permissionMode`,
      )
    }
    settings.permissionMode = raw.permissionMode as PermissionMode
  }
  if (raw.sessionsDir !== undefined) {
    settings.sessionsDir = parseStringSetting(raw.sessionsDir, sourcePath, 'sessionsDir')
  }
  if (raw.maxTurns !== undefined) {
    if (
      typeof raw.maxTurns !== 'number' ||
      !Number.isInteger(raw.maxTurns) ||
      raw.maxTurns < 1
    ) {
      throw new Error(
        `Runtime settings at ${sourcePath} contain invalid maxTurns`,
      )
    }
    settings.maxTurns = raw.maxTurns
  }
  if (raw.model !== undefined) {
    settings.model = parseStringSetting(raw.model, sourcePath, 'model')
  }
  if (raw.deepseekBaseUrl !== undefined) {
    settings.deepseekBaseUrl = parseStringSetting(
      raw.deepseekBaseUrl,
      sourcePath,
      'deepseekBaseUrl',
    )
  }
  if (raw.skillDirs !== undefined) {
    settings.skillDirs = parseStringArraySetting(raw.skillDirs, sourcePath, 'skillDirs')
  }
  if (raw.mcpServers !== undefined) {
    settings.mcpServers = parseMcpServers(raw.mcpServers, sourcePath)
  }
  if (raw.project !== undefined) {
    settings.project = parseProjectConfig(raw.project, sourcePath)
  }
  if (raw.preToolUse !== undefined) {
    settings.preToolUse = parsePreToolUse(raw.preToolUse, sourcePath)
  }
  return settings
}

export function normalizeProjectConfig(
  config: RuntimeSettings['project'] = {},
): RuntimeProjectConfig {
  return {
    ignore: [...(config.ignore ?? [])],
    defaultCommands: { ...(config.defaultCommands ?? {}) },
    allowedTools: config.allowedTools ? [...config.allowedTools] : undefined,
  }
}

function parseProjectConfig(
  raw: unknown,
  sourcePath: string,
): Partial<RuntimeProjectConfig> {
  if (!isRecord(raw)) {
    throw new Error(`Runtime settings at ${sourcePath} contain invalid project`)
  }
  const project: Partial<RuntimeProjectConfig> = {}
  if (raw.ignore !== undefined) {
    project.ignore = parseStringArraySetting(raw.ignore, sourcePath, 'project.ignore')
  }
  if (raw.defaultCommands !== undefined) {
    project.defaultCommands = parseStringRecordSetting(
      raw.defaultCommands,
      sourcePath,
      'project.defaultCommands',
    )
  }
  if (raw.allowedTools !== undefined) {
    project.allowedTools = parseStringArraySetting(
      raw.allowedTools,
      sourcePath,
      'project.allowedTools',
    )
  }
  return project
}

function parsePreToolUse(raw: unknown, sourcePath: string): RuntimeSettings['preToolUse'] {
  if (!isRecord(raw)) {
    throw new Error(`Runtime settings at ${sourcePath} contain invalid preToolUse`)
  }
  const deny = raw.deny === undefined ? [] : parseDenyRules(raw.deny, sourcePath)
  return { deny }
}

function parseDenyRules(raw: unknown, sourcePath: string): PreToolUseDenyRule[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `Runtime settings at ${sourcePath} contain invalid preToolUse.deny`,
    )
  }
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(
        `Runtime settings at ${sourcePath} contain invalid preToolUse.deny[${index}]`,
      )
    }
    const rule: PreToolUseDenyRule = {}
    if (item.toolName !== undefined) {
      if (typeof item.toolName === 'string') {
        rule.toolName = item.toolName
      } else if (
        Array.isArray(item.toolName) &&
        item.toolName.every(value => typeof value === 'string')
      ) {
        rule.toolName = item.toolName
      } else {
        throw new Error(
          `Runtime settings at ${sourcePath} contain invalid preToolUse.deny[${index}].toolName`,
        )
      }
    }
    if (item.reason !== undefined) {
      rule.reason = parseStringSetting(
        item.reason,
        sourcePath,
        `preToolUse.deny[${index}].reason`,
      )
    }
    return rule
  })
}

function parseMcpServers(
  raw: unknown,
  sourcePath: string,
): Record<string, RuntimeMcpServerConfig> {
  if (!isRecord(raw)) {
    throw new Error(`Runtime settings at ${sourcePath} contain invalid mcpServers`)
  }
  const servers: Record<string, RuntimeMcpServerConfig> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      throw new Error(`Runtime settings at ${sourcePath} contain invalid mcpServers.${name}`)
    }
    const command = parseStringSetting(value.command, sourcePath, `mcpServers.${name}.command`)
    const type = value.type === undefined ? undefined : parseStringSetting(value.type, sourcePath, `mcpServers.${name}.type`)
    if (type !== undefined && type !== 'stdio') {
      throw new Error(`Runtime settings at ${sourcePath} contain unsupported mcpServers.${name}.type`)
    }
    const args =
      value.args === undefined
        ? undefined
        : parseStringArraySetting(value.args, sourcePath, `mcpServers.${name}.args`)
    const env =
      value.env === undefined
        ? undefined
        : parseStringRecordSetting(value.env, sourcePath, `mcpServers.${name}.env`)
    servers[name] = { type, command, args, env }
  }
  return servers
}

function mergeRuntimeSettings(
  current: RuntimeSettings,
  next: RuntimeSettings,
): RuntimeSettings {
  return {
    ...current,
    ...next,
    preToolUse: {
      deny: [
        ...(current.preToolUse?.deny ?? []),
        ...(next.preToolUse?.deny ?? []),
      ],
    },
    mcpServers: {
      ...(current.mcpServers ?? {}),
      ...(next.mcpServers ?? {}),
    },
    project: mergeProjectConfig(current.project, next.project),
  }
}

function mergeProjectConfig(
  current: RuntimeSettings['project'],
  next: RuntimeSettings['project'],
): RuntimeSettings['project'] {
  if (!current && !next) return undefined
  return {
    ignore: [...(current?.ignore ?? []), ...(next?.ignore ?? [])],
    defaultCommands: {
      ...(current?.defaultCommands ?? {}),
      ...(next?.defaultCommands ?? {}),
    },
    allowedTools: next?.allowedTools ?? current?.allowedTools,
  }
}

function parseStringSetting(
  value: unknown,
  sourcePath: string,
  key: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Runtime settings at ${sourcePath} contain invalid ${key}`)
  }
  return value
}

function parseStringArraySetting(
  value: unknown,
  sourcePath: string,
  key: string,
): string[] {
  if (
    !Array.isArray(value) ||
    !value.every(item => typeof item === 'string' && item.trim() !== '')
  ) {
    throw new Error(`Runtime settings at ${sourcePath} contain invalid ${key}`)
  }
  return value
}

function parseStringRecordSetting(
  value: unknown,
  sourcePath: string,
  key: string,
): Record<string, string> {
  if (
    !isRecord(value) ||
    !Object.values(value).every(item => typeof item === 'string')
  ) {
    throw new Error(`Runtime settings at ${sourcePath} contain invalid ${key}`)
  }
  return value as Record<string, string>
}

function toolNameMatches(
  configured: string | string[] | undefined,
  actual: string,
): boolean {
  if (configured === undefined) return true
  if (typeof configured === 'string') return configured === actual
  return configured.includes(actual)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
