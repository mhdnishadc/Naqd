import { ReactNode, useState } from 'react'
import { fmt } from '../lib/money'
import { addParty, Party, PartyType } from '../lib/api'
import { useT } from '../lib/i18n'
import { useToast } from '../lib/hooks'

/** An amount in SAR with tabular digits. `tone` colours positive/negative flows. */
export function Amt({ v, tone, strong }: { v: number; tone?: 'in' | 'out' | 'auto'; strong?: boolean }) {
  const cls = tone === 'auto' ? (v < 0 ? 'neg' : v > 0 ? 'pos' : '') : tone === 'in' ? 'pos' : tone === 'out' ? 'neg' : ''
  return <span className={`amt ${cls} ${strong ? 'strong' : ''}`} dir="ltr">{fmt(v)}</span>
}

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  )
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><p>{children}</p>{action}</div>
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(o => (
        <button key={o.v} type="button" role="tab" aria-selected={value === o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  )
}

/** Dropdown of parties of one type, with inline "add new". */
export function PartySelect({ type, parties, value, onChange, onAdded, optional, label }: {
  type: PartyType; parties: Party[]; value: string; onChange: (id: string) => void
  onAdded: () => void; optional?: boolean; label: string
}) {
  const { t } = useT()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const list = parties.filter(p => p.type === type && p.active)

  async function create() {
    if (!name.trim()) return
    try {
      const p = await addParty(type, name)
      setName(''); setAdding(false); onAdded(); onChange(p.id)
    } catch (e: any) { toast(e.message, 'err') }
  }
  return (
    <div className="field">
      <span className="field-label">{label}{optional && <em> · {t('optional')}</em>}</span>
      {adding ? (
        <div className="inline-add">
          <input autoFocus value={name} placeholder={t('newName')} onChange={e => setName(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create() } }} />
          <button type="button" className="btn primary sm" onClick={create}>{t('add')}</button>
          <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>{t('cancel')}</button>
        </div>
      ) : (
        <select value={value} onChange={e => { if (e.target.value === '__new') setAdding(true); else onChange(e.target.value) }}>
          <option value="">{t('chooseOne')}</option>
          {list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new">{t('addNew')}</option>
        </select>
      )}
    </div>
  )
}
