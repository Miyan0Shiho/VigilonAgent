import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createCoreToolRegistry,
  createDeepSeekModelClient,
  createLocalPermissionGate,
  createVigilonAgentRuntime,
  JsonlTranscriptStore,
  readTranscriptFile,
  type ModelClient,
  type ModelResponse,
  type RuntimeSessionState,
  type TranscriptEvent,
} from '../src/index.js'

type ProbeCheck = {
  name: string
  passed: boolean
  details?: unknown
}

type LiveProviderResult = {
  status: 'hit' | 'skipped-no-api-key' | 'inconclusive' | 'error'
  required: boolean
  attempts: Array<{
    attempt: number
    inputTokens?: number
    outputTokens?: number
    cacheReadInputTokens?: number
    cacheCreationInputTokens?: number
    cacheHitRatio?: number
    stopReason?: ModelResponse['stopReason']
    error?: string
  }>
  error?: string
}

async function main(): Promise<void> {
  const requireProvider = process.argv.includes('--require-provider')
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase25-cache-'))
  try {
    const deepSeekMapping = await runDeepSeekUsageMappingCheck()
    const runtimeSharing = await runRuntimeCacheSharingCheck(root)
    const liveProvider = await runLiveProviderCheck(requireProvider)
    const checks: ProbeCheck[] = [
      deepSeekMapping,
      runtimeSharing,
      {
        name: requireProvider
          ? 'live DeepSeek provider reports prompt cache hit tokens for a repeated byte-identical prefix'
          : 'live DeepSeek provider cache hit observation is optional unless --require-provider is set',
        passed: requireProvider
          ? liveProvider.status === 'hit'
          : liveProvider.status === 'hit' ||
            liveProvider.status === 'skipped-no-api-key' ||
            liveProvider.status === 'inconclusive',
        details: liveProvider,
      },
    ]
    const passed = checks.every(check => check.passed)
    console.log(
      JSON.stringify(
        {
          phase: 'P2.5 Provider Cache / Prefix Sharing Runtime',
          status: passed ? 'cache_probe_ok' : 'cache_probe_failed',
          closureEvidence: requireProvider && liveProvider.status === 'hit',
          scope:
            'Validates provider cache usage plumbing, transcript-level cache read/create evidence, forked subagent byte-identical prefix metadata, and optionally a live DeepSeek prompt_cache_hit_tokens observation when --require-provider is set.',
          checks,
        },
        null,
        2,
      ),
    )
    if (!passed) process.exitCode = 1
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function runDeepSeekUsageMappingCheck(): Promise<ProbeCheck> {
  let requestBody: any
  const client = createDeepSeekModelClient({
    apiKey: 'test-key',
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: 'cache mapped' },
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 5,
            total_tokens: 125,
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 40,
          },
        }),
        { status: 200 },
      )
    },
  })
  const response = await client.createMessage({
    messages: [{ type: 'user', content: 'cache usage mapping', timestamp: '2026-05-21T00:00:00Z' }],
    tools: [],
    abortSignal: new AbortController().signal,
  })
  const passed =
    requestBody?.stream_options?.include_usage === true &&
    response.usage?.inputTokens === 120 &&
    response.usage.outputTokens === 5 &&
    response.usage.totalTokens === 125 &&
    response.usage.cacheReadInputTokens === 80 &&
    response.usage.cacheCreationInputTokens === 40 &&
    response.usage.cacheHitRatio === 80 / 120
  return {
    name: 'DeepSeek client maps provider prompt cache usage fields into ModelResponse usage',
    passed,
    details: {
      requestBody,
      usage: response.usage,
    },
  }
}

