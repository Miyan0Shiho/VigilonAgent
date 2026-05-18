import { readFile, writeFile, stat } from 'node:fs/promises';
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js';
import { isBlockedDevicePath, isUncPath, resolveToolPath } from './path.js';

type NotebookCell = {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  outputs?: any[];
  execution_count?: number | null;
  metadata?: Record<string, any>;
  id?: string;
};

type NotebookContent = {
  cells: NotebookCell[];
  metadata: Record<string, any>;
  nbformat: number;
  nbformat_minor: number;
};

export const NotebookTool: Tool = {
  name: 'Notebook',
  description: 'Specialized tool for reading and editing Jupyter Notebook (.ipynb) files.',
  readOnly: false,
  inputJsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'edit'],
      },
      filePath: {
        type: 'string',
        description: 'Absolute or cwd-relative path to the .ipynb file.',
      },
      cellIndex: {
        type: 'number',
        description: '0-based index of the cell to read or edit.',
      },
      cellId: {
        type: 'string',
        description: 'ID of the cell to read or edit (if supported by the notebook).',
      },
      source: {
        type: 'string',
        description: 'New source code for the cell (required for edit).',
      },
    },
    required: ['action', 'filePath'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { action, filePath: rawPath, cellIndex, cellId, source } = input as any;
    const filePath = resolveToolPath(context.cwd, rawPath);

    if (isUncPath(filePath)) return failed('UNC paths are not supported.');
    if (isBlockedDevicePath(filePath)) return failed('Blocked device path.');

    const permission = await context.permissionGate.requestPermission({
      action: action === 'read' ? 'read' : 'edit',
      subject: filePath,
      risk: action === 'read' ? 'low' : 'medium',
      reason: `${action === 'read' ? 'Read' : 'Edit'} Jupyter Notebook`,
    });
    if (!permission.allowed) return failed(permission.reason);

    try {
      const content = await readFile(filePath, 'utf8');
      const notebook = JSON.parse(content) as NotebookContent;

      if (action === 'read') {
        return handleRead(notebook, cellIndex, cellId);
      } else if (action === 'edit') {
        if (source === undefined) return failed('source is required for edit action.');
        return handleEdit(notebook, filePath, cellIndex, cellId, source);
      }
      return failed(`Unknown action: ${action}`);
    } catch (error) {
      return failed(`Notebook operation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

function handleRead(notebook: NotebookContent, cellIndex?: number, cellId?: string): ToolResult {
  if (cellIndex !== undefined || cellId !== undefined) {
    const cell = findCell(notebook, cellIndex, cellId);
    if (!cell) return failed('Cell not found.');
    return ok(formatCell(cell, notebook.cells.indexOf(cell)));
  }

  const formatted = notebook.cells.map((cell, idx) => formatCell(cell, idx)).join('\n\n');
  return ok(formatted);
}

async function handleEdit(
  notebook: NotebookContent,
  filePath: string,
  cellIndex: number | undefined,
  cellId: string | undefined,
  source: string
): Promise<ToolResult> {
  const cell = findCell(notebook, cellIndex, cellId);
  if (!cell) return failed('Cell not found.');

  const oldSource = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
  cell.source = source.split('\n').map((line, idx, arr) => (idx === arr.length - 1 ? line : line + '\n'));

  await writeFile(filePath, JSON.stringify(notebook, null, 1), 'utf8');

  return ok(`Cell updated successfully.`, {
    type: 'update',
    filePath,
    diff: `--- old\n+++ new\n- ${oldSource.replace(/\n/g, '\n- ')}\n+ ${source.replace(/\n/g, '\n+ ')}`,
  });
}

function findCell(notebook: NotebookContent, index?: number, id?: string): NotebookCell | undefined {
  if (id !== undefined) return notebook.cells.find((c) => c.id === id);
  if (index !== undefined && index >= 0 && index < notebook.cells.length) return notebook.cells[index];
  return undefined;
}

function formatCell(cell: NotebookCell, index: number): string {
  const idAttr = cell.id ? ` id="${cell.id}"` : '';
  const typeAttr = ` type="${cell.cell_type}"`;
  const countAttr = cell.execution_count ? ` execution_count="${cell.execution_count}"` : '';
  const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source;

  let output = '';
  if (cell.outputs && cell.outputs.length > 0) {
    output = '\n<outputs>\n' + cell.outputs.map(o => formatOutput(o)).join('\n') + '\n</outputs>';
  }

  return `<cell index="${index}"${idAttr}${typeAttr}${countAttr}>\n${source}${output}\n</cell>`;
}

function formatOutput(output: any): string {
  if (output.output_type === 'stream') return `[stream: ${output.name}] ${Array.isArray(output.text) ? output.text.join('') : output.text}`;
  if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const text = output.data?.['text/plain'];
    return `[${output.output_type}] ${Array.isArray(text) ? text.join('') : text}`;
  }
  if (output.output_type === 'error') return `[error] ${output.ename}: ${output.evalue}`;
  return `[${output.output_type}]`;
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata };
}

function failed(content: string): ToolResult {
  return { toolCallId: '', ok: false, content };
}
