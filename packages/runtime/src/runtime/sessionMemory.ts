import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type {
  CompactMemoryReadinessMetadata,
  MemoryGroundingValidationMetadata,
  ModelClient,
  RuntimeSessionSnapshot,
  TranscriptEvent,
} from './contracts.js'
import { getTranscriptPath } from './transcript.js'

const SESSION_MEMORY_HEADER_PREFIX = '<!-- vigilon_session_memory '
const SESSION_MEMORY_HEADER_SUFFIX = ' -->'
const SESSION_MEMORY_MANIFEST_VERSION = 1
const SESSION_MEMORY_EXTRACTION_VERSION = 1

export type SessionMemoryFreshness = 'fresh' | 'stale'
export type SessionMemorySectionKind =
  | 'current_task'
  | 'current_state'
  | 'todo_state'
  | 'verification_notes'
  | 'important_files'
  | 'next_step'
  | 'unknown'

export type SessionMemoryRecord = {
  sessionId: string
  generatedAt: string
  sourceEventCount: number
  content: string
}

export type SessionMemoryTypedSection = {
  kind: SessionMemorySectionKind
  heading: string
  content: string
}

export type SessionMemorySemanticFingerprint = {
  version: 1
  currentTaskHash: string | null
  currentStateHash: string | null
  todoStateHash: string | null
  verificationHash: string | null
  importantFilesHash: string | null
  sectionHash: string
}

export type SessionMemorySemanticDrift = {
  status: 'none' | 'changed' | 'unknown'
  changedAnchors: Array<
    | 'current_task'
    | 'current_state'
    | 'todo_state'
    | 'verification_notes'
    | 'important_files'
  >
  reason: string
  baseline?: SessionMemorySemanticFingerprint
  current?: SessionMemorySemanticFingerprint
}

export type SessionMemoryEventPointer = {
  index: number
  type: TranscriptEvent['type']
  timestamp?: string
}

export type SessionMemoryManifest = {
  version: typeof SESSION_MEMORY_MANIFEST_VERSION
  kind: 'vigilon.session-memory'
  sessionId: string
  memoryPath: string
  manifestPath: string
  transcriptPath: string
  generatedAt: string
  sourceEventCount: number
  sourceLastEvent: SessionMemoryEventPointer | null
  freshnessAtWrite: 'fresh'
  sections: SessionMemoryTypedSection[]
  semanticFingerprint: SessionMemorySemanticFingerprint
}

export type SessionMemoryInspection = {
  exists: boolean
  sessionId: string
  memoryPath: string
  manifestPath: string
  transcriptPath: string
  currentEventCount: number
  sourceEventCount: number | null
  generatedAt: string | null
  freshness: SessionMemoryFreshness | null
  driftCaveat: string | null
  semanticDrift: SessionMemorySemanticDrift | null
  groundingValidation: MemoryGroundingValidationMetadata | null
  sourceLastEvent: SessionMemoryEventPointer | null
  manifest: SessionMemoryManifest | null
  content?: string
}

export type SessionMemoryExtractionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type SessionMemoryExtractionTrigger =
  | 'manual'
  | 'compact'
  | 'auto'
  | 'runtime'
  | 'probe'

export type SessionMemoryExtractionRecord = {
  version: typeof SESSION_MEMORY_EXTRACTION_VERSION
  kind: 'vigilon.session-memory-extraction'
  jobId: string
  sessionId: string
  status: SessionMemoryExtractionStatus
  trigger: SessionMemoryExtractionTrigger
  queuedAt: string
  startedAt?: string
  completedAt?: string
  transcriptPath: string
  memoryPath: string
  manifestPath: string
  statusPath: string
  sourceEventCount: number
  sourceLastEvent: SessionMemoryEventPointer | null
  freshnessBefore: SessionMemoryFreshness | null
  outputSummary?: string
  errorMessage?: string
}

export type ScheduledSessionMemoryExtraction = {
  job: SessionMemoryExtractionRecord
  statusPath: string
  completion: Promise<SessionMemoryExtractionRecord>
}

export type EnsuredSessionMemory = {
  record: SessionMemoryRecord | null
  before: SessionMemoryInspection
  after: SessionMemoryInspection
  refreshed: boolean
  extraction: SessionMemoryExtractionRecord | null
  readiness: CompactMemoryReadinessMetadata
}

export function getSessionMemoryPath(options: {
  sessionId: string
  cwd: string
  sessionsDir?: string
  transcriptPath?: string
}): string {
  if (options.transcriptPath) {
    return options.transcriptPath.replace(/\.jsonl$/, '.memory.md')
  }
  return getTranscriptPath({
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    sessionId: options.sessionId,
  }).replace(/\.jsonl$/, '.memory.md')
}

