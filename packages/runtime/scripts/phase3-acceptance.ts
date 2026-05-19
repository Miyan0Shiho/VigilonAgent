import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import {
  listSessions,
  readTranscriptFile,
  runCli,
  type ModelClient,
} from '../src/index.js'

type ScenarioResult = {
  name: string
  passed: boolean
  checks: string[]
  transcriptPath?: string
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase3-acceptance-'))
  const results = [
    await runWorkbenchTaskScenario(root),
    await runWorkbenchApproveScenario(root),
    await runDoctorScenario(root),
  ]
  const passed = results.every(result => result.passed)
  console.log(JSON.stringify({ passed, root, results }, null, 2))
  if (!passed) process.exitCode = 1
}

async function runWorkbenchTaskScenario(root: string): Promise<ScenarioResult> {
  const cwd = path.join(root, 'repo-workbench-run')
  const sessionsDir = path.join(root, 'sessions-workbench-run')
  await mkdir(cwd, { recursive: true })
  const io = createIo(
    {
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    },
    'inspect the repo state\n/quit\n',
  )

  const exitCode = await runCli(
    ['tui', '--cwd', cwd, '--sessions-dir', sessionsDir],
    io,
    { createModelClient: () => oneShotModel('workbench acceptance done') },
  )

  const sessions = await listSessions({ cwd, sessionsDir })
  const transcriptPath = sessions[0]?.transcriptPath
  const checks = [
    exitCode === 0 ? 'tui exited cleanly' : `unexpected exit ${exitCode}`,
    io.stdoutText.includes('Vigilon Operator Shell')
      ? 'rendered operator shell'
      : 'missing operator shell',
    io.stdoutText.includes('result      completed')
      ? 'rendered result handoff'
      : 'missing result handoff',
    sessions.length === 1 ? 'session recorded' : `unexpected session count ${sessions.length}`,
  ]

  return {
    name: 'workbench-run',
    passed: checks.every(check => !check.startsWith('unexpected') && !check.startsWith('missing')),
    checks,
    transcriptPath,
  }
}

async function runWorkbenchApproveScenario(root: string): Promise<ScenarioResult> {
  const cwd = path.join(root, 'repo-workbench-approve')
  const sessionsDir = path.join(root, 'sessions-workbench-approve')
  await mkdir(cwd, { recursive: true })

  const first = createIo({ VIGILON_DISABLE_GLOBAL_SETTINGS: '1' })
  let firstCalls = 0
  await runCli(
    [
      'run',
      'plan the packaging work',
      '--cwd',
      cwd,
      '--sessions-dir',
      sessionsDir,
      '--session-id',
      'approve-me',
      '--permission-mode',
      'ask',
    ],
    first,
    {
      createModelClient: () => ({
        id: 'plan-model',
        async createMessage() {
          firstCalls += 1
          if (firstCalls === 1) {
            return {
              content: '',
              toolCalls: [
                {
                  id: 'enter-plan',
                  name: 'EnterPlanMode',
                  input: { reason: 'needs approval' },
                },
              ],
              stopReason: 'tool_use',
            }
          }
          if (firstCalls === 2) {
            return {
              content: '',
              toolCalls: [
                {
                  id: 'exit-plan',
                  name: 'ExitPlanMode',
                  input: { plan: '1. Package\n2. Verify' },
                },
              ],
              stopReason: 'tool_use',
            }
          }
          return {
            content: 'waiting for approval',
            toolCalls: [],
            stopReason: 'end_turn',
          }
        },
      }),
    },
  )

  const approveIo = createIo(
    { VIGILON_DISABLE_GLOBAL_SETTINGS: '1' },
    '/approve approve-me continue after approval\n/quit\n',
  )
  const approveExitCode = await runCli(
    ['tui', '--cwd', cwd, '--sessions-dir', sessionsDir, '--permission-mode', 'accept-edits'],
    approveIo,
    { createModelClient: () => oneShotModel('approved continuation complete') },
  )

  const transcript = await readTranscriptFile(
    path.join(
      sessionsDir,
      cwd.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''),
      'approve-me.jsonl',
    ),
  )
  const checks = [
    approveExitCode === 0 ? 'approve flow exited cleanly' : `unexpected exit ${approveExitCode}`,
    approveIo.stdoutText.includes('approved continuation complete')
      ? 'approved session resumed'
      : 'missing approved continuation output',
    transcript.some(
      event =>
        event.type === 'session-state' &&
        event.phase === 'execute' &&
        event.approvedPlan === '1. Package\n2. Verify',
    )
      ? 'approved plan persisted'
      : 'missing approved plan persistence',
  ]

  return {
    name: 'workbench-approve',
    passed: checks.every(check => !check.startsWith('unexpected') && !check.startsWith('missing')),
    checks,
    transcriptPath: path.join(
      sessionsDir,
      cwd.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''),
      'approve-me.jsonl',
    ),
  }
}

async function runDoctorScenario(root: string): Promise<ScenarioResult> {
  const cwd = path.join(root, 'repo-doctor')
  const sessionsDir = path.join(root, 'sessions-doctor')
  await mkdir(path.join(cwd, '.vigilon'), { recursive: true })
  await writeFile(
    path.join(cwd, '.vigilon', 'settings.json'),
    `${JSON.stringify(
      {
        sessionsDir,
        permissionMode: 'accept-edits',
        model: 'deepseek-v4-flash',
      },
      null,
      2,
    )}\n`,
  )

  const io = createIo({
    VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    DEEPSEEK_API_KEY: 'phase3-test-key',
  })
  const exitCode = await runCli(['doctor', '--cwd', cwd], io, {})
  const output = JSON.parse(io.stdoutText) as {
    deepseekApiKeyPresent: boolean
    permissionMode: string
    model: string
  }
  const checks = [
    exitCode === 0 ? 'doctor exited cleanly' : `unexpected exit ${exitCode}`,
    output.deepseekApiKeyPresent ? 'doctor found api key' : 'missing api key detection',
    output.permissionMode === 'accept-edits'
      ? 'doctor resolved permission mode'
      : 'missing permission mode resolution',
    output.model === 'deepseek-v4-flash'
      ? 'doctor resolved model'
      : 'missing model resolution',
  ]
  return {
    name: 'doctor',
    passed: checks.every(check => !check.startsWith('unexpected') && !check.startsWith('missing')),
    checks,
  }
}

function createIo(env: NodeJS.ProcessEnv = {}, stdinText?: string) {
  const state = {
    stdoutText: '',
    stderrText: '',
  }
  return {
    env,
    stdout: {
      write(chunk: string) {
        state.stdoutText += chunk
      },
    },
    stderr: {
      write(chunk: string) {
        state.stderrText += chunk
      },
    },
    stdin: stdinText === undefined ? undefined : Readable.from([stdinText]),
    get stdoutText() {
      return state.stdoutText
    },
    get stderrText() {
      return state.stderrText
    },
  }
}

function oneShotModel(content: string): ModelClient {
  return {
    id: 'phase3-acceptance-model',
    async createMessage() {
      return { content, toolCalls: [], stopReason: 'end_turn' }
    },
  }
}

void main()
