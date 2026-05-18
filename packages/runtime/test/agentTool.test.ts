import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentTool, type ToolUseContext } from '../src/index.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.map(root => rm(root, { recursive: true, force: true })))
  tempRoots.length = 0
})

describe('AgentTool', () => {
  it('loads a local agent definition and returns a structured completed result', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'vigilon-agent-tool-'))
    tempRoots.push(cwd)
    await mkdir(path.join(cwd, '.vigilon', 'agents'), { recursive: true })
    await writeFile(
      path.join(cwd, '.vigilon', 'agents', 'researcher.md'),
      [
        '---',
        'description: Research codebase issues',
        'maxTurns: 4',
        'allowedTools:',
        '  - Read',
        '  - Grep',
        '---',
        'You are a focused code research subagent.',
      ].join('\n'),
      'utf8',
    )

    const runSubagent = vi.fn(async (request: any) => ({
      status: 'completed',
      agentName: request.definition.name,
      transcriptPath: '/tmp/subagent.jsonl',
      finalMessage: 'Found likely root cause in runtime layer.',
      report: {
        status: 'completed',
        finalMessage: 'Found likely root cause in runtime layer.',
        todos: [],
        verificationNotes: ['Reviewed runtime entry points'],
        fileChanges: [],
        toolResults: [],
      },
    }))

    const context = {
      cwd,
      permissionGate: {
        requestPermission: vi.fn(async () => ({ allowed: true, reason: 'approved' })),
      },
      runSubagent,
    } as unknown as ToolUseContext

    const result = await AgentTool.invoke(
      {
        agent: 'researcher',
        task: 'Find the likely source of the runtime regressions',
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(runSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          name: 'researcher',
          description: 'Research codebase issues',
          allowedTools: ['Read', 'Grep'],
          maxTurns: 4,
        }),
      }),
    )
    expect(result.metadata).toMatchObject({
      status: 'completed',
      transcriptPath: '/tmp/subagent.jsonl',
      agentName: 'researcher',
    })
    expect(result.content).toContain('Found likely root cause in runtime layer.')
  })
})
