import { pathToFileURL } from 'node:url'
import { runTui } from './runTui.js'

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await runTui()
}
