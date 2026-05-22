import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAgentCatalog, type LocalAgentDefinition } from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('loadAgentCatalog', () => {
  it('matches Claude Code source precedence across built-in, plugin, user, project, local, flag, and managed agents', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vigilon-agent-definitions-'))
    tempRoots.push(root)
    const cwd = path.join(root, 'workspace')
    const userAgentsDir = path.join(root, 'user-agents')
    const userPluginsDir = path.join(root, 'user-plugins')
    const managedAgentsDir = path.join(root, 'managed-agents')

    await writeAgent(path.join(userPluginsDir, 'plugin-a', 'agents', 'researcher.md'), {
      name: 'researcher',
      description: 'Plugin researcher',
      prompt: 'Plugin prompt.',
      tools: ['Read'],
    })
    await writeAgent(path.join(cwd, '.vigilon', 'plugins', 'plugin-b', 'agents', 'researcher.md'), {
      name: 'researcher',
      description: 'Project plugin researcher',
      prompt: 'Project plugin prompt.',
      tools: ['Glob'],
    })
    await writeAgent(path.join(userAgentsDir, 'researcher.md'), {
      description: 'User researcher',
      prompt: 'User prompt.',
      tools: ['Grep'],
    })
    await writeAgent(path.join(cwd, '.vigilon', 'agents', 'researcher.md'), {
      description: 'Project researcher',
      prompt: 'Project prompt.',
      tools: ['Bash'],
    })
    await writeAgent(path.join(cwd, '.vigilon', 'agents.local', 'researcher.md'), {
      description: 'Local researcher',
      prompt: 'Local prompt.',
      tools: ['Read', 'Grep'],
    })
    await writeAgent(path.join(managedAgentsDir, 'researcher.md'), {
      description: 'Managed researcher',
      prompt: 'Managed prompt.',
      tools: ['ResultReport'],
    })

    const flagAgent: LocalAgentDefinition = {
      name: 'researcher',
      description: 'Flag researcher',
      systemPrompt: 'Flag prompt.',
      allowedTools: ['Notebook'],
      maxTurns: 2,
      source: 'flag',
    }

    const catalog = await loadAgentCatalog({
      cwd,
      env: {
        VIGILON_USER_AGENTS_DIR: userAgentsDir,
        VIGILON_USER_PLUGINS_DIR: userPluginsDir,
        VIGILON_MANAGED_AGENTS_DIR: managedAgentsDir,
      },
      flagAgents: [flagAgent],
    })

    expect(catalog.precedence).toEqual([
      'built-in',
      'plugin',
      'user',
      'project',
      'local',
      'flag',
      'managed',
    ])
    expect(catalog.active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'researcher',
          source: 'managed',
          sourceScope: 'managed',
          description: 'Managed researcher',
          allowedTools: ['ResultReport'],
        }),
      ]),
    )
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definition: expect.objectContaining({
            name: 'researcher',
            source: 'plugin',
            sourceScope: 'user-plugins:plugin-a',
          }),
          overriddenBy: 'managed',
        }),
        expect.objectContaining({
          definition: expect.objectContaining({
            name: 'researcher',
            source: 'user',
          }),
          overriddenBy: 'managed',
        }),
        expect.objectContaining({
          definition: expect.objectContaining({
            name: 'researcher',
            source: 'project',
          }),
          overriddenBy: 'managed',
        }),
        expect.objectContaining({
          definition: expect.objectContaining({
            name: 'researcher',
            source: 'local',
          }),
          overriddenBy: 'managed',
        }),
        expect.objectContaining({
          definition: expect.objectContaining({
            name: 'researcher',
            source: 'flag',
          }),
          overriddenBy: 'managed',
        }),
      ]),
    )
  })
})

async function writeAgent(filePath: string, options: {
  name?: string
  description: string
  prompt: string
  tools: string[]
}): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    [
      '---',
      options.name ? `name: ${options.name}` : undefined,
      `description: ${options.description}`,
      'tools:',
      ...options.tools.map(tool => `  - ${tool}`),
      '---',
      options.prompt,
    ].filter(Boolean).join('\n'),
    'utf8',
  )
}
