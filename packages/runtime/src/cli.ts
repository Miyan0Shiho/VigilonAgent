import { createPhase1RuntimeBaseline } from './runtime/baseline.js'
import { VIGILON_RUNTIME_VERSION } from './version.js'

function printHelp(): void {
  process.stdout.write(`Vigilon Runtime ${VIGILON_RUNTIME_VERSION}

Usage:
  vigilon --version
  vigilon doctor

`)
}

function printDoctor(): void {
  const baseline = createPhase1RuntimeBaseline()
  process.stdout.write(
    JSON.stringify(
      {
        status: 'ok',
        package: '@vigilon/runtime',
        version: VIGILON_RUNTIME_VERSION,
        phase: baseline.phase,
        sourcePolicy: baseline.sourcePolicy,
        includedCapabilities: baseline.includedCapabilities.length,
        excludedSurfaces: baseline.excludedSurfaces.length,
      },
      null,
      2,
    ) + '\n',
  )
}

const args = process.argv.slice(2).filter(arg => arg !== '--')

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${VIGILON_RUNTIME_VERSION}\n`)
} else if (args[0] === 'doctor') {
  printDoctor()
} else {
  printHelp()
}
