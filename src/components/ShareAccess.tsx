import { useState } from 'react'
import { disableShareLink, getShareLink, resetShareLink } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAsync, useToast } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { longDate } from '../lib/money'
import { shareUrl } from '../lib/share'

/** Owner-only: one read-only link per workspace. No expiry; reset replaces it, turn off removes it. */
export function ShareAccess() {
  const { t, lang } = useT()
  const { tenantName } = useAuth()
  const toast = useToast()
  const link = useAsync(getShareLink, [])
  const [busy, setBusy] = useState(false)

  const url = link.data ? shareUrl(link.data.token) : ''
  const message = t('shareMessage').replace('{name}', tenantName).replace('{url}', url)
  const subject = t('shareSubject').replace('{name}', tenantName)

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true)
    try { await action(); link.reload(); toast(done) }
    catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  const create = () => run(resetShareLink, t('linkCreated'))
  const reset = () => window.confirm(t('confirmReset')) && run(resetShareLink, t('linkReset'))
  const disable = () => window.confirm(t('confirmDisable')) && run(disableShareLink, t('linkDisabled'))

  async function copy() {
    try { await navigator.clipboard.writeText(url); toast(t('copied')) }
    catch { toast(t('copyFailed'), 'err') }
  }
  async function nativeShare() {
    try { await navigator.share({ title: subject, text: message }) }
    catch (e: any) { if (e?.name !== 'AbortError') copy() }   // closing the sheet is not an error
  }

  return (
    <section className="panel share">
      <h2>{t('shareTitle')}</h2>
      <p className="muted">{t('shareHint')}</p>

      {link.loading && !link.data ? <p className="muted">{t('loading')}</p>
        : link.error ? <p className="field-error" role="alert">{link.error}</p>
        : !link.data ? (
          <button className="btn primary" disabled={busy} onClick={create}>{t('createLink')}</button>
        ) : (
          <>
            <input className="share-url" readOnly value={url} dir="ltr" aria-label={t('shareTitle')}
              onFocus={e => e.currentTarget.select()} />
            <div className="share-actions">
              {typeof navigator.share === 'function' && <button className="btn primary" onClick={nativeShare}>{t('shareLink')}</button>}
              <button className="btn ghost" onClick={copy}>{t('copyLink')}</button>
              <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <a className="btn ghost" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}>{t('email')}</a>
            </div>
            <dl className="share-meta">
              <dt>{t('linkCreatedOn')}</dt><dd>{longDate(link.data.created_at, lang)}</dd>
              <dt>{t('lastOpened')}</dt><dd>{link.data.last_viewed_at ? longDate(link.data.last_viewed_at, lang) : t('neverOpened')}</dd>
            </dl>
            <div className="share-actions">
              <button className="btn ghost" disabled={busy} onClick={reset}>{t('resetLink')}</button>
              <button className="btn danger" disabled={busy} onClick={disable}>{t('disableLink')}</button>
            </div>
          </>
        )}
    </section>
  )
}