export function getSessionMemoryManifestPath(memoryPath: string): string {
  return memoryPath.endsWith('.memory.md')
    ? `${memoryPath.slice(0, -'.memory.md'.length)}.memory.manifest.json`
    : `${memoryPath}.manifest.json`
}

export function getSessionMemoryExtractionPath(memoryPath: string): string {
  return memoryPath.endsWith('.memory.md')
    ? `${memoryPath.slice(0, -'.memory.md'.length)}.memory.extraction.json`
    : `${memoryPath}.extraction.json`
}

export async function writeSessionMemory(
  filePath: string,
  record: SessionMemoryRecord,
  options: {
    transcriptPath?: string
    sourceLastEvent?: SessionMemoryEventPointer | null
  } = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const metadata = JSON.stringify({
    sessionId: record.sessionId,
    generatedAt: record.generatedAt,
    sourceEventCount: record.sourceEventCount,
  })
  const content = [
    `${SESSION_MEMORY_HEADER_PREFIX}${metadata}${SESSION_MEMORY_HEADER_SUFFIX}`,
    record.content.trim(),
    '',
  ].join('\n')
  await writeFile(filePath, content, 'utf8')

  const manifestPath = getSessionMemoryManifestPath(filePath)
  const manifest: SessionMemoryManifest = {
    version: SESSION_MEMORY_MANIFEST_VERSION,
    kind: 'vigilon.session-memory',
    sessionId: record.sessionId,
    memoryPath: filePath,
    manifestPath,
    transcriptPath: options.transcriptPath ?? filePath.replace(/\.memory\.md$/, '.jsonl'),
    generatedAt: record.generatedAt,
    sourceEventCount: record.sourceEventCount,
    sourceLastEvent: options.sourceLastEvent ?? null,
    freshnessAtWrite: 'fresh',
    sections: parseSessionMemorySections(record.content),
    semanticFingerprint: buildSessionMemorySemanticFingerprint(record.content),
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function readSessionMemory(
  filePath: string,
): Promise<SessionMemoryRecord | null> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }

  const [headerLine = '', ...rest] = raw.split(/\r?\n/)
  if (
    !headerLine.startsWith(SESSION_MEMORY_HEADER_PREFIX) ||
    !headerLine.endsWith(SESSION_MEMORY_HEADER_SUFFIX)
  ) {
    return null
  }
  const metadata = JSON.parse(
    headerLine.slice(
      SESSION_MEMORY_HEADER_PREFIX.length,
      headerLine.length - SESSION_MEMORY_HEADER_SUFFIX.length,
    ),
  ) as Omit<SessionMemoryRecord, 'content'>

  return {
    ...metadata,
    content: rest.join('\n').trim(),
  }
}

export async function readSessionMemoryManifest(
  memoryPath: string,
): Promise<SessionMemoryManifest | null> {
  const manifestPath = getSessionMemoryManifestPath(memoryPath)
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  const parsed = JSON.parse(raw) as SessionMemoryManifest
  if (
    parsed.version !== SESSION_MEMORY_MANIFEST_VERSION ||
    parsed.kind !== 'vigilon.session-memory'
  ) {
    return null
  }
  return parsed
}

