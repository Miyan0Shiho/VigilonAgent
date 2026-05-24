import { execFile } from 'node:child_process'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { createTimestamp } from '../runtime/transcript.js'

const execFileAsync = promisify(execFile)

export const SnapshotTool: Tool = {
  name: 'Snapshot',
  description:
    'Save or restore a git-based workspace snapshot. Use before making risky changes so you can roll back later. Snapshots are independent of the user\'s git history.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'save to create a snapshot, restore to roll back to the latest, list to see all snapshots.',
        enum: ['save', 'restore', 'list'],
      },
      label: {
        type: 'string',
        description: 'Optional label for the snapshot (save action only).',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = input as Record<string, unknown>
    const action = typeof parsed.action === 'string' ? parsed.action : null
    const label = typeof parsed.label === 'string' ? parsed.label.trim() : undefined

    if (!action || !['save', 'restore', 'list'].includes(action)) {
      return { toolCallId: '', ok: false, content: 'Snapshot requires action: save, restore, or list' }
    }

    const snapDir = path.join(context.cwd, '.vigilon', 'snapshots')
    await mkdir(snapDir, { recursive: true })

    if (action === 'list') {
      try {
        const entries = await readdir(snapDir)
        const patches = entries.filter(e => e.endsWith('.patch')).sort().reverse()
        if (patches.length === 0) return { toolCallId: '', ok: true, content: 'No snapshots found.' }
        const lines = patches.map((p, i) => {
          const ts = p.replace('.patch', '').replace(/_/g, ':').replace(/T(\d)/, ' $1')
          return `${i + 1}. ${ts}`
        })
        return { toolCallId: '', ok: true, content: lines.join('\n'), metadata: { count: patches.length } }
      } catch {
        return { toolCallId: '', ok: true, content: 'No snapshots found.' }
      }
    }

    if (action === 'save') {
      const permission = await context.permissionGate.requestPermission({
        action: 'read',
        subject: 'workspace snapshot',
        risk: 'low',
        reason: 'Save workspace state for potential rollback',
        origin: withToolPermissionOrigin(context.permissionOrigin, 'Snapshot'),
      })
      if (!permission.allowed) return { toolCallId: '', ok: false, content: permission.reason }

      try {
        const timestamp = createTimestamp().replace(/[:.]/g, '_')
        const patchPath = path.join(snapDir, `${timestamp}.patch`)
        const labelPath = label ? path.join(snapDir, `${timestamp}.label`) : null

        // Save git diff of working tree
        const { stdout } = await execFileAsync('git', ['diff', '--binary', 'HEAD'], {
          cwd: context.cwd,
          maxBuffer: 10 * 1024 * 1024,
          timeout: 10_000,
        })
        const diffOutput: string = stdout?.toString() ?? ''
        await writeFile(patchPath, diffOutput, 'utf8')
        if (labelPath && label) await writeFile(labelPath, label, 'utf8')

        const size = stdout?.length ?? 0
        return {
          toolCallId: '', ok: true,
          content: `Snapshot saved${label ? `: "${label}"` : ''} (${(size / 1024).toFixed(1)}KB)${size === 0 ? ' — working tree is clean' : ''}`,
          metadata: { action: 'save', timestamp, size, clean: size === 0 },
        }
      } catch (error) {
        return { toolCallId: '', ok: false, content: `Snapshot save failed: ${(error as Error).message}` }
      }
    }

    // restore
    const permission = await context.permissionGate.requestPermission({
      action: 'write',
      subject: 'workspace restore',
      risk: 'high',
      reason: 'Restore workspace from snapshot — this will revert all uncommitted changes',
      origin: withToolPermissionOrigin(context.permissionOrigin, 'Snapshot'),
    })
    if (!permission.allowed) return { toolCallId: '', ok: false, content: permission.reason }

    try {
      const entries = await readdir(snapDir)
      const patches = entries.filter(e => e.endsWith('.patch')).sort().reverse()
      if (patches.length === 0) return { toolCallId: '', ok: false, content: 'No snapshots available to restore.' }

      const latest = patches[0]!
      const patchPath = path.join(snapDir, latest)

      // First, save a safety snapshot before restoring
      const safetyTs = createTimestamp().replace(/[:.]/g, '_')
      const safetyPath = path.join(snapDir, `${safetyTs}_pre-restore.patch`)
      try {
        const { stdout: safetyDiff } = await execFileAsync('git', ['diff', '--binary', 'HEAD'], {
          cwd: context.cwd, maxBuffer: 10 * 1024 * 1024, timeout: 10_000,
        })
        await writeFile(safetyPath, safetyDiff || '', 'utf8')
      } catch { /* safety snapshot is best-effort */ }

      // Apply the snapshot in reverse
      await execFileAsync('git', ['apply', '--whitespace=nowarn', '-R', patchPath], {
        cwd: context.cwd, maxBuffer: 10 * 1024 * 1024, timeout: 15_000,
      })

      return {
        toolCallId: '', ok: true,
        content: `Restored to snapshot ${latest.replace('.patch', '')}. Pre-restore state saved as ${safetyTs}.`,
        metadata: { action: 'restore', snapshot: latest, safetySnapshot: safetyTs },
      }
    } catch (error) {
      return { toolCallId: '', ok: false, content: `Restore failed: ${(error as Error).message}` }
    }
  },
}
