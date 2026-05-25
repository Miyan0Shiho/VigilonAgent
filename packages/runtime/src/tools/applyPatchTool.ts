import { execFile } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { resolveToolPath, toRelativeToolPath } from './path.js'

const execFileAsync = promisify(execFile)

export const ApplyPatchTool: Tool = {
  name: 'ApplyPatch',
  description:
    'Applies a unified diff patch to the workspace. Accepts standard patch format. For multi-file or multi-hunk edits, prefer this over multiple Edit calls — patches are atomic and easier to audit.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: 'Unified diff patch content to apply.',
      },
      check: {
        type: 'boolean',
        description: 'If true, only check if the patch applies cleanly without making changes (default false).',
      },
    },
    required: ['patch'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = input as Record<string, unknown>
    const patchContent = typeof parsed.patch === 'string' ? parsed.patch.trim() : ''
    if (!patchContent) {
      return { toolCallId: '', ok: false, content: 'ApplyPatch requires non-empty patch content' }
    }
    const dryRun = parsed.check === true

    // Extract file paths from the patch for permission check
    const fileRefs = extractPatchFileRefs(patchContent)
    if (fileRefs.length === 0) {
      return { toolCallId: '', ok: false, content: 'Could not parse file paths from patch.' }
    }

    const action = dryRun ? 'read' : 'edit'
    const risk = dryRun ? 'low' : 'medium'
    const permission = await context.permissionGate.requestPermission({
      action,
      subject: fileRefs.map(f => toRelativeToolPath(context.cwd, resolveToolPath(context.cwd, f))).join(', '),
      risk,
      reason: `${dryRun ? 'Check' : 'Apply'} patch affecting ${fileRefs.length} file(s)`,
      origin: withToolPermissionOrigin(context.permissionOrigin, 'ApplyPatch'),
    })
    if (!permission.allowed) {
      return { toolCallId: '', ok: false, content: permission.reason }
    }

    // Write patch to temp file, apply with git apply
    const tempDir = path.join(tmpdir(), 'vigilon-patch')
    await mkdir(tempDir, { recursive: true })
    const patchPath = path.join(tempDir, `${randomUUID()}.patch`)
    await writeFile(patchPath, patchContent + '\n', 'utf8')

    try {
      const args = ['apply', '--whitespace=nowarn']
      if (dryRun) args.push('--check')
      args.push(patchPath)
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd: context.cwd,
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      })
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      return {
        toolCallId: '',
        ok: true,
        content: dryRun ? `Patch applies cleanly to ${fileRefs.length} file(s).` : `Patch applied to ${fileRefs.length} file(s).${output ? `\n${output}` : ''}`,
        metadata: { dryRun, fileCount: fileRefs.length, files: fileRefs },
      }
    } catch (error) {
      const message = (error as Error).message
      return {
        toolCallId: '',
        ok: false,
        content: dryRun
          ? `Patch does not apply cleanly: ${message}`
          : `Failed to apply patch: ${message}`,
        metadata: { dryRun, fileCount: fileRefs.length },
      }
    }
  },
}

function extractPatchFileRefs(patch: string): string[] {
  const refs = new Set<string>()
  const lines = patch.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    // Match +++ b/path or --- a/path
    const match = line.match(/^[+]{3}\s+b\/(.+)$/) || line.match(/^[-]{3}\s+a\/(.+)$/)
    if (match?.[1] && match[1] !== '/dev/null') {
      refs.add(match[1])
    }
  }
  return [...refs]
}
