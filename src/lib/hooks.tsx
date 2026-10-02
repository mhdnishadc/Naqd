import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { listOutbox, OutboxItem, subscribeOutbox, syncOutbox } from './outbox'

/** Tiny data hook: loads on mount / when deps change; reload() to refresh. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const run = useCallback(() => {
    const id = ++seq.current
    setLoading(true)
    loader().then(d => { if (id === seq.current) { setData(d); setError(null) } })
      .catch(e => { if (id === seq.current) setError(e?.message || 'Failed') })
      .finally(() => { if (id === seq.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  useEffect(() => subscribeOutbox(run), [run]) // refresh views after a sync
  return { data, error, loading, reload: run }
}

// ---- toasts ----
interface Toast { id: number; text: string; kind: 'ok' | 'err' | 'info' }
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setItems(x => [...x, { id, text, kind }])
    setTimeout(() => setItems(x => x.filter(i => i.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(i => <div key={i.id} className={`toast ${i.kind}`}>{i.text}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

// ---- online + outbox state ----
export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false)
    window.addEventListener('online', u); window.addEventListener('offline', d)
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d) }
  }, [])
  return on
}

export function useOutbox() {
  const [items, setItems] = useState<OutboxItem[]>([])
  const refresh = useCallback(() => { listOutbox().then(setItems) }, [])
  useEffect(() => { refresh(); return subscribeOutbox(refresh) }, [refresh])
  return { items, waiting: items.filter(i => !i.error).length, rejected: items.filter(i => i.error).length }
}

/** Starts background syncing: on load, when the connection returns, and every 30 s. */
export function useAutoSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const go = () => { if (navigator.onLine) syncOutbox() }
    go()
    window.addEventListener('online', go)
    const t = setInterval(go, 30000)
    return () => { window.removeEventListener('online', go); clearInterval(t) }
  }, [enabled])
}
