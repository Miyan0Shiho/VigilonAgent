import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createCoreToolRegistry,
  createLocalPermissionGate,
  createVigilonAgentRuntime,
  JsonlTranscriptStore,
} from '../src/index.js'
import type {
  AgentRuntimeTurnResult,
  ModelClient,
  ModelRequest,
  ModelResponse,
  RuntimeOperator,
  ToolUseContext,
} from '../src/index.js'

type ScenarioResult = {
  name: string
  cwd: string
  transcriptPath: string
  passed: boolean
  checks: string[]
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase2-acceptance-'))
  const results = [
    await runTypescriptBugfix(root),
    await runNotebookAndWebFetch(root),
    await runSkillSubagentCompact(root),
  ]
  const passed = results.every(result => result.passed)
  console.log(JSON.stringify({ passed, root, results }, null, 2))
  if (!passed) process.exitCode = 1
}

async function runTypescriptBugfix(root: string): Promise<ScenarioResult> {
  const cwd = path.join(root, 'repo-a-ts-bugfix')
  await mkdir(path.join(cwd, 'src'), { recursive: true })
  await writeFile(
    path.join(cwd, 'src', 'pricing.ts'),
    [
      'export function calculateTotal(subtotal: number, tax: number): number {',
      '  return subtotal;',
      '}',
      '',
    ].join('\n'),
  )
  await writeFile(
    path.join(cwd, 'test.js'),
    [
      "import { readFileSync } from 'node:fs';",
      "const src = readFileSync('src/pricing.ts', 'utf8');",
      "if (!src.includes('return subtotal + tax;')) throw new Error('tax is not included');",
      "console.log('pricing test passed');",
    ].join('\n'),
  )
  await writeFile(path.join(cwd, 'package.json'), '{"type":"module"}\n')

  const transcript = transcriptFor(cwd, 'typescript-bugfix')
  const modelClient = scriptedModel('ts-acceptance', [
    () => toolResponse('search', 'Grep', {
      pattern: 'calculateTotal',
      path: 'src',
      output_mode: 'content',
    }),
    () => toolResponse('read', 'Read', { file_path: 'src/pricing.ts' }),
    () => toolResponse('toolsearch', 'ToolSearch', { query: 'lsp symbol' }),
    () => toolResponse('lsp', 'LSP', {
      action: 'documentSymbol',
      filePath: 'src/pricing.ts',
    }),
    () => toolResponse('edit', 'Edit', {
      file_path: 'src/pricing.ts',
      old_string: '  return subtotal;',
      new_string: '  return subtotal + tax;',
    }),
    () => toolResponse('verify', 'Bash', {
      command: 'node test.js',
      description: 'Run pricing verification',
    }),
    () => ({ content: 'TypeScript bugfix accepted.', toolCalls: [], stopReason: 'end_turn' }),
  ])

  const result = await runRuntime({
    cwd,
    transcript,
    modelClient,
    lspServerManager: fakeLspManager(),
  })
  const source = await readFile(path.join(cwd, 'src', 'pricing.ts'), 'utf8')
  const events = await transcript.readAll()
  const checks = [
    hasTool(events, 'Grep') ? 'used Grep context ingress' : 'missing Grep',
    hasTool(events, 'Read') ? 'used Read context ingress' : 'missing Read',
    hasTool(events, 'ToolSearch') && hasTool(events, 'LSP')
      ? 'materialized deferred LSP'
      : 'missing deferred LSP path',
    source.includes('return subtotal + tax;') ? 'edited bugfix' : 'missing edit',
    result.stopReason === 'end_turn' ? 'completed turn' : `bad stop ${result.stopReason}`,
  ]
  return {
    name: 'repo-a-ts-bugfix',
    cwd,
    transcriptPath: transcript.transcriptPath,
    passed: checks.every(check => !check.startsWith('missing') && !check.startsWith('bad')),
    checks,
  }
}

