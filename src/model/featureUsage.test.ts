import { describe, expect, it } from 'vitest'
import { featuresOf, tallyFeatures } from './featureUsage'
import * as W from './wiki'

describe('feature usage', () => {
  it('counts what wiki pages use', () => {
    let b = W.emptyWiki('Team')
    ;[b] = W.addPage(b, { title: 'Contacts', text: '{{synced "Help"}}\n- [ ] Call\n{{/synced}}\n\n{{toc}}\n\n![[Plan]](board:abc#1)' })
    ;[b] = W.addPage(b, { title: 'Notes', text: '{{button "New note" template="Note"}}\n{{synced "Help"}}' })
    const f = featuresOf(b)
    expect(f).toMatchObject({ synced: 2, button: 1, macro: 1, checklist: 1, embed: 1 })
    expect(f.page).toBeGreaterThanOrEqual(2)
    const t = tallyFeatures([b, b])
    expect(t.wikis).toBe(2)
    expect(t.rows.find((r) => r.feature === 'synced')).toMatchObject({ boards: 2, total: 4 })
  })
})
