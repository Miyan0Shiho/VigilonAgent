import { readdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { RuntimeSkill, RuntimeSkillSource, TranscriptEvent } from './contracts.js'
import { createTimestamp } from './transcript.js'

export type LoadRuntimeSkillsOptions = {
  cwd: string
  env?: NodeJS.ProcessEnv
  skillDirs?: string[]
  includeGlobal?: boolean
}

export type LoadedRuntimeSkills = {
  skills: RuntimeSkill[]
  scannedDirs: string[]
}

type SkillDirSource = {
  dir: string
  source: RuntimeSkillSource
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/

export async function loadRuntimeSkills(
  options: LoadRuntimeSkillsOptions,
): Promise<LoadedRuntimeSkills> {
  const dirs = getRuntimeSkillDirs(options)
  const scannedDirs: string[] = []
  const skills: RuntimeSkill[] = []
  const seen = new Set<string>()

  for (const source of dirs) {
    const entries = await readSkillDir(source).catch(error => {
      if (isNotFound(error)) return undefined
      throw error
    })
    if (!entries) continue
    scannedDirs.push(source.dir)
    for (const entry of entries) {
      const skillPath = path.join(source.dir, entry, 'SKILL.md')
      const identity = await getFileIdentity(skillPath)
      if (!identity || seen.has(identity)) continue
      const skill = await readSkillFile({
        skillPath,
        root: path.dirname(skillPath),
        name: entry,
        source: source.source,
      }).catch(error => {
        if (isNotFound(error)) return undefined
        throw error
      })
      if (!skill) continue
      seen.add(identity)
      skills.push(skill)
    }
  }

  return {
    skills: skills.filter(skill => !skill.disableModelInvocation),
    scannedDirs,
  }
}

export function injectSkillListing(
  events: readonly TranscriptEvent[],
  skills: readonly RuntimeSkill[],
): TranscriptEvent[] {
  if (skills.length === 0) return [...events]
  return [
    {
      type: 'user',
      content: buildSkillListing(skills),
      timestamp: createTimestamp(),
    },
    ...events,
  ]
}

export function buildSkillListing(skills: readonly RuntimeSkill[]): string {
  const lines = skills
    .map(skill => {
      const whenToUse = skill.whenToUse ? ` When to use: ${skill.whenToUse}` : ''
      return `- ${skill.name}: ${skill.description}${whenToUse}`
    })
    .join('\n')
  return `The following local skills are available for use with the Skill tool:\n\n${lines}\n\nInvoke Skill with the exact skill name to load the complete instructions.`
}

export function buildSkillContent(skill: RuntimeSkill, args?: string): string {
  const normalizedRoot = process.platform === 'win32'
    ? skill.root.replace(/\\/g, '/')
    : skill.root
  const content = substituteSkillVariables(skill.content, normalizedRoot, args)
  return `### Skill: ${skill.name}\nPath: ${skill.path}\n\nBase directory for this skill: ${normalizedRoot}\n\n${content}`
}

function getRuntimeSkillDirs(options: LoadRuntimeSkillsOptions): SkillDirSource[] {
  const includeGlobal =
    options.includeGlobal ?? options.env?.VIGILON_DISABLE_GLOBAL_SETTINGS !== '1'
  const dirs: SkillDirSource[] = []
  if (includeGlobal) {
    dirs.push({ dir: path.join(homedir(), '.vigilon', 'skills'), source: 'user' })
  }
  dirs.push(
    { dir: path.join(options.cwd, '.vigilon', 'skills'), source: 'project' },
    { dir: path.join(options.cwd, '.vigilon', 'skills.local'), source: 'local' },
  )
  for (const dir of options.skillDirs ?? []) {
    dirs.push({ dir: path.resolve(options.cwd, dir), source: 'custom' })
  }
  return dirs
}

async function readSkillDir(source: SkillDirSource): Promise<string[]> {
  const entries = await readdir(source.dir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}

async function readSkillFile(options: {
  skillPath: string
  root: string
  name: string
  source: RuntimeSkillSource
}): Promise<RuntimeSkill> {
  const markdown = await readFile(options.skillPath, 'utf8')
  const parsed = parseSkillMarkdown(markdown)
  const description =
    parseString(parsed.frontmatter.description) ??
    extractDescription(parsed.content) ??
    `Local skill ${options.name}`
  return {
    name: parseString(parsed.frontmatter.name) ?? options.name,
    description,
    content: parsed.content.trim(),
    path: options.skillPath,
    root: options.root,
    source: options.source,
    whenToUse: parseString(parsed.frontmatter.when_to_use),
    allowedTools: parseStringList(parsed.frontmatter['allowed-tools']),
    disableModelInvocation: parseBoolean(parsed.frontmatter['disable-model-invocation']),
    userInvocable: parseBoolean(parsed.frontmatter['user-invocable'], false),
    paths: parseStringList(parsed.frontmatter.paths),
    model: parseString(parsed.frontmatter.model),
    effort: parseString(parsed.frontmatter.effort),
  }
}

function parseSkillMarkdown(markdown: string): {
  frontmatter: Record<string, unknown>
  content: string
} {
  const match = markdown.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: {}, content: markdown }
  return {
    frontmatter: parseSimpleYaml(match[1] ?? ''),
    content: markdown.slice(match[0].length),
  }
}

function parseSimpleYaml(input: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2] ?? ''
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value
        .slice(1, -1)
        .split(',')
        .map(item => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else {
      result[key] = value
    }
  }
  return result
}

function substituteSkillVariables(
  content: string,
  skillDir: string,
  args?: string,
): string {
  return content
    .replaceAll('${VIGILON_SKILL_DIR}', skillDir)
    .replaceAll('${CLAUDE_SKILL_DIR}', skillDir)
    .replaceAll('$ARGUMENTS', args ?? '')
}

function extractDescription(content: string): string | undefined {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  return content
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0 && !line.startsWith('#'))
}

function parseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value !== 'string' || value.trim() === '') return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value !== 'string') return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
