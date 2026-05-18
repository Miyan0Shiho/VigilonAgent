import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { NotebookTool } from '../src/tools/notebookTool';
import type { ToolUseContext } from '../src/runtime/contracts';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import * as path from 'path';

describe('NotebookTool', () => {
  const testDir = path.resolve('./test-fixtures-notebook');
  const notebookPath = path.join(testDir, 'test.ipynb');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    const notebookContent = {
      cells: [
        {
          cell_type: 'code',
          source: ['print("hello")'],
          outputs: [],
          execution_count: 1,
          metadata: {},
          id: 'cell-1'
        },
        {
          cell_type: 'markdown',
          source: ['# Hello'],
          metadata: {}
        }
      ],
      metadata: { kernelspec: { name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5
    };
    await writeFile(notebookPath, JSON.stringify(notebookContent));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test('should read the whole notebook', async () => {
    const context = {
      cwd: testDir,
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true }))
      }
    } as unknown as ToolUseContext;

    const result = await NotebookTool.invoke({ action: 'read', filePath: 'test.ipynb' }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('cell index="0" id="cell-1" type="code" execution_count="1"');
    expect(result.content).toContain('print("hello")');
    expect(result.content).toContain('cell index="1" type="markdown"');
    expect(result.content).toContain('# Hello');
  });

  test('should read a specific cell by index', async () => {
    const context = {
      cwd: testDir,
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true }))
      }
    } as unknown as ToolUseContext;

    const result = await NotebookTool.invoke({ action: 'read', filePath: 'test.ipynb', cellIndex: 1 }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('cell index="1" type="markdown"');
    expect(result.content).not.toContain('print("hello")');
  });

  test('should edit a cell', async () => {
    const context = {
      cwd: testDir,
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true }))
      }
    } as unknown as ToolUseContext;

    const newSource = 'print("world")';
    const result = await NotebookTool.invoke({ 
      action: 'edit', 
      filePath: 'test.ipynb', 
      cellIndex: 0, 
      source: newSource 
    }, context);

    expect(result.ok).toBe(true);
    expect(result.metadata?.type).toBe('update');

    // Verify file content
    const readResult = await NotebookTool.invoke({ action: 'read', filePath: 'test.ipynb', cellIndex: 0 }, context);
    expect(readResult.content).toContain('print("world")');
  });
});
