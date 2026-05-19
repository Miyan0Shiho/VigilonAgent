import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { LocalAgentDefinition } from './contracts.js'

export async function readLocalAgentDefinition(
  cwd: string,
  agentName: string,
): Promise<LocalAgentDefinition> {
  const filePath = path.join(cwd, '.vigilon', 'agents', `${agentName}.md`)
  const raw = await readFile(filePath, 'utf8')
  const parsed = parseAgentMarkdown(raw)
  return {
    name: agentName,
    description: parsed.description ?? `Local agent ${agentName}`,
    systemPrompt: parsed.body.trim(),
    allowedTools: parsed.allowedTools,
    maxTurns: parsed.maxTurns ?? 4,
  }
}

function parseAgentMarkdown(content: string): {
  description?: string
  allowedTools: string[]
  maxTurns?: number
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
  let description: string | undefined
  let maxTurns: number | undefined
  let inAllowedTools = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('description:')) {
      description = trimmed.slice('description:'.length).trim()
      inAllowedTools = false
      continue
    }
    if (trimmed.startsWith('maxTurns:')) {
      const value = Number(trimmed.slice('maxTurns:'.length).trim())
      if (Number.isInteger(value) && value > 0) maxTurns = value
      inAllowedTools = false
      continue
    }
    if (trimmed === 'allowedTools:') {
      inAllowedTools = true
      continue
    }
    if (inAllowedTools && trimmed.startsWith('- ')) {
      allowedTools.push(trimmed.slice(2).trim())
      continue
    }
    inAllowedTools = false
  }

  return { description, allowedTools, maxTurns, body }
}
