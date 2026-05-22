import { describe, expect, it } from 'vitest'
import {
  AskUserQuestionTool,
  createLocalPermissionGate,
  InMemoryTranscriptStore,
  type ToolUseContext,
} from '../src/index.js'

describe('AskUserQuestionTool', () => {
  it('returns structured operator answers as a tool result continuation', async () => {
    const transcript = new InMemoryTranscriptStore()
    const context = createContext('/tmp/project', {
      transcript,
      permissionGate: createLocalPermissionGate({
        mode: 'ask',
        transcript,
      }),
      operator: {
        async askQuestions(input) {
          expect(input.questions).toHaveLength(1)
          return {
            answers: {
              'Which approach should we use?': 'Recommended option',
            },
          }
        },
      },
    })

    const result = await AskUserQuestionTool.invoke(
      {
        questions: [
          {
            question: 'Which approach should we use?',
            header: 'Approach',
            options: [
              {
                label: 'Recommended option',
                description: 'Uses the safer runtime path',
              },
              {
                label: 'Fast option',
                description: 'Skips extra safety checks',
              },
            ],
            multiSelect: false,
          },
        ],
      },
      context,
    )

    expect(result.ok).toBe(true)
    expect(result.content).toContain('User has answered your questions')
    expect(result.content).toContain('Which approach should we use?: Recommended option')
    expect(result.metadata).toMatchObject({
      answers: {
        'Which approach should we use?': 'Recommended option',
      },
    })
    const permissions = (await transcript.readAll()).filter(
      event => event.type === 'permission',
    )
    expect(permissions).toHaveLength(1)
    expect(permissions[0]).toMatchObject({
      request: {
        action: 'ask-user',
      },
      decision: {
        allowed: true,
      },
    })
  })

  it('fails closed when no operator interaction surface is available', async () => {
    const result = await AskUserQuestionTool.invoke(
      {
        questions: [
          {
            question: 'Choose one',
            header: 'Choice',
            options: [
              { label: 'A', description: 'Option A' },
              { label: 'B', description: 'Option B' },
            ],
            multiSelect: false,
          },
        ],
      },
      createContext('/tmp/project', {
        permissionGate: createLocalPermissionGate({ mode: 'ask' }),
      }),
    )

    expect(result.ok).toBe(false)
    expect(result.content).toContain('interactive operator surface')
  })
})

function createContext(
  cwd: string,
  overrides: Partial<ToolUseContext> = {},
): ToolUseContext {
  const transcript = overrides.transcript ?? new InMemoryTranscriptStore()
  return {
    cwd,
    abortSignal: new AbortController().signal,
    transcript,
    permissionGate:
      overrides.permissionGate ??
      createLocalPermissionGate({ mode: 'read-only', transcript }),
    operator: overrides.operator,
    readFileState: overrides.readFileState ?? new Map(),
    fileReadingLimits: overrides.fileReadingLimits,
    globLimits: overrides.globLimits,
    bashLimits: overrides.bashLimits,
    projectConfig: overrides.projectConfig,
  }
}
