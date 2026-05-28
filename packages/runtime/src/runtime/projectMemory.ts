import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const PROJECT_MEMORY_MANIFEST_VERSION = 1

export type LongTermMemoryKind =
  | 'user'
  | 'project'
  | 'organization'
  | 'agent'
  | 'tool'
  | 'feedback'
  | 'reference'

export type LongTermMemoryPromotionSource = {
  sessionId?: string
  transcriptPath?: string
  sourceEventCount?: number
}

export type LongTermMemoryPromotionDecision = {
  status: 'allowed' | 'rejected'
  reasons: string[]
  rejectedCategories: Array<
    | 'empty'
    | 'unsupported_type'
    | 'sensitive_secret'
    | 'transient_execution_noise'
    | 'derivable_code_structure'
  >
}

export type LongTermMemoryEntry = {
  id: string
  kind: LongTermMemoryKind
  topic: string
  topicPath: string
  contentHash: string
  createdAt: string
  source: LongTermMemoryPromotionSource
  promotionDecision: LongTermMemoryPromotionDecision
}

export type ProjectMemorySnapshotEntry = {
  id: string
  kind: LongTermMemoryKind
  topic: string
  content: string
  createdAt: string
  source: LongTermMemoryPromotionSource
}

export type ProjectMemorySnapshot = {
  indexPath: string
  manifestPath: string
  entryCount: number
  entries: ProjectMemorySnapshotEntry[]
}

export type ProjectMemoryManifest = {
  version: typeof PROJECT_MEMORY_MANIFEST_VERSION
  kind: 'vigilon.project-memory'
  root: string
  indexPath: string
  manifestPath: string
  generatedAt: string
  entries: LongTermMemoryEntry[]
}

export type LongTermMemoryPromotionInput = {
  cwd: string
  kind: LongTermMemoryKind
  topic: string
  content: string
  createdAt?: string
  source?: LongTermMemoryPromotionSource
}

export type LongTermMemoryPromotionResult = {
  promoted: boolean
  decision: LongTermMemoryPromotionDecision
  entry: LongTermMemoryEntry | null
  manifest: ProjectMemoryManifest
}

export function getProjectMemoryRoot(cwd: string): string {
  return path.join(cwd, '.vigilon', 'memory')
}

export function getProjectMemoryIndexPath(cwd: string): string {
  return path.join(getProjectMemoryRoot(cwd), 'MEMORY.md')
}

export function getProjectMemoryManifestPath(cwd: string): string {
  return path.join(getProjectMemoryRoot(cwd), 'memory.manifest.json')
}

export function getProjectMemoryTopicPath(
  cwd: string,
  kind: LongTermMemoryKind,
  topic: string,
): string {
  return path.join(
    getProjectMemoryRoot(cwd),
    'topics',
    kind,
    `${slugifyTopic(topic)}.md`,
  )
}

export async function readProjectMemoryManifest(
  cwd: string,
): Promise<ProjectMemoryManifest> {
  const root = getProjectMemoryRoot(cwd)
  const indexPath = getProjectMemoryIndexPath(cwd)
  const manifestPath = getProjectMemoryManifestPath(cwd)
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) {
      return {
        version: PROJECT_MEMORY_MANIFEST_VERSION,
        kind: 'vigilon.project-memory',
        root,
        indexPath,
        manifestPath,
        generatedAt: new Date(0).toISOString(),
        entries: [],
      }
    }
    throw error
  }
  const parsed = JSON.parse(raw) as ProjectMemoryManifest
  if (
    parsed.version !== PROJECT_MEMORY_MANIFEST_VERSION ||
    parsed.kind !== 'vigilon.project-memory'
  ) {
    throw new Error(`Unsupported project memory manifest: ${manifestPath}`)
  }
  return {
    ...parsed,
    root,
    indexPath,
    manifestPath,
  }
}

