import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BashTool,
  createLocalPermissionGate,
  createCoreToolRegistry,
  EditTool,
  InMemoryTranscriptStore,
  ReadTool,
  WriteTool,
  createTaskManager,
  type PermissionGate,
  type ToolUseContext,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    tempRoots.map(root => rm(root, { recursive: true, force: true })),
  )
  tempRoots.length = 0
})

describe('execution tools', () => {
  it('core registry exposes execution tools after planning tools', () => {
    expect(createCoreToolRegistry().list().map(tool => tool.name)).toEqual([
      'Read',
      'Glob',
      'Grep',
      'ToolSearch',
      'LSP',
      'AgentInventory',
      'TaskStop',
      'Agent',
      'Config',
      'WebFetch',
      'AskUserQuestion',
      'Notebook',
      'TodoWrite',
      'EnterPlanMode',
      'ExitPlanMode',
      'Write',
      'Edit',
      'Bash',
      'ResultReport',
      'ListDir',
      'Git',
      'ApplyPatch',
      'RunTests',
      'Note',
      'Snapshot',
    ])
  })

  it('Write creates files and requires read-before-overwrite for existing files', async () => {
    const cwd = await createFixture({ 'src/existing.ts': 'export const old = 1\n' })
    const context = createContext(cwd, { mode: 'bypass-local' })

    const create = await WriteTool.invoke(
      { file_path: 'src/new.ts', content: 'export const value = 1\n' },
      context,
    )
    const overwriteBeforeRead = await WriteTool.invoke(
      { file_path: 'src/existing.ts', content: 'export const value = 2\n' },
      context,
    )
    await ReadTool.invoke({ file_path: 'src/existing.ts' }, context)
    const overwriteAfterRead = await WriteTool.invoke(
      { file_path: 'src/existing.ts', content: 'export const value = 3\n' },
      context,
    )

    expect(create.ok).toBe(true)
    expect(create.metadata).toMatchObject({ type: 'create' })
    expect(create.metadata?.diff).toContain('--- a/src/new.ts')
    expect(create.metadata?.diff).toContain('+++ b/src/new.ts')
    expect(overwriteBeforeRead.ok).toBe(false)
    expect(overwriteBeforeRead.content).toContain('fully read')
    expect(overwriteAfterRead.ok).toBe(true)
    expect(overwriteAfterRead.metadata?.diff).toContain('--- a/src/existing.ts')
    expect(await readFile(path.join(cwd, 'src/existing.ts'), 'utf8')).toBe(
      'export const value = 3\n',
    )
  })

  it('Edit rejects stale or ambiguous anchors and applies replace_all', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'target\nkeep\ntarget\n',
    })
    const context = createContext(cwd, { mode: 'bypass-local' })

    const beforeRead = await EditTool.invoke(
      { file_path: 'src/app.ts', old_string: 'keep', new_string: 'kept' },
      context,
    )
    await ReadTool.invoke({ file_path: 'src/app.ts' }, context)
    const ambiguous = await EditTool.invoke(
      { file_path: 'src/app.ts', old_string: 'target', new_string: 'done' },
      context,
    )
    const replaceAll = await EditTool.invoke(
      {
        file_path: 'src/app.ts',
        old_string: 'target',
        new_string: 'done',
        replace_all: true,
      },
      context,
    )

    expect(beforeRead.ok).toBe(false)
    expect(beforeRead.content).toContain('fully read')
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.content).toContain('multiple times')
    expect(replaceAll.ok).toBe(true)
    expect(replaceAll.metadata).toMatchObject({ replacements: 2 })
    expect(replaceAll.metadata?.diff).toContain('+++ b/src/app.ts')
    expect(await readFile(path.join(cwd, 'src/app.ts'), 'utf8')).toBe(
      'done\nkeep\ndone\n',
    )
  })

  it('Edit tolerates straight quotes matching curly quotes', async () => {
    const cwd = await createFixture({
      'quote.txt': 'const text = “hello”\n',
    })
    const context = createContext(cwd, { mode: 'bypass-local' })
    await ReadTool.invoke({ file_path: 'quote.txt' }, context)

    const result = await EditTool.invoke(
      {
        file_path: 'quote.txt',
        old_string: '“hello”',
        new_string: '"hi"',
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(await readFile(path.join(cwd, 'quote.txt'), 'utf8')).toContain(
      '"hi"',
    )
  })

  it('Bash gates high-risk commands and captures low-risk output', async () => {
    const cwd = await createFixture({})
    const transcript = new InMemoryTranscriptStore()
    const context = createContext(cwd, {
      transcript,
      permissionGate: createLocalPermissionGate({ mode: 'read-only', transcript }),
      bashLimits: { timeoutMs: 1_000, maxOutputChars: 120 },
    })

    const echo = await BashTool.invoke({ command: 'echo hello' }, context)
    const rm = await BashTool.invoke({ command: 'rm -rf ./missing' }, context)

    expect(echo.ok).toBe(true)
    expect(echo.content).toContain('<stdout>')
    expect(echo.content).toContain('hello')
    expect(echo.metadata?.safetyPolicy).toMatchObject({
      kind: 'bash-safety',
      sandboxDecision: 'sandboxed',
      readOnly: true,
    })
    expect(echo.metadata?.sandboxRuntime).toMatchObject({
      requested: true,
    })
    expect(rm.ok).toBe(false)
    expect(rm.content).toContain('safety policy denied')
    expect(rm.metadata?.safetyPolicy).toMatchObject({
      sandboxDecision: 'denied',
      findings: expect.arrayContaining(['high_risk_command:rm']),
    })
    expect((await transcript.readAll()).filter(e => e.type === 'permission')).toHaveLength(2)
  })

  it('Bash enforces read-only commands through the OS sandbox when available', async () => {
    const cwd = await createFixture({ 'input.txt': 'alpha\n' })
    const context = createContext(cwd, {
      mode: 'read-only',
      bashLimits: { timeoutMs: 1_000, maxOutputChars: 400 },
    })

    const read = await BashTool.invoke({ command: 'cat input.txt' }, context)

    expect(read.ok).toBe(true)
    expect(read.content).toContain('alpha')
    expect(read.metadata?.sandboxRuntime).toMatchObject({
      requested: true,
      enforced: await canUseMacSandbox(),
    })
  })

  it('Bash OS sandbox blocks a shell-level write even when the local policy classifies it as read-only', async () => {
    if (!(await canUseMacSandbox())) return
    const cwd = await createFixture({ 'input.txt': 'alpha\n' })
    const context = createContext(cwd, {
      mode: 'read-only',
      bashLimits: { timeoutMs: 1_000, maxOutputChars: 800 },
    })

    const result = await BashTool.invoke(
      { command: "sed -n '1w sandbox-blocked.txt' input.txt" },
      context,
    )

    expect(result.ok).toBe(false)
    expect(result.metadata?.safetyPolicy).toMatchObject({
      sandboxDecision: 'sandboxed',
      readOnly: true,
    })
    expect(result.metadata?.sandboxRuntime).toMatchObject({
      requested: true,
      enforced: true,
      adapter: 'macos-sandbox-exec',
    })
    await expect(readFile(path.join(cwd, 'sandbox-blocked.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('Bash treats shell writes and unsafe wrappers as non-read-only', async () => {
    const cwd = await createFixture({})
    const context = createContext(cwd, { mode: 'read-only' })

    const redirect = await BashTool.invoke(
      { command: 'printf blocked > created.txt' },
      context,
    )
    const sedWrite = await BashTool.invoke(
      { command: "sed -i 's/a/b/' created.txt" },
      context,
    )
    const shellWrapper = await BashTool.invoke(
      { command: 'sh -c "echo blocked"' },
      context,
    )

    expect(redirect.ok).toBe(false)
    expect(redirect.content).toContain('read-only mode blocks')
    await expect(readFile(path.join(cwd, 'created.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(sedWrite.ok).toBe(false)
    expect(sedWrite.metadata?.safetyPolicy).toMatchObject({
      sandboxDecision: 'ask',
      surrogate: {
        kind: 'sed-edit',
      },
    })
    expect(shellWrapper.ok).toBe(false)
    expect(shellWrapper.metadata?.safetyPolicy).toMatchObject({
      sandboxDecision: 'ask',
      findings: expect.arrayContaining(['shell_wrapper:sh']),
    })
  })

  it('Bash converts a narrow sed -i command into an audited edit surrogate', async () => {
    const cwd = await createFixture({ 'src/app.txt': 'alpha\nalpha\n' })
    const context = createContext(cwd, { mode: 'bypass-local' })

    const result = await BashTool.invoke(
      { command: "sed -i 's/alpha/beta/g' src/app.txt" },
      context,
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Applied sed edit surrogate')
    expect(result.metadata).toMatchObject({
      safetyPolicy: {
        sandboxDecision: 'ask',
        surrogate: {
          kind: 'sed-edit',
          filePath: 'src/app.txt',
        },
      },
      surrogate: {
        kind: 'sed-edit',
      },
    })
    expect(result.metadata?.diff).toContain('-alpha')
    expect(result.metadata?.diff).toContain('+beta')
    expect(await readFile(path.join(cwd, 'src/app.txt'), 'utf8')).toBe('beta\nbeta\n')
  })

  it('Bash times out long commands and truncates large output', async () => {
    const cwd = await createFixture({})
    const timeoutContext = createContext(cwd, {
      mode: 'bypass-local',
      bashLimits: { timeoutMs: 50, maxOutputChars: 80 },
    })
    const outputContext = createContext(cwd, {
      mode: 'bypass-local',
      bashLimits: { timeoutMs: 2_000, maxOutputChars: 80 },
    })

    const timeout = await BashTool.invoke(
      { command: 'node -e "setTimeout(() => {}, 500)"' },
      timeoutContext,
    )
    const largeOutput = await BashTool.invoke(
      { command: 'node -e \'console.log("x".repeat(500))\'' },
      outputContext,
    )

    expect(timeout.ok).toBe(false)
    expect(timeout.metadata?.signal).toBe('SIGTERM')
    expect(largeOutput.ok).toBe(true)
    expect(largeOutput.metadata).toMatchObject({ truncated: true })
    expect(largeOutput.content.length).toBeLessThan(200)
  })

  it('Bash filters project ignored path lines from command output', async () => {
    const cwd = await createFixture({})
    const context = createContext(cwd, {
      mode: 'bypass-local',
      projectConfig: {
        ignore: ['**/*research*/**', '**/.research/**'],
        defaultCommands: {},
      },
    })

    const result = await BashTool.invoke(
      {
        command:
          'printf "packages/runtime/src/skills.ts\\ndocs/archived-research/skill.ts\\nnested/.research/hidden.ts\\n.vigilon/session.jsonl\\n"',
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('packages/runtime/src/skills.ts')
    expect(result.content).not.toContain('docs/archived-research/skill.ts')
    expect(result.content).not.toContain('nested/.research/hidden.ts')
    expect(result.content).not.toContain('.vigilon/session.jsonl')
    expect(result.metadata).toMatchObject({ filteredProjectIgnoredLines: 3 })
  })

  it('Bash supports background tasks', async () => {
    const cwd = await createFixture({})
    const context = createContext(cwd, { mode: 'bypass-local' })

    const result = await BashTool.invoke(
      { command: 'sleep 10', background: true },
      context,
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('Command started in background')
    expect(result.metadata?.taskId).toBeDefined()
    expect(context.taskManager.activeTasks.length).toBe(1)

    const taskId = result.metadata?.taskId as string
    await context.taskManager.killTask(taskId)
    expect(context.taskManager.activeTasks.length).toBe(0)
  })
})

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-runtime-exec-'))
  tempRoots.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  return root
}

async function canUseMacSandbox(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  try {
    await access('/usr/bin/sandbox-exec')
    return true
  } catch {
    return false
  }
}

function createContext(
  cwd: string,
  options: {
    mode?: 'read-only' | 'ask' | 'accept-edits' | 'bypass-local'
    transcript?: InMemoryTranscriptStore
    permissionGate?: PermissionGate
    bashLimits?: ToolUseContext['bashLimits']
    projectConfig?: ToolUseContext['projectConfig']
  } = {},
): ToolUseContext {
  const transcript = options.transcript ?? new InMemoryTranscriptStore()
  return {
    cwd,
    abortSignal: new AbortController().signal,
    transcript,
    permissionGate:
      options.permissionGate ??
      createLocalPermissionGate({
        mode: options.mode ?? 'read-only',
        transcript,
      }),
    readFileState: new Map(),
    bashLimits: options.bashLimits,
    projectConfig: options.projectConfig,
    taskManager: createTaskManager(),
  }
}
