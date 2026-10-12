/**
 * Read-only share links: https://<app>/view#<token>
 * The token sits in the URL fragment, so it is never sent to the web server or leaked in a Referer.
 * On open it is moved into localStorage and wiped from the address bar; from then on this browser
 * shows the shared workspace read-only until the viewer leaves or the owner resets the link.
 */
const KEY = 'naqd:share'
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

/** Call once before the app renders. */
export function captureShareToken() {
  if (!/^\/view\/?$/.test(location.pathname)) return
  const token = decodeURIComponent(location.hash.replace(/^#/, ''))
  if (TOKEN_RE.test(token)) {
    try { localStorage.setItem(KEY, token) } catch { /* private mode: falls back to the sign-in screen */ }
  }
  history.replaceState(null, '', '/')
}

export function shareToken(): string | null {
  try {
    const t = localStorage.getItem(KEY)
    return t && TOKEN_RE.test(t) ? t : null
  } catch { return null }
}

export function clearShareToken() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/** The server answers every unknown, reset or disabled link with this one error. */
export const isShareInvalid = (e: unknown) => /share_link_invalid/.test((e as any)?.message ?? '')
export const SHARE_INVALID_EVENT = 'naqd:share-invalid'

export const shareUrl = (token: string) => `${location.origin}/view#${token}`
