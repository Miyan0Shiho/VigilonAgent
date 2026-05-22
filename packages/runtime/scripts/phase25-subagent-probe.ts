import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createCoreToolRegistry,
  createLocalPermissionGate,
  createTaskManager,
  createVigilonAgentRuntime,
  JsonlTranscriptStore,
  promoteLongTermMemory,
  runCli,
  AgentInventoryTool,
  TaskStopTool,
  buildPermissionOriginSummary,
  loadAgentCatalog,
  restoreSessionStateFromEvents,
  type LocalAgentDefinition,
  type ModelClient,
  type RuntimeSessionState,
  type ToolCall,
  type ToolUseContext,
  type TranscriptEvent,
} from '../src/index.js'

type ProbeCheck = {
  name: string
  passed: boolean
  details?: unknown
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase25-subagent-'))
  const cwd = path.join(root, 'workspace')
  const sessionsDir = path.join(root, 'sessions')
  const userAgentsDir = path.join(root, 'user-agents')
  const userPluginsDir = path.join(root, 'user-plugins')
  const managedAgentsDir = path.join(root, 'managed-agents')
  await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
  await mkdir(path.join(cwd, '.vigilon', 'agents.local'), { recursive: true })
  await writeFile(path.join(cwd, 'marker.txt'), 'subagent worktree marker\n', 'utf8')
  await mkdir(path.join(userPluginsDir, 'plugin-a', 'agents'), { recursive: true })
  await writeFile(
    path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
    [
      '---',
      'description: Project researcher',
      'maxTurns: 2',
      'allowedTools:',
      '  - Bash',
      '---',
      'Project researcher prompt.',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(cwd, '.vigilon', 'agents.local', 'researcher.md'),
    [
      '---',
      'description: Local override researcher',
      'maxTurns: 3',
      'memory: inherit',
      'allowedTools:',
      '  - Bash',
      '---',
      'Local override researcher prompt.',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(cwd, '.vigilon', 'agents.local', 'watcher.md'),
    [
      '---',
      'description: Background watcher',
      'maxTurns: 1',
      'memory: none',
      'background: true',
      'allowedTools:',
      '---',
      'Background watcher prompt.',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(cwd, '.vigilon', 'agents.local', 'finisher.md'),
    [
      '---',
      'description: Background finisher',
      'maxTurns: 1',
      'memory: none',
      'background: true',
      'allowedTools:',
      '---',
      'Background finisher prompt.',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(cwd, '.vigilon', 'agents.local', 'worker.md'),
    [
      '---',
      'description: Worktree worker',
      'maxTurns: 3',
      'memory: none',
      'host: worktree',
      'allowedTools:',
      '  - Bash',
      '---',
      'Worktree worker prompt.',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(userPluginsDir, 'plugin-a', 'agents', 'source-probe.md'),
    [
      '---',
      'name: source-probe',
      'description: Plugin source probe',
      'tools:',
      '  - Read',
      '---',
      'Plugin source probe prompt.',
    ].join('\n'),
    'utf8',
  )
  await mkdir(path.join(cwd, '.vigilon', 'plugins', 'plugin-b', 'agents'), { recursive: true })
  await writeFile(
    path.join(cwd, '.vigilon', 'plugins', 'plugin-b', 'agents', 'source-probe.md'),
    [
      '---',
      'name: source-probe',
      'description: Project plugin source probe',
      'tools:',
      '  - Glob',
      '---',
      'Project plugin source probe prompt.',
    ].join('\n'),
    'utf8',
  )
  await mkdir(userAgentsDir, { recursive: true })
  await writeFile(
    path.join(userAgentsDir, 'source-probe.md'),
    [
      '---',
      'description: User source probe',
      'tools:',
      '  - Grep',
      '---',
      'User source probe prompt.',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(cwd, '.vigilon', 'agents', 'source-probe.md'),
    [
      '---',
      'description: Project source probe',
      'tools:',
      '  - Bash',
      '---',
      'Project source probe prompt.',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    path.join(cwd, '.vigilon', 'agents.local', 'source-probe.md'),
    [
      '---',
      'description: Local source probe',
      'tools:',
      '  - Notebook',
      '---',
      'Local source probe prompt.',
    ].join('\n'),
    'utf8',
  )
  await mkdir(managedAgentsDir, { recursive: true })
  await writeFile(
    path.join(managedAgentsDir, 'source-probe.md'),
    [
      '---',
      'description: Managed source probe',
      'tools:',
      '  - ResultReport',
      '---',
      'Managed source probe prompt.',
    ].join('\n'),
    'utf8',
  )
  const sourceParityFlagAgent: LocalAgentDefinition = {
    name: 'source-probe',
    description: 'Flag source probe',
    systemPrompt: 'Flag source probe prompt.',
    allowedTools: ['Write'],
    maxTurns: 1,
    source: 'flag',
    sourceScope: 'flag',
  }
  await promoteLongTermMemory({
    cwd,
    kind: 'project',
    topic: 'subagent governance',
    content: 'Subagents must receive manually promoted long-term memory handoff evidence.',
    createdAt: '2026-05-19T00:00:00Z',
    source: {
      sessionId: 'phase25-parent',
      sourceEventCount: 2,
    },
  })

  try {
    const sourceParityCatalog = await loadAgentCatalog({
      cwd,
      env: {
        VIGILON_USER_AGENTS_DIR: userAgentsDir,
        VIGILON_USER_PLUGINS_DIR: userPluginsDir,
        VIGILON_MANAGED_AGENTS_DIR: managedAgentsDir,
      },
      flagAgents: [sourceParityFlagAgent],
    })
    const parentTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'phase25-parent',
    })
    const parentState: RuntimeSessionState = {
      phase: 'execute',
      permissionMode: 'bypass-local',
      todos: [],
      approvedPlan: 'Delegate investigation to a focused researcher subagent.',
      verificationNotes: ['Parent state should be visible in subagent memory snapshot.'],
      backgroundTasks: [],
      discoveredToolNames: [],
      toolReferenceDeltas: [],
      mcpInstructions: [],
      memoryFreshness: 'stale',
    }
    const modelClient = createProbeModel()
    const runtime = createVigilonAgentRuntime({
      modelClient,
      tools: createCoreToolRegistry(),
      transcript: parentTranscript,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript: parentTranscript,
      }),
      permissionMode: 'bypass-local',
      resume: {
        sessionId: parentTranscript.sessionId,
        transcriptPath: parentTranscript.transcriptPath,
        events: [],
        sessionState: parentState,
      },
      stopAfterResultReport: false,
    })

    let finalMessage = ''
    const runtimeLifecycleEvents: any[] = []
    for await (const event of runtime.runTurn({
      prompt: 'Use researcher to inspect the delegated runtime state.',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'subagent-lifecycle') runtimeLifecycleEvents.push(event.event)
      if (event.type === 'turn-finished') finalMessage = event.result.finalMessage
    }

    const parentEvents = await parentTranscript.readAll()
    const parentLifecycleEvents = parentEvents
      .filter(event => event.type === 'subagent-lifecycle')
      .map(event => event.event)
    const agentResult = parentEvents.find(
      event => event.type === 'tool-result' && event.result.metadata?.agentName === 'researcher',
    ) as Extract<TranscriptEvent, { type: 'tool-result' }> | undefined
    const metadata = agentResult?.result.metadata as Record<string, any> | undefined
    const subagentTranscriptPath = metadata?.transcriptPath as string | undefined
    const subagentEvents = subagentTranscriptPath
      ? await readTranscriptFile(subagentTranscriptPath)
      : []
    const parentFirstRequest = parentEvents.find(
      event => event.type === 'llm-request',
    ) as Extract<TranscriptEvent, { type: 'llm-request' }> | undefined
    const subagentFirstRequest = subagentEvents.find(
      event => event.type === 'llm-request',
    ) as Extract<TranscriptEvent, { type: 'llm-request' }> | undefined
    const subagentPermission = subagentEvents.find(
      event => event.type === 'permission',
    ) as Extract<TranscriptEvent, { type: 'permission' }> | undefined
    const subagentPermissionSummary = buildPermissionOriginSummary(subagentEvents)
    const firstSubagentUser = subagentEvents.find(
      event => event.type === 'user',
    ) as Extract<TranscriptEvent, { type: 'user' }> | undefined
    const worktreeTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'phase25-worktree-parent',
    })
    const worktreeState: RuntimeSessionState = {
      phase: 'execute',
      permissionMode: 'bypass-local',
      todos: [],
      verificationNotes: [],
      backgroundTasks: [],
      discoveredToolNames: [],
      toolReferenceDeltas: [],
      mcpInstructions: [],
    }
    const worktreeRuntime = createVigilonAgentRuntime({
      modelClient: createWorktreeProbeModel(),
      tools: createCoreToolRegistry(),
      transcript: worktreeTranscript,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript: worktreeTranscript,
      }),
      permissionMode: 'bypass-local',
      resume: {
        sessionId: worktreeTranscript.sessionId,
        transcriptPath: worktreeTranscript.transcriptPath,
        events: [],
        sessionState: worktreeState,
      },
    })
    let worktreeFinalMessage = ''
    for await (const event of worktreeRuntime.runTurn({
      prompt: 'Use worker to verify worktree host isolation.',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'turn-finished') worktreeFinalMessage = event.result.finalMessage
    }
    const worktreeEvents = await worktreeTranscript.readAll()
    const worktreeAgentResult = worktreeEvents.find(
      event => event.type === 'tool-result' && event.result.metadata?.agentName === 'worker',
    ) as Extract<TranscriptEvent, { type: 'tool-result' }> | undefined
    const worktreeMetadata = worktreeAgentResult?.result.metadata as Record<string, any> | undefined
    const worktreeSubagentEvents = worktreeMetadata?.transcriptPath
      ? await readTranscriptFile(worktreeMetadata.transcriptPath)
      : []
    const worktreeUser = worktreeSubagentEvents.find(
      event => event.type === 'user',
    ) as Extract<TranscriptEvent, { type: 'user' }> | undefined
    await worktreeTranscript.append({
      type: 'session-state',
      phase: worktreeState.phase,
      permissionMode: worktreeState.permissionMode,
      todos: [],
      retainedTasks: worktreeMetadata?.taskHost
        ? [
            {
              id: worktreeMetadata.taskHost.taskId,
              type: 'subagent',
              command: `subagent:${worktreeMetadata.agentName ?? 'worker'}`,
              startTime: worktreeMetadata.taskHost.startedAt,
              status: worktreeMetadata.taskHost.status,
              background: worktreeMetadata.taskHost.background,
              agentName: worktreeMetadata.agentName ?? 'worker',
              transcriptPath: worktreeMetadata.taskHost.transcriptPath,
              cwd: worktreeMetadata.taskHost.cwd,
              host: worktreeMetadata.taskHost.host,
              worktreePath: worktreeMetadata.taskHost.worktreePath,
              sourceCwd: worktreeMetadata.taskHost.sourceCwd,
              parentAgentId: 'main',
              completedAt: worktreeMetadata.taskHost.completedAt,
              terminalReason: 'subagent_completed',
              outputSummary: worktreeMetadata.finalMessage,
              worktreeDiff: worktreeMetadata.taskHost.worktreeDiff,
            },
          ]
        : [],
      backgroundTasks: [],
      verificationNotes: [],
      discoveredToolNames: [],
      toolReferenceDeltas: [],
      mcpInstructions: [],
      timestamp: new Date().toISOString(),
    })
    const applyIo = createProbeCliIo()
    const applyExitCode = await runCli(
      [
        'agents',
        'apply',
        worktreeTranscript.sessionId,
        worktreeMetadata?.taskHost?.taskId ?? 'missing-task',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      applyIo,
      {},
    )
    const applyOutput = JSON.parse(applyIo.stdoutText)
    const appliedSourceOutput = await readFile(path.join(cwd, 'subagent-output.txt'), 'utf8').catch(() => '')
    const stopManager = createTaskManager()
    const stopAbortController = new AbortController()
    const registeredStopTaskId = await stopManager.startSubagentTask({
      taskId: 'phase25-stop-subagent',
      agentName: 'researcher',
      transcriptPath: subagentTranscriptPath ?? path.join(sessionsDir, 'missing.jsonl'),
      cwd,
      background: false,
      parentAgentId: 'main',
      abortController: stopAbortController,
    })
    const stopResult = await TaskStopTool.invoke(
      { taskId: registeredStopTaskId },
      { taskManager: stopManager } as unknown as ToolUseContext,
    )
    const backgroundTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'phase25-background-parent',
    })
    const backgroundState: RuntimeSessionState = {
      phase: 'execute',
      permissionMode: 'bypass-local',
      todos: [],
      verificationNotes: [],
      backgroundTasks: [],
      discoveredToolNames: [],
      toolReferenceDeltas: [],
      mcpInstructions: [],
    }
    const backgroundTaskManager = createTaskManager()
    const backgroundRuntime = createVigilonAgentRuntime({
      modelClient: createBackgroundProbeModel(),
      tools: createCoreToolRegistry(),
      transcript: backgroundTranscript,
      taskManager: backgroundTaskManager,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript: backgroundTranscript,
      }),
      permissionMode: 'bypass-local',
      resume: {
        sessionId: backgroundTranscript.sessionId,
        transcriptPath: backgroundTranscript.transcriptPath,
        events: [],
        sessionState: backgroundState,
      },
    })
    let backgroundFinalMessage = ''
    const backgroundLifecycleEvents: any[] = []
    for await (const event of backgroundRuntime.runTurn({
      prompt: 'Start watcher as a background subagent and return after it is registered.',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'subagent-lifecycle') backgroundLifecycleEvents.push(event.event)
      if (event.type === 'turn-finished') backgroundFinalMessage = event.result.finalMessage
    }
    const backgroundParentEvents = await backgroundTranscript.readAll()
    const backgroundAgentResult = backgroundParentEvents.find(
      event => event.type === 'tool-result' && event.result.metadata?.agentName === 'watcher',
    ) as Extract<TranscriptEvent, { type: 'tool-result' }> | undefined
    const backgroundMetadata = backgroundAgentResult?.result.metadata as Record<string, any> | undefined
    const backgroundActiveBeforeStop = backgroundTaskManager.activeTasks.map(task => ({ ...task }))
    const backgroundStopIo = createProbeCliIo()
    const backgroundStopExitCode = await runCli(
      [
        'agents',
        'stop',
        backgroundTranscript.sessionId,
        backgroundMetadata?.taskHost?.taskId ?? 'missing-task',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      backgroundStopIo,
      {},
    )
    const backgroundStopOutput = JSON.parse(backgroundStopIo.stdoutText)
    await waitFor(
      () => backgroundTaskManager.retainedTasks.some(
        task =>
          task.id === backgroundMetadata?.taskHost?.taskId &&
          task.terminalReason === 'cross_process_stop_request:cli',
      ),
      1000,
    )
    const backgroundRetainedAfterStop = backgroundTaskManager.retainedTasks.map(task => ({ ...task }))

    const completionTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'phase25-background-completion-parent',
    })
    const completionState: RuntimeSessionState = {
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
    const completionTaskManager = createTaskManager()
    const completionRuntime = createVigilonAgentRuntime({
      modelClient: createBackgroundCompletionProbeModel(),
      tools: createCoreToolRegistry(),
      transcript: completionTranscript,
      taskManager: completionTaskManager,
      permissionGate: createLocalPermissionGate({
        mode: 'bypass-local',
        transcript: completionTranscript,
      }),
      permissionMode: 'bypass-local',
      resume: {
        sessionId: completionTranscript.sessionId,
        transcriptPath: completionTranscript.transcriptPath,
        events: [],
        sessionState: completionState,
      },
    })
    let completionFinalMessage = ''
    const completionLifecycleEvents: any[] = []
    for await (const event of completionRuntime.runTurn({
      prompt: 'Start finisher as a background subagent and return after it is registered.',
      cwd,
      abortSignal: new AbortController().signal,
    })) {
      if (event.type === 'subagent-lifecycle') completionLifecycleEvents.push(event.event)
      if (event.type === 'turn-finished') completionFinalMessage = event.result.finalMessage
    }
    await waitFor(
      () => completionTaskManager.retainedTasks.some(task => task.agentName === 'finisher'),
      200,
    )
    const completionRetained = completionTaskManager.retainedTasks.find(
      task => task.agentName === 'finisher',
    )
    if (completionRetained) {
      await waitForAsync(async () => {
        const events = await completionTranscript.readAll()
        return events.some(
          event =>
            event.type === 'session-state' &&
            event.retainedTasks?.some(task =>
              task.id === completionRetained.id &&
              task.status === 'completed',
            ),
        )
      }, 500)
    }
    const completionSessionEvents = await completionTranscript.readAll()
    const completionTranscriptLifecycleEvents = completionSessionEvents
      .filter(event => event.type === 'subagent-lifecycle')
      .map(event => event.event)
    const completionReplayState = restoreSessionStateFromEvents(completionSessionEvents)
    const completionTerminalSessionState = completionSessionEvents.find(
      event =>
        event.type === 'session-state' &&
        event.retainedTasks?.some(task => task.agentName === 'finisher'),
    ) as Extract<TranscriptEvent, { type: 'session-state' }> | undefined
    const inventoryResult = await AgentInventoryTool.invoke(
      {},
      {
        cwd,
        taskManager: completionTaskManager,
        sessionState: completionState,
      } as unknown as ToolUseContext,
    )
    const inventoryMetadata = inventoryResult.metadata as Record<string, any> | undefined
    const inspectIo = createProbeCliIo()
    const inspectExitCode = await runCli(
      [
        'agents',
        'inspect',
        completionTranscript.sessionId,
        completionRetained?.id ?? 'missing-task',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      inspectIo,
      {},
    )
    const inspectOutput = JSON.parse(inspectIo.stdoutText)
    const resumeIo = createProbeCliIo()
    const resumeExitCode = await runCli(
      [
        'agents',
        'resume',
        completionTranscript.sessionId,
        completionRetained?.id ?? 'missing-task',
        'continue',
        'retained',
        'subagent',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--permission-mode',
        'bypass-local',
      ],
      resumeIo,
      {
        createModelClient: () => createSubagentResumeProbeModel(),
      },
    )
    const resumeOutput = JSON.parse(resumeIo.stdoutText)
    const resumedParentEvents = await completionTranscript.readAll()
    const resumedParentState = resumedParentEvents.find(
      event =>
        event.type === 'session-state' &&
        event.retainedTasks?.some(
          task =>
            task.id === completionRetained?.id &&
            task.terminalReason === 'subagent_resume_completed',
        ),
    ) as Extract<TranscriptEvent, { type: 'session-state' }> | undefined

    const checks: ProbeCheck[] = [
      {
        name: 'parent AgentTool call completed through real runtime',
        passed:
          finalMessage === 'Parent received subagent handoff.' &&
          agentResult?.result.ok === true,
        details: finalMessage,
      },
      {
        name: 'agent catalog records source precedence and override',
        passed:
          metadata?.catalog?.precedence?.join(',') === 'built-in,plugin,user,project,local,flag,managed' &&
          metadata.catalog.entries.some(
            (entry: any) =>
              entry.name === 'researcher' &&
              entry.source === 'project' &&
              entry.overriddenBy === 'local',
          ),
        details: metadata?.catalog,
      },
      {
        name: 'agent catalog matches Claude Code source parity across plugin, user, project, local, flag, and managed sources',
        passed:
          sourceParityCatalog.precedence.join(',') === 'built-in,plugin,user,project,local,flag,managed' &&
          sourceParityCatalog.active.some(
            agent =>
              agent.name === 'source-probe' &&
              agent.source === 'managed' &&
              agent.description === 'Managed source probe',
          ) &&
          ['plugin', 'user', 'project', 'local', 'flag'].every(source =>
            sourceParityCatalog.entries.some(
              entry =>
                entry.definition.name === 'source-probe' &&
                entry.definition.source === source &&
                entry.overriddenBy === 'managed',
            ),
          ),
        details: sourceParityCatalog,
      },
      {
        name: 'subagent receives parent session and long-term memory snapshot',
        passed:
          metadata?.memorySnapshot?.freshness === 'stale' &&
          metadata.memorySnapshot.longTerm?.entryCount === 1 &&
          metadata.memorySnapshot.longTerm.entries.some(
            (entry: any) =>
              entry.kind === 'project' &&
              entry.topic === 'subagent governance' &&
              entry.content.includes('long-term memory handoff'),
          ) &&
          firstSubagentUser?.content.includes('<vigilon_subagent_memory_snapshot>') === true &&
          firstSubagentUser.content.includes('<vigilon_subagent_long_term_memory>') &&
          firstSubagentUser.content.includes('Subagents must receive manually promoted long-term memory handoff evidence.') &&
          firstSubagentUser.content.includes('Delegate investigation to a focused researcher subagent.'),
        details: metadata?.memorySnapshot,
      },
      {
        name: 'subagent task host metadata is returned',
        passed:
          metadata?.taskHost?.status === 'completed' &&
          metadata.taskHost.host === 'local' &&
          metadata.taskHost.cwd === cwd &&
          metadata.taskHost.transcriptPath === subagentTranscriptPath &&
          typeof metadata.taskHost.taskId === 'string' &&
          metadata.taskHost.registeredWithTaskManager === true &&
          metadata.taskHost.stopPath === 'shared-task-manager',
        details: metadata?.taskHost,
      },
      {
        name: 'forked subagent request shares parent byte-identical cache prefix',
        passed:
          parentFirstRequest?.cachePrefix?.source === 'request' &&
          subagentFirstRequest?.cachePrefix?.source === 'fork-shared-prefix' &&
          subagentFirstRequest.cachePrefix.parentCanonicalPrefixHash ===
            parentFirstRequest.cachePrefix.canonicalPrefixHash &&
          subagentFirstRequest.cachePrefix.canonicalPrefixHash ===
            parentFirstRequest.cachePrefix.canonicalPrefixHash &&
          subagentFirstRequest.cachePrefix.sharedPrefixEventCount ===
            parentFirstRequest.cachePrefix.eventCount,
        details: {
          parent: parentFirstRequest?.cachePrefix,
          subagent: subagentFirstRequest?.cachePrefix,
        },
      },
      {
        name: 'worktree-hosted subagent runs from isolated copied cwd with task metadata',
        passed:
          worktreeFinalMessage === 'Parent received worktree subagent handoff.' &&
          worktreeAgentResult?.result.ok === true &&
          worktreeMetadata?.taskHost?.status === 'completed' &&
          worktreeMetadata.taskHost.host === 'worktree' &&
          typeof worktreeMetadata.taskHost.cwd === 'string' &&
          worktreeMetadata.taskHost.cwd.includes('subagent-worktrees') &&
          worktreeMetadata.taskHost.worktreePath === worktreeMetadata.taskHost.cwd &&
          worktreeMetadata.taskHost.sourceCwd === cwd &&
          worktreeMetadata.taskHost.worktreeDiff?.status === 'changed' &&
          worktreeMetadata.taskHost.worktreeDiff.filesChanged === 1 &&
          worktreeMetadata.taskHost.worktreeDiff.changedFiles.some(
            (file: any) =>
              file.path === 'subagent-output.txt' &&
              file.status === 'added',
          ) &&
          typeof worktreeMetadata.taskHost.worktreeDiff.patchPath === 'string' &&
          worktreeMetadata.taskHost.worktreeDiff.patchPath.endsWith('.worktree.patch') &&
          worktreeMetadata.taskHost.transcriptPath === worktreeMetadata.transcriptPath &&
          worktreeUser?.content.includes('Execution host: worktree') === true &&
          worktreeUser.content.includes('Source cwd:') &&
          worktreeAgentResult.result.content.includes('Worktree subagent verified isolated cwd.'),
        details: {
          finalMessage: worktreeFinalMessage,
          metadata: worktreeMetadata,
          userPrompt: worktreeUser?.content,
          resultContent: worktreeAgentResult?.result.content,
        },
      },
      {
        name: 'worktree subagent diff applies back to source after baseline drift check',
        passed:
          applyExitCode === 0 &&
          applyOutput.status === 'applied' &&
          applyOutput.apply?.strategy === 'git-apply-after-baseline-check' &&
          applyOutput.task?.worktreeDiff?.sourceApply?.status === 'applied' &&
          appliedSourceOutput === 'subagent-output',
        details: {
          applyOutput,
          appliedSourceOutput,
        },
      },
      {
        name: 'subagent lifecycle streams while running and is written to parent transcript',
        passed:
          runtimeLifecycleEvents.some(event => event.status === 'started') &&
          runtimeLifecycleEvents.some(event => event.status === 'model-request-started') &&
          runtimeLifecycleEvents.some(event => event.status === 'model-response-received') &&
          runtimeLifecycleEvents.some(event => event.status === 'tool-started' && event.toolName === 'Bash') &&
          runtimeLifecycleEvents.some(event => event.status === 'tool-finished' && event.toolOk === true) &&
          runtimeLifecycleEvents.some(event => event.status === 'completed') &&
          parentLifecycleEvents.some(
            event =>
              event.status === 'completed' &&
              event.taskId === metadata?.taskHost?.taskId &&
              event.finalMessage === 'Subagent inspected runtime state.',
          ),
        details: {
          streamed: runtimeLifecycleEvents,
          transcript: parentLifecycleEvents,
        },
      },
      {
        name: 'TaskStop can stop a registered subagent task host through the shared path',
        passed:
          stopResult.ok === true &&
          stopAbortController.signal.aborted === true &&
          stopManager.activeTasks.length === 0,
        details: {
          stopResult,
          aborted: stopAbortController.signal.aborted,
          activeTasks: stopManager.activeTasks,
        },
      },
      {
        name: 'background subagent returns running handoff and stays registered after parent turn',
        passed:
          backgroundFinalMessage === 'Parent observed background start.' &&
          backgroundAgentResult?.result.ok === true &&
          backgroundMetadata?.status === 'running' &&
          backgroundMetadata.taskHost?.status === 'running' &&
          backgroundMetadata.taskHost?.background === true &&
          backgroundMetadata.taskHost?.registeredWithTaskManager === true &&
          backgroundMetadata.taskHost?.stopPath === 'shared-task-manager' &&
          backgroundActiveBeforeStop.length === 1 &&
          backgroundActiveBeforeStop[0]?.id === backgroundMetadata.taskHost.taskId &&
          backgroundActiveBeforeStop[0]?.background === true,
        details: {
          finalMessage: backgroundFinalMessage,
          metadata: backgroundMetadata,
          activeBeforeStop: backgroundActiveBeforeStop,
        },
      },
      {
        name: 'background subagent lifecycle emits running handoff before parent turn finishes',
        passed:
          backgroundLifecycleEvents.some(event => event.status === 'started') &&
          backgroundLifecycleEvents.some(
            event =>
              event.status === 'running-handoff' &&
              event.taskId === backgroundMetadata?.taskHost?.taskId,
          ),
        details: backgroundLifecycleEvents,
      },
      {
        name: 'CLI agents stop writes cross-process stop request observed by live subagent host',
        passed:
          backgroundStopExitCode === 0 &&
          backgroundStopOutput.status === 'requested' &&
          typeof backgroundStopOutput.stopRequest?.path === 'string' &&
          backgroundTaskManager.activeTasks.length === 0 &&
          backgroundRetainedAfterStop.some(
            task =>
              task.id === backgroundMetadata?.taskHost?.taskId &&
              task.status === 'stopped' &&
              task.terminalReason === 'cross_process_stop_request:cli' &&
              typeof task.stopRequestedAt === 'string',
          ),
        details: {
          stopOutput: backgroundStopOutput,
          activeTasks: backgroundTaskManager.activeTasks,
          retainedTasks: backgroundRetainedAfterStop,
        },
      },
      {
        name: 'completed background subagent leaves retained terminal output state',
        passed:
          completionFinalMessage === 'Parent observed background completion start.' &&
          completionTaskManager.activeTasks.length === 0 &&
          completionRetained?.status === 'completed' &&
          completionRetained.terminalReason === 'subagent_completed' &&
          completionRetained.outputSummary === 'Background finisher completed.' &&
          completionState.backgroundTasks.length === 0 &&
          completionState.retainedTasks?.some(
            task =>
              task.id === completionRetained.id &&
              task.status === 'completed' &&
              task.outputSummary === 'Background finisher completed.',
          ) === true &&
          completionTerminalSessionState !== undefined &&
          completionReplayState.retainedTasks?.some(
            task =>
              task.id === completionRetained.id &&
              task.status === 'completed' &&
              task.outputSummary === 'Background finisher completed.',
          ) === true &&
          completionLifecycleEvents.some(event => event.status === 'running-handoff') &&
          completionTranscriptLifecycleEvents.some(
            event =>
              event.status === 'completed' &&
              event.taskId === completionRetained.id &&
              event.finalMessage === 'Background finisher completed.',
          ),
        details: {
          finalMessage: completionFinalMessage,
          retainedTask: completionRetained,
          sessionRetainedTasks: completionState.retainedTasks,
          replayedRetainedTasks: completionReplayState.retainedTasks,
          terminalSessionState: completionTerminalSessionState,
          streamedLifecycle: completionLifecycleEvents,
          transcriptLifecycle: completionTranscriptLifecycleEvents,
        },
      },
      {
        name: 'agent inventory exposes catalog overrides and retained task lifecycle state',
        passed:
          inventoryResult.ok === true &&
          inventoryMetadata?.catalog?.precedence?.join(',') === 'built-in,plugin,user,project,local,flag,managed' &&
          inventoryMetadata.catalog.entries.some(
            (entry: any) =>
              entry.name === 'researcher' &&
              entry.source === 'project' &&
              entry.overriddenBy === 'local',
          ) &&
          inventoryMetadata.catalog.active.some(
            (entry: any) =>
              entry.name === 'worker' &&
              entry.host === 'worktree',
          ) &&
          inventoryMetadata.tasks.retained.some(
            (task: any) =>
              task.agentName === 'finisher' &&
              task.status === 'completed' &&
              task.outputSummary === 'Background finisher completed.',
          ) &&
          inventoryResult.content.includes('Retained tasks:') &&
          inventoryResult.content.includes('Background finisher completed.'),
        details: {
          content: inventoryResult.content,
          metadata: inventoryMetadata,
        },
      },
      {
        name: 'CLI agents inspect exposes retained subagent transcript output stream',
        passed:
          inspectExitCode === 0 &&
          inspectOutput.parentSessionId === completionTranscript.sessionId &&
          inspectOutput.task?.id === completionRetained?.id &&
          inspectOutput.outputStream.some(
            (entry: any) =>
              entry.kind === 'assistant' &&
              entry.content === 'Background finisher completed.',
          ),
        details: inspectOutput,
      },
      {
        name: 'CLI agents resume continues subagent transcript and updates parent retained registry',
        passed:
          resumeExitCode === 0 &&
          resumeOutput.parentSessionId === completionTranscript.sessionId &&
          resumeOutput.taskId === completionRetained?.id &&
          resumeOutput.status === 'completed' &&
          resumeOutput.finalMessage === 'Resumed finisher follow-up complete.' &&
          resumeOutput.task?.terminalReason === 'subagent_resume_completed' &&
          resumeOutput.outputStream.some(
            (entry: any) =>
              entry.kind === 'assistant' &&
              entry.content === 'Resumed finisher follow-up complete.',
          ) &&
          resumedParentState !== undefined,
        details: {
          resumeOutput,
          resumedParentState,
        },
      },
              {
                name: 'subagent permission origin is visible in child transcript',
        passed:
          subagentPermission?.request.origin?.agentRole === 'subagent' &&
          subagentPermission.request.origin.parentAgentId === 'main' &&
          subagentPermission.request.policy?.kind === 'bash-safety',
                details: subagentPermission,
              },
              {
                name: 'parent-side permission origin summary is derivable from child transcript',
                passed:
                  subagentPermissionSummary.totalRequests >= 1 &&
                  subagentPermissionSummary.agents.some(
                    agent =>
                      agent.agentRole === 'subagent' &&
                      agent.parentAgentId === 'main' &&
                      agent.tools.includes('Bash'),
                  ) &&
                  subagentPermissionSummary.latest?.origin?.agentRole === 'subagent',
                details: subagentPermissionSummary,
              },
      {
        name: 'subagent transcript and final handoff are auditable from parent result',
        passed:
          typeof subagentTranscriptPath === 'string' &&
          subagentEvents.some(event => event.type === 'assistant' && event.content.includes('Subagent inspected runtime state.')) &&
          metadata?.report?.status === 'completed',
        details: {
          transcriptPath: subagentTranscriptPath,
          eventTypes: subagentEvents.map(event => event.type),
        },
      },
    ]

    const passed = checks.every(check => check.passed)
    console.log(
      JSON.stringify(
        {
          phase: 'P2.5 Subagent / Task Host Runtime',
          status: passed ? 'subagent_probe_ok' : 'subagent_probe_failed',
          closureEvidence: false,
          scope:
                    'Proves the current subagent runtime slice: Claude Code-shaped source-aware catalog precedence, override visibility, agent inventory, session and long-term memory snapshot inheritance, subagent permission origin, parent-side permission origin aggregation, shared task-host registration, copied worktree host isolation, diff artifact capture, baseline-checked source apply, check-only/partial/3-way/rollback apply lifecycle, background running handoff, retained terminal/output state, transcript-backed lifecycle streaming and replay, CLI inspect/resume/stop over retained or running subagent transcripts, TaskStop shared stop path, cross-process stop request observation, isolated transcript, and final handoff. It does not prove full P2.5 closure.',
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

function createProbeModel(): ModelClient {
  let childCalls = 0
  return {
    id: 'phase25-subagent-model',
    async createMessage(request) {
      const isSubagent = request.messages.some(
        message =>
          message.type === 'user' &&
          message.content.includes('You are running as a focused local subagent.'),
      )
      if (isSubagent) {
        childCalls += 1
        if (childCalls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'child-bash-1',
                name: 'Bash',
                input: {
                  command: 'echo subagent-runtime-state',
                  description: 'Inspect delegated runtime state',
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: 'Subagent inspected runtime state.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      const sawAgentResult = request.messages.some(
        message =>
          message.type === 'tool-result' &&
          message.result.metadata?.agentName === 'researcher',
      )
      if (sawAgentResult) {
        return {
          content: 'Parent received subagent handoff.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      return {
        content: '',
        toolCalls: [
          {
            id: 'parent-agent-1',
            name: 'Agent',
            input: {
              agent: 'researcher',
              task: 'Inspect inherited runtime state and report back.',
            },
          } satisfies ToolCall['input'],
        ],
        stopReason: 'tool_use',
      }
    },
  }
}

function createBackgroundProbeModel(): ModelClient {
  return {
    id: 'phase25-background-subagent-model',
    async createMessage(request) {
      const isSubagent = request.messages.some(
        message =>
          message.type === 'user' &&
          message.content.includes('You are running as a focused local subagent.'),
      )
      if (isSubagent) {
        await new Promise<void>(resolve => {
          if (request.abortSignal.aborted) {
            resolve()
            return
          }
          request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        return {
          content: 'Background watcher stopped.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      const sawBackgroundResult = request.messages.some(
        message =>
          message.type === 'tool-result' &&
          message.result.metadata?.agentName === 'watcher' &&
          message.result.metadata.status === 'running',
      )
      if (sawBackgroundResult) {
        return {
          content: 'Parent observed background start.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      return {
        content: '',
        toolCalls: [
          {
            id: 'parent-agent-background-1',
            name: 'Agent',
            input: {
              agent: 'watcher',
              task: 'Run in the background until TaskStop terminates this host.',
            },
          } satisfies ToolCall['input'],
        ],
        stopReason: 'tool_use',
      }
    },
  }
}

function createWorktreeProbeModel(): ModelClient {
  let childCalls = 0
  return {
    id: 'phase25-worktree-subagent-model',
    async createMessage(request) {
      const isWorktreeSubagent = request.messages.some(
        message =>
          message.type === 'user' &&
          message.content.includes('Execution host: worktree'),
      )
      if (isWorktreeSubagent) {
        childCalls += 1
        if (childCalls === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'worktree-bash-1',
                name: 'Bash',
                input: {
                  command: 'pwd && test -f marker.txt && test ! -d .git && test ! -d .vigilon && printf subagent-output > subagent-output.txt',
                  description: 'Verify copied worktree host isolation',
                },
              },
            ],
            stopReason: 'tool_use',
          }
        }
        return {
          content: 'Worktree subagent verified isolated cwd.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      const sawWorkerResult = request.messages.some(
        message =>
          message.type === 'tool-result' &&
          message.result.metadata?.agentName === 'worker',
      )
      if (sawWorkerResult) {
        return {
          content: 'Parent received worktree subagent handoff.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      return {
        content: '',
        toolCalls: [
          {
            id: 'parent-worktree-agent-1',
            name: 'Agent',
            input: {
              agent: 'worker',
              task: 'Verify worktree host isolation and copied source marker.',
            },
          } satisfies ToolCall['input'],
        ],
        stopReason: 'tool_use',
      }
    },
  }
}

function createBackgroundCompletionProbeModel(): ModelClient {
  return {
    id: 'phase25-background-completion-subagent-model',
    async createMessage(request) {
      const isSubagent = request.messages.some(
        message =>
          message.type === 'user' &&
          message.content.includes('You are running as a focused local subagent.'),
      )
      if (isSubagent) {
        return {
          content: 'Background finisher completed.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      const sawBackgroundResult = request.messages.some(
        message =>
          message.type === 'tool-result' &&
          message.result.metadata?.agentName === 'finisher' &&
          message.result.metadata.status === 'running',
      )
      if (sawBackgroundResult) {
        return {
          content: 'Parent observed background completion start.',
          toolCalls: [],
          stopReason: 'end_turn',
        }
      }

      return {
        content: '',
        toolCalls: [
          {
            id: 'parent-agent-background-completion-1',
            name: 'Agent',
            input: {
              agent: 'finisher',
              task: 'Finish quickly in the background so the parent can retain terminal output state.',
            },
          } satisfies ToolCall['input'],
        ],
        stopReason: 'tool_use',
      }
    },
  }
}

function createSubagentResumeProbeModel(): ModelClient {
  return {
    id: 'phase25-subagent-resume-model',
    async createMessage(request) {
      if (
        !request.messages.some(
          message =>
            message.type === 'user' &&
            message.content.includes('<vigilon_subagent_resume'),
        )
      ) {
        return {
          content: 'missing subagent resume marker',
          toolCalls: [],
          stopReason: 'error',
        }
      }
      return {
        content: 'Resumed finisher follow-up complete.',
        toolCalls: [],
        stopReason: 'end_turn',
      }
    },
  }
}

function createProbeCliIo() {
  let stdoutText = ''
  let stderrText = ''
  return {
    env: {},
    stdout: {
      write(chunk: string) {
        stdoutText += chunk
      },
    },
    stderr: {
      write(chunk: string) {
        stderrText += chunk
      },
    },
    get stdoutText() {
      return stdoutText
    },
    get stderrText() {
      return stderrText
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function readTranscriptFile(filePath: string): Promise<TranscriptEvent[]> {
  const raw = await readFile(filePath, 'utf8')
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line) as TranscriptEvent)
}

await main()
