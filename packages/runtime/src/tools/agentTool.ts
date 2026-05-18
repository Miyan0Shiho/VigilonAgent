import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { readLocalAgentDefinition } from '../runtime/agentDefinitions.js'

export const AgentTool: Tool = {
  name: 'Agent',
  description:
    'Delegates a focused subtask to a local subagent with its own transcript and restricted tool access.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Local agent name from .vigilon/agents/<agent>.md',
      },
      task: {
        type: 'string',
        description: 'Focused subtask for the delegated agent to complete.',
      },
    },
    required: ['agent', 'task'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = parseAgentInput(input)
    if (!parsed.agent || !parsed.task) {
      return failed('Agent requires non-empty "agent" and "task" fields.')
    }
    if (!context.runSubagent) {
      return failed('Agent runtime is not configured with subagent execution support.')
    }

    const permission = await context.permissionGate.requestPermission({
      action: 'external-tool',
      subject: `local subagent:${parsed.agent}`,
      risk: 'medium',
      reason: `Delegate a focused task to local subagent ${parsed.agent}`,
    })
    if (!permission.allowed) {
      return failed(`Agent permission denied: ${permission.reason}`)
    }

    const definition = await readLocalAgentDefinition(context.cwd, parsed.agent)
    const result = await context.runSubagent({
      definition,
      task: parsed.task,
      cwd: context.cwd,
    })

    return {
      toolCallId: '',
      ok: true,
      content: buildAgentResultContent(result.finalMessage, result.transcriptPath),
      metadata: {
        status: result.status,
        agentName: result.agentName,
        transcriptPath: result.transcriptPath,
        report: result.report,
      },
    }
  },
}

function parseAgentInput(input: unknown): { agent?: string; task?: string } {
  if (!input || typeof input !== 'object') return {}
  const value = input as Record<string, unknown>
  return {
    agent:
      typeof value.agent === 'string' && value.agent.trim()
        ? value.agent.trim()
        : undefined,
    task:
      typeof value.task === 'string' && value.task.trim()
        ? value.task.trim()
        : undefined,
  }
}

function buildAgentResultContent(finalMessage: string, transcriptPath: string): string {
  return [
    'Subagent completed the delegated task.',
    '',
    `Final message: ${finalMessage}`,
    `Transcript: ${transcriptPath}`,
  ].join('\n')
}

function failed(content: string): ToolResult {
  return {
    toolCallId: '',
    ok: false,
    content,
  }
}
