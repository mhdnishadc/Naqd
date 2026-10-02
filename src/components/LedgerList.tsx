import { useState } from 'react'
import { LedgerRow, receiptUrl, voidEntry } from '../lib/api'
import { useT } from '../lib/i18n'
import { useToast } from '../lib/hooks'
import { Amt } from './ui'

export function LedgerList({ rows, onChanged, showParty = true }: { rows: LedgerRow[]; onChanged: () => void; showParty?: boolean }) {
  const { t, kind } = useT()
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [voiding, setVoiding] = useState<string | null>(null)

  async function doVoid(id: string) {
    try { await voidEntry(id, reason); toast(t('voided')); setVoiding(null); setReason(''); onChanged() }
    catch (e: any) { toast(e.message, 'err') }
  }
  async function showReceipt(path: string) {
    try { window.open(await receiptUrl(path), '_blank', 'noopener') } catch (e: any) { toast(e.message, 'err') }
  }

  return (
    <ul className="rows">
      {rows.map(r => {
        const voided = Boolean(r.voided_at)
        const isOpen = open === r.id
        const sign = r.direction === 'in' ? '+' : '−'
        return (
          <li key={r.id} className={`row ${voided ? 'voided' : ''}`}>
            <button className="row-main" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
              <span className="row-date" dir="ltr">{r.entry_date.slice(5)}</span>
              <span className="row-body">
                <span className="row-title">{kind(r.kind)}{voided && <em className="tag"> {t('voidedTag')}</em>}{r.source === 'voice' && <em className="tag"> {t('voice')}</em>}</span>
                <span className="row-sub">
                  {showParty && r.party?.name}{showParty && r.party?.name && r.note ? ' · ' : ''}{r.note}
                  {!r.affects_cash && <em className="tag"> {t('noCashTag')}</em>}
                </span>
              </span>
              <span className={`row-amt ${r.direction === 'in' ? 'pos' : 'neg'} ${!r.affects_cash ? 'muted' : ''}`} dir="ltr">
                {sign}<Amt v={r.amount} />
              </span>
            </button>
            {isOpen && (
              <div className="row-detail">
                <dl>
                  <dt>{t('date')}</dt><dd dir="ltr">{r.entry_date}</dd>
                  {r.meta?.vehicle && <><dt>{t('vehicle')}</dt><dd>{r.meta.vehicle}</dd></>}
                  {r.meta?.km && <><dt>{t('km')}</dt><dd dir="ltr">{r.meta.km}</dd></>}
                  {r.void_reason && <><dt>{t('voidReason')}</dt><dd>{r.void_reason}</dd></>}
                </dl>
                <div className="row-actions">
                  {r.receipt_path && <button className="btn ghost sm" onClick={() => showReceipt(r.receipt_path!)}>{t('viewReceipt')}</button>}
                  {!voided && voiding !== r.id && <button className="btn danger sm" onClick={() => setVoiding(r.id)}>{t('void')}</button>}
                </div>
                {voiding === r.id && (
                  <div className="inline-add">
                    <input autoFocus placeholder={t('voidReason')} value={reason} onChange={e => setReason(e.target.value)} />
                    <button className="btn danger sm" disabled={!reason.trim()} onClick={() => doVoid(r.id)}>{t('void')}</button>
                    <button className="btn ghost sm" onClick={() => setVoiding(null)}>{t('cancel')}</button>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
