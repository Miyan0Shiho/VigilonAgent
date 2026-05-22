import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BashTool,
  createLocalPermissionGate,
  GlobTool,
  GrepTool,
  InMemoryTranscriptStore,
  ReadTool,
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

describe('core file tools', () => {
  it('Read returns line-numbered text and deduplicates unchanged reads', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'alpha\nbeta\ngamma\n',
    })
    const context = createContext(cwd)

    const first = await ReadTool.invoke(
      { file_path: 'src/app.ts', offset: 2, limit: 1 },
      context,
    )
    const second = await ReadTool.invoke(
      { file_path: 'src/app.ts', offset: 2, limit: 1 },
      context,
    )

    expect(first.ok).toBe(true)
    expect(first.content).toContain('     2\tbeta')
    expect(first.content).toContain('Showing lines 2-2 of 4')
    expect(second.ok).toBe(true)
    expect(second.content).toContain('earlier Read tool_result')
    expect(second.content).toContain('instead of re-reading')
    expect(second.metadata).toMatchObject({ type: 'file_unchanged' })
  })

  it('Read rejects binary-looking files', async () => {
    const cwd = await createFixture({
      'bin/blob.dat': Buffer.from([0x61, 0x00, 0x62]),
    })

    const result = await ReadTool.invoke(
      { file_path: 'bin/blob.dat' },
      createContext(cwd),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('binary files')
  })

  it('Glob returns relative paths with host-enforced truncation', async () => {
    const cwd = await createFixture({
      'a.ts': 'a',
      'src/b.ts': 'b',
      'src/c.js': 'c',
    })

    const result = await GlobTool.invoke(
      { pattern: '**/*.ts' },
      createContext(cwd, { globLimits: { maxResults: 1 } }),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ numFiles: 1, truncated: true })
    expect(result.content).toContain(
      'Results are truncated. Consider using a more specific path or pattern.',
    )
  })

  it('Glob respects project ignore patterns', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'a',
      'dist/app.ts': 'generated',
    })

    const result = await GlobTool.invoke(
      { pattern: '**/*.ts' },
      createContext(cwd, {
        projectConfig: {
          ignore: ['dist/**'],
          defaultCommands: {},
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('src/app.ts')
    expect(result.content).not.toContain('dist/app.ts')
  })

  it('Glob excludes generated and runtime artifact directories by default', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'source\n',
      '.vigilon/session.jsonl': 'needle\n',
      '.trae/documents/plan.md': 'needle\n',
      'packages/runtime/dist/app.js': 'generated\n',
    })

    const result = await GlobTool.invoke({ pattern: '**/*' }, createContext(cwd))

    expect(result.ok).toBe(true)
    expect(result.content).toContain('src/app.ts')
    expect(result.content).not.toContain('.vigilon/session.jsonl')
    expect(result.content).not.toContain('.trae/documents/plan.md')
    expect(result.content).not.toContain('packages/runtime/dist/app.js')
  })

  it('Glob summarizes broad truncated root searches instead of dumping path lists', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 8; index += 1) {
      files[`packages/runtime/src/file${index}.ts`] = 'source\n'
      files[`packages/tui/src/file${index}.ts`] = 'source\n'
      files[`docs/product/file${index}.md`] = 'doc\n'
    }
    const cwd = await createFixture(files)

    const result = await GlobTool.invoke(
      { pattern: '**/*' },
      createContext(cwd, { globLimits: { maxResults: 10 } }),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ broadQuery: true, truncated: true })
    expect(result.content).toContain('Broad Glob query was truncated')
    expect(result.content).toContain('Directory groups')
    expect(result.content).toContain('Rerun Glob with a narrower path or pattern')
  })

  it('Glob summarizes broad truncated subtree patterns', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 8; index += 1) {
      files[`packages/runtime/src/file${index}.ts`] = 'source\n'
      files[`packages/tui/src/file${index}.ts`] = 'source\n'
      files[`docs/product/file${index}.md`] = 'doc\n'
    }
    const cwd = await createFixture(files)

    const result = await GlobTool.invoke(
      { pattern: 'packages/**' },
      createContext(cwd, { globLimits: { maxResults: 10 } }),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ broadQuery: true, truncated: true })
    expect(result.content).toContain('Broad Glob query was truncated')
    expect(result.content).toContain('- packages/runtime:')
    expect(result.content).toContain('- packages/tui:')
    expect(result.content).not.toContain('file0.ts')
  })

  it('Grep supports files_with_matches, content, and count modes', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'needle one\nother\nneedle two\n',
      'src/other.ts': 'none\n',
    })
    const context = createContext(cwd)

    const files = await GrepTool.invoke(
      { pattern: 'needle', glob: '*.ts' },
      context,
    )
    const content = await GrepTool.invoke(
      {
        pattern: 'needle',
        path: 'src',
        glob: '*.ts',
        output_mode: 'content',
        head_limit: 1,
      },
      context,
    )
    const count = await GrepTool.invoke(
      { pattern: 'needle', path: 'src', glob: '*.ts', output_mode: 'count' },
      context,
    )

    expect(files.content).toContain('Found 1 file')
    expect(files.content).toContain('src/app.ts')
    expect(content.content).toContain('src/app.ts:1:needle one')
    expect(content.content).toContain('pagination = limit: 1')
    expect(count.content).toContain('src/app.ts:2')
    expect(count.content).toContain('Found 2 total occurrences across 1 file')
  })

  it('Grep does not duplicate relative target prefixes', async () => {
    const cwd = await createFixture({
      'packages/tui/src/runTui.ts': 'resume flow\n',
      'packages/tui/src/index.ts': 'no match\n',
    })
    const context = createContext(cwd)

    const files = await GrepTool.invoke(
      { pattern: 'resume', path: 'packages/tui/src' },
      context,
    )
    const content = await GrepTool.invoke(
      { pattern: 'resume', path: 'packages/tui/src', output_mode: 'content' },
      context,
    )

    expect(files.content).toContain('packages/tui/src/runTui.ts')
    expect(files.content).not.toContain('packages/tui/packages/tui')
    expect(content.content).toContain('packages/tui/src/runTui.ts:1:resume flow')
    expect(content.content).not.toContain('packages/tui/packages/tui')
  })

  it('Grep respects project ignore patterns', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'needle source\n',
      'dist/app.ts': 'needle generated\n',
    })

    const result = await GrepTool.invoke(
      { pattern: 'needle', output_mode: 'content' },
      createContext(cwd, {
        projectConfig: {
          ignore: ['dist/**'],
          defaultCommands: {},
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('src/app.ts')
    expect(result.content).not.toContain('dist/app.ts')
  })

  it('Grep excludes generated and runtime artifact directories by default', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'needle source\n',
      '.vigilon/session.jsonl': 'needle transcript\n',
      '.trae/documents/plan.md': 'needle plan\n',
      'packages/runtime/dist/app.js': 'needle generated\n',
    })

    const result = await GrepTool.invoke(
      { pattern: 'needle', output_mode: 'content' },
      createContext(cwd),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('src/app.ts')
    expect(result.content).not.toContain('.vigilon/session.jsonl')
    expect(result.content).not.toContain('.trae/documents/plan.md')
    expect(result.content).not.toContain('packages/runtime/dist/app.js')
  })

  it('Grep respects recursive project ignore patterns from any root', async () => {
    const cwd = await createFixture({
      'packages/runtime/src/skill.ts': 'needle source\n',
      'docs/research/skill.ts': 'needle research\n',
      'nested/.research/skill.ts': 'needle hidden research\n',
    })

    const result = await GrepTool.invoke(
      { pattern: 'needle', output_mode: 'content' },
      createContext(cwd, {
        projectConfig: {
          ignore: ['**/research/**', '**/.research/**'],
          defaultCommands: {},
        },
      }),
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('packages/runtime/src/skill.ts')
    expect(result.content).not.toContain('docs/research/skill.ts')
    expect(result.content).not.toContain('nested/.research/skill.ts')
  })

  it('Grep summarizes broad root searches instead of dumping large file lists', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 45; index += 1) {
      files[`packages/runtime/src/skill${index}.ts`] = 'skill source\n'
      files[`packages/tui/src/skill${index}.ts`] = 'skill source\n'
    }
    const cwd = await createFixture(files)

    const result = await GrepTool.invoke(
      { pattern: 'skill', output_mode: 'files_with_matches' },
      createContext(cwd),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ broadQuery: true, numFiles: 90 })
    expect(result.content).toContain('Broad Grep query for "skill" matched 90 files')
    expect(result.content).toContain('- packages/runtime:')
    expect(result.content).toContain('- packages/tui:')
    expect(result.content).toContain('Rerun Grep with a narrower')
    expect(result.content).not.toContain('skill0.ts')
  })

  it('Grep returns normal file lists for narrowed searches', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 45; index += 1) {
      files[`packages/runtime/src/skill${index}.ts`] = 'skill source\n'
      files[`packages/tui/src/skill${index}.ts`] = 'skill source\n'
    }
    const cwd = await createFixture(files)

    const result = await GrepTool.invoke(
      {
        pattern: 'skill',
        path: 'packages/runtime',
        output_mode: 'files_with_matches',
      },
      createContext(cwd),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).not.toMatchObject({ broadQuery: true })
    expect(result.content).toContain('packages/runtime/src/skill0.ts')
  })

  it('Grep summarizes broad multi-package subtree searches', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 45; index += 1) {
      files[`packages/runtime/src/skill${index}.ts`] = 'skill source\n'
      files[`packages/tui/src/skill${index}.ts`] = 'skill source\n'
      files[`packages/bench/src/other${index}.ts`] = 'not relevant\n'
    }
    const cwd = await createFixture(files)

    const result = await GrepTool.invoke(
      {
        pattern: 'skill',
        path: 'packages',
        glob: '*.ts',
        output_mode: 'files_with_matches',
      },
      createContext(cwd),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ broadQuery: true, numFiles: 90 })
    expect(result.content).toContain('Broad Grep query for "skill" matched 90 files')
    expect(result.content).toContain('- packages/runtime:')
    expect(result.content).toContain('- packages/tui:')
    expect(result.content).not.toContain('skill0.ts')
  })

  it('Bash warns on broad find scans that return path output', async () => {
    const cwd = await createFixture({
      'packages/runtime/src/SKILL.md': 'runtime\n',
    })

    const result = await BashTool.invoke(
      { command: "find . -name 'SKILL.md'" },
      createContext(cwd),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ broadShellScan: true })
    expect(result.content).toContain('Broad Bash filesystem scan detected')
    expect(result.content).toContain('packages/runtime/src/SKILL.md')
  })

  it('Bash summarizes large broad find path lists', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 35; index += 1) {
      files[`packages/runtime/src/file${index}.ts`] = 'source\n'
      files[`packages/tui/src/file${index}.ts`] = 'source\n'
    }
    const cwd = await createFixture(files)

    const result = await BashTool.invoke(
      { command: 'find . -type f' },
      createContext(cwd),
    )

    expect(result.ok).toBe(true)
    expect(result.metadata).toMatchObject({ broadShellScan: true })
    expect(result.content).toContain('Path-like output was summarized after 70 lines')
    expect(result.content).toContain('- packages/runtime:')
    expect(result.content).toContain('- packages/tui:')
    expect(result.content).not.toContain('file0.ts')
  })

  it('Read rejects project ignored paths', async () => {
    const cwd = await createFixture({
      'src/app.ts': 'source\n',
      'docs/research/skill.ts': 'hidden\n',
    })

    const result = await ReadTool.invoke(
      { file_path: 'docs/research/skill.ts' },
      createContext(cwd, {
        projectConfig: {
          ignore: ['**/research/**'],
          defaultCommands: {},
        },
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('ignored by project config')
  })

  it('Read rejects generated and runtime artifact paths by default', async () => {
    const cwd = await createFixture({
      '.vigilon/session.jsonl': 'hidden\n',
      'src/app.ts': 'source\n',
    })

    const result = await ReadTool.invoke(
      { file_path: '.vigilon/session.jsonl' },
      createContext(cwd),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('ignored by project config')
  })

  it('records read permissions through the shared permission gate', async () => {
    const cwd = await createFixture({ 'README.md': 'hello' })
    const transcript = new InMemoryTranscriptStore()
    const context = createContext(cwd, { transcript })

    await ReadTool.invoke({ file_path: 'README.md' }, context)

    expect((await transcript.readAll()).map(event => event.type)).toContain(
      'permission',
    )
  })
})

async function createFixture(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-runtime-'))
  tempRoots.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  return root
}

function createContext(
  cwd: string,
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  const transcript = overrides.transcript ?? new InMemoryTranscriptStore()
  return {
    cwd,
    abortSignal: new AbortController().signal,
    transcript,
    permissionGate:
      overrides.permissionGate ??
      createLocalPermissionGate({ mode: 'read-only', transcript }),
    readFileState: overrides.readFileState ?? new Map(),
    fileReadingLimits: overrides.fileReadingLimits,
    globLimits: overrides.globLimits,
    projectConfig: overrides.projectConfig,
  }
}
