import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { isBlockedDevicePath, isUncPath, resolveToolPath } from './path.js'

const MAX_NOTEBOOK_OUTPUT_CHARS = 10_000

type NotebookCell = {
  cell_type: 'code' | 'markdown' | 'raw'
  source: string | string[]
  outputs?: any[]
  execution_count?: number | null
  metadata?: Record<string, any>
  id?: string
}

type NotebookContent = {
  cells: NotebookCell[]
  metadata: Record<string, any>
  nbformat: number
  nbformat_minor: number
}

type NotebookCellMatch = {
  cell: NotebookCell
  index: number
  identity: string
}

export const NotebookTool: Tool = {
  name: 'Notebook',
  description: 'Specialized tool for reading and editing Jupyter Notebook (.ipynb) files.',
  readOnly: false,
  inputJsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'edit', 'insert', 'delete'],
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
        description: 'New source code for the cell (required for edit/insert).',
      },
      cellType: {
        type: 'string',
        enum: ['code', 'markdown', 'raw'],
        description: 'Cell type for inserted cells.',
      },
    },
    required: ['action', 'filePath'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const { action, filePath: rawPath, cellIndex, cellId, source, cellType } = input as any
    const filePath = resolveToolPath(context.cwd, rawPath)

    if (isUncPath(filePath)) return failed('UNC paths are not supported.')
    if (isBlockedDevicePath(filePath)) return failed('Blocked device path.')

	    const permission = await context.permissionGate.requestPermission({
	      action: action === 'read' ? 'read' : 'edit',
	      subject: filePath,
	      risk: action === 'read' ? 'low' : 'medium',
	      reason: `${action === 'read' ? 'Read' : 'Edit'} Jupyter Notebook`,
	      origin: withToolPermissionOrigin(context.permissionOrigin, 'Notebook'),
	    })
    if (!permission.allowed) return failed(permission.reason)

    try {
      const [content, fileStat] = await Promise.all([
        readFile(filePath, 'utf8'),
        stat(filePath),
      ])
      const notebook = JSON.parse(content) as NotebookContent

      if (action === 'read') {
        return handleRead(notebook, filePath, content, fileStat.mtimeMs, context, cellIndex, cellId)
      } else if (action === 'edit') {
        if (source === undefined) return failed('source is required for edit action.')
        return handleEdit(notebook, filePath, content, fileStat.mtimeMs, context, cellIndex, cellId, source)
      } else if (action === 'insert') {
        if (source === undefined) return failed('source is required for insert action.')
        return handleInsert(notebook, filePath, content, fileStat.mtimeMs, context, cellIndex, source, cellType)
      } else if (action === 'delete') {
        return handleDelete(notebook, filePath, content, fileStat.mtimeMs, context, cellIndex, cellId)
      }
      return failed(`Unknown action: ${action}`)
    } catch (error) {
      return failed(
        `Notebook operation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  },
}

function handleRead(
  notebook: NotebookContent,
  filePath: string,
  rawContent: string,
  mtimeMs: number,
  context: ToolUseContext,
  cellIndex?: number,
  cellId?: string,
): ToolResult {
  if (cellIndex !== undefined || cellId !== undefined) {
    const match = findCell(notebook, cellIndex, cellId)
    if (!match) return failed('Cell not found.')
    context.readFileState?.set(filePath, {
      content: rawContent,
      mtimeMs,
      fullRead: false,
    })
    const formatted = formatCell(match.cell, match.index)
    return ok(formatted.content, formatted.truncatedOutputs ? { truncatedOutputs: true } : undefined)
  }

  context.readFileState?.set(filePath, {
    content: rawContent,
    mtimeMs,
    offset: 1,
    fullRead: true,
  })
  const formattedCells = notebook.cells.map((cell, idx) => formatCell(cell, idx))
  const truncatedOutputs = formattedCells.some(cell => cell.truncatedOutputs)
  return ok(
    formattedCells.map(cell => cell.content).join('\n\n'),
    truncatedOutputs ? { truncatedOutputs: true } : undefined,
  )
}

async function handleEdit(
  notebook: NotebookContent,
  filePath: string,
  rawContent: string,
  mtimeMs: number,
  context: ToolUseContext,
  cellIndex: number | undefined,
  cellId: string | undefined,
  source: string,
): Promise<ToolResult> {
  const match = findCell(notebook, cellIndex, cellId)
  if (!match) return failed('Cell not found.')

  const stale = validateReadBeforeEdit(filePath, rawContent, mtimeMs, context)
  if (stale) return failed(stale)

  const oldSource = Array.isArray(match.cell.source)
    ? match.cell.source.join('')
    : match.cell.source
  match.cell.source = sourceToLines(source)
  if (match.cell.cell_type === 'code') {
    match.cell.outputs = []
    match.cell.execution_count = null
  }

  const updatedContent = JSON.stringify(notebook, null, 1)
  await atomicWriteFile(filePath, updatedContent)
  await updateNotebookReadState(context, filePath, updatedContent)

  return ok(`Cell updated successfully.`, {
    type: 'update',
    filePath,
    cellId: match.identity,
    diff: `--- old\n+++ new\n- ${oldSource.replace(/\n/g, '\n- ')}\n+ ${source.replace(/\n/g, '\n+ ')}`,
  })
}

async function handleInsert(
  notebook: NotebookContent,
  filePath: string,
  rawContent: string,
  mtimeMs: number,
  context: ToolUseContext,
  cellIndex: number | undefined,
  source: string,
  cellType: NotebookCell['cell_type'] = 'code',
): Promise<ToolResult> {
  const stale = validateReadBeforeEdit(filePath, rawContent, mtimeMs, context)
  if (stale) return failed(stale)
  if (cellType !== 'code' && cellType !== 'markdown' && cellType !== 'raw') {
    return failed('cellType must be code, markdown, or raw.')
  }
  const insertAt =
    cellIndex === undefined
      ? notebook.cells.length
      : Math.max(0, Math.min(cellIndex, notebook.cells.length))
  const id = `cell-${Date.now().toString(36)}`
  const cell: NotebookCell = {
    cell_type: cellType,
    source: sourceToLines(source),
    metadata: {},
    id,
  }
  if (cellType === 'code') {
    cell.outputs = []
    cell.execution_count = null
  }
  notebook.cells.splice(insertAt, 0, cell)
  const updatedContent = JSON.stringify(notebook, null, 1)
  await atomicWriteFile(filePath, updatedContent)
  await updateNotebookReadState(context, filePath, updatedContent)
  return ok('Cell inserted successfully.', {
    type: 'update',
    filePath,
    cellId: id,
    cellIndex: insertAt,
    diff: `+++ inserted ${cellType} cell ${id}\n+ ${source.replace(/\n/g, '\n+ ')}`,
  })
}

async function handleDelete(
  notebook: NotebookContent,
  filePath: string,
  rawContent: string,
  mtimeMs: number,
  context: ToolUseContext,
  cellIndex: number | undefined,
  cellId: string | undefined,
): Promise<ToolResult> {
  const match = findCell(notebook, cellIndex, cellId)
  if (!match) return failed('Cell not found.')
  const stale = validateReadBeforeEdit(filePath, rawContent, mtimeMs, context)
  if (stale) return failed(stale)
  const oldSource = Array.isArray(match.cell.source)
    ? match.cell.source.join('')
    : match.cell.source
  notebook.cells.splice(match.index, 1)
  const updatedContent = JSON.stringify(notebook, null, 1)
  await atomicWriteFile(filePath, updatedContent)
  await updateNotebookReadState(context, filePath, updatedContent)
  return ok('Cell deleted successfully.', {
    type: 'update',
    filePath,
    cellId: match.identity,
    cellIndex: match.index,
    diff: `--- deleted cell ${match.identity}\n- ${oldSource.replace(/\n/g, '\n- ')}`,
  })
}

function findCell(
  notebook: NotebookContent,
  index?: number,
  id?: string,
): NotebookCellMatch | undefined {
  if (id !== undefined) {
    const syntheticIndex = parseSyntheticCellIndex(id)
    if (syntheticIndex !== undefined) {
      return findCell(notebook, syntheticIndex, undefined)
    }
    for (const [cellIndex, cell] of notebook.cells.entries()) {
      const identity = getCellIdentity(cell, cellIndex)
      if (cell.id === id || identity === id) {
        return { cell, index: cellIndex, identity }
      }
    }
    return undefined
  }
  if (index !== undefined && index >= 0 && index < notebook.cells.length) {
    const cell = notebook.cells[index]
    return { cell, index, identity: getCellIdentity(cell, index) }
  }
  return undefined
}

function parseSyntheticCellIndex(id: string): number | undefined {
  const match = id.match(/^cell-(\d+)$/)
  if (!match) return undefined
  const index = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(index) ? index : undefined
}

function sourceToLines(source: string): string[] {
  return source
    .split('\n')
    .map((line, idx, arr) => (idx === arr.length - 1 ? line : `${line}\n`))
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, filePath)
}

async function updateNotebookReadState(
  context: ToolUseContext,
  filePath: string,
  content: string,
): Promise<void> {
  const updatedStat = await stat(filePath)
  context.readFileState?.set(filePath, {
    content,
    mtimeMs: updatedStat.mtimeMs,
    offset: 1,
    fullRead: true,
  })
}

function formatCell(
  cell: NotebookCell,
  index: number,
): { content: string; truncatedOutputs: boolean } {
  const idAttr = ` id="${getCellIdentity(cell, index)}"`
  const typeAttr = ` type="${cell.cell_type}"`
  const countAttr =
    cell.execution_count !== undefined && cell.execution_count !== null
      ? ` execution_count="${cell.execution_count}"`
      : ''
  const source = Array.isArray(cell.source) ? cell.source.join('') : cell.source

  let output = ''
  let truncatedOutputs = false
  if (cell.outputs && cell.outputs.length > 0) {
    const formattedOutputs = cell.outputs.map(outputValue => formatOutput(outputValue))
    const totalOutputChars = formattedOutputs.join('\n').length
    if (totalOutputChars > MAX_NOTEBOOK_OUTPUT_CHARS) {
      truncatedOutputs = true
      output =
        '\n<outputs>\n[output omitted: notebook output exceeds runtime budget]\n</outputs>'
    } else {
      output = `\n<outputs>\n${formattedOutputs.join('\n')}\n</outputs>`
    }
  }

  return {
    content: `<cell index="${index}"${idAttr}${typeAttr}${countAttr}>\n${source}${output}\n</cell>`,
    truncatedOutputs,
  }
}

function formatOutput(output: any): string {
  if (output.output_type === 'stream') {
    return `[stream: ${output.name}] ${Array.isArray(output.text) ? output.text.join('') : output.text}`
  }
  if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const text = output.data?.['text/plain']
    return `[${output.output_type}] ${Array.isArray(text) ? text.join('') : text}`
  }
  if (output.output_type === 'error') return `[error] ${output.ename}: ${output.evalue}`
  return `[${output.output_type}]`
}

function ok(content: string, metadata?: Record<string, unknown>): ToolResult {
  return { toolCallId: '', ok: true, content, metadata }
}

function failed(content: string): ToolResult {
  return { toolCallId: '', ok: false, content }
}

function getCellIdentity(cell: NotebookCell, index: number): string {
  return cell.id ?? `cell-${index}`
}

function validateReadBeforeEdit(
  filePath: string,
  rawContent: string,
  mtimeMs: number,
  context: ToolUseContext,
): string | null {
  const lastRead = context.readFileState?.get(filePath)
  if (!lastRead?.fullRead) {
    return 'Notebook has not been fully read yet. Read it before editing it.'
  }
  if (lastRead.mtimeMs !== mtimeMs && lastRead.content !== rawContent) {
    return 'Cannot edit stale notebook content. Re-read the notebook before editing.'
  }
  return null
}
