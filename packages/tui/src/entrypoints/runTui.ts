import React from 'react'
import { render } from 'ink'
import { createBufferedLineReader } from '../runtime/lineReader.js'
import { InteractivePromptController } from '../runtime/lineReader.js'
import { createNodeRuntimeAdapter } from '../runtime/nodeAdapter.js'
import type {
  OperatorShellDeps,
  OperatorShellIO,
  TuiRuntimeEvent,
  TuiSessionSummary,
} from '../runtime/types.js'
import {
  renderAgentView,
  renderCompactResult,
  renderDoctor,
  renderHelp,
  renderRuntimeEvent,
  renderSessionDetail,
  renderShellFrame,
} from '../render/text.js'
import { InteractiveOperatorShell } from '../components/InteractiveOperatorShell.js'
import { parseTuiCommand } from '../runtime/commandCatalog.js'

export async function runTui(
  argv = process.argv.slice(2),
  io: OperatorShellIO = {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    env: process.env,
  },
  deps: OperatorShellDeps = {},
): Promise<number> {
  if (!io.stdin) {
    io.stderr.write('vigilon tui requires stdin\n')
    return 1
  }

  if (canUseInteractiveInk(io)) {
    return runInteractiveInk(argv, io, deps)
  }

  const reader = createBufferedLineReader(io.stdin)
  const visibleEvents: TuiRuntimeEvent[] = []
  let sessions: TuiSessionSummary[] = []
  let status = 'ready'
  let detailMode = false

  try {
    const firstCommand = await readNextCommand(reader)
    if (!firstCommand) {
      io.stderr.write(renderNonInteractiveNoInputMessage())
      return 1
    }

    const adapter = await createNodeRuntimeAdapter({
      args: argv.filter(arg => arg !== '--'),
      io,
      deps,
      reader,
    })
    sessions = await adapter.listSessions()
    io.stdout.write(renderShellFrame({
      cwd: adapter.options.cwd,
      sessionsDir: adapter.options.sessionsDir,
      permissionMode: adapter.options.permissionMode,
      model: adapter.options.model,
      sessions,
      events: visibleEvents,
      status,
      detailMode,
    }) + '\n')

    try {
      const firstCommandShouldExit = await runScriptCommand({
        raw: firstCommand,
        adapter,
        visibleEvents,
        io,
        setSessions: next => {
          sessions = next
        },
        setStatus: next => {
          status = next
        },
        getDetailMode: () => detailMode,
        setDetailMode: next => {
          detailMode = next
        },
        getSessions: () => sessions,
      })
      if (firstCommandShouldExit) {
        await adapter.close()
        return 0
      }

      while (true) {
        const raw = await readNextCommand(reader)
        if (!raw) {
          await adapter.close()
          return 0
        }
        const shouldExit = await runScriptCommand({
          raw,
          adapter,
          visibleEvents,
          io,
          setSessions: next => {
            sessions = next
          },
          setStatus: next => {
            status = next
          },
          getDetailMode: () => detailMode,
          setDetailMode: next => {
            detailMode = next
          },
          getSessions: () => sessions,
        })
        if (shouldExit) {
          await adapter.close()
          return 0
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'EOF') {
        await adapter.close()
        return 0
      }
      throw error
    }
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    reader.close()
  }
}

async function readNextCommand(reader: ReturnType<typeof createBufferedLineReader>): Promise<string | null> {
  while (true) {
    try {
      const raw = (await reader.question()).trim()
      if (raw) return raw
    } catch (error) {
      if (error instanceof Error && error.message === 'EOF') return null
      throw error
    }
  }
}

function renderNonInteractiveNoInputMessage(): string {
  return [
    'vigilon tui needs an interactive TTY, or scripted input on stdin.',
    'Current stdin/stdout did not enter interactive mode and no input was provided.',
    'Run `pnpm tui` from a real terminal, or pipe commands for scripted mode.',
    '',
  ].join('\n')
}

async function runScriptCommand(input: {
  raw: string
  adapter: Awaited<ReturnType<typeof createNodeRuntimeAdapter>>
  visibleEvents: TuiRuntimeEvent[]
  io: OperatorShellIO
  getSessions: () => TuiSessionSummary[]
  setSessions: (sessions: TuiSessionSummary[]) => void
  setStatus: (status: string) => void
  getDetailMode: () => boolean
  setDetailMode: (detailMode: boolean) => void
}): Promise<boolean> {
  const { raw, adapter, visibleEvents, io } = input
  const parsedCommand = parseTuiCommand(raw)
  if (raw.startsWith('/') && !parsedCommand) {
    io.stdout.write(`Unknown command: ${raw.split(/\s+/, 1)[0]}; use /help\n`)
    return false
  }
  if (parsedCommand?.definition.name === 'quit') {
    return true
  }
  if (parsedCommand?.definition.name === 'help') {
    io.stdout.write(renderHelp() + '\n')
    return false
  }
  if (parsedCommand?.definition.name === 'clear') {
    visibleEvents.length = 0
    input.setStatus('cleared')
    io.stdout.write(renderShellFrame({
      cwd: adapter.options.cwd,
      sessionsDir: adapter.options.sessionsDir,
      permissionMode: adapter.options.permissionMode,
      model: adapter.options.model,
      sessions: input.getSessions(),
      events: visibleEvents,
      status: 'cleared',
      detailMode: input.getDetailMode(),
    }) + '\n')
    return false
  }
  if (parsedCommand?.definition.name === 'sessions') {
    const sessions = await adapter.listSessions()
    input.setSessions(sessions)
    const status = `loaded ${sessions.length} sessions`
    input.setStatus(status)
    io.stdout.write(renderShellFrame({
      cwd: adapter.options.cwd,
      sessionsDir: adapter.options.sessionsDir,
      permissionMode: adapter.options.permissionMode,
      model: adapter.options.model,
      sessions,
      events: visibleEvents,
      status,
      showSessions: true,
      detailMode: input.getDetailMode(),
    }) + '\n')
    return false
  }
  if (parsedCommand?.definition.name === 'details') {
    const nextDetailMode = !input.getDetailMode()
    input.setDetailMode(nextDetailMode)
    io.stdout.write(renderShellFrame({
      cwd: adapter.options.cwd,
      sessionsDir: adapter.options.sessionsDir,
      permissionMode: adapter.options.permissionMode,
      model: adapter.options.model,
      sessions: input.getSessions(),
      events: visibleEvents,
      status: nextDetailMode ? 'details visible' : 'details hidden',
      detailMode: nextDetailMode,
    }) + '\n')
    return false
  }
  if (parsedCommand?.definition.name === 'doctor') {
    io.stdout.write(renderDoctor(await adapter.doctor()) + '\n')
    return false
  }
  if (parsedCommand?.definition.name === 'open') {
    const detail = await adapter.openSession(parsedCommand.args)
    io.stdout.write(detail ? `${renderSessionDetail(detail)}\n` : `No session matched.\n`)
    return false
  }
  if (parsedCommand?.definition.name === 'agents') {
    const [subcommand, sessionSelector, taskId, ...promptParts] = parsedCommand.args.split(' ').filter(Boolean)
    if (!subcommand) {
      io.stdout.write(renderAgentView(await adapter.listAgents()) + '\n')
      return false
    }
    if (subcommand === 'inspect') {
      if (!sessionSelector || !taskId) {
        io.stdout.write('/agents inspect requires <session> <task-id>\n')
        return false
      }
      const view = await adapter.inspectAgentTask(sessionSelector, taskId)
      io.stdout.write(view ? `${renderAgentView(view)}\n` : 'No subagent task matched.\n')
      return false
    }
    if (subcommand === 'resume') {
      if (!sessionSelector || !taskId) {
        io.stdout.write('/agents resume requires <session> <task-id> <prompt>\n')
        return false
      }
      const view = await adapter.resumeAgentTask({
        sessionSelector,
        taskId,
        prompt: promptParts.join(' ').trim() || 'Continue from the parent retained task state.',
      })
      io.stdout.write(view ? `${renderAgentView(view)}\n` : 'No subagent task matched.\n')
      input.setSessions(await adapter.listSessions())
      return false
    }
    if (subcommand === 'stop') {
      if (!sessionSelector || !taskId) {
        io.stdout.write('/agents stop requires <session> <task-id>\n')
        return false
      }
      const view = await adapter.stopAgentTask(sessionSelector, taskId)
      io.stdout.write(view ? `${renderAgentView(view)}\n` : 'No subagent task matched.\n')
      input.setSessions(await adapter.listSessions())
      return false
    }
    if (subcommand === 'apply') {
      if (!sessionSelector || !taskId) {
        io.stdout.write('/agents apply requires <session> <task-id>\n')
        return false
      }
      const view = await adapter.applyAgentTask(sessionSelector, taskId, promptParts)
      io.stdout.write(view ? `${renderAgentView(view)}\n` : 'No subagent task matched.\n')
      input.setSessions(await adapter.listSessions())
      return false
    }
    io.stdout.write(`/agents ${subcommand} is not supported; use /agents, /agents inspect, /agents resume, /agents apply, or /agents stop\n`)
    return false
  }
  if (parsedCommand?.definition.name === 'compact') {
    const [sessionSelector, ...compactArgs] = parsedCommand.args.split(' ').filter(Boolean)
    if (!sessionSelector) {
      io.stdout.write('/compact requires <session> or <index>\n')
      return false
    }
    const result = await adapter.compactSession({
      sessionSelector,
      args: compactArgs,
    })
    io.stdout.write(result ? `${renderCompactResult(result)}\n` : 'No session matched.\n')
    input.setSessions(await adapter.listSessions())
    return false
  }
  if (parsedCommand?.definition.name === 'resume' || parsedCommand?.definition.name === 'approve') {
    const approvePlan = parsedCommand.definition.name === 'approve'
    const command = parsedCommand.args
    const [selector, ...promptParts] = command.split(' ').filter(Boolean)
    if (!selector) {
      io.stdout.write(`${approvePlan ? '/approve' : '/resume'} requires a session id or index\n`)
      return false
    }
    const prompt = promptParts.join(' ').trim() || 'Continue with the approved plan.'
    await runTaskAndRender({
      adapter,
      visibleEvents,
      io,
      prompt,
      sessionSelector: selector,
      approvePlan,
      detailMode: input.getDetailMode(),
    })
    input.setSessions(await adapter.listSessions())
    return false
  }

  const prompt = parsedCommand?.definition.name === 'new' ? parsedCommand.args : raw
  if (parsedCommand?.definition.name === 'new' && !prompt.trim()) {
    io.stdout.write('/new requires a prompt\n')
    return false
  }
  if (!prompt) return false
  await runTaskAndRender({
    adapter,
    visibleEvents,
    io,
    prompt,
    detailMode: input.getDetailMode(),
  })
  input.setSessions(await adapter.listSessions())
  return false
}

async function runInteractiveInk(
  argv: string[],
  io: OperatorShellIO,
  deps: OperatorShellDeps,
): Promise<number> {
  const promptController = new InteractivePromptController()
  try {
    const adapter = await createNodeRuntimeAdapter({
      args: argv.filter(arg => arg !== '--'),
      io,
      deps,
      reader: promptController,
    })
    const initialSessions = await adapter.listSessions()
    const instance = render(React.createElement(InteractiveOperatorShell, {
      adapter,
      promptController,
      initialSessions,
    }))
    await instance.waitUntilExit()
    await adapter.close()
    return 0
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    promptController.close()
  }
}

function canUseInteractiveInk(io: OperatorShellIO): boolean {
  return io.stdin === process.stdin &&
    io.stdout === process.stdout &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY)
}

async function runTaskAndRender(input: {
  adapter: Awaited<ReturnType<typeof createNodeRuntimeAdapter>>
  visibleEvents: TuiRuntimeEvent[]
  io: OperatorShellIO
  prompt: string
  sessionSelector?: string
  approvePlan?: boolean
  detailMode?: boolean
}) {
  await input.adapter.runTask({
    prompt: input.prompt,
    sessionSelector: input.sessionSelector,
    approvePlan: input.approvePlan,
    onEvent: event => {
      const previousEvents = [...input.visibleEvents]
      input.visibleEvents.push(event)
      const lines = renderRuntimeEvent(event, {
        detailMode: input.detailMode ?? false,
        previousEvents,
      })
      if (lines.length > 0) input.io.stdout.write(lines.join('\n') + '\n')
    },
  })
}
