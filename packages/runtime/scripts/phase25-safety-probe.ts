import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BashTool,
  createLocalPermissionGate,
  createTaskManager,
  evaluateBashSafetyPolicy,
  InMemoryTranscriptStore,
  type PermissionPolicyMetadata,
  type ToolUseContext,
} from '../src/index.js'

type ProbeCheck = {
  name: string
  passed: boolean
  details?: unknown
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase25-safety-'))
  try {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'app.txt'), 'alpha\nalpha\n', 'utf8')

    const readOnlyTranscript = new InMemoryTranscriptStore('phase25-safety-readonly')
    const readOnlyContext = createContext(root, 'read-only', readOnlyTranscript)
    const bypassTranscript = new InMemoryTranscriptStore('phase25-safety-bypass')
    const bypassContext = createContext(root, 'bypass-local', bypassTranscript)

    const readPolicy = evaluateBashSafetyPolicy('cat src/app.txt')
    const readResult = await BashTool.invoke(
      { command: 'cat src/app.txt' },
      readOnlyContext,
    )
    const redirectionResult = await BashTool.invoke(
      { command: 'printf blocked > src/blocked.txt' },
      readOnlyContext,
    )
    const wrapperResult = await BashTool.invoke(
      { command: 'sh -c "echo wrapped"' },
      readOnlyContext,
    )
    const sandboxWriteResult = await BashTool.invoke(
      { command: "sed -n '1w src/sandbox-blocked.txt' src/app.txt" },
      readOnlyContext,
    )
    const macSandboxAvailable = await canUseMacSandbox()
    const sandboxBlockedFileExists = await fileExists(
      path.join(root, 'src', 'sandbox-blocked.txt'),
    )
    const highRiskResult = await BashTool.invoke(
      { command: 'rm -rf src' },
      bypassContext,
    )
    const sedResult = await BashTool.invoke(
      { command: "sed -i 's/alpha/beta/g' src/app.txt" },
      bypassContext,
    )
    const editedContent = await readFile(path.join(root, 'src', 'app.txt'), 'utf8')
    const coordinatorTranscript = new InMemoryTranscriptStore('phase25-safety-coordinator')
    const coordinatorGate = createLocalPermissionGate({
      mode: 'read-only',
      transcript: coordinatorTranscript,
    })
    const duplicateRequest = {
      action: 'bash' as const,
      subject: 'sh -c "echo wrapped"',
      risk: 'medium' as const,
      reason: 'wrapper needs one coordinated permission resolution',
      origin: {
        agentId: 'main',
        agentRole: 'main' as const,
        toolName: 'Bash',
      },
      policy: evaluateBashSafetyPolicy('sh -c "echo wrapped"').permissionMetadata,
    }
    const [coordinatorFirst, coordinatorSecond] = await Promise.all([
      coordinatorGate.requestPermission(duplicateRequest),
      coordinatorGate.requestPermission(duplicateRequest),
    ])
    const coordinatorEvents = await coordinatorTranscript.readAll()
    const permissionEvents = await readOnlyTranscript.readAll()
    const readPermission = permissionEvents.find(
      event => event.type === 'permission',
    ) as Extract<Awaited<ReturnType<typeof readOnlyTranscript.readAll>>[number], { type: 'permission' }> | undefined

    const checks: ProbeCheck[] = [
      {
        name: 'read-only shell policy classifies safe file read as sandboxed read',
        passed:
          readPolicy.risk === 'low' &&
          readPolicy.sandboxDecision === 'sandboxed' &&
          readPolicy.readOnly === true &&
          readResult.ok === true,
        details: {
          safetyPolicy: readResult.metadata?.safetyPolicy,
          sandboxRuntime: readResult.metadata?.sandboxRuntime,
        },
      },
      {
        name: 'read-only Bash is OS-sandboxed when the local adapter is available',
        passed:
          macSandboxAvailable
            ? readResult.metadata?.sandboxRuntime != null &&
              (readResult.metadata.sandboxRuntime as { enforced?: unknown }).enforced === true
            : readResult.metadata?.sandboxRuntime != null &&
              (readResult.metadata.sandboxRuntime as { enforced?: unknown }).enforced === false,
        details: readResult.metadata?.sandboxRuntime,
      },
      {
        name: 'OS sandbox blocks a shell-level write missed by local read-only classification',
        passed:
          macSandboxAvailable
            ? sandboxWriteResult.ok === false &&
              sandboxBlockedFileExists === false &&
              policy(sandboxWriteResult.metadata?.safetyPolicy)?.sandboxDecision === 'sandboxed' &&
              (sandboxWriteResult.metadata?.sandboxRuntime as { enforced?: unknown } | undefined)?.enforced === true
            : true,
        details: {
          macSandboxAvailable,
          safetyPolicy: sandboxWriteResult.metadata?.safetyPolicy,
          sandboxRuntime: sandboxWriteResult.metadata?.sandboxRuntime,
          sandboxBlockedFileExists,
        },
      },
      {
        name: 'permission transcript carries policy and main-agent origin',
        passed:
          readPermission?.request.origin?.agentId === 'main' &&
          readPermission.request.origin.agentRole === 'main' &&
          readPermission.request.policy?.kind === 'bash-safety' &&
          readPermission.decision.policy?.sandboxDecision === 'sandboxed',
        details: readPermission,
      },
      {
        name: 'redirection is not read-only and is blocked in read-only mode',
        passed:
          redirectionResult.ok === false &&
          policy(redirectionResult.metadata?.safetyPolicy)?.findings.includes('output_redirection') === true,
        details: redirectionResult.metadata?.safetyPolicy,
      },
      {
        name: 'shell wrapper requires approval instead of broad prefix allow',
        passed:
          wrapperResult.ok === false &&
          policy(wrapperResult.metadata?.safetyPolicy)?.findings.includes('shell_wrapper:sh') === true &&
          policy(wrapperResult.metadata?.safetyPolicy)?.sandboxDecision === 'ask',
        details: wrapperResult.metadata?.safetyPolicy,
      },
      {
        name: 'high-risk destructive command is denied even in bypass-local mode',
        passed:
          highRiskResult.ok === false &&
          policy(highRiskResult.metadata?.safetyPolicy)?.sandboxDecision === 'denied' &&
          policy(highRiskResult.metadata?.safetyPolicy)?.findings.includes('high_risk_command:rm') === true,
        details: highRiskResult.metadata?.safetyPolicy,
      },
      {
        name: 'sed -i is converted to an audited edit surrogate',
        passed:
          sedResult.ok === true &&
          editedContent === 'beta\nbeta\n' &&
          policy(sedResult.metadata?.safetyPolicy)?.surrogate?.kind === 'sed-edit' &&
          typeof sedResult.metadata?.diff === 'string',
        details: {
          safetyPolicy: sedResult.metadata?.safetyPolicy,
          surrogate: sedResult.metadata?.surrogate,
        },
      },
      {
        name: 'permission coordinator resolves duplicate in-flight requests once',
        passed:
          coordinatorFirst.resolution?.status === 'resolved' &&
          coordinatorSecond.resolution?.status === 'joined' &&
          coordinatorFirst.resolution.id === coordinatorSecond.resolution.id &&
          coordinatorEvents.filter(event => event.type === 'permission').length === 2 &&
          coordinatorEvents
            .filter(event => event.type === 'permission')
            .map(event => event.decision.resolution?.status)
            .join(',') === 'resolved,joined',
        details: {
          first: coordinatorFirst,
          second: coordinatorSecond,
          events: coordinatorEvents.filter(event => event.type === 'permission'),
        },
      },
    ]

    const passed = checks.every(check => check.passed)
    console.log(
      JSON.stringify(
        {
          phase: 'P2.5 Safety / Sandbox Runtime',
          status: passed ? 'safety_probe_ok' : 'safety_probe_failed',
          closureEvidence: false,
          scope:
            'Proves the current safety runtime slice: bash safety policy metadata, sandbox decision, OS sandbox enforcement when available, read-only shell constraints, permission origin, resolve-once permission coordination, fail-closed high-risk commands, and sed edit surrogate. It does not prove full P2.5 closure.',
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

function createContext(
  cwd: string,
  mode: 'read-only' | 'bypass-local',
  transcript: InMemoryTranscriptStore,
): ToolUseContext {
  return {
    cwd,
    abortSignal: new AbortController().signal,
    transcript,
    permissionGate: createLocalPermissionGate({ mode, transcript }),
    permissionOrigin: {
      agentId: 'main',
      agentRole: 'main',
      toolName: 'Bash',
    },
    readFileState: new Map(),
    taskManager: createTaskManager(),
    tools: {
      list: () => [],
      find: () => undefined,
    },
    lspServerManager: {
      getAllServers: () => new Map(),
      initialize: async () => {},
      shutdown: async () => {},
    } as ToolUseContext['lspServerManager'],
  }
}

function policy(value: unknown): PermissionPolicyMetadata | undefined {
  return value && typeof value === 'object'
    ? (value as PermissionPolicyMetadata)
    : undefined
}

async function canUseMacSandbox(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  return fileExists('/usr/bin/sandbox-exec')
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

await main()
