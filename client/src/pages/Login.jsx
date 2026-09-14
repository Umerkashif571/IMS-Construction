import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Eye, EyeOff, Loader2, AlertCircle, Package, ClipboardCheck, Truck } from 'lucide-react'
import toast from 'react-hot-toast'
import logo from '../assets/logo.jpg'
import heroImg from '../assets/site-photo2.jpg'

const HIGHLIGHTS = [
  { icon: Package, title: 'Live inventory', text: 'Stock, transfers and low-stock alerts across every site store.' },
  { icon: ClipboardCheck, title: 'Purchase orders & approvals', text: 'Vendor POs with admin and owner sign-off in one place.' },
  { icon: Truck, title: 'Vehicles, tools & gate passes', text: 'Know what left the yard, who has it and when it is due back.' },
]

const DEMO_ACCOUNTS = [
  { role: 'Admin', email: 'admin@ims.com' },
  { role: 'Store Manager', email: 'store@ims.com' },
  { role: 'Site Engineer', email: 'engineer@ims.com' },
  { role: 'Procurement', email: 'procurement@ims.com' },
  { role: 'Finance', email: 'finance@ims.com' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function BrandMark({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`${compact ? 'h-10 w-10 rounded-xl' : 'h-12 w-12 rounded-2xl'} shrink-0 overflow-hidden bg-white p-1 shadow-lg shadow-black/20`}>
        <img src={logo} alt="" className="h-full w-full object-contain" />
      </div>
      <div className="leading-tight">
        <div className={`${compact ? 'text-base' : 'text-lg'} font-semibold tracking-tight text-white`}>Al Shafi Enterprises</div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-amber-400/90">Asset Management</div>
      </div>
    </div>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(false)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)
  const { login } = useAuth()
  const navigate = useNavigate()
  const year = new Date().getFullYear()

  useEffect(() => { emailRef.current?.focus() }, [])

  // After a failed attempt, put the cursor back in the (re-enabled) password field with
  // its text selected so the user can simply retype. Must run after loading clears —
  // a disabled input cannot take focus.
  useEffect(() => {
    if (formError && !loading) {
      passwordRef.current?.focus()
      passwordRef.current?.select()
    }
  }, [formError, loading])

  const validate = () => {
    const errs = {}
    if (!email.trim()) errs.email = 'Enter your email address.'
    else if (!EMAIL_RE.test(email.trim())) errs.email = 'That does not look like a valid email address.'
    if (!password) errs.password = 'Enter your password.'
    setFieldErrors(errs)
    if (errs.email) emailRef.current?.focus()
    else if (errs.password) passwordRef.current?.focus()
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    setFormError('')
    if (!validate()) return
    setLoading(true)
    try {
      await login(email.trim().toLowerCase(), password)
      navigate('/', { replace: true })
      toast.success('Welcome back')
    } catch (err) {
      const status = err.response?.status
      const serverMsg = err.response?.data?.error
      let msg
      if (!err.response) msg = 'Cannot reach the server. Check your connection and try again.'
      else if (status === 401) msg = 'Incorrect email or password.'
      else if (status === 429) msg = serverMsg || 'Too many failed attempts. Please wait 15 minutes and try again.'
      else msg = serverMsg || 'Sign in failed. Please try again.'
      setFormError(msg)
    } finally {
      setLoading(false)
    }
  }

  const inputBase = 'block w-full rounded-lg border bg-white px-3.5 text-base text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-4 focus:ring-amber-500/20 focus:border-amber-500 disabled:bg-slate-50 disabled:text-slate-500 sm:text-sm h-11'
  const inputOk = 'border-slate-300 hover:border-slate-400'
  const inputBad = 'border-red-400 bg-red-50/40'

  return (
    <div className="min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[1.1fr_1fr] xl:grid-cols-[1.2fr_1fr]">
      {/* ---------- Brand panel (desktop) ---------- */}
      <aside className="relative hidden overflow-hidden bg-slate-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <img src={heroImg} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-55" />
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-950/80 to-slate-900/20" />
        <div className="absolute -left-24 -bottom-24 h-96 w-96 rounded-full bg-amber-500/15 blur-3xl" aria-hidden="true" />

        <div className="relative"><BrandMark /></div>

        <div className="relative max-w-lg">
          <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
            Every site, every asset,<br />one system.
          </h2>
          <p className="mt-4 text-base text-slate-300">
            The inventory and asset management system for Al Shafi Enterprises — builders, contractors &amp; interior decorators.
          </p>
          <ul className="mt-10 space-y-6">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon size={18} className="text-amber-400" aria-hidden="true" />
                </span>
                <div>
                  <div className="font-medium text-white">{title}</div>
                  <div className="mt-0.5 text-sm text-slate-400">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">© {year} Al Shafi Enterprises. All rights reserved.</p>
      </aside>

      {/* ---------- Form panel ---------- */}
      <main className="flex min-h-dvh flex-col lg:min-h-0">
        {/* Compact brand header (phone / tablet) */}
        <header className="relative overflow-hidden bg-slate-950 px-5 pb-20 pt-[max(1.25rem,env(safe-area-inset-top))] lg:hidden">
          <img src={heroImg} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-35" />
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 to-slate-950" />
          <div className="relative mx-auto max-w-[26rem]"><BrandMark compact /></div>
        </header>

        <div className="flex flex-1 flex-col items-center px-4 pb-8 sm:px-6 lg:justify-center lg:py-12">
          <div className="relative z-10 -mt-10 w-full max-w-[26rem] rounded-2xl bg-white p-6 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200 sm:p-8 lg:mt-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
              <p className="mt-1.5 text-sm text-slate-500">Use the account your administrator created for you.</p>
            </div>

            {formError && (
              <div role="alert" aria-live="assertive" className="mt-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
              <div>
                <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">Email address</label>
                <input
                  ref={emailRef}
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined })) }}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                  disabled={loading}
                  className={`${inputBase} ${fieldErrors.email ? inputBad : inputOk}`}
                />
                {fieldErrors.email && <p id="email-error" className="mt-1.5 text-xs text-red-600">{fieldErrors.email}</p>}
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">Password</label>
                <div className="relative">
                  <input
                    ref={passwordRef}
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined })) }}
                    onKeyUp={(e) => setCapsLock(e.getModifierState && e.getModifierState('CapsLock'))}
                    onBlur={() => setCapsLock(false)}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby={fieldErrors.password ? 'password-error' : capsLock ? 'caps-warning' : undefined}
                    disabled={loading}
                    className={`${inputBase} pr-12 ${fieldErrors.password ? inputBad : inputOk}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
                {fieldErrors.password && <p id="password-error" className="mt-1.5 text-xs text-red-600">{fieldErrors.password}</p>}
                {!fieldErrors.password && capsLock && (
                  <p id="caps-warning" className="mt-1.5 flex items-center gap-1 text-xs text-amber-700">
                    <AlertCircle size={14} aria-hidden="true" /> Caps Lock is on
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-amber-500 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? <><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Signing in…</> : 'Sign in'}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-slate-500">
              Forgot your password? Contact your administrator to reset it.
            </p>

            {import.meta.env.VITE_DEMO_MODE ? (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <p className="mb-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-400">Demo accounts — tap to fill</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {DEMO_ACCOUNTS.map((d) => (
                    <button
                      key={d.email}
                      type="button"
                      onClick={() => { setEmail(d.email); setFieldErrors({}); passwordRef.current?.focus() }}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-amber-400 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                    >
                      {d.role}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <ul className="mt-8 grid w-full max-w-[26rem] gap-3 lg:hidden">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/70 p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900">
                  <Icon size={16} className="text-amber-400" aria-hidden="true" />
                </span>
                <div>
                  <div className="text-sm font-medium text-slate-800">{title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <footer className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-[11px] text-slate-400 lg:hidden">
          © {year} Al Shafi Enterprises
        </footer>
      </main>
    </div>
  )
}