export async function readSessionMemoryExtractionStatus(
  memoryPath: string,
): Promise<SessionMemoryExtractionRecord | null> {
  const statusPath = getSessionMemoryExtractionPath(memoryPath)
  let raw: string
  try {
    raw = await readFile(statusPath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  const parsed = JSON.parse(raw) as SessionMemoryExtractionRecord
  if (
    parsed.version !== SESSION_MEMORY_EXTRACTION_VERSION ||
    parsed.kind !== 'vigilon.session-memory-extraction'
  ) {
    return null
  }
  return parsed
}

export async function deleteSessionMemory(memoryPath: string): Promise<void> {
  await Promise.all([
    rm(memoryPath, { force: true }),
    rm(getSessionMemoryManifestPath(memoryPath), { force: true }),
    rm(getSessionMemoryExtractionPath(memoryPath), { force: true }),
  ])
}

export async function scheduleSessionMemoryExtraction(options: {
  snapshot: RuntimeSessionSnapshot
  cwd: string
  sessionsDir?: string
  trigger?: SessionMemoryExtractionTrigger
  force?: boolean
  queuedAt?: string
  jobId?: string
}): Promise<ScheduledSessionMemoryExtraction> {
  const transcriptPath =
    options.snapshot.transcriptPath ??
    getTranscriptPath({
      cwd: options.cwd,
      sessionsDir: options.sessionsDir,
      sessionId: options.snapshot.sessionId,
    })
  const memoryPath = getSessionMemoryPath({
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    sessionId: options.snapshot.sessionId,
    transcriptPath,
  })
  const manifestPath = getSessionMemoryManifestPath(memoryPath)
  const statusPath = getSessionMemoryExtractionPath(memoryPath)
  const existing = await readSessionMemory(memoryPath)
  const freshnessBefore = existing
    ? isSessionMemoryFresh(existing, options.snapshot.events.length)
      ? 'fresh'
      : 'stale'
    : null
  const queuedAt = options.queuedAt ?? new Date().toISOString()
  const sourceEventCount = options.snapshot.events.length
  const sourceLastEvent = getSessionMemoryEventPointer(
    options.snapshot.events,
    sourceEventCount,
  )
  const job: SessionMemoryExtractionRecord = {
    version: SESSION_MEMORY_EXTRACTION_VERSION,
    kind: 'vigilon.session-memory-extraction',
    jobId:
      options.jobId ??
      `${options.snapshot.sessionId}:${queuedAt}:${sourceEventCount}`,
    sessionId: options.snapshot.sessionId,
    status: 'queued',
    trigger: options.trigger ?? 'manual',
    queuedAt,
    transcriptPath,
    memoryPath,
    manifestPath,
    statusPath,
    sourceEventCount,
    sourceLastEvent,
    freshnessBefore,
  }
  await writeSessionMemoryExtractionStatus(job)

  const completion = runSessionMemoryExtraction(job, {
    snapshot: options.snapshot,
    force: options.force ?? true,
  })

  return {
    job,
    statusPath,
    completion,
  }
}

export async function ensureFreshSessionMemory(options: {
  snapshot: RuntimeSessionSnapshot
  cwd: string
  sessionsDir?: string
  trigger?: SessionMemoryExtractionTrigger
  groundingModel?: ModelClient
  groundingValidatedAt?: string
}): Promise<EnsuredSessionMemory> {
  const before = await inspectSessionMemory({
    snapshot: options.snapshot,
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    includeContent: true,
  })
  if (before.exists && before.freshness === 'fresh' && before.content?.trim()) {
    const extraction = await readSessionMemoryExtractionStatus(before.memoryPath)
    const after = options.groundingModel
      ? await inspectSessionMemory({
          snapshot: options.snapshot,
          cwd: options.cwd,
          sessionsDir: options.sessionsDir,
          includeContent: true,
          groundingModel: options.groundingModel,
          groundingValidatedAt: options.groundingValidatedAt,
        })
      : before
    return {
      record: await readSessionMemory(before.memoryPath),
      before,
      after,
      refreshed: false,
      extraction,
      readiness: buildCompactMemoryReadiness({
        before,
        after,
        refreshed: false,
        extraction,
      }),
    }
  }

  const scheduled = await scheduleSessionMemoryExtraction({
    snapshot: options.snapshot,
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    trigger: options.trigger ?? 'compact',
    force: true,
  })
  const extraction = await scheduled.completion
  const after = await inspectSessionMemory({
    snapshot: options.snapshot,
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    includeContent: true,
    groundingModel: options.groundingModel,
    groundingValidatedAt: options.groundingValidatedAt,
  })
  return {
    record: await readSessionMemory(scheduled.job.memoryPath),
    before,
    after,
    refreshed: true,
    extraction,
    readiness: buildCompactMemoryReadiness({
      before,
      after,
      refreshed: true,
      extraction,
    }),
  }
}

export function isSessionMemoryFresh(
  memory: SessionMemoryRecord,
  eventCount: number,
): boolean {
  return memory.sourceEventCount === eventCount
}

export function getSessionMemoryEventPointer(
  events: readonly TranscriptEvent[],
  eventCount: number,
): SessionMemoryEventPointer | null {
  const index = eventCount - 1
  const event = events[index]
  if (!event) return null
  return {
    index,
    type: event.type,
    timestamp: 'timestamp' in event ? event.timestamp : undefined,
  }
}

export function generateSessionMemoryFromSnapshot(
  snapshot: RuntimeSessionSnapshot,
): SessionMemoryRecord {
  const latestUserMessage =
    [...snapshot.events]
      .reverse()
      .find((event): event is Extract<TranscriptEvent, { type: 'user' }> => event.type === 'user')
      ?.content ?? 'Unknown task'

  const importantFiles = collectRecentFilePaths(snapshot.events)
  const todos =
    snapshot.sessionState.todos.length > 0
      ? snapshot.sessionState.todos
          .map(todo => `- [${todo.status}] ${todo.content}`)
          .join('\n')
      : '- None'
  const verificationNotes =
    snapshot.sessionState.verificationNotes.length > 0
      ? snapshot.sessionState.verificationNotes.map(note => `- ${note}`).join('\n')
      : '- None'
  const nextStep = deriveSessionMemoryNextStep(snapshot, latestUserMessage)

  const content = [
    '## Current Task',
    latestUserMessage,
    '',
    '## Current State',
    snapshot.sessionState.approvedPlan ?? 'No approved plan yet.',
    '',
    '## Todo State',
    todos,
    '',
    '## Verification Notes',
    verificationNotes,
    '',
    '## Important Files',
    importantFiles.length > 0 ? importantFiles.map(file => `- ${file}`).join('\n') : '- None',
    '',
    '## Next Step',
    nextStep,
  ].join('\n')

  return {
    sessionId: snapshot.sessionId,
    generatedAt: new Date().toISOString(),
    sourceEventCount: snapshot.events.length,
    content,
  }
}

function deriveSessionMemoryNextStep(
  snapshot: RuntimeSessionSnapshot,
  latestUserMessage: string,
): string {
  const activeTodo = snapshot.sessionState.todos.find(todo => todo.status === 'in_progress')
  if (activeTodo) {
    return `Continue active todo: ${activeTodo.activeForm ?? activeTodo.content}`
  }
  const pendingTodo = snapshot.sessionState.todos.find(todo => todo.status === 'pending')
  if (pendingTodo) {
    return `Start pending todo: ${pendingTodo.content}`
  }
  if (snapshot.sessionState.pendingPlan?.trim()) {
    return `Review pending plan: ${snapshot.sessionState.pendingPlan.trim()}`
  }
  if (latestUserMessage.trim() && latestUserMessage !== 'Unknown task') {
    return `Continue from latest user request: ${latestUserMessage.trim()}`
  }
  return 'Continue from the latest transcript-backed state.'
}

async function runSessionMemoryExtraction(
  job: SessionMemoryExtractionRecord,
  options: {
    snapshot: RuntimeSessionSnapshot
    force: boolean
  },
): Promise<SessionMemoryExtractionRecord> {
  const started: SessionMemoryExtractionRecord = {
    ...job,
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  await writeSessionMemoryExtractionStatus(started)

  try {
    if (!options.force && job.freshnessBefore === 'fresh') {
      const skipped: SessionMemoryExtractionRecord = {
        ...started,
        status: 'skipped',
        completedAt: new Date().toISOString(),
        outputSummary:
          'Session memory was already fresh for the current transcript event count.',
      }
      await writeSessionMemoryExtractionStatus(skipped)
      return skipped
    }

    const memory = generateSessionMemoryFromSnapshot(options.snapshot)
    await writeSessionMemory(job.memoryPath, memory, {
      transcriptPath: job.transcriptPath,
      sourceLastEvent: job.sourceLastEvent,
    })
    const completed: SessionMemoryExtractionRecord = {
      ...started,
      status: 'completed',
      completedAt: new Date().toISOString(),
      sourceEventCount: memory.sourceEventCount,
      sourceLastEvent: getSessionMemoryEventPointer(
        options.snapshot.events,
        memory.sourceEventCount,
      ),
      outputSummary:
        `Wrote session memory from ${memory.sourceEventCount} transcript events.`,
    }
    await writeSessionMemoryExtractionStatus(completed)
    return completed
  } catch (error) {
    const failed: SessionMemoryExtractionRecord = {
      ...started,
      status: 'failed',
      completedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    }
    await writeSessionMemoryExtractionStatus(failed)
    return failed
  }
}

async function writeSessionMemoryExtractionStatus(
  status: SessionMemoryExtractionRecord,
): Promise<void> {
  await mkdir(path.dirname(status.statusPath), { recursive: true })
  const tempPath = `${status.statusPath}.${status.status}.${Date.now()}.tmp`
  await writeFile(tempPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8')
  await rename(tempPath, status.statusPath)
}

export function buildCompactMemoryReadiness(options: {
  before: SessionMemoryInspection
  after: SessionMemoryInspection
  refreshed: boolean
  extraction: SessionMemoryExtractionRecord | null
}): CompactMemoryReadinessMetadata {
  const blockingReasons = collectCompactMemoryReadinessBlockingReasons(options)
  return {
    before: options.before.freshness,
    after: options.after.freshness,
    ready: blockingReasons.length === 0,
    blockingReasons,
    validationRequired: Boolean(options.after.groundingValidation),
    refreshed: options.refreshed,
    memoryPath: options.after.memoryPath,
    manifestPath: options.after.manifestPath,
    ...(options.after.groundingValidation
      ? { groundingValidation: options.after.groundingValidation }
      : {}),
    ...(options.extraction
      ? {
          extraction: {
            jobId: options.extraction.jobId,
            status: options.extraction.status,
            trigger: options.extraction.trigger,
            queuedAt: options.extraction.queuedAt,
            ...(options.extraction.startedAt ? { startedAt: options.extraction.startedAt } : {}),
            ...(options.extraction.completedAt ? { completedAt: options.extraction.completedAt } : {}),
            statusPath: options.extraction.statusPath,
            sourceEventCount: options.extraction.sourceEventCount,
            ...(options.extraction.outputSummary
              ? { outputSummary: options.extraction.outputSummary }
              : {}),
            ...(options.extraction.errorMessage
              ? { errorMessage: options.extraction.errorMessage }
              : {}),
          },
        }
      : {}),
  }
}

function collectCompactMemoryReadinessBlockingReasons(options: {
  after: SessionMemoryInspection
  extraction: SessionMemoryExtractionRecord | null
}): string[] {
  const reasons: string[] = []
  if (!options.after.exists) {
    reasons.push('session_memory_missing')
  }
  if (options.after.freshness !== 'fresh') {
    reasons.push('session_memory_not_fresh')
  }
  if (!options.after.manifest) {
    reasons.push('session_memory_manifest_missing')
  }
  if (options.extraction?.status === 'failed') {
    reasons.push('session_memory_extraction_failed')
  }
  const grounding = options.after.groundingValidation
  if (grounding && grounding.status !== 'supported') {
    reasons.push(`session_memory_grounding_${grounding.status}`)
  }
  return reasons
}

export function buildSessionMemoryInjection(
  memory: SessionMemoryRecord,
  freshness: SessionMemoryFreshness,
): Extract<TranscriptEvent, { type: 'user' }> {
  const driftLines =
    freshness === 'stale'
      ? [
          '<vigilon_memory_drift_caveat>',
          buildSessionMemoryDriftCaveat(memory),
          '</vigilon_memory_drift_caveat>',
        ]
      : []
  return {
    type: 'user',
    content: [
      `<vigilon_session_memory source="manual" freshness="${freshness}" session_id="${escapeAttribute(memory.sessionId)}">`,
      ...driftLines,
      memory.content,
      '</vigilon_session_memory>',
    ].join('\n'),
    timestamp: memory.generatedAt,
  }
}

export async function inspectSessionMemory(options: {
  snapshot: RuntimeSessionSnapshot
  cwd: string
  sessionsDir?: string
  includeContent?: boolean
  groundingModel?: ModelClient
  groundingValidatedAt?: string
}): Promise<SessionMemoryInspection> {
  const transcriptPath =
    options.snapshot.transcriptPath ??
    getTranscriptPath({
      cwd: options.cwd,
      sessionsDir: options.sessionsDir,
      sessionId: options.snapshot.sessionId,
    })
  const memoryPath = getSessionMemoryPath({
    cwd: options.cwd,
    sessionsDir: options.sessionsDir,
    sessionId: options.snapshot.sessionId,
    transcriptPath,
  })
  const manifestPath = getSessionMemoryManifestPath(memoryPath)
  const record = await readSessionMemory(memoryPath)
  const manifest = await readSessionMemoryManifest(memoryPath)
  if (!record) {
    return {
      exists: false,
      sessionId: options.snapshot.sessionId,
      memoryPath,
      manifestPath,
      transcriptPath,
      currentEventCount: options.snapshot.events.length,
      sourceEventCount: null,
      generatedAt: null,
      freshness: null,
      driftCaveat: null,
      semanticDrift: null,
      groundingValidation: null,
      sourceLastEvent: null,
      manifest,
    }
  }

  const fresh = isSessionMemoryFresh(record, options.snapshot.events.length)
  const semanticDrift = inspectSessionMemorySemanticDrift({
    record,
    manifest,
    snapshot: options.snapshot,
  })
  const groundingValidation = options.groundingModel
    ? await validateSessionMemoryGrounding({
        snapshot: options.snapshot,
        record,
        manifest,
        semanticDrift,
        model: options.groundingModel,
        validatedAt: options.groundingValidatedAt,
      })
    : null
  return {
    exists: true,
    sessionId: record.sessionId,
    memoryPath,
    manifestPath,
    transcriptPath,
    currentEventCount: options.snapshot.events.length,
    sourceEventCount: record.sourceEventCount,
    generatedAt: record.generatedAt,
    freshness: fresh ? 'fresh' : 'stale',
    driftCaveat: fresh
      ? null
      : buildSessionMemoryDriftCaveat(
          record,
          options.snapshot.events.length,
          semanticDrift,
        ),
    semanticDrift,
    groundingValidation,
    sourceLastEvent:
      manifest?.sourceLastEvent ??
      getSessionMemoryEventPointer(options.snapshot.events, record.sourceEventCount),
    manifest,
    ...(options.includeContent ? { content: record.content } : {}),
  }
}

export async function validateSessionMemoryGrounding(options: {
  snapshot: RuntimeSessionSnapshot
  record: SessionMemoryRecord
  manifest?: SessionMemoryManifest | null
  semanticDrift?: SessionMemorySemanticDrift | null
  model: ModelClient
  validatedAt?: string
  abortSignal?: AbortSignal
}): Promise<MemoryGroundingValidationMetadata> {
  const validatedAt = options.validatedAt ?? new Date().toISOString()
  const semanticDrift =
    options.semanticDrift ??
    inspectSessionMemorySemanticDrift({
      record: options.record,
      manifest: options.manifest ?? null,
      snapshot: options.snapshot,
    })
  const evidence = selectSessionMemoryGroundingEvidence(
    options.snapshot.events,
    options.record.sourceEventCount,
  )
  const base = {
    kind: 'vigilon.session-memory-grounding' as const,
    version: 1 as const,
    modelId: options.model.id,
    validatedAt,
    memorySourceEventCount: options.record.sourceEventCount,
    currentEventCount: options.snapshot.events.length,
    semanticDriftStatus: semanticDrift.status,
    changedAnchors: semanticDrift.changedAnchors,
    evidenceEventCount: evidence.length,
  }

  try {
    const response = await options.model.createMessage({
      messages: [
        {
          type: 'user',
          timestamp: validatedAt,
          content: buildSessionMemoryGroundingPrompt({
            record: options.record,
            snapshot: options.snapshot,
            semanticDrift,
            evidence,
          }),
        },
      ],
      tools: [],
      toolChoice: 'none',
      abortSignal: options.abortSignal ?? new AbortController().signal,
    })
    const parsed = parseModelJsonObject(response.content)
    return normalizeSessionMemoryGroundingValidation(parsed, {
      ...base,
      usage: response.usage,
    })
  } catch (error) {
    return {
      ...base,
      status: 'unknown',
      supportedClaims: [],
      contradictedClaims: [],
      missingClaims: [],
      reason:
        error instanceof Error
          ? `model_validation_error: ${error.message}`
          : `model_validation_error: ${String(error)}`,
    }
  }
}

function buildSessionMemoryDriftCaveat(
  memory: SessionMemoryRecord,
  currentEventCount?: number,
  semanticDrift?: SessionMemorySemanticDrift | null,
): string {
  const current =
    currentEventCount === undefined
      ? 'the current transcript event count is unknown'
      : `the current transcript has ${currentEventCount} events`
  const semantic =
    semanticDrift?.status === 'changed'
      ? ` Semantic drift detected in: ${semanticDrift.changedAnchors.join(', ')}.`
      : semanticDrift?.status === 'none'
        ? ' Semantic anchors still match the current generated memory view.'
        : ' Semantic drift could not be fully evaluated.'
  return `This session memory may be outdated because it was generated from ${memory.sourceEventCount} transcript events and ${current}.${semantic} Treat it as orientation, then verify against the current transcript before relying on facts.`
}

export function parseSessionMemorySections(content: string): SessionMemoryTypedSection[] {
  const sections: SessionMemoryTypedSection[] = []
  let currentHeading: string | null = null
  let currentLines: string[] = []

  const flush = (): void => {
    if (!currentHeading) return
    sections.push({
      kind: classifySessionMemoryHeading(currentHeading),
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
    })
  }

  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1]?.trim()
    if (heading) {
      flush()
      currentHeading = heading
      currentLines = []
      continue
    }
    if (currentHeading) currentLines.push(line)
  }
  flush()
  return sections
}

export function buildSessionMemorySemanticFingerprint(
  content: string,
): SessionMemorySemanticFingerprint {
  const sections = parseSessionMemorySections(content)
  const byKind = new Map<SessionMemorySectionKind, string>()
  for (const section of sections) {
    if (!byKind.has(section.kind)) byKind.set(section.kind, section.content)
  }
  const anchor = (kind: SessionMemorySectionKind): string | null => {
    const value = normalizeSemanticText(byKind.get(kind) ?? '')
    return value ? hashText(value) : null
  }
  return {
    version: 1,
    currentTaskHash: anchor('current_task'),
    currentStateHash: anchor('current_state'),
    todoStateHash: anchor('todo_state'),
    verificationHash: anchor('verification_notes'),
    importantFilesHash: anchor('important_files'),
    sectionHash: hashText(
      sections
        .map(section => `${section.kind}:${normalizeSemanticText(section.content)}`)
        .join('\n'),
    ),
  }
}

function inspectSessionMemorySemanticDrift(options: {
  record: SessionMemoryRecord
  manifest: SessionMemoryManifest | null
  snapshot: RuntimeSessionSnapshot
}): SessionMemorySemanticDrift {
  const baseline =
    options.manifest?.semanticFingerprint ??
    buildSessionMemorySemanticFingerprint(options.record.content)
  const current = buildSessionMemorySemanticFingerprint(
    generateSessionMemoryFromSnapshot(options.snapshot).content,
  )
  const changedAnchors: SessionMemorySemanticDrift['changedAnchors'] = []
  if (baseline.currentTaskHash !== current.currentTaskHash) changedAnchors.push('current_task')
  if (baseline.currentStateHash !== current.currentStateHash) changedAnchors.push('current_state')
  if (baseline.todoStateHash !== current.todoStateHash) changedAnchors.push('todo_state')
  if (baseline.verificationHash !== current.verificationHash) changedAnchors.push('verification_notes')
  if (baseline.importantFilesHash !== current.importantFilesHash) changedAnchors.push('important_files')

  if (changedAnchors.length === 0) {
    return {
      status: 'none',
      changedAnchors,
      reason: 'typed session-memory semantic anchors match the current generated memory view',
      baseline,
      current,
    }
  }
  return {
    status: 'changed',
    changedAnchors,
    reason: 'typed session-memory semantic anchors differ from the current generated memory view',
    baseline,
    current,
  }
}

function buildSessionMemoryGroundingPrompt(options: {
  record: SessionMemoryRecord
  snapshot: RuntimeSessionSnapshot
  semanticDrift: SessionMemorySemanticDrift
  evidence: Array<{ index: number; event: TranscriptEvent }>
}): string {
  return [
    'Validate this Vigilon session memory against the current transcript evidence.',
    'Return one JSON object only. Do not include markdown or prose.',
    'Use status "supported" when all concrete memory claims are still supported by the evidence.',
    'Use status "contradicted" when any concrete memory claim conflicts with newer evidence.',
    'Use status "unknown" when the evidence is insufficient or the memory is too vague to verify.',
    'JSON shape: {"status":"supported|contradicted|unknown","supportedClaims":["..."],"contradictedClaims":["..."],"missingClaims":["..."],"reason":"..."}',
    '',
    `Session ID: ${options.record.sessionId}`,
    `Memory source event count: ${options.record.sourceEventCount}`,
    `Current event count: ${options.snapshot.events.length}`,
    `Local semantic drift: ${options.semanticDrift.status}`,
    `Changed anchors: ${options.semanticDrift.changedAnchors.join(', ') || 'none'}`,
    '',
    '<session_memory>',
    options.record.content,
    '</session_memory>',
    '',
    '<current_transcript_evidence>',
    options.evidence
      .map(item => renderSessionMemoryGroundingEvidence(item.index, item.event))
      .join('\n\n'),
    '</current_transcript_evidence>',
  ].join('\n')
}

function selectSessionMemoryGroundingEvidence(
  events: readonly TranscriptEvent[],
  sourceEventCount: number,
): Array<{ index: number; event: TranscriptEvent }> {
  const indexes = new Set<number>()
  const sourceLastIndex = sourceEventCount - 1
  if (sourceLastIndex >= 0 && sourceLastIndex < events.length) {
    indexes.add(sourceLastIndex)
  }
  if (sourceEventCount >= 0 && sourceEventCount < events.length) {
    indexes.add(sourceEventCount)
  }
  const tailStart = Math.max(0, events.length - 12)
  for (let index = tailStart; index < events.length; index += 1) {
    indexes.add(index)
  }
  return [...indexes]
    .sort((left, right) => left - right)
    .map(index => ({ index, event: events[index]! }))
}

function renderSessionMemoryGroundingEvidence(
  index: number,
  event: TranscriptEvent,
): string {
  const timestamp = 'timestamp' in event ? event.timestamp : undefined
  if (event.type === 'user' || event.type === 'assistant') {
    return [
      `event[${index}] type=${event.type}${timestamp ? ` timestamp=${timestamp}` : ''}`,
      truncateGroundingText(event.content, 900),
      event.type === 'assistant' && event.toolCalls?.length
        ? `toolCalls=${event.toolCalls.map(call => call.name).join(', ')}`
        : '',
    ].filter(Boolean).join('\n')
  }
  if (event.type === 'tool-call') {
    return [
      `event[${index}] type=tool-call${timestamp ? ` timestamp=${timestamp}` : ''}`,
      `tool=${event.call.name}`,
      `input=${truncateGroundingText(JSON.stringify(event.call.input), 500)}`,
    ].join('\n')
  }
  if (event.type === 'tool-result') {
    return [
      `event[${index}] type=tool-result${timestamp ? ` timestamp=${timestamp}` : ''}`,
      `ok=${event.result.ok}`,
      `content=${truncateGroundingText(event.result.content, 700)}`,
      event.result.metadata
        ? `metadata=${truncateGroundingText(JSON.stringify(event.result.metadata), 500)}`
        : '',
    ].filter(Boolean).join('\n')
  }
  if (event.type === 'compact-boundary') {
    return [
      `event[${index}] type=compact-boundary${timestamp ? ` timestamp=${timestamp}` : ''}`,
      `summary=${truncateGroundingText(event.summary, 900)}`,
      `memoryFreshness=${event.metadata.memoryFreshness ?? 'unknown'}`,
    ].join('\n')
  }
  if (event.type === 'session-state') {
    return [
      `event[${index}] type=session-state${timestamp ? ` timestamp=${timestamp}` : ''}`,
      `phase=${event.phase}`,
      event.approvedPlan ? `approvedPlan=${truncateGroundingText(event.approvedPlan, 500)}` : '',
      event.todos?.length ? `todos=${truncateGroundingText(JSON.stringify(event.todos), 500)}` : '',
      event.verificationNotes?.length
        ? `verificationNotes=${truncateGroundingText(JSON.stringify(event.verificationNotes), 500)}`
        : '',
    ].filter(Boolean).join('\n')
  }
  if (event.type === 'subagent-lifecycle') {
    return [
      `event[${index}] type=subagent-lifecycle${timestamp ? ` timestamp=${timestamp}` : ''}`,
      `status=${event.event.status}`,
      `taskId=${event.event.taskId}`,
      event.event.summary ? `summary=${truncateGroundingText(event.event.summary, 500)}` : '',
    ].filter(Boolean).join('\n')
  }
  return `event[${index}] type=${event.type}${timestamp ? ` timestamp=${timestamp}` : ''}`
}

function parseModelJsonObject(content: string): unknown {
  const trimmed = content.trim()
  if (!trimmed) return null
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(withoutFence)
  } catch {
    const firstBrace = withoutFence.indexOf('{')
    const lastBrace = withoutFence.lastIndexOf('}')
    if (firstBrace < 0 || lastBrace <= firstBrace) return null
    try {
      return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1))
    } catch {
      return null
    }
  }
}

