export type PendingPromptChoice = {
  key: string
  label: string
  value: string
  description?: string
}

export type PendingPromptRequest = {
  kind: 'permission' | 'question' | 'input'
  title: string
  lines: string[]
  choices?: PendingPromptChoice[]
}

export type LineReader = {
  question(prompt?: string | PendingPromptRequest): Promise<string>
  close(): void
}

export type PendingPrompt = {
  id: number
  request?: PendingPromptRequest
  resolve(answer: string): void
}

export class InteractivePromptController implements LineReader {
  private nextId = 1
  private pending: PendingPrompt | null = null
  private listeners = new Set<(prompt: PendingPrompt | null) => void>()

  question(prompt?: string | PendingPromptRequest): Promise<string> {
    return new Promise(resolve => {
      this.pending = {
        id: this.nextId,
        request: typeof prompt === 'string' ? {
          kind: 'input',
          title: prompt,
          lines: [prompt],
        } : prompt,
        resolve: answer => {
          resolve(answer)
          this.pending = null
          this.emit()
        },
      }
      this.nextId += 1
      this.emit()
    })
  }

  answer(value: string): boolean {
    if (!this.pending) return false
    this.pending.resolve(value)
    return true
  }

  getPending(): PendingPrompt | null {
    return this.pending
  }

  subscribe(listener: (prompt: PendingPrompt | null) => void): () => void {
    this.listeners.add(listener)
    listener(this.pending)
    return () => {
      this.listeners.delete(listener)
    }
  }

  close(): void {
    if (this.pending) {
      this.pending.resolve('')
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.pending)
  }
}

export function createBufferedLineReader(input: NodeJS.ReadableStream): LineReader {
  const iterator = input[Symbol.asyncIterator]()
  let buffer = ''
  const lines: string[] = []

  async function readLine(): Promise<string> {
    while (lines.length === 0) {
      const next = await iterator.next()
      if (next.done) {
        if (buffer.length > 0) {
          const trailing = buffer
          buffer = ''
          return trailing
        }
        throw new Error('EOF')
      }
      buffer += String(next.value)
      const normalized = buffer.replace(/\r\n/g, '\n')
      const parts = normalized.split('\n')
      buffer = parts.pop() ?? ''
      lines.push(...parts)
    }
    return lines.shift() ?? ''
  }

  return {
    question: readLine,
    close() {},
  }
}
