import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

describe('ColorDiff', () => {
  it(
    'renders JavaScript diffs without highlight API crashes',
    async () => {
      const packageDir = fileURLToPath(new URL('../../../', import.meta.url))
      const { stdout } = await execa(
        'node',
        [
          '-e',
          `import('./src/native-ts/color-diff/index.ts').then(({ ColorDiff }) => {
            const diff = new ColorDiff(
              { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+const answer = 42;'] },
              'const answer = 42;',
              'example.js'
            )
            diff.render('dark', 80, false)
            console.log('ok')
          })`,
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
    },
    30000,
  )
})
