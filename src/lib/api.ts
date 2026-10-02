import { get, set } from 'idb-keyval'
import { supabase } from './supabase'
import { enqueue, isNetworkError, OutboxItem, sendItem } from './outbox'
import { uuid } from './money'

export type PartyType = 'client' | 'employee' | 'vendor' | 'funder'
export interface Party { id: string; type: PartyType; name: string; phone: string | null; aliases: string[]; notes: string | null; active: boolean }
export interface LedgerRow {
  id: string; entry_date: string; kind: string; direction: 'in' | 'out'; affects_cash: boolean; amount: number
  party_id: string | null; note: string | null; receipt_path: string | null; meta: Record<string, any>
  source: string; created_at: string; voided_at: string | null; void_reason: string | null; party?: { name: string } | null
}

/** Run a loader; remember the result; fall back to the last good copy when offline. */
export async function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  try {
    const data = await loader()
    await set(`naqd:cache:${key}`, data).catch(() => {})
    return data
  } catch (e) {
    const old = await get<T>(`naqd:cache:${key}`)
    if (old !== undefined && isNetworkError(e)) return old
    throw e
  }
}

const ok = <T>(r: { data: T | null; error: any }): T => { if (r.error) throw r.error; return r.data as T }

export const getParties = () => cached<Party[]>('parties', async () =>
  ok(await supabase.from('parties').select('*').order('name')) as Party[])

export const getDashboard = (from: string, to: string) => cached<Record<string, number>>(`dash:${from}:${to}`, async () =>
  ok(await supabase.rpc('dashboard_summary', { p_from: from, p_to: to })) as Record<string, number>)

export const getClientBalances = () => cached<any[]>('clientbal', async () => ok(await supabase.from('v_client_balances').select('*').order('name')))
export const getEmployeeBalances = () => cached<any[]>('empbal', async () => ok(await supabase.from('v_employee_balances').select('*').order('name')))
export const getFunderTotals = () => cached<any[]>('funders', async () => ok(await supabase.from('v_funder_totals').select('*').order('name')))
export const getAging = () => cached<any[]>('aging', async () => ok(await supabase.from('v_client_aging').select('*').order('total', { ascending: false })))
export const getOpenPurchases = () => cached<any[]>('openpurch', async () =>
  ok(await supabase.from('v_open_purchases').select('*').order('purchase_date')))

export const getLedger = (opts: { from?: string; to?: string; partyId?: string; limit?: number }) =>
  cached<LedgerRow[]>(`ledger:${JSON.stringify(opts)}`, async () => {
    let q = supabase.from('ledger_entries').select('*, party:parties(name)')
      .order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(opts.limit ?? 300)
    if (opts.from) q = q.gte('entry_date', opts.from)
    if (opts.to) q = q.lte('entry_date', opts.to)
    if (opts.partyId) q = q.eq('party_id', opts.partyId)
    return ok(await q) as unknown as LedgerRow[]
  })

export const getStatement = async (client: string, month: string) =>
  ok(await supabase.rpc('client_statement', { p_client: client, p_month: month })) as any

export async function addParty(type: PartyType, name: string, phone?: string): Promise<Party> {
  const { data, error } = await supabase.from('parties').insert({ type, name: name.trim(), phone: phone?.trim() || null }).select().single()
  if (error) throw error
  return data as Party
}
export const updateParty = async (id: string, patch: Partial<Pick<Party, 'name' | 'phone' | 'notes' | 'active' | 'aliases'>>) => {
  const { error } = await supabase.from('parties').update(patch).eq('id', id)
  if (error) throw error
}

export const voidEntry = async (id: string, reason: string) => { const { error } = await supabase.rpc('void_ledger_entry', { p_id: id, p_reason: reason }); if (error) throw error }
export const voidCollection = async (id: string, reason: string) => { const { error } = await supabase.rpc('void_collection', { p_id: id, p_reason: reason }); if (error) throw error }

export const receiptUrl = async (path: string) => {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}

/**
 * Save a money entry. Online: sent now. Offline / flaky network: queued on the device and synced later.
 * Server rejections (validation) are thrown so the form can show them.
 */
export async function submit(fn: string, args: Record<string, unknown>, label: string, amount: number,
                             opts: { receipt?: Blob; tenantId?: string } = {}): Promise<{ queued: boolean }> {
  const ref = (args.p_ref as string) || uuid()
  const full: Record<string, unknown> = { ...args, p_ref: ref }
  const item: OutboxItem = { id: ref, fn, args: full, label, amount, createdAt: Date.now() }
  if (opts.receipt && opts.tenantId) {
    item.receipt = { blob: opts.receipt, path: `${opts.tenantId}/${ref}.jpg` }
    full.p_receipt = item.receipt.path
  }
  try {
    await sendItem(item)
    return { queued: false }
  } catch (e: any) {
    if (isNetworkError(e)) { await enqueue(item); return { queued: true } }
    throw new Error(e?.message || 'Could not save')
  }
}

/** Shrink a phone photo to ~1280px JPEG so the free 1 GB of storage lasts. */
export async function compressImage(file: File, max = 1280, quality = 0.7): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Image failed'))), 'image/jpeg', quality))
}
