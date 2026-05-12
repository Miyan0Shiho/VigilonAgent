import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('modifiers-napi', () => ({}))

import { isModifierPressed } from './modifiers'

describe('isModifierPressed', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  )

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    })
  })

  afterEach(() => {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
  })

  it('returns false when the native helper export is unavailable', () => {
    expect(() => isModifierPressed('shift')).not.toThrow()
    expect(isModifierPressed('shift')).toBe(false)
  })
})
