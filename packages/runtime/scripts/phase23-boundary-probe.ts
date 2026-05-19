import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createCoreToolRegistry,
  createLocalPermissionGate,
  createTimestamp,
  createVigilonAgentRuntime,
  JsonlTranscriptStore,
} from '../src/index.js'
import type {
  AgentRuntimeTurnResult,
  ModelClient,
  ModelRequest,
  ModelResponse,
  TranscriptEvent,
} from '../src/index.js'

const TASK =
  '搜索项目中 skill 的实现，不搜索 research/.research 等噪音目录，最后给我一个报告'

async function main(): Promise<void> {
  const cwd = discoverWorkspaceRoot(process.cwd()) ?? path.resolve(process.cwd())
  const outputDir = path.join(cwd, '.vigilon', 'boundary-probes', 'phase23')
  await mkdir(outputDir, { recursive: true })

  const sessionId = `skill-implementation-search-${Date.now()}`
  const transcript = new JsonlTranscriptStore({
    cwd,
    sessionsDir: outputDir,
    sessionId,
  })

  const runtime = createVigilonAgentRuntime({
    modelClient: createSkillSearchProbeModel(),
    tools: createCoreToolRegistry(),
    transcript,
    permissionGate: createLocalPermissionGate({
      mode: 'bypass-local',
      transcript,
    }),
    permissionMode: 'bypass-local',
    projectConfig: {
      ignore: [
        'research/**',
        '.research/**',
        '**/research/**',
        '**/.research/**',
        'docs/archived-research/**',
        'docs/claudecode-research/**',
      ],
      defaultCommands: {},
    },
    operatorGuidance: [
      'This is a Phase2/Phase3 boundary probe, not closure evidence.',
      'Prefer Grep/Glob/Read evidence over broad claims.',
      'Do not search research/.research, docs/archived-research, or docs/claudecode-research.',
      'Record a ResultReport with concrete evidence gaps and next Claude Code mechanisms to copy.',
    ].join('\n'),
    stopAfterResultReport: true,
    maxTurns: 12,
  })

  let turnResult: AgentRuntimeTurnResult | undefined
  for await (const event of runtime.runTurn({
    prompt: TASK,
    cwd,
    abortSignal: new AbortController().signal,
  })) {
    if (event.type === 'turn-finished') turnResult = event.result
  }
  if (!turnResult) throw new Error('boundary probe did not finish')

  const events = await transcript.readAll()
  const reportPath = path.join(
    cwd,
    'docs',
    'product',
    '2026-05-19-phase23-boundary-probe-skill-search.md',
  )
  await writeFile(reportPath, renderReport({
    cwd,
    task: TASK,
    transcriptPath: transcript.transcriptPath,
    turnResult,
    events,
  }))

  console.log(JSON.stringify({
    task: TASK,
    reportPath,
    transcriptPath: transcript.transcriptPath,
    status: turnResult.report.status,
    toolCalls: collectToolCalls(events),
    boundaryFindings: collectBoundaryFindings(events),
  }, null, 2))
}

