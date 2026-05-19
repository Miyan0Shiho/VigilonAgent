import type { RuntimeSkill, Tool, ToolResult, ToolUseContext } from '../runtime/contracts.js'
import { buildSkillContent } from '../runtime/skills.js'

export function createSkillTool(skills: readonly RuntimeSkill[]): Tool {
  const skillsByName = new Map(skills.map(skill => [skill.name, skill]))
  return {
    name: 'Skill',
    description:
      'Load a local skill by name and return its complete instructions for the current task.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'Exact local skill name from the available skill listing.',
        },
        args: {
          type: 'string',
          description: 'Optional arguments to substitute into the skill prompt.',
        },
      },
      required: ['skill'],
      additionalProperties: false,
    },
    readOnly: true,
    async invoke(input: unknown, _context: ToolUseContext): Promise<ToolResult> {
      const parsed = parseSkillInput(input)
      if (!parsed.skill) {
        return {
          toolCallId: '',
          ok: false,
          content: 'Skill requires a non-empty skill name',
        }
      }
      const skill = skillsByName.get(parsed.skill)
      if (!skill) {
        return {
          toolCallId: '',
          ok: false,
          content: `Unknown skill: ${parsed.skill}`,
        }
      }
      return {
        toolCallId: '',
        ok: true,
        content: buildSkillContent(skill, parsed.args),
        metadata: {
          skillName: skill.name,
          skillPath: skill.path,
          skillSource: skill.source,
          allowedTools: skill.allowedTools,
          model: skill.model,
          effort: skill.effort,
          activeSkill: {
            name: skill.name,
            allowedTools: skill.allowedTools,
            activatedAt: new Date().toISOString(),
          },
        },
      }
    },
  }
}

function parseSkillInput(input: unknown): { skill?: string; args?: string } {
  if (typeof input !== 'object' || input === null) return {}
  const record = input as Record<string, unknown>
  return {
    skill:
      typeof record.skill === 'string' && record.skill.trim()
        ? record.skill.trim().replace(/^\//, '')
        : undefined,
    args: typeof record.args === 'string' ? record.args : undefined,
  }
}
