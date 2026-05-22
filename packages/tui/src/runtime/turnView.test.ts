import { describe, expect, it } from 'vitest'
import { buildTurnOverview, buildTurnViewModel, displayToolName } from './turnView.js'
import type { TuiRuntimeEvent, TuiToolActivity } from './types.js'

describe('turnView', () => {
  it('reports an idle overview with no events', () => {
    const model = buildTurnViewModel([])

    expect(model.overview).toEqual({
      phase: 'idle',
      status: 'idle - no task evidence yet',
      needsAttention: false,
      errors: 0,
      tools: { total: 0, ok: 0 },
    })
    expect(model.toolSummary).toBeNull()
    expect(model.messages).toEqual([])
  })

  it('marks the latest operator prompts as attention states', () => {
    expect(buildTurnOverview([{ type: 'permission', lines: ['allow Bash?'] }]).phase).toBe('blocked')
    expect(buildTurnOverview([{ type: 'ask-user', lines: ['choose'] }]).phase).toBe('question')
    expect(buildTurnOverview([{ type: 'permission', lines: ['allow Bash?'] }]).needsAttention).toBe(true)
    expect(buildTurnOverview([{ type: 'ask-user', lines: ['choose'] }]).needsAttention).toBe(true)
  })

  it('surfaces missing handoff results as a result problem', () => {
    const overview = buildTurnOverview([
      {
        type: 'handoff',
        handoff: {
          status: 'completed',
          finalMessage: '',
          changedFiles: [],
          verification: [],
          unverified: [],
          risks: [],
          todos: [],
          transcriptPath: '/tmp/session.jsonl',
          nextAction: 'none',
          missing: true,
        },
      },
    ])

    expect(overview.phase).toBe('needs result')
    expect(overview.needsAttention).toBe(true)
    expect(overview.status).toContain('no final answer')
  })

  it('counts tool status by latest activity id instead of raw event count', () => {
    const events: TuiRuntimeEvent[] = [
      tool({ id: 'read-1', name: 'Read', status: 'running' }),
      tool({ id: 'read-1', name: 'Read', status: 'ok' }),
      tool({ id: 'grep-1', name: 'Grep', status: 'running' }),
      tool({ id: 'edit-1', name: 'Edit', status: 'error' }),
    ]

    const model = buildTurnViewModel(events, { detailMode: true })

    expect(model.toolSummary).toMatchObject({ running: 1, ok: 1, error: 1 })
    expect(model.overview.tools).toEqual({ total: 3, ok: 1 })
    expect(model.overview.errors).toBe(1)
    expect(model.overview.status).toContain('running Search')
  })

  it('hides working events in focused mode and keeps detail mode richer', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'working', content: 'thinking' },
      { type: 'assistant', content: 'visible' },
      { type: 'user', content: 'prompt' },
    ]

    expect(buildTurnViewModel(events).messages.map(event => event.type)).toEqual(['assistant', 'user'])
    expect(buildTurnViewModel(events, { detailMode: true }).messages.map(event => event.type)).toEqual([
      'working',
      'assistant',
      'user',
    ])
  })

  it('hides assistant reasoning in focused mode and keeps it in detail mode', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'assistant', content: 'visible answer', reasoning: 'private chain of thought' },
    ]

    expect(buildTurnViewModel(events).timeline.map(item => item.label)).toEqual(['assistant'])
    expect(buildTurnViewModel(events, { detailMode: true }).timeline.map(item => item.label)).toEqual([
      'think',
      'assistant',
    ])
  })

  it('shows subagent lifecycle as timeline activity', () => {
    const model = buildTurnViewModel([
      {
        type: 'subagent',
        status: 'tool-started',
        agentName: 'researcher',
        taskId: 'researcher-1',
        summary: 'Subagent researcher started Bash.',
      },
      {
        type: 'subagent',
        status: 'completed',
        agentName: 'researcher',
        taskId: 'researcher-1',
        summary: 'Subagent inspected runtime state.',
      },
    ], { detailMode: true })

    expect(model.timeline.map(item => item.title)).toEqual([
      'researcher tool-started',
      'researcher completed',
    ])
    expect(model.timeline.at(-1)).toMatchObject({
      label: 'agent',
      tone: 'success',
      detail: 'Subagent inspected runtime state.',
    })
  })

  it('shows subscribed background subagent terminal notifications', () => {
    const model = buildTurnViewModel([
      {
        type: 'agent-notification',
        notification: {
          sessionId: 'parent-session',
          taskId: 'task-bg',
          agentName: 'finisher',
          status: 'completed',
          background: true,
          outputSummary: 'Background finisher completed.',
        },
      },
    ])

    expect(model.overview).toMatchObject({
      phase: 'agent',
      status: 'finisher completed; errors=0',
      needsAttention: false,
    })
    expect(model.timeline).toMatchObject([
      {
        label: 'agent',
        title: 'finisher completed',
        detail: 'Background finisher completed.',
        tone: 'success',
      },
    ])
  })

  it('builds one focused timeline with latest tool state and final answer handoff', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: 'hello' },
      { type: 'working', content: 'thinking' },
      tool({ id: 'read-1', name: 'Read', status: 'running' }),
      tool({ id: 'read-1', name: 'Read', status: 'ok' }),
      { type: 'ask-user', lines: ['Choose a path'] },
      {
        type: 'handoff',
        handoff: {
          status: 'completed',
          finalMessage: 'done',
          changedFiles: [],
          verification: [],
          unverified: [],
          risks: [],
          todos: [],
          transcriptPath: '/tmp/session.jsonl',
          nextAction: 'review transcript',
          missing: false,
        },
      },
    ]

    const focused = buildTurnViewModel(events)

    expect(focused.timeline.map(item => item.label)).toEqual(['user', 'tool', 'assistant'])
    expect(focused.timeline.find(item => item.kind === 'tool')).toMatchObject({
      title: 'Read',
    })
    expect(focused.timeline.find(item => item.kind === 'tool')?.meta).toBeUndefined()
    expect(focused.timeline.at(-1)).toMatchObject({
      kind: 'assistant',
      title: 'Assistant',
      detail: 'done',
    })
    expect(focused.timeline.at(-1)?.meta).toBeUndefined()
    const detailed = buildTurnViewModel(events, { detailMode: true })
    expect(detailed.timeline.map(item => item.label)).toContain('work')
    expect(detailed.timeline.find(item => item.kind === 'tool')).toMatchObject({
      title: 'Read running',
      meta: 'tool        Read  id=read-1',
    })
    expect(detailed.timeline.at(-1)?.meta).toContain('result      completed')
  })

  it('folds a successful handoff that duplicates the final assistant message in focused mode', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: 'continue briefly' },
      { type: 'assistant', content: 'done' },
      {
        type: 'handoff',
        handoff: {
          status: 'completed',
          finalMessage: 'done',
          changedFiles: [],
          verification: [],
          unverified: [],
          risks: [],
          todos: [],
          transcriptPath: '/tmp/session.jsonl',
          nextAction: 'review transcript',
          missing: false,
        },
      },
    ]

    expect(buildTurnViewModel(events).timeline.map(item => item.label)).toEqual(['user', 'assistant'])
    expect(buildTurnViewModel(events, { detailMode: true }).timeline.map(item => item.label)).toContain('result')
  })

  it('keeps unresolved focused prompts compact while detail mode keeps reply guidance', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: 'ask before edit' },
      { type: 'ask-user', lines: ['Scope: Which file?'] },
    ]

    const focused = buildTurnViewModel(events)
    const detailed = buildTurnViewModel(events, { detailMode: true })

    expect(focused.timeline.at(-1)).toMatchObject({
      kind: 'prompt',
      label: 'ask-user',
      detail: 'Scope: Which file?',
      meta: undefined,
    })
    expect(detailed.timeline.at(-1)?.meta).toBe('reply with option number or label')
  })

  it('folds resolved operator prompts out of the focused transcript', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: 'ask before edit' },
      { type: 'ask-user', lines: ['Scope: Which file?'] },
      tool({ id: 'ask-1', name: 'AskUserQuestion', status: 'ok', summary: 'answered Scope' }),
      { type: 'permission', lines: ['action: write'] },
      tool({ id: 'write-1', name: 'Write', status: 'ok', summary: 'updated note.txt' }),
    ]

    const focused = buildTurnViewModel(events)
    const detailed = buildTurnViewModel(events, { detailMode: true })

    expect(focused.timeline.map(item => item.label)).toEqual(['user', 'tool'])
    expect(detailed.timeline.map(item => item.label)).toEqual([
      'user',
      'ask-user',
      'tool',
      'permission',
      'tool',
    ])
  })

  it('folds successful control tools from focused mode while keeping failures and detail evidence', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: 'coordinate work' },
      tool({ id: 'todo-1', name: 'TodoWrite', status: 'ok', summary: 'todos updated' }),
      tool({ id: 'ask-1', name: 'AskUserQuestion', status: 'ok', summary: 'operator answered' }),
      tool({ id: 'report-1', name: 'ResultReport', status: 'ok', summary: 'handoff report recorded' }),
      tool({ id: 'report-2', name: 'ResultReport', status: 'error', summary: 'handoff failed' }),
      tool({ id: 'read-1', name: 'Read', status: 'ok', summary: 'package.json' }),
    ]

    const focused = buildTurnViewModel(events)
    const detailed = buildTurnViewModel(events, { detailMode: true })

    expect(focused.timeline.map(item => item.detail)).toEqual([
      'coordinate work',
      'handoff failed',
      'package.json',
    ])
    expect(detailed.timeline.map(item => item.detail)).toEqual([
      'coordinate work',
      'todos updated',
      'operator answered',
      'handoff report recorded',
      'handoff failed',
      'package.json',
    ])
  })

  it('keeps the active operator prompt out of the focused transcript slot', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: 'write a note' },
      {
        type: 'permission',
        lines: ['action: write', 'risk: mutates files'],
      },
    ]

    const focused = buildTurnViewModel(events, { activePromptKind: 'permission' })
    const detailed = buildTurnViewModel(events, {
      activePromptKind: 'permission',
      detailMode: true,
    })

    expect(focused.timeline.map(item => item.label)).toEqual(['user'])
    expect(focused.overview.phase).toBe('blocked')
    expect(detailed.timeline.map(item => item.label)).toEqual(['user', 'permission'])
  })

  it('keeps running tools in status space while preserving detail evidence', () => {
    const events: TuiRuntimeEvent[] = [
      { type: 'user', content: 'inspect package' },
      tool({ id: 'read-1', name: 'Read', status: 'running', summary: 'package.json' }),
    ]

    const focused = buildTurnViewModel(events)
    const detailed = buildTurnViewModel(events, { detailMode: true })

    expect(focused.timeline.map(item => item.label)).toEqual(['user'])
    expect(focused.toolSummary).toMatchObject({
      running: 1,
      latest: {
        id: 'read-1',
        name: 'Read',
        status: 'running',
        summary: 'package.json',
      },
    })
    expect(detailed.timeline.map(item => item.label)).toContain('tool...')
  })

  it('uses stable user-facing tool labels', () => {
    expect(displayToolName('Grep')).toBe('Search')
    expect(displayToolName('AskUserQuestion')).toBe('Ask user')
    expect(displayToolName('UnknownTool')).toBe('UnknownTool')
  })
})

function tool(activity: Partial<TuiToolActivity> & Pick<TuiToolActivity, 'id' | 'name' | 'status'>): TuiRuntimeEvent {
  return {
    type: 'tool',
    activity: {
      summary: `${activity.name} ${activity.status}`,
      ...activity,
    },
  }
}
