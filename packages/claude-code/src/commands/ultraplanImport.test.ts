import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

describe('ultraplan command module', () => {
  it(
    'loads successfully at runtime',
    async () => {
      const packageDir = fileURLToPath(new URL('../..', import.meta.url))
      const { stdout } = await execa(
        'node',
        ['-e', "import('./src/commands/ultraplan.tsx').then(() => { console.log('ok') })"],
        {
          cwd: packageDir,
          env: {
            ...process.env,
            NODE_OPTIONS: '--import tsx --no-warnings',
          },
        },
      )

      expect(stdout).toContain('ok')
    },
    15000,
  )
})
