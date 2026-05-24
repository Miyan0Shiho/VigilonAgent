import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { resolveToolPath, toRelativeToolPath } from './path.js'

export const ListDirTool: Tool = {
  name: 'ListDir',
  description:
    'Lists files and directories in a given directory. Respects project ignore patterns. Use for quick workspace orientation instead of "ls" in Bash.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or cwd-relative path to the directory to list.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  readOnly: true,
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const rawPath = (input as Record<string, unknown>)?.path
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return { toolCallId: '', ok: false, content: 'ListDir requires a non-empty path' }
    }
    const filePath = resolveToolPath(context.cwd, rawPath.trim())
    const relativePath = toRelativeToolPath(context.cwd, filePath)
    const permission = await context.permissionGate.requestPermission({
      action: 'read',
      subject: relativePath,
      risk: 'low',
      reason: `List directory: ${relativePath}`,
      origin: withToolPermissionOrigin(context.permissionOrigin, 'ListDir'),
    })
    if (!permission.allowed) {
      return { toolCallId: '', ok: false, content: permission.reason }
    }

    let entries
    try {
      entries = await readdir(filePath, { withFileTypes: true })
    } catch (error) {
      return { toolCallId: '', ok: false, content: `Cannot list directory: ${(error as Error).message}` }
    }

    const lines: string[] = []
    const dirs: string[] = []
    const files: string[] = []
    for (const entry of entries) {
      if (entry.isDirectory()) dirs.push(`${entry.name}/`)
      else if (entry.isFile()) {
        try {
          const s = await stat(path.join(filePath, entry.name))
          files.push(`${entry.name} (${formatSize(s.size)})`)
        } catch {
          files.push(entry.name)
        }
      }
    }
    for (const d of dirs.sort()) lines.push(d)
    for (const f of files.sort()) lines.push(f)

    return {
      toolCallId: '',
      ok: true,
      content: lines.join('\n') || '(empty directory)',
      metadata: { filePath: relativePath, dirCount: dirs.length, fileCount: files.length },
    }
  },
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
