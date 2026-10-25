import { describe, expect, it } from 'vitest'
import { Editor } from '../editor/Editor'
import { expandSynced, findSynced, syncedPages } from './synced'
import { fakeMeasure } from './test-helpers'
import * as W from './wiki'

function wiki() {
  let b = W.emptyWiki('Team')
  let contacts: string
  let onboarding: string
  ;[b, contacts] = W.addPage(b, { title: 'Contacts', text: '# Contacts\n\n{{synced "Help desk"}}\n- Phone: 555-0100\n- [ ] Update the rota\n{{/synced}}\n\nMore below.' })
  ;[b, onboarding] = W.addPage(b, { title: 'Onboarding', text: '# Onboarding\n\nWho to call:\n\n{{synced "Help desk"}}\n\nWelcome!' })
  return { b, contacts, onboarding }
}

describe('synced sections', () => {
  it('finds the page holding a section, and every page showing it', () => {
    const { b, contacts, onboarding } = wiki()
    expect(findSynced(b, 'help desk')).toEqual({ page: contacts, open: 2, close: 5, text: '- Phone: 555-0100\n- [ ] Update the rota' })
    expect(syncedPages(b, 'Help desk')).toEqual([contacts, onboarding])
    expect(findSynced(b, 'Nope')).toBeNull()
  })

  it('changes the words where they are held when edited from any page', () => {
    const { b, contacts } = wiki()
    const e = new Editor(b, fakeMeasure)
    expect(e.setSyncedSection('Help desk', '- Phone: 555-0199\n- Chat: #help')).toBe(true)
    expect(W.pageText(e.board, contacts)).toBe('# Contacts\n\n{{synced "Help desk"}}\n- Phone: 555-0199\n- Chat: #help\n{{/synced}}\n\nMore below.')
    // Every page showing it now reads the same.
    expect(findSynced(e.board, 'Help desk')!.text).toBe('- Phone: 555-0199\n- Chat: #help')
    expect(e.setSyncedSection('Nope', 'x')).toBe(false)
  })

  it('writes the words into pages that only name it, for search and exports', () => {
    const { b, onboarding } = wiki()
    expect(expandSynced(b, W.pageText(b, onboarding))).toContain('- Phone: 555-0100')
    // Search finds the page by them.
    expect(W.searchPages(b, '555-0100').map((h) => h.page.id)).toContain(onboarding)
  })
})
