import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { deleteParty, getLedger, getParties, updateParty, voidCollection } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAsync, useToast } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { Amt } from '../components/ui'
import { LedgerList } from '../components/LedgerList'

export default function PartyDetail() {
  const { id = '' } = useParams()
  const { t } = useT()
  const toast = useToast()
  const nav = useNavigate()
  const parties = useAsync(getParties, [])
  const ledger = useAsync(() => getLedger({ partyId: id, limit: 300 }), [id])
  const party = parties.data?.find(p => p.id === id)
  const isClient = party?.type === 'client'
  const sales = useAsync(async () => isClient
    ? ((await supabase.from('purchases').select('*').eq('client_id', id).order('purchase_date', { ascending: false })).data ?? []) : [], [id, isClient])
  const cols = useAsync(async () => isClient
    ? ((await supabase.from('collections').select('*').eq('client_id', id).order('collection_date', { ascending: false })).data ?? []) : [], [id, isClient])
  // vendors are not on the ledger: purchases name them in "Bought from"
  const isVendor = party?.type === 'vendor'
  const vendorBuys = useAsync(async () => isVendor
    ? ((await supabase.from('purchases').select('*').eq('vendor_name', party!.name).order('purchase_date', { ascending: false })).data ?? []) : [], [id, isVendor, party?.name])
  const [reason, setReason] = useState('')
  const [voiding, setVoiding] = useState<string | null>(null)
  const refreshAll = () => { ledger.reload(); sales.reload(); cols.reload() }

  async function voidCol(cid: string) {
    try { await voidCollection(cid, reason); setVoiding(null); setReason(''); toast(t('voided')); refreshAll() } catch (e: any) { toast(e.message, 'err') }
  }
  async function remove() {
    if (!party || !window.confirm(t('confirmDelete').replace('{name}', party.name))) return
    try { await deleteParty(party.id); toast(t('deleted')); nav(`/parties?add=${party.type}`, { replace: true }) } catch (e: any) { toast(e.message, 'err') }
  }
  if (!party) return <div className="page"><Link to="/parties" className="link">← {t('back')}</Link></div>
  const hasEntries = (ledger.data?.length ?? 0) > 0 || (sales.data?.length ?? 0) > 0 || (cols.data?.length ?? 0) > 0
  const loaded = !ledger.loading && !sales.loading && !cols.loading

  const billed = (sales.data ?? []).filter((s: any) => !s.voided_at).reduce((a: number, s: any) => a + s.sell, 0)
  const paid = (cols.data ?? []).filter((c: any) => !c.voided_at).reduce((a: number, c: any) => a + c.amount, 0)

  return (
    <div className="page">
      <Link to="/parties" className="link">← {t('parties')}</Link>
      <h1>{party.name}</h1>
      <p className="lede" dir="ltr">{party.phone}</p>
      <div className="actions">
        {isClient && <Link className="btn primary" to={`/new/purchase?party=${id}`}>{t('purchase')}</Link>}
        {isClient && <Link className="btn ghost" to={`/new/collection?party=${id}`}>{t('collection')}</Link>}
        {isClient && <Link className="btn ghost" to={`/statements?client=${id}`}>{t('statements')}</Link>}
        {party.type === 'employee' && <Link className="btn primary" to={`/new/advance?party=${id}`}>{t('advance')}</Link>}
        {party.type === 'employee' && <Link className="btn ghost" to={`/new/employee_return?party=${id}`}>{t('employee_return')}</Link>}
        {party.type === 'employee' && <Link className="btn ghost" to={`/new/advance_expense?party=${id}`}>{t('advance_expense')}</Link>}
        {party.type === 'funder' && <Link className="btn primary" to={`/new/topup?party=${id}`}>{t('topup')}</Link>}
        <button className="btn ghost" onClick={async () => { await updateParty(id, { active: !party.active }); parties.reload() }}>
          {party.active ? t('deactivate') : t('activate')}
        </button>
        {loaded && !hasEntries && <button className="btn danger" onClick={remove}>{t('delete')}</button>}
      </div>
      {loaded && hasEntries && <p className="muted">{t('cannotDelete')}</p>}

      {isVendor && (
        <section className="panel">
          <h2>{t('boughtHere')}</h2>
          {(vendorBuys.data ?? []).length === 0 ? <p className="muted">{t('noPartiesYet')}</p> : (
            <ul className="rows">
              {(vendorBuys.data ?? []).map((s: any) => (
                <li key={s.id} className={`row ${s.voided_at ? 'voided' : ''}`}>
                  <div className="row-main static">
                    <span className="row-date" dir="ltr">{s.purchase_date.slice(5)}</span>
                    <span className="row-body"><span className="row-title">{s.description}</span></span>
                    <span className="row-amt"><Amt v={s.cost} /></span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isClient && (
        <section className="panel">
          <table className="sheet"><tbody>
            <tr><th>{t('billed')}</th><td><Amt v={billed} /></td></tr>
            <tr><th>{t('paid')}</th><td><Amt v={paid} /></td></tr>
            <tr className="total double"><th>{t('owes')}</th><td><Amt v={billed - paid} strong /></td></tr>
          </tbody></table>
        </section>
      )}

      {isClient && (
        <section className="panel">
          <h2>{t('purchasesInMonth')}</h2>
          <ul className="rows">
            {(sales.data ?? []).map((s: any) => (
              <li key={s.id} className={`row ${s.voided_at ? 'voided' : ''}`}>
                <div className="row-main static">
                  <span className="row-date" dir="ltr">{s.purchase_date.slice(5)}</span>
                  <span className="row-body"><span className="row-title">{s.description}</span><span className="row-sub">{s.vendor_name}</span></span>
                  <span className="row-amt"><Amt v={s.sell} /></span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {isClient && (
        <section className="panel">
          <h2>{t('paymentsInMonth')}</h2>
          <ul className="rows">
            {(cols.data ?? []).map((c: any) => (
              <li key={c.id} className={`row ${c.voided_at ? 'voided' : ''}`}>
                <div className="row-main static">
                  <span className="row-date" dir="ltr">{c.collection_date.slice(5)}</span>
                  <span className="row-body"><span className="row-title">{t(c.mode as any)}</span><span className="row-sub">{c.note}</span></span>
                  <span className="row-amt pos"><Amt v={c.amount} tone="in" /></span>
                </div>
                {!c.voided_at && (
                  <div className="row-actions">
                    {voiding === c.id ? (
                      <div className="inline-add">
                        <input autoFocus placeholder={t('voidReason')} value={reason} onChange={e => setReason(e.target.value)} />
                        <button className="btn danger sm" disabled={!reason.trim()} onClick={() => voidCol(c.id)}>{t('void')}</button>
                        <button className="btn ghost sm" onClick={() => setVoiding(null)}>{t('cancel')}</button>
                      </div>
                    ) : <button className="btn danger sm" onClick={() => setVoiding(c.id)}>{t('void')}</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isClient && ledger.data && ledger.data.length > 0 && (
        <section className="panel"><h2>{t('history')}</h2><LedgerList rows={ledger.data} onChanged={refreshAll} showParty={false} /></section>
      )}
    </div>
  )
}
