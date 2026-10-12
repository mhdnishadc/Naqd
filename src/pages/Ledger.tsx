import { useEffect, useMemo, useState } from 'react'
import { getLedgerRange } from '../lib/api'
import { discard, retry } from '../lib/outbox'
import { useAuth } from '../lib/auth'
import { printAs } from '../lib/print'
import { useAsync, useOutbox } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { longDate, monthEnd, monthISO, monthStart, todayISO } from '../lib/money'
import { Amt, Empty, Segmented } from '../components/ui'
import { LedgerList } from '../components/LedgerList'

const FILTERS = ['all', 'purchase', 'collection', 'vendor_refund','bank_withdrawal', 'topup', 'advance', 'employee_return', 'advance_expense', 'fuel', 'transport', 'expense']
type Flow = 'all' | 'in' | 'out'
const SCREEN_PAGE = 100   // rows drawn on screen at a time; keeps long months fast on phones

export default function Ledger() {
  const { t, kind, lang } = useT()
  const { tenantName, readOnly } = useAuth()
  const [ym, setYm] = useState(monthISO())
  const [k, setK] = useState('all')
  const [q, setQ] = useState('')
  const [flow, setFlow] = useState<Flow>('all')
  // the whole month is loaded (filters, totals and the PDF need every row); the screen shows it in pages
  const { data, loading, reload } = useAsync(() => getLedgerRange(monthStart(ym), monthEnd(ym)), [ym])
  const [shown, setShown] = useState(SCREEN_PAGE)
  useEffect(() => setShown(SCREEN_PAGE), [ym, k, q, flow])
  const outbox = useOutbox()
  const date = (iso: string) => longDate(iso, lang)

  // Cash in / out means real cash only, so "no cash moved" entries drop out of those views.
  const rows = useMemo(() => (data ?? []).filter(r =>
    (k === 'all' || r.kind === k) &&
    (flow === 'all' || (r.affects_cash && r.direction === flow)) &&
    (!q || `${r.party?.name ?? ''} ${r.note ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, k, q, flow])

  // The PDF leaves out voided entries, oldest first like a statement.
  const printRows = useMemo(() => rows.filter(r => !r.voided_at)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at)), [rows])
  const totals = useMemo(() => printRows.reduce((s, r) => {
    if (r.affects_cash) s[r.direction] += r.amount
    return s
  }, { in: 0, out: 0 }), [printRows])

  return (
    <div className="page">
      <h1 className="no-print">{t('ledger')}</h1>
      <div className="no-print" role="group" aria-label={t('cashFlow')}>
        <Segmented value={flow} onChange={setFlow} options={[
          { v: 'all', label: t('all') }, { v: 'in', label: t('flowIn') }, { v: 'out', label: t('flowOut') }]} />
      </div>
      <div className="filters no-print">
        <input type="month" value={ym} onChange={e => e.target.value && setYm(e.target.value)} aria-label={t('month')} />
        <select value={k} onChange={e => setK(e.target.value)} aria-label={t('ledgerFilter')}>
          {FILTERS.map(f => <option key={f} value={f}>{f === 'all' ? t('allKinds') : kind(f)}</option>)}
        </select>
        <input type="search" placeholder={t('search')} value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {printRows.length > 0 && (
        <div className="actions no-print">
          <button className="btn primary" onClick={() => printAs(tenantName)}>{t('printPdf')}</button>
        </div>
      )}

      {outbox.items.length > 0 && !readOnly && (
        <section className="panel pending no-print">
          <h2>{t('syncQueue')}</h2>
          <ul className="rows">
            {outbox.items.map(i => (
              <li key={i.id} className="row">
                <div className="row-main static">
                  <span className="row-body">
                    <span className="row-title">{i.label}</span>
                    <span className="row-sub">{i.error ? `${t('rejected')}: ${i.error}` : t('pending')}</span>
                  </span>
                  {i.amount != null && <span className="row-amt"><Amt v={i.amount} /></span>}
                </div>
                <div className="row-actions">
                  {i.error && <button className="btn ghost sm" onClick={() => retry(i.id)}>{t('retry')}</button>}
                  {i.error && <button className="btn danger sm" onClick={() => discard(i.id)}>{t('discard')}</button>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="no-print">
        {rows.length > 0 ? <LedgerList rows={rows.slice(0, shown)} onChanged={reload} /> : !loading && <Empty>{t('noPartiesYet')}</Empty>}
        {rows.length > shown && (
          <div className="more-rows">
            <span className="muted">{t('showingOf').replace('{n}', String(shown)).replace('{total}', String(rows.length))}</span>
            <button className="btn ghost" onClick={() => setShown(s => s + SCREEN_PAGE)}>{t('showMore')}</button>
          </div>
        )}
      </div>

      {printRows.length > 0 && (
        <article className="statement ledger-print print-only" lang={lang}>
          <header className="doc-head">
            <div>
              <h2>{tenantName}</h2>
              <p className="doc-title">{t('ledgerReport')}</p>
            </div>
            <dl className="doc-meta">
              <dt>{t('period')}</dt><dd>{date(monthStart(ym))} – {date(monthEnd(ym))}</dd>
              <dt>{t('generatedOn')}</dt><dd>{date(todayISO())}</dd>
            </dl>
          </header>
          <div className="scroll-x">
            <table className="grid wide">
              <thead><tr><th>{t('date')}</th><th>{t('transaction')}</th>{flow === 'all'
                ? <><th>{t('cashIn')}</th><th>{t('cashOut')}</th></>
                : <th>{t('amount')}</th>}</tr></thead>
              <tbody>
                {printRows.map(r => {
                  const detail = [r.party?.name, r.note].filter(Boolean).join(' · ')
                  return (
                    <tr key={r.id} className={r.affects_cash ? '' : 'muted-row'}>
                      <td dir="ltr">{r.entry_date}</td>
                      <td>
                        <strong>{kind(r.kind)}</strong>
                        {detail && <span className="sub">{detail}</span>}
                        {!r.affects_cash && <em className="tag"> {t('noCashTag')}</em>}
                      </td>
                      {flow === 'all'
                        ? <><td className="num">{r.direction === 'in' && <Amt v={r.amount} />}</td>
                            <td className="num">{r.direction === 'out' && <Amt v={r.amount} />}</td></>
                        : <td className="num"><Amt v={r.amount} /></td>}
                    </tr>
                  )
                })}
              </tbody>
              {flow === 'all' ? (
                <tfoot>
                  <tr><td></td><td>{t('total')}</td><td className="num"><Amt v={totals.in} /></td><td className="num"><Amt v={totals.out} /></td></tr>
                  <tr className="due"><td></td><td>{t('netCash')}</td><td colSpan={2} className="num"><span className="cur">SAR</span> <Amt v={totals.in - totals.out} strong /></td></tr>
                </tfoot>
              ) : (
                <tfoot>
                  <tr className="due"><td></td><td>{t(flow === 'in' ? 'totalCashIn' : 'totalCashOut')}</td><td className="num"><span className="cur">SAR</span> <Amt v={totals[flow]} strong /></td></tr>
                </tfoot>
              )}
            </table>
          </div>
        </article>
      )}
    </div>
  )
}
