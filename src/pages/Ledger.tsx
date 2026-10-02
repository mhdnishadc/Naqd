import { useMemo, useState } from 'react'
import { getLedger } from '../lib/api'
import { discard, retry } from '../lib/outbox'
import { useAsync, useOutbox } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { monthEnd, monthISO, monthStart } from '../lib/money'
import { Amt, Empty } from '../components/ui'
import { LedgerList } from '../components/LedgerList'

const FILTERS = ['all', 'purchase', 'collection', 'bank_withdrawal', 'topup', 'advance', 'employee_return', 'advance_expense', 'fuel', 'transport', 'expense']

export default function Ledger() {
  const { t, kind } = useT()
  const [ym, setYm] = useState(monthISO())
  const [k, setK] = useState('all')
  const [q, setQ] = useState('')
  const { data, loading, reload } = useAsync(() => getLedger({ from: monthStart(ym), to: monthEnd(ym), limit: 500 }), [ym])
  const outbox = useOutbox()

  const rows = useMemo(() => (data ?? []).filter(r =>
    (k === 'all' || r.kind === k) &&
    (!q || `${r.party?.name ?? ''} ${r.note ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, k, q])

  return (
    <div className="page">
      <h1>{t('ledger')}</h1>
      <div className="filters">
        <input type="month" value={ym} onChange={e => e.target.value && setYm(e.target.value)} aria-label={t('month')} />
        <select value={k} onChange={e => setK(e.target.value)} aria-label={t('ledgerFilter')}>
          {FILTERS.map(f => <option key={f} value={f}>{f === 'all' ? t('allKinds') : kind(f)}</option>)}
        </select>
        <input type="search" placeholder={t('search')} value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {outbox.items.length > 0 && (
        <section className="panel pending">
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

      {rows.length > 0 ? <LedgerList rows={rows} onChanged={reload} /> : !loading && <Empty>{t('noPartiesYet')}</Empty>}
    </div>
  )
}
