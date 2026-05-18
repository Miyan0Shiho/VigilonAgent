import type { RuntimeSkill, Tool } from '../runtime/contracts.js'
import { createToolRegistry, ToolRegistry } from '../runtime/tools.js'
import { BashTool } from './bashTool.js'
import { AgentTool } from './agentTool.js'
import { AskUserQuestionTool } from './askUserQuestionTool.js'
import { ConfigTool } from './configTool.js'
import { EditTool } from './editTool.js'
import { GlobTool } from './globTool.js'
import { GrepTool } from './grepTool.js'
import { LspTool } from './lspTool.js'
import { ReadTool } from './readTool.js'
import {
  EnterPlanModeTool,
  ExitPlanModeTool,
  ResultReportTool,
  TodoWriteTool,
} from './sessionTools.js'
import { createSkillTool } from './skillTool.js'
import { WebFetchTool } from './webFetchTool.js'
import { TaskStopTool } from './taskStopTool.js'
import { WriteTool } from './writeTool.js'

export const CORE_TOOLS = [
  ReadTool,
  GlobTool,
  GrepTool,
  LspTool,
  TaskStopTool,
  AgentTool,
  ConfigTool,
  WebFetchTool,
  AskUserQuestionTool,
  TodoWriteTool,
  EnterPlanModeTool,
  ExitPlanModeTool,
  WriteTool,
  EditTool,
  BashTool,
  ResultReportTool,
] as const

export function createCoreToolRegistry(options: {
  skills?: readonly RuntimeSkill[]
  mcpTools?: readonly Tool[]
  allowedTools?: readonly string[]
} = {}): ToolRegistry {
  const skills = options.skills ?? []
  const tools = [
    ...CORE_TOOLS,
    ...(options.mcpTools ?? []),
    ...(skills.length > 0 ? [createSkillTool(skills)] : []),
  ]
  return createToolRegistry(filterAllowedTools(tools, options.allowedTools))
}

function filterAllowedTools(
  tools: readonly Tool[],
  allowedTools: readonly string[] | undefined,
): Tool[] {
  if (!allowedTools) return [...tools]
  const allowed = new Set(allowedTools)
  return tools.filter(tool => allowed.has(tool.name))
}
