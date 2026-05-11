import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { collectStdinData } from './process'

describe('collectStdinData', () => {
  it('returns partial stdin after timeout for interactive startup pipes', async () => {
    const stream = new EventEmitter()
    const resultPromise = collectStdinData(stream, 20, false)

    stream.emit('data', 'partial')

    await expect(resultPromise).resolves.toEqual({
      data: 'partial',
      sawData: true,
      timedOut: true,
    })
  })

  it('waits for stream end in headless mode after receiving data', async () => {
    const stream = new EventEmitter()
    const resultPromise = collectStdinData(stream, 50, true)

    stream.emit('data', 'hello')
    setTimeout(() => {
      stream.emit('data', ' world')
      stream.emit('end')
    }, 10)

    await expect(resultPromise).resolves.toEqual({
      data: 'hello world',
      sawData: true,
      timedOut: false,
    })
  })
})
