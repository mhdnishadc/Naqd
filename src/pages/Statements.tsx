import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getParties, getStatement } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useAsync, useToast } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { fmt, monthISO, monthStart, plain } from '../lib/money'
import { Amt, Empty } from '../components/ui'

export default function Statements() {
  const { t, lang } = useT()
  const toast = useToast()
  const { tenantName } = useAuth()
  const [sp] = useSearchParams()
  const [client, setClient] = useState(sp.get('client') || '')
  const [ym, setYm] = useState(monthISO())
  const parties = useAsync(getParties, [])
  const st = useAsync(async () => (client ? await getStatement(client, monthStart(ym)) : null), [client, ym])
  const s = st.data
  const clients = (parties.data ?? []).filter(p => p.type === 'client')
  const empty = s && s.purchases.length === 0 && s.collections.length === 0 && s.opening === 0

  const text = () => s ? [
    `*${tenantName}* — ${t('statement')}`, `${s.client} · ${ym}`, '',
    `${t('openingBalance')}: SAR ${fmt(s.opening)}`,
    ...s.purchases.map((p: any) => `${p.date}  ${p.description}  ${fmt(p.amount)}`),
    ...s.collections.map((c: any) => `${c.date}  ${t(c.mode)}  −${fmt(c.amount)}`), '',
    `*${t('closingBalance')}: SAR ${fmt(s.closing)}*`
  ].join('\n') : ''

  function csv() {
    if (!s) return
    const rows = [['date', 'type', 'description', 'debit', 'credit'],
      ['', 'opening', '', s.opening > 0 ? plain(s.opening) : '', s.opening < 0 ? plain(-s.opening) : ''],
      ...s.purchases.map((p: any) => [p.date, 'purchase', `"${String(p.description).replace(/"/g, '""')}"`, plain(p.amount), '']),
      ...s.collections.map((c: any) => [c.date, 'payment', c.mode, '', plain(c.amount)]),
      ['', 'closing', '', plain(s.closing), '']]
    const blob = new Blob(['\ufeff' + rows.map(r => r.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `statement-${s.client}-${ym}.csv`; a.click()
  }

  return (
    <div className="page">
      <h1 className="no-print">{t('statements')}</h1>
      <div className="filters no-print">
        <select value={client} onChange={e => setClient(e.target.value)} aria-label={t('client')}>
          <option value="">{t('chooseClient')}</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="month" value={ym} onChange={e => e.target.value && setYm(e.target.value)} />
      </div>

      {!client && <Empty>{t('chooseClient')}</Empty>}
      {s && (
        <>
          <div className="actions no-print">
            <button className="btn primary" onClick={() => window.print()}>{t('printPdf')}</button>
            <button className="btn ghost" onClick={async () => { await navigator.clipboard.writeText(text()); toast(t('copied')) }}>{t('copyText')}</button>
            <button className="btn ghost" onClick={csv}>{t('downloadCsv')}</button>
          </div>
          <article className="statement" lang={lang}>
            <header>
              <h2>{tenantName}</h2>
              <p>{t('statement')} · <span dir="ltr">{ym}</span></p>
              <p>{t('preparedFor')}: <strong>{s.client}</strong></p>
            </header>
            <div className="scroll-x">
            <table className="grid wide">
              <thead><tr><th>{t('date')}</th><th>{t('description')}</th><th>{t('billed')}</th><th>{t('paid')}</th></tr></thead>
              <tbody>
                <tr className="muted-row"><td></td><td>{t('openingBalance')}</td><td colSpan={2} className="num"><Amt v={s.opening} /></td></tr>
                {s.purchases.map((p: any, i: number) => (
                  <tr key={`p${i}`}><td dir="ltr">{p.date}</td><td>{p.description}</td><td className="num"><Amt v={p.amount} /></td><td></td></tr>
                ))}
                {s.collections.map((c: any, i: number) => (
                  <tr key={`c${i}`}><td dir="ltr">{c.date}</td><td>{t(c.mode)}</td><td></td><td className="num"><Amt v={c.amount} /></td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td></td><td>{t('total')}</td><td className="num"><Amt v={s.purchases_total} /></td><td className="num"><Amt v={s.collections_total} /></td></tr>
                <tr className="due"><td></td><td>{t('closingBalance')}</td><td colSpan={2} className="num"><span className="cur">SAR</span> <Amt v={s.closing} strong /></td></tr>
              </tfoot>
            </table>
            </div>
            {empty && <p className="muted">{t('noActivity')}</p>}
            <p className="foot">{t('statementFoot')}</p>
          </article>
        </>
      )}
    </div>
  )
}