async function runRuntimeCacheSharingCheck(root: string): Promise<ProbeCheck> {
  const cwd = path.join(root, 'workspace')
  const sessionsDir = path.join(root, 'sessions')
  await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
  await writeFile(
    path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
    [
      '---',
      'description: Cache usage researcher',
      'maxTurns: 1',
      'allowedTools:',
      '---',
      'Report cache usage.',
    ].join('\n'),
    'utf8',
  )
  const transcript = new JsonlTranscriptStore({
    cwd,
    sessionsDir,
    sessionId: 'phase25-cache-sharing-parent',
  })
  const sessionState: RuntimeSessionState = {
    phase: 'execute',
    permissionMode: 'bypass-local',
    todos: [],
    verificationNotes: [],
    backgroundTasks: [],
    retainedTasks: [],
    discoveredToolNames: [],
    toolReferenceDeltas: [],
    mcpInstructions: [],
  }
  const runtime = createVigilonAgentRuntime({
    modelClient: createCacheSharingModel(),
    tools: createCoreToolRegistry(),
    transcript,
    permissionGate: createLocalPermissionGate({
      mode: 'bypass-local',
      transcript,
    }),
    permissionMode: 'bypass-local',
    resume: {
      sessionId: transcript.sessionId,
      transcriptPath: transcript.transcriptPath,
      events: [],
      sessionState,
    },
  })
  for await (const _event of runtime.runTurn({
    prompt: 'Use researcher to validate forked subagent provider cache usage.',
    cwd,
    abortSignal: new AbortController().signal,
  })) {
    // Drain runtime events.
  }
  const parentEvents = await transcript.readAll()
  const agentResult = parentEvents.find(
    event => event.type === 'tool-result' && event.result.metadata?.agentName === 'researcher',
  ) as Extract<TranscriptEvent, { type: 'tool-result' }> | undefined
  const subagentTranscriptPath = agentResult?.result.metadata?.transcriptPath as string | undefined
  const subagentEvents = subagentTranscriptPath
    ? await readTranscriptFile(subagentTranscriptPath)
    : []
  const parentRequest = parentEvents.find(
    event => event.type === 'llm-request',
  ) as Extract<TranscriptEvent, { type: 'llm-request' }> | undefined
  const subagentRequest = subagentEvents.find(
    event => event.type === 'llm-request',
  ) as Extract<TranscriptEvent, { type: 'llm-request' }> | undefined
  const subagentResponse = subagentEvents.find(
    event => event.type === 'llm-response',
  ) as Extract<TranscriptEvent, { type: 'llm-response' }> | undefined
  const subagentAssistant = subagentEvents.find(
    event => event.type === 'assistant',
  ) as Extract<TranscriptEvent, { type: 'assistant' }> | undefined
  const passed =
    parentRequest?.cachePrefix?.source === 'request' &&
    subagentRequest?.cachePrefix?.source === 'fork-shared-prefix' &&
    subagentRequest.cachePrefix.parentCanonicalPrefixHash ===
      parentRequest.cachePrefix.canonicalPrefixHash &&
    subagentResponse?.cacheReadInputTokens === 150 &&
    subagentResponse.cacheCreationInputTokens === 50 &&
    subagentResponse.cacheHitRatio === 150 / 200 &&
    subagentAssistant?.usage?.cacheReadInputTokens === 150
  return {
    name: 'forked subagent transcript records provider cache hit usage on shared byte-identical prefix',
    passed,
    details: {
      parentCachePrefix: parentRequest?.cachePrefix,
      subagentCachePrefix: subagentRequest?.cachePrefix,
      subagentResponse,
      assistantUsage: subagentAssistant?.usage,
      subagentTranscriptPath,
    },
  }
}

function createCacheSharingModel(): ModelClient {
  return {
    id: 'deepseek:provider-cache-fixture',
    async createMessage(request) {
      const isSubagent = request.messages.some(
        message =>
          message.type === 'user' &&
          message.content.includes('You are running as a focused local subagent.'),
      )
      if (isSubagent) {
        return {
          content: 'Subagent provider cache usage observed.',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 200,
            outputTokens: 6,
            totalTokens: 206,
            cacheReadInputTokens: 150,
            cacheCreationInputTokens: 50,
            cacheHitRatio: 150 / 200,
          },
        }
      }
      const sawAgentResult = request.messages.some(
        message =>
          message.type === 'tool-result' &&
          message.result.metadata?.agentName === 'researcher',
      )
      if (sawAgentResult) {
        return {
          content: 'Parent observed provider cache usage.',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 260,
            outputTokens: 5,
            totalTokens: 265,
            cacheReadInputTokens: 210,
            cacheCreationInputTokens: 50,
            cacheHitRatio: 210 / 260,
          },
        }
      }
      return {
        content: '',
        toolCalls: [
          {
            id: 'cache-agent-1',
            name: 'Agent',
            input: {
              agent: 'researcher',
              task: 'Report provider cache usage from the shared fork prefix.',
            },
          },
        ],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 180,
          outputTokens: 8,
          totalTokens: 188,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 180,
          cacheHitRatio: 0,
        },
      }
    },
  }
}

async function runLiveProviderCheck(required: boolean): Promise<LiveProviderResult> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { status: 'skipped-no-api-key', required, attempts: [] }
  }
  const client = createDeepSeekModelClient()
  const attempts: LiveProviderResult['attempts'] = []
  const commonPrefix = buildLiveCacheProbePrefix()
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await runWithTimeout(client, commonPrefix)
      attempts.push({
        attempt,
        stopReason: response.stopReason,
        ...response.usage,
      })
      if ((response.usage?.cacheReadInputTokens ?? 0) > 0) {
        return { status: 'hit', required, attempts }
      }
      if (attempt < 3) {
        await delay(2500)
      }
    } catch (error) {
      attempts.push({
        attempt,
        error: error instanceof Error ? error.message : String(error),
      })
      if (attempt < 3) {
        await delay(2500)
      }
    }
  }
  return { status: 'inconclusive', required, attempts }
}

async function runWithTimeout(
  client: ModelClient,
  commonPrefix: string,
): Promise<ModelResponse> {
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), 60_000)
  try {
    return await client.createMessage({
      messages: [
        {
          type: 'user',
          content: `${commonPrefix}\n\nReturn exactly CACHE_OK.`,
          timestamp: '2026-05-21T00:00:00Z',
        },
      ],
      tools: [],
      abortSignal: abortController.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function buildLiveCacheProbePrefix(): string {
  const probeId = `vigilon-provider-cache-${new Date().toISOString().slice(0, 10)}`
  const stableBlock = Array.from({ length: 220 }, (_, index) =>
    `cache-prefix-line-${String(index).padStart(3, '0')}: Vigilon validates byte-identical fork prefix provider cache accounting with stable text.`,
  ).join('\n')
  return [
    '<vigilon_provider_cache_probe>',
    `probe_id=${probeId}`,
    stableBlock,
    '</vigilon_provider_cache_probe>',
  ].join('\n')
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
