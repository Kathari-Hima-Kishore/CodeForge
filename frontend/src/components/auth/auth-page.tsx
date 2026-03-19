'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth, getPasswordChecks, type PasswordChecks } from '@/contexts/auth-context';
import { Loader2, ArrowRight, Users, Rocket, ChevronRight, Code2, Check, X, ShieldCheck } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* AMBIENT — Bright neon orbs, visible through dark background                     */
/* ═══════════════════════════════════════════════════════════════════════════════ */

function AmbientOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Large primary royal blue orb — top right */}
      <div
        className="absolute -top-40 -right-40 w-[800px] h-[800px]"
        style={{
          background: 'radial-gradient(circle, rgba(37,99,235,0.35) 0%, rgba(59,130,246,0.15) 40%, transparent 70%)',
          animation: 'float-slow 18s ease-in-out infinite',
        }}
      />
      {/* Mid-size neon orb — right */}
      <div
        className="absolute -top-20 right-[25%] w-[500px] h-[500px]"
        style={{
          background: 'radial-gradient(circle, rgba(79,158,255,0.25) 0%, rgba(37,99,235,0.1) 50%, transparent 70%)',
          animation: 'float-slow 22s ease-in-out infinite reverse',
        }}
      />
      {/* Cyan accent orb — top left */}
      <div
        className="absolute -top-24 left-[20%] w-[400px] h-[400px]"
        style={{
          background: 'radial-gradient(circle, rgba(56,189,248,0.18) 0%, rgba(37,99,235,0.08) 50%, transparent 70%)',
          animation: 'float-medium 25s ease-in-out infinite',
        }}
      />
      {/* Yellow accent orb — bottom left */}
      <div
        className="absolute -bottom-32 -left-20 w-[600px] h-[600px]"
        style={{
          background: 'radial-gradient(circle, rgba(234,179,8,0.12) 0%, rgba(234,179,8,0.05) 50%, transparent 70%)',
          animation: 'float-slow 28s ease-in-out infinite',
        }}
      />
      {/* Decorative neon dots */}
      <div
        className="absolute top-[20%] right-[18%] w-2 h-2"
        style={{
          background: '#4f9eff',
          boxShadow: '0 0 12px #4f9eff, 0 0 24px rgba(79,158,255,0.5)',
          borderRadius: '50%',
          animation: 'orb-flicker 3s ease-in-out infinite',
        }}
      />
      <div
        className="absolute bottom-[30%] left-[15%] w-1.5 h-1.5"
        style={{
          background: '#38bdf8',
          boxShadow: '0 0 8px #38bdf8, 0 0 16px rgba(56,189,248,0.4)',
          borderRadius: '50%',
          animation: 'orb-flicker 4s ease-in-out infinite reverse',
        }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* AUTH FORM — Cyberpunk brutalist                                                */
/* ═══════════════════════════════════════════════════════════════════════════════ */

type AuthMode = 'login' | 'register' | 'forgot';

function AuthForm() {
  const { login, register, resetPassword, error, loading, clearError, clearMessage } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [localError, setLocalError] = useState('');
  const [passwordChecks, setPasswordChecks] = useState<PasswordChecks>({ minLength: false, hasUppercase: false, hasLowercase: false, hasNumber: false });

  // Update password checks on change
  useEffect(() => {
    setPasswordChecks(getPasswordChecks(password));
  }, [password]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'register') {
        // register() creates account and sends verification email
        // User stays signed in and will see VerifyEmailScreen
        await register(email, password, displayName);
      } else {
        await resetPassword(email);
        setLocalError('');
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || '';

      // Login failed — email not verified, user was signed out
      if (msg === '__NOT_VERIFIED__') {
        return;
      }

      if (['Email is not registered', 'Incorrect password'].includes(msg)) {
        setLocalError(msg);
      } else if (msg.includes('Firebase:')) {
        const mapped = msg
          .replace('Firebase: ', '').replace(/\(auth\/.*?\)\.?/, '')
          .replace('invalid-credential', 'Incorrect email or password.')
          .replace('wrong-password', 'Incorrect password.')
          .replace('email-already-in-use', 'Email already registered.')
          .replace('weak-password', 'Password too weak.')
          .replace('invalid-email', 'Invalid email address.')
          .trim();
        setLocalError(mapped);
      } else if (msg && !msg.includes('Registration failed')) {
        setLocalError(msg);
      }
    }
  }, [mode, email, password, displayName, login, register, resetPassword]);

  const switchMode = useCallback((m: AuthMode) => {
    if (m === mode) return;
    setMode(m);
    setLocalError('');
    clearError();
    setPassword('');
  }, [mode, clearError]);

  const displayError = localError || error;
  // Password check list for register mode
  const passList: { key: keyof PasswordChecks; label: string }[] = [
    { key: 'minLength', label: '8+ characters' },
    { key: 'hasUppercase', label: 'A–Z uppercase' },
    { key: 'hasLowercase', label: 'a–z lowercase' },
    { key: 'hasNumber', label: '0–9 number' },
  ];

  return (
    <div className="w-full max-w-[360px]">
      {/* Mode tabs */}
      <div className="flex gap-6 mb-8">
        {(['login', 'register', 'forgot'] as const).map(m => (
          <button key={m} onClick={() => switchMode(m)} className={`cyber-tab ${mode === m ? 'active' : ''}`}>
            {m === 'login' ? 'Sign In' : m === 'register' ? 'Register' : 'Forgot'}
          </button>
        ))}
      </div>

      {/* Form headline */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white leading-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>
          {mode === 'login' ? 'Welcome back.' : mode === 'register' ? 'Create account.' : 'Reset password.'}
        </h2>
        <p className="text-sm mt-1.5" style={{ fontFamily: 'DM Sans, sans-serif', color: '#94a3b8' }}>
          {mode === 'login' && 'Continue to your workspace'}
          {mode === 'register' && 'Join thousands of developers'}
          {mode === 'forgot' && "We'll send a recovery link"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {mode === 'register' && (
          <div>
            <label className="text-xs font-bold mb-2 block uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
              Full Name
            </label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Alex Chen" autoComplete="name" className="form-input" />
          </div>
        )}

        <div>
          <label className="text-xs font-bold mb-2 block uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
            Email Address
          </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="alex@company.io" autoComplete="email" className="form-input" />
        </div>

        {mode !== 'forgot' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: '#64748b', letterSpacing: '0.08em' }}>
                Password
              </label>
              {mode === 'login' && (
                <button type="button" onClick={() => switchMode('forgot')} className="text-xs font-bold transition-colors" style={{ color: '#4f9eff' }}>
                  Forgot password?
                </button>
              )}
            </div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className="form-input" />

            {/* Password validation indicators — register mode only */}
            {mode === 'register' && password.length > 0 && (
              <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
                {passList.map(({ key, label }) => {
                  const met = passwordChecks[key];
                  return (
                    <div key={key} className="flex items-center gap-1.5 text-[11px]" style={{ color: met ? '#22c55e' : '#475569' }}>
                      {met ? (
                        <Check className="w-3 h-3" style={{ color: '#22c55e' }} />
                      ) : (
                        <X className="w-3 h-3" style={{ color: '#475569' }} />
                      )}
                      {label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {displayError && (
          <div className="text-sm py-3 px-3" style={{ color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '2px solid rgba(239,68,68,0.3)', borderLeft: '4px solid #ef4444' }}>
            {displayError}
          </div>
        )}

        <button type="submit" disabled={loading} className="brutal-blue w-full h-12 text-sm flex items-center justify-center gap-2 mt-2">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>{mode === 'login' ? 'Sign In to Workspace' : mode === 'register' ? 'Create Account' : 'Send Reset Link'}<ArrowRight className="w-4 h-4" /></>
          )}
        </button>
      </form>

      <div className="mt-6 pt-6 text-center" style={{ borderTop: '2px solid #0f1e3a' }}>
        {mode === 'login' && (
          <p className="text-sm" style={{ color: '#64748b' }}>
            No account?{' '}
            <button onClick={() => switchMode('register')} className="font-bold inline-flex items-center gap-0.5 transition-colors" style={{ color: '#4f9eff' }}>
              Register free <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </p>
        )}
        {mode === 'register' && (
          <p className="text-sm" style={{ color: '#64748b' }}>
            Already have an account?{' '}
            <button onClick={() => switchMode('login')} className="font-bold inline-flex items-center gap-0.5 transition-colors" style={{ color: '#4f9eff' }}>
              Sign in <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </p>
        )}
        {mode === 'forgot' && (
          <button onClick={() => switchMode('login')} className="text-sm font-bold transition-colors" style={{ color: '#4f9eff' }}>
            ← Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* ACTIVITY COUNTER                                                               */
/* ═══════════════════════════════════════════════════════════════════════════════ */

function ActivityNumber() {
  const [count, setCount] = useState(2847);
  useEffect(() => {
    const id = setInterval(() => setCount(c => c + Math.floor(Math.random() * 3)), 3000);
    return () => clearInterval(id);
  }, []);
  return <>{count.toLocaleString()}+</>;
}

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* MAIN LANDING PAGE — Cyberpunk Neo-Brutalist split                               */
/* ═══════════════════════════════════════════════════════════════════════════════ */

export function AuthPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      containerRef.current.querySelectorAll('[data-animate]').forEach(el => {
        (el as HTMLElement).style.opacity = '';
        el.classList.add('is-visible');
      });
      return;
    }
    containerRef.current.querySelectorAll('[data-animate]').forEach(el => {
      const delay = parseInt((el as HTMLElement).dataset.delay || '0');
      setTimeout(() => {
        (el as HTMLElement).style.opacity = '';
        el.classList.add('is-visible');
      }, delay);
    });
  }, []);

  return (
    <div ref={containerRef} className="relative w-screen h-screen overflow-hidden" style={{ background: '#03060f' }}>

      {/* Ambient neon orbs */}
      <AmbientOrbs />

      {/* Cyberpunk grid — left panel */}
      <div className="absolute inset-0 right-[42%] pointer-events-none cyber-grid" aria-hidden="true" style={{ opacity: 0.7 }} />

      {/* ═══════════════════════════ LEFT PANEL — 58% ═══════════════════════════ */}
      <div className="absolute inset-0 right-[42%] flex flex-col px-14 py-12" style={{ background: 'linear-gradient(135deg, #040913 0%, #03060f 50%, #040913 100%)', borderRight: '2px solid #0f1e3a' }}>

        {/* Top — Logo block */}
        <div className="flex items-center gap-0" data-animate data-delay="0">
          {/* Neon glowing badge */}
          <div className="relative flex items-center justify-center mr-5" style={{ animation: 'logo-neon-pulse 3s ease-in-out infinite' }}>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #2563eb, #4f9eff)', transform: 'translate(4px, 4px)' }} />
            <div className="relative w-12 h-12 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #2563eb, #3b82f6)', border: '2px solid #000000', boxShadow: '0 0 16px rgba(79,158,255,0.4)' }}>
              <Code2 className="w-6 h-6 text-white" />
            </div>
          </div>

          {/* CODEFORGE wordmark */}
          <div className="relative" style={{ display: 'inline-block', lineHeight: 1, fontSize: 'clamp(28px,4.5vw,56px)' }}>
            {/* Base text — metallic gradient */}
            <span className="block" style={{
              fontFamily: 'Outfit, sans-serif',
              fontWeight: 900,
              letterSpacing: '0.04em',
              background: 'linear-gradient(180deg, #c7d2fe 0%, #93c5fd 50%, #60a5fa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 12px rgba(37,99,235,0.3))',
            }}>
              CODEFORGE
            </span>

            {/* Diagonal reflective wave — white beam overlay */}
            <span aria-hidden="true" className="absolute inset-0 pointer-events-none z-10" style={{ overflow: 'hidden' }}>
              <span className="absolute" style={{
                width: '150%',
                height: '200%',
                top: '-50%',
                left: '-25%',
                background: 'linear-gradient(135deg, transparent 0%, transparent 45%, rgba(255,255,255,0.95) 48%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.95) 52%, transparent 55%, transparent 100%)',
                animation: 'diagonal-beam 2.5s cubic-bezier(0.3, 0, 0.7, 1) infinite',
              }} />
            </span>

            <span aria-hidden="true" className="absolute bottom-0 left-0 right-0 h-px z-10" style={{
              background: 'linear-gradient(90deg, transparent, #2563eb, #4f9eff, #2563eb, transparent)',
              boxShadow: '0 0 8px rgba(79,158,255,0.5)',
            }} />
          </div>
        </div>

        {/* Center — Hero */}
        <div className="flex flex-col justify-center flex-1 py-10 gap-8">
          {/* Eyebrow */}
          <div className="flex items-center gap-3" data-animate data-delay="150">
            <div className="h-[2px] w-8" style={{ background: 'linear-gradient(90deg, #3b82f6, #4f9eff)', boxShadow: '2px 2px 0 #000000, 0 0 8px rgba(59,130,246,0.5)' }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ fontFamily: 'DM Sans, sans-serif', color: '#4f9eff', textShadow: '0 0 10px rgba(79,158,255,0.4)' }}>
              Collaborative IDE
            </span>
          </div>

          {/* Headline */}
          <div className="space-y-0" data-animate data-delay="250">
            <h1 className="text-[clamp(52px,8vw,96px)] font-black leading-[0.9] tracking-tight text-white" style={{ fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.025em' }}>
              Code together.
            </h1>
            <h1 className="text-[clamp(52px,8vw,96px)] font-black leading-[0.9] tracking-tight" style={{ fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.025em', background: 'linear-gradient(135deg, #3b82f6 0%, #4f9eff 50%, #38bdf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'hero-glow-pulse 4s ease-in-out infinite' }}>
              Ship faster.
            </h1>
          </div>

          {/* Sub */}
          <p className="text-base leading-relaxed max-w-[440px]" style={{ fontFamily: 'DM Sans, sans-serif', color: '#94a3b8', lineHeight: '1.7' }} data-animate data-delay="300">
            Every keystroke shared in real-time across your entire team.
            One click to launch, collaborate, and deploy — from anywhere in the world.
          </p>

          {/* Feature blocks */}
          <div className="flex flex-col gap-3" data-animate data-delay="400">
            {[
              { icon: <Users className="w-4 h-4" />, label: 'Live Collaboration', sub: 'Cursors & edits in real-time', color: '#2563eb' },
              { icon: <Rocket className="w-4 h-4" />, label: 'One-Click Deploy', sub: 'Build & ship to Docker Hub instantly', color: '#eab308' },
            ].map((f, i) => (
              <div key={i} className="cyber-feature flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center flex-shrink-0" style={{ background: f.color, border: '2px solid #000000', boxShadow: `3px 3px 0 #000000, 0 0 12px ${f.color}66`, color: '#fff' }}>
                  {f.icon}
                </div>
                <div>
                  <div className="text-sm font-bold text-white" style={{ fontFamily: 'Outfit, sans-serif' }}>{f.label}</div>
                  <div className="text-xs" style={{ fontFamily: 'DM Sans, sans-serif', color: '#64748b' }}>{f.sub}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-6" data-animate data-delay="450">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2" style={{ background: '#22c55e', boxShadow: '2px 2px 0 #000000, 0 0 8px rgba(34,197,94,0.6)', borderRadius: '50%' }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ fontFamily: 'DM Sans, sans-serif', color: '#64748b' }}><ActivityNumber /> Live</span>
            </div>
            <div className="h-4 w-[1px]" style={{ background: '#0f1e3a' }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ fontFamily: 'DM Sans, sans-serif', color: '#475569' }}>8 Languages</span>
            <div className="h-4 w-[1px]" style={{ background: '#0f1e3a' }} />
            <span className="text-xs font-bold uppercase tracking-wider" style={{ fontFamily: 'DM Sans, sans-serif', color: '#475569' }}>Zero Config</span>
          </div>
        </div>

        {/* Bottom — Footer */}
        <div className="flex items-center justify-between text-xs pt-6" style={{ fontFamily: 'DM Sans, sans-serif', color: '#334155', borderTop: '2px solid #0a1628' }} data-animate data-delay="550">
          <span>© 2025 CodeForge Systems</span>
          <div className="flex gap-5">
            {['Privacy', 'Terms', 'Status'].map(l => (
              <span key={l} className="hover:underline cursor-pointer font-semibold" style={{ color: '#475569' }}>{l}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ════════════════════════════ DIVIDER — Neon line ═══════════════════════════ */}
      <div className="absolute left-[58%] top-0 bottom-0 w-[2px] pointer-events-none" style={{ background: 'linear-gradient(180deg, transparent 0%, #2563eb 20%, #4f9eff 50%, #2563eb 80%, transparent 100%)', boxShadow: '0 0 12px rgba(37,99,235,0.5), 0 0 24px rgba(37,99,235,0.2)' }} data-animate data-delay="200" />

      {/* ═══════════════════════════ RIGHT PANEL — 42% ═══════════════════════════ */}
      <div className="absolute right-0 top-0 bottom-0 w-[42%] flex items-center justify-center px-10">
        <div className="relative w-full max-w-[420px] brutal-elevated p-8 cyber-corner" data-animate data-delay="300">
          <AuthForm />
        </div>
      </div>

    </div>
  );
}
