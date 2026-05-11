import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

describe('getAllBaseTools', () => {
  it('loads lazily required tools from the tools module directory', async () => {
    const packageDir = fileURLToPath(new URL('..', import.meta.url))
    const { stdout } = await execa(
      'node',
      [
        '-e',
        "import('./src/tools.ts').then(m => { m.getAllBaseTools(); console.log('ok') })",
      ],
      {
        cwd: packageDir,
        env: {
          ...process.env,
          NODE_OPTIONS: '--import tsx --no-warnings',
        },
      },
    )

    expect(stdout).toContain('ok')
  })
})
