function handleEPIPE(
  stream: NodeJS.WriteStream,
): (err: NodeJS.ErrnoException) => void {
  return (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      stream.destroy()
    }
  }
}

// Prevents memory leak when pipe is broken (e.g., `claude -p | head -1`)
export function registerProcessOutputErrorHandlers(): void {
  process.stdout.on('error', handleEPIPE(process.stdout))
  process.stderr.on('error', handleEPIPE(process.stderr))
}

function writeOut(stream: NodeJS.WriteStream, data: string): void {
  if (stream.destroyed) {
    return
  }

  // Note: we don't handle backpressure (write() returning false).
  //
  // We should consider handling the callback to ensure we wait for data to flush.
  stream.write(data /* callback to handle here */)
}

export function writeToStdout(data: string): void {
  writeOut(process.stdout, data)
}

export function writeToStderr(data: string): void {
  writeOut(process.stderr, data)
}

// Write error to stderr and exit with code 1. Consolidates the
// console.error + process.exit(1) pattern used in entrypoint fast-paths.
export function exitWithError(message: string): never {
  // biome-ignore lint/suspicious/noConsole:: intentional console output
  console.error(message)
  // eslint-disable-next-line custom-rules/no-process-exit
  process.exit(1)
}

export type StdinCollectionResult = {
  data: string
  sawData: boolean
  timedOut: boolean
}

/**
 * Collect data from a stdin-like stream.
 *
 * When `waitForEndAfterFirstChunk` is false, this resolves after `ms` even if
 * the stream stays open. This keeps interactive startup from hanging forever on
 * inherited pipes that emit a chunk and never close.
 */
export function collectStdinData(
  stream: NodeJS.EventEmitter,
  ms: number,
  waitForEndAfterFirstChunk: boolean,
): Promise<StdinCollectionResult> {
  return new Promise<StdinCollectionResult>(resolve => {
    let data = ''
    let sawData = false

    const done = (timedOut: boolean) => {
      clearTimeout(peek)
      stream.off('end', onEnd)
      stream.off('data', onData)
      resolve({
        data,
        sawData,
        timedOut,
      })
    }

    const onEnd = () => done(false)
    const onData = (chunk: string | Buffer) => {
      sawData = true
      data += typeof chunk === 'string' ? chunk : chunk.toString('utf8')

      if (waitForEndAfterFirstChunk) {
        clearTimeout(peek)
      }
    }

    // eslint-disable-next-line no-restricted-syntax -- not a sleep: races timeout against stream end/data events
    const peek = setTimeout(done, ms, true)
    stream.on('data', onData)
    stream.once('end', onEnd)
  })
}
