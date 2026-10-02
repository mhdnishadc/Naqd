import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getAging, getClientBalances, getOpenPurchases } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { Amt, Empty } from '../components/ui'

export default function Receivables() {
  const { t } = useT()
  const bal = useAsync(getClientBalances, [])
  const aging = useAsync(getAging, [])
  const open = useAsync(getOpenPurchases, [])
  const [sel, setSel] = useState<string | null>(null)
  const owing = (bal.data ?? []).filter(b => b.billed - b.collected !== 0).sort((a, b) => (b.billed - b.collected) - (a.billed - a.collected))
  const total = owing.reduce((a, b) => a + (b.billed - b.collected), 0)
  const ag = (id: string) => aging.data?.find(a => a.client_id === id)

  return (
    <div className="page">
      <h1>{t('receivables')}</h1>
      <section className="panel">
        <table className="sheet"><tbody><tr className="total double"><th>{t('receivablesTotal')}</th><td><Amt v={total} strong /></td></tr></tbody></table>
      </section>
      {owing.length === 0 && !bal.loading && <Empty>{t('nothingOwed')}</Empty>}
      <ul className="rows">
        {owing.map(b => {
          const a = ag(b.party_id)
          const isOpen = sel === b.party_id
          return (
            <li key={b.party_id} className="row">
              <button className="row-main" onClick={() => setSel(isOpen ? null : b.party_id)} aria-expanded={isOpen}>
                <span className="row-body">
                  <span className="row-title">{b.name}</span>
                  <span className="row-sub wrap">{t('billed')} <Amt v={b.billed} /> · {t('paid')} <Amt v={b.collected} /></span>
                </span>
                <span className={`row-amt ${a?.d90_plus ? 'late' : ''}`}><Amt v={b.billed - b.collected} strong /></span>
              </button>
              {isOpen && (
                <div className="row-detail">
                  {a && (
                    <div className="buckets">
                      <div><span>{t('d0')}</span><Amt v={a.d0_30} /></div><div><span>{t('d31')}</span><Amt v={a.d31_60} /></div>
                      <div><span>{t('d61')}</span><Amt v={a.d61_90} /></div><div className={a.d90_plus ? 'late' : ''}><span>{t('d90')}</span><Amt v={a.d90_plus} /></div>
                    </div>
                  )}
                  <ul className="rows tight">
                    {(open.data ?? []).filter(o => o.client_id === b.party_id).map(o => (
                      <li key={o.id} className="row"><div className="row-main static">
                        <span className="row-date" dir="ltr">{o.purchase_date.slice(5)}</span>
                        <span className="row-body"><span className="row-title">{o.description}</span><span className="row-sub" dir="ltr">{o.age_days} d</span></span>
                        <span className="row-amt"><Amt v={o.outstanding} /></span></div></li>
                    ))}
                  </ul>
                  <div className="row-actions">
                    <Link className="btn primary sm" to={`/new/collection?party=${b.party_id}`}>{t('collection')}</Link>
                    <Link className="btn ghost sm" to={`/statements?client=${b.party_id}`}>{t('statements')}</Link>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
