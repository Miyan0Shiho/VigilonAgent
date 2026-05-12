import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

describe('withRetry', () => {
  it(
    'does not crash when APIError headers are plain objects',
    async () => {
      const packageDir = fileURLToPath(new URL('../../..', import.meta.url))
      const { stdout } = await execa(
        'node',
        [
          '-e',
          `
            const sdk = await import('@anthropic-ai/sdk');
            const retryModule = await import('./src/services/api/withRetry.ts');
            const iterator = retryModule.withRetry(
              async () => ({}),
              async () => {
                throw new sdk.APIError(
                  429,
                  { message: 'rate limited' },
                  'rate limited',
                  { 'x-should-retry': 'false', 'retry-after': '1' },
                );
              },
              {
                maxRetries: 1,
                model: 'deepseek-v4-flash',
                thinkingConfig: { type: 'disabled' },
              },
            );
            try {
              await iterator.next();
              console.log('unexpected-success');
            } catch (error) {
              console.log(error?.constructor?.name || 'unknown-error');
              console.log(String(error?.message || ''));
            }
          `,
        ],
        {
          cwd: packageDir,
          env: {
            ...process.env,
            NODE_OPTIONS: '--import tsx --no-warnings',
          },
        },
      )

      expect(stdout).toContain('CannotRetryError')
      expect(stdout).not.toContain('headers?.get is not a function')
    },
    15000,
  )
})
