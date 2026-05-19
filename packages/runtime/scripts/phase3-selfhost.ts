import path from 'node:path'
import { Readable } from 'node:stream'
import { readTranscriptFile, runCli, type ModelClient } from '../src/index.js'

async function main(): Promise<void> {
  const repoRoot = path.resolve(process.cwd(), '..', '..')
  const sessionsDir = path.join(repoRoot, '.vigilon', 'phase3-selfhost-sessions')
  const targetFile = 'docs/product/2026-05-18-phase-3-self-hosting-record.md'
  const recordContent = [
    '# Phase 3 Self-Hosting Record',
    '',
    '- Task: Create a durable self-hosting evidence page through the Vigilon runtime itself.',
    '- Runtime path: `vigilon run` with transcript, file write, and ResultReport.',
    '- Note: this record was produced through the real Vigilon runtime using a scripted model because `DEEPSEEK_API_KEY` was not available in the validation shell.',
    '',
    '## Outcome',
    '',
    '- The runtime created this file through its own `Write` tool path.',
    '- The run also recorded a structured `ResultReport` handoff.',
    '- Use the transcript path emitted by `phase3:selfhost` to audit the exact tool calls.',
  ].join('\n')

  const io = createIo({
    VIGILON_DISABLE_GLOBAL_SETTINGS: '1',
  })

  const exitCode = await runCli(
    [
      'run',
      'Create the Phase 3 self-hosting record and leave a structured handoff report.',
      '--cwd',
      repoRoot,
      '--sessions-dir',
      sessionsDir,
      '--permission-mode',
      'bypass-local',
      '--session-id',
      'phase3-selfhost-record',
    ],
    io,
    {
      createModelClient: () => scriptedSelfHostModel(targetFile, recordContent),
    },
  )

  const output = JSON.parse(io.stdoutText) as {
    transcriptPath: string
    report: {
      fileChanges: Array<{ filePath: string }>
      handoffReport?: {
        finalMessage: string
      }
    }
  }
  const transcript = await readTranscriptFile(output.transcriptPath)

  console.log(
    JSON.stringify(
      {
        exitCode,
        transcriptPath: output.transcriptPath,
        createdFiles: output.report.fileChanges.map(change => change.filePath),
        handoffRecorded: Boolean(output.report.handoffReport),
        eventCount: transcript.length,
      },
      null,
      2,
    ),
  )
  if (exitCode !== 0) process.exitCode = exitCode
}

function scriptedSelfHostModel(
  targetFile: string,
  recordContent: string,
): ModelClient {
  let turn = 0
  return {
    id: 'phase3-selfhost-model',
    async createMessage() {
      turn += 1
      if (turn === 1) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'write-selfhost-record',
              name: 'Write',
              input: {
                file_path: targetFile,
                content: `${recordContent}\n`,
              },
            },
          ],
          stopReason: 'tool_use',
        }
      }
      if (turn === 2) {
        return {
          content: '',
          toolCalls: [
            {
              id: 'handoff-selfhost-record',
              name: 'ResultReport',
              input: {
                final_message: 'Created the Phase 3 self-hosting record.',
                changes: [`Created ${targetFile}`],
                verification_notes: ['Confirmed the runtime emitted a transcript and file diff metadata.'],
                unverified: ['No live DeepSeek model was exercised in this validation shell.'],
                risks: ['This self-hosting proof covers runtime productization flow, not remote model availability.'],
              },
            },
          ],
          stopReason: 'tool_use',
        }
      }
      return {
        content: 'Self-hosting record completed.',
        toolCalls: [],
        stopReason: 'end_turn',
      }
    },
  }
}

function createIo(env: NodeJS.ProcessEnv = {}) {
  const state = {
    stdoutText: '',
    stderrText: '',
  }
  return {
    env,
    stdout: {
      write(chunk: string) {
        state.stdoutText += chunk
      },
    },
    stderr: {
      write(chunk: string) {
        state.stderrText += chunk
      },
    },
    stdin: Readable.from([]),
    get stdoutText() {
      return state.stdoutText
    },
    get stderrText() {
      return state.stderrText
    },
  }
}

void main()
