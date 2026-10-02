import { Link } from 'react-router-dom'
import { useState } from 'react'
import { getAging, getDashboard, getLedger, getParties } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { monthEnd, monthISO, monthStart } from '../lib/money'
import { Amt, Empty } from '../components/ui'
import { LedgerList } from '../components/LedgerList'

export default function Dashboard() {
  const { t } = useT()
  const [ym, setYm] = useState(monthISO())
  const dash = useAsync(() => getDashboard(monthStart(ym), monthEnd(ym)), [ym])
  const aging = useAsync(getAging, [])
  const parties = useAsync(getParties, [])
  const recent = useAsync(() => getLedger({ limit: 6 }), [])
  const d = dash.data
  const noParties = parties.data && parties.data.filter(p => p.type === 'client').length === 0

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-label">{t('cashInHand')}</div>
        <div className={`hero-figure ${d && d.cash_in_hand < 0 ? 'neg' : ''}`}>
          <span className="cur">SAR</span>
          <Amt v={d?.cash_in_hand ?? 0} />
        </div>
        <div className="rule-double" aria-hidden />
        <div className="hero-pair">
          <Link to="/receivables" className="hero-stat"><span>{t('receivablesTotal')}</span><Amt v={d?.receivables ?? 0} strong /></Link>
          <Link to="/advances" className="hero-stat"><span>{t('withEmployees')}</span><Amt v={d?.with_employees ?? 0} strong /></Link>
        </div>
        {d && d.cash_in_hand < 0 && <p className="warn">{t('runningLow')}</p>}
      </section>

      {noParties && (
        <section className="panel start">
          <h2>{t('startHere')}</h2>
          <p>{t('startHint')}</p>
          <Link className="btn primary" to="/parties?add=client">{t('addClient')}</Link>
        </section>
      )}

      <section className="panel">
        <header className="panel-head">
          <h2>{t('thisMonth')}</h2>
          <input type="month" value={ym} onChange={e => e.target.value && setYm(e.target.value)} aria-label={t('month')} />
        </header>
        <table className="sheet">
          <tbody>
            <tr><th>{t('sales')}</th><td><Amt v={d?.sales ?? 0} /></td></tr>
            <tr className="sub"><th>{t('cost')}</th><td><Amt v={d?.cost ?? 0} /></td></tr>
            <tr className="total"><th>{t('grossProfit')}</th><td><Amt v={d?.gross_profit ?? 0} strong /></td></tr>
            <tr className="sub"><th>{t('fuel')}</th><td><Amt v={d?.fuel ?? 0} tone="out" /></td></tr>
            <tr className="sub"><th>{t('transport')}</th><td><Amt v={d?.transport ?? 0} tone="out" /></td></tr>
            <tr className="sub"><th>{t('otherExpenses')}</th><td><Amt v={d?.other_expenses ?? 0} tone="out" /></td></tr>
            <tr className="total double"><th>{t('netProfit')}</th><td><Amt v={d?.net_profit ?? 0} tone="auto" strong /></td></tr>
          </tbody>
        </table>
        <div className="mini-stats">
          <div><span>{t('withdrawn')}</span><Amt v={d?.withdrawn ?? 0} /></div>
          <div><span>{t('topups')}</span><Amt v={d?.topups ?? 0} /></div>
          <div><span>{t('collected')}</span><Amt v={d?.collected ?? 0} /></div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>{t('aging')}</h2><Link to="/receivables" className="link">{t('seeAll')}</Link></header>
        {aging.data && aging.data.length === 0 ? <Empty>{t('nothingOwed')}</Empty> : (
          <div className="scroll-x">
            <table className="grid">
              <thead><tr><th></th><th>{t('d0')}</th><th>{t('d31')}</th><th>{t('d61')}</th><th>{t('d90')}</th><th>{t('total')}</th></tr></thead>
              <tbody>
                {(aging.data ?? []).slice(0, 6).map(r => (
                  <tr key={r.client_id}>
                    <th><Link to={`/parties/${r.client_id}`}>{r.name}</Link></th>
                    <td><Amt v={r.d0_30} /></td><td><Amt v={r.d31_60} /></td><td><Amt v={r.d61_90} /></td>
                    <td className={r.d90_plus > 0 ? 'late' : ''}><Amt v={r.d90_plus} /></td><td><Amt v={r.total} strong /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head"><h2>{t('recent')}</h2><Link to="/ledger" className="link">{t('seeAll')}</Link></header>
        {recent.data && recent.data.length > 0
          ? <LedgerList rows={recent.data} onChanged={() => { recent.reload(); dash.reload(); aging.reload() }} />
          : !recent.loading && <Empty>{t('noPartiesYet')}</Empty>}
      </section>
    </div>
  )
}
