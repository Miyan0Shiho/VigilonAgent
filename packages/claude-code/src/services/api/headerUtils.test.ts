import { describe, expect, it } from 'vitest'

import { getHeaderNames, getHeaderValue } from './headerUtils'

describe('getHeaderValue', () => {
  it('reads headers from plain objects without throwing', () => {
    expect(
      getHeaderValue(
        {
          headers: {
            'x-should-retry': 'false',
          },
        },
        'x-should-retry',
      ),
    ).toBe('false')
  })

  it('reads headers from Headers instances', () => {
    expect(
      getHeaderValue(
        {
          // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
          headers: new Headers({ 'x-should-retry': 'true' }),
        },
        'x-should-retry',
      ),
    ).toBe('true')
  })

  it('lists header names from plain objects', () => {
    expect(
      getHeaderNames({
        headers: {
          'x-should-retry': 'false',
          'retry-after': '1',
        },
      }),
    ).toEqual(['x-should-retry', 'retry-after'])
  })
})
