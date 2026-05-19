import { describe, expect, it } from 'vitest'
import { buildSessionRow, buildSessionViewModel } from './sessionView.js'
import type { TuiSessionSummary } from './types.js'

describe('sessionView', () => {
  it('prioritizes operator attention while preserving command indexes from the source list', () => {
    const sessions = [
      session({ sessionId: 'done-1', status: 'completed', finalMessage: 'done' }),
      session({ sessionId: 'approve-2', status: 'completed', pendingPlan: 'ship plan' }),
      session({ sessionId: 'failed-3', status: 'failed' }),
    ]

    const model = buildSessionViewModel(sessions)

    expect(model.headline).toBe('2 need attention · 3 sessions')
    expect(model.rows.map(row => row.label)).toEqual(['approve', 'failed', 'done'])
    expect(model.rows.map(row => row.commandIndex)).toEqual([2, 3, 1])
    expect(model.rows[0]?.commandHint).toBe('/approve 2')
    expect(model.rows[1]?.commandHint).toBe('/open 3')
  })

  it('marks completed sessions without final answers as result problems', () => {
    const row = buildSessionRow(session({ status: 'completed', finalMessage: undefined }), 1)

    expect(row.label).toBe('result?')
    expect(row.needsAttention).toBe(true)
    expect(row.context).toContain('without a final answer')
  })

  it('keeps running sessions visible without treating them as operator-blocked', () => {
    const row = buildSessionRow(session({ status: 'running', lastAction: 'Read package.json' }), 4)

    expect(row.label).toBe('running')
    expect(row.needsAttention).toBe(false)
    expect(row.commandHint).toBe('/open 4')
    expect(row.context).toBe('last: Read package.json')
  })

  it('limits visible rows after priority sorting', () => {
    const model = buildSessionViewModel([
      session({ sessionId: 'a', status: 'completed', finalMessage: 'ok' }),
      session({ sessionId: 'b', status: 'failed' }),
      session({ sessionId: 'c', status: 'completed', pendingPlan: 'plan' }),
    ], { limit: 2 })

    expect(model.visibleRows.map(row => row.session.sessionId)).toEqual(['c', 'b'])
    expect(model.hiddenCount).toBe(1)
  })
})

function session(overrides: Partial<TuiSessionSummary>): TuiSessionSummary {
  return {
    sessionId: 'session-1',
    transcriptPath: '/tmp/session.jsonl',
    eventCount: 3,
    status: 'completed',
    title: 'Example task',
    verificationCount: 0,
    completedTodoCount: 0,
    remainingTodoCount: 0,
    backgroundTaskCount: 0,
    hasHandoffReport: false,
    ...overrides,
  }
}
