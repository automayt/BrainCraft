import { useState } from 'react'
import { embedFor, LINK_CAPTION_H, linkLabel, safeUrl, siteOf } from '../model/linkCard'
import type { Item } from '../model/types'
import { useEditor } from './useEditor'

/**
 * A web link as a card: picture or player on top, title and site below. Players
 * only load once the card is selected (`live`), so a board full of videos stays
 * light and the card can still be dragged by its picture.
 */
export function LinkCardView({ item, live }: { item: Item; live: boolean }) {
  const editor = useEditor()
  const card = item.link
  const [broken, setBroken] = useState(false)
  if (!card) return null
  if (item.page) return <PageCardView item={item} onRead={() => editor.peekPage({ ...item.page! })} />
  const href = safeUrl(card.url)
  const embed = href ? embedFor(href) : null
  const picture = !broken ? safeUrl(embed?.thumb) ?? safeUrl(card.image) : null
  const site = card.site || siteOf(card.url)
  const title = linkLabel(card)
  const hasMedia = !!embed || !!picture
  const mediaH = Math.max(0, item.h - LINK_CAPTION_H)

  return (
    <foreignObject x={item.x} y={item.y} width={item.w} height={item.h}>
      <div className={`link-card${hasMedia ? ' has-media' : ''}`}>
        {hasMedia && (
          <div className={`link-media${embed && live ? ' no-canvas' : ''}`} style={{ height: mediaH }}>
            {embed && live ? (
              <iframe
                src={embed.src}
                title={`${embed.provider}: ${title}`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
              />
            ) : (
              <>
                {picture ? (
                  <img src={picture} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
                ) : (
                  <div className={`link-media-blank ${embed?.provider.toLowerCase() ?? ''}`}>{embed?.provider}</div>
                )}
                {embed && (
                  <span className="link-play" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22">
                      <path d="M8 5v14l11-7z" fill="currentColor" />
                    </svg>
                  </span>
                )}
              </>
            )}
          </div>
        )}
        <div className="link-caption" style={hasMedia ? { height: LINK_CAPTION_H } : undefined}>
          <div className="link-text">
            <span className="link-site">{embed && !live ? `${site} · select to play` : site}</span>
            <strong className="link-title">{title}</strong>
            {!hasMedia && card.description && <span className="link-desc">{card.description}</span>}
          </div>
          {href && (
            <a className="link-open no-canvas" href={href} target="_blank" rel="noopener noreferrer" title={`Open ${site} in a new tab`} aria-label={`Open ${title} in a new tab`}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </foreignObject>
  )
}

/** A wiki page on the board: its title and opening words; Read opens it beside the board. */
function PageCardView({ item, onRead }: { item: Item; onRead: () => void }) {
  const card = item.link!
  return (
    <foreignObject x={item.x} y={item.y} width={item.w} height={item.h}>
      <div className="link-card page-card">
        <div className="link-caption">
          <div className="link-text">
            <span className="link-site">{card.site || '📘 Wiki page'}</span>
            <strong className="link-title">{card.title || 'Wiki page'}</strong>
            {card.description && <span className="link-desc">{card.description}</span>}
          </div>
          <button className="link-open no-canvas" title="Read this page beside the board" aria-label={`Read ${card.title || 'this page'}`} onClick={onRead}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </foreignObject>
  )
}
