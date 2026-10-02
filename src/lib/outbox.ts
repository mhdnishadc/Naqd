import { get, set } from 'idb-keyval'
import { supabase } from './supabase'

// Offline queue. Every write carries a client-generated uuid (p_ref) and the database ignores
// duplicates, so a retry after a flaky connection can never double-book an entry.

export interface OutboxItem {
  id: string
  fn: string
  args: Record<string, unknown>
  label: string
  amount?: number
  createdAt: number
  receipt?: { blob: Blob; path: string }
  error?: string // set when the server rejected it (needs a human)
}

const KEY = 'naqd:outbox'
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
export const subscribeOutbox = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export const listOutbox = async (): Promise<OutboxItem[]> => (await get<OutboxItem[]>(KEY)) ?? []
const save = async (items: OutboxItem[]) => { await set(KEY, items); notify() }

export async function enqueue(item: OutboxItem) { await save([...(await listOutbox()), item]) }
export async function discard(id: string) { await save((await listOutbox()).filter(i => i.id !== id)) }
export async function retry(id: string) {
  await save((await listOutbox()).map(i => (i.id === id ? { ...i, error: undefined } : i)))
  return syncOutbox()
}

export function isNetworkError(e: any): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  if (!e) return false
  if (e.name === 'TypeError') return true
  return !e.code && /fetch|network|load failed|timeout/i.test(String(e.message || ''))
}

export async function sendItem(item: OutboxItem): Promise<void> {
  if (item.receipt) {
    const { error } = await supabase.storage.from('receipts')
      .upload(item.receipt.path, item.receipt.blob, { upsert: true, contentType: 'image/jpeg' })
    if (error) throw error
  }
  const { error } = await supabase.rpc(item.fn, item.args)
  if (error) throw error
}

let running = false
/** Sends queued items in order. Stops at the first network/auth problem; marks business errors for review. */
export async function syncOutbox(): Promise<{ sent: number; left: number }> {
  if (running) return { sent: 0, left: (await listOutbox()).length }
  running = true
  let sent = 0
  try {
    for (const item of await listOutbox()) {
      if (item.error) continue
      try {
        await sendItem(item)
        await discard(item.id)
        sent++
      } catch (e: any) {
        if (isNetworkError(e) || String(e?.code || '').startsWith('PGRST3')) break
        await save((await listOutbox()).map(i => (i.id === item.id ? { ...i, error: e?.message || 'Rejected' } : i)))
      }
    }
  } finally {
    running = false
  }
  return { sent, left: (await listOutbox()).length }
}
