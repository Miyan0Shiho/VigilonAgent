import { describe, expect, it } from 'vitest'
import { buildOperatorViewModel } from './operatorView.js'
import type { PendingPrompt } from './lineReader.js'
import type { TuiRuntimeEvent, TuiSessionSummary } from './types.js'

describe('buildOperatorViewModel', () => {
  it('prioritizes pending operator choices over session backlog', () => {
    const model = buildOperatorViewModel({
      sessions: [session({ pendingPlan: 'review plan' })],
      events: [],
      status: 'ready',
      running: false,
      pendingPrompt: choicePrompt(),
    })

    expect(model.mode).toBe('question')
    expect(model.title).toBe('operator input')
    expect(model.headline).toBe('Permission required')
    expect(model.composerMode).toBe('answer')
    expect(model.commandHint).toBe('number selects · Tab stages · Enter answers')
    expect(model.nextAction).toContain('Press a number')
    expect(model.spine[0]).toMatchObject({
      kind: 'prompt',
      label: 'answer',
      title: 'Permission required',
      priority: 10,
    })
  })

  it('turn errors outrank stale sessions once the runtime is idle', () => {
    const model = buildOperatorViewModel({
      sessions: [session({ memoryFreshness: 'stale' })],
      events: [{ type: 'error', content: 'failed to run tool' }],
      status: 'error',
      running: false,
    })

    expect(model.mode).toBe('error')
    expect(model.tone).toBe('danger')
    expect(model.nextAction).toContain('Inspect the current turn')
    expect(model.spine[0]?.label).toBe('error')
  })

  it('surfaces session attention before accepting unrelated ready work', () => {
    const model = buildOperatorViewModel({
      sessions: [session({ pendingPlan: 'needs approval' })],
      events: [],
      status: 'ready',
      running: false,
    })

    expect(model.mode).toBe('attention')
    expect(model.headline).toBe('1 need attention · 1 sessions')
    expect(model.nextAction).toContain('/approve 1')
    expect(model.spine[0]).toMatchObject({
      kind: 'session',
      label: 'approve',
      action: '/approve 1',
    })
  })

  it('uses command completion guidance only while composing commands', () => {
    const model = buildOperatorViewModel({
      sessions: [],
      events: [],
      status: 'ready',
      running: false,
      inputValue: '/res',
    })

    expect(model.mode).toBe('ready')
    expect(model.composerHint).toBe('Tab completes the highlighted command; Enter runs it')
    expect(model.commandHint).toBe('Tab completes · Enter runs · /help lists commands')
  })

  it('keeps running turns focused on current activity', () => {
    const events: TuiRuntimeEvent[] = [
      {
        type: 'tool',
        activity: {
          id: 'read-1',
          name: 'Read',
          status: 'running',
          summary: 'reading package.json',
        },
      },
    ]
    const model = buildOperatorViewModel({
      sessions: [session({ pendingPlan: 'later' })],
      events,
      status: 'running new task',
      running: true,
    })

    expect(model.mode).toBe('working')
    expect(model.headline).toContain('running Read')
    expect(model.composerMode).toBe('working')
    expect(model.commandHint).toBe('Ctrl-C requests interrupt · Ctrl-D details')
    expect(model.spine.map(item => item.kind)).toEqual(['turn', 'session'])
  })

  it('puts incomplete result evidence before lower-priority session review', () => {
    const model = buildOperatorViewModel({
      sessions: [session({ memoryFreshness: 'stale' })],
      events: [
        {
          type: 'handoff',
          handoff: {
            status: 'completed',
            finalMessage: '',
            changedFiles: [],
            verification: [],
            unverified: ['no verification'],
            risks: [],
            todos: [],
            transcriptPath: '/tmp/session.jsonl',
            nextAction: 'Open transcript',
            missing: true,
          },
        },
      ],
      status: 'ready',
      running: false,
    })

    expect(model.spine.map(item => item.kind).slice(0, 3)).toEqual(['turn', 'result', 'session'])
    expect(model.spine[0]?.label).toBe('needs result')
    expect(model.spine[1]?.label).toBe('result?')
  })
})

function choicePrompt(): PendingPrompt {
  return {
    id: 1,
    request: {
      kind: 'permission',
      title: 'Permission required',
      lines: ['Allow Write?'],
      choices: [
        { key: '1', label: 'Allow', value: 'allow' },
        { key: '2', label: 'Deny', value: 'deny' },
      ],
    },
    resolve() {},
  }
}

function session(overrides: Partial<TuiSessionSummary> = {}): TuiSessionSummary {
  return {
    sessionId: 'session-0000000001',
    transcriptPath: '/tmp/session.jsonl',
    eventCount: 4,
    status: 'completed',
    title: 'Inspect repo',
    finalMessage: 'done',
    verificationCount: 1,
    completedTodoCount: 1,
    remainingTodoCount: 0,
    backgroundTaskCount: 0,
    hasHandoffReport: true,
    ...overrides,
  }
}
