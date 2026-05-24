import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import type { InteractivePromptController, PendingPrompt } from '../runtime/lineReader.js'
import type {
  TuiRuntimeAdapter,
  TuiRuntimeEvent,
  TuiAgentView,
  TuiCompactResult,
  TuiSessionDetail,
  TuiSessionSummary,
} from '../runtime/types.js'
import {
  backspacePromptBuffer,
  createPromptBuffer,
  deletePromptBuffer,
  insertPromptText,
  movePromptCursor,
  replacePromptBuffer,
  type PromptBufferState,
} from '../runtime/promptBuffer.js'
import {
  firstCommandSuggestion,
  formatCommandHelpLines,
  getCommandSuggestions,
  parseTuiCommand,
} from '../runtime/commandCatalog.js'
import { buildOperatorViewModel } from '../runtime/operatorView.js'
import type { TuiSessionTone } from '../runtime/sessionView.js'
import { Composer } from './Composer.js'
import { MessageStream } from './MessageStream.js'

export function InteractiveOperatorShell({
  adapter,
  promptController,
  initialSessions,
}: {
  adapter: TuiRuntimeAdapter
  promptController: InteractivePromptController
  initialSessions: TuiSessionSummary[]
}): React.ReactElement {
  const { exit } = useApp()
  const [sessions, setSessions] = useState(initialSessions)
  const [events, setEvents] = useState<TuiRuntimeEvent[]>([])
  const [input, setInput] = useState<PromptBufferState>(() => createPromptBuffer())
  const [status, setStatus] = useState('ready')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [historyDraft, setHistoryDraft] = useState('')
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null)
  const [sessionDetail, setSessionDetail] = useState<TuiSessionDetail | null>(null)
  const [agentView, setAgentView] = useState<TuiAgentView | null>(null)
  const [compactResult, setCompactResult] = useState<TuiCompactResult | null>(null)
  const [doctor, setDoctor] = useState<Record<string, unknown> | null>(null)
  const [detailMode, setDetailMode] = useState(false)
  const [sessionListVisible, setSessionListVisible] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [cacheHitRatio, setCacheHitRatio] = useState<number | undefined>(undefined)

  useEffect(() => promptController.subscribe(setPendingPrompt), [promptController])
  useEffect(() => adapter.subscribeAgentTaskNotifications(event => {
    setEvents(current => [...current, event])
    if (event.type === 'agent-notification') {
      const notification = event.notification
      const replay = notification.replayed ? ' replayed' : ''
      setStatus(`background subagent${replay} ${notification.agentName ?? notification.taskId} ${notification.status}`)
      void adapter.listSessions().then(setSessions).catch(() => undefined)
      void adapter.listAgents()
        .then(view => setAgentView(current => current ? view : current))
        .catch(() => undefined)
    }
  }), [adapter])

  const operator = useMemo(() => buildOperatorViewModel({
    sessions,
    events,
    status,
    running,
    pendingPrompt,
    inputValue: input.value,
    detailMode,
  }), [detailMode, events, input.value, pendingPrompt, running, sessions, status])
  const commandSuggestions = useMemo(
    () => pendingPrompt || running ? [] : getCommandSuggestions(input.value),
    [input.value, pendingPrompt, running],
  )

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      setStatus('interrupt requested; current runtime turn is not abortable yet')
      return
    }
    if (key.ctrl && value === 'd') {
      setDetailMode(current => !current)
      setStatus(detailMode ? 'details hidden' : 'details visible')
      return
    }
    if (pendingPrompt?.request?.choices?.length && value) {
      const matchedChoice = pendingPrompt.request.choices.find(choice => choice.key === value)
      if (matchedChoice) {
        answerPendingPrompt(matchedChoice.value)
        return
      }
    }
    if (key.return) {
      void submitInput()
      return
    }
    if (key.backspace) {
      setInput(backspacePromptBuffer)
      return
    }
    if (key.delete) {
      setInput(deletePromptBuffer)
      return
    }
    if (key.leftArrow) {
      setInput(current => movePromptCursor(current, 'left'))
      return
    }
    if (key.rightArrow) {
      setInput(current => movePromptCursor(current, 'right'))
      return
    }
    if (key.ctrl && value === 'a') {
      setInput(current => movePromptCursor(current, 'start'))
      return
    }
    if (key.ctrl && value === 'e') {
      setInput(current => movePromptCursor(current, 'end'))
      return
    }
    if (key.upArrow) {
      if (history.length === 0) return
      if (historyIndex === null) setHistoryDraft(input.value)
      const nextIndex = historyIndex === null
        ? history.length - 1
        : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIndex)
      setInput(replacePromptBuffer(history[nextIndex] ?? ''))
      return
    }
    if (key.downArrow) {
      if (history.length === 0 || historyIndex === null) return
      const nextIndex = historyIndex + 1
      if (nextIndex >= history.length) {
        setHistoryIndex(null)
        setInput(replacePromptBuffer(historyDraft))
        setHistoryDraft('')
        return
      }
      setHistoryIndex(nextIndex)
      setInput(replacePromptBuffer(history[nextIndex] ?? ''))
      return
    }
    if (key.tab) {
      const pendingChoice = pendingPrompt?.request?.choices?.[0]
      if (pendingChoice) {
        setInput(replacePromptBuffer(pendingChoice.value))
        return
      }
      const suggestion = firstCommandSuggestion(input.value)
      if (suggestion) {
        setInput(replacePromptBuffer(`${suggestion.usage.split(' ')[0]} `))
      }
      return
    }
    if (key.escape || key.ctrl || key.meta) {
      return
    }
    if (value) {
      setInput(current => insertPromptText(current, value))
      setHistoryIndex(null)
    }
  })

  async function submitInput(): Promise<void> {
    const raw = input.value.trim()
    if (!raw && !pendingPrompt?.request?.choices?.length) return
    setInput(createPromptBuffer())
    setHistoryIndex(null)
    setHistoryDraft('')
    if (raw) setHistory(current => raw.startsWith('/') ? current : [...current, raw])

    if (pendingPrompt) {
      answerPendingPrompt(raw || pendingPrompt.request?.choices?.[0]?.value || '')
      return
    }

    if (running) {
      setStatus('turn already running')
      return
    }

    const parsedCommand = parseTuiCommand(raw)
    if (raw.startsWith('/') && !parsedCommand) {
      setStatus(`unknown command: ${raw.split(/\s+/, 1)[0]}; type /help`)
      return
    }

    if (parsedCommand?.definition.name === 'quit') {
      await adapter.close()
      exit()
      return
    }
    if (parsedCommand?.definition.name === 'help') {
      setEvents(current => [
        ...current,
        {
          type: 'working',
          content: `Commands:\n${formatCommandHelpLines().join('\n')}`,
        },
      ])
      return
    }
    if (parsedCommand?.definition.name === 'clear') {
      setEvents([])
      setSessionDetail(null)
      setAgentView(null)
      setCompactResult(null)
      setDoctor(null)
      setSessionListVisible(false)
      setStatus('cleared')
      return
    }
    if (parsedCommand?.definition.name === 'sessions') {
      setCompactResult(null)
      const next = await adapter.listSessions()
      setSessions(next)
      setSessionListVisible(true)
      setStatus(`loaded ${next.length} sessions`)
      return
    }
    if (parsedCommand?.definition.name === 'agents') {
      await runAgentsCommand(parsedCommand.args)
      return
    }
    if (parsedCommand?.definition.name === 'compact') {
      await runCompactCommand(parsedCommand.args)
      return
    }
    if (parsedCommand?.definition.name === 'details') {
      setDetailMode(current => !current)
      setStatus(detailMode ? 'details hidden' : 'details visible')
      return
    }
    if (parsedCommand?.definition.name === 'doctor') {
      setCompactResult(null)
      setDoctor(await adapter.doctor())
      setStatus('doctor complete')
      return
    }
    if (parsedCommand?.definition.name === 'open') {
      setCompactResult(null)
      const detail = await adapter.openSession(parsedCommand.args)
      setSessionDetail(detail)
      setSessionListVisible(false)
      setStatus(detail ? `opened ${detail.session.sessionId}` : 'no session matched')
      return
    }
    if (parsedCommand?.definition.name === 'resume' || parsedCommand?.definition.name === 'approve') {
      const approvePlan = parsedCommand.definition.name === 'approve'
      const command = parsedCommand.args
      const [selector, ...promptParts] = command.split(' ').filter(Boolean)
      if (!selector) {
        setStatus(`${approvePlan ? '/approve' : '/resume'} requires a session id or index`)
        return
      }
      await runTurn({
        prompt: promptParts.join(' ').trim() || 'Continue with the approved plan.',
        sessionSelector: selector,
        approvePlan,
      })
      return
    }

    const prompt = parsedCommand?.definition.name === 'new' ? parsedCommand.args : raw
    if (!prompt.trim()) {
      setStatus('/new requires a prompt')
      return
    }
    if (parsedCommand?.definition.name === 'new') {
      setActiveSessionId(null)
    }
    await runTurn({
      prompt,
      sessionSelector: parsedCommand?.definition.name === 'new' ? undefined : activeSessionId ?? undefined,
    })
  }

  async function runTurn(input: {
    prompt: string
    sessionSelector?: string
    approvePlan?: boolean
  }): Promise<void> {
    setRunning(true)
    setStatus(input.sessionSelector ? `running session ${input.sessionSelector}` : 'running new task')
    setSessionDetail(null)
    setAgentView(null)
    setCompactResult(null)
    setDoctor(null)
    try {
      const result = await adapter.runTask({
        ...input,
        onEvent: event => {
          setEvents(current => [...current, event])
          if (event.type === 'cache') setCacheHitRatio(event.ratio)
        },
      })
      setActiveSessionId(result.sessionId)
      const nextSessions = await adapter.listSessions()
      setSessions(nextSessions)
      setStatus('ready')
    } catch (error) {
      setEvents(current => [
        ...current,
        {
          type: 'error',
          content: error instanceof Error ? error.message : String(error),
        },
      ])
      setStatus('error')
    } finally {
      setRunning(false)
    }
  }

  function answerPendingPrompt(raw: string): void {
    const answer = resolvePendingPromptAnswer(raw, pendingPrompt)
    promptController.answer(answer)
    setInput(createPromptBuffer())
    setHistoryIndex(null)
    setHistoryDraft('')
    setStatus(`answered prompt: ${answer}`)
  }

  async function runAgentsCommand(args: string): Promise<void> {
    const [subcommand, sessionSelector, taskId, ...promptParts] = args.split(' ').filter(Boolean)
    setSessionDetail(null)
    setCompactResult(null)
    setDoctor(null)
    if (!subcommand) {
      const view = await adapter.listAgents()
      setAgentView(view)
      setStatus(`loaded ${view.definitions.filter(definition => definition.active).length} agents and ${view.tasks.length} subagent tasks`)
      return
    }
    if (subcommand === 'inspect') {
      if (!sessionSelector || !taskId) {
        setStatus('/agents inspect requires <session> <task-id>')
        return
      }
      const view = await adapter.inspectAgentTask(sessionSelector, taskId)
      setAgentView(view)
      setStatus(view?.detail ? `opened subagent ${view.detail.task.id}` : 'no subagent task matched')
      return
    }
    if (subcommand === 'resume') {
      if (!sessionSelector || !taskId) {
        setStatus('/agents resume requires <session> <task-id> <prompt>')
        return
      }
      setRunning(true)
      setStatus(`resuming subagent ${taskId}`)
      try {
        const view = await adapter.resumeAgentTask({
          sessionSelector,
          taskId,
          prompt: promptParts.join(' ').trim() || 'Continue from the parent retained task state.',
        })
        setAgentView(view)
        setSessions(await adapter.listSessions())
        setStatus(view?.detail ? `resumed subagent ${view.detail.task.id}` : 'no subagent task matched')
      } catch (error) {
        setEvents(current => [
          ...current,
          {
            type: 'error',
            content: error instanceof Error ? error.message : String(error),
          },
        ])
        setStatus('error')
      } finally {
        setRunning(false)
      }
      return
    }
    if (subcommand === 'stop') {
      if (!sessionSelector || !taskId) {
        setStatus('/agents stop requires <session> <task-id>')
        return
      }
      const view = await adapter.stopAgentTask(sessionSelector, taskId)
      setAgentView(view)
      setSessions(await adapter.listSessions())
      setStatus(view?.detail?.stopResult?.message ?? 'no subagent task matched')
      return
    }
    if (subcommand === 'apply') {
      if (!sessionSelector || !taskId) {
        setStatus('/agents apply requires <session> <task-id>')
        return
      }
      setRunning(true)
      setStatus(`applying subagent worktree diff ${taskId}`)
      try {
        const view = await adapter.applyAgentTask(sessionSelector, taskId, promptParts)
        setAgentView(view)
        setSessions(await adapter.listSessions())
        setStatus(view?.detail?.applyResult?.message ?? 'no subagent task matched')
      } catch (error) {
        setEvents(current => [
          ...current,
          {
            type: 'error',
            content: error instanceof Error ? error.message : String(error),
          },
        ])
        setStatus('error')
      } finally {
        setRunning(false)
      }
      return
    }
    setStatus(`/agents ${subcommand} is not supported; use /agents, /agents inspect, /agents resume, /agents apply, or /agents stop`)
  }

  async function runCompactCommand(args: string): Promise<void> {
    const [sessionSelector, ...compactArgs] = args.split(' ').filter(Boolean)
    setSessionDetail(null)
    setAgentView(null)
    setCompactResult(null)
    setDoctor(null)
    if (!sessionSelector) {
      setStatus('/compact requires <session> or <index>')
      return
    }
    setRunning(true)
    setStatus(`compacting session ${sessionSelector}`)
    try {
      const result = await adapter.compactSession({
        sessionSelector,
        args: compactArgs,
      })
      setCompactResult(result)
      setSessions(await adapter.listSessions())
      setStatus(result ? `compacted ${result.sessionId}` : 'no session matched')
    } catch (error) {
      setEvents(current => [
        ...current,
        {
          type: 'error',
          content: error instanceof Error ? error.message : String(error),
        },
      ])
      setStatus('error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text bold>✳ Vigilon Operator Shell</Text>
          <Text color="gray"> · {operator.headline}</Text>
        </Text>
        <Text color={toneColor(operator.tone)}>{operator.title}</Text>
      </Box>
      <Box>
        <MessageStream
          events={events}
          detailMode={detailMode}
          sessions={sessions}
          showSessions={sessionListVisible || operator.sessions.attentionCount > 0}
          sessionDetail={sessionDetail}
          agentView={agentView}
          compactResult={compactResult}
          doctor={doctor}
          pendingPrompt={pendingPrompt}
        />
      </Box>
      <Box marginTop={1}>
        <Composer
          operator={operator}
          input={input}
          suggestions={commandSuggestions}
          pendingPrompt={pendingPrompt}
          environment={formatComposerEnvironment({
            cwd: adapter.options.cwd,
            model: adapter.options.model,
            permissionMode: adapter.options.permissionMode,
            cacheHitRatio,
          })}
        />
      </Box>
    </Box>
  )
}

function toneColor(tone: TuiSessionTone): 'red' | 'yellow' | 'cyan' | 'green' | 'gray' {
  if (tone === 'danger') return 'red'
  if (tone === 'warning') return 'yellow'
  if (tone === 'active') return 'cyan'
  if (tone === 'success') return 'green'
  return 'gray'
}

function formatComposerEnvironment(input: {
  cwd: string
  model?: string
  permissionMode?: string
  cacheHitRatio?: number
}): string {
  const cache = input.cacheHitRatio !== undefined
    ? ` · cache ${(input.cacheHitRatio * 100).toFixed(0)}%`
    : ''
  return `${input.model ?? 'deepseek-v4-flash'} · ${input.permissionMode ?? 'ask'} · cwd ${basename(input.cwd)}${cache}`
}

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).at(-1) ?? path
}

function resolvePendingPromptAnswer(raw: string, pendingPrompt: PendingPrompt | null): string {
  const value = raw.trim()
  const choices = pendingPrompt?.request?.choices ?? []
  const matched = choices.find(choice =>
    choice.key === value ||
    choice.value.toLowerCase() === value.toLowerCase() ||
    choice.label.toLowerCase() === value.toLowerCase(),
  )
  return matched?.value ?? value
}
