import { FormEvent, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { compressImage, getParties, submit } from '../lib/api'
import { useAsync, useToast } from '../lib/hooks'
import { useT, Key } from '../lib/i18n'
import { useAuth } from '../lib/auth'
import { fmt, parseAmount, todayISO, uuid } from '../lib/money'
import { Field, PartySelect, Segmented } from '../components/ui'

const GROUPS: { title: Key; kinds: string[] }[] = [
  { title: 'gSales', kinds: ['purchase', 'collection'] },
  { title: 'gCash', kinds: ['bank_withdrawal', 'topup'] },
  { title: 'gEmployees', kinds: ['advance', 'employee_return', 'advance_expense'] },
  { title: 'gCosts', kinds: ['fuel', 'transport', 'expense'] },
]
const KINDS = GROUPS.flatMap(g => g.kinds)
const HELP = (k: string) => `${k}_h` as Key
const label = (k: string) => (k === 'fuel' ? 'fuel_k' : k === 'transport' ? 'transport_k' : k) as Key

export function NewEntryHome() {
  const { t } = useT()
  return (
    <div className="page">
      <h1>{t('whatHappened')}</h1>
      {GROUPS.map(g => (
        <section key={g.title} className="panel">
          <h2>{t(g.title)}</h2>
          <div className="tiles">
            {g.kinds.map(k => (
              <Link key={k} to={`/new/${k}`} className="tile">
                <strong>{t(label(k))}</strong>
                <span>{t(HELP(k))}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default function NewEntry() {
  const { kind = '' } = useParams()
  const [sp] = useSearchParams()
  const { t } = useT()
  const toast = useToast()
  const nav = useNavigate()
  const { tenantId } = useAuth()
  const parties = useAsync(getParties, [])

  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [party, setParty] = useState(sp.get('party') || '')
  const [note, setNote] = useState('')
  const [vendor, setVendor] = useState('') // vendor party id
  const [desc, setDesc] = useState('')
  const [pmode, setPmode] = useState<'amount' | 'pct'>('amount')
  const [profit, setProfit] = useState('')
  const [payMode, setPayMode] = useState<'cash' | 'transfer' | 'cheque'>('cash')
  const [vehicle, setVehicle] = useState(() => localStorage.getItem('naqd:vehicle') || '')
  const [km, setKm] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef(uuid())

  if (!KINDS.includes(kind)) return <div className="page"><Link to="/new" className="link">{t('back')}</Link></div>

  const isPurchase = kind === 'purchase'
  const partyType = ({ purchase: 'client', collection: 'client', advance: 'employee', employee_return: 'employee',
                      advance_expense: 'employee', topup: 'funder', fuel: 'client', transport: 'client' } as const)[kind as string]
  const partyRequired = ['purchase', 'collection', 'advance', 'employee_return', 'advance_expense'].includes(kind)
  const partyLabel = kind === 'topup' ? t('funder') : kind === 'fuel' || kind === 'transport' ? t('linkedClient') : partyType === 'employee' ? t('employee') : t('client')
  const canReceipt = kind !== 'collection' && kind !== 'bank_withdrawal' && kind !== 'topup' && kind !== 'employee_return'
  const showVehicle = kind === 'fuel' || kind === 'transport'

  const cost = parseAmount(amount)
  const profitHalalas = !isPurchase ? 0 : pmode === 'amount' ? (profit ? parseAmount(profit) : 0)
    : (cost != null && profit && !isNaN(Number(profit)) ? Math.round(cost * Number(profit) / 100) : 0)

  function reset() {
    ref.current = uuid(); setAmount(''); setNote(''); setVendor(''); setDesc(''); setProfit(''); setKm(''); setFile(null); setErr('')
  }

  async function save(again: boolean, e?: FormEvent) {
    e?.preventDefault()
    setErr('')
    if (cost == null || cost <= 0) return setErr(isPurchase ? t('needCost') : t('invalidAmount'))
    if (isPurchase && profitHalalas == null) return setErr(t('invalidAmount'))
    if (partyRequired && !party) return setErr(t('chooseParty'))
    if (isPurchase && !desc.trim()) return setErr(`${t('description')}: ${t('required')}`)

    setBusy(true)
    try {
      let receipt: Blob | undefined
      if (file && canReceipt) receipt = await compressImage(file)
      const base = { p_ref: ref.current, p_date: date }
      let fn = 'record_cash_entry'
      let args: Record<string, unknown>
      if (isPurchase) {
        fn = 'record_purchase'
        const vendorName = parties.data?.find(p => p.id === vendor)?.name ?? null
        args = { ...base, p_client: party, p_vendor: vendorName, p_description: desc.trim(), p_cost: cost, p_profit: profitHalalas, p_note: note || null }
      } else if (kind === 'collection') {
        fn = 'record_collection'
        args = { ...base, p_client: party, p_amount: cost, p_mode: payMode, p_note: note || null }
      } else if (kind === 'advance_expense') {
        fn = 'record_advance_settlement'
        args = { ...base, p_employee: party, p_amount: cost, p_note: note || null }
      } else {
        const meta: Record<string, unknown> = {}
        if (showVehicle) { if (vehicle) meta.vehicle = vehicle; if (km) meta.km = Number(km) }
        args = { ...base, p_kind: kind, p_amount: cost, p_party: party || null, p_note: note || null, p_meta: meta }
      }
      if (showVehicle && vehicle) localStorage.setItem('naqd:vehicle', vehicle)
      const res = await submit(fn, args, `${t(label(kind))}`, cost, { receipt, tenantId })
      toast(res.queued ? t('savedOffline') : t('saved'), res.queued ? 'info' : 'ok')
      if (again) reset(); else nav('/')
    } catch (ex: any) {
      setErr(ex.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="page narrow">
      <Link to="/new" className="link">← {t('back')}</Link>
      <h1>{t(label(kind))}</h1>
      <p className="lede">{t(HELP(kind))}</p>

      <form className="form" onSubmit={e => save(false, e)}>
        {partyType && (
          <PartySelect type={partyType} parties={parties.data ?? []} value={party} onChange={setParty}
                       onAdded={parties.reload} optional={!partyRequired} label={partyLabel} />
        )}

        {isPurchase && (
          <>
            <Field label={t('description')}><input value={desc} onChange={e => setDesc(e.target.value)} placeholder="2 × desktop, HP ProDesk" /></Field>
            <PartySelect type="vendor" parties={parties.data ?? []} value={vendor} onChange={setVendor}
                         onAdded={parties.reload} optional label={t('vendor')} />
          </>
        )}

        <Field label={isPurchase ? t('costPrice') : t('amount')} hint="SAR">
          <input inputMode="decimal" dir="ltr" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="big" />
        </Field>

        {isPurchase && (
          <div className="field">
            <span className="field-label">{t('profit')}</span>
            <Segmented value={pmode} onChange={v => { setPmode(v); setProfit('') }}
                       options={[{ v: 'amount', label: 'SAR' }, { v: 'pct', label: t('markupPct') }]} />
            <input inputMode="decimal" dir="ltr" value={profit} onChange={e => setProfit(e.target.value)} placeholder={pmode === 'pct' ? '10' : '0.00'} />
            <div className="selling" aria-live="polite">
              <span>{t('sellingPrice')}</span>
              <strong dir="ltr">SAR {fmt((cost ?? 0) + (profitHalalas ?? 0))}</strong>
            </div>
          </div>
        )}

        {kind === 'collection' && (
          <div className="field">
            <span className="field-label">{t('paymentMode')}</span>
            <Segmented value={payMode} onChange={setPayMode}
                       options={[{ v: 'cash', label: t('cash') }, { v: 'transfer', label: t('transfer') }, { v: 'cheque', label: t('cheque') }]} />
            <span className="field-hint">{t('cashNote')}</span>
          </div>
        )}

        {showVehicle && (
          <div className="two">
            <Field label={t('vehicle')}><input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="Hilux · 1234 ABC" /></Field>
            <Field label={`${t('km')} · ${t('optional')}`}><input inputMode="numeric" dir="ltr" value={km} onChange={e => setKm(e.target.value)} /></Field>
          </div>
        )}

        <div className="two">
          <Field label={t('date')}><input type="date" value={date} max={todayISO()} onChange={e => setDate(e.target.value)} /></Field>
          <Field label={`${t('note')} · ${t('optional')}`}><input value={note} onChange={e => setNote(e.target.value)} /></Field>
        </div>

        {canReceipt && (
          <Field label={`${t('attachReceipt')} · ${t('optional')}`}>
            <input type="file" accept="image/*" capture="environment" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        )}

        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="actions">
          <button className="btn primary" disabled={busy}>{t('save')}</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => save(true)}>{t('saveAndAnother')}</button>
        </div>
      </form>
    </div>
  )
}
