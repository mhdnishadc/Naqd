import { Link } from 'react-router-dom'
import { getEmployeeBalances } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { Amt, Empty } from '../components/ui'

export default function Advances() {
  const { t } = useT()
  const { data, loading } = useAsync(getEmployeeBalances, [])
  const rows = (data ?? []).map(r => ({ ...r, holding: r.advanced - r.returned - r.spent })).sort((a, b) => b.holding - a.holding)
  const total = rows.reduce((a, r) => a + r.holding, 0)
  return (
    <div className="page">
      <h1>{t('advances')}</h1>
      <section className="panel">
        <table className="sheet"><tbody><tr className="total double"><th>{t('withEmployees')}</th><td><Amt v={total} strong /></td></tr></tbody></table>
      </section>
      {rows.length === 0 && !loading && <Empty action={<Link className="btn primary" to="/parties?add=employee">{t('add')}</Link>}>{t('noPartiesYet')}</Empty>}
      <ul className="rows">
        {rows.map(r => (
          <li key={r.party_id} className="row">
            <Link className="row-main" to={`/parties/${r.party_id}`}>
              <span className="row-body">
                <span className="row-title">{r.name}</span>
                <span className="row-sub wrap">{t('advanced')} <Amt v={r.advanced} /> · {t('returned')} <Amt v={r.returned} /> · {t('spent')} <Amt v={r.spent} /></span>
              </span>
              <span className="row-amt"><Amt v={r.holding} strong /></span>
            </Link>
            <div className="row-actions">
              <Link className="btn primary sm" to={`/new/advance?party=${r.party_id}`}>{t('giveAdvance')}</Link>
              <Link className="btn ghost sm" to={`/new/employee_return?party=${r.party_id}`}>{t('employee_return')}</Link>
              <Link className="btn ghost sm" to={`/new/advance_expense?party=${r.party_id}`}>{t('advance_expense')}</Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
