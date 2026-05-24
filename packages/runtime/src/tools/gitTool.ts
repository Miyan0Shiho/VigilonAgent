import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'

const execFileAsync = promisify(execFile)

export const GitTool: Tool = {
  name: 'Git',
  description:
    'Git operations with structured output. Use instead of "git" in Bash for diff, log, show, and blame. Respects project boundaries.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Git operation: diff, log, show, blame, or status.',
        enum: ['diff', 'log', 'show', 'blame', 'status'],
      },
      path: {
        type: 'string',
        description: 'File path for blame/show. Optional for diff/log/status (defaults to whole repo).',
      },
      count: {
        type: 'number',
        description: 'Number of commits for log (default 10). Ignored for other actions.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
  readOnly: true,
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = input as Record<string, unknown>
    const action = typeof parsed.action === 'string' ? parsed.action : null
    if (!action || !['diff', 'log', 'show', 'blame', 'status'].includes(action)) {
      return { toolCallId: '', ok: false, content: 'Git requires a valid action: diff, log, show, blame, or status' }
    }

    const permission = await context.permissionGate.requestPermission({
      action: 'read',
      subject: `git ${action}`,
      risk: 'low',
      reason: `Git ${action} operation`,
      origin: withToolPermissionOrigin(context.permissionOrigin, 'Git'),
    })
    if (!permission.allowed) {
      return { toolCallId: '', ok: false, content: permission.reason }
    }

    const args: string[] = []
    const filePath = typeof parsed.path === 'string' ? parsed.path.trim() : undefined
    switch (action) {
      case 'diff': args.push('diff'); if (filePath) args.push('--', filePath); break
      case 'log': args.push('log', '--oneline', `-${parsed.count ?? 10}`); break
      case 'show': args.push('show'); if (filePath) args.push(filePath); break
      case 'blame': if (!filePath) return { toolCallId: '', ok: false, content: 'Git blame requires a file path' }; args.push('blame', filePath); break
      case 'status': args.push('status', '--short'); break
    }

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: context.cwd,
        maxBuffer: 1024 * 1024,
        timeout: 15_000,
      })
      return { toolCallId: '', ok: true, content: `<stdout>\n${stdout.trim() || '(no output)'}</stdout>`, metadata: { action } }
    } catch (error) {
      const message = (error as Error).message
      if (message.includes('not a git repository')) {
        return { toolCallId: '', ok: false, content: 'Not a git repository (or any parent).' }
      }
      return { toolCallId: '', ok: false, content: `Git ${action} failed: ${message}` }
    }
  },
}
