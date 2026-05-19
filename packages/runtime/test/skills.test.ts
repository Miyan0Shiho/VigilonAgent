import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSkillContent,
  buildSkillListing,
  createSkillTool,
  InMemoryTranscriptStore,
  loadRuntimeSkills,
  type RuntimeSkill,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('runtime skills', () => {
  it('loads local SKILL.md files with frontmatter and deduplicates by real path', async () => {
    const cwd = await createTempRoot('vigilon-skills-')
    await writeSkill(cwd, '.vigilon/skills/review/SKILL.md', `---
description: Review code changes
when_to_use: Before finalizing edits
allowed-tools: Read, Grep
model: deepseek-v4-pro
---
# Review
Use ${'${VIGILON_SKILL_DIR}'} as the base directory.
`)
    await mkdir(path.join(cwd, 'extra'), { recursive: true })
    await symlink(
      path.join(cwd, '.vigilon', 'skills', 'review'),
      path.join(cwd, 'extra', 'review-link'),
    )

    const loaded = await loadRuntimeSkills({
      cwd,
      includeGlobal: false,
      skillDirs: ['extra'],
    })

    expect(loaded.scannedDirs).toHaveLength(2)
    expect(loaded.skills).toMatchObject([
      {
        name: 'review',
        description: 'Review code changes',
        whenToUse: 'Before finalizing edits',
        allowedTools: ['Read', 'Grep'],
        model: 'deepseek-v4-pro',
      },
    ])
  })

  it('builds a Skill tool that returns complete skill instructions', async () => {
    const skill: RuntimeSkill = {
      name: 'implement',
      description: 'Implementation workflow',
      content: 'Follow this workflow with $ARGUMENTS in ${CLAUDE_SKILL_DIR}.',
      path: '/repo/.vigilon/skills/implement/SKILL.md',
      root: '/repo/.vigilon/skills/implement',
      source: 'project',
      allowedTools: [],
      disableModelInvocation: false,
      userInvocable: false,
    }
    const tool = createSkillTool([skill])
    const result = await tool.invoke(
      { skill: '/implement', args: 'runtime tests' },
      {
        cwd: '/repo',
        abortSignal: new AbortController().signal,
        permissionGate: { async requestPermission() {
          return { allowed: true, reason: 'test' }
        } },
        transcript: new InMemoryTranscriptStore(),
      },
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('### Skill: implement')
    expect(result.content).toContain('runtime tests')
    expect(result.content).toContain('/repo/.vigilon/skills/implement')
  })

  it('formats a model-facing skill listing without full skill bodies', () => {
    const listing = buildSkillListing([
      {
        name: 'review',
        description: 'Review code changes',
        whenToUse: 'Before finalizing edits',
        content: 'long private instructions',
        path: '/repo/.vigilon/skills/review/SKILL.md',
        root: '/repo/.vigilon/skills/review',
        source: 'project',
        allowedTools: [],
        disableModelInvocation: false,
        userInvocable: false,
      },
    ])

    expect(listing).toContain('review: Review code changes')
    expect(listing).toContain('Skill tool')
    expect(listing).not.toContain('long private instructions')
  })

  it('prefixes invoked skill content with path and base directory', () => {
    const content = buildSkillContent({
      name: 'review',
      description: 'Review code changes',
      content: 'Use ${VIGILON_SKILL_DIR}.',
      path: '/repo/.vigilon/skills/review/SKILL.md',
      root: '/repo/.vigilon/skills/review',
      source: 'project',
      allowedTools: [],
      disableModelInvocation: false,
      userInvocable: false,
    })

    expect(content).toContain('Path: /repo/.vigilon/skills/review/SKILL.md')
    expect(content).toContain('Base directory for this skill: /repo/.vigilon/skills/review')
  })
})

async function writeSkill(
  cwd: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(cwd, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}
