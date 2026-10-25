/**
 * Template buttons in wiki pages: `{{button "New meeting note" template="Meeting template"}}`
 * shows a button that makes a new page from the template page (under this one, or `under="…"`),
 * or with `into="here"` adds the template's words just below the button. In the template,
 * `{{today}}` and `{{me}}` become the date and whoever pressed it, fixed at that moment; the new
 * page's title is `title="…"` (which can use [today] and [me]), or the template's title and the date.
 */

import type { MacroArgs } from './macros'

/** The day as a page title reads it: "25 Oct 2026". */
export const dayWords = (now: Date) => now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Template words with `{{today}}` (or `{{date}}`) and `{{me}}` filled in for good. */
export function stamp(text: string, now: Date, me: string): string {
  return text.replace(/\{\{\s*(today|date)\s*\}\}/gi, dayWords(now)).replace(/\{\{\s*me\s*\}\}/gi, me || 'someone')
}

export interface ButtonPlan {
  label: string
  /** The template page, by title. */
  template: string
  /** Add the words below the button instead of making a page. */
  here: boolean
  /** The new page's parent, by title (else the page the button is on). */
  under?: string
  title?: string
}

/** What a button macro asks for. */
export function buttonPlan(args: MacroArgs): ButtonPlan {
  return {
    label: args.pos[0]?.trim() || args.named.label || 'New from template',
    template: (args.named.template ?? args.pos[1] ?? '').trim(),
    here: /^(here|this page|below)$/i.test(args.named.into ?? ''),
    ...(args.named.under ? { under: args.named.under } : {}),
    ...(args.named.title ? { title: args.named.title } : {}),
  }
}

/** A new page's title: the button's, or the template's with the date. */
export const newTitle = (plan: ButtonPlan, templateTitle: string, now: Date, me: string) =>
  // In a button's own title the marks take square brackets ([today]), as macro options can't hold braces.
  plan.title ? stamp(plan.title.replace(/\[\s*(today|date|me)\s*\]/gi, '{{$1}}'), now, me) : `${templateTitle} — ${dayWords(now)}`
