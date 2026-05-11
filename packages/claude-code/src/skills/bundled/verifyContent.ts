// Content for the verify bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const readMd = (path: string) => fs.readFileSync(join(__dirname, path), 'utf8')

const cliMd = readMd('./verify/examples/cli.md')
const serverMd = readMd('./verify/examples/server.md')
const skillMd = readMd('./verify/SKILL.md')

export const SKILL_MD: string = skillMd

export const SKILL_FILES: Record<string, string> = {
  'examples/cli.md': cliMd,
  'examples/server.md': serverMd,
}
