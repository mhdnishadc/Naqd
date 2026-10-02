import { FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addParty, getClientBalances, getEmployeeBalances, getFunderTotals, getParties, PartyType, updateParty } from '../lib/api'
import { useAsync, useToast } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { Amt, Empty, Segmented } from '../components/ui'

export default function Parties() {
  const { t } = useT()
  const toast = useToast()
  const [sp] = useSearchParams()
  const [type, setType] = useState<PartyType>((sp.get('add') as PartyType) || 'client')
  const [showHidden, setShowHidden] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const parties = useAsync(getParties, [])
  const cb = useAsync(getClientBalances, [])
  const eb = useAsync(getEmployeeBalances, [])
  const fb = useAsync(getFunderTotals, [])

  const money = (id: string): JSX.Element | null => {
    if (type === 'client') { const r = cb.data?.find(x => x.party_id === id); return r ? <><small>{t('owes')}</small> <Amt v={r.billed - r.collected} strong /></> : null }
    if (type === 'employee') { const r = eb.data?.find(x => x.party_id === id); return r ? <><small>{t('holding')}</small> <Amt v={r.advanced - r.returned - r.spent} strong /></> : null }
    if (type === 'funder') { const r = fb.data?.find(x => x.party_id === id); return r ? <><small>{t('received')}</small> <Amt v={r.received} strong /></> : null }
    return null
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try { await addParty(type, name, phone); setName(''); setPhone(''); parties.reload(); cb.reload(); eb.reload(); fb.reload(); toast(t('saved')) }
    catch (ex: any) { toast(ex.message, 'err') }
  }
  const list = (parties.data ?? []).filter(p => p.type === type && (showHidden || p.active))

  return (
    <div className="page">
      <h1>{t('parties')}</h1>
      <Segmented value={type} onChange={setType} options={[
        { v: 'client', label: t('clients') }, { v: 'employee', label: t('employees') },
        { v: 'funder', label: t('funders') }, { v: 'vendor', label: t('vendors') }]} />

      <form className="inline-add stack" onSubmit={add}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t('name')} />
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder={`${t('phone')} · ${t('optional')}`} dir="ltr" inputMode="tel" />
        <button className="btn primary">{t('add')}</button>
      </form>

      {list.length === 0 ? <Empty>{t('noPartiesYet')}</Empty> : (
        <ul className="rows">
          {list.map(p => (
            <li key={p.id} className={`row ${p.active ? '' : 'voided'}`}>
              <Link className="row-main" to={`/parties/${p.id}`}>
                <span className="row-body"><span className="row-title">{p.name}</span><span className="row-sub" dir="ltr">{p.phone}</span></span>
                <span className="row-amt">{money(p.id)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <button className="link" onClick={() => setShowHidden(s => !s)}>{t('showHidden')}</button>
    </div>
  )
}

export { updateParty }
