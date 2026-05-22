import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createDeepSeekModelClient,
  ensureFreshSessionMemory,
  JsonlTranscriptStore,
  resumeSessionById,
} from '../src/index.js'
import type { CompactMemoryReadinessMetadata, MemoryGroundingValidationMetadata } from '../src/index.js'

type ProbeCheck = {
  name: string
  passed: boolean
  details?: unknown
}

type LiveProviderMemoryResult = {
  status: 'supported' | 'skipped-no-api-key' | 'inconclusive' | 'error'
  required: boolean
  modelId?: string
  readiness?: CompactMemoryReadinessMetadata
  validation?: MemoryGroundingValidationMetadata | null
  memoryPath?: string
  error?: string
}

async function main(): Promise<void> {
  const requireProvider = process.argv.includes('--require-provider')
  const result = await runLiveProviderMemoryCheck(requireProvider)
  const checks: ProbeCheck[] = [
    {
      name: requireProvider
        ? 'live DeepSeek provider supports session memory against transcript evidence'
        : 'live DeepSeek provider memory grounding is optional unless --require-provider is set',
      passed: requireProvider
        ? result.status === 'supported'
        : result.status === 'supported' ||
          result.status === 'skipped-no-api-key' ||
          result.status === 'inconclusive',
      details: result,
    },
  ]
  const passed = checks.every(check => check.passed)
  console.log(
    JSON.stringify(
      {
        phase: 'P2.5 Provider Memory Validation Runtime',
        status: passed ? 'provider_memory_probe_ok' : 'provider_memory_probe_failed',
        closureEvidence: requireProvider && result.status === 'supported',
        scope:
          'Validates the live provider-backed memory grounding path: session-memory extraction, DeepSeek model validation against bounded transcript evidence, provider usage metadata, and compact readiness gate metadata. Without --require-provider it is observational and may skip when no API key is present.',
        checks,
      },
      null,
      2,
    ),
  )
  if (!passed) process.exitCode = 1
}

async function runLiveProviderMemoryCheck(
  required: boolean,
): Promise<LiveProviderMemoryResult> {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { status: 'skipped-no-api-key', required }
  }

  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase25-provider-memory-'))
  const cwd = path.join(root, 'workspace')
  const sessionsDir = path.join(root, 'sessions')
  try {
    await mkdir(cwd, { recursive: true })
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'phase25-provider-memory',
    })
    await transcript.append({
      type: 'user',
      content: 'Validate provider-grounded session memory before compact readiness.',
      timestamp: '2026-05-22T00:00:00Z',
    })
    await transcript.append({
      type: 'assistant',
      content:
        'The P2.5 memory gate must use provider evidence before trusting session memory for compact.',
      timestamp: '2026-05-22T00:00:01Z',
    })
    await transcript.append({
      type: 'user',
      content:
        'Next step: only compact with session memory when readiness.ready is true and validation is supported.',
      timestamp: '2026-05-22T00:00:02Z',
    })
    const snapshot = await resumeSessionById({
      sessionId: transcript.sessionId,
      cwd,
      sessionsDir,
    })
    const model = createDeepSeekModelClient()
    const ensured = await withTimeout(
      ensureFreshSessionMemory({
        snapshot,
        cwd,
        sessionsDir,
        trigger: 'probe',
        groundingModel: model,
      }),
      90_000,
    )
    const validation = ensured.after.groundingValidation
    const providerUsagePresent =
      (validation?.usage?.inputTokens ?? 0) > 0 ||
      (validation?.usage?.totalTokens ?? 0) > 0
    const readinessOk =
      ensured.readiness.ready === true &&
      ensured.readiness.validationRequired === true &&
      ensured.readiness.blockingReasons.length === 0
    if (validation?.status === 'supported' && providerUsagePresent && readinessOk) {
      return {
        status: 'supported',
        required,
        modelId: model.id,
        readiness: ensured.readiness,
        validation,
        memoryPath: ensured.readiness.memoryPath,
      }
    }
    return {
      status: 'inconclusive',
      required,
      modelId: model.id,
      readiness: ensured.readiness,
      validation,
      memoryPath: ensured.readiness.memoryPath,
    }
  } catch (error) {
    return {
      status: 'error',
      required,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`provider memory validation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
