import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildSessionMemoryInjection,
  deleteSessionMemory,
  inspectSessionMemory,
  JsonlTranscriptStore,
  promoteLongTermMemory,
  readProjectMemoryManifest,
  readSessionMemory,
  readSessionMemoryExtractionStatus,
  resumeSessionById,
  runCli,
  scheduleSessionMemoryExtraction,
  type ModelClient,
} from '../src/index.js'

type ProbeCheck = {
  name: string
  passed: boolean
  details?: unknown
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase25-memory-'))
  const cwd = path.join(root, 'workspace')
  const sessionsDir = path.join(root, 'sessions')
  await mkdir(cwd, { recursive: true })

  try {
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'phase25-memory-probe',
    })
    await transcript.append({
      type: 'user',
      content: 'Build a governed memory lifecycle.',
      timestamp: '2026-05-19T00:00:00Z',
    })
    await transcript.append({
      type: 'assistant',
      content: 'Plan captured: create memory, resume, stale-check, delete.',
      timestamp: '2026-05-19T00:00:01Z',
    })

    const snapshot = await resumeSessionById({
      sessionId: transcript.sessionId,
      cwd,
      sessionsDir,
    })
    const scheduledExtraction = await scheduleSessionMemoryExtraction({
      snapshot,
      cwd,
      sessionsDir,
      trigger: 'probe',
      jobId: 'phase25-memory-probe-initial-extraction',
      queuedAt: '2026-05-19T00:00:01.500Z',
    })
    const extraction = await scheduledExtraction.completion
    const memoryPath = scheduledExtraction.job.memoryPath
    const memory = await readSessionMemory(memoryPath)
    if (!memory) {
      throw new Error('background extraction did not write session memory')
    }
    const extractionStatus = await readSessionMemoryExtractionStatus(memoryPath)

    const freshInspection = await inspectSessionMemory({
      snapshot,
      cwd,
      sessionsDir,
      includeContent: true,
    })
    const freshInjection = buildSessionMemoryInjection(memory, 'fresh')
    const groundingModel = createProbeGroundingModel()
    const groundedInspection = await inspectSessionMemory({
      snapshot,
      cwd,
      sessionsDir,
      includeContent: true,
      groundingModel,
      groundingValidatedAt: '2026-05-19T00:00:01.750Z',
    })

    await transcript.append({
      type: 'user',
      content: 'The task has moved forward after memory was generated.',
      timestamp: '2026-05-19T00:00:02Z',
    })
    const staleSnapshot = await resumeSessionById({
      sessionId: transcript.sessionId,
      cwd,
      sessionsDir,
    })
    const staleInspection = await inspectSessionMemory({
      snapshot: staleSnapshot,
      cwd,
      sessionsDir,
    })
    const staleMemory = await readSessionMemory(memoryPath)
    const staleInjection = staleMemory
      ? buildSessionMemoryInjection(staleMemory, 'stale')
      : null
    const validateCliIo = createProbeIo()
    const validateCliExitCode = await runCli(
      [
        'memory',
        'validate',
        transcript.sessionId,
        '--refresh',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      validateCliIo,
      {
        createModelClient: () => createProbeGroundingModel(),
      },
    )
    const validateCliOutput = JSON.parse(validateCliIo.stdoutText) as {
      validated?: boolean
      providerGrounded?: boolean
      readiness?: {
        ready?: boolean
        validationRequired?: boolean
        blockingReasons?: string[]
        refreshed?: boolean
        groundingValidation?: {
          status?: string
          modelId?: string
        }
      }
    }
    const promotion = await promoteLongTermMemory({
      cwd,
      kind: 'project',
      topic: 'runtime governance',
      content:
        'P2.5 memory must be manual, typed, file-backed, and auditable before it becomes long-term memory.',
      createdAt: '2026-05-19T00:00:03Z',
      source: {
        sessionId: staleSnapshot.sessionId,
        transcriptPath: staleSnapshot.transcriptPath,
        sourceEventCount: staleSnapshot.events.length,
      },
    })
    const rejectedPromotion = await promoteLongTermMemory({
      cwd,
      kind: 'project',
      topic: 'transient tool noise',
      content: 'Command failed with ENOENT while probing the workspace.',
      createdAt: '2026-05-19T00:00:04Z',
      source: {
        sessionId: staleSnapshot.sessionId,
        transcriptPath: staleSnapshot.transcriptPath,
        sourceEventCount: staleSnapshot.events.length,
      },
    })
    const projectMemoryManifest = await readProjectMemoryManifest(cwd)

    await deleteSessionMemory(memoryPath)
    const deletedInspection = await inspectSessionMemory({
      snapshot: staleSnapshot,
      cwd,
      sessionsDir,
    })

    const checks: ProbeCheck[] = [
    {
      name: 'memory file and manifest exist',
      passed:
        freshInspection.exists &&
        Boolean(freshInspection.manifest) &&
          freshInspection.manifest?.sourceLastEvent?.type === 'assistant' &&
          freshInspection.manifest.sections.some(section => section.kind === 'current_task') &&
          freshInspection.manifest.semanticFingerprint.currentTaskHash !== null,
      details: {
        sourceLastEvent: freshInspection.manifest?.sourceLastEvent,
        sections: freshInspection.manifest?.sections.map(section => section.kind),
        semanticFingerprint: freshInspection.manifest?.semanticFingerprint,
      },
    },
      {
        name: 'background extraction worker records terminal status',
        passed:
          scheduledExtraction.job.status === 'queued' &&
          extraction.status === 'completed' &&
          extractionStatus?.status === 'completed' &&
          extractionStatus.jobId === 'phase25-memory-probe-initial-extraction' &&
          extractionStatus.sourceEventCount === 2 &&
          extractionStatus.memoryPath === memoryPath &&
          extractionStatus.manifestPath === freshInspection.manifestPath,
        details: extractionStatus,
      },
      {
        name: 'fresh memory injects without drift caveat',
        passed:
          freshInspection.freshness === 'fresh' &&
          freshInjection.content.includes('freshness="fresh"') &&
          !freshInjection.content.includes('<vigilon_memory_drift_caveat>'),
      },
      {
        name: 'model-grounded memory validation records provider evidence',
        passed:
          groundedInspection.groundingValidation?.status === 'supported' &&
          groundedInspection.groundingValidation.modelId === 'phase25-memory-grounding-model' &&
          groundedInspection.groundingValidation.semanticDriftStatus === 'none' &&
          groundedInspection.groundingValidation.evidenceEventCount >= 1 &&
          groundedInspection.groundingValidation.supportedClaims.some(claim =>
            claim.includes('governed memory lifecycle'),
          ),
        details: groundedInspection.groundingValidation,
      },
      {
        name: 'memory validate CLI refreshes and gates provider-grounded readiness',
        passed:
          validateCliExitCode === 0 &&
          validateCliOutput.validated === true &&
          validateCliOutput.providerGrounded === true &&
          validateCliOutput.readiness?.ready === true &&
          validateCliOutput.readiness.validationRequired === true &&
          validateCliOutput.readiness.refreshed === true &&
          validateCliOutput.readiness.blockingReasons?.length === 0 &&
          validateCliOutput.readiness.groundingValidation?.status === 'supported' &&
          validateCliOutput.readiness.groundingValidation.modelId === 'phase25-memory-grounding-model',
        details: validateCliOutput,
      },
      {
        name: 'transcript growth marks memory stale',
        passed:
          staleInspection.freshness === 'stale' &&
          staleInspection.currentEventCount === 3 &&
          staleInspection.sourceEventCount === 2 &&
          Boolean(staleInspection.driftCaveat) &&
          staleInspection.semanticDrift?.status === 'changed' &&
          staleInspection.semanticDrift.changedAnchors.includes('current_task'),
        details: {
          driftCaveat: staleInspection.driftCaveat,
          semanticDrift: staleInspection.semanticDrift,
        },
      },
      {
        name: 'stale memory injection carries drift caveat',
        passed:
          staleInjection !== null &&
          staleInjection.content.includes('freshness="stale"') &&
          staleInjection.content.includes('<vigilon_memory_drift_caveat>'),
      },
      {
        name: 'manual long-term memory promotion writes typed auditable store',
        passed:
          promotion.promoted &&
          promotion.entry?.kind === 'project' &&
          promotion.entry.topic === 'runtime governance' &&
          promotion.entry.source.sessionId === staleSnapshot.sessionId &&
          projectMemoryManifest.entries.length === 1 &&
          projectMemoryManifest.entries[0]?.promotionDecision.status === 'allowed',
        details: {
          entry: promotion.entry,
          indexPath: promotion.manifest.indexPath,
          manifestPath: promotion.manifest.manifestPath,
        },
      },
      {
        name: 'long-term memory promotion rejects transient tool noise',
        passed:
          !rejectedPromotion.promoted &&
          rejectedPromotion.decision.status === 'rejected' &&
          rejectedPromotion.decision.rejectedCategories.includes('transient_execution_noise') &&
          rejectedPromotion.manifest.entries.length === 1,
        details: rejectedPromotion.decision,
      },
      {
        name: 'delete removes memory from future inspection',
        passed:
          !deletedInspection.exists &&
          deletedInspection.freshness === null &&
          (await readSessionMemory(memoryPath)) === null,
      },
    ]

    const passed = checks.every(check => check.passed)
    console.log(
      JSON.stringify(
        {
          phase: 'P2.5 Memory Runtime',
          status: passed ? 'memory_probe_ok' : 'memory_probe_failed',
          closureEvidence: false,
          scope:
            'Proves the current Memory Runtime slice: background extraction worker with terminal status, manifest, typed sections, semantic drift inspection, model-grounded memory validation metadata, memory validate CLI readiness gate, fresh/stale inspection, stale caveat injection, manual typed long-term memory promotion policy, and deletion. It does not prove full P2.5 closure.',
          cwd,
          sessionsDir,
          memoryPath,
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

function createProbeGroundingModel(): ModelClient {
  return {
    id: 'phase25-memory-grounding-model',
    async createMessage(request) {
      const prompt = request.messages[0]?.type === 'user' ? request.messages[0].content : ''
      return {
        content: JSON.stringify({
          status: prompt.includes('<session_memory>') &&
            prompt.includes('<current_transcript_evidence>')
            ? 'supported'
            : 'unknown',
          supportedClaims: ['The governed memory lifecycle task is present in transcript evidence.'],
          contradictedClaims: [],
          missingClaims: [],
          reason: 'Synthetic grounding model verified memory against bounded transcript evidence.',
        }),
        toolCalls: [],
        stopReason: 'end_turn',
        usage: {
          inputTokens: 256,
          outputTokens: 64,
          totalTokens: 320,
        },
      }
    },
  }
}

function createProbeIo() {
  const io = {
    stdoutText: '',
    stderrText: '',
    stdout: {
      write(chunk: string) {
        io.stdoutText += chunk
        return true
      },
    },
    stderr: {
      write(chunk: string) {
        io.stderrText += chunk
        return true
      },
    },
    env: {
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    },
  }
  return io
}

await main()
