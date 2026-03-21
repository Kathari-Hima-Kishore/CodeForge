'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSession, SessionSummary } from '@/contexts/session-context';
import { useAuth } from '@/contexts/auth-context';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Plus, LogIn, LogOut, ArrowLeft, Users,
  Clock, Crown, RefreshCw, ChevronRight, Terminal,
  FolderOpen, AlertTriangle,
} from 'lucide-react';

type SessionMode = 'select' | 'create' | 'join';

export function SessionDialog() {
  const {
    createSession,
    joinSession,
    rejoinSession,
    isConnecting,
    connectionError,
    mySessions,
    isLoadingSessions,
    refreshMySessions,
  } = useSession();
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<SessionMode>('select');
  const [sessionName, setSessionName] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');
  const [showSessionNotFoundModal, setShowSessionNotFoundModal] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!sessionName.trim()) { setError('Please enter a session name'); return; }
    try {
      await createSession(sessionName.trim());
    } catch {
      setError('Failed to create session');
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!sessionId.trim()) { setError('Please enter a session code'); return; }
    try {
      await joinSession(sessionId.trim());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '';
      if (errorMessage.includes('Session not found')) {
        setShowSessionNotFoundModal(true);
      } else {
        setError('Failed to join session');
      }
    }
  };

  const handleRejoin = async (session: SessionSummary) => {
    setError('');
    try {
      await rejoinSession(session.sessionId);
    } catch {
      setError('Failed to rejoin session');
    }
  };

  const handleLogout = async () => {
    try { await logout(); } catch {}
  };

  const formatTime = (ts: number) => {
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24) return `${hrs}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString();
  };

  const displayError = error || connectionError;
  const userName = user?.displayName || user?.email?.split('@')[0] || 'User';
  const initials = userName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen overflow-y-auto bg-[#0a0a0f] p-4">
      <div className="relative z-10 mx-auto w-full max-w-[410px] py-6">

        {/* Branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center mb-5">
            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
              <Terminal className="h-8 w-8 text-white/80" />
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-wider text-white">
            CODEFORGE
          </h1>
          <p className="text-xs text-white/30 mt-2 font-medium tracking-widest uppercase">
            Collaborative IDE
          </p>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
          <div className="p-5">

            {/* User greeting */}
            {mode === 'select' && (
              <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/5 border border-white/10">
                <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{userName}</p>
                  <p className="text-xs text-white/40 truncate">{user?.email}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-emerald-400 font-medium">Online</span>
                </div>
              </div>
            )}

            {/* Back button */}
            {mode !== 'select' && (
              <button
                onClick={() => { setMode('select'); setError(''); }}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors group"
              >
                <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
                Back
              </button>
            )}

            {/* ── SELECT MODE ── */}
            {mode === 'select' && (
              <div className="space-y-3">

                {/* Recent sessions */}
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Recent Sessions
                  </h3>
                  <button
                    onClick={refreshMySessions}
                    disabled={isLoadingSessions}
                    className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/50 transition-colors disabled:opacity-40 font-medium"
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoadingSessions ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {isLoadingSessions ? (
                  <div className="space-y-1.5">
                    {[1, 2].map(i => (
                      <div key={i} className="h-[52px] rounded-xl bg-white/5 border border-white/5" />
                    ))}
                  </div>
                ) : mySessions.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <FolderOpen className="h-4 w-4 text-white/20" />
                    </div>
                    <p className="text-xs text-white/30 font-medium">No recent sessions</p>
                  </div>
                ) : (
                  <ScrollArea className="max-h-44">
                    <div className="space-y-1 pr-1">
                      {mySessions.map(session => (
                        <button
                          key={session.sessionId}
                          onClick={() => handleRejoin(session)}
                          disabled={isConnecting}
                          className="w-full p-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left group disabled:opacity-50"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="font-semibold text-sm truncate text-white">{session.name}</span>
                                {session.isHost && (
                                  <span className="flex items-center gap-0.5 text-[9px] bg-white/10 text-white/60 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                                    <Crown className="h-2 w-2" />
                                    Host
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-white/40">
                                <span className="flex items-center gap-0.5">
                                  <Users className="h-2.5 w-2.5" />
                                  {session.participantCount}
                                </span>
                                <span>{formatTime(session.createdAt)}</span>
                                <span className="font-mono text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-white/30">
                                  {session.sessionId}
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="h-3.5 w-3.5 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all shrink-0" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-[11px] text-white/30 font-medium">or start new</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                {/* Action buttons */}
                <Button
                  size="lg"
                  className="w-full h-11 bg-white text-black hover:bg-white/90 font-semibold transition-colors group"
                  onClick={() => setMode('create')}
                >
                  <Plus className="h-4 w-4 mr-2 group-hover:rotate-90 transition-transform duration-200" />
                  New Session
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  className="w-full h-11 border-white/10 bg-white/5 hover:bg-white/10 text-white/80 font-medium transition-colors"
                  onClick={() => setMode('join')}
                >
                  <Terminal className="h-4 w-4 mr-2 text-white/40" />
                  Join With Code
                </Button>

                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-1.5 text-[11px] text-white/30 hover:text-white/50 transition-colors py-1 font-medium"
                >
                  <LogOut className="h-3 w-3" />
                  Sign out
                </button>
              </div>
            )}

            {/* ── CREATE MODE ── */}
            {mode === 'create' && (
              <form onSubmit={handleCreate} className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold mb-0.5 text-white">New Session</h2>
                  <p className="text-[13px] text-white/40">Start a collaborative coding session</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sessionName" className="text-sm font-medium text-white/80">Session Name</Label>
                  <Input
                    id="sessionName"
                    placeholder="e.g. Team Sprint, Interview, Study Group…"
                    value={sessionName}
                    onChange={(e) => setSessionName(e.target.value)}
                    required
                    autoFocus
                    className="h-11 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-white/20 focus:ring-0"
                  />
                  <p className="text-[11px] text-white/30">Give it a descriptive name</p>
                </div>

                {displayError && (
                  <div className="p-3 rounded-lg bg-destructive/8 border border-destructive/20 text-destructive text-sm">
                    {displayError}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11 bg-white text-black hover:bg-white/90 font-semibold transition-colors"
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…</>
                  ) : (
                    <><Plus className="mr-2 h-4 w-4" /> Create Session</>
                  )}
                </Button>
              </form>
            )}

            {/* ── JOIN MODE ── */}
            {mode === 'join' && (
              <form onSubmit={handleJoin} className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold mb-0.5">Join Session</h2>
                  <p className="text-[13px] text-muted-foreground/70">Enter the code shared by the session host</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sessionId" className="text-sm font-medium text-white/80">Session Code</Label>
                  <Input
                    id="sessionId"
                    placeholder="ABC12345"
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value.toUpperCase())}
                    required
                    autoFocus
                    maxLength={12}
                    className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-white/20 focus:ring-0 font-mono tracking-[0.25em] text-center text-lg uppercase"
                  />
                  <p className="text-[11px] text-white/30 text-center">8-character code from the session host</p>
                </div>

                {displayError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {displayError}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11 bg-white text-black hover:bg-white/90 font-semibold transition-colors"
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Joining…</>
                  ) : (
                    <><LogIn className="mr-2 h-4 w-4" /> Join Session</>
                  )}
                </Button>
              </form>
            )}

          </div>
        </div>

        {/* Session Not Found Modal */}
        {showSessionNotFoundModal && (
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
                  background: 'radial-gradient(circle, rgba(234,179,8,0.12) 0%, rgba(234,179,8,0.05) 50%, transparent 70%)',
                  animation: 'float-slow 28s ease-in-out infinite',
                }}
              />
            </div>

            {/* Modal content */}
            <div
              className="relative bg-white/5 border border-white/20 rounded-lg backdrop-blur-xl pointer-events-auto"
              style={{
                width: '420px',
                padding: '32px',
                background: 'linear-gradient(135deg, rgba(15,30,58,0.8) 0%, rgba(3,6,15,0.9) 100%)',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
              }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-red-500/20 rounded-full blur-md" />
                  <AlertTriangle className="w-6 h-6 text-red-400 relative z-10" />
                </div>
                <h3 className="text-lg font-bold text-white tracking-wide" style={{ fontFamily: 'Outfit, sans-serif' }}>
                  Session Not Found
                </h3>
              </div>

              {/* Message */}
              <div className="mb-8 space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  The session code "<strong className="text-white">{sessionId}</strong>" doesn't exist or has expired. Please double-check the code and try again.
                </p>
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-200">
                    💡 <strong>Tip:</strong> Session codes are case-sensitive and 8 characters long (e.g., ABC123XY).
                  </p>
                </div>
              </div>

              {/* Action button */}
              <button
                onClick={() => {
                  setShowSessionNotFoundModal(false);
                  setSessionId(''); // Clear the invalid session ID
                }}
                className="w-full h-11 bg-white/10 hover:bg-white/15 border border-white/20 rounded-lg text-white font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2"
                style={{ fontFamily: 'DM Sans, sans-serif' }}
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