async function runNotebookAndWebFetch(root: string): Promise<ScenarioResult> {
  const cwd = path.join(root, 'repo-b-notebook-docs')
  await mkdir(cwd, { recursive: true })
  await writeFile(
    path.join(cwd, 'analysis.ipynb'),
    JSON.stringify({
      cells: [
        {
          cell_type: 'markdown',
          source: ['# Analysis'],
          metadata: {},
          id: 'intro',
        },
      ],
      metadata: { kernelspec: { name: 'python3' } },
      nbformat: 4,
      nbformat_minor: 5,
    }),
  )

  const transcript = transcriptFor(cwd, 'notebook-webfetch')
  const modelClient = scriptedModel('notebook-acceptance', [
    () => toolResponse('fetch', 'WebFetch', { url: 'https://example.com/big-doc' }),
    () => toolResponse('fetch-cache', 'WebFetch', { url: 'https://example.com/big-doc' }),
    () => toolResponse('nb-read', 'Notebook', { action: 'read', filePath: 'analysis.ipynb' }),
    () => toolResponse('nb-insert', 'Notebook', {
      action: 'insert',
      filePath: 'analysis.ipynb',
      cellType: 'code',
      source: 'print("accepted")',
    }),
    () => toolResponse('ask', 'AskUserQuestion', {
      questions: [
        {
          question: 'Keep the inserted notebook cell?',
          header: 'Notebook',
          options: [
            { label: 'Keep', description: 'Leave the acceptance cell in place.' },
            { label: 'Remove', description: 'Delete the cell.' },
          ],
        },
      ],
    }),
    () => ({ content: 'Notebook/WebFetch accepted.', toolCalls: [], stopReason: 'end_turn' }),
  ])

  let fetchCalls = 0
  const result = await runRuntime({
    cwd,
    transcript,
    modelClient,
    operator: {
      async askQuestions(input) {
        return { questions: input.questions, answers: { [input.questions[0]!.question]: 'Keep' } }
      },
    },
    webFetch: {
      cache: new Map(),
      maxContentChars: 40,
      fetch: async () => {
        fetchCalls += 1
        return new Response(`<h1>Docs</h1><p>${'alpha '.repeat(80)}</p>`, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      },
      summarize: async ({ url }) => `summary for ${url}`,
    },
  })
  const notebook = await readFile(path.join(cwd, 'analysis.ipynb'), 'utf8')
  const notebookJson = JSON.parse(notebook) as {
    cells: Array<{ source: string | string[] }>
  }
  const notebookSources = notebookJson.cells.map(cell =>
    Array.isArray(cell.source) ? cell.source.join('') : cell.source,
  )
  const events = await transcript.readAll()
  const checks = [
    fetchCalls === 1 ? 'WebFetch cache hit verified' : `WebFetch cache miss count ${fetchCalls}`,
    hasTool(events, 'WebFetch') ? 'used WebFetch' : 'missing WebFetch',
    hasTool(events, 'Notebook') && notebookSources.includes('print("accepted")')
      ? 'inserted notebook cell'
      : 'missing notebook insert',
    hasTool(events, 'AskUserQuestion') ? 'used AskUserQuestion' : 'missing AskUserQuestion',
    result.stopReason === 'end_turn' ? 'completed turn' : `bad stop ${result.stopReason}`,
  ]
  return {
    name: 'repo-b-notebook-docs',
    cwd,
    transcriptPath: transcript.transcriptPath,
    passed: checks.every(check => !check.startsWith('missing') && !check.startsWith('bad') && !check.includes('miss')),
    checks,
  }
}

async function runSkillSubagentCompact(root: string): Promise<ScenarioResult> {
  const cwd = path.join(root, 'repo-c-skill-subagent')
  await mkdir(path.join(cwd, '.vigilon', 'skills', 'reader'), { recursive: true })
  await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
  await writeFile(path.join(cwd, 'README.md'), 'Phase2 acceptance target\n')
  await writeFile(
    path.join(cwd, '.vigilon', 'skills', 'reader', 'SKILL.md'),
    [
      '---',
      'name: reader',
      'description: Read-only acceptance skill',
      'allowed-tools: [Read, Grep]',
      '---',
      'Inspect files without mutating them.',
    ].join('\n'),
  )
  await writeFile(
    path.join(cwd, '.vigilon', 'agents', 'checker.md'),
    [
      '---',
      'description: Acceptance checker',
      'maxTurns: 2',
      'allowedTools:',
      '  - Read',
      '---',
      'Check the requested file.',
    ].join('\n'),
  )

  const transcript = transcriptFor(cwd, 'skill-subagent-compact')
  const modelClient = scriptedModel('skill-acceptance', [
    () => toolResponse('skill', 'Skill', { skill: 'reader' }),
    () => toolResponse('blocked', 'Bash', { command: 'echo should-not-run' }),
    () => ({ content: 'Skill gate accepted.', toolCalls: [], stopReason: 'end_turn' }),
  ])
  const result = await runRuntime({
    cwd,
    transcript,
    modelClient,
    tools: createCoreToolRegistry({
      skills: [
        {
          name: 'reader',
          description: 'Read-only acceptance skill',
          content: 'Inspect files without mutating them.',
          path: path.join(cwd, '.vigilon', 'skills', 'reader', 'SKILL.md'),
          root: path.join(cwd, '.vigilon', 'skills', 'reader'),
          source: 'project',
          allowedTools: ['Read', 'Grep'],
          disableModelInvocation: false,
          userInvocable: false,
        },
      ],
    }),
    skills: [
      {
        name: 'reader',
        description: 'Read-only acceptance skill',
        content: 'Inspect files without mutating them.',
        path: path.join(cwd, '.vigilon', 'skills', 'reader', 'SKILL.md'),
        root: path.join(cwd, '.vigilon', 'skills', 'reader'),
        source: 'project',
        allowedTools: ['Read', 'Grep'],
        disableModelInvocation: false,
        userInvocable: false,
      },
    ],
  })
  const events = await transcript.readAll()
  const blocked = events.some(
    event =>
      event.type === 'tool-result' &&
      event.result.content.includes('blocked by active skill reader'),
  )
  const checks = [
    hasTool(events, 'Skill') ? 'loaded skill' : 'missing Skill',
    blocked ? 'blocked skill-disallowed Bash execution' : 'missing skill hard gate',
    events.some(event => event.type === 'llm-request') ? 'recorded request audit' : 'missing request audit',
    result.stopReason === 'end_turn' ? 'completed turn' : `bad stop ${result.stopReason}`,
  ]
  return {
    name: 'repo-c-skill-subagent',
    cwd,
    transcriptPath: transcript.transcriptPath,
    passed: checks.every(check => !check.startsWith('missing') && !check.startsWith('bad')),
    checks,
  }
}

function transcriptFor(cwd: string, name: string): JsonlTranscriptStore {
  return new JsonlTranscriptStore({
    cwd,
    sessionId: name,
    sessionsDir: path.join(cwd, '.acceptance-sessions'),
  })
}

async function runRuntime(options: {
  cwd: string
  transcript: JsonlTranscriptStore
  modelClient: ModelClient
  tools?: ReturnType<typeof createCoreToolRegistry>
  skills?: Parameters<typeof createCoreToolRegistry>[0]['skills']
  operator?: RuntimeOperator
  webFetch?: ToolUseContext['webFetch']
  lspServerManager?: any
}): Promise<AgentRuntimeTurnResult> {
  const runtime = createVigilonAgentRuntime({
    modelClient: options.modelClient,
    tools: options.tools ?? createCoreToolRegistry(),
    skills: options.skills ?? [],
    transcript: options.transcript,
    permissionGate: createLocalPermissionGate({
      mode: 'bypass-local',
      transcript: options.transcript,
    }),
    permissionMode: 'bypass-local',
    operator: options.operator,
    webFetch: options.webFetch,
    lspServerManager: options.lspServerManager,
    maxTurns: 12,
  })
  let turnResult: AgentRuntimeTurnResult | undefined
  for await (const event of runtime.runTurn({
    prompt: 'Run Phase2 acceptance scenario.',
    cwd: options.cwd,
    abortSignal: new AbortController().signal,
  })) {
    if (event.type === 'turn-finished') turnResult = event.result
  }
  if (!turnResult) throw new Error('runtime did not finish')
  return turnResult
}

function scriptedModel(
  id: string,
  steps: Array<(request: ModelRequest) => Omit<ModelResponse, 'usage'>>,
): ModelClient {
  let index = 0
  return {
    id,
    async createMessage(request) {
      const step = steps[index++] ?? steps.at(-1)
      if (!step) return { content: 'No script step', toolCalls: [], stopReason: 'error' }
      return { ...step(request), usage: { inputTokens: 100 + index, outputTokens: 20 } }
    },
  }
}

function toolResponse(id: string, name: string, input: unknown): Omit<ModelResponse, 'usage'> {
  return {
    content: '',
    toolCalls: [{ id, name, input }],
    stopReason: 'tool_use',
  }
}

function hasTool(events: Awaited<ReturnType<JsonlTranscriptStore['readAll']>>, name: string): boolean {
  return events.some(event => event.type === 'tool-call' && event.call.name === name)
}

function fakeLspManager(): any {
  const server = {
    config: { languages: ['typescript'] },
    start: async () => undefined,
    sendNotification: async () => undefined,
    sendRequest: async (method: string) => {
      if (method === 'textDocument/documentSymbol') {
        return [{ name: 'calculateTotal', kind: 12 }]
      }
      return []
    },
  }
  return {
    initialize: async () => undefined,
    shutdown: async () => undefined,
    getAllServers: () => new Map([['typescript', server]]),
    getServerForFile: () => server,
    getFileContent: async () => 'export function calculateTotal() {}',
    workspaceSymbol: async () => [{ name: 'calculateTotal', kind: 12 }],
    implementation: async () => [],
    callHierarchy: async () => undefined,
    getDiagnostics: async () => [],
  }
}

await main()
