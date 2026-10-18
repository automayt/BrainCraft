/** Ready-made wikis for the things friends plan together. */

import type { Board } from './types'
import { addPage, emptyWiki } from './wiki'

interface TemplatePage {
  title: string
  icon?: string
  text: string
  children?: TemplatePage[]
}

export interface WikiTemplate {
  id: string
  label: string
  hint: string
  title: string
  pages: TemplatePage[]
}

export const WIKI_TEMPLATES: WikiTemplate[] = [
  {
    id: 'wiki',
    label: 'Blank wiki',
    hint: 'Pages in a tree, written in Markdown',
    title: 'Untitled wiki',
    pages: [],
  },
  {
    id: 'wiki-trip',
    label: 'Trip',
    hint: 'Plan, packing, budget, bookings',
    title: 'Our trip',
    pages: [
      {
        title: 'Home',
        icon: '🧳',
        text: '# Our trip\n\n> [!tip] Where and when\n> Add the dates and the place here, so everyone sees them first.\n\n{{children}}\n',
      },
      {
        title: 'Plan',
        icon: '🗓',
        text: '## Day by day\n\n### Day 1\n- [ ] Travel there\n- [ ] Check in\n\n### Day 2\n- [ ] \n\n## Ideas\n- \n',
      },
      {
        title: 'Packing',
        icon: '🎒',
        text: '## Everyone brings\n- [ ] Passport or ID\n- [ ] Chargers\n- [ ] Medicines\n\n## Shared (say who)\n| Thing | Who |\n| --- | --- |\n| First-aid kit |  |\n| Speaker |  |\n',
      },
      {
        title: 'Budget',
        icon: '💶',
        text: '| What | Cost | Paid by |\n| --- | ---: | --- |\n| Travel |  |  |\n| Place to stay |  |  |\n| Food |  |  |\n',
      },
      {
        title: 'Bookings',
        icon: '🎟',
        text: '| What | When | Reference | Booked by |\n| --- | --- | --- | --- |\n|  |  |  |  |\n',
      },
    ],
  },
  {
    id: 'wiki-move',
    label: 'Moving house',
    hint: 'Countdown checklist, rooms, contacts',
    title: 'The move',
    pages: [
      { title: 'Home', icon: '🏠', text: '# The move\n\n{{children}}\n' },
      {
        title: 'Countdown',
        icon: '✅',
        text: '## Eight weeks before\n- [ ] Give notice\n- [ ] Book the van or movers\n\n## Four weeks before\n- [ ] Change address with the bank, doctor, post\n- [ ] Start packing what we rarely use\n\n## The week of\n- [ ] Read the meters\n- [ ] Pack a first-night box\n',
      },
      { title: 'Rooms', icon: '📦', text: '## Kitchen\n- [ ] \n\n## Living room\n- [ ] \n\n## Bedrooms\n- [ ] \n' },
      { title: 'Contacts', icon: '📇', text: '| Who | For | Phone |\n| --- | --- | --- |\n| Landlord |  |  |\n| Movers |  |  |\n' },
    ],
  },
  {
    id: 'wiki-party',
    label: 'Party',
    hint: 'Guests, who brings what, the day',
    title: 'The party',
    pages: [
      { title: 'Home', icon: '🎉', text: '# The party\n\n> [!note] When and where\n> \n\n{{children}}\n' },
      { title: 'Guests', icon: '💌', text: '| Name | Coming? | Plus one |\n| --- | --- | --- |\n|  |  |  |\n' },
      { title: 'Who brings what', icon: '🥗', text: '| Food or drink | Who |\n| --- | --- |\n| Snacks |  |\n| Drinks |  |\n| Dessert |  |\n' },
      { title: 'On the day', icon: '⏰', text: '- [ ] Set up\n- [ ] Music\n- [ ] Clean up\n' },
    ],
  },
  {
    id: 'wiki-club',
    label: 'Club handbook',
    hint: 'How we work, schedule, members, FAQ',
    title: 'Our club',
    pages: [
      { title: 'Home', icon: '📘', text: '# Our club\n\nWhat we do, in a sentence.\n\n{{children}}\n' },
      { title: 'How we work', icon: '🤝', text: '## Meetings\n\n## Decisions\n\n## Money\n' },
      { title: 'Schedule', icon: '🗓', text: '| Date | What | Host |\n| --- | --- | --- |\n|  |  |  |\n' },
      { title: 'Members', icon: '👥', text: '| Name | Role | Contact |\n| --- | --- | --- |\n|  |  |  |\n' },
      { title: 'FAQ', icon: '❓', text: '### How do I join?\n\n### Where do we meet?\n' },
    ],
  },
]

/** A new wiki from a template (a blank one when the id isn't known). */
export function wikiFromTemplate(id: string, title?: string, now = Date.now()): Board {
  const t = WIKI_TEMPLATES.find((x) => x.id === id) ?? WIKI_TEMPLATES[0]
  const name = title ?? t.title
  if (!t.pages.length) return emptyWiki(name, now)
  let b: Board = { ...emptyWiki(name, now), pages: [], bodies: [] }
  const add = (pages: TemplatePage[], parent?: string) => {
    for (const p of pages) {
      let id: string
      ;[b, id] = addPage(b, { title: p.title, parent, text: p.text.replace(`# ${t.title}`, `# ${name}`), icon: p.icon }, now)
      if (p.children) add(p.children, id)
    }
  }
  add(t.pages)
  return b
}
