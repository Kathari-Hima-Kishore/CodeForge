'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/auth-context';
import gsap from 'gsap';
import {
  Loader2, Eye, EyeOff, ShieldCheck, Code2, ArrowRight,
  Mail, Lock, User, Globe, Zap,
} from 'lucide-react';

type AuthMode = 'login' | 'register' | 'forgot';

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* VERTICAL CONSTRAINT SYSTEM - Ensures layout fits 100vh at 100% zoom            */
/* ═══════════════════════════════════════════════════════════════════════════════ */

function NeonBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[#030510]" />
      <div
        className="absolute -top-[25%] -left-[10%] w-[68vw] h-[68vw] rounded-full opacity-[0.22]"
        style={{ background: 'radial-gradient(circle, rgba(65,105,225,0.75) 0%, transparent 65%)' }}
      />
      <div
        className="absolute -bottom-[20%] -right-[5%] w-[50vw] h-[50vw] rounded-full opacity-[0.15]"
        style={{ background: 'radial-gradient(circle, rgba(30,80,220,0.65) 0%, transparent 65%)' }}
      />
      <div
        className="absolute top-[30%] right-[5%] w-[35vw] h-[35vw] rounded-full opacity-[0.07]"
        style={{ background: 'radial-gradient(circle, rgba(120,80,255,0.5) 0%, transparent 65%)' }}
      />
      <div
        className="absolute top-0 left-[35%] w-[1px] h-full opacity-[0.045] rotate-[12deg]"
        style={{ background: 'linear-gradient(to bottom, transparent, #4169E1 30%, #6C8FFF 50%, #4169E1 70%, transparent)' }}
      />
      <div
        className="absolute top-0 right-[22%] w-[1px] h-full opacity-[0.03] -rotate-[18deg]"
        style={{ background: 'linear-gradient(to bottom, transparent, #4169E1 40%, #6C8FFF 50%, #4169E1 60%, transparent)' }}
      />
      <div className="absolute inset-0 bg-grid-pattern opacity-[0.045]" />
      <div className="absolute inset-0 bg-noise" />
    </div>
  );
}

function FloatingParticles() {
  const particles = [
    { sz: 'w-1.5 h-1.5', op: 0.40, l: '12%', t: '18%', d: '0s', dur: '9s' },
    { sz: 'w-1 h-1', op: 0.28, l: '85%', t: '22%', d: '1.5s', dur: '11s' },
    { sz: 'w-2 h-2', op: 0.22, l: '65%', t: '72%', d: '3s', dur: '10s' },
    { sz: 'w-1 h-1', op: 0.33, l: '28%', t: '82%', d: '2s', dur: '13s' },
  ];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]" aria-hidden="true">
      {particles.map((p, i) => (
        <div
          key={i}
          className={`absolute ${p.sz} rounded-full animate-float-particle`}
          style={{
            background: `rgba(65,105,225,${p.op})`,
            left: p.l, top: p.t,
            animationDelay: p.d, animationDuration: p.dur,
            boxShadow: `0 0 ${8 + i * 2}px rgba(65,105,225,${p.op + 0.1})`,
          }}
        />
      ))}
    </div>
  );
}

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const colors = [
    'bg-red-500 shadow-[0_0_8px_rgba(255,50,50,0.4)]',
    'bg-orange-400 shadow-[0_0_8px_rgba(255,160,50,0.4)]',
    'bg-blue-400 shadow-[0_0_8px_rgba(65,105,225,0.5)]',
    'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]',
  ];
  const labels = ['Weak', 'Fair', 'Good', 'Strong'];
  if (!password) return null;
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1 h-[3px]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`flex-1 rounded-full transition-all duration-500 ${
              i < score ? colors[score - 1] : 'bg-white/[0.06]'
            }`}
          />
        ))}
      </div>
      {score > 0 && (
        <p className="text-[10px] font-medium text-white/40 flex items-center gap-1">
          {score === 4 && <ShieldCheck className="w-3 h-3 text-emerald-400" />}
          {labels[score - 1]}
        </p>
      )}
    </div>
  );
}

