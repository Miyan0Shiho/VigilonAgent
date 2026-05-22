import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
	  compactTranscript,
	  buildPermissionOriginSummary,
	  createCoreToolRegistry,
  createLocalPermissionGate,
  createVigilonAgentRuntime,
  ensureFreshSessionMemory,
  estimateCompactTokenPressure,
  JsonlTranscriptStore,
  resolveCompactContextWindowBudget,
  resumeSessionById,
  type ModelClient,
  type TranscriptEvent,
} from '../src/index.js'

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

type GateResult = {
  command: string
  passed: boolean
  status: string
  output: string
}

type IntegratedCheck = {
  name: string
  passed: boolean
  details?: unknown
}

const GATES = [
  'phase2.5:memory-probe',
  'phase2.5:compact-probe',
  'phase2.5:safety-probe',
  'phase2.5:subagent-probe',
  'phase2.5:cache-probe',
]

async function main(): Promise<void> {
  const root = discoverWorkspaceRoot(process.cwd()) ?? path.resolve(process.cwd())
  const results = GATES.map(gate => runGate(root, gate))
  const integrated = await runIntegratedGovernanceScenario(root)
  const passed = results.every(result => result.passed) && integrated.passed
  console.log(
    JSON.stringify(
      {
        phase: 'P2.5 Runtime Governance',
        status: passed ? 'governance_probe_ok' : 'governance_probe_failed',
        closureEvidence: false,
        scope:
          'Runs the current Memory, Compact, Safety, Subagent, and Provider Cache P2.5 slice probes, then executes one synthetic integrated runtime scenario covering subagent delegation, source-aware catalog gates, shared task-host metadata, Bash safety and sandbox metadata, model-grounded session memory, memory-readiness compact gating, token-pressure compact metadata, resume, and final handoff. It does not prove full P2.5 closure while provider-backed cache-hit closure requires pnpm phase2.5:provider-cache-probe.',
        gates: results.map(result => ({
          command: result.command,
          passed: result.passed,
          status: result.status,
        })),
        integratedScenario: integrated,
      },
      null,
      2,
    ),
  )
  if (!passed) process.exitCode = 1
}

