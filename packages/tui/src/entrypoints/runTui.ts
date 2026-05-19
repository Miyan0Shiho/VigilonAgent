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
  renderDoctor,
  renderHelp,
  renderRuntimeEvent,
  renderSessionDetail,
  renderShellFrame,
} from '../render/text.js'
import { InteractiveOperatorShell } from '../components/InteractiveOperatorShell.js'

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

  try {
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
    }) + '\n')

    try {
      while (true) {
        const raw = (await reader.question()).trim()
        if (!raw) continue
        if (raw === '/quit' || raw === 'quit' || raw === 'exit') {
          await adapter.close()
          return 0
        }
        if (raw === '/help') {
          io.stdout.write(renderHelp() + '\n')
          continue
        }
        if (raw === '/clear') {
          visibleEvents.length = 0
          status = 'cleared'
          io.stdout.write(renderShellFrame({
            cwd: adapter.options.cwd,
            sessionsDir: adapter.options.sessionsDir,
            permissionMode: adapter.options.permissionMode,
            model: adapter.options.model,
            sessions,
            events: visibleEvents,
            status,
          }) + '\n')
          continue
        }
        if (raw === '/sessions') {
          sessions = await adapter.listSessions()
          status = `loaded ${sessions.length} sessions`
          io.stdout.write(renderShellFrame({
            cwd: adapter.options.cwd,
            sessionsDir: adapter.options.sessionsDir,
            permissionMode: adapter.options.permissionMode,
            model: adapter.options.model,
            sessions,
            events: visibleEvents,
            status,
          }) + '\n')
          continue
        }
        if (raw === '/doctor') {
          io.stdout.write(renderDoctor(await adapter.doctor()) + '\n')
          continue
        }
        if (raw.startsWith('/open ')) {
          const detail = await adapter.openSession(raw.slice('/open '.length).trim())
          io.stdout.write(detail ? `${renderSessionDetail(detail)}\n` : `No session matched.\n`)
          continue
        }
        if (raw.startsWith('/resume ') || raw.startsWith('/approve ')) {
          const approvePlan = raw.startsWith('/approve ')
          const command = raw.slice(approvePlan ? '/approve '.length : '/resume '.length).trim()
          const [selector, ...promptParts] = command.split(' ').filter(Boolean)
          if (!selector) {
            io.stdout.write(`${approvePlan ? '/approve' : '/resume'} requires a session id or index\n`)
            continue
          }
          const prompt = promptParts.join(' ').trim() || 'Continue with the approved plan.'
          await runTaskAndRender({
            adapter,
            visibleEvents,
            io,
            prompt,
            sessionSelector: selector,
            approvePlan,
          })
          sessions = await adapter.listSessions()
          continue
        }

        const prompt = raw.startsWith('/new ') ? raw.slice('/new '.length).trim() : raw
        if (!prompt) continue
        await runTaskAndRender({
          adapter,
          visibleEvents,
          io,
          prompt,
        })
        sessions = await adapter.listSessions()
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
}) {
  input.io.stdout.write(`\ncomposer: running ${input.sessionSelector ? `session ${input.sessionSelector}` : 'new task'}\n`)
  await input.adapter.runTask({
    prompt: input.prompt,
    sessionSelector: input.sessionSelector,
    approvePlan: input.approvePlan,
    onEvent: event => {
      input.visibleEvents.push(event)
      input.io.stdout.write(renderRuntimeEvent(event).join('\n') + '\n')
    },
  })
}
