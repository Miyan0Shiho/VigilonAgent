import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { runTui } from '../src/index.js'

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'vigilon-phase31-tui-'))
  const cwd = path.join(root, 'repo')
  const sessionsDir = path.join(root, 'sessions')
  await mkdir(cwd, { recursive: true })
  await writeFile(path.join(cwd, 'package.json'), '{"name":"fixture"}\n')

  const io = createIo(
    {
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    },
    [
      'inspect the fixture and produce a handoff',
      '1',
      'y',
      '/sessions',
      '/open 1',
      '/resume 1 continue briefly',
      '/quit',
      '',
    ].join('\n'),
  )
  const exitCode = await runTui(
    ['--cwd', cwd, '--sessions-dir', sessionsDir, '--permission-mode', 'ask'],
    io,
    { createModelClient: () => scriptedModel() },
  )

  const checks = [
    exitCode === 0 ? 'new TUI exited cleanly' : `missing clean exit: ${exitCode}`,
    io.stdoutText.includes('Vigilon Operator Shell')
      ? 'started @vigilon/tui shell'
      : 'missing shell startup',
    io.stdoutText.includes('tool        Read')
      ? 'displayed Read tool activity'
      : 'missing Read tool activity',
    io.stdoutText.includes('tool        Write')
      ? 'displayed Write tool activity'
      : 'missing Write tool activity',
    io.stdoutText.includes('permission')
      ? 'displayed permission request'
      : 'missing permission request',
    io.stdoutText.includes('ask-user')
      ? 'displayed AskUserQuestion block'
      : 'missing AskUserQuestion block',
    io.stdoutText.includes('result      completed')
      ? 'displayed ResultReport handoff'
      : 'missing ResultReport handoff',
    io.stdoutText.includes('Session detail')
      ? 'opened session detail'
      : 'missing session detail',
    io.stdoutText.includes('composer: running session 1')
      ? 'resumed session by index'
      : 'missing resume by index',
  ]
  const passed = checks.every(check => !check.startsWith('missing'))
  console.log(JSON.stringify({
    passed,
    root,
    cwd,
    sessionsDir,
    stdoutPath: path.join(root, 'stdout.txt'),
    checks,
  }, null, 2))
  await writeFile(path.join(root, 'stdout.txt'), io.stdoutText)
  await writeFile(path.join(root, 'stderr.txt'), io.stderrText)
  if (!passed) process.exitCode = 1
}

function createIo(env: NodeJS.ProcessEnv, stdinText: string) {
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
    stdin: Readable.from([stdinText]),
    get stdoutText() {
      return state.stdoutText
    },
    get stderrText() {
      return state.stderrText
    },
  }
}

function scriptedModel() {
  let call = 0
  return {
    id: 'phase31-scripted-model',
    async createMessage() {
      call += 1
      if (call === 1) {
        return {
          content: 'I will inspect the file, ask one operator question, write a note, and record handoff.',
          reasoningContent: 'Need to exercise tool activity, AskUserQuestion, permission, and ResultReport.',
          stopReason: 'tool_use',
          toolCalls: [
            {
              id: 'read-package',
              name: 'Read',
              input: { file_path: 'package.json' },
            },
            {
              id: 'ask-scope',
              name: 'AskUserQuestion',
              input: {
                questions: [
                  {
                    header: 'Scope',
                    question: 'Which handoff style should the fixture use?',
                    options: [
                      { label: 'Concise', description: 'Short operator handoff.' },
                      { label: 'Detailed', description: 'Longer evidence handoff.' },
                    ],
                  },
                ],
              },
            },
            {
              id: 'write-note',
              name: 'Write',
              input: { file_path: 'phase31-note.txt', content: 'Phase 3.1 TUI acceptance fixture.\n' },
            },
            {
              id: 'handoff',
              name: 'ResultReport',
              input: {
                final_message: 'Phase 3.1 scripted TUI fixture completed.',
                changes: ['created phase31-note.txt'],
                verification_notes: ['phase31-tui-acceptance scripted model completed'],
                unverified: ['real terminal raw-mode keyboard interaction not covered by scripted acceptance'],
                risks: ['scripted model validates UI/runtime integration, not visual polish in every terminal'],
              },
            },
          ],
        }
      }
      if (call === 2) {
        return {
          content: 'Phase 3.1 scripted TUI fixture completed.',
          stopReason: 'end_turn',
          toolCalls: [],
        }
      }
      return {
        content: 'Resumed session by index and continued briefly.',
        stopReason: 'end_turn',
        toolCalls: [],
      }
    },
  }
}

void main()
