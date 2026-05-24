import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PermissionMode, PreToolUseHook, RuntimeProjectConfig } from '../runtime/contracts.js'
import {
  loadRuntimeMcpTools,
  type LoadedRuntimeMcp,
} from '../runtime/mcp.js'
import {
  createSettingsPreToolUseHooks,
  loadRuntimeSettings,
  normalizeProjectConfig,
  type LoadedRuntimeSettings,
} from '../runtime/settings.js'
import {
  loadRuntimeSkills,
  type LoadedRuntimeSkills,
} from '../runtime/skills.js'
import {
  buildProjectInstructionsGuidance,
  loadProjectInstructions,
  type ProjectInstructions,
} from '../runtime/projectInstructions.js'
import type { Tool } from '../runtime/contracts.js'

export type CliIO = {
  stdout: Pick<NodeJS.WriteStream, 'write'>
  stderr: Pick<NodeJS.WriteStream, 'write'>
  stdin?: NodeJS.ReadableStream
  env: NodeJS.ProcessEnv
}

export type CliDeps = {
  createModelClient?: (env: NodeJS.ProcessEnv) => import('../runtime/contracts.js').ModelClient
}

export type QuestionReader = {
  question(prompt: string): Promise<string>
  close(): void
}

export type ParsedOptions = {
  cwd: string
  sessionsDir?: string
  permissionMode?: PermissionMode
  maxTurns?: number
  sessionId?: string
  model?: string
  deepseekBaseUrl?: string
  approvePlan?: boolean
  prompt: string
}

export type ResolvedOptions = Omit<ParsedOptions, 'permissionMode'> & {
  permissionMode: PermissionMode
  settings: LoadedRuntimeSettings
  skills: LoadedRuntimeSkills
  mcp: LoadedRuntimeMcp
  projectConfig: RuntimeProjectConfig
  projectInstructions: ProjectInstructions
  preToolUseHooks: PreToolUseHook[]
}

export const PERMISSION_MODES = new Set<PermissionMode>([
  'read-only',
  'ask',
  'accept-edits',
  'bypass-local',
])

