import { describe, expect, it } from 'vitest'
import { InteractivePromptController } from './lineReader.js'

describe('InteractivePromptController', () => {
  it('exposes pending prompt request metadata until answered', async () => {
    const controller = new InteractivePromptController()
    const pendingAnswer = controller.question({
      kind: 'permission',
      title: 'Permission required',
      lines: ['action: write'],
      choices: [{ key: '1', label: 'Allow', value: 'y' }],
    })

    expect(controller.getPending()?.request?.title).toBe('Permission required')
    expect(controller.getPending()?.request?.choices?.[0]?.value).toBe('y')

    controller.answer('y')
    await expect(pendingAnswer).resolves.toBe('y')
    expect(controller.getPending()).toBeNull()
  })
})
