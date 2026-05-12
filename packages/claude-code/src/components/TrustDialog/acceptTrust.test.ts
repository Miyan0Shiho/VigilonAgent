import { describe, expect, it, vi } from 'vitest'
import { completeTrustAcceptance } from './acceptTrust'

describe('completeTrustAcceptance', () => {
  it('continues into the session when project trust persistence fails', () => {
    const setSessionTrustAccepted = vi.fn()
    const persistProjectTrust = vi.fn(() => {
      throw new Error('EPERM')
    })
    const onDone = vi.fn()

    expect(() =>
      completeTrustAcceptance({
        isHomeDir: false,
        setSessionTrustAccepted,
        persistProjectTrust,
        onDone,
        logFailure: vi.fn(),
      }),
    ).not.toThrow()

    expect(setSessionTrustAccepted).toHaveBeenCalledWith(true)
    expect(persistProjectTrust).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('skips project persistence when trusting the home directory', () => {
    const setSessionTrustAccepted = vi.fn()
    const persistProjectTrust = vi.fn()
    const onDone = vi.fn()

    completeTrustAcceptance({
      isHomeDir: true,
      setSessionTrustAccepted,
      persistProjectTrust,
      onDone,
      logFailure: vi.fn(),
    })

    expect(setSessionTrustAccepted).toHaveBeenCalledWith(true)
    expect(persistProjectTrust).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