export function parseOptions(
  args: string[],
  options: { requirePrompt: boolean },
): ParsedOptions {
  const promptParts: string[] = []
  let cwd = process.cwd()
  let sessionsDir: string | undefined
  let permissionMode: PermissionMode | undefined
  let maxTurns: number | undefined
  let sessionId: string | undefined
  let model: string | undefined
  let deepseekBaseUrl: string | undefined
  let approvePlan = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') {
      cwd = requireValue(args, (index += 1), '--cwd')
      continue
    }
    if (arg === '--sessions-dir') {
      sessionsDir = requireValue(args, (index += 1), '--sessions-dir')
      continue
    }
    if (arg === '--permission-mode') {
      const value = requireValue(args, (index += 1), '--permission-mode')
      if (!PERMISSION_MODES.has(value as PermissionMode)) {
        throw new Error(`Unsupported permission mode: ${value}`)
      }
      permissionMode = value as PermissionMode
      continue
    }
    if (arg === '--max-turns') {
      maxTurns = parsePositiveInteger(requireValue(args, (index += 1), '--max-turns'))
      continue
    }
    if (arg === '--model') {
      model = requireValue(args, (index += 1), '--model')
      continue
    }
    if (arg === '--deepseek-base-url') {
      deepseekBaseUrl = requireValue(args, (index += 1), '--deepseek-base-url')
      continue
    }
    if (arg === '--session-id') {
      sessionId = requireValue(args, (index += 1), '--session-id')
      continue
    }
    if (arg === '--approve-plan') {
      approvePlan = true
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`)
    }
    promptParts.push(arg)
  }

  const prompt = promptParts.join(' ').trim()
  if (options.requirePrompt && !prompt) {
    throw new Error('prompt is required')
  }
  return {
    cwd,
    sessionsDir,
    permissionMode,
    maxTurns,
    sessionId,
    model,
    deepseekBaseUrl,
    approvePlan,
    prompt,
  }
}

export function parseInitOptions(
  args: string[],
  env: NodeJS.ProcessEnv,
): {
  cwd: string
  force: boolean
  model: string
  permissionMode: PermissionMode
} {
  let cwd = process.cwd()
  let force = false
  let model = env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'
  let permissionMode: PermissionMode = 'ask'
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--cwd') {
      cwd = requireValue(args, ++index, '--cwd')
      continue
    }
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--model') {
      model = requireValue(args, ++index, '--model')
      continue
    }
    if (arg === '--permission-mode') {
      const value = requireValue(args, ++index, '--permission-mode')
      if (!PERMISSION_MODES.has(value as PermissionMode)) {
        throw new Error(`Unsupported permission mode: ${value}`)
      }
      permissionMode = value as PermissionMode
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return { cwd, force, model, permissionMode }
}

export function parseMemoryOperationArgs(args: string[]): {
  optionArgs: string[]
  content?: string
  memoryKind?: import('../runtime/projectMemory.js').LongTermMemoryKind
  topic?: string
  background: boolean
  refreshBeforeValidate: boolean
} {
  const optionArgs: string[] = []
  let content: string | undefined
  let memoryKind: import('../runtime/projectMemory.js').LongTermMemoryKind | undefined
  let topic: string | undefined
  let background = false
  let refreshBeforeValidate = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--background') {
      background = true
      continue
    }
    if (arg === '--refresh') {
      refreshBeforeValidate = true
      continue
    }
    if (arg === '--content') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('--content requires a value')
      }
      content = value
      index += 1
      continue
    }
    if (arg === '--type') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('--type requires a value')
      }
      if (!['user', 'feedback', 'project', 'reference'].includes(value)) {
        throw new Error(`Unsupported long-term memory type: ${value}`)
      }
      memoryKind = value as import('../runtime/projectMemory.js').LongTermMemoryKind
      index += 1
      continue
    }
    if (arg === '--topic') {
      const value = args[index + 1]
      if (value === undefined) {
        throw new Error('--topic requires a value')
      }
      topic = value
      index += 1
      continue
    }
    optionArgs.push(arg)
  }
  return { optionArgs, content, memoryKind, topic, background, refreshBeforeValidate }
}

export function parseCompactOperationArgs(args: string[]): {
  optionArgs: string[]
  summary?: string
  validateMemory: boolean
  reactiveEventCount: number
  tokenBudget?: number
  contextWindowTokens?: number
  reservedOutputTokens?: number
  reservedSystemTokens?: number
  reservedToolSchemaTokens?: number
  safetyMarginTokens?: number
  pressureThreshold?: number
} {
  const optionArgs: string[] = []
  let summary: string | undefined
  let validateMemory = false
  let reactiveEventCount = 12
  let tokenBudget: number | undefined
  let contextWindowTokens: number | undefined
  let reservedOutputTokens: number | undefined
  let reservedSystemTokens: number | undefined
  let reservedToolSchemaTokens: number | undefined
  let safetyMarginTokens: number | undefined
  let pressureThreshold: number | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--summary') {
      summary = requireValue(args, (index += 1), '--summary')
      continue
    }
    if (arg === '--validate-memory') {
      validateMemory = true
      continue
    }
    if (arg === '--reactive-events') {
      reactiveEventCount = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--reactive-events'),
      )
      continue
    }
    if (arg === '--token-budget') {
      tokenBudget = parsePositiveInteger(
        requireValue(args, (index += 1), '--token-budget'),
      )
      continue
    }
    if (arg === '--context-window') {
      contextWindowTokens = parsePositiveInteger(
        requireValue(args, (index += 1), '--context-window'),
      )
      continue
    }
    if (arg === '--output-reserve') {
      reservedOutputTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--output-reserve'),
      )
      continue
    }
    if (arg === '--system-reserve') {
      reservedSystemTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--system-reserve'),
      )
      continue
    }
    if (arg === '--tool-schema-reserve') {
      reservedToolSchemaTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--tool-schema-reserve'),
      )
      continue
    }
    if (arg === '--safety-margin') {
      safetyMarginTokens = parseNonNegativeInteger(
        requireValue(args, (index += 1), '--safety-margin'),
      )
      continue
    }
    if (arg === '--pressure-threshold') {
      pressureThreshold = parsePositiveRatio(requireValue(args, (index += 1), '--pressure-threshold'))
      continue
    }
    optionArgs.push(arg)
  }
  return {
    optionArgs,
    summary,
    validateMemory,
    reactiveEventCount,
    tokenBudget,
    contextWindowTokens,
    reservedOutputTokens,
    reservedSystemTokens,
    reservedToolSchemaTokens,
    safetyMarginTokens,
    pressureThreshold,
  }
}

export async function resolveOptions(
  parsed: ParsedOptions,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedOptions> {
  const settings = await loadRuntimeSettings({ cwd: parsed.cwd, env })
  const skills = await loadRuntimeSkills({
    cwd: parsed.cwd,
    env,
    skillDirs: settings.settings.skillDirs,
  })
  const mcp = await loadRuntimeMcpTools({
    cwd: parsed.cwd,
    env,
    servers: settings.settings.mcpServers,
  })
  const projectConfig = normalizeProjectConfig(settings.settings.project)
  const projectInstructions = await loadProjectInstructions({ cwd: parsed.cwd })
  return {
    ...parsed,
    sessionsDir: parsed.sessionsDir ?? settings.settings.sessionsDir,
    permissionMode: parsed.permissionMode ?? settings.settings.permissionMode ?? 'ask',
    maxTurns: parsed.maxTurns ?? settings.settings.maxTurns,
    model: parsed.model ?? settings.settings.model,
    deepseekBaseUrl: parsed.deepseekBaseUrl ?? settings.settings.deepseekBaseUrl,
    settings,
    skills,
    mcp,
    projectConfig,
    projectInstructions,
    preToolUseHooks: createSettingsPreToolUseHooks(settings.settings),
  }
}

export function buildCliOperatorGuidance(parsed: ResolvedOptions): string {
  const guidance = [
    'CLI task protocol:',
    '- There is no fixed default turn limit; keep working while useful evidence is still being gathered.',
    '- Treat user path exclusions and project ignore patterns as hard task boundaries.',
    '- For repository search, prefer Grep, Glob, Read, and LSP because they preserve project boundaries and produce bounded evidence.',
    '- Use Bash for concise verification or shell-only tasks; avoid broad repository find/ls/grep pipelines when structured tools can answer.',
    '- Keep evidence focused. Stop once the answer is supported instead of exhaustively reading adjacent files.',
    '- Do not re-read files you already read in this session. The Read tool returns a short "file unchanged" note for already-read files — that wastes a turn.',
    '- When you already have file content from earlier in the conversation, reference it directly instead of re-reading.',
    '- For report-style or multi-step tasks, provide a concrete final answer. Use ResultReport only when a structured handoff is useful for audit or resume.',
  ]
  if (parsed.maxTurns !== undefined) {
    guidance.push(
      `This run has an explicit maxTurns limit of ${parsed.maxTurns}; treat it as a protection valve, finish with a supported final answer before the limit when possible, and expect the run to stop if tool use keeps continuing at the limit.`,
    )
  }
  if (parsed.projectConfig.ignore.length > 0) {
    guidance.push(
      `Current ignored path patterns: ${parsed.projectConfig.ignore.join(', ')}`,
    )
  }
  const projectInstructions = buildProjectInstructionsGuidance(parsed.projectInstructions)
  if (projectInstructions) {
    guidance.push(projectInstructions)
  }
  return guidance.join('\n')
}

export function requireValue(args: string[], index: number, option: string): string {
  const value = args[index]
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

export function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, got: ${value}`)
  }
  return parsed
}

