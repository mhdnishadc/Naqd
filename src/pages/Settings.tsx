import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { renameWorkspace } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useOutbox, useToast } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { syncOutbox } from '../lib/outbox'
import { Segmented } from '../components/ui'
import { ShareAccess } from '../components/ShareAccess'

export default function Settings() {
  const { t, lang, setLang } = useT()
  const { tenantName, isOwner, session, signOut, refresh } = useAuth()
  const outbox = useOutbox()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function rename() {
    setSaving(true)
    try { await renameWorkspace(name.trim()); await refresh(); setEditing(false); toast(t('saved')) }
    catch (e: any) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  async function backup() {
    setBusy(true)
    try {
      const out: Record<string, unknown> = { exported_at: new Date().toISOString(), workspace: tenantName }
      for (const tbl of ['parties', 'ledger_entries', 'purchases', 'collections', 'audit_log']) {
        const { data, error } = await supabase.from(tbl).select('*')
        if (error) throw error
        out[tbl] = data
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `naqd-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="page narrow">
      <h1>{t('settings')}</h1>
      <section className="panel">
        <h2>{t('language')}</h2>
        <Segmented value={lang} onChange={setLang} options={[{ v: 'en', label: 'English' }, { v: 'ar', label: 'العربية' }]} />
      </section>
      <section className="panel">
        <h2>{t('workspace')}</h2>
        {editing ? (
          <form className="inline-add stack" onSubmit={e => { e.preventDefault(); rename() }}>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={120}
              aria-label={t('workspaceName')} placeholder={t('workspaceName')} />
            <button type="submit" className="btn primary sm" disabled={saving || !name.trim() || name.trim() === tenantName}>{t('save')}</button>
            <button type="button" className="btn ghost sm" disabled={saving} onClick={() => setEditing(false)}>{t('cancel')}</button>
          </form>
        ) : (
          <div className="ws-name">
            <p>{tenantName}</p>
            {isOwner && <button className="btn ghost sm" onClick={() => { setName(tenantName); setEditing(true) }}>{t('edit')}</button>}
          </div>
        )}
        <p className="muted" dir="ltr">{session?.user.email}</p>
      </section>
      {isOwner && <ShareAccess />}
      <section className="panel">
        <h2>{t('backup')}</h2>
        <p className="muted">{t('backupHint')}</p>
        <button className="btn primary" disabled={busy} onClick={backup}>{t('exportBackup')}</button>
      </section>
      <section className="panel">
        <h2>{t('syncQueue')}</h2>
        <p>{outbox.waiting === 0 && outbox.rejected === 0 ? t('none') : `${outbox.waiting} ${t('pending')} · ${outbox.rejected} ${t('rejected')}`}</p>
        <button className="btn ghost" onClick={() => syncOutbox()}>{t('syncNow')}</button>
      </section>
      <button className="btn danger" onClick={signOut}>{t('signOut')}</button>
    </div>
  )
}
