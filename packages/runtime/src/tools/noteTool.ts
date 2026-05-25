import type { Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { promoteLongTermMemory } from '../runtime/projectMemory.js'
import type { LongTermMemoryKind } from '../runtime/projectMemory.js'
import { withToolPermissionOrigin } from '../runtime/permissionOrigins.js'

export const NoteTool: Tool = {
  name: 'Note',
  description:
    'Saves an important finding, decision, or context to persistent project memory. Use sparingly for architectural decisions, open blockers, and important discoveries that should survive across sessions.',
  inputJsonSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: 'Memory type: project (decisions/architecture), feedback (corrections), reference (external docs), or user (preferences).',
        enum: ['project', 'feedback', 'reference', 'user'],
      },
      topic: {
        type: 'string',
        description: 'Short topic name (kebab-case). Used as the memory file name.',
      },
      content: {
        type: 'string',
        description: 'Markdown content to save. Include context, decisions, and reasons.',
      },
    },
    required: ['kind', 'topic', 'content'],
    additionalProperties: false,
  },
  async invoke(input: unknown, context: ToolUseContext): Promise<ToolResult> {
    const parsed = input as Record<string, unknown>
    const kind = typeof parsed.kind === 'string' ? parsed.kind : null
    const topic = typeof parsed.topic === 'string' ? parsed.topic.trim() : ''
    const content = typeof parsed.content === 'string' ? parsed.content.trim() : ''

    if (!kind || !['project', 'feedback', 'reference', 'user'].includes(kind)) {
      return { toolCallId: '', ok: false, content: 'Note requires a valid kind: project, feedback, reference, or user' }
    }
    if (!topic || !content) {
      return { toolCallId: '', ok: false, content: 'Note requires non-empty topic and content' }
    }

    const permission = await context.permissionGate.requestPermission({
      action: 'write',
      subject: `.vigilon/memory/topics/${kind}/${topic}.md`,
      risk: 'low',
      reason: `Save ${kind} memory: ${topic}`,
      origin: withToolPermissionOrigin(context.permissionOrigin, 'Note'),
    })
    if (!permission.allowed) {
      return { toolCallId: '', ok: false, content: permission.reason }
    }

    try {
      const result = await promoteLongTermMemory({
        cwd: context.cwd,
        kind: kind as LongTermMemoryKind,
        topic,
        content,
        source: {
          sessionId: context.transcript?.sessionId ?? 'unknown',
          transcriptPath: context.transcript?.transcriptPath,
          sourceEventCount: 0,
        },
      })
      return {
        toolCallId: '',
        ok: true,
        content: result.promoted
          ? `Memory saved: ${kind}/${topic} (${result.manifest.entries.length} total memories)`
          : `Memory not saved: ${result.decision.rejectedCategories.join(', ') || 'unknown reason'}`,
        metadata: { promoted: result.promoted, kind, topic, entryCount: result.manifest.entries.length },
      }
    } catch (error) {
      return { toolCallId: '', ok: false, content: `Failed to save memory: ${(error as Error).message}` }
    }
  },
}