function NeonInput({
  id, type = 'text', required = false, autoFocus = false,
  value, onChange, placeholder, minLength,
  className = '', children, icon,
}: {
  id: string; type?: string; required?: boolean; autoFocus?: boolean;
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; minLength?: number; className?: string;
  children?: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <div className="relative group">
      {icon && (
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 z-10 pointer-events-none text-white/20 group-focus-within:text-[#4169E1]/60 transition-colors duration-300">
          {icon}
        </div>
      )}
      <Input
        id={id} type={type} required={required} autoFocus={autoFocus}
        value={value} onChange={onChange} minLength={minLength} placeholder={placeholder}
        className={`h-11 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white
          placeholder:text-white/20 ${icon ? 'pl-10' : ''}
          focus:bg-white/[0.06] focus:border-[#4169E1]/60 focus:ring-2 focus:ring-[#4169E1]/20
          focus:shadow-[0_0_24px_rgba(65,105,225,0.2)] transition-all duration-300 ${className}`}
      />
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* COMPACT HERO SECTION - Fluid typography based on viewport height               */
/* ═══════════════════════════════════════════════════════════════════════════════ */

function HeroSection({ compact = false }: { compact?: boolean }) {
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!heroRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('.cf-hero-heading', { opacity: 0, x: -40, duration: 0.6, ease: 'power3.out' });
      gsap.from('.cf-hero-sub', { opacity: 0, x: -30, duration: 0.5, delay: 0.15 });
      gsap.from('.cf-illustration', { opacity: 0, scale: 0.92, y: 20, duration: 0.7, ease: 'power2.out' });
      gsap.from('.cf-feature', { opacity: 0, y: 10, stagger: 0.08, duration: 0.4 });
    }, heroRef);
    return () => { ctx.revert(); };
  }, []);

  // Architectural Typography System — headline is the spatial anchor
  // NOTE: lim is a raw CSS value (used in style={{ fontSize }}), not a Tailwind class
  const textSizes = {
    sys: 'text-[clamp(12px,1.7vh,16px)]',
    lim: 'clamp(100px, 44vh, 80px)',
    sub: 'text-[clamp(12px,1.5vh,15px)]',
    ill: 'max-w-[350px]'
  };

  return (
    <div ref={heroRef} className="flex flex-col h-full items-center justify-center gap-[1.5vh] py-1 overflow-hidden">
      {/* Colossal Headline System */}
      <div className="cf-hero-heading text-center w-full">
        <div className="flex items-center justify-center gap-5 mb-1 lg:mb-2">
          <span className={`font-code ${textSizes.sys} tracking-[0.5em] text-white/40 font-bold uppercase select-none`}>
            &gt;_ 
          </span>
          <span className="h-[2px] w-20 bg-gradient-to-r from-[#4169E1]/60 to-transparent hidden lg:block" />
        </div>

        <h1 className="font-headline uppercase leading-none tracking-tighter">
          <span className="block font-black text-white/30 tracking-[0.18em] mb-1" style={{ fontSize: 'clamp(28px, 4vh, 48px)' }}>
            Build Without
          </span>
          <span
            className="relative block font-black text-transparent bg-clip-text select-none"
            style={{
              backgroundImage: 'linear-gradient(125deg, #5B8AFF 0%, #4169E1 18%, #90BAFF 42%, #4169E1 62%, #B0CFFF 85%, #6A9FFF 100%)',
              fontSize: textSizes.lim,
              lineHeight: 0.75,
              animation: 'glitchSlip 7s ease-in-out infinite',
              letterSpacing: '-0.06em',
            }}
          >
            LIMITs
            <span
              aria-hidden="true"
              className="absolute inset-0 -z-10 pointer-events-none blur-[40px]"
              style={{
                background: 'radial-gradient(ellipse at 50% 50%, rgba(65, 105, 225, 0.95) 0%, rgba(100, 149, 255, 0.6) 35%, transparent 70%)',
                animation: 'limitsGlow 3s ease-in-out infinite',
              }}
            />
          </span>
        </h1>

        <div className="flex items-center justify-center gap-5 mt-2 lg:mt-3">
          <span className="block h-[3px] w-16 rounded-full bg-[#4169E1]" />
          <span className="block h-[1px] w-32 bg-gradient-to-r from-[#4169E1]/80 to-transparent" />
          <span className={`font-code ${textSizes.sys} text-white/30 tracking-[0.6em] font-bold uppercase hidden lg:block`}>
            
          </span>
        </div>

        <p className="cf-hero-sub mt-2 lg:mt-3 text-white/45 leading-snug text-center max-w-[420px] mx-auto">
          <span className={textSizes.sub}>
            The collaborative cloud IDE that lets your team code, build, and ship — from anywhere in the world.
          </span>
        </p>
      </div>

      {/* Compressed Illustration */}
      <div className="w-full flex flex-col items-center gap-2 shrink min-h-0">
        <div className={`cf-illustration relative w-full shrink min-h-0 ${textSizes.ill}`}>
          <div
            className="absolute inset-0 -m-12 rounded-2xl pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at center, rgba(65,105,225,0.2) 0%, transparent 70%)' }}
          />
          <div
            className="relative rounded-2xl overflow-hidden bg-[#04060E] flex flex-col"
            style={{
              border: '2px solid rgba(65,105,225,0.35)',
              boxShadow: '0 0 0 1px rgba(65,105,225,0.05), 0 40px 100px -12px rgba(0,0,0,0.95)',
            }}
          >
            <div className="flex items-center gap-3 px-6 py-1.5 bg-[#07091B]/95 border-b border-white/[0.04] shrink-0">
              <div className="w-3.5 h-3.5 rounded-full bg-[#FF5F57]/80" />
              <div className="w-3.5 h-3.5 rounded-full bg-[#FEBC2E]/80" />
              <div className="w-3.5 h-3.5 rounded-full bg-[#28C840]/80" />
              <div className="ml-auto flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400/60 animate-pulse" />
                <span className="text-[12px] text-white/40 font-code tracking-[0.25em] uppercase font-bold">codeforge.dev</span>
              </div>
            </div>
            
            <div className="relative overflow-hidden flex-1 flex items-center justify-center">
              <img
                src="/image.png"
                alt="CodeForge Workspace"
                className="w-full h-auto object-contain max-h-[50vh]"
              />
              <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
                <div className="absolute left-0 right-0 h-[60px] bg-gradient-to-b from-transparent via-[#4169E1]/10 to-transparent animate-scanLine" style={{ animationDuration: '6s' }} />
              </div>
            </div>

            {!compact && (
              <div className="grid grid-cols-4 divide-x divide-white/[0.05] bg-[#060818]/95 border-t border-white/[0.04] shrink-0">
                {[
                  { value: '10k+', label: 'Devs' },
                  { value: '99.9%', label: 'Uptime' },
                  { value: '8', label: 'Langs' },
                  { value: '<50ms', label: 'Ping' },
                ].map((s, i) => (
                  <div key={i} className="flex flex-col items-center py-1 lg:py-1">
                    <span className="text-[12px] font-bold text-white/80 font-headline">{s.value}</span>
                    <span className="text-[8px] text-white/30 mt-0.5 uppercase tracking-widest font-semibold">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {!compact && (
          <div className="hidden lg:flex items-center gap-2 flex-wrap cf-feature">
            {[
              { icon: '⚡', label: 'Real-time' },
              { icon: '🔒', label: 'Secure' },
              { icon: '☁️', label: 'Cloud' },
            ].map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] hover:border-[#4169E1]/40 hover:bg-[#4169E1]/[0.05] transition-all duration-300 group"
              >
                <span className="text-xs group-hover:scale-110 transition-transform">{f.icon}</span>
                <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em]">{f.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* AUTH CARD - Preserved at original quality (not significantly resized)          */
/* ═══════════════════════════════════════════════════════════════════════════════ */

interface AuthCardProps {
  mode: AuthMode;
  email: string;
  password: string;
  displayName: string;
  showPassword: boolean;
  message: string;
  localError: string | null;
  loading: boolean;
  onModeChange: (m: AuthMode) => void;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onDisplayNameChange: (v: string) => void;
  onShowPasswordToggle: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

function AuthCard({
  mode, email, password, displayName, showPassword, message, localError, loading,
  onModeChange, onEmailChange, onPasswordChange, onDisplayNameChange, onShowPasswordToggle, onSubmit
}: AuthCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    gsap.fromTo(cardRef.current, 
      { opacity: 0, y: 30, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'power2.out', delay: 0.2 }
    );
  }, []);

  return (
    <div ref={cardRef} className="flex items-center justify-center px-3 pb-4 lg:pb-0">
      <div className="w-full max-w-[400px]">
        <div
          className="relative rounded-2xl p-6 sm:p-8 overflow-hidden"
          style={{
            background: 'rgba(7, 9, 20, 0.75)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            border: '1px solid rgba(65,105,225,0.14)',
            boxShadow: [
              '0 0 0 1px rgba(65,105,225,0.06)',
              '0 24px 48px -12px rgba(0,0,0,0.65)',
              '0 0 80px -24px rgba(65,105,225,0.12)',
            ].join(', '),
          }}
        >
          <div className="absolute top-3 left-3 w-4 h-4 border-t-[1.5px] border-l-[1.5px] border-[#4169E1]/30 pointer-events-none" style={{ borderTopLeftRadius: 3 }} />
          <div className="absolute top-3 right-3 w-4 h-4 border-t-[1.5px] border-r-[1.5px] border-[#4169E1]/30 pointer-events-none" style={{ borderTopRightRadius: 3 }} />
          <div className="absolute bottom-3 left-3 w-4 h-4 border-b-[1.5px] border-l-[1.5px] border-[#4169E1]/30 pointer-events-none" style={{ borderBottomLeftRadius: 3 }} />
          <div className="absolute bottom-3 right-3 w-4 h-4 border-b-[1.5px] border-r-[1.5px] border-[#4169E1]/30 pointer-events-none" style={{ borderBottomRightRadius: 3 }} />

          <div className="absolute top-0 left-[6%] right-[6%] h-[1px] bg-gradient-to-r from-transparent via-[#4169E1]/55 to-transparent pointer-events-none" />

          <div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-[260px] h-[180px] rounded-full pointer-events-none opacity-[0.05]"
            style={{ background: 'radial-gradient(circle, rgba(65,105,225,0.95) 0%, transparent 70%)' }}
          />

          <div className="relative z-10 mb-6 flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4169E1]/10 border border-[#4169E1]/18 mt-0.5">
              <Lock className="h-4.5 w-4.5 text-[#4169E1]/75" />
            </div>
            <div>
              <h2 className="text-[24px] sm:text-[28px] font-bold tracking-tight text-white leading-tight mb-0.5 font-headline">
                {mode === 'login' && 'Welcome Back'}
                {mode === 'register' && 'Create Account'}
                {mode === 'forgot' && 'Reset Password'}
              </h2>
              <p className="text-[12px] text-white/35 leading-relaxed">
                {mode === 'login' && 'Sign in to continue to your workspace'}
                {mode === 'register' && 'Get started with CodeForge IDE today'}
                {mode === 'forgot' && 'Enter your email to receive a reset link'}
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="relative z-10 space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="displayName" className="text-[10px] font-semibold tracking-wider uppercase text-white/38">
                  Display Name
                </Label>
                <NeonInput
                  id="displayName" required autoFocus value={displayName}
                  onChange={(e) => onDisplayNameChange(e.target.value)} placeholder="Your name"
                  icon={<User className="h-[14px] w-[14px]" />}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[10px] font-semibold tracking-wider uppercase text-white/38">
                Email Address
              </Label>
              <NeonInput
                id="email" type="email" required autoFocus={mode !== 'register'}
                value={email} onChange={(e) => onEmailChange(e.target.value)}
                placeholder="you@example.com"
                icon={<Mail className="h-[14px] w-[14px]" />}
              />
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[10px] font-semibold tracking-wider uppercase text-white/38">
                    Password
                  </Label>
                  {mode === 'login' && (
                    <button
                      type="button" onClick={() => onModeChange('forgot')}
                      className="text-[11px] font-semibold text-[#4169E1]/55 hover:text-[#4169E1] transition-colors cursor-pointer"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <NeonInput
                  id="password" type={showPassword ? 'text' : 'password'} required minLength={8}
                  value={password} onChange={(e) => onPasswordChange(e.target.value)}
                  placeholder={mode === 'register' ? 'Min. 8 characters' : '••••••••'}
                  className="pr-10" icon={<Lock className="h-[14px] w-[14px]" />}
                >
                  <button
                    type="button" tabIndex={-1} onClick={onShowPasswordToggle}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-white/22 hover:text-[#4169E1]/65 transition-colors duration-200"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </NeonInput>
                {mode === 'register' && <PasswordStrength password={password} />}
              </div>
            )}

            {localError && (
              <div className="rounded-lg border border-red-400/20 bg-red-500/[0.06] px-3 py-2.5 text-xs text-red-300/85">
                {localError}
              </div>
            )}

            {message && (
              <div className="rounded-lg border border-[#4169E1]/22 bg-[#4169E1]/[0.06] px-3 py-2.5 text-xs text-blue-300/85">
                {message}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="group relative mt-2 h-11 w-full rounded-xl text-[14px] font-semibold text-white overflow-hidden border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300"
              style={{
                background: 'linear-gradient(135deg, #3A5AD0 0%, #4169E1 48%, #4F7AFF 100%)',
                boxShadow: '0 0 18px rgba(65,105,225,0.28), 0 6px 24px -6px rgba(65,105,225,0.45)',
              }}
            >
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 overflow-hidden">
                <span
                  className="absolute inset-y-0 w-[40%] -left-[40%]"
                  style={{
                    background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.1), transparent)',
                    animation: 'shimmerBtn 1.8s ease-in-out infinite',
                  }}
                />
              </span>
              <span className="absolute inset-0 bg-gradient-to-r from-[#4F7AFF] to-[#4169E1] opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl" />
              <span className="relative z-10 flex items-center justify-center gap-2">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {mode === 'login' && 'Sign In'}
                    {mode === 'register' && 'Create Account'}
                    {mode === 'forgot' && 'Send Reset Link'}
                    <ArrowRight className="w-3.5 h-3.5 opacity-60 group-hover:translate-x-1 transition-transform duration-200" />
                  </>
                )}
              </span>
            </Button>
          </form>

          <div className="relative z-10 mt-5 text-center space-y-2">
            {mode === 'login' && (
              <p className="text-[12px] text-white/30">
                Don&apos;t have an account?{' '}
                <button onClick={() => onModeChange('register')}
                  className="font-semibold text-[#4169E1]/70 hover:text-[#4169E1] transition-colors cursor-pointer">
                  Create one
                </button>
              </p>
            )}
            {mode === 'register' && (
              <p className="text-[12px] text-white/30">
                Already have an account?{' '}
                <button onClick={() => onModeChange('login')}
                  className="font-semibold text-[#4169E1]/70 hover:text-[#4169E1] transition-colors cursor-pointer">
                  Sign in
                </button>
              </p>
            )}
            {mode === 'forgot' && (
              <button onClick={() => onModeChange('login')}
                className="text-[12px] font-semibold text-[#4169E1]/70 hover:text-[#4169E1] transition-colors cursor-pointer">
                ← Back to sign in
              </button>
            )}
          </div>

          <div className="relative z-10 flex items-center justify-center gap-2 sm:gap-3 mt-4 pt-4 border-t border-white/[0.04]">
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-400/45" />
              <span className="text-[9px] text-white/20 font-medium">256-bit SSL</span>
            </div>
            <span className="text-white/[0.06]">·</span>
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-[#4169E1]/40" />
              <span className="text-[9px] text-white/20 font-medium">Firebase</span>
            </div>
            <span className="text-white/[0.06]">·</span>
            <div className="flex items-center gap-1">
              <Globe className="w-3 h-3 text-[#4169E1]/40" />
              <span className="text-[9px] text-white/20 font-medium">E2E</span>
            </div>
          </div>

          <div className="absolute bottom-0 left-[10%] right-[10%] h-[1px] bg-gradient-to-r from-transparent via-[#4169E1]/18 to-transparent pointer-events-none" />
        </div>

        <div
          className="mx-auto mt-[-1px] w-[52%] h-[40px] opacity-[0.15] pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at top, rgba(65,105,225,0.28) 0%, transparent 80%)' }}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════ */
/* MAIN AUTH PAGE - Vertical constraint system                                     */
/* ═══════════════════════════════════════════════════════════════════════════════ */

export function AuthPage() {
  const { login, register, resetPassword, error, loading, clearError } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const [isCompact, setIsCompact] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkHeight = () => {
      setIsCompact(window.innerHeight < 750);
    };
    checkHeight();
    window.addEventListener('resize', checkHeight);
    return () => window.removeEventListener('resize', checkHeight);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!pageRef.current) return;
      const ctx = gsap.context(() => {
        gsap.from('.cf-brand', { opacity: 0, y: -10, duration: 0.4 });
      }, pageRef);
      return () => { ctx.revert(); };
    }, 200);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setLocalError('');
    clearError();
    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'register') {
        if (password.length < 8) { setLocalError('Password must be at least 8 characters.'); return; }
        await register(email, password, displayName);
      } else {
        await resetPassword(email);
        setMessage('Reset link sent — check your inbox.');
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || '';
      if (['Email is not registered', 'Incorrect password'].includes(msg)) {
        setLocalError(msg);
      } else if (msg.includes('Firebase:')) {
        setLocalError(
          msg.replace('Firebase: ', '').replace(/\(auth\/.*?\)\.?/, '')
            .replace('invalid-credential', 'Incorrect email or password.')
            .replace('wrong-password', 'Incorrect password.')
            .replace('email-already-in-use', 'Email already registered.')
            .replace('weak-password', 'Password too weak.')
            .replace('invalid-email', 'Invalid email address.')
            .trim()
        );
      } else if (msg && !msg.includes('Login failed')) {
        setLocalError(msg);
      }
    }
  };

  const switchMode = useCallback((m: AuthMode) => {
    if (m === mode) return;
    setMode(m);
    setMessage('');
    setLocalError('');
    clearError();
    setShowPassword(false);
    setPassword('');
  }, [mode, clearError]);

  const displayError = localError || error;

  return (
    <div
      ref={pageRef}
      className="relative w-screen h-screen overflow-hidden selection:bg-[#4169E1]/20 selection:text-white"
    >
      <NeonBackground />
      <FloatingParticles />

      <div className="cf-brand relative z-20 flex items-center px-6 lg:px-10 pt-4 lg:pt-6">
        <div className="flex items-center gap-3">
          <div className="relative group">
            <div className="absolute inset-0 bg-[#4169E1]/25 rounded-lg blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-400" />
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-[#4169E1]/12 border border-[#4169E1]/22 transition-all duration-300 group-hover:border-[#4169E1]/40 group-hover:bg-[#4169E1]/18">
              <Code2 className="h-4 w-4 text-[#4169E1]" />
            </div>
          </div>
          <span className="relative inline-block overflow-hidden text-[clamp(50px,4vh,40px)] font-black tracking-[0.25em] text-white font-headline">
            CODEFORGE
            <span
              className="absolute inset-y-0 w-[45%] pointer-events-none"
              style={{
                left: '-45%',
                background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.18) 50%, transparent)',
                animation: 'shimmerBtn 2.8s ease-in-out infinite',
                transform: 'skewX(-18deg)',
              }}
            />
          </span>
        </div>
      </div>

      {/* ── Horizontal bridge: anchors header to content below ── */}
      <div
        className="relative z-20 h-[1px] pointer-events-none"
        style={{ background: 'linear-gradient(to right, transparent 0%, rgba(65,105,225,0.06) 8%, rgba(65,105,225,0.22) 30%, rgba(65,105,225,0.32) 50%, rgba(65,105,225,0.22) 70%, rgba(65,105,225,0.06) 92%, transparent 100%)' }}
      />

      <div className="relative z-10 grid lg:grid-cols-2 gap-4 lg:gap-0 h-[calc(100vh-60px)] px-4 lg:px-0">

        {/* ── Vertical bridge: divides and connects the two columns ── */}
        <div
          className="hidden lg:block absolute inset-y-0 left-1/2 w-[1px] pointer-events-none z-0"
          style={{ background: 'linear-gradient(to bottom, rgba(65,105,225,0.28) 0%, rgba(65,105,225,0.38) 35%, rgba(65,105,225,0.38) 65%, rgba(65,105,225,0.15) 100%)' }}
        />
        {/* Intersection node — where horizontal and vertical lines meet */}
        <div
          className="hidden lg:block absolute top-0 left-1/2 -translate-x-1/2 w-[7px] h-[7px] rounded-full pointer-events-none z-10"
          style={{ background: 'rgba(65,105,225,0.9)', boxShadow: '0 0 10px rgba(65,105,225,0.7), 0 0 22px rgba(65,105,225,0.35)' }}
        />

        <HeroSection compact={isCompact} />
        <AuthCard
          mode={mode}
          email={email}
          password={password}
          displayName={displayName}
          showPassword={showPassword}
          message={message}
          localError={displayError}
          loading={loading}
          onModeChange={switchMode}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onDisplayNameChange={setDisplayName}
          onShowPasswordToggle={() => setShowPassword(!showPassword)}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
