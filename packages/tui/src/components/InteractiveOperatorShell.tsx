import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import type { InteractivePromptController, PendingPrompt } from '../runtime/lineReader.js'
import type {
  TuiRuntimeAdapter,
  TuiRuntimeEvent,
  TuiSessionDetail,
  TuiSessionSummary,
} from '../runtime/types.js'
import { MessageStream } from './MessageStream.js'
import { SessionPanel } from './SessionPanel.js'

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
  const [input, setInput] = useState('')
  const [status, setStatus] = useState('ready')
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null)
  const [sessionDetail, setSessionDetail] = useState<TuiSessionDetail | null>(null)
  const [doctor, setDoctor] = useState<Record<string, unknown> | null>(null)

  useEffect(() => promptController.subscribe(setPendingPrompt), [promptController])

  const hint = useMemo(() => {
    if (pendingPrompt) return 'answer pending prompt'
    if (running) return 'running, Ctrl-C to return when current turn finishes'
    return '/help /clear /sessions /resume /open /approve /doctor /quit'
  }, [pendingPrompt, running])

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      setStatus('interrupt requested; current runtime turn is not abortable yet')
      return
    }
    if (key.return) {
      void submitInput()
      return
    }
    if (key.backspace || key.delete) {
      setInput(current => current.slice(0, -1))
      return
    }
    if (key.upArrow) {
      if (history.length === 0) return
      const nextIndex = historyIndex === null
        ? history.length - 1
        : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIndex)
      setInput(history[nextIndex] ?? '')
      return
    }
    if (key.downArrow) {
      if (history.length === 0 || historyIndex === null) return
      const nextIndex = historyIndex + 1
      if (nextIndex >= history.length) {
        setHistoryIndex(null)
        setInput('')
        return
      }
      setHistoryIndex(nextIndex)
      setInput(history[nextIndex] ?? '')
      return
    }
    if (key.leftArrow || key.rightArrow || key.tab || key.escape || key.ctrl || key.meta) {
      return
    }
    if (value) setInput(current => `${current}${value}`)
  })

  async function submitInput(): Promise<void> {
    const raw = input.trim()
    if (!raw) return
    setInput('')
    setHistoryIndex(null)
    setHistory(current => raw.startsWith('/') ? current : [...current, raw])

    if (pendingPrompt) {
      promptController.answer(raw)
      setStatus(`answered prompt: ${raw}`)
      return
    }

    if (running) {
      setStatus('turn already running')
      return
    }

    if (raw === '/quit' || raw === 'quit' || raw === 'exit') {
      await adapter.close()
      exit()
      return
    }
    if (raw === '/help') {
      setEvents(current => [
        ...current,
        {
          type: 'working',
          content: 'Commands: /clear /sessions /resume <n> ... /approve <n> ... /open <n> /doctor /quit',
        },
      ])
      return
    }
    if (raw === '/clear') {
      setEvents([])
      setSessionDetail(null)
      setDoctor(null)
      setStatus('cleared')
      return
    }
    if (raw === '/sessions') {
      const next = await adapter.listSessions()
      setSessions(next)
      setStatus(`loaded ${next.length} sessions`)
      return
    }
    if (raw === '/doctor') {
      setDoctor(await adapter.doctor())
      setStatus('doctor complete')
      return
    }
    if (raw.startsWith('/open ')) {
      const detail = await adapter.openSession(raw.slice('/open '.length).trim())
      setSessionDetail(detail)
      setStatus(detail ? `opened ${detail.session.sessionId}` : 'no session matched')
      return
    }
    if (raw.startsWith('/resume ') || raw.startsWith('/approve ')) {
      const approvePlan = raw.startsWith('/approve ')
      const command = raw.slice(approvePlan ? '/approve '.length : '/resume '.length).trim()
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

    await runTurn({
      prompt: raw.startsWith('/new ') ? raw.slice('/new '.length).trim() : raw,
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
    setDoctor(null)
    try {
      await adapter.runTask({
        ...input,
        onEvent: event => {
          setEvents(current => [...current, event])
        },
      })
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

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
        <Text bold>Vigilon Operator Shell</Text>
        <Text color="gray">Claude-like local operator surface</Text>
        <Text color="gray">cwd {adapter.options.cwd}</Text>
        <Text color="gray">model {adapter.options.model ?? 'deepseek-v4-flash'} permission {adapter.options.permissionMode ?? 'ask'}</Text>
      </Box>
      <Box marginTop={1}>
        <SessionPanel sessions={sessions} />
      </Box>
      {sessionDetail ? <SessionDetail detail={sessionDetail} /> : null}
      {doctor ? <DoctorPanel doctor={doctor} /> : null}
      <Box marginTop={1}>
        <MessageStream events={events} />
      </Box>
      <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor={pendingPrompt ? 'yellow' : running ? 'cyan' : 'gray'} paddingX={1}>
        <Text color="gray">status {status}</Text>
        <Text>{pendingPrompt ? 'answer' : 'vigilon'} › {input}</Text>
        <Text color="gray">{hint}</Text>
      </Box>
    </Box>
  )
}

function SessionDetail({ detail }: { detail: TuiSessionDetail }): React.ReactElement {
  return (
    <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Session detail {detail.session.sessionId}</Text>
      <Text>status {detail.session.status} handoff {detail.session.hasHandoffReport ? 'recorded' : 'missing'}</Text>
      {detail.recentEvents.slice(-8).map((event, index) => <Text color="gray" key={index}>{event}</Text>)}
    </Box>
  )
}

function DoctorPanel({ doctor }: { doctor: Record<string, unknown> }): React.ReactElement {
  return (
    <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Doctor</Text>
      {Object.entries(doctor).slice(0, 12).map(([key, value]) => (
        <Text key={key}>{key}: {Array.isArray(value) ? value.join(', ') : String(value)}</Text>
      ))}
    </Box>
  )
}
