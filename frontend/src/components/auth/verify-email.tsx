'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { Loader2, Mail, CheckCircle2, RefreshCw, ArrowLeft, ShieldCheck } from 'lucide-react';

export function VerifyEmailScreen() {
  const { user, resendVerification, reloadUser, logout } = useAuth();
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [verified, setVerified] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [sendMsgType, setSendMsgType] = useState<'success' | 'error'>('success');
  const [refreshMsg, setRefreshMsg] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => c - 1), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || sending) return;
    setSending(true);
    setSendMsg('');
    try {
      await resendVerification();
      setSendMsg('Verification email sent. Check your inbox.');
      setSendMsgType('success');
      setCooldown(60);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send';
      setSendMsg(msg);
      setSendMsgType('error');
    } finally {
      setSending(false);
    }
  }, [cooldown, sending, resendVerification]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMsg('');
    try {
      const isVerified = await reloadUser();
      if (isVerified) {
        setVerified(true);
      } else {
        setRefreshMsg('Not verified yet. Check your email and click the link first.');
      }
    } catch {
      setRefreshMsg('Failed to check. Try again.');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, reloadUser]);

  if (verified) {
    return (
      <div
        className="fixed inset-0 overflow-hidden flex items-center justify-center pointer-events-none"
        style={{ zIndex: 50 }}
      >
        <div className="flex flex-col items-center justify-center gap-4 pointer-events-auto">
          <div className="relative">
            <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-md" />
            <CheckCircle2 className="w-8 h-8 text-emerald-400 relative z-10" />
          </div>
          <p className="text-sm text-emerald-300 font-semibold tracking-wide uppercase" style={{ fontFamily: 'Outfit, sans-serif' }}>
            Email Verified
          </p>
          <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden flex items-center justify-center pointer-events-none"
      style={{ zIndex: 50 }}
    >
      {/* Semi-transparent dark backdrop */}
      <div
        className="absolute inset-0 pointer-events-auto"
        style={{
          background: 'rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Ambient orbs behind modal */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div
          className="absolute -top-40 -right-40 w-[600px] h-[600px]"
          style={{
            background: 'radial-gradient(circle, rgba(37,99,235,0.35) 0%, rgba(59,130,246,0.15) 40%, transparent 70%)',
            animation: 'float-slow 18s ease-in-out infinite',
          }}
        />
        <div
          className="absolute -bottom-32 -left-20 w-[500px] h-[500px]"
          style={{
            background: 'radial-gradient(circle, rgba(56,189,248,0.2) 0%, rgba(37,99,235,0.08) 50%, transparent 70%)',
            animation: 'float-medium 22s ease-in-out infinite',
          }}
        />
      </div>

      {/* Modal Card */}
      <div
        className="relative w-full max-w-[420px] brutal-elevated p-8 cyber-corner pointer-events-auto"
        style={{
          margin: '16px',
          boxShadow: '0 0 40px rgba(37, 99, 235, 0.3), 0 0 80px rgba(37, 99, 235, 0.15), 8px 8px 0 rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div
            className="relative w-16 h-16 flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
              border: '2px solid #000000',
              boxShadow: '4px 4px 0 #000000, 0 0 16px rgba(37,99,235,0.4)',
            }}
          >
            <Mail className="w-7 h-7 text-white" />
          </div>
        </div>

        {/* Title */}
        <h1
          className="text-xl font-bold text-white text-center"
          style={{ fontFamily: 'Outfit, sans-serif' }}
        >
          Verify your email
        </h1>
        <p
          className="text-sm text-center mt-2"
          style={{ fontFamily: 'DM Sans, sans-serif', color: '#94a3b8' }}
        >
          We sent a verification link to
        </p>
        <p
          className="text-sm text-center font-semibold mt-0.5"
          style={{ fontFamily: 'DM Sans, sans-serif', color: '#4f9eff' }}
        >
          {user?.email}
        </p>

        {/* Divider */}
        <div
          className="my-6 h-px"
          style={{
            background: 'linear-gradient(90deg, transparent, #0f1e3a, transparent)',
          }}
        />

        {/* Resend button */}
        <div className="space-y-2 mb-4">
          <button
            onClick={handleResend}
            disabled={cooldown > 0 || sending}
            className="brutal-blue w-full h-12 text-sm flex items-center justify-center gap-2"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : cooldown > 0 ? (
              `Resend in ${cooldown}s`
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Resend verification email
              </>
            )}
          </button>
          {sendMsg && (
            <p
              className="text-xs text-center px-2"
              style={{
                color: sendMsgType === 'success' ? '#22c55e' : '#f87171',
              }}
            >
              {sendMsg}
            </p>
          )}
        </div>

        {/* Refresh check button */}
        <div className="space-y-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="brutal-outline w-full h-11 text-sm flex items-center justify-center gap-2"
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            I&apos;ve verified — check now
          </button>
          {refreshMsg && (
            <p className="text-xs text-center px-2" style={{ color: '#eab308' }}>
              {refreshMsg}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="mt-6 pt-4 text-center"
          style={{ borderTop: '2px solid #0f1e3a' }}
        >
          <button
            onClick={logout}
            className="text-xs flex items-center gap-1 mx-auto transition-colors hover:text-amber-300"
            style={{ color: '#475569' }}
          >
            <ArrowLeft className="w-3 h-3" />
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
