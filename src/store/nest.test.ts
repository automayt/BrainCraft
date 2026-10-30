import { describe, expect, it } from 'vitest'
import { nested } from './nest'

type B = { id: string; live?: string; parent?: string }
const keys = (b: B) => [b.id, ...(b.live ? [b.live] : [])]

describe('child boards in a list', () => {
  it('come right after their parent, however deep, by either of its keys', () => {
    const list: B[] = [{ id: 'kit', parent: 'TRIP' }, { id: 'notes' }, { id: 'trip', live: 'TRIP' }, { id: 'tents', parent: 'kit' }, { id: 'lost', parent: 'gone' }]
    expect(nested(list, keys, (b) => b.parent).map(({ item, depth }) => `${item.id}:${depth}`)).toEqual(['notes:0', 'trip:0', 'kit:1', 'tents:2', 'lost:0'])
  })

  it('still lists boards whose parents form a loop', () => {
    const list: B[] = [
      { id: 'a', parent: 'b' },
      { id: 'b', parent: 'a' },
      { id: 'c', parent: 'c' },
    ]
    expect(nested(list, keys, (b) => b.parent).map(({ item }) => item.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
