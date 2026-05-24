import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'
import { resolveToolPath } from './path.js'

const execFileAsync = promisify(execFile)

export const RunTestsTool: Tool = {
  name: 'RunTests',
  description:
    'Runs project tests. Discovers the test command from package.json or project config. Use for verifying changes before reporting completion.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Custom test command. If omitted, uses the project default (pnpm test, npm test, etc.).',
      },
      path: {
        type: 'string',
        description: 'Specific test file or directory to run. Passed to the test command if supported.',
      },
    },
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = input as Record<string, unknown>
    let command = typeof parsed.command === 'string' ? parsed.command.trim() : undefined
    const testPath = typeof parsed.path === 'string' ? parsed.path.trim() : undefined

    if (!command) {
      // Discover test command from project config or package.json
      const projectTest = context.projectConfig?.defaultCommands?.['test']
      if (projectTest) {
        command = projectTest
      } else {
        // Try common test commands
        command = 'pnpm test'
      }
    }

    const permission = await context.permissionGate.requestPermission({
      action: 'bash',
      subject: command,
      risk: 'medium',
      reason: `Run tests: ${command}`,
      origin: withToolPermissionOrigin(context.permissionOrigin, 'RunTests'),
    })
    if (!permission.allowed) {
      return { toolCallId: '', ok: false, content: permission.reason }
    }

    const args = command.split(/\s+/)
    const executable = args[0] ?? 'pnpm'
    const execArgs = args.slice(1)
    if (testPath) {
      const resolved = resolveToolPath(context.cwd, testPath)
      execArgs.push(resolved)
    }

    try {
      const { stdout, stderr } = await execFileAsync(executable, execArgs, {
        cwd: context.cwd,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000,
        env: { ...process.env, CI: 'true' },
      })
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      const passed = !output.toLowerCase().includes('fail') && !output.includes('FAIL')
      return {
        toolCallId: '',
        ok: true,
        content: output || '(no output)',
        metadata: { command, passed: passed || undefined },
      }
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; message?: string; code?: number }
      const output = [execError.stdout?.trim(), execError.stderr?.trim()].filter(Boolean).join('\n')
      return {
        toolCallId: '',
        ok: true,
        content: output || execError.message || 'Tests failed',
        metadata: { command, passed: false },
      }
    }
  },
}
