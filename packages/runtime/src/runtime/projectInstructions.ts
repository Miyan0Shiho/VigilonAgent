import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export type ProjectInstructionSource = {
  path: string
  content: string
  truncated: boolean
}

export type ProjectInstructions = {
  sources: ProjectInstructionSource[]
}

const PROJECT_INSTRUCTION_PATHS = [
  'AGENTS.md',
  'VIGILON.md',
  path.join('.vigilon', 'instructions.md'),
] as const

const DEFAULT_MAX_INSTRUCTION_BYTES = 64 * 1024

export async function loadProjectInstructions(options: {
  cwd: string
  maxBytes?: number
}): Promise<ProjectInstructions> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_INSTRUCTION_BYTES
  const sources: ProjectInstructionSource[] = []
  for (const relativePath of PROJECT_INSTRUCTION_PATHS) {
    const filePath = path.join(options.cwd, relativePath)
    const file = await readInstructionFile(filePath, maxBytes)
    if (!file) continue
    sources.push(file)
  }
  return { sources }
}

export function buildProjectInstructionsGuidance(
  instructions: ProjectInstructions,
): string | undefined {
  if (instructions.sources.length === 0) return undefined
  return instructions.sources
    .map(source => [
      `<vigilon_project_instructions path="${escapeAttribute(source.path)}" truncated="${source.truncated ? 'true' : 'false'}">`,
      source.content.trim(),
      '</vigilon_project_instructions>',
    ].join('\n'))
    .join('\n\n')
}

async function readInstructionFile(
  filePath: string,
  maxBytes: number,
): Promise<ProjectInstructionSource | null> {
  let size = 0
  try {
    size = (await stat(filePath)).size
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  if (size === 0) return null
  const content = await readFile(filePath, 'utf8')
  const truncated = Buffer.byteLength(content, 'utf8') > maxBytes
  return {
    path: filePath,
    content: truncated ? truncateUtf8(content, maxBytes) : content,
    truncated,
  }
}

function truncateUtf8(input: string, maxBytes: number): string {
  let bytes = 0
  let end = 0
  for (const char of input) {
    const next = Buffer.byteLength(char, 'utf8')
    if (bytes + next > maxBytes) break
    bytes += next
    end += char.length
  }
  return `${input.slice(0, end).trimEnd()}\n\n[Truncated by Vigilon: project instructions exceeded ${maxBytes} bytes.]`
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
