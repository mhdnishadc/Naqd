import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { Field, Segmented } from '../components/ui'

export function Login() {
  const { t, lang, setLang } = useT()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    const { data, error } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    setBusy(false)
    if (error) setMsg(error.message)
    else if (mode === 'up' && !data.session) setMsg(t('checkEmail'))
  }
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand-lg"><span className="mark" aria-hidden>ن</span><h1>{t('appName')}</h1></div>
        <form className="form" onSubmit={go}>
          <Field label={t('email')}><input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} dir="ltr" /></Field>
          <Field label={t('password')}><input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={e => setPassword(e.target.value)} dir="ltr" /></Field>
          {msg && <p className="field-error" role="alert">{msg}</p>}
          <button className="btn primary" disabled={busy}>{mode === 'in' ? t('signIn') : t('signUp')}</button>
          <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>{mode === 'in' ? t('noAccount') : t('haveAccount')}</button>
        </form>
        <Segmented value={lang} onChange={setLang} options={[{ v: 'en', label: 'English' }, { v: 'ar', label: 'العربية' }]} />
      </div>
    </main>
  )
}

export function WorkspaceSetup() {
  const { t } = useT()
  const { refresh, signOut } = useAuth()
  const [name, setName] = useState('')
  const [me, setMe] = useState('')
  const [err, setErr] = useState('')
  async function go(e: FormEvent) {
    e.preventDefault(); setErr('')
    const { error } = await supabase.rpc('create_workspace', { p_name: name, p_full_name: me || null })
    if (error) setErr(error.message); else await refresh()
  }
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>{t('setupTitle')}</h1><p className="lede">{t('setupHint')}</p>
        <form className="form" onSubmit={go}>
          <Field label={t('workspaceName')}><input required value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label={`${t('yourName')} · ${t('optional')}`}><input value={me} onChange={e => setMe(e.target.value)} /></Field>
          {err && <p className="field-error" role="alert">{err}</p>}
          <button className="btn primary">{t('createWorkspace')}</button>
        </form>
        <button className="link" onClick={signOut}>{t('signOut')}</button>
      </div>
    </main>
  )
}

export function NotConfigured() {
  const { t } = useT()
  return <main className="auth"><div className="auth-card"><h1>{t('notConfigured')}</h1><p className="lede">{t('notConfiguredHint')}</p></div></main>
}
