import type { RuntimeSkill, Tool } from '../runtime/contracts.js'
import { createToolRegistry, ToolRegistry } from '../runtime/tools.js'
import { BashTool } from './bashTool.js'
import { AgentInventoryTool } from './agentInventoryTool.js'
import { AgentTool } from './agentTool.js'
import { AskUserQuestionTool } from './askUserQuestionTool.js'
import { ConfigTool } from './configTool.js'
import { EditTool } from './editTool.js'
import { GlobTool } from './globTool.js'
import { GrepTool } from './grepTool.js'
import { LspTool } from './lspTool.js'
import { NotebookTool } from './notebookTool.js'
import { ReadTool } from './readTool.js'
import {
  EnterPlanModeTool,
  ExitPlanModeTool,
  ResultReportTool,
  TodoWriteTool,
} from './sessionTools.js'
import { createSkillTool } from './skillTool.js'
import { ToolSearchTool } from './toolSearchTool.js'
import { WebFetchTool } from './webFetchTool.js'
import { TaskStopTool } from './taskStopTool.js'
import { WriteTool } from './writeTool.js'
import { ListDirTool } from './listDirTool.js'
import { GitTool } from './gitTool.js'
import { ApplyPatchTool } from './applyPatchTool.js'
import { RunTestsTool } from './runTestsTool.js'
import { NoteTool } from './noteTool.js'
import { SnapshotTool } from './snapshotTool.js'

export const CORE_TOOLS = [
  ReadTool,
  GlobTool,
  GrepTool,
  ToolSearchTool,
  LspTool,
  AgentInventoryTool,
  TaskStopTool,
  AgentTool,
  ConfigTool,
  WebFetchTool,
  AskUserQuestionTool,
  NotebookTool,
  TodoWriteTool,
  EnterPlanModeTool,
  ExitPlanModeTool,
  WriteTool,
  EditTool,
  BashTool,
  ResultReportTool,
  ListDirTool,
  GitTool,
  ApplyPatchTool,
  RunTestsTool,
  NoteTool,
  SnapshotTool,
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
