import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { Assistant, TOO_LONG, describeError, quietTimer } from './assistant'
import { type Backend, BackendError, type TurnRequest } from './backends'

const quiet = { text: () => {}, status: () => {}, proposal: () => {} }

/** A model that fails `fails` times, then answers. */
function flaky(fails: number) {
  const seen: TurnRequest['messages'][] = []
  const backend = {
    turn: async (req: TurnRequest) => {
      seen.push(structuredClone(req.messages))
      if (seen.length <= fails) throw new BackendError('The model server returned an error (502)', 502)
      return { content: [{ type: 'text', text: 'Done.' }], stop: 'end_turn' }
    },
  } as unknown as Backend
  const assistant = new Assistant(backend, { board: emptyBoard, measure: fakeMeasure, selection: () => [] })
  return { assistant, seen }
}

describe('trying again', () => {
  it('asks the same question once more, without saying it twice', async () => {
    const { assistant, seen } = flaky(1)
    await expect(assistant.send('Plan the trip', quiet)).rejects.toThrow(/502/)
    await assistant.retry(quiet)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual(seen[0])
    expect(JSON.stringify(seen[1]).match(/Plan the trip/g)).toHaveLength(1)
  })

  it('can fail again and still try once more', async () => {
    const { assistant, seen } = flaky(2)
    await expect(assistant.send('Plan the trip', quiet)).rejects.toThrow()
    await expect(assistant.retry(quiet)).rejects.toThrow()
    await assistant.retry(quiet)
    expect(seen).toHaveLength(3)
  })

  it('asks nothing when the last message was answered', async () => {
    const { assistant, seen } = flaky(0)
    await assistant.send('Plan the trip', quiet)
    await assistant.retry(quiet)
    expect(seen).toHaveLength(1)
  })
})

describe('what a failure says', () => {
  it('names a slow answer, however it ended', () => {
    expect(describeError(new Anthropic.APIConnectionTimeoutError())).toBe(TOO_LONG)
    expect(describeError(new BackendError('The model server returned an error (504)', 504))).toBe(TOO_LONG)
    expect(describeError(new BackendError('The model server returned an error (408)', 408))).toBe(TOO_LONG)
  })

  it('names a reply cut off partway', () => {
    expect(describeError(new TypeError('terminated'))).toMatch(/connection dropped/)
  })

  it('keeps the other messages', () => {
    expect(describeError(new BackendError('The model server returned an error (500)', 500))).toMatch(/500/)
    expect(describeError(new DOMException('Aborted', 'AbortError'))).toBe('Stopped.')
  })
})

describe('a request that goes quiet', () => {
  it('fires only after a full stretch of silence', () => {
    vi.useFakeTimers()
    const fire = vi.fn()
    const t = quietTimer(1000, fire)
    vi.advanceTimersByTime(900)
    t.poke()
    vi.advanceTimersByTime(900)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fire).toHaveBeenCalledOnce()
    const done = quietTimer(1000, fire)
    done.stop()
    vi.advanceTimersByTime(5000)
    expect(fire).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
