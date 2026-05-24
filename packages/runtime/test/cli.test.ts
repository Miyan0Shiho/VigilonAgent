import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  JsonlTranscriptStore,
  readSessionMemoryExtractionStatus,
  readTranscriptFile,
  runCli,
  type ModelClient,
} from '../src/index.js'

const execFileAsync = promisify(execFile)

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('runtime CLI', () => {
  it('initializes a project with alpha-ready settings and project instructions', async () => {
    const cwd = await createTempRoot('vigilon-cli-init-cwd-')
    await writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({
        scripts: {
          test: 'vitest run',
          typecheck: 'tsc --noEmit',
          build: 'tsc',
        },
      }),
      'utf8',
    )
    await writeFile(path.join(cwd, 'pnpm-lock.yaml'), '', 'utf8')

    const io = createIo({ DEEPSEEK_MODEL: 'deepseek-v4-flash' })
    const exitCode = await runCli(['init', '--cwd', cwd], io)

    const output = JSON.parse(io.stdoutText)
    const settings = JSON.parse(
      await readFile(path.join(cwd, '.vigilon', 'settings.json'), 'utf8'),
    )
    const instructions = await readFile(path.join(cwd, 'AGENTS.md'), 'utf8')
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      status: 'ok',
      settingsPath: path.join(cwd, '.vigilon', 'settings.json'),
      instructionsPath: path.join(cwd, 'AGENTS.md'),
      defaultCommands: {
        test: 'pnpm test',
        typecheck: 'pnpm typecheck',
        build: 'pnpm build',
      },
    })
    expect(settings).toMatchObject({
      model: 'deepseek-v4-flash',
      permissionMode: 'ask',
      project: {
        ignore: expect.arrayContaining(['node_modules/**', '.vigilon/sessions/**']),
        defaultCommands: {
          test: 'pnpm test',
          typecheck: 'pnpm typecheck',
          build: 'pnpm build',
        },
      },
    })
    expect(instructions).toContain('Project Agent Instructions')

    const second = createIo()
    await runCli(['init', '--cwd', cwd], second)
    expect(JSON.parse(second.stdoutText).skipped).toEqual(
      expect.arrayContaining([
        path.join(cwd, '.vigilon', 'settings.json'),
        path.join(cwd, 'AGENTS.md'),
      ]),
    )
  })

  it('lists effective core tools, skills, and MCP tools', async () => {
    const cwd = await createTempRoot('vigilon-cli-tools-cwd-')
    await mkdir(path.join(cwd, '.vigilon', 'skills', 'alpha-skill'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'skills', 'alpha-skill', 'SKILL.md'),
      [
        '---',
        'description: Alpha local skill',
        'allowed-tools: [Read]',
        '---',
        'Use this skill for alpha checks.',
      ].join('\n'),
      'utf8',
    )
    const io = createIo({ VIGILON_DISABLE_GLOBAL_SETTINGS: '1' })

    const exitCode = await runCli(['tools', '--cwd', cwd], io)

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output.coreTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Read' }),
        expect.objectContaining({ name: 'Bash' }),
        expect.objectContaining({ name: 'Agent' }),
      ]),
    )
    expect(output.skills).toEqual([
      expect.objectContaining({
        name: 'alpha-skill',
        description: 'Alpha local skill',
        allowedTools: ['Read'],
      }),
    ])
    expect(output.effectiveToolCount).toBeGreaterThan(output.coreTools.length)
  })

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

  it('lists agent catalog source precedence and overrides', async () => {
    const cwd = await createTempRoot('vigilon-cli-agents-cwd-')
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await mkdir(path.join(cwd, '.vigilon', 'agents.local'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
      [
        '---',
        'description: Project researcher',
        'allowedTools:',
        '  - Read',
        '---',
        'Project researcher prompt.',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(cwd, '.vigilon', 'agents.local', 'researcher.md'),
      [
        '---',
        'description: Local researcher override',
        'background: true',
        'allowedTools:',
        '  - Grep',
        '---',
        'Local researcher prompt.',
      ].join('\n'),
      'utf8',
    )

    const io = createIo()
    const exitCode = await runCli(['agents', '--cwd', cwd], io, {
      createModelClient: () => oneShotModel('unused'),
    })

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output.sourcePrecedence).toEqual([
      'built-in',
      'plugin',
      'user',
      'project',
      'local',
      'flag',
      'managed',
    ])
    expect(output.active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'researcher',
          source: 'local',
          allowedTools: ['Grep'],
          background: true,
        }),
      ]),
    )
    expect(output.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'researcher',
          source: 'project',
          active: false,
          overriddenBy: 'local',
        }),
      ]),
    )
  })

  it('inspects and resumes a retained subagent task through the CLI', async () => {
    const cwd = await createTempRoot('vigilon-cli-agent-resume-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-agent-resume-sessions-')
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
      [
        '---',
        'description: Resumable researcher',
        'maxTurns: 2',
        'allowedTools:',
        '---',
        'Researcher prompt.',
      ].join('\n'),
      'utf8',
    )
    const subagentTranscriptPath = path.join(
      sessionsDir,
      'subagents',
      'researcher',
      'researcher-task-1.jsonl',
    )
    const subagentTranscript = new JsonlTranscriptStore({
      transcriptPath: subagentTranscriptPath,
      sessionId: 'researcher-task-1',
    })
    await subagentTranscript.append({
      type: 'user',
      content: 'Original delegated task',
      timestamp: '2026-05-20T00:00:00Z',
    })
	    await subagentTranscript.append({
	      type: 'assistant',
	      content: 'Initial subagent output.',
	      timestamp: '2026-05-20T00:00:01Z',
	    })
	    await subagentTranscript.append({
	      type: 'permission',
	      request: {
	        action: 'bash',
	        subject: 'pnpm test',
	        risk: 'medium',
	        reason: 'Run validation',
	        origin: {
	          agentId: 'researcher',
	          agentRole: 'subagent',
	          parentAgentId: 'main',
	          toolName: 'Bash',
	        },
	      },
	      decision: {
	        allowed: true,
	        reason: 'operator approved',
	      },
	      timestamp: '2026-05-20T00:00:02Z',
	    })
    const parentTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'parent-agent-session',
    })
    await parentTranscript.append({
      type: 'session-state',
      phase: 'execute',
      permissionMode: 'bypass-local',
      retainedTasks: [
        {
          id: 'researcher-task-1',
          type: 'subagent',
          command: 'subagent:researcher',
          startTime: '2026-05-20T00:00:00Z',
          status: 'completed',
          background: true,
          agentName: 'researcher',
          transcriptPath: subagentTranscriptPath,
          parentAgentId: 'main',
          completedAt: '2026-05-20T00:00:01Z',
          terminalReason: 'subagent_completed',
          outputSummary: 'Initial subagent output.',
        },
      ],
      timestamp: '2026-05-20T00:00:02Z',
    })

    const inspectIo = createIo()
    const inspectExit = await runCli(
      [
        'agents',
        'inspect',
        'parent-agent-session',
        'researcher-task-1',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      inspectIo,
      {},
    )
    const inspectOutput = JSON.parse(inspectIo.stdoutText)
    expect(inspectExit).toBe(0)
	    expect(inspectOutput.outputStream).toEqual(
	      expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant',
          content: 'Initial subagent output.',
        }),
	      ]),
	    )
	    expect(inspectOutput.permissionSummary).toMatchObject({
	      totalRequests: 1,
	      allowed: 1,
	      agents: [
	        expect.objectContaining({
	          agentRole: 'subagent',
	          parentAgentId: 'main',
	          tools: ['Bash'],
	        }),
	      ],
	    })

    const resumeIo = createIo()
    const resumeExit = await runCli(
      [
        'agents',
        'resume',
        'parent-agent-session',
        'researcher-task-1',
        'continue',
        'the',
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
        createModelClient: () => ({
          id: 'subagent-resume-model',
          async createMessage(request) {
            expect(request.systemPrompt).toContain('vigilon_subagent_resume')
            expect(request.messages.at(-1)).toMatchObject({
              type: 'user',
              content: 'continue the subagent',
            })
            return {
              content: 'Resumed subagent completed.',
              toolCalls: [],
              stopReason: 'end_turn',
            }
          },
        }),
      },
    )
    const resumeOutput = JSON.parse(resumeIo.stdoutText)
    expect(resumeExit).toBe(0)
    expect(resumeOutput).toMatchObject({
      parentSessionId: 'parent-agent-session',
      taskId: 'researcher-task-1',
      agentName: 'researcher',
      status: 'completed',
      finalMessage: 'Resumed subagent completed.',
      task: {
        status: 'completed',
        terminalReason: 'subagent_resume_completed',
        outputSummary: 'Resumed subagent completed.',
      },
    })
    expect(resumeOutput.outputStream).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant',
          content: 'Resumed subagent completed.',
        }),
      ]),
    )
    const parentEvents = await parentTranscript.readAll()
    expect(parentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session-state',
          retainedTasks: expect.arrayContaining([
            expect.objectContaining({
              id: 'researcher-task-1',
              terminalReason: 'subagent_resume_completed',
              outputSummary: 'Resumed subagent completed.',
            }),
          ]),
        }),
      ]),
    )
  })

  it('applies a retained worktree subagent diff after baseline drift checks', async () => {
    const cwd = await createTempRoot('vigilon-cli-agent-apply-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-agent-apply-sessions-')
    const baselinePath = await createTempRoot('vigilon-cli-agent-apply-baseline-')
    const worktreePath = await createTempRoot('vigilon-cli-agent-apply-worktree-')
    const patchPath = path.join(sessionsDir, 'subagent.worktree.patch')
    await writeFile(
      patchPath,
      [
        'diff --git a/subagent-output.txt b/subagent-output.txt',
        'new file mode 100644',
        'index 0000000..fc20393',
        '--- /dev/null',
        '+++ b/subagent-output.txt',
        '@@ -0,0 +1 @@',
        '+subagent-output',
        '',
      ].join('\n'),
      'utf8',
    )
    const parentTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'parent-apply-session',
    })
    await parentTranscript.append({
      type: 'session-state',
      phase: 'execute',
      permissionMode: 'bypass-local',
      retainedTasks: [
        {
          id: 'worker-task-1',
          type: 'subagent',
          command: 'subagent:worker',
          startTime: '2026-05-20T00:00:00Z',
          status: 'completed',
          background: false,
          agentName: 'worker',
          transcriptPath: path.join(sessionsDir, 'subagents', 'worker-task-1.jsonl'),
          parentAgentId: 'main',
          completedAt: '2026-05-20T00:00:01Z',
          terminalReason: 'subagent_completed',
          outputSummary: 'Worktree completed.',
          worktreeDiff: {
            strategy: 'copy-baseline-diff',
            status: 'changed',
            sourceCwd: cwd,
            baselinePath,
            worktreePath,
            patchPath,
            filesChanged: 1,
            additions: 1,
            deletions: 0,
            changedFiles: [
              {
                path: 'subagent-output.txt',
                status: 'added',
              },
            ],
          },
        },
      ],
      timestamp: '2026-05-20T00:00:02Z',
    })

    const io = createIo()
    const exitCode = await runCli(
      [
        'agents',
        'apply',
        'parent-apply-session',
        'worker-task-1',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      io,
      {},
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      parentSessionId: 'parent-apply-session',
      taskId: 'worker-task-1',
      status: 'applied',
      applied: true,
      apply: {
        strategy: 'git-apply-after-baseline-check',
        status: 'applied',
        filesChanged: 1,
        checkedFiles: ['subagent-output.txt'],
      },
      task: {
        worktreeDiff: {
          sourceApply: {
            status: 'applied',
          },
        },
      },
    })
    await expect(readFile(path.join(cwd, 'subagent-output.txt'), 'utf8')).resolves.toBe('subagent-output\n')
    const parentEvents = await parentTranscript.readAll()
    expect(parentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session-state',
          retainedTasks: expect.arrayContaining([
            expect.objectContaining({
              id: 'worker-task-1',
              worktreeDiff: expect.objectContaining({
                sourceApply: expect.objectContaining({
                  status: 'applied',
                }),
              }),
            }),
          ]),
          verificationNotes: expect.arrayContaining([
            'subagent worktree apply applied: worker-task-1 (1 files)',
          ]),
        }),
      ]),
    )
  })

  it('supports check-only, partial apply, and rollback for a retained worktree diff', async () => {
    const cwd = await createTempRoot('vigilon-cli-agent-apply-partial-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-agent-apply-partial-sessions-')
    const baselinePath = await createTempRoot('vigilon-cli-agent-apply-partial-baseline-')
    const worktreePath = await createTempRoot('vigilon-cli-agent-apply-partial-worktree-')
    const patchPath = path.join(sessionsDir, 'subagent-partial.worktree.patch')
    await writeFile(
      patchPath,
      [
        'diff --git a/a.txt b/a.txt',
        'new file mode 100644',
        'index 0000000..7898192',
        '--- /dev/null',
        '+++ b/a.txt',
        '@@ -0,0 +1 @@',
        '+a',
        'diff --git a/b.txt b/b.txt',
        'new file mode 100644',
        'index 0000000..6178079',
        '--- /dev/null',
        '+++ b/b.txt',
        '@@ -0,0 +1 @@',
        '+b',
        '',
      ].join('\n'),
      'utf8',
    )
    const parentTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'parent-partial-apply-session',
    })
    await parentTranscript.append({
      type: 'session-state',
      phase: 'execute',
      permissionMode: 'bypass-local',
      retainedTasks: [
        {
          id: 'worker-task-partial',
          type: 'subagent',
          command: 'subagent:worker',
          startTime: '2026-05-20T00:00:00Z',
          status: 'completed',
          background: false,
          agentName: 'worker',
          transcriptPath: path.join(sessionsDir, 'subagents', 'worker-task-partial.jsonl'),
          parentAgentId: 'main',
          terminalReason: 'subagent_completed',
          worktreeDiff: {
            strategy: 'copy-baseline-diff',
            status: 'changed',
            sourceCwd: cwd,
            baselinePath,
            worktreePath,
            patchPath,
            filesChanged: 2,
            additions: 2,
            deletions: 0,
            changedFiles: [
              { path: 'a.txt', status: 'added' },
              { path: 'b.txt', status: 'added' },
            ],
          },
        },
      ],
      timestamp: '2026-05-20T00:00:02Z',
    })

    const checkIo = createIo()
    await runCli(
      [
        'agents',
        'apply',
        'parent-partial-apply-session',
        'worker-task-partial',
        '--check',
        '--files',
        'a.txt',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      checkIo,
      {},
    )
    expect(JSON.parse(checkIo.stdoutText)).toMatchObject({
      status: 'checked',
      applied: false,
      apply: {
        mode: 'check',
        checkedFiles: ['a.txt'],
        skippedFiles: ['b.txt'],
        appliedFiles: [],
      },
    })
    await expect(readFile(path.join(cwd, 'a.txt'), 'utf8')).rejects.toThrow()

    const applyIo = createIo()
    await runCli(
      [
        'agents',
        'apply',
        'parent-partial-apply-session',
        'worker-task-partial',
        '--files',
        'a.txt',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      applyIo,
      {},
    )
    expect(JSON.parse(applyIo.stdoutText)).toMatchObject({
      status: 'applied',
      apply: {
        mode: 'apply',
        appliedFiles: ['a.txt'],
        skippedFiles: ['b.txt'],
      },
    })
    await expect(readFile(path.join(cwd, 'a.txt'), 'utf8')).resolves.toBe('a\n')
    await expect(readFile(path.join(cwd, 'b.txt'), 'utf8')).rejects.toThrow()

    const rollbackIo = createIo()
    await runCli(
      [
        'agents',
        'apply',
        'parent-partial-apply-session',
        'worker-task-partial',
        '--rollback',
        '--files',
        'a.txt',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      rollbackIo,
      {},
    )
    expect(JSON.parse(rollbackIo.stdoutText)).toMatchObject({
      status: 'rolled_back',
      apply: {
        mode: 'rollback',
        appliedFiles: ['a.txt'],
        skippedFiles: ['b.txt'],
      },
    })
    await expect(readFile(path.join(cwd, 'a.txt'), 'utf8')).rejects.toThrow()
  })

  it('reports a conflict instead of applying when source drifted from the subagent baseline', async () => {
    const cwd = await createTempRoot('vigilon-cli-agent-apply-conflict-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-agent-apply-conflict-sessions-')
    const baselinePath = await createTempRoot('vigilon-cli-agent-apply-conflict-baseline-')
    const worktreePath = await createTempRoot('vigilon-cli-agent-apply-conflict-worktree-')
    await writeFile(path.join(cwd, 'existing.txt'), 'source drift\n', 'utf8')
    await writeFile(path.join(baselinePath, 'existing.txt'), 'baseline\n', 'utf8')
    const patchPath = path.join(sessionsDir, 'subagent-conflict.worktree.patch')
    await writeFile(
      patchPath,
      [
        'diff --git a/existing.txt b/existing.txt',
        'index df967b9..2f9a147 100644',
        '--- a/existing.txt',
        '+++ b/existing.txt',
        '@@ -1 +1 @@',
        '-baseline',
        '+subagent change',
        '',
      ].join('\n'),
      'utf8',
    )
    const parentTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'parent-conflict-session',
    })
    await parentTranscript.append({
      type: 'session-state',
      phase: 'execute',
      permissionMode: 'bypass-local',
      retainedTasks: [
        {
          id: 'worker-task-conflict',
          type: 'subagent',
          command: 'subagent:worker',
          startTime: '2026-05-20T00:00:00Z',
          status: 'completed',
          background: false,
          agentName: 'worker',
          transcriptPath: path.join(sessionsDir, 'subagents', 'worker-task-conflict.jsonl'),
          parentAgentId: 'main',
          terminalReason: 'subagent_completed',
          worktreeDiff: {
            strategy: 'copy-baseline-diff',
            status: 'changed',
            sourceCwd: cwd,
            baselinePath,
            worktreePath,
            patchPath,
            filesChanged: 1,
            additions: 1,
            deletions: 1,
            changedFiles: [
              {
                path: 'existing.txt',
                status: 'modified',
              },
            ],
          },
        },
      ],
      timestamp: '2026-05-20T00:00:02Z',
    })

    const io = createIo()
    const exitCode = await runCli(
      [
        'agents',
        'apply',
        'parent-conflict-session',
        'worker-task-conflict',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      io,
      {},
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      status: 'conflict',
      applied: false,
      apply: {
        conflicts: ['existing.txt'],
      },
    })
    await expect(readFile(path.join(cwd, 'existing.txt'), 'utf8')).resolves.toBe('source drift\n')
  })

  it('applies a retained git-worktree subagent diff against the recorded base HEAD', async () => {
    const cwd = await createTempRoot('vigilon-cli-agent-apply-git-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-agent-apply-git-sessions-')
    await writeFile(path.join(cwd, 'marker.txt'), 'git apply marker\n', 'utf8')
    await execFileAsync('git', ['init'], { cwd })
    await execFileAsync('git', ['config', 'user.email', 'vigilon@example.test'], { cwd })
    await execFileAsync('git', ['config', 'user.name', 'Vigilon Test'], { cwd })
    await execFileAsync('git', ['add', 'marker.txt'], { cwd })
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd })
    const { stdout: baseHead } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })
    const patchPath = path.join(sessionsDir, 'git-subagent.worktree.patch')
    await writeFile(
      patchPath,
      [
        'diff --git a/git-output.txt b/git-output.txt',
        'new file mode 100644',
        'index 0000000..d5fa46c',
        '--- /dev/null',
        '+++ b/git-output.txt',
        '@@ -0,0 +1 @@',
        '+git-output',
        '',
      ].join('\n'),
      'utf8',
    )
    const parentTranscript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'parent-git-apply-session',
    })
    await parentTranscript.append({
      type: 'session-state',
      phase: 'execute',
      permissionMode: 'bypass-local',
      retainedTasks: [
        {
          id: 'git-worker-task-1',
          type: 'subagent',
          command: 'subagent:worker',
          startTime: '2026-05-20T00:00:00Z',
          status: 'completed',
          background: false,
          agentName: 'worker',
          transcriptPath: path.join(sessionsDir, 'subagents', 'git-worker-task-1.jsonl'),
          parentAgentId: 'main',
          terminalReason: 'subagent_completed',
          worktreePath: path.join(sessionsDir, 'git-worktree'),
          sourceCwd: cwd,
          host: 'git-worktree',
          worktreeDiff: {
            strategy: 'git-worktree-diff',
            status: 'changed',
            sourceCwd: cwd,
            baselinePath: cwd,
            baselineRef: baseHead.trim(),
            worktreePath: path.join(sessionsDir, 'git-worktree'),
            patchPath,
            gitWorktree: {
              gitRoot: cwd,
              worktreePath: path.join(sessionsDir, 'git-worktree'),
              branchName: 'vigilon/subagent/worker/git-worker-task-1',
              baseHead: baseHead.trim(),
            },
            filesChanged: 1,
            additions: 1,
            deletions: 0,
            changedFiles: [
              {
                path: 'git-output.txt',
                status: 'added',
              },
            ],
          },
        },
      ],
      timestamp: '2026-05-20T00:00:02Z',
    })

    const threeWayCheckIo = createIo()
    await runCli(
      [
        'agents',
        'apply',
        'parent-git-apply-session',
        'git-worker-task-1',
        '--check',
        '--3way',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      threeWayCheckIo,
      {},
    )
    expect(JSON.parse(threeWayCheckIo.stdoutText)).toMatchObject({
      status: 'checked',
      applied: false,
      apply: {
        mode: 'check',
        threeWay: true,
        baselineRef: baseHead.trim(),
      },
    })
    await expect(readFile(path.join(cwd, 'git-output.txt'), 'utf8')).rejects.toThrow()

    const io = createIo()
    const exitCode = await runCli(
      [
        'agents',
        'apply',
        'parent-git-apply-session',
        'git-worker-task-1',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      io,
      {},
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      status: 'applied',
      applied: true,
      apply: {
        baselineRef: baseHead.trim(),
        gitWorktree: {
          branchName: 'vigilon/subagent/worker/git-worker-task-1',
        },
      },
    })
    await expect(readFile(path.join(cwd, 'git-output.txt'), 'utf8')).resolves.toBe('git-output\n')
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

  it('runs manual compact from the CLI after synchronizing session memory', async () => {
    const cwd = await createTempRoot('vigilon-cli-compact-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-compact-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'compact-me',
    })
    await transcript.append({
      type: 'user',
      content: 'Start a long governance task',
      timestamp: '2026-05-18T00:00:00Z',
    })
    await transcript.append({
      type: 'assistant',
      content: 'Plan accepted for compact governance',
      timestamp: '2026-05-18T00:00:01Z',
    })
    await transcript.append({
      type: 'user',
      content: 'Continue with verification evidence',
      timestamp: '2026-05-18T00:00:02Z',
    })

    const io = createIo()
    expect(
      await runCli(
        [
          'compact',
          'compact-me',
          '--reactive-events',
          '1',
          '--token-budget',
          '100',
          '--pressure-threshold',
          '0.5',
          '--cwd',
          cwd,
          '--sessions-dir',
          sessionsDir,
        ],
        io,
        {},
      ),
    ).toBe(0)

    const output = JSON.parse(io.stdoutText)
    expect(output).toMatchObject({
      sessionId: 'compact-me',
      compacted: true,
      summarySource: 'refreshed-session-memory',
      memoryReadiness: {
        before: null,
        after: 'fresh',
        refreshed: true,
        extraction: {
          status: 'completed',
          trigger: 'compact',
          sourceEventCount: 3,
        },
      },
      boundary: {
        trigger: 'manual',
        route: {
          strategy: 'session-memory',
        },
        preservedSegment: {
          preservedEventCount: 1,
        },
        postCompactCleanup: {
          completed: true,
        },
        memoryFreshness: 'fresh',
        memoryReadiness: {
          refreshed: true,
          extraction: {
            status: 'completed',
            trigger: 'compact',
          },
        },
      },
    })
    const events = await readTranscriptFile(output.transcriptPath)
    expect(events.some(event => event.type === 'compact-boundary')).toBe(true)
  })

  it('runs manual compact with model-grounded memory validation when requested', async () => {
    const cwd = await createTempRoot('vigilon-cli-compact-grounded-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-compact-grounded-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'compact-grounded',
    })
    await transcript.append({
      type: 'user',
      content: 'Ground memory before compacting the transcript',
      timestamp: '2026-05-18T00:00:00Z',
    })
    await transcript.append({
      type: 'assistant',
      content: 'The compact summary should carry model grounding evidence.',
      timestamp: '2026-05-18T00:00:01Z',
    })

    const io = createIo()
    const exitCode = await runCli(
      [
        'compact',
        'compact-grounded',
        '--validate-memory',
        '--reactive-events',
        '0',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      io,
      {
        createModelClient: () => ({
          id: 'cli-grounding-model',
          async createMessage() {
            return {
              content: JSON.stringify({
                status: 'supported',
                supportedClaims: ['The transcript asks to ground memory before compacting.'],
                contradictedClaims: [],
                missingClaims: [],
                reason: 'The evidence matches the generated session memory.',
              }),
              toolCalls: [],
              stopReason: 'end_turn',
            }
          },
        }),
      },
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output.memoryReadiness.groundingValidation).toMatchObject({
      kind: 'vigilon.session-memory-grounding',
      status: 'supported',
      modelId: 'cli-grounding-model',
      supportedClaims: ['The transcript asks to ground memory before compacting.'],
    })
    expect(output.boundary.memoryReadiness.groundingValidation).toMatchObject({
      status: 'supported',
      modelId: 'cli-grounding-model',
    })
    expect(output.memoryReadiness).toMatchObject({
      ready: true,
      blockingReasons: [],
      validationRequired: true,
    })
  })

  it('blocks memory-first compact when required grounding contradicts session memory', async () => {
    const cwd = await createTempRoot('vigilon-cli-compact-contradicted-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-compact-contradicted-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'compact-contradicted',
    })
    await transcript.append({
      type: 'user',
      content: 'Keep evidence before compacting.',
      timestamp: '2026-05-18T00:00:00Z',
    })
    await transcript.append({
      type: 'assistant',
      content: 'The future compact summary must be grounded.',
      timestamp: '2026-05-18T00:00:01Z',
    })

    const io = createIo()
    const exitCode = await runCli(
      [
        'compact',
        'compact-contradicted',
        '--validate-memory',
        '--reactive-events',
        '0',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      io,
      {
        createModelClient: () => ({
          id: 'cli-contradicting-grounding-model',
          async createMessage() {
            return {
              content: JSON.stringify({
                status: 'contradicted',
                supportedClaims: [],
                contradictedClaims: ['The memory conflicts with newer transcript evidence.'],
                missingClaims: [],
                reason: 'The compact memory is not supported.',
              }),
              toolCalls: [],
              stopReason: 'end_turn',
            }
          },
        }),
      },
    )

    expect(exitCode).toBe(1)
    expect(io.stderrText).toContain('compact memory readiness blocked: session_memory_grounding_contradicted')
    const events = await readTranscriptFile(transcript.transcriptPath)
    expect(events.some(event => event.type === 'compact-boundary')).toBe(false)
  })

  it('views, edits, and deletes governed session memory from the CLI', async () => {
    const cwd = await createTempRoot('vigilon-cli-memory-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-memory-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'memory-me',
    })
    await transcript.append({
      type: 'user',
      content: 'Capture the memory lifecycle',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const writeIo = createIo()
    expect(
      await runCli(
        [
          'memory',
          'write',
          'memory-me',
          '--content',
          '## Current Task\nCapture the memory lifecycle',
          '--cwd',
          cwd,
          '--sessions-dir',
          sessionsDir,
        ],
        writeIo,
        {},
      ),
    ).toBe(0)
    const writeOutput = JSON.parse(writeIo.stdoutText)
    expect(writeOutput).toMatchObject({
      exists: true,
      freshness: 'fresh',
      content: expect.stringContaining('Capture the memory lifecycle'),
      manifest: {
        kind: 'vigilon.session-memory',
        sourceEventCount: 1,
      },
    })

    const viewIo = createIo()
    expect(
      await runCli(
        ['memory', 'view', 'memory-me', '--cwd', cwd, '--sessions-dir', sessionsDir],
        viewIo,
        {},
      ),
    ).toBe(0)
    expect(JSON.parse(viewIo.stdoutText)).toMatchObject({
      exists: true,
      content: expect.stringContaining('Capture the memory lifecycle'),
    })

    await transcript.append({
      type: 'assistant',
      content: 'The transcript moved forward after memory was written.',
      timestamp: '2026-05-18T00:00:10Z',
    })
    const statusIo = createIo()
    expect(
      await runCli(
        ['memory', 'status', 'memory-me', '--cwd', cwd, '--sessions-dir', sessionsDir],
        statusIo,
        {},
      ),
    ).toBe(0)
    expect(JSON.parse(statusIo.stdoutText)).toMatchObject({
      exists: true,
      freshness: 'stale',
      driftCaveat: expect.stringContaining('may be outdated'),
    })

    const deleteIo = createIo()
    expect(
      await runCli(
        ['memory', 'delete', 'memory-me', '--cwd', cwd, '--sessions-dir', sessionsDir],
        deleteIo,
        {},
      ),
    ).toBe(0)
    expect(JSON.parse(deleteIo.stdoutText)).toMatchObject({
      sessionId: 'memory-me',
      deleted: true,
    })
  })

  it('queues a background session-memory refresh from the CLI', async () => {
    const cwd = await createTempRoot('vigilon-cli-memory-refresh-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-memory-refresh-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'refresh-memory-me',
    })
    await transcript.append({
      type: 'user',
      content: 'Refresh memory through the background worker',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const io = createIo()
    expect(
      await runCli(
        [
          'memory',
          'refresh',
          'refresh-memory-me',
          '--background',
          '--cwd',
          cwd,
          '--sessions-dir',
          sessionsDir,
        ],
        io,
        {},
      ),
    ).toBe(0)

    const output = JSON.parse(io.stdoutText)
    expect(output).toMatchObject({
      sessionId: 'refresh-memory-me',
      queued: true,
      background: true,
      extraction: {
        status: 'queued',
        trigger: 'manual',
        sourceEventCount: 1,
      },
    })

    const completed = await waitForExtraction(output.extraction.memoryPath)
    expect(completed).toMatchObject({
      status: 'completed',
      outputSummary: 'Wrote session memory from 1 transcript events.',
    })
  })

  it('validates session memory directly through the provider grounding contract', async () => {
    const cwd = await createTempRoot('vigilon-cli-memory-validate-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-memory-validate-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'validate-memory-me',
    })
    await transcript.append({
      type: 'user',
      content: 'Validate memory before compact readiness.',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const io = createIo()
    const exitCode = await runCli(
      [
        'memory',
        'validate',
        'validate-memory-me',
        '--refresh',
        '--cwd',
        cwd,
        '--sessions-dir',
        sessionsDir,
      ],
      io,
      {
        createModelClient: () => ({
          id: 'cli-memory-validate-model',
          async createMessage() {
            return {
              content: JSON.stringify({
                status: 'supported',
                supportedClaims: ['The transcript asks to validate memory before compact readiness.'],
                contradictedClaims: [],
                missingClaims: [],
                reason: 'The generated memory is grounded in the transcript.',
              }),
              toolCalls: [],
              stopReason: 'end_turn',
            }
          },
        }),
      },
    )

    const output = JSON.parse(io.stdoutText)
    expect(exitCode).toBe(0)
    expect(output).toMatchObject({
      sessionId: 'validate-memory-me',
      validated: true,
      providerGrounded: true,
      readiness: {
        ready: true,
        blockingReasons: [],
        validationRequired: true,
        refreshed: true,
        groundingValidation: {
          status: 'supported',
          modelId: 'cli-memory-validate-model',
        },
      },
    })
  })

  it('manually promotes typed long-term memory and rejects unsafe promotion content', async () => {
    const cwd = await createTempRoot('vigilon-cli-long-memory-cwd-')
    const sessionsDir = await createTempRoot('vigilon-cli-long-memory-sessions-')
    const transcript = new JsonlTranscriptStore({
      cwd,
      sessionsDir,
      sessionId: 'long-memory-me',
    })
    await transcript.append({
      type: 'user',
      content: 'Define P2.5 memory policy',
      timestamp: '2026-05-18T00:00:00Z',
    })

    const promoteIo = createIo()
    expect(
      await runCli(
        [
          'memory',
          'promote',
          'long-memory-me',
          '--type',
          'project',
          '--topic',
          'runtime governance',
          '--content',
          'P2.5 long-term memory must be manual, typed, file-backed, and auditable.',
          '--cwd',
          cwd,
          '--sessions-dir',
          sessionsDir,
        ],
        promoteIo,
        {},
      ),
    ).toBe(0)
    const promoteOutput = JSON.parse(promoteIo.stdoutText)
    expect(promoteOutput).toMatchObject({
      sessionId: 'long-memory-me',
      promoted: true,
      decision: {
        status: 'allowed',
      },
      entry: {
        kind: 'project',
        topic: 'runtime governance',
        source: {
          sessionId: 'long-memory-me',
          sourceEventCount: 1,
        },
      },
      entryCount: 1,
    })
    expect(await readFile(promoteOutput.indexPath, 'utf8')).toContain(
      'Manual promotion only',
    )
    expect(await readFile(promoteOutput.entry.topicPath, 'utf8')).toContain(
      'P2.5 long-term memory must be manual',
    )

    const rejectIo = createIo()
    expect(
      await runCli(
        [
          'memory',
          'promote',
          'long-memory-me',
          '--type',
          'project',
          '--topic',
          'tool noise',
          '--content',
          'Command failed with ENOENT while reading package.json',
          '--cwd',
          cwd,
          '--sessions-dir',
          sessionsDir,
        ],
        rejectIo,
        {},
      ),
    ).toBe(0)
    expect(JSON.parse(rejectIo.stdoutText)).toMatchObject({
      promoted: false,
      decision: {
        status: 'rejected',
        rejectedCategories: ['transient_execution_noise'],
      },
      entry: null,
      entryCount: 1,
    })
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
          expect(request.systemPrompt).toContain('Ignored paths')
          expect(request.systemPrompt).toContain('dist/**')
          expect(request.systemPrompt).toContain('test=pnpm test')
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
            expect(request.systemPrompt).toContain('research')
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
    await writeFile(
      path.join(cwd, 'AGENTS.md'),
      'Always treat alpha scope as a whiteboard Agent baseline.\n',
      'utf8',
    )
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
          expect(request.systemPrompt).toContain('prefer Grep, Glob, Read')
          expect(request.systemPrompt).toContain('Use ResultReport only when a structured handoff is useful')
          expect(request.systemPrompt).toContain('whiteboard Agent baseline')
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

  it('runs the lightweight workbench and prints a focused final answer', async () => {
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
    expect(io.stdoutText).toContain('> inspect current runtime state')
    expect(io.stdoutText).not.toContain('status:')
    expect(io.stdoutText).not.toContain('mode prompt')
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

async function waitForExtraction(memoryPath: string): Promise<unknown> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const status = await readSessionMemoryExtractionStatus(memoryPath)
    if (status?.status === 'completed' || status?.status === 'failed') {
      return status
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for session-memory extraction')
}
