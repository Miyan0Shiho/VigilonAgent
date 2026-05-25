import path from 'node:path'
import { execFile } from 'node:child_process'
import { cp, mkdir, realpath, writeFile } from 'node:fs/promises'
import type {
  AgentRuntimeTurnResult,
  ModelClient,
  PermissionGate,
  PreToolUseHook,
  RuntimeProjectConfig,
  ToolResult,
  ToolUseContext,
  TranscriptStore,
  FileReadingLimits,
  PermissionMode,
  RuntimeSessionState,
  RuntimeSessionSnapshot,
  RuntimeSkill,
  RuntimeOperator,
  SubagentRunRequest,
  SubagentRunResult,
  SubagentTaskHost,
  SubagentLifecycleEvent,
  TaskManager,
  PermissionOrigin,
  SubagentGitWorktreeMetadata,
  SubagentWorktreeDiff,
  RequestCacheSnapshot,
} from './contracts.js'
import { createToolRegistry, ToolRegistry } from './tools.js'
import {
  JsonlTranscriptStore,
  createSessionId,
  createTimestamp,
  getProjectSessionDir,
} from './transcript.js'
import { resolveTaskStopRequestPath } from './taskControl.js'
import { getTranscriptPathForStore } from './context-injection.js'

export function createSubagentRunner(options: {
  modelClient: ModelClient
  tools: ToolRegistry
  parentTranscript: TranscriptStore
  permissionGate: PermissionGate
  preToolUseHooks?: PreToolUseHook[]
  fileReadingLimits?: FileReadingLimits
  globLimits?: {
    maxResults?: number
  }
  bashLimits?: {
    timeoutMs?: number
    maxOutputChars?: number
  }
  projectConfig?: RuntimeProjectConfig
  operator?: RuntimeOperator
  skills?: readonly RuntimeSkill[]
  toolResultReplacementLimit?: number
  taskManager: TaskManager
  sessionState: RuntimeSessionState
}): (request: SubagentRunRequest) => Promise<SubagentRunResult> {
  return async (request: SubagentRunRequest): Promise<SubagentRunResult> => {
    const subagentSessionId = `${sanitizeForPath(request.definition.name)}-${createSessionId()}`
    const host = await prepareSubagentExecutionHost({
      request,
      parentTranscript: options.parentTranscript,
      sessionId: subagentSessionId,
    })
    const transcriptPath = getSubagentTranscriptPath({
      cwd: host.sourceCwd,
      parentTranscript: options.parentTranscript,
      agentName: request.definition.name,
      sessionId: subagentSessionId,
    })
    const transcript = new JsonlTranscriptStore({
      sessionId: subagentSessionId,
      transcriptPath,
    })
    const permissionOrigin: PermissionOrigin = {
      agentId: `agent:${request.definition.name}:${subagentSessionId}`,
      agentRole: 'subagent',
      parentAgentId: request.parentAgentId ?? 'main',
    }
    const taskHost: SubagentTaskHost = {
      taskId: subagentSessionId,
      status: 'running',
      background: request.definition.background === true,
      transcriptPath,
      cwd: host.cwd,
      host: host.type,
      worktreePath: host.type !== 'local' ? host.cwd : undefined,
      gitWorktree: host.gitWorktree,
      sourceCwd: host.sourceCwd,
      startedAt: createTimestamp(),
      registeredWithTaskManager: true,
      stopPath: 'shared-task-manager',
      stopRequestPath: resolveTaskStopRequestPath({
        id: subagentSessionId,
        transcriptPath,
      }),
    }
    const subagentAbortController = new AbortController()
    await options.taskManager.startSubagentTask({
      taskId: taskHost.taskId,
      agentName: request.definition.name,
      transcriptPath,
      cwd: host.cwd,
      host: host.type,
      worktreePath: host.type !== 'local' ? host.cwd : undefined,
      gitWorktree: host.gitWorktree,
      sourceCwd: host.sourceCwd,
      background: taskHost.background,
      parentAgentId: permissionOrigin.parentAgentId,
      parentSessionId: options.parentTranscript.sessionId,
      stopRequestPath: taskHost.stopRequestPath,
      abortController: subagentAbortController,
    })
    const emitLifecycle = async (
      event: Omit<
        SubagentLifecycleEvent,
        'taskId' | 'agentName' | 'background' | 'transcriptPath' | 'parentAgentId' | 'timestamp'
      >,
    ): Promise<void> => {
      const timestamp = createTimestamp()
      const lifecycleEvent: SubagentLifecycleEvent = {
        taskId: taskHost.taskId,
        agentName: request.definition.name,
        background: taskHost.background,
        transcriptPath,
        cwd: host.cwd,
        host: host.type,
        worktreePath: host.type !== 'local' ? host.cwd : undefined,
        gitWorktree: host.gitWorktree,
        sourceCwd: host.sourceCwd,
        parentAgentId: permissionOrigin.parentAgentId,
        timestamp,
        ...event,
      }
      await options.parentTranscript.append({
        type: 'subagent-lifecycle',
        event: lifecycleEvent,
        timestamp,
      })
      await request.lifecycle?.emit(lifecycleEvent)
    }
    await emitLifecycle({
      status: 'started',
      summary: `Subagent ${request.definition.name} registered with shared task manager.`,
    })
    const permissionGate = createSubagentPermissionGate(
      options.permissionGate,
      transcript,
      permissionOrigin,
    )
    const { createVigilonAgentRuntime } = await import('./agentLoop.js')
    const runtime = createVigilonAgentRuntime({
      modelClient: options.modelClient,
      tools: createToolRegistry(
        filterAllowedSubagentTools(
          options.tools.list(),
          request.definition.allowedTools,
        ),
      ),
      transcript,
      permissionGate,
      preToolUseHooks: options.preToolUseHooks,
      maxTurns: request.definition.maxTurns,
      fileReadingLimits: options.fileReadingLimits,
      globLimits: options.globLimits,
      bashLimits: options.bashLimits,
      projectConfig: options.projectConfig,
      operator: options.operator,
      skills: options.skills,
      toolResultReplacementLimit: options.toolResultReplacementLimit,
      permissionOrigin,
      forkRequestCacheSnapshot: request.requestCacheSnapshot,
    })

    const runSubagentTurn = async (): Promise<SubagentRunResult> => {
      let turnResult: AgentRuntimeTurnResult | undefined
      try {
        for await (const event of runtime.runTurn({
          prompt: buildSubagentPrompt(request, host),
          cwd: host.cwd,
          abortSignal: subagentAbortController.signal,
        })) {
          if (event.type === 'model-request-started') {
            await emitLifecycle({
              status: 'model-request-started',
              modelId: options.modelClient.id,
              summary: `Subagent ${request.definition.name} requested model output.`,
            })
          }
          if (event.type === 'model-response-received') {
            await emitLifecycle({
              status: 'model-response-received',
              modelId: options.modelClient.id,
              stopReason: event.response.stopReason,
              toolCallCount: event.response.toolCalls.length,
              summary: event.response.content
                ? truncateText(event.response.content, 500)
                : `Subagent model response stopReason=${event.response.stopReason}.`,
            })
          }
          if (event.type === 'tool-started') {
            await emitLifecycle({
              status: 'tool-started',
              toolCallId: event.call.id,
              toolName: event.call.name,
              summary: `Subagent ${request.definition.name} started ${event.call.name}.`,
            })
          }
          if (event.type === 'tool-finished') {
            await emitLifecycle({
              status: 'tool-finished',
              toolCallId: event.result.toolCallId,
              toolOk: event.result.ok,
              summary: truncateText(event.result.content, 500),
            })
          }
          if (event.type === 'turn-finished') {
            turnResult = event.result
          }
        }
      } catch (error) {
        const worktreeDiff = await finalizeSubagentExecutionHost(host, transcriptPath)
        await emitLifecycle({
          status: 'failed',
          worktreeDiff,
          finalMessage: error instanceof Error ? error.message : String(error),
          summary: `Subagent ${request.definition.name} failed before final handoff.`,
        })
        await options.taskManager.completeTask(taskHost.taskId, {
          status: 'failed',
          terminalReason: 'subagent_runtime_error',
          outputSummary: error instanceof Error ? error.message : String(error),
          worktreeDiff,
        })
        throw error
      }

      if (!turnResult) {
        if (subagentAbortController.signal.aborted) {
          const worktreeDiff = await finalizeSubagentExecutionHost(host, transcriptPath)
          const stoppedResult: SubagentRunResult = {
            status: 'stopped',
            agentName: request.definition.name,
            transcriptPath,
            finalMessage: `Subagent ${request.definition.name} stopped before producing a final result.`,
            report: {
              status: 'stopped',
              finalMessage: `Subagent ${request.definition.name} stopped before producing a final result.`,
              todos: [],
              warnings: ['Subagent stopped through shared task manager path.'],
              verificationNotes: [],
              fileChanges: [],
              toolResults: [],
            },
            taskHost: {
              ...taskHost,
              status: 'stopped',
              worktreeDiff,
              completedAt: createTimestamp(),
            },
            permissionOrigin,
            ...(request.memorySnapshot ? { memorySnapshot: request.memorySnapshot } : {}),
            ...(request.catalog ? { catalog: request.catalog } : {}),
          }
          await options.taskManager.completeTask(taskHost.taskId, {
            status: 'stopped',
            terminalReason: 'subagent_aborted_before_final_result',
            outputSummary: stoppedResult.finalMessage,
            worktreeDiff,
          })
          await emitLifecycle({
            status: 'stopped',
            worktreeDiff,
            finalMessage: stoppedResult.finalMessage,
            summary: stoppedResult.finalMessage,
          })
          return stoppedResult
        }
        const error = new Error(`Subagent ${request.definition.name} finished without a final result.`)
        await options.taskManager.completeTask(taskHost.taskId, {
          status: 'failed',
          terminalReason: 'subagent_missing_final_result',
          outputSummary: error.message,
        })
        await emitLifecycle({
          status: 'failed',
          finalMessage: error.message,
          summary: error.message,
        })
        throw error
      }

      const worktreeDiff = await finalizeSubagentExecutionHost(host, transcriptPath)
      const completedResult: SubagentRunResult = {
        status: 'completed',
        agentName: request.definition.name,
        transcriptPath,
        finalMessage: turnResult.finalMessage,
        report: turnResult.report,
        taskHost: {
          ...taskHost,
          status: 'completed',
          worktreeDiff,
          completedAt: createTimestamp(),
        },
        permissionOrigin,
        ...(request.memorySnapshot ? { memorySnapshot: request.memorySnapshot } : {}),
        ...(request.catalog ? { catalog: request.catalog } : {}),
      }
      await options.taskManager.completeTask(taskHost.taskId, {
        status: 'completed',
        terminalReason: 'subagent_completed',
        outputSummary: completedResult.finalMessage,
        worktreeDiff,
      })
      await emitLifecycle({
        status: 'completed',
        worktreeDiff,
        finalMessage: completedResult.finalMessage,
        summary: truncateText(completedResult.finalMessage, 500),
      })
      return completedResult
    }

    if (taskHost.background) {
      void runSubagentTurn()
        .catch(async error => {
          await transcript.append({
            type: 'assistant',
            content: `Background subagent ${request.definition.name} failed: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: createTimestamp(),
          })
        })
        .finally(async () => {
          await appendTaskLifecycleSessionState({
            transcript: options.parentTranscript,
            sessionState: options.sessionState,
            taskManager: options.taskManager,
          })
        })
      const finalMessage = `Subagent ${request.definition.name} started in background. Task ID: ${taskHost.taskId}`
      await emitLifecycle({
        status: 'running-handoff',
        finalMessage,
        summary: finalMessage,
      })
      return {
        status: 'running',
        agentName: request.definition.name,
        transcriptPath,
        finalMessage,
        report: {
          status: 'running',
          finalMessage,
          todos: [],
          warnings: ['Background subagent is still running; use TaskStop with taskHost.taskId to stop it.'],
          verificationNotes: [],
          fileChanges: [],
          toolResults: [],
        },
        taskHost,
        permissionOrigin,
        ...(request.memorySnapshot ? { memorySnapshot: request.memorySnapshot } : {}),
        ...(request.catalog ? { catalog: request.catalog } : {}),
      }
    }

    return runSubagentTurn()
  }
}

async function appendTaskLifecycleSessionState(options: {
  transcript: TranscriptStore
  sessionState: RuntimeSessionState
  taskManager: TaskManager
}): Promise<void> {
  options.sessionState.backgroundTasks = options.taskManager.activeTasks.map(task => ({
    ...task,
  }))
  options.sessionState.retainedTasks = options.taskManager.retainedTasks.map(task => ({
    ...task,
  }))
  await options.transcript.append({
    type: 'session-state',
    phase: options.sessionState.phase,
    permissionMode: options.sessionState.permissionMode,
    prePlanPermissionMode: options.sessionState.prePlanPermissionMode ?? null,
    todos: options.sessionState.todos.map(todo => ({ ...todo })),
    approvedPlan: options.sessionState.approvedPlan ?? null,
    pendingPlan: options.sessionState.pendingPlan ?? null,
    handoffReport: options.sessionState.handoffReport
      ? {
          finalMessage: options.sessionState.handoffReport.finalMessage,
          changes: [...options.sessionState.handoffReport.changes],
          verified: [...options.sessionState.handoffReport.verified],
          unverified: [...options.sessionState.handoffReport.unverified],
          risks: [...options.sessionState.handoffReport.risks],
        }
      : null,
    verificationNotes: [...options.sessionState.verificationNotes],
    backgroundTasks: options.sessionState.backgroundTasks.map(task => ({ ...task })),
    retainedTasks: options.sessionState.retainedTasks.map(task => ({ ...task })),
    discoveredToolNames: [...options.sessionState.discoveredToolNames],
    toolReferenceDeltas: [...options.sessionState.toolReferenceDeltas],
    mcpInstructions: [...options.sessionState.mcpInstructions],
    activeSkill: options.sessionState.activeSkill
      ? { ...options.sessionState.activeSkill }
      : null,
    memoryFreshness: options.sessionState.memoryFreshness ?? null,
    systemPrompt: options.sessionState.systemPrompt ?? null,
    toolSchema: options.sessionState.toolSchema ?? null,
    modelParams: options.sessionState.modelParams ?? null,
    timestamp: createTimestamp(),
  })
}

function createSubagentPermissionGate(
  parent: PermissionGate,
  transcript: TranscriptStore,
  origin: PermissionOrigin,
): PermissionGate {
  return {
    async requestPermission(request) {
      const requestWithOrigin = {
        ...request,
        origin: request.origin ?? origin,
      }
      const decision = await parent.requestPermission(requestWithOrigin)
      await transcript.append({
        type: 'permission',
        request: requestWithOrigin,
        decision,
        timestamp: createTimestamp(),
      })
      return decision
    },
  }
}

function filterAllowedSubagentTools(
  tools: readonly ReturnType<ToolRegistry['list']>[number][],
  allowedTools: readonly string[],
) {
  const allowed = new Set(allowedTools)
  return tools.filter(tool => allowed.has(tool.name))
}

type SubagentExecutionHost = {
  type: 'local' | 'worktree' | 'git-worktree'
  cwd: string
  sourceCwd: string
  baselinePath?: string
  gitWorktree?: SubagentGitWorktreeMetadata
}

async function prepareSubagentExecutionHost(input: {
  request: SubagentRunRequest
  parentTranscript: TranscriptStore
  sessionId: string
}): Promise<SubagentExecutionHost> {
  const host = input.request.definition.host ?? 'local'
  if (host === 'local') {
    return {
      type: 'local',
      cwd: input.request.cwd,
      sourceCwd: input.request.cwd,
    }
  }
  if (host === 'git-worktree') {
    return prepareGitSubagentWorktree(input)
  }

  const worktreePath = path.join(
    resolveSubagentWorktreeRoot(input.request.cwd, input.parentTranscript),
    sanitizeForPath(input.request.definition.name),
    input.sessionId,
  )
  const baselinePath = `${worktreePath}.baseline`
  await mkdir(path.dirname(worktreePath), { recursive: true })
  await cp(input.request.cwd, baselinePath, {
    recursive: true,
    force: true,
    dereference: false,
    filter: source => shouldCopyIntoSubagentWorktree(input.request.cwd, worktreePath, source),
  })
  await cp(input.request.cwd, worktreePath, {
    recursive: true,
    force: true,
    dereference: false,
    filter: source => shouldCopyIntoSubagentWorktree(input.request.cwd, worktreePath, source),
  })
  return {
    type: 'worktree',
    cwd: worktreePath,
    sourceCwd: input.request.cwd,
    baselinePath,
  }
}

async function prepareGitSubagentWorktree(input: {
  request: SubagentRunRequest
  parentTranscript: TranscriptStore
  sessionId: string
}): Promise<SubagentExecutionHost> {
  const gitRootRaw = (await execFileStrict('git', ['-C', input.request.cwd, 'rev-parse', '--show-toplevel'])).stdout.trim()
  if (!gitRootRaw) {
    throw new Error(`git-worktree subagent host requires a git repository: ${input.request.cwd}`)
  }
  const gitRoot = await realpath(gitRootRaw)
  const sourceCwdReal = await realpath(input.request.cwd)
  const baseHead = (await execFileStrict('git', ['-C', gitRoot, 'rev-parse', 'HEAD'])).stdout.trim()
  const baseBranch = (await execFileStrict('git', ['-C', gitRoot, 'branch', '--show-current'])).stdout.trim() || undefined
  const relativeCwd = path.relative(gitRoot, sourceCwdReal)
  if (relativeCwd.startsWith('..') || path.isAbsolute(relativeCwd)) {
    throw new Error(`git-worktree subagent cwd is outside git root: ${input.request.cwd}`)
  }
  const worktreeRoot = path.join(
    resolveSubagentWorktreeRoot(input.request.cwd, input.parentTranscript),
    'git',
    sanitizeForPath(input.request.definition.name),
    input.sessionId,
  )
  const branchName = `vigilon/subagent/${sanitizeForPath(input.request.definition.name)}/${input.sessionId}`
  await mkdir(path.dirname(worktreeRoot), { recursive: true })
  await execFileStrict('git', [
    '-C',
    gitRoot,
    'worktree',
    'add',
    '-b',
    branchName,
    worktreeRoot,
    baseHead,
  ])
  const cwd = relativeCwd ? path.join(worktreeRoot, relativeCwd) : worktreeRoot
  return {
    type: 'git-worktree',
    cwd,
    sourceCwd: input.request.cwd,
    baselinePath: gitRoot,
    gitWorktree: {
      gitRoot,
      worktreePath: worktreeRoot,
      branchName,
      baseHead,
      baseBranch,
    },
  }
}

async function finalizeSubagentExecutionHost(
  host: SubagentExecutionHost,
  transcriptPath: string,
): Promise<SubagentWorktreeDiff | undefined> {
  if (host.type === 'git-worktree' && host.gitWorktree) {
    return finalizeGitSubagentWorktree(host, transcriptPath)
  }
  if (host.type !== 'worktree' || !host.baselinePath) return undefined
  const patchPath = `${transcriptPath}.worktree.patch`
  try {
    const [patch, nameStatus] = await Promise.all([
      execFileAllowingDiff('git', [
        'diff',
        '--no-index',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        host.baselinePath,
        host.cwd,
      ]),
      execFileAllowingDiff('git', [
        'diff',
        '--no-index',
        '--name-status',
        host.baselinePath,
        host.cwd,
      ]),
    ])
    const normalizedPatch = normalizeNoIndexPatch({
      patch: patch.stdout,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
    })
    await writeFile(patchPath, normalizedPatch, 'utf8')
    const changedFiles = parseWorktreeNameStatus({
      raw: nameStatus.stdout,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
    })
    const lineStats = countPatchLineStats(normalizedPatch)
    return {
      strategy: 'copy-baseline-diff',
      status: changedFiles.length > 0 ? 'changed' : 'clean',
      sourceCwd: host.sourceCwd,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
      patchPath,
      filesChanged: changedFiles.length,
      additions: lineStats.additions,
      deletions: lineStats.deletions,
      changedFiles,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(patchPath, `worktree diff failed: ${message}\n`, 'utf8')
    return {
      strategy: 'copy-baseline-diff',
      status: 'failed',
      sourceCwd: host.sourceCwd,
      baselinePath: host.baselinePath,
      worktreePath: host.cwd,
      patchPath,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      changedFiles: [],
      error: message,
    }
  }
}

async function finalizeGitSubagentWorktree(
  host: SubagentExecutionHost,
  transcriptPath: string,
): Promise<SubagentWorktreeDiff> {
  const gitWorktree = host.gitWorktree
  if (!gitWorktree) throw new Error('git worktree metadata missing from subagent host')
  const patchPath = `${transcriptPath}.worktree.patch`
  try {
    const [patch, nameStatus] = await Promise.all([
      execFileAllowingDiff('git', [
        '-C',
        host.cwd,
        'diff',
        '--binary',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        'HEAD',
      ]),
      execFileAllowingDiff('git', [
        '-C',
        host.cwd,
        'diff',
        '--name-status',
        'HEAD',
      ]),
    ])
    await writeFile(patchPath, patch.stdout, 'utf8')
    const changedFiles = parseGitNameStatus(nameStatus.stdout)
    const lineStats = countPatchLineStats(patch.stdout)
    return {
      strategy: 'git-worktree-diff',
      status: changedFiles.length > 0 ? 'changed' : 'clean',
      sourceCwd: host.sourceCwd,
      baselinePath: gitWorktree.gitRoot,
      baselineRef: gitWorktree.baseHead,
      worktreePath: gitWorktree.worktreePath,
      patchPath,
      gitWorktree,
      filesChanged: changedFiles.length,
      additions: lineStats.additions,
      deletions: lineStats.deletions,
      changedFiles,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeFile(patchPath, `git worktree diff failed: ${message}\n`, 'utf8')
    return {
      strategy: 'git-worktree-diff',
      status: 'failed',
      sourceCwd: host.sourceCwd,
      baselinePath: gitWorktree.gitRoot,
      baselineRef: gitWorktree.baseHead,
      worktreePath: gitWorktree.worktreePath,
      patchPath,
      gitWorktree,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      changedFiles: [],
      error: message,
    }
  }
}

function parseGitNameStatus(raw: string): SubagentWorktreeDiff['changedFiles'] {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [statusCode = '', firstPath = '', secondPath = ''] = line.split('\t')
      return {
        status: mapWorktreeStatus(statusCode),
        path: secondPath || firstPath,
      }
    })
}

async function execFileAllowingDiff(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === 'number'
        ? (error as { code: number }).code
        : 0
      if (error && code !== 1) {
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function execFileStrict(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function normalizeNoIndexPatch(input: {
  patch: string
  baselinePath: string
  worktreePath: string
}): string {
  const baseline = stripLeadingSlash(path.resolve(input.baselinePath))
  const worktree = stripLeadingSlash(path.resolve(input.worktreePath))
  return input.patch
    .split('\n')
    .map(line =>
      line
        .replaceAll(`a/${baseline}/`, 'a/')
        .replaceAll(`b/${baseline}/`, 'b/')
        .replaceAll(`a/${worktree}/`, 'a/')
        .replaceAll(`b/${worktree}/`, 'b/'),
    )
    .join('\n')
}

function parseWorktreeNameStatus(input: {
  raw: string
  baselinePath: string
  worktreePath: string
}): SubagentWorktreeDiff['changedFiles'] {
  return input.raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [statusCode = '', firstPath = '', secondPath = ''] = line.split('\t')
      const status = mapWorktreeStatus(statusCode)
      const rawPath = secondPath || firstPath
      return {
        status,
        path: normalizeWorktreeDiffPath(rawPath, input.baselinePath, input.worktreePath),
      }
    })
}

function mapWorktreeStatus(statusCode: string): SubagentWorktreeDiff['changedFiles'][number]['status'] {
  const code = statusCode[0]
  if (code === 'A') return 'added'
  if (code === 'M') return 'modified'
  if (code === 'D') return 'deleted'
  if (code === 'R') return 'renamed'
  if (code === 'C') return 'copied'
  if (code === 'T') return 'typechange'
  return 'unknown'
}

function normalizeWorktreeDiffPath(
  rawPath: string,
  baselinePath: string,
  worktreePath: string,
): string {
  const resolved = path.resolve(rawPath)
  for (const root of [baselinePath, worktreePath]) {
    const relative = path.relative(path.resolve(root), resolved)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative
  }
  return rawPath
}

function countPatchLineStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}

function resolveSubagentWorktreeRoot(cwd: string, parentTranscript: TranscriptStore): string {
  if (
    parentTranscript.transcriptPath &&
    !isPathInside(cwd, path.dirname(parentTranscript.transcriptPath))
  ) {
    return path.join(path.dirname(parentTranscript.transcriptPath), 'subagent-worktrees')
  }
  return path.join(path.dirname(cwd), `${path.basename(cwd)}.subagent-worktrees`)
}

function shouldCopyIntoSubagentWorktree(
  sourceRoot: string,
  worktreePath: string,
  source: string,
): boolean {
  if (path.resolve(source) !== path.resolve(sourceRoot) && isPathInside(source, worktreePath)) {
    return false
  }
  const relative = path.relative(sourceRoot, source)
  if (!relative) return true
  const [firstPart] = relative.split(path.sep)
  return firstPart !== '.git' &&
    firstPart !== '.vigilon' &&
    firstPart !== '.sessions' &&
    firstPart !== 'node_modules'
}

function isPathInside(candidateParent: string, child: string): boolean {
  const relative = path.relative(path.resolve(candidateParent), path.resolve(child))
  return relative === '' || Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function buildSubagentPrompt(
  request: SubagentRunRequest,
  host: SubagentExecutionHost,
): string {
  return [
    request.definition.systemPrompt.trim(),
    '',
    'You are running as a focused local subagent.',
    `Agent: ${request.definition.name}`,
    `Agent source: ${request.definition.source}`,
    `Execution host: ${host.type}`,
    host.type !== 'local'
      ? `Worktree cwd: ${host.cwd}`
      : `Cwd: ${host.cwd}`,
    host.type !== 'local'
      ? `Source cwd: ${host.sourceCwd}`
      : undefined,
    host.gitWorktree
      ? `Git worktree branch: ${host.gitWorktree.branchName}`
      : undefined,
    host.gitWorktree
      ? `Git worktree base HEAD: ${host.gitWorktree.baseHead}`
      : undefined,
    `Allowed tools: ${request.definition.allowedTools.join(', ') || '(none)'}`,
    request.memorySnapshot
      ? [
          '',
          '<vigilon_subagent_memory_snapshot>',
          request.memorySnapshot.freshness
            ? `freshness="${request.memorySnapshot.freshness}"`
            : undefined,
          request.memorySnapshot.sourceEventCount !== undefined
            ? `source_event_count="${request.memorySnapshot.sourceEventCount}"`
            : undefined,
          request.memorySnapshot.summary,
          request.memorySnapshot.longTerm
            ? [
                '',
                '<vigilon_subagent_long_term_memory>',
                `index_path="${request.memorySnapshot.longTerm.indexPath}"`,
                `manifest_path="${request.memorySnapshot.longTerm.manifestPath}"`,
                `entry_count="${request.memorySnapshot.longTerm.entryCount}"`,
                ...request.memorySnapshot.longTerm.entries.map(entry =>
                  [
                    `<entry id="${entry.id}" type="${entry.kind}" topic="${escapePromptAttribute(entry.topic)}" created_at="${entry.createdAt}">`,
                    entry.content,
                    '</entry>',
                  ].join('\n'),
                ),
                '</vigilon_subagent_long_term_memory>',
              ].join('\n')
            : undefined,
          '</vigilon_subagent_memory_snapshot>',
        ].filter(Boolean).join('\n')
      : '',
    '',
    'Task:',
    request.task,
  ].join('\n')
}

function escapePromptAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getSubagentTranscriptPath(options: {
  cwd: string
  parentTranscript: TranscriptStore
  agentName: string
  sessionId: string
}): string {
  const parentPath = getTranscriptPathForStore(options.parentTranscript)
  const baseDir = parentPath
    ? path.join(path.dirname(parentPath), 'subagents')
    : path.join(getProjectSessionDir(options.cwd), 'subagents')
  return path.join(
    baseDir,
    sanitizeForPath(options.agentName),
    `${options.sessionId}.jsonl`,
  )
}

function sanitizeForPath(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
}

function truncateText(value: string | undefined, maxChars: number): string {
  if (!value) return ''
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
}
