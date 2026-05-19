import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSettingsPreToolUseHooks,
  loadRuntimeSettings,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('runtime settings', () => {
  it('merges project and local settings with local scalar precedence', async () => {
    const cwd = await createTempRoot('vigilon-settings-')
    await writeSettings(cwd, 'settings.json', {
      permissionMode: 'ask',
      maxTurns: 3,
      project: {
        ignore: ['dist/**'],
        defaultCommands: { test: 'pnpm test' },
        allowedTools: ['Read', 'Grep'],
      },
      preToolUse: {
        deny: [{ toolName: 'Bash', reason: 'project blocks shell' }],
      },
    })
    await writeSettings(cwd, 'settings.local.json', {
      permissionMode: 'read-only',
      model: 'deepseek-v4-flash',
      project: {
        ignore: ['coverage/**'],
        defaultCommands: { typecheck: 'pnpm typecheck' },
        allowedTools: ['Read'],
      },
      preToolUse: {
        deny: [{ toolName: ['Write', 'Edit'], reason: 'local blocks edits' }],
      },
    })

    const loaded = await loadRuntimeSettings({
      cwd,
      includeGlobal: false,
    })

    expect(loaded.loadedSources.map(source => source.kind)).toEqual([
      'project',
      'local',
    ])
    expect(loaded.settings).toMatchObject({
      permissionMode: 'read-only',
      maxTurns: 3,
      model: 'deepseek-v4-flash',
      project: {
        ignore: ['dist/**', 'coverage/**'],
        defaultCommands: {
          test: 'pnpm test',
          typecheck: 'pnpm typecheck',
        },
        allowedTools: ['Read'],
      },
    })
    expect(loaded.settings.preToolUse?.deny).toHaveLength(2)
  })

  it('creates a settings PreToolUse hook from deny rules', async () => {
    const hooks = createSettingsPreToolUseHooks({
      preToolUse: {
        deny: [{ toolName: ['Write', 'Edit'], reason: 'writes disabled' }],
      },
    })

    await expect(
      hooks[0]?.evaluate({
        hookEventName: 'PreToolUse',
        toolCall: { id: 'write-1', name: 'Write', input: {} },
        cwd: '/tmp/project',
      }),
    ).resolves.toEqual({
      outcome: 'block',
      reason: 'writes disabled',
    })
    await expect(
      hooks[0]?.evaluate({
        hookEventName: 'PreToolUse',
        toolCall: { id: 'read-1', name: 'Read', input: {} },
        cwd: '/tmp/project',
      }),
    ).resolves.toMatchObject({ outcome: 'allow' })
  })
})

async function writeSettings(
  cwd: string,
  filename: 'settings.json' | 'settings.local.json',
  value: unknown,
): Promise<void> {
  const dir = path.join(cwd, '.vigilon')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, filename), `${JSON.stringify(value, null, 2)}\n`)
}

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}
