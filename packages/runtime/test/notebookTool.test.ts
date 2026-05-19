import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'path'
import { createCoreToolRegistry } from '../src/tools/coreTools'
import type { ToolUseContext } from '../src/runtime/contracts'
import { NotebookTool } from '../src/tools/notebookTool'

const testDir = path.resolve('./test-fixtures-notebook')
const notebookPath = path.join(testDir, 'test.ipynb')

describe('NotebookTool', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true })
    const notebookContent = {
      cells: [
        {
          cell_type: 'code',
          source: ['print("hello")'],
          outputs: [],
          execution_count: 1,
          metadata: {},
          id: 'code-1',
        },
        {
          cell_type: 'markdown',
          source: ['# Hello'],
          metadata: {},
        },
      ],
      metadata: { kernelspec: { name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5,
    }
    await writeFile(notebookPath, JSON.stringify(notebookContent))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  test('should expose Notebook in the default core registry', () => {
    expect(createCoreToolRegistry().list().map(tool => tool.name)).toContain(
      'Notebook',
    )
  })

  test('should read the whole notebook', async () => {
    const context = createContext()

    const result = await NotebookTool.invoke(
      { action: 'read', filePath: 'test.ipynb' },
      context,
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('cell index="0" id="code-1" type="code" execution_count="1"')
    expect(result.content).toContain('print("hello")')
    expect(result.content).toContain('cell index="1" id="cell-1" type="markdown"')
    expect(result.content).toContain('# Hello')
  })

  test('should read a specific cell by index', async () => {
    const context = createContext()

    const result = await NotebookTool.invoke(
      { action: 'read', filePath: 'test.ipynb', cellIndex: 1 },
      context,
    )
    expect(result.ok).toBe(true)
    expect(result.content).toContain('cell index="1" id="cell-1" type="markdown"')
    expect(result.content).not.toContain('print("hello")')
  })

  test('should truncate large notebook outputs and mark metadata', async () => {
    const context = createContext()
    const notebookContent = {
      cells: [
        {
          cell_type: 'code',
          source: ['print("big")'],
          outputs: [
            {
              output_type: 'stream',
              name: 'stdout',
              text: 'x'.repeat(11_000),
            },
          ],
          execution_count: 1,
          metadata: {},
          id: 'big-output',
        },
      ],
      metadata: { kernelspec: { name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5,
    }
    await writeFile(notebookPath, JSON.stringify(notebookContent))

    const result = await NotebookTool.invoke(
      { action: 'read', filePath: 'test.ipynb' },
      context,
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain(
      '[output omitted: notebook output exceeds runtime budget]',
    )
    expect(result.metadata).toMatchObject({ truncatedOutputs: true })
  })

  test('should edit a cell by synthetic cell id', async () => {
    const context = createContext()
    const newSource = '## Updated'
    const readResult = await NotebookTool.invoke(
      { action: 'read', filePath: 'test.ipynb' },
      context,
    )
    expect(readResult.ok).toBe(true)
    const result = await NotebookTool.invoke(
      {
        action: 'edit',
        filePath: 'test.ipynb',
        cellId: 'cell-1',
        source: newSource,
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(result.metadata?.type).toBe('update')

    const updatedNotebook = JSON.parse(await readFile(notebookPath, 'utf8')) as {
      cells: Array<{ source: string[] }>
    }
    expect(updatedNotebook.cells[1]?.source.join('')).toContain('## Updated')
  })

  test('should insert and delete notebook cells with atomic write metadata', async () => {
    const context = createContext()
    const readResult = await NotebookTool.invoke(
      { action: 'read', filePath: 'test.ipynb' },
      context,
    )
    expect(readResult.ok).toBe(true)

    const insertResult = await NotebookTool.invoke(
      {
        action: 'insert',
        filePath: 'test.ipynb',
        cellIndex: 1,
        cellType: 'markdown',
        source: 'Inserted note',
      },
      context,
    )
    expect(insertResult.ok).toBe(true)
    expect(insertResult.metadata).toMatchObject({
      type: 'update',
      cellIndex: 1,
    })

    const insertedId = insertResult.metadata?.cellId
    const deleteResult = await NotebookTool.invoke(
      {
        action: 'delete',
        filePath: 'test.ipynb',
        cellId: insertedId,
      },
      context,
    )
    expect(deleteResult.ok).toBe(true)
    expect(deleteResult.metadata).toMatchObject({
      type: 'update',
      cellIndex: 1,
    })

    const updatedNotebook = JSON.parse(await readFile(notebookPath, 'utf8')) as {
      cells: Array<{ source: string[] }>
    }
    expect(updatedNotebook.cells.map(cell => cell.source.join(''))).not.toContain('Inserted note')
  })

  test('should reject stale notebook edits after the file changes', async () => {
    const context = createContext()

    const readResult = await NotebookTool.invoke(
      { action: 'read', filePath: 'test.ipynb' },
      context,
    )
    expect(readResult.ok).toBe(true)

    const modifiedNotebook = {
      cells: [
        {
          cell_type: 'code',
          source: ['print("changed outside tool")'],
          outputs: [],
          execution_count: 2,
          metadata: {},
          id: 'code-1',
        },
      ],
      metadata: { kernelspec: { name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5,
    }
    await writeFile(notebookPath, JSON.stringify(modifiedNotebook))

    const editResult = await NotebookTool.invoke(
      {
        action: 'edit',
        filePath: 'test.ipynb',
        cellIndex: 0,
        source: 'print("world")',
      },
      context,
    )

    expect(editResult.ok).toBe(false)
    expect(editResult.content).toContain('stale notebook')
  })
})

function createContext(): ToolUseContext {
  return {
    cwd: testDir,
    abortSignal: new AbortController().signal,
    permissionGate: {
      requestPermission: vi.fn(async () => ({ allowed: true, reason: 'ok' })),
    },
    transcript: {
      append: vi.fn(async () => undefined),
      replace: vi.fn(async () => undefined),
      readAll: vi.fn(async () => []),
    },
    readFileState: new Map(),
    lspServerManager: {
      openTextDocument: vi.fn(),
      getDiagnostics: vi.fn(),
      shutdown: vi.fn(),
    } as unknown as ToolUseContext['lspServerManager'],
    taskManager: {
      activeTasks: [],
      startBashTask: vi.fn(),
      stopTask: vi.fn(),
      killTask: vi.fn(),
      shutdown: vi.fn(),
    },
    tools: {
      list: () => [],
      find: () => undefined,
    },
  }
}
