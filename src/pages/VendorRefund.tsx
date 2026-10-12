import { FormEvent, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { defaultCredit, getRefundablePurchase, getRefundablePurchases, RefundablePurchase, submit } from '../lib/api'
import { useAsync, useToast } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { fmt, parseAmount, plain, todayISO, uuid } from '../lib/money'
import { Amt, Empty, Field } from '../components/ui'

/** Vendor refund: a product bought for a client went back to the vendor, who paid cash back.
 *  /refund                 → choose the purchase
 *  /refund?purchase=<id>   → refund form (also ?ledger=<ledger row id> from the ledger) */
export default function VendorRefund() {
  const [sp] = useSearchParams()
  const purchaseId = sp.get('purchase') || undefined
  const ledgerId = sp.get('ledger') || undefined
  return purchaseId || ledgerId ? <RefundForm by={{ purchaseId, ledgerId }} /> : <PurchasePicker />
}

function PurchasePicker() {
  const { t } = useT()
  const { data, loading } = useAsync(getRefundablePurchases, [])
  const [q, setQ] = useState('')
  const rows = useMemo(() => (data ?? []).filter(p => !q ||
    `${p.description} ${p.client_name} ${p.vendor_name ?? ''}`.toLowerCase().includes(q.toLowerCase())), [data, q])

  return (
    <div className="page narrow">
      <Link to="/new" className="link">← {t('back')}</Link>
      <h1>{t('vendor_refund')}</h1>
      <p className="lede">{t('choosePurchase')}</p>
      <input type="search" placeholder={t('search')} value={q} onChange={e => setQ(e.target.value)} aria-label={t('search')} />
      {rows.length === 0 ? !loading && <Empty>{t('noRefundable')}</Empty> : (
        <ul className="rows">
          {rows.map(p => (
            <li key={p.id} className="row">
              <Link className="row-main" to={`/refund?purchase=${p.id}`}>
                <span className="row-date" dir="ltr">{p.purchase_date.slice(5)}</span>
                <span className="row-body">
                  <span className="row-title">{p.description}</span>
                  <span className="row-sub">{[p.client_name, p.vendor_name].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="row-amt"><Amt v={p.cost - p.refunded} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RefundForm({ by }: { by: { purchaseId?: string; ledgerId?: string } }) {
  const { t } = useT()
  const { data: p, loading } = useAsync(() => getRefundablePurchase(by), [by.purchaseId, by.ledgerId])
  if (loading && !p) return <div className="page narrow"><p className="muted">{t('loading')}</p></div>
  if (!p) return (
    <div className="page narrow">
      <Link to="/refund" className="link">← {t('back')}</Link>
      <Empty>{t('noRefundable')}</Empty>
    </div>
  )
  return <RefundFormFor p={p} />
}

function RefundFormFor({ p }: { p: RefundablePurchase }) {
  const { t } = useT()
  const toast = useToast()
  const nav = useNavigate()
  const leftCost = p.cost - p.refunded
  const leftSell = p.sell - p.credited

  const [refundText, setRefundText] = useState(plain(leftCost))  // default: everything left (full return)
  const [creditText, setCreditText] = useState<string | null>(null) // null = follow the refund automatically
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef(uuid())

  const refund = parseAmount(refundText)
  const autoCredit = refund != null ? defaultCredit(p, refund) : 0
  const credit = creditText == null ? autoCredit : parseAmount(creditText)

  if (leftCost <= 0) return (
    <div className="page narrow">
      <Link to="/refund" className="link">← {t('back')}</Link>
      <h1>{t('vendor_refund')}</h1>
      <Empty>{t('fullyRefunded')}</Empty>
    </div>
  )

  async function save(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (refund == null || refund <= 0) return setErr(t('invalidAmount'))
    if (refund > leftCost) return setErr(t('refundTooMuch').replace('{max}', fmt(leftCost)))
    if (credit == null) return setErr(t('invalidAmount'))
    if (credit > leftSell) return setErr(t('creditTooMuch').replace('{max}', fmt(leftSell)))
    if (date < p.purchase_date) return setErr(t('refundBeforePurchase'))

    setBusy(true)
    try {
      const res = await submit('record_purchase_return',
        { p_ref: ref.current, p_date: date, p_purchase: p.id, p_refund: refund, p_credit: credit, p_note: note.trim() || null },
        `${t('vendor_refund')} · ${p.description}`, refund)
      toast(res.queued ? t('savedOffline') : t('saved'), res.queued ? 'info' : 'ok')
      nav('/ledger')
    } catch (ex: any) {
      setErr(ex.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="page narrow">
      <Link to="/refund" className="link">← {t('back')}</Link>
      <h1>{t('vendor_refund')}</h1>
      <p className="lede">{t('vendor_refund_h')}</p>

      <section className="panel">
        <h2>{p.description}</h2>
        <p className="muted">{[p.client_name, p.vendor_name].filter(Boolean).join(' · ')} · <span dir="ltr">{p.purchase_date}</span></p>
        <table className="sheet">
          <tbody>
            <tr><th>{t('paidToVendor')}</th><td><Amt v={p.cost} /></td></tr>
            <tr><th>{t('billed')}</th><td><Amt v={p.sell} /></td></tr>
            {p.refunded > 0 && <tr className="sub"><th>{t('alreadyRefunded')}</th><td><Amt v={p.refunded} /></td></tr>}
          </tbody>
        </table>
      </section>

      <form className="form" onSubmit={save}>
        <Field label={t('refundAmount')} hint={t('refundHint').replace('{max}', fmt(leftCost))}>
          <input inputMode="decimal" dir="ltr" className="big" value={refundText} placeholder="0.00"
                 onChange={e => setRefundText(e.target.value)} />
        </Field>

        <Field label={t('creditAmount')}
               hint={credit != null ? t('creditHint').replace('{amount}', fmt(leftSell - credit)) : undefined}>
          <input inputMode="decimal" dir="ltr" value={creditText ?? (refund != null ? plain(autoCredit) : '')} placeholder="0.00"
                 onChange={e => setCreditText(e.target.value)} />
        </Field>
        {creditText != null && (
          <button type="button" className="link" onClick={() => setCreditText(null)}>{t('creditAuto')}</button>
        )}

        <div className="two">
          <Field label={t('date')}><input type="date" value={date} min={p.purchase_date} max={todayISO()} onChange={e => setDate(e.target.value)} /></Field>
          <Field label={`${t('note')} · ${t('optional')}`}><input value={note} onChange={e => setNote(e.target.value)} /></Field>
        </div>

        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="actions">
          <button className="btn primary" disabled={busy}>{t('save')}</button>
        </div>
      </form>
    </div>
  )
}
