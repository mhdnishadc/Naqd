import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { cached, getSharedWorkspace } from './api'
import { clearShareToken, isShareInvalid, SHARE_INVALID_EVENT, shareToken } from './share'

interface Profile { tenant_id: string; full_name: string | null; role?: string; tenants: { name: string; currency: string } | null }
interface AuthCtx {
  session: Session | null; loading: boolean; profile: Profile | null
  tenantId: string; tenantName: string; isOwner: boolean; refresh: () => Promise<void>; signOut: () => Promise<void>
  /** Opened through a share link: everything is read-only and there is no login. */
  readOnly: boolean
  /** The share link was reset or turned off by the owner. */
  shareInvalid: boolean
  exitShare: () => void
}
const Ctx = createContext<AuthCtx>(null as any)
export const useAuth = () => useContext(Ctx)

type ShareState = { status: 'none' } | { status: 'loading' } | { status: 'invalid' } | { status: 'ok'; name: string }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [share, setShare] = useState<ShareState>(() => (shareToken() ? { status: 'loading' } : { status: 'none' }))

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return }
    try {
      const p = await cached<Profile | null>(`profile:${s.user.id}`, async () => {
        const { data, error } = await supabase.from('profiles').select('tenant_id, full_name, role, tenants(name, currency)').maybeSingle()
        if (error) throw error
        return data as unknown as Profile | null
      })
      setProfile(p)
    } catch { setProfile(null) }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session); await loadProfile(data.session); setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); loadProfile(s) })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  // shared view: confirm the link still works and fetch the workspace name
  useEffect(() => {
    const token = shareToken()
    if (!token) return
    cached('workspace', () => getSharedWorkspace(token))
      .then(w => setShare({ status: 'ok', name: w.name }))
      .catch(e => setShare(isShareInvalid(e) ? { status: 'invalid' } : { status: 'ok', name: '' }))
    const invalid = () => setShare({ status: 'invalid' })
    window.addEventListener(SHARE_INVALID_EVENT, invalid)
    return () => window.removeEventListener(SHARE_INVALID_EVENT, invalid)
  }, [])

  const readOnly = share.status !== 'none'
  const value: AuthCtx = {
    session, profile,
    loading: readOnly ? share.status === 'loading' : loading,
    tenantId: readOnly ? '' : profile?.tenant_id ?? '',
    tenantName: share.status === 'ok' ? share.name : readOnly ? '' : profile?.tenants?.name ?? '',
    isOwner: !readOnly && profile?.role === 'owner',
    refresh: async () => loadProfile(session),
    signOut: async () => { await supabase.auth.signOut() },
    readOnly,
    shareInvalid: share.status === 'invalid',
    // full reload so no shared data or state survives into the normal app
    exitShare: () => { clearShareToken(); window.location.replace('/') }
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