function runGate(root: string, gate: string): GateResult {
  const command = `pnpm ${gate}`
  const child = spawnSync('pnpm', [gate], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const output = `${child.stdout ?? ''}${child.stderr ?? ''}`
  const status = extractProbeStatus(output)
  return {
    command,
    passed: child.status === 0 && status.endsWith('_ok'),
    status,
    output,
  }
}

function extractProbeStatus(output: string): string {
  const matches = [...output.matchAll(/"status":\s*"([^"]+)"/g)]
  return matches[0]?.[1] ?? 'missing_status'
}

async function runIntegratedGovernanceScenario(workspaceRoot: string): Promise<{
  passed: boolean
  checks: IntegratedCheck[]
  artifacts: Record<string, string | undefined>
  modelObserved: Record<string, boolean>
}> {
  const root = path.join(
    workspaceRoot,
    '.vigilon',
    'probes',
    `phase25-governance-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  )
  const cwd = path.join(root, 'workspace')
  const sessionsDir = path.join(root, 'sessions')
  const modelObserved = {
    resumeSawSessionMemory: false,
    resumeSawCompactBoundary: false,
    resumeSawSubagentEvidence: false,
  }

  {
    await mkdir(path.join(cwd, 'src'), { recursive: true })
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await writeFile(path.join(cwd, 'src', 'math.ts'), 'export const calc = () => 41\n', 'utf8')
    await writeFile(path.join(cwd, 'src', 'app.ts'), 'import { calc } from "./math"\nconsole.log(calc())\n', 'utf8')
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
      [
        '---',
        'description: Project researcher for integrated governance probe',
        'maxTurns: 3',
        'memory: inherit',
        'allowedTools:',
        '  - Bash',
        '---',
        'You inspect repository evidence and return a concise handoff.',
      ].join('\n'),
      'utf8',
    )

    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'phase25-governance-main',
    })
    const modelClient = createIntegratedModel(modelObserved)
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      transcript,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript,
      }),
      permissionMode: 'bypass-local',
      stopAfterResultReport: false,
    })

    for await (const _event of runtime.runTurn({
      prompt: 'Investigate the temporary TypeScript repo with governed runtime semantics.',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      // Drain initial integrated turn.
    }

    const snapshot = await resumeSessionById({
      sessionId: transcript.sessionId,
      cwd,
      sessionsDir,
    })
    const ensuredMemory = await ensureFreshSessionMemory({
      snapshot,
      cwd,
      sessionsDir,
      trigger: 'compact',
      groundingModel: createIntegratedGroundingModel(),
      groundingValidatedAt: '2026-05-19T00:00:30Z',
    })
    const memoryPath = ensuredMemory.readiness.memoryPath
    if (!ensuredMemory.record?.content.trim()) {
      throw new Error('integrated governance scenario could not obtain session memory')
    }
    const memoryInspection = ensuredMemory.after

    const compactStore = new JsonlTranscriptStore({
      transcriptPath: snapshot.transcriptPath,
      sessionId: snapshot.sessionId,
    })
    const compactEvents = await compactStore.readAll()
    const contextBudget = resolveCompactContextWindowBudget({
      modelId: 'deepseek:deepseek-v4-flash',
      provider: 'deepseek',
      contextWindowTokens: 1_800,
      reservedOutputTokens: 200,
      reservedSystemTokens: 200,
      reservedToolSchemaTokens: 200,
      safetyMarginTokens: 200,
      pressureThreshold: 0.2,
    })
    const tokenPressure = estimateCompactTokenPressure(compactEvents, {
      contextBudget,
    })
    const compactBoundary = await compactTranscript({
      transcript: compactStore,
      summary: ensuredMemory.record.content,
      trigger: 'manual',
      querySource: 'main',
      reactiveEventCount: 12,
      sessionState: snapshot.sessionState,
      tokenPressure,
      memoryReadiness: ensuredMemory.readiness,
      cleanupState: {
        lspOpenFileState: new Set(['src/index.ts', 'src/util.ts']),
        readFileState: new Map([['src/index.ts', { fullRead: true }]]),
      },
    })

    const resumed = await resumeSessionById({
      sessionId: transcript.sessionId,
      cwd,
      sessionsDir,
    })
    const resumeTranscript = new JsonlTranscriptStore({
      transcriptPath: resumed.transcriptPath,
      sessionId: resumed.sessionId,
    })
    const resumeRuntime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      transcript: resumeTranscript,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript: resumeTranscript,
      }),
      permissionMode: 'bypass-local',
      resume: resumed,
      stopAfterResultReport: true,
    })
    let resumedFinal = ''
    for await (const event of resumeRuntime.runTurn({
      prompt: 'Resume and produce the final governance handoff.',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') resumedFinal = event.result.finalMessage
    }

    const finalSnapshot = await resumeSessionById({
      sessionId: transcript.sessionId,
      cwd,
      sessionsDir,
    })
    const parentEvents = finalSnapshot.events
    const subagentResult = parentEvents.find(
      event => event.type === 'tool-result' && event.result.metadata?.agentName === 'researcher',
    ) as Extract<TranscriptEvent, { type: 'tool-result' }> | undefined
    const subagentTranscriptPath = subagentResult?.result.metadata?.transcriptPath as string | undefined
	    const subagentEvents = subagentTranscriptPath
	      ? await readTranscriptFile(subagentTranscriptPath)
	      : []
	    const subagentPermissionSummary = buildPermissionOriginSummary(subagentEvents)
    const subagentLifecycleEvents = parentEvents
      .filter(event => event.type === 'subagent-lifecycle')
      .map(event => event.event)
    const checks: IntegratedCheck[] = [
      {
        name: 'main transcript exists with governed runtime events',
        passed:
          parentEvents.some(event => event.type === 'tool-call' && event.call.name === 'Agent') &&
          parentEvents.some(event => event.type === 'tool-call' && event.call.name === 'Bash') &&
          parentEvents.some(event => event.type === 'permission' && event.request.policy?.kind === 'bash-safety'),
        details: parentEvents.map(event => event.type),
      },
      {
        name: 'subagent transcript is linked and has task-host, permission, and sandbox metadata',
        passed:
          typeof subagentTranscriptPath === 'string' &&
          subagentResult?.result.metadata?.taskHost?.registeredWithTaskManager === true &&
          subagentResult.result.metadata.taskHost.stopPath === 'shared-task-manager' &&
	          subagentPermissionSummary.agents.some(
	            agent =>
	              agent.agentRole === 'subagent' &&
	              agent.parentAgentId === 'main',
	          ) &&
	          subagentEvents.some(event =>
            event.type === 'tool-result' &&
            (event.result.metadata?.sandboxRuntime as { requested?: unknown } | undefined)?.requested === true,
          ),
        details: {
	          subagentTranscriptPath,
	          taskHost: subagentResult?.result.metadata?.taskHost,
	          permissionSummary: subagentPermissionSummary,
	          eventTypes: subagentEvents.map(event => event.type),
          sandboxRuntime: subagentEvents.find(event => event.type === 'tool-result')
            ?.result.metadata?.sandboxRuntime,
        },
      },
      {
        name: 'main transcript records subagent lifecycle streaming events',
        passed:
          subagentLifecycleEvents.some(event => event.status === 'started') &&
          subagentLifecycleEvents.some(event => event.status === 'tool-started') &&
          subagentLifecycleEvents.some(event => event.status === 'tool-finished') &&
          subagentLifecycleEvents.some(
            event =>
              event.status === 'completed' &&
              event.taskId === subagentResult?.result.metadata?.taskHost?.taskId,
          ),
        details: subagentLifecycleEvents,
      },
      {
        name: 'session memory file has typed sections, semantic drift, and model grounding',
        passed:
          memoryInspection.exists &&
          memoryInspection.freshness === 'fresh' &&
          memoryInspection.semanticDrift?.status === 'none' &&
          memoryInspection.groundingValidation?.status === 'supported' &&
          memoryInspection.groundingValidation.modelId === 'phase25-governance-grounding-model' &&
          Boolean(memoryInspection.manifest?.sections.some(section => section.kind === 'current_task')) &&
          Boolean(memoryInspection.manifest?.semanticFingerprint.currentTaskHash) &&
          typeof memoryInspection.content === 'string' &&
          memoryInspection.content.includes('Current Task'),
        details: {
          memoryPath,
          freshness: memoryInspection.freshness,
          sourceEventCount: memoryInspection.sourceEventCount,
          sections: memoryInspection.manifest?.sections.map(section => section.kind),
          semanticDrift: memoryInspection.semanticDrift,
          groundingValidation: memoryInspection.groundingValidation,
          semanticFingerprint: memoryInspection.manifest?.semanticFingerprint,
        },
      },
      {
        name: 'compact boundary records route, extraction readiness, token pressure, and preserved segment',
        passed:
          compactBoundary.metadata.compactRoute?.strategy === 'session-memory' &&
          compactBoundary.metadata.memoryReadiness?.refreshed === true &&
          compactBoundary.metadata.memoryReadiness?.ready === true &&
          compactBoundary.metadata.memoryReadiness.validationRequired === true &&
          compactBoundary.metadata.memoryReadiness.blockingReasons.length === 0 &&
          compactBoundary.metadata.memoryReadiness.extraction?.status === 'completed' &&
          compactBoundary.metadata.memoryReadiness.extraction.trigger === 'compact' &&
          compactBoundary.metadata.memoryReadiness.groundingValidation?.status === 'supported' &&
          compactBoundary.metadata.tokenPressure?.reason === 'token_pressure_exceeded' &&
          compactBoundary.metadata.tokenPressure.tokenCountSource === 'provider-usage-plus-delta-estimate' &&
          compactBoundary.metadata.tokenPressure.contextBudget?.source === 'model-context-window' &&
          compactBoundary.metadata.tokenPressure.contextBudget.modelId === 'deepseek:deepseek-v4-flash' &&
          compactBoundary.metadata.tokenPressure.contextBudget.estimator.kind === 'provider-usage-plus-delta-estimate' &&
          Boolean(compactBoundary.metadata.preservedSegment) &&
          compactBoundary.metadata.preservedSegment?.eventRefStrategy === 'deterministic-event-fingerprint' &&
          Boolean(compactBoundary.metadata.preservedSegment.headEventRef?.eventId.match(UUID_LIKE_PATTERN)) &&
          Boolean(compactBoundary.metadata.preservedSegment.anchorEventRef?.eventId.match(UUID_LIKE_PATTERN)) &&
          Boolean(compactBoundary.metadata.preservedSegment.tailEventRef?.eventId.match(UUID_LIKE_PATTERN)) &&
          compactBoundary.metadata.postCompactCleanup?.completed === true &&
          Boolean(compactBoundary.metadata.postCompactCleanup.operations?.some(operation =>
            operation.target === 'lsp-open-file-state' &&
            operation.scope === 'main' &&
            operation.action === 'cleared' &&
            operation.policy === 'rebuild-after-compact' &&
            operation.afterCount === 0,
          )) &&
          Boolean(compactBoundary.metadata.postCompactCleanup.operations?.some(operation =>
            operation.target === 'read-file-state' &&
            operation.scope === 'main' &&
            operation.action === 'preserved' &&
            operation.policy === 'preserve-safety-state',
          )),
        details: {
          route: compactBoundary.metadata.compactRoute,
          memoryReadiness: compactBoundary.metadata.memoryReadiness,
          tokenPressure: compactBoundary.metadata.tokenPressure,
          preservedSegment: compactBoundary.metadata.preservedSegment,
          cleanup: compactBoundary.metadata.postCompactCleanup,
        },
      },
      {
        name: 'resume request saw memory, compact, and prior subagent evidence',
        passed:
          modelObserved.resumeSawSessionMemory &&
          modelObserved.resumeSawCompactBoundary &&
          modelObserved.resumeSawSubagentEvidence,
        details: modelObserved,
      },
      {
        name: 'runtime auto-compact preflights provider input tokens before first usage anchor',
        passed: modelObserved.inputTokenPreflight === true,
        details: modelObserved,
      },
      {
        name: 'final handoff records verification, unverified items, risks, and remaining todos',
        passed:
          resumedFinal.includes('Integrated governance handoff complete') &&
          finalSnapshot.sessionState.handoffReport?.verified.some(item => item.includes('subagent')) === true &&
          finalSnapshot.sessionState.handoffReport.unverified.length > 0 &&
          finalSnapshot.sessionState.handoffReport.risks.length > 0 &&
          finalSnapshot.sessionState.todos.length === 0,
        details: finalSnapshot.sessionState.handoffReport,
      },
    ]

    return {
      passed: checks.every(check => check.passed),
      checks,
      artifacts: {
        retained: 'true',
        cwd,
        transcriptPath: snapshot.transcriptPath,
        subagentTranscriptPath,
        memoryPath,
      },
      modelObserved,
    }
  }
}

function createIntegratedModel(observed: Record<string, boolean>): ModelClient {
  let subagentTurns = 0
  return {
    id: 'phase25-governance-model',
    async countInputTokens(request) {
      observed.inputTokenPreflight = true
      const inputTokens = Math.max(
        1,
        request.messages.length * 100 + request.tools.length * 10,
      )
      return {
        ok: true,
        source: 'provider-chat-completion-usage',
        inputTokens,
        usage: providerUsage(inputTokens, 1),
      }
    },
    async createMessage(request) {
      const isSubagent = request.messages.some(
        message =>
          message.type === 'user' &&
          message.content.includes('You are running as a focused local subagent.'),
      )
      if (isSubagent) {
        subagentTurns += 1
        if (subagentTurns === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'subagent-bash-1',
                name: 'Bash',
                input: {
                  command: 'grep -R -n "calc" src',
                  description: 'Inspect TypeScript calc references',
                },
              },
            ],
            stopReason: 'tool_use',
            usage: providerUsage(650, 25),
          }
        }
        return {
          content: 'Subagent found calc references in src/math.ts and src/app.ts.',
          toolCalls: [],
          stopReason: 'end_turn',
          usage: providerUsage(760, 35),
        }
      }

      if (request.messages.some(message => message.type === 'user' && message.content.includes('Resume and produce'))) {
        observed.resumeSawSessionMemory = request.messages.some(message =>
          message.type === 'user' && message.content.includes('<vigilon_session_memory'),
        )
        observed.resumeSawCompactBoundary = request.messages.some(message => message.type === 'compact-boundary')
        observed.resumeSawSubagentEvidence = request.messages.some(
          message =>
            message.type === 'tool-result' &&
            message.result.metadata?.agentName === 'researcher',
        )
        return {
          content: '',
          toolCalls: [
            {
              id: 'resume-result-1',
              name: 'ResultReport',
              input: {
                final_message: 'Integrated governance handoff complete: memory, compact, safety, and subagent evidence remained available after resume.',
                changes: ['Created integrated governance probe artifacts in a temporary TypeScript repo.'],
                verification_notes: [
	                  'Verified subagent transcript, permission origin, and parent-side origin summary.',
                  'Verified compact boundary and session memory after resume.',
                ],
                unverified: ['Provider-backed long-task transcript is still separate from this synthetic probe.'],
                risks: ['Cross-platform sandbox adapters and provider-backed long-task integration remain known gaps.'],
              },
            },
          ],
          stopReason: 'tool_use',
          usage: providerUsage(1_200, 80),
        }
      }

      const sawAgentResult = request.messages.some(
        message =>
          message.type === 'tool-result' &&
          message.result.metadata?.agentName === 'researcher',
      )
      const sawValidation = request.messages.some(
        message =>
          message.type === 'tool-result' &&
          message.result.content.includes('validation:ok'),
      )
      if (!sawAgentResult) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'main-agent-1',
              name: 'Agent',
              input: {
                agent: 'researcher',
                task: 'Inspect calc references and report files involved.',
              },
            },
          ],
          stopReason: 'tool_use',
          usage: providerUsage(900, 40),
        }
      }
      if (!sawValidation) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'main-bash-1',
              name: 'Bash',
              input: {
                command: 'node -e "console.log(\'validation:ok\')"',
                description: 'Run deterministic validation marker',
              },
            },
          ],
          stopReason: 'tool_use',
          usage: providerUsage(1_050, 50),
        }
      }
      return {
        content: 'Initial integrated governance pass complete.',
        toolCalls: [],
        stopReason: 'end_turn',
        usage: providerUsage(1_250, 60),
      }
    },
  }
}

function providerUsage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadInputTokens: Math.floor(inputTokens * 0.6),
    cacheCreationInputTokens: inputTokens - Math.floor(inputTokens * 0.6),
  }
}

function createIntegratedGroundingModel(): ModelClient {
  return {
    id: 'phase25-governance-grounding-model',
    async createMessage(request) {
      const prompt = request.messages[0]?.type === 'user' ? request.messages[0].content : ''
      return {
        content: JSON.stringify({
          status:
            prompt.includes('<session_memory>') &&
            prompt.includes('<current_transcript_evidence>')
              ? 'supported'
              : 'unknown',
          supportedClaims: ['Integrated governance session memory is grounded in transcript evidence.'],
          contradictedClaims: [],
          missingClaims: [],
          reason: 'Synthetic grounding model validated memory before compact boundary creation.',
        }),
        toolCalls: [],
        stopReason: 'end_turn',
      }
    },
  }
}

async function readTranscriptFile(filePath: string): Promise<TranscriptEvent[]> {
  const raw = await readFile(filePath, 'utf8')
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as TranscriptEvent)
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

await main()
