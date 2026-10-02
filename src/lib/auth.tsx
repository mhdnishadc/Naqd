import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { cached } from './api'

interface Profile { tenant_id: string; full_name: string | null; tenants: { name: string; currency: string } | null }
interface AuthCtx {
  session: Session | null; loading: boolean; profile: Profile | null
  tenantId: string; tenantName: string; refresh: () => Promise<void>; signOut: () => Promise<void>
}
const Ctx = createContext<AuthCtx>(null as any)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return }
    try {
      const p = await cached<Profile | null>(`profile:${s.user.id}`, async () => {
        const { data, error } = await supabase.from('profiles').select('tenant_id, full_name, tenants(name, currency)').maybeSingle()
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

  const value: AuthCtx = {
    session, loading, profile,
    tenantId: profile?.tenant_id ?? '', tenantName: profile?.tenants?.name ?? '',
    refresh: async () => loadProfile(session),
    signOut: async () => { await supabase.auth.signOut() }
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