function normalizeSessionMemoryGroundingValidation(
  parsed: unknown,
  base: Omit<
    MemoryGroundingValidationMetadata,
    'status' | 'supportedClaims' | 'contradictedClaims' | 'missingClaims' | 'reason'
  >,
): MemoryGroundingValidationMetadata {
  if (!isRecord(parsed)) {
    return {
      ...base,
      status: 'unknown',
      supportedClaims: [],
      contradictedClaims: [],
      missingClaims: [],
      reason: 'invalid_model_validation_response',
    }
  }
  const supportedClaims = coerceGroundingStringArray(parsed.supportedClaims)
  const contradictedClaims = coerceGroundingStringArray(parsed.contradictedClaims)
  const missingClaims = coerceGroundingStringArray(parsed.missingClaims)
  const rawStatus = parsed.status
  const status =
    rawStatus === 'supported' || rawStatus === 'contradicted' || rawStatus === 'unknown'
      ? rawStatus
      : 'unknown'
  return {
    ...base,
    status:
      status === 'supported' && contradictedClaims.length > 0
        ? 'contradicted'
        : status,
    supportedClaims,
    contradictedClaims,
    missingClaims,
    reason:
      typeof parsed.reason === 'string' && parsed.reason.trim()
        ? truncateGroundingText(parsed.reason.trim(), 800)
        : status === 'unknown'
          ? 'model_returned_unknown_without_reason'
          : 'model_returned_validation_without_reason',
  }
}

function coerceGroundingStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => truncateGroundingText(item.trim(), 500))
    .filter(Boolean)
    .slice(0, 12)
}

function truncateGroundingText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 16))}...<truncated>`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function classifySessionMemoryHeading(heading: string): SessionMemorySectionKind {
  const normalized = heading.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (normalized === 'current task') return 'current_task'
  if (normalized === 'current state') return 'current_state'
  if (normalized === 'todo state') return 'todo_state'
  if (normalized === 'verification notes') return 'verification_notes'
  if (normalized === 'important files') return 'important_files'
  if (normalized === 'next step') return 'next_step'
  return 'unknown'
}

function normalizeSemanticText(value: string): string {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function collectRecentFilePaths(events: readonly TranscriptEvent[]): string[] {
  const files = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool-result') continue
    const filePath = event.result.metadata?.filePath
    if (typeof filePath === 'string') files.add(filePath)
    if (files.size >= 5) break
  }
  return [...files]
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