export async function readProjectMemorySnapshot(
  cwd: string,
  options: {
    limit?: number
    maxContentChars?: number
  } = {},
): Promise<ProjectMemorySnapshot> {
  const manifest = await readProjectMemoryManifest(cwd)
  const limit = options.limit ?? 6
  const maxContentChars = options.maxContentChars ?? 700
  const selectedEntries = manifest.entries.slice(-limit)
  const entries: ProjectMemorySnapshotEntry[] = []

  for (const entry of selectedEntries) {
    const topicContent = await readOptionalText(entry.topicPath)
    entries.push({
      id: entry.id,
      kind: entry.kind,
      topic: entry.topic,
      content: truncateMemoryContent(
        topicContent ? extractEntryContent(topicContent, entry.id) : '',
        maxContentChars,
      ),
      createdAt: entry.createdAt,
      source: entry.source,
    })
  }

  return {
    indexPath: manifest.indexPath,
    manifestPath: manifest.manifestPath,
    entryCount: manifest.entries.length,
    entries,
  }
}

export function evaluateLongTermMemoryPromotion(options: {
  kind: string
  topic: string
  content: string
}): LongTermMemoryPromotionDecision {
  const reasons: string[] = []
  const rejectedCategories: LongTermMemoryPromotionDecision['rejectedCategories'] = []
  const content = options.content.trim()
  const kindAllowed = ['user', 'feedback', 'project', 'reference'].includes(options.kind)

  if (!kindAllowed) {
    rejectedCategories.push('unsupported_type')
    reasons.push('Long-term memory kind must be user, feedback, project, or reference.')
  }
  if (!content) {
    rejectedCategories.push('empty')
    reasons.push('Long-term memory promotion requires non-empty content.')
  }
  if (containsSensitiveSecret(content)) {
    rejectedCategories.push('sensitive_secret')
    reasons.push('Long-term memory must not store secrets, credentials, or private keys.')
  }
  if (containsTransientExecutionNoise(content)) {
    rejectedCategories.push('transient_execution_noise')
    reasons.push('Long-term memory must not store transient command failures or tool noise.')
  }
  if (looksLikeDerivableCodeStructure(content)) {
    rejectedCategories.push('derivable_code_structure')
    reasons.push('Long-term memory must not store code structure that can be derived from the repository.')
  }

  if (rejectedCategories.length > 0) {
    return {
      status: 'rejected',
      reasons,
      rejectedCategories,
    }
  }
  return {
    status: 'allowed',
    reasons: [
      'Manual long-term memory promotion passed typed taxonomy and exclusion policy.',
    ],
    rejectedCategories,
  }
}

export async function promoteLongTermMemory(
  input: LongTermMemoryPromotionInput,
): Promise<LongTermMemoryPromotionResult> {
  const decision = evaluateLongTermMemoryPromotion({
    kind: input.kind,
    topic: input.topic,
    content: input.content,
  })
  const existingManifest = await readProjectMemoryManifest(input.cwd)
  if (decision.status === 'rejected') {
    return {
      promoted: false,
      decision,
      entry: null,
      manifest: existingManifest,
    }
  }

  const createdAt = input.createdAt ?? new Date().toISOString()
  const content = input.content.trim()
  const topic = normalizeTopic(input.topic)
  const topicPath = getProjectMemoryTopicPath(input.cwd, input.kind, topic)
  const contentHash = hashText(`${input.kind}\n${topic}\n${content}`)
  const duplicate = existingManifest.entries.find(
    entry =>
      entry.kind === input.kind &&
      entry.topic === topic &&
      entry.contentHash === contentHash,
  )
  if (duplicate) {
    return {
      promoted: true,
      decision,
      entry: duplicate,
      manifest: existingManifest,
    }
  }

  const entry: LongTermMemoryEntry = {
    id: contentHash.slice(0, 16),
    kind: input.kind,
    topic,
    topicPath,
    contentHash,
    createdAt,
    source: input.source ?? {},
    promotionDecision: decision,
  }
  const manifest: ProjectMemoryManifest = {
    ...existingManifest,
    generatedAt: createdAt,
    entries: [...existingManifest.entries, entry],
  }

  await mkdir(path.dirname(topicPath), { recursive: true })
  await mkdir(existingManifest.root, { recursive: true })
  const existingTopic = await readOptionalText(topicPath)
  await writeFile(
    topicPath,
    renderTopicFile(topic, input.kind, existingTopic, content, entry),
    'utf8',
  )
  await writeFile(existingManifest.indexPath, renderProjectMemoryIndex(manifest), 'utf8')
  await writeFile(
    existingManifest.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )

  return {
    promoted: true,
    decision,
    entry,
    manifest,
  }
}