export function parseNonNegativeInteger(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got: ${value}`)
  }
  return parsed
}

export function parsePositiveRatio(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive ratio, got: ${value}`)
  }
  return parsed
}

export async function detectDefaultCommands(cwd: string): Promise<Record<string, string>> {
  const packageJsonPath = path.join(cwd, 'package.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  } catch {
    return {}
  }
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return {}
  const runner = await detectPackageRunner(cwd)
  const commands: Record<string, string> = {}
  for (const name of ['test', 'typecheck', 'build', 'lint']) {
    if (typeof parsed.scripts[name] === 'string') {
      commands[name] = `${runner} ${name}`
    }
  }
  return commands
}

export async function detectPackageRunner(cwd: string): Promise<string> {
  if (await fileExists(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await fileExists(path.join(cwd, 'yarn.lock'))) return 'yarn'
  if (await fileExists(path.join(cwd, 'bun.lockb'))) return 'bun run'
  if (await fileExists(path.join(cwd, 'package-lock.json'))) return 'npm run'
  return 'npm run'
}

export async function writeTextFileIfAllowed(
  filePath: string,
  content: string,
  force: boolean,
): Promise<{ created: string[]; skipped: string[] }> {
  if (!force && await fileExists(filePath)) {
    return { created: [], skipped: [filePath] }
  }
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return { created: [filePath], skipped: [] }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export function buildDefaultAgentsInstructions(): string {
  return [
    '# Project Agent Instructions',
    '',
    '- Prefer small, evidence-backed changes over broad rewrites.',
    '- Use project-local tools and scripts before inventing new workflows.',
    '- Respect `.vigilon/settings.json` ignore patterns and permission mode.',
    '- Verify meaningful code changes with the narrowest relevant command first.',
    '',
  ].join('\n')
}

export function formatToolForListing(tool: Tool): {
  name: string
  description: string
  readOnly: boolean
  deferred: boolean
  searchTerms: readonly string[]
} {
  return {
    name: tool.name,
    description: tool.description,
    readOnly: tool.readOnly === true,
    deferred: tool.deferred === true,
    searchTerms: tool.searchTerms ?? [],
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function writeJson(output: Pick<NodeJS.WriteStream, 'write'>, value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`)
}
