/** The assistant panel and the Anthropic SDK load on first use, keeping them out of the startup bundle. */

import { lazy } from 'react'

let loading: Promise<typeof import('./AiPanel')> | null = null

/** Starts loading the panel (e.g. when the pointer heads for the Ask AI button). */
export const preloadAi = () => (loading ??= import('./AiPanel'))

export const LazyAiPanel = lazy(() => preloadAi().then((m) => ({ default: m.AiPanel })))