function discoverWorkspaceRoot(startCwd: string): string | undefined {
  let current = path.resolve(startCwd)
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function createSkillSearchProbeModel(): ModelClient {
  const steps: Array<(request: ModelRequest) => Omit<ModelResponse, 'usage'>> = [
    () => toolResponse('todos', 'TodoWrite', {
      todos: [
        {
          id: 'scope',
          content: '限定搜索范围并排除 research/.research 噪音目录',
          status: 'completed',
        },
        {
          id: 'search',
          content: '用 Grep/Glob/Read 找到 skill runtime 和 tool 实现证据',
          status: 'in_progress',
        },
        {
          id: 'report',
          content: '记录 Phase2/Phase3 深层对齐缺口',
          status: 'pending',
        },
      ],
    }),
    () => toolResponse('grep-runtime-skill', 'Grep', {
      pattern: 'loadRuntimeSkills|buildSkillListing|injectSkillListing|RuntimeSkill',
      path: 'packages/runtime/src',
      output_mode: 'content',
      head_limit: 80,
    }),
    () => toolResponse('glob-skill-files', 'Glob', {
      pattern: 'packages/runtime/src/**/*skill*.ts',
      path: '.',
    }),
    () => toolResponse('read-runtime-skills', 'Read', {
      file_path: 'packages/runtime/src/runtime/skills.ts',
      offset: 1,
      limit: 220,
    }),
    () => toolResponse('read-skill-tool', 'Read', {
      file_path: 'packages/runtime/src/tools/skillTool.ts',
      offset: 1,
      limit: 220,
    }),
    () => toolResponse('toolsearch-lsp', 'ToolSearch', {
      query: 'language symbols references diagnostics',
    }),
    () => toolResponse('lsp-symbols', 'LSP', {
      action: 'documentSymbol',
      filePath: 'packages/runtime/src/runtime/skills.ts',
    }),
    () => toolResponse('todos-done', 'TodoWrite', {
      todos: [
        {
          id: 'scope',
          content: '限定搜索范围并排除 research/.research 噪音目录',
          status: 'completed',
        },
        {
          id: 'search',
          content: '用 Grep/Glob/Read 找到 skill runtime 和 tool 实现证据',
          status: 'completed',
        },
        {
          id: 'report',
          content: '记录 Phase2/Phase3 深层对齐缺口',
          status: 'in_progress',
        },
      ],
    }),
    () => toolResponse('report', 'ResultReport', {
      final_message:
        'Boundary probe finished: skill implementation can be located with scoped Grep/Glob/Read, but this is not Phase2/Phase3 closure evidence.',
      changes: [
        'Ran a scripted runtime probe for the task: 搜索项目中 skill 的实现，不搜索 research/.research 等噪音目录，最后给我一个报告.',
        'Produced transcript-backed evidence for skill runtime files and tool calls.',
      ],
      verification_notes: [
        'Grep path was restricted to packages/runtime/src.',
        'Glob pattern targeted packages/runtime/src/**/*skill*.ts.',
        'Read inspected packages/runtime/src/runtime/skills.ts and packages/runtime/src/tools/skillTool.ts.',
      ],
      unverified: [
        'This probe uses a scripted model, so it does not prove autonomous model search quality.',
        'LSP may fail or degrade depending on local server availability; that failure is part of the boundary log.',
        'TUI information hierarchy must still be manually checked while running this task interactively.',
      ],
      risks: [
        'Do not treat scripted boundary probes as closure evidence.',
        'Next pass must run the same task through deepseek-v4-flash and preserve the full transcript/log.',
      ],
    }),
  ]
  let index = 0
  return {
    id: 'phase23-boundary-probe-scripted-model',
    async createMessage(request) {
      const step = steps[index++] ?? steps.at(-1)
      if (!step) {
        return {
          content: 'No boundary probe step configured.',
          toolCalls: [],
          stopReason: 'error',
        }
      }
      return {
        ...step(request),
        usage: {
          inputTokens: estimateInputTokens(request),
          outputTokens: 64,
        },
      }
    },
  }
}

function toolResponse(
  id: string,
  name: string,
  input: unknown,
): Omit<ModelResponse, 'usage'> {
  return {
    content: '',
    toolCalls: [{ id, name, input }],
    stopReason: 'tool_use',
  }
}

function renderReport(input: {
  cwd: string
  task: string
  transcriptPath: string
  turnResult: AgentRuntimeTurnResult
  events: readonly TranscriptEvent[]
}): string {
  const toolCalls = collectToolCalls(input.events)
  const findings = collectBoundaryFindings(input.events)
  const toolResults = input.events
    .filter(event => event.type === 'tool-result')
    .map(event => {
      const name = toolCalls.find(call => call.id === event.result.toolCallId)?.name ?? event.result.toolCallId
      return `| ${name} | ${event.result.ok ? 'ok' : 'error'} | ${escapeTable(event.result.content.slice(0, 160))} |`
    })

  return [
    '# Phase2/Phase3 Boundary Probe: Skill Implementation Search',
    '',
    `- Date: ${createTimestamp()}`,
    '- Status: boundary probe only, not closure evidence',
    `- Cwd: \`${input.cwd}\``,
    `- Task: \`${input.task}\``,
    `- Transcript: \`${input.transcriptPath}\``,
    `- Runtime status: \`${input.turnResult.report.status}\``,
    '',
    '## Why This Exists',
    '',
    'This probe exists because Phase2/Phase3 previously over-counted scripted demos and minimal implementations as closure. It records a concrete complex-task trace so the next implementation pass can compare Vigilon behavior against Claude Code mechanisms instead of claiming parity from module presence.',
    '',
    '## Tool Calls',
    '',
    '| # | Tool | Input |',
    '| --- | --- | --- |',
    ...toolCalls.map((call, index) => `| ${index + 1} | ${call.name} | ${escapeTable(call.input)} |`),
    '',
    '## Tool Results',
    '',
    '| Tool | Status | Preview |',
    '| --- | --- | --- |',
    ...toolResults,
    '',
    '## Boundary Findings',
    '',
    ...findings.map(finding => `- ${finding}`),
    '',
    '## Interpretation',
    '',
    '- The task can be scripted through the runtime and produces useful transcript evidence.',
    '- LSP success here means the scripted trace proved ToolSearch materialization plus a real document-symbol response, not just tool-name availability.',
    '- This does not prove autonomous search convergence or Claude Code-level operator experience.',
    '- The next real test must run the same task through `deepseek-v4-flash` in the TUI, then preserve the transcript and manually mark where the operator lost context.',
    '',
  ].join('\n')
}

function collectToolCalls(events: readonly TranscriptEvent[]): Array<{
  id: string
  name: string
  input: string
}> {
  return events
    .filter(event => event.type === 'tool-call')
    .map(event => ({
      id: event.call.id,
      name: event.call.name,
      input: JSON.stringify(event.call.input),
    }))
}

function collectBoundaryFindings(events: readonly TranscriptEvent[]): string[] {
  const toolCalls = collectToolCalls(events)
  const searchedNoise = toolCalls.some(call =>
    /(^|["/])(?:research|\.research)(?:\/|["])/.test(call.input) ||
    /docs\/(?:archived-research|claudecode-research)/.test(call.input),
  )
  const resultErrors = events
    .filter(event => event.type === 'tool-result' && !event.result.ok)
    .map(event => event.result.content.slice(0, 180))
  const lspAttempted = toolCalls.some(call => call.name === 'LSP')
  const lspDiscovered = events.some(
    event =>
      event.type === 'tool-result' &&
      Array.isArray(event.result.metadata?.discoveredTools) &&
      event.result.metadata.discoveredTools.includes('LSP'),
  )
  const requestAuditCount = events.filter(event => event.type === 'llm-request').length
  const reportRecorded = events.some(
    event =>
      event.type === 'tool-result' &&
      event.result.metadata?.handoffReport,
  )
  const lspResult = events.find(
    event =>
      event.type === 'tool-result' &&
      toolCalls.some(call => call.id === event.result.toolCallId && call.name === 'LSP'),
  )
  const lspReturnedSymbols =
    lspResult?.type === 'tool-result' &&
    lspResult.result.ok &&
    typeof lspResult.result.metadata?.count === 'number' &&
    lspResult.result.metadata.count > 0

  return [
    searchedNoise
      ? 'Scope violation: at least one tool input touched a research noise path.'
      : 'Scope respected: tool inputs avoided research/.research and archived Claude Code research paths.',
    lspDiscovered
      ? 'LSP schema was materialized through ToolSearch.'
      : 'LSP schema was not materialized through ToolSearch; current discovery is lexical and missed a semantic query.',
    lspReturnedSymbols
      ? `LSP path returned concrete document symbols (${lspResult.result.metadata?.count}) from packages/runtime/src/runtime/skills.ts.`
      : lspAttempted
      ? 'LSP path was attempted; if it failed or returned no symbols, that is recoverable evidence for code-intelligence protocol gaps.'
      : 'LSP path was not attempted; this would be a structural-code-intelligence gap.',
    requestAuditCount > 0
      ? `Request audit events recorded: ${requestAuditCount}.`
      : 'Missing request audit events.',
    reportRecorded
      ? 'ResultReport handoff was recorded.'
      : 'Missing ResultReport handoff.',
    resultErrors.length > 0
      ? `Recoverable tool errors captured: ${resultErrors.join(' | ')}`
      : 'No tool errors occurred in this scripted trace; live model probes are still required.',
  ]
}

function estimateInputTokens(request: ModelRequest): number {
  const messageChars = request.messages.reduce(
    (count, event) => count + JSON.stringify(event).length,
    0,
  )
  const toolChars = request.tools.reduce(
    (count, tool) => count + JSON.stringify(tool.inputJsonSchema ?? {}).length + tool.description.length,
    0,
  )
  return Math.ceil((messageChars + toolChars) / 4)
}

function escapeTable(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

await main()
