import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  PermissionMode,
  Tool,
  ToolResult,
  ToolUseContext,
} from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { loadRuntimeSettings } from '../runtime/settings.js'

type SupportedSetting = 'permissionMode' | 'project.allowedTools'
type ConfigSource = 'project' | 'local'

const SUPPORTED_SETTINGS = new Set<SupportedSetting>([
  'permissionMode',
  'project.allowedTools',
])

const PERMISSION_MODES = new Set<PermissionMode>([
  'read-only',
  'ask',
  'accept-edits',
  'bypass-local',
])

export const ConfigTool: Tool = {
  name: 'Config',
  description:
    'Reads or updates a small whitelist of runtime settings through a source-aware config surface.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      setting: {
        type: 'string',
        description: 'Supported setting key such as permissionMode or project.allowedTools.',
      },
      value: {
        description: 'Optional value. Omit it to read the effective setting value.',
      },
      source: {
        type: 'string',
        description: 'Write target for set operations: project or local. Defaults to local.',
      },
    },
    required: ['setting'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    try {
      const parsed = parseConfigInput(input)
      if (!parsed.setting) {
        return failed('Config requires a supported "setting" key.')
      }
      if (!SUPPORTED_SETTINGS.has(parsed.setting)) {
        return failed(`Unknown setting: ${parsed.setting}`)
      }

      if (parsed.value === undefined) {
        const loaded = await loadRuntimeSettings({
          cwd: context.cwd,
          includeGlobal: false,
        })
        const effectiveValue = readEffectiveSetting(loaded.settings, parsed.setting)
        return {
          toolCallId: '',
          ok: true,
          content: `Config ${parsed.setting} = ${formatValue(effectiveValue)}`,
          metadata: {
            mode: 'get',
            setting: parsed.setting,
            effectiveValue,
          },
        }
      }

      const permission = await context.permissionGate.requestPermission({
        action: 'write',
	      subject: `config:${parsed.setting}`,
	      risk: 'low',
	      reason: `Update runtime setting ${parsed.setting}`,
	      origin: withToolPermissionOrigin(context.permissionOrigin, 'Config'),
	    })
      if (!permission.allowed) {
        return failed(`Config permission denied: ${permission.reason}`)
      }

      const source = parsed.source ?? 'local'
      const coercedValue = coerceSettingValue(parsed.setting, parsed.value)
      const filePath = getSettingsPath(context.cwd, source)
      const previousDocument = await readSettingsDocument(filePath)
      const previousValue = readRawSetting(previousDocument, parsed.setting)
      const nextDocument = writeRawSetting(previousDocument, parsed.setting, coercedValue)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(nextDocument, null, 2)}\n`, 'utf8')

      applyImmediateEffect(context, parsed.setting, coercedValue)

      return {
        toolCallId: '',
        ok: true,
        content: `Updated ${parsed.setting} in ${filePath} to ${formatValue(coercedValue)}`,
        metadata: {
          mode: 'set',
          setting: parsed.setting,
          source,
          filePath,
          previousValue,
          value: coercedValue,
        },
      }
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
  },
}

function parseConfigInput(input: unknown): {
  setting?: SupportedSetting
  value?: unknown
  source?: ConfigSource
} {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    setting:
      typeof value.setting === 'string' && value.setting.trim()
        ? (value.setting.trim() as SupportedSetting)
        : undefined,
    value: Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : undefined,
    source: value.source === 'project' || value.source === 'local' ? value.source : undefined,
  }
}

function readEffectiveSetting(
  settings: Awaited<ReturnType<typeof loadRuntimeSettings>>['settings'],
  setting: SupportedSetting,
): unknown {
  if (setting === 'permissionMode') return settings.permissionMode
  return settings.project?.allowedTools
}

function readRawSetting(document: Record<string, unknown>, setting: SupportedSetting): unknown {
  if (setting === 'permissionMode') return document.permissionMode
  if (!isRecord(document.project)) return undefined
  return document.project.allowedTools
}

function writeRawSetting(
  document: Record<string, unknown>,
  setting: SupportedSetting,
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...document }
  if (setting === 'permissionMode') {
    next.permissionMode = value
    return next
  }

  const project = isRecord(next.project) ? { ...next.project } : {}
  project.allowedTools = value
  next.project = project
  return next
}

function coerceSettingValue(setting: SupportedSetting, value: unknown): unknown {
  if (setting === 'permissionMode') {
    if (typeof value !== 'string' || !PERMISSION_MODES.has(value as PermissionMode)) {
      throw new Error(
        `Config setting permissionMode must be one of: ${[...PERMISSION_MODES].join(', ')}`,
      )
    }
    return value
  }

  if (Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim())) {
    return value.map(item => item.trim())
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  }
  throw new Error('Config setting project.allowedTools must be a string list or comma-separated string.')
}

function getSettingsPath(cwd: string, source: ConfigSource): string {
  return path.join(
    cwd,
    '.vigilon',
    source === 'project' ? 'settings.json' : 'settings.local.json',
  )
}

async function readSettingsDocument(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    if (!isRecord(raw)) {
      throw new Error('settings file must contain a JSON object')
    }
    return raw
  } catch (error) {
    if (isNotFound(error)) return {}
    throw error
  }
}

function applyImmediateEffect(
  context: ToolUseContext,
  setting: SupportedSetting,
  value: unknown,
): void {
  if (setting === 'permissionMode') {
    if (context.sessionState) {
      context.sessionState.permissionMode = value as PermissionMode
    }
    if (
      'setMode' in context.permissionGate &&
      typeof context.permissionGate.setMode === 'function'
    ) {
      context.permissionGate.setMode(value as PermissionMode)
    }
    return
  }

  if (!context.projectConfig) return
  context.projectConfig.allowedTools = value as string[]
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function failed(content: string): ToolResult {
  return {
    toolCallId: '',
    ok: false,
    content,
  }
}
