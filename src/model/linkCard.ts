/**
 * Link cards: a pasted web address shown as a card with its title, description
 * and picture. Videos and music from a few well-known sites play right on the
 * card; which ones, and how, is worked out from the address alone.
 */

import { newItem } from './board'
import { rectFromCenter, type Vec } from './geom'
import type { Item, LinkCard } from './types'

export interface Embed {
  provider: 'YouTube' | 'Vimeo' | 'Spotify'
  /** Address of the player, for an iframe. */
  src: string
  /** A still to show until the card is selected (when the site offers one without asking a server). */
  thumb?: string
  /** Player width ÷ height. */
  ratio: number
}

/** The single web address `text` is, if it's nothing but one. */
export function urlIn(text: string): string | null {
  const t = text.trim()
  if (!t || /\s/.test(t) || t.length > 2048) return null
  try {
    const u = new URL(t)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.href : null
  } catch {
    return null
  }
}

const YT_ID = /^[\w-]{11}$/

/** How to play `url` in place, for the sites that allow it. */
export function embedFor(url: string): Embed | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  const path = u.pathname.split('/').filter(Boolean)
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const id = host === 'youtu.be' ? path[0] : path[0] === 'watch' || !path.length ? u.searchParams.get('v') : ['shorts', 'embed', 'live', 'v'].includes(path[0]) ? path[1] : null
    if (!id || !YT_ID.test(id)) return null
    const t = Number.parseInt(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '', 10)
    return {
      provider: 'YouTube',
      src: `https://www.youtube-nocookie.com/embed/${id}${t > 0 ? `?start=${t}` : ''}`,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      ratio: path[0] === 'shorts' ? 9 / 16 : 16 / 9,
    }
  }
  if (host === 'vimeo.com' && /^\d+$/.test(path[0] ?? '')) return { provider: 'Vimeo', src: `https://player.vimeo.com/video/${path[0]}`, ratio: 16 / 9 }
  if (host === 'open.spotify.com') {
    // Links may start with a locale ("intl-de").
    const rest = path[0]?.startsWith('intl-') ? path.slice(1) : path
    const [type, id] = rest
    if (['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(type) && /^[A-Za-z0-9]+$/.test(id ?? ''))
      return { provider: 'Spotify', src: `https://open.spotify.com/embed/${type}/${id}`, ratio: type === 'track' || type === 'episode' ? 400 / 152 : 400 / 352 }
  }
  return null
}

/** The site a link is on, for the card's small print. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Height of the title strip under a player or picture. */
export const LINK_CAPTION_H = 76

/** A good size for a new card (players keep their shape; plain links stay compact). */
export function linkCardSize(card: LinkCard): { w: number; h: number } {
  const embed = embedFor(card.url)
  if (embed) {
    const w = embed.provider === 'Spotify' ? 400 : embed.ratio < 1 ? 280 : 480
    return { w, h: Math.round(w / embed.ratio) + LINK_CAPTION_H }
  }
  return card.image ? { w: 360, h: 190 + LINK_CAPTION_H + 24 } : { w: 360, h: 120 }
}

/** What a card is called in lists, search and the AI's view of the board. */
/** What a card is called before (or without) a preview: the address's last readable part, else its site. */
function fromPath(url: string): string | undefined {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '')
    const words = last.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_+]+/g, ' ').trim()
    return words.length > 1 && !/^d+$/.test(words) ? words : undefined
  } catch {
    return undefined
  }
}

export const linkLabel = (card: LinkCard) => card.title?.trim() || fromPath(card.url) || siteOf(card.url)

/** Only web addresses are ever used as links or pictures, whatever a board file says. */
export const safeUrl = (u: string | undefined): string | null => (u ? urlIn(u) : null)

/** A new card for `url` centred on `at`, waiting for its preview. */
export function linkItem(url: string, at: Vec): Omit<Item, 'id'> {
  const link: LinkCard = { url }
  const size = linkCardSize(link)
  return newItem('link', rectFromCenter(at, size.w, size.h), { text: linkLabel(link), link })
}

/**
 * The card with its preview filled in. A card still at the size it was made
 * with grows to fit a picture; one resized by hand keeps its size.
 */
export function withPreview(item: Item, preview: Partial<LinkCard>): Item {
  if (!item.link) return item
  const link: LinkCard = { ...item.link, ...preview, url: item.link.url, checked: true }
  const was = linkCardSize(item.link)
  const fits = Math.round(item.w) === was.w && Math.round(item.h) === was.h ? linkCardSize(link) : null
  return { ...item, link, text: linkLabel(link), ...(fits ? { w: fits.w, h: fits.h } : {}) }
}
