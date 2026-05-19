import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConfigTool,
  InMemoryTranscriptStore,
  createMutablePermissionGate,
  type RuntimeProjectConfig,
  type RuntimeSessionState,
  type ToolUseContext,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('ConfigTool', () => {
  it('does not advertise Config as a globally read-only tool', () => {
    expect(ConfigTool.readOnly).not.toBe(true)
  })

  it('reads the effective merged value for a supported setting', async () => {
    const cwd = await createTempRoot('vigilon-config-tool-')
    await writeSettings(cwd, 'settings.json', {
      permissionMode: 'ask',
    })
    await writeSettings(cwd, 'settings.local.json', {
      permissionMode: 'read-only',
    })

    const result = await ConfigTool.invoke(
      { setting: 'permissionMode' },
      createContext(cwd),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('permissionMode')
    expect(result.content).toContain('read-only')
    expect(result.metadata).toMatchObject({
      setting: 'permissionMode',
      mode: 'get',
      effectiveValue: 'read-only',
    })
  })

  it('reads supported settings without requesting write permission', async () => {
    const cwd = await createTempRoot('vigilon-config-tool-')
    const context = createContext(cwd)
    const permissionSpy = vi.spyOn(context.permissionGate, 'requestPermission')

    const result = await ConfigTool.invoke(
      { setting: 'permissionMode' },
      context,
    )

    expect(result.ok).toBe(true)
    expect(permissionSpy).not.toHaveBeenCalled()
  })

  it('writes permissionMode to local settings and updates runtime permission state immediately', async () => {
    const cwd = await createTempRoot('vigilon-config-tool-')
    const context = createContext(cwd, {
      permissionMode: 'ask',
      gateMode: 'bypass-local',
    })

    const result = await ConfigTool.invoke(
      {
        setting: 'permissionMode',
        value: 'accept-edits',
        source: 'local',
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(context.sessionState.permissionMode).toBe('accept-edits')
    await expect(
      context.permissionGate.requestPermission({
        action: 'write',
        subject: 'src/app.ts',
        risk: 'low',
        reason: 'verify immediate config effect',
      }),
    ).resolves.toMatchObject({ allowed: true })
    await expect(
      readFile(path.join(cwd, '.vigilon', 'settings.local.json'), 'utf8'),
    ).resolves.toContain('"permissionMode": "accept-edits"')
  })

  it('writes project.allowedTools and mutates the in-memory project config for later turns', async () => {
    const cwd = await createTempRoot('vigilon-config-tool-')
    const context = createContext(cwd, {
      gateMode: 'bypass-local',
      projectConfig: {
        ignore: [],
        defaultCommands: {},
      },
    })

    const result = await ConfigTool.invoke(
      {
        setting: 'project.allowedTools',
        value: ['Read', 'Grep'],
        source: 'project',
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(context.projectConfig?.allowedTools).toEqual(['Read', 'Grep'])
    await expect(
      readFile(path.join(cwd, '.vigilon', 'settings.json'), 'utf8'),
    ).resolves.toContain('"allowedTools": [')
  })

  it('rejects unsupported settings instead of editing arbitrary JSON paths', async () => {
    const cwd = await createTempRoot('vigilon-config-tool-')

    const result = await ConfigTool.invoke(
      { setting: 'project.defaultCommands.test', value: 'pnpm test' },
      createContext(cwd),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('Unknown setting')
  })

  it('returns a tool failure when a supported setting value is invalid', async () => {
    const cwd = await createTempRoot('vigilon-config-tool-')
    const context = createContext(cwd, {
      gateMode: 'bypass-local',
    })

    await expect(
      ConfigTool.invoke(
        {
          setting: 'permissionMode',
          value: 'definitely-invalid',
        },
        context,
      ),
    ).resolves.toMatchObject({
      ok: false,
      content: expect.stringContaining('permissionMode must be one of'),
    })
  })
})

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writeSettings(
  cwd: string,
  filename: 'settings.json' | 'settings.local.json',
  value: unknown,
): Promise<void> {
  const dir = path.join(cwd, '.vigilon')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function createContext(
  cwd: string,
  options: {
    permissionMode?: 'read-only' | 'ask' | 'accept-edits' | 'bypass-local'
    gateMode?: 'read-only' | 'ask' | 'accept-edits' | 'bypass-local'
    projectConfig?: RuntimeProjectConfig
  } = {},
): ToolUseContext {
  const transcript = new InMemoryTranscriptStore()
  const permissionMode = options.permissionMode ?? 'ask'
  const gateMode = options.gateMode ?? permissionMode
  const sessionState: RuntimeSessionState = {
    phase: 'execute',
    permissionMode,
    prePlanPermissionMode: undefined,
    todos: [],
    approvedPlan: undefined,
    pendingPlan: undefined,
    handoffReport: undefined,
    verificationNotes: [],
    backgroundTasks: [],
    discoveredToolNames: [],
    mcpInstructions: [],
  }
  return {
    cwd,
    abortSignal: new AbortController().signal,
    permissionGate: createMutablePermissionGate({ mode: gateMode, transcript }),
    transcript,
    sessionState,
    projectConfig: options.projectConfig ?? {
      ignore: [],
      defaultCommands: {},
    },
    lspServerManager: {
      getAllServers: () => new Map(),
      initialize: async () => undefined,
      shutdown: async () => undefined,
      getServer: () => undefined,
    } as ToolUseContext['lspServerManager'],
    taskManager: {
      activeTasks: [],
      startBashTask: async () => 'task-id',
      stopTask: async () => true,
      killTask: async () => true,
      shutdown: async () => undefined,
    },
    tools: {
      list: () => [],
      find: () => undefined,
    },
  }
}
