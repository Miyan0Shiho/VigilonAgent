import { describe, expect, it } from 'vitest'

import { normalizeAnthropicBaseUrl } from './baseUrl'

describe('normalizeAnthropicBaseUrl', () => {
  it('strips a trailing /v1 from custom gateway urls', () => {
    expect(normalizeAnthropicBaseUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com',
    )
    expect(normalizeAnthropicBaseUrl('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com',
    )
  })

  it('keeps non-versioned urls unchanged', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com',
    )
    expect(
      normalizeAnthropicBaseUrl('https://example.com/custom/anthropic'),
    ).toBe('https://example.com/custom/anthropic')
  })
})
