import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import {
  JsonlTranscriptStore,
  readTranscriptFile,
  runCli,
  type ModelClient,
} from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('runtime CLI', () => {
  it('runs a headless turn and writes a JSONL session', async () => {
    const cwd = await createTempRoot('vigilon-cli-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-sessions-')
    const io = createIo()

    const exitCode = await runCli(
      [
        'run',
        'hello',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--session-id',
        'cli-session',
      ],
      io,
      {
        createModelClient: () => oneShotModel('hello from model'),
      },
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      status: 'completed',
      sessionId: 'cli-session',
      finalMessage: 'hello from model',
    })
    expect(output.transcriptPath).toContain('cli-session.jsonl')
  })

  it('lists sessions and resumes an existing session', async () => {
    const cwd = await createTempRoot('vigilon-cli-resume-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-resume-sessions-')
    const first = createIo()
    await runCli(
      [
        'run',
        'first',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--session-id',
        'resume-me',
      ],
      first,
      { createModelClient: () => oneShotModel('first done') },
    )

    const list = createIo()
    await runCli(['sessions', '--cwd', cwd, '--sessions-dir', sessionsDir], list, {
      createModelClient: () => oneShotModel('unused'),
    })
    expect(JSON.parse(list.stdoutText).sessions).toMatchObject([
      { sessionId: 'resume-me', firstUserMessage: 'first' },
    ])

    const resume = createIo()
    await runCli(
      ['resume', 'resume-me', 'second', '--cwd', cwd, '--sessions-dir', sessionsDir],
      resume,
      {
        createModelClient: () => ({
          id: 'resume-model',
          async createMessage(request) {
            expect(request.messages.map(event => event.type)).toEqual(
              expect.arrayContaining(['user', 'assistant']),
            )
            expect(request.messages.at(-1)).toMatchObject({
              type: 'user',
              content: 'second',
            })
            return { content: 'second done', toolCalls: [], stopReason: 'end_turn' }
          },
        }),
      },
    )

    expect(JSON.parse(resume.stdoutText)).toMatchObject({
      sessionId: 'resume-me',
      finalMessage: 'second done',
    })
  })

  it('generates session memory for an existing session', async () => {
    const cwd = await createTempRoot('vigilon-cli-summary-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-summary-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'summary-me',
    })
    await transcript.append({
      type: 'user',
      content: 'Fix the runtime regressions',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const io = createIo()
    const exitCode = await runCli(
      ['summary', 'summary-me', '--cwd', cwd, '--sessions-dir', sessionsDir],
      io,
      {},
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      sessionId: 'summary-me',
      sourceEventCount: 1,
      fresh: true,
    })
    expect(output.memoryPath).toContain('summary-me.memory.md')
  })

  it('reports doctor details for config, sessions, and model key presence', async () => {
    const cwd = await createTempRoot('vigilon-cli-doctor-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-doctor-sessions-')
    await writeSettings(cwd, {
      sessionsDir,
      permissionMode: 'accept-edits',
      model: 'deepseek-v4-flash',
    })
    const io = createIo({
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
      DEEPSEEK_API_KEY: 'test-key',
    })

    const exitCode = await runCli(['doctor', '--cwd', cwd], io, {})
    const output = JSON.parse(io.stdoutText)

    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      status: 'ok',
      cwd,
      permissionMode: 'accept-edits',
      model: 'deepseek-v4-flash',
      deepseekApiKeyPresent: true,
      loadedSkillCount: expect.any(Number),
      loadedMcpToolCount: expect.any(Number),
    })
    expect(output.sessionsDir).toContain('vigilon-cli-doctor-sessions-')
    expect(output.settingsSources).toMatchObject([
      {
        kind: 'project',
      },
    ])
  })

  it('fails closed through the CLI when DeepSeek credentials are absent', async () => {
    const cwd = await createTempRoot('vigilon-cli-no-key-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-no-key-sessions-')
    const io = createIo({ DEEPSEEK_API_KEY: '' })

    const exitCode = await runCli(
      ['run', 'hello', '--cwd', cwd, '--sessions-dir', sessionsDir],
      io,
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      status: 'error',
      finalMessage: 'DEEPSEEK_API_KEY is not set',
      stopReason: 'error',
    })
  })

  it('prints file changes with diffs in headless run output', async () => {
    const cwd = await createTempRoot('vigilon-cli-diff-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-diff-sessions-')
    const io = createIo()

    await runCli(
      [
        'run',
        'create file',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--permission-mode',
        'bypass-local',
      ],
      io,
      {
        createModelClient: () => {
          let called = false
          return {
            id: 'write-model',
            async createMessage() {
              if (called) {
                return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
              }
              called = true
              return {
                content: '',
                toolCalls: [
                  {
                    id: 'write-1',
                    name: 'Write',
                    input: {
                      file_path: 'src/from-cli.ts',
                      content: 'export const fromCli = true\n',
                    },
                  },
                ],
                stopReason: 'tool_use',
              }
            },
          }
        },
      },
    )

    const output = JSON.parse(io.stdoutText)
    expect(output.report.fileChanges).toMatchObject([
      {
        toolCallId: 'write-1',
        toolName: 'Write',
        type: 'create',
      },
    ])
    expect(output.report.fileChanges[0].diff).toContain('+++ b/src/from-cli.ts')
  })

  it('loads project settings for sessions dir, model, and PreToolUse deny rules', async () => {
    const cwd = await createTempRoot('vigilon-cli-settings-cwd-')
    const sessionsDir = path.join(cwd, '.vigilon', 'sessions-from-settings')
    await writeSettings(cwd, {
      permissionMode: 'bypass-local',
      sessionsDir,
      model: 'deepseek-v4-flash',
      preToolUse: {
        deny: [{ toolName: 'Write', reason: 'settings disabled writes' }],
      },
    })
    const io = createIo({
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    })

    await runCli(['run', 'create file', '--cwd', cwd, '--session-id', 'settings-session'], io, {
      createModelClient: () => {
        let called = false
        return {
          id: 'settings-model',
          async createMessage() {
            if (called) {
              return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
            }
            called = true
            return {
              content: '',
              toolCalls: [
                {
                  id: 'write-from-settings',
                  name: 'Write',
                  input: { file_path: 'blocked.ts', content: 'blocked\n' },
                },
              ],
              stopReason: 'tool_use',
            }
          },
        }
      },
    })

    const output = JSON.parse(io.stdoutText)
    expect(output.transcriptPath).toContain('sessions-from-settings')
    expect(output.report.toolResults).toMatchObject([
      {
        toolCallId: 'write-from-settings',
        ok: false,
      },
    ])
    expect(output.report.toolResults[0].content).toContain('settings disabled writes')
  })

  it('loads project config into model context and filters allowed tools', async () => {
    const cwd = await createTempRoot('vigilon-cli-project-config-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-project-config-sessions-')
    await writeSettings(cwd, {
      sessionsDir,
      project: {
        ignore: ['dist/**'],
        defaultCommands: {
          test: 'pnpm test',
        },
        allowedTools: ['Read'],
      },
    })
    const io = createIo({
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    })

    await runCli(['run', 'inspect project config', '--cwd', cwd], io, {
      createModelClient: () => ({
        id: 'project-config-model',
        async createMessage(request) {
          expect(request.tools.map(tool => tool.name)).toEqual(['Read'])
          const projectConfigMessage = request.messages.find(
            message => message.type === 'project-config',
          )
          expect(projectConfigMessage).toMatchObject({
            type: 'project-config',
            config: {
              ignore: ['dist/**'],
              defaultCommands: { test: 'pnpm test' },
              allowedTools: ['Read'],
            },
          })
          return { content: 'project config loaded', toolCalls: [], stopReason: 'end_turn' }
        },
      }),
    })

    expect(JSON.parse(io.stdoutText)).toMatchObject({
      finalMessage: 'project config loaded',
    })
  })

  it('turns prompt-level search exclusions into project ignore context', async () => {
    const cwd = await createTempRoot('vigilon-cli-prompt-ignore-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-prompt-ignore-sessions-')
    await writeSettings(cwd, { sessionsDir })
    const io = createIo({
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    })

    await runCli(
      [
        'run',
        '搜索项目中 skill 的实现，不搜索 research/.research 等噪音目录，最后给我一个报告',
        '--cwd',
        cwd,
      ],
      io,
      {
        createModelClient: () => ({
          id: 'prompt-ignore-model',
          async createMessage(request) {
            const projectConfigMessage = request.messages.find(
              message => message.type === 'project-config',
            )
            expect(projectConfigMessage).toMatchObject({
              type: 'project-config',
            })
            const config = projectConfigMessage?.type === 'project-config'
              ? projectConfigMessage.config
              : undefined
            expect(config?.ignore).toEqual(
              expect.arrayContaining([
                'research/.research/**',
                '**/research/.research/**',
                'research/**',
                '**/research/**',
                '.research/**',
                '**/.research/**',
                '*research*',
                '*research*/**',
                '**/*research*',
                '**/*research*/**',
              ]),
            )
            return {
              content: 'prompt ignore loaded',
              toolCalls: [],
              stopReason: 'end_turn',
            }
          },
        }),
      },
    )

    expect(JSON.parse(io.stdoutText)).toMatchObject({
      finalMessage: 'prompt ignore loaded',
    })
  })

  it('injects CLI operator guidance for bounded search and optional report handoff', async () => {
    const cwd = await createTempRoot('vigilon-cli-guidance-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-guidance-sessions-')
    const io = createIo({
      VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
    })

    await runCli(
      ['run', 'search project and produce a report', '--cwd', cwd, '--sessions-dir', sessionsDir],
      io,
      {
        createModelClient: () => ({
          id: 'operator-guidance-model',
          async createMessage(request) {
            expect(request.messages[0]).toMatchObject({
              type: 'user',
              content: expect.stringContaining('<vigilon_operator_guidance>'),
            })
            expect(request.messages[0].type === 'user' ? request.messages[0].content : '').toContain(
              'prefer Grep, Glob, Read, and LSP',
            )
            expect(request.messages[0].type === 'user' ? request.messages[0].content : '').toContain(
              'Use ResultReport only when a structured handoff is useful',
            )
            return {
              content: 'guided',
              toolCalls: [],
              stopReason: 'end_turn',
            }
          },
        }),
      },
    )

    expect(JSON.parse(io.stdoutText)).toMatchObject({
      finalMessage: 'guided',
    })
  })

  it('prompts for ask-mode write approval when stdin is available', async () => {
    const cwd = await createTempRoot('vigilon-cli-ask-approval-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-ask-approval-sessions-')
    const io = createIo({}, 'yes\n')

    await runCli(
      [
        'run',
        'create approved file',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--permission-mode',
        'ask',
      ],
      io,
      {
        createModelClient: () => {
          let called = false
          return {
            id: 'ask-approval-model',
            async createMessage() {
              if (called) {
                return { content: 'done', toolCalls: [], stopReason: 'end_turn' }
              }
              called = true
              return {
                content: '',
                toolCalls: [
                  {
                    id: 'write-approved',
                    name: 'Write',
                    input: {
                      file_path: 'approved.txt',
                      content: 'approved\n',
                    },
                  },
                ],
                stopReason: 'tool_use',
              }
            },
          }
        },
      },
    )

    const output = JSON.parse(io.stdoutText)
    expect(io.stderrText).toContain('Vigilon permission request')
    expect(output.report.toolResults).toMatchObject([
      { toolCallId: 'write-approved', ok: true },
    ])
  })

  it('keeps ask mode fail-closed without stdin', async () => {
    const cwd = await createTempRoot('vigilon-cli-ask-headless-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-ask-headless-sessions-')
    const io = createIo()

    await runCli(
      [
        'run',
        'create blocked file',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--permission-mode',
        'ask',
      ],
      io,
      {
        createModelClient: () => {
          let called = false
          return {
            id: 'ask-headless-model',
            async createMessage() {
              if (called) {
                return { content: 'blocked done', toolCalls: [], stopReason: 'end_turn' }
              }
              called = true
              return {
                content: '',
                toolCalls: [
                  {
                    id: 'write-blocked',
                    name: 'Write',
                    input: {
                      file_path: 'blocked.txt',
                      content: 'blocked\n',
                    },
                  },
                ],
                stopReason: 'tool_use',
              }
            },
          }
        },
      },
    )

    const output = JSON.parse(io.stdoutText)
    expect(output.report.toolResults).toMatchObject([
      { toolCallId: 'write-blocked', ok: false },
    ])
    expect(output.report.toolResults[0].content).toContain('ask mode blocks')
  })

  it('approves a pending plan during resume before continuing the runtime turn', async () => {
    const cwd = await createTempRoot('vigilon-cli-approve-plan-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-approve-plan-sessions-')
    const first = createIo()
    let firstCalls = 0

    await runCli(
      [
        'run',
        'plan a change',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--session-id',
        'plan-session',
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
                    input: { plan: '1. Inspect\n2. Edit\n3. Verify' },
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

    const firstOutput = JSON.parse(first.stdoutText)
    expect(firstOutput.report.status).toBe('completed')
    expect(firstOutput.report.toolResults).toMatchObject([
      { toolCallId: 'enter-plan', ok: true },
      { toolCallId: 'exit-plan', ok: false },
    ])

    const resume = createIo()
    await runCli(
      [
        'resume',
        'plan-session',
        '--approve-plan',
        'continue',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
        '--permission-mode',
        'accept-edits',
      ],
      resume,
      {
        createModelClient: () => ({
          id: 'approved-model',
          async createMessage(request) {
            expect(request.messages).toContainEqual(
              expect.objectContaining({
                type: 'session-state',
                phase: 'execute',
                approvedPlan: '1. Inspect\n2. Edit\n3. Verify',
                pendingPlan: null,
              }),
            )
            return {
              content: 'approved continuation',
              toolCalls: [],
              stopReason: 'end_turn',
            }
          },
        }),
      },
    )

    const output = JSON.parse(resume.stdoutText)
    expect(output).toMatchObject({
      sessionId: 'plan-session',
      finalMessage: 'approved continuation',
      report: {
        approvedPlan: '1. Inspect\n2. Edit\n3. Verify',
      },
    })
    const sessionStates = (await readTranscriptFile(output.transcriptPath)).filter(
      event => event.type === 'session-state',
    )
    expect(sessionStates.at(-1)).toMatchObject({
      phase: 'execute',
      permissionMode: 'accept-edits',
      approvedPlan: '1. Inspect\n2. Edit\n3. Verify',
      pendingPlan: null,
    })
  })

  it('runs the lightweight workbench and prints a result handoff', async () => {
    const cwd = await createTempRoot('vigilon-cli-tui-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-tui-sessions-')
    const io = createIo(
      {
        VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
      },
      '/new inspect current runtime state\n/quit\n',
    )

    const exitCode = await runCli(
      ['tui', '--cwd', cwd, '--sessions-dir', sessionsDir],
      io,
      {
        createModelClient: () => oneShotModel('workbench completed'),
      },
    )

    expect(exitCode).toBe(0)
    expect(io.stdoutText).toContain('Vigilon Operator Shell')
    expect(io.stdoutText).toContain('composer: running new task')
    expect(io.stdoutText).toContain('result      completed')
    expect(io.stdoutText).toContain('workbench completed')
  })
})

function oneShotModel(content: string): ModelClient {
  return {
    id: 'fake-model',
    async createMessage() {
      return { content, toolCalls: [], stopReason: 'end_turn' }
    },
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

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writeSettings(cwd: string, value: unknown): Promise<void> {
  const dir = path.join(cwd, '.vigilon')
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'settings.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  )
}