function renderProjectMemoryIndex(manifest: ProjectMemoryManifest): string {
  const rows = manifest.entries.map(entry =>
    `| ${entry.id} | ${entry.kind} | ${entry.topic} | ${entry.source.sessionId ?? 'manual'} | ${entry.createdAt} |`,
  )
  return [
    '# Vigilon Memory Index',
    '',
    '<!-- vigilon_project_memory_index version="1" -->',
    '',
    '## Taxonomy',
    '',
    '- `user`: durable user preferences and constraints that are not repo-derivable.',
    '- `feedback`: durable corrections from the operator about agent behavior.',
    '- `project`: durable project decisions that affect future work.',
    '- `reference`: durable external or design references that must be re-used.',
    '',
    '## Promotion Policy',
    '',
    '- Manual promotion only; no automatic long-term memory writes.',
    '- Do not store secrets, credentials, private keys, transient tool failures, or raw command noise.',
    '- Do not store code structure that can be derived by reading the repository.',
    '- Each promoted entry records source session metadata in `memory.manifest.json`.',
    '',
    '## Entries',
    '',
    '| id | type | topic | source | created |',
    '| --- | --- | --- | --- | --- |',
    ...(rows.length > 0 ? rows : ['| _none_ | _none_ | _none_ | _none_ | _none_ |']),
    '',
  ].join('\n')
}

function renderTopicFile(
  topic: string,
  kind: LongTermMemoryKind,
  existingContent: string | null,
  content: string,
  newEntry: LongTermMemoryEntry,
): string {
  const newBlock = [
    `## ${newEntry.createdAt} ${newEntry.id}`,
    '',
    `<!-- vigilon_project_memory_entry ${JSON.stringify(newEntry)} -->`,
    '',
    content,
    '',
  ].join('\n')
  if (existingContent?.trim()) {
    return `${existingContent.trim()}\n\n${newBlock}`
  }
  return [
    `# ${topic}`,
    '',
    `<!-- vigilon_project_memory_topic ${JSON.stringify({ kind, topic })} -->`,
    '',
    newBlock,
  ].join('\n')
}

function normalizeTopic(topic: string): string {
  const normalized = topic.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'general'
  return normalized
}

function slugifyTopic(topic: string): string {
  return normalizeTopic(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'general'
}

function containsSensitiveSecret(content: string): boolean {
  return [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i,
  ].some(pattern => pattern.test(content))
}

function containsTransientExecutionNoise(content: string): boolean {
  return [
    /\b(?:ENOENT|EACCES|EPERM|ETIMEDOUT)\b/,
    /\b(?:npm ERR!|pnpm ERR!|command failed|exit code \d+)\b/i,
    /\b(?:stack trace|traceback)\b/i,
  ].some(pattern => pattern.test(content))
}

function looksLikeDerivableCodeStructure(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean)
  if (lines.length === 0) return false
  const structuralLines = lines.filter(line =>
    /^`?[\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|rs|go|java|c|cpp|h)`?(?::\d+)?$/.test(line) ||
    /^(?:export|import|function|class|interface|type|const|let|var)\b/.test(line),
  )
  return structuralLines.length === lines.length
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function extractEntryContent(topicContent: string, entryId: string): string {
  const lines = topicContent.split(/\r?\n/)
  const markerIndex = lines.findIndex(line =>
    line.includes('vigilon_project_memory_entry') &&
    line.includes(`"id":"${entryId}"`),
  )
  if (markerIndex === -1) return ''
  const contentLines: string[] = []
  for (const line of lines.slice(markerIndex + 1)) {
    if (/^##\s+/.test(line)) break
    if (!contentLines.length && !line.trim()) continue
    contentLines.push(line)
  }
  return contentLines.join('\n').trim()
}

function truncateMemoryContent(content: string, maxChars: number): string {
  const normalized = content.trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
