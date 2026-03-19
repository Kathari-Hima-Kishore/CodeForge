'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { BACKEND_URL } from '@/lib/firebase';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Monitor, Apple, Terminal, Copy, Check, ShieldAlert, RefreshCw, XCircle } from 'lucide-react';

interface LangEntry { name: string; installed: boolean; }
interface SupportResponse { platform: string; languages: Record<string, LangEntry>; }
type PlatformKey = 'windows' | 'mac' | 'linux';

interface Step {
  label: string;
  cmd: string;
  note?: string;
  requiresAdmin?: boolean;
}

interface InstallInfo {
  steps: Step[];
}

const PLATFORM_LABELS: Record<string, { key: PlatformKey; label: string }> = {
  win32:  { key: 'windows', label: 'Windows' },
  darwin: { key: 'mac',     label: 'macOS'   },
  linux:  { key: 'linux',   label: 'Linux'   },
};

const INSTRUCTIONS: Record<string, Record<PlatformKey, InstallInfo>> = {
  python: {
    windows: { steps: [
      { label: 'Install Python 3', cmd: 'winget install -e --id Python.Python.3.12 --scope machine', note: 'Automatically adds python to PATH', requiresAdmin: true },
    ]},
    mac:  { steps: [{ label: 'Install Python 3', cmd: 'brew install python3' }] },
    linux: { steps: [{ label: 'Install Python 3', cmd: 'sudo apt install -y python3 python3-pip' }] },
  },
  javascript: {
    windows: { steps: [
      { label: 'Install Node.js + npm', cmd: 'winget install -e --id OpenJS.NodeJS.LTS --scope machine', note: 'Adds node and npm to PATH', requiresAdmin: true },
    ]},
    mac:  { steps: [{ label: 'Install Node.js', cmd: 'brew install node' }] },
    linux: { steps: [{ label: 'Install Node.js', cmd: 'sudo apt install -y nodejs npm' }] },
  },
  typescript: {
    windows: { steps: [
      { label: 'Install ts-node globally', cmd: 'npm install -g typescript ts-node', note: 'Requires Node.js to be installed first' },
    ]},
    mac:  { steps: [{ label: 'Install ts-node', cmd: 'npm install -g typescript ts-node' }] },
    linux: { steps: [{ label: 'Install ts-node', cmd: 'sudo npm install -g typescript ts-node' }] },
  },
  java: {
    windows: { steps: [
      { label: 'Install Java Runtime (JRE)', cmd: 'winget install -e --id EclipseAdoptium.Temurin.21.JRE --scope machine', note: 'Sets JAVA_HOME and adds java to PATH', requiresAdmin: true },
    ]},
    mac:  { steps: [{ label: 'Install Java', cmd: 'brew install --cask temurin' }] },
    linux: { steps: [{ label: 'Install Java', cmd: 'sudo apt install -y openjdk-17-jre' }] },
  },
  'java-compiler': {
    windows: { steps: [
      { label: 'Install Java JDK (includes javac)', cmd: 'winget install -e --id EclipseAdoptium.Temurin.21.JDK --scope machine', note: 'Installs javac compiler + java runtime', requiresAdmin: true },
    ]},
    mac:  { steps: [{ label: 'Install JDK', cmd: 'brew install openjdk && sudo ln -sfn $(brew --prefix)/opt/openjdk/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk.jdk' }] },
    linux: { steps: [{ label: 'Install JDK', cmd: 'sudo apt install -y openjdk-17-jdk' }] },
  },
  cpp: {
    windows: { steps: [
      { label: 'Step 1 — Install MSYS2 (includes g++/gcc)', cmd: 'winget install -e --id MSYS2.MSYS2 --scope machine', requiresAdmin: true },
      { label: 'Step 2 — Install GCC toolchain inside MSYS2', cmd: 'C:\\msys64\\usr\\bin\\bash.exe -lc "pacman --noconfirm -S mingw-w64-ucrt-x86_64-gcc"' },
      { label: 'Step 3 — Add compiler to PATH (run as Admin)', cmd: 'setx /M PATH "%PATH%;C:\\msys64\\ucrt64\\bin"', note: 'Adds gcc.exe and g++.exe to system PATH', requiresAdmin: true },
    ]},
    mac:  { steps: [{ label: 'Install Xcode tools (includes g++)', cmd: 'xcode-select --install' }] },
    linux: { steps: [{ label: 'Install build-essential', cmd: 'sudo apt install -y build-essential g++' }] },
  },
  c: {
    windows: { steps: [
      { label: 'Step 1 — Install MSYS2 (includes gcc)', cmd: 'winget install -e --id MSYS2.MSYS2 --scope machine', requiresAdmin: true },
      { label: 'Step 2 — Install GCC toolchain inside MSYS2', cmd: 'C:\\msys64\\usr\\bin\\bash.exe -lc "pacman --noconfirm -S mingw-w64-ucrt-x86_64-gcc"' },
      { label: 'Step 3 — Add compiler to PATH (run as Admin)', cmd: 'setx /M PATH "%PATH%;C:\\msys64\\ucrt64\\bin"', note: 'Adds gcc.exe to system PATH', requiresAdmin: true },
    ]},
    mac:  { steps: [{ label: 'Install Xcode tools (includes gcc)', cmd: 'xcode-select --install' }] },
    linux: { steps: [{ label: 'Install GCC', cmd: 'sudo apt install -y build-essential gcc' }] },
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={copy}
      className="shrink-0 p-1 rounded text-muted-foreground/50 hover:text-white hover:bg-white/10 transition-colors"
      title="Copy command"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === 'win32')  return <Monitor  className="h-4 w-4 text-blue-400" />;
  if (platform === 'darwin') return <Apple    className="h-4 w-4 text-white/60" />;
  return                            <Terminal className="h-4 w-4 text-orange-400" />;
}

export function LanguageSupportChecker() {
  const [open, setOpen]       = useState(false);
  const [data, setData]       = useState<SupportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const retryRef              = useRef(0);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`${BACKEND_URL}/api/check-language-support`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const json: SupportResponse = await res.json();
      setData(json);
      retryRef.current = 0;

      // Always open the dialog — show both installed and missing
      setOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Check failed';
      setError(msg);
      retryRef.current++;

      // Auto-retry up to 3 times with delay
      if (retryRef.current <= 3) {
        setTimeout(() => runCheck(), 2000 * retryRef.current);
      } else {
        // After 3 failures, show error dialog
        setOpen(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Delay 1s to give backend time to start
    const timer = setTimeout(() => runCheck(), 1000);
    return () => clearTimeout(timer);
  }, [runCheck]);

  const missing   = data ? Object.entries(data.languages).filter(([, v]) => !v.installed) : [];
  const installed = data ? Object.entries(data.languages).filter(([, v]) =>  v.installed) : [];
  const platformInfo = data
    ? (PLATFORM_LABELS[data.platform] ?? { key: 'linux' as PlatformKey, label: data.platform })
    : { key: 'linux' as PlatformKey, label: 'Unknown' };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-border/30 shrink-0">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {error ? (
                <XCircle className="h-5 w-5 text-red-400 shrink-0" />
              ) : missing.length > 0 ? (
                <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
              )}
              <DialogTitle className="text-base">
                {error ? 'Language Check Failed' : missing.length > 0 ? 'Language Support' : 'All Languages Ready'}
              </DialogTitle>
            </div>
            <DialogDescription className="flex items-center gap-1.5 mt-1 text-[13px]">
              {!error && data && (
                <>
                  <PlatformIcon platform={data.platform} />
                  <span>
                    Detected OS: <span className="font-semibold text-foreground">{platformInfo.label}</span>
                  </span>
                  <span className="mx-1 text-border">·</span>
                  <span>{missing.length} missing, {installed.length} installed</span>
                </>
              )}
              {error && (
                <span className="text-red-400/80">Could not reach backend at {BACKEND_URL}</span>
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* Error state */}
          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 space-y-3">
              <p className="text-sm text-red-300">{error}</p>
              <p className="text-xs text-muted-foreground">
                Make sure the backend server is running on <code className="bg-black/30 px-1 rounded">{BACKEND_URL}</code>
              </p>
              <Button variant="outline" size="sm" onClick={runCheck}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Retry
              </Button>
            </div>
          )}

          {/* Missing languages */}
          {missing.map(([key, value]) => {
            const info = INSTRUCTIONS[key]?.[platformInfo.key];
            return (
              <div key={key} className="rounded-lg border border-yellow-500/25 bg-yellow-500/5 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-yellow-500/15">
                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                  <span className="font-semibold text-sm">{value.name}</span>
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-mono">
                    Not found
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {info ? info.steps.map((step, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                        {info.steps.length > 1 && <span className="font-mono">{step.label}</span>}
                        {info.steps.length === 1 && step.note && <span>{step.note}</span>}
                        {step.requiresAdmin && (
                          <span className="flex items-center gap-0.5 text-orange-400/80">
                            <ShieldAlert className="h-3 w-3" /> Run as Admin
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 rounded bg-black/50 border border-white/5 px-3 py-2">
                        <code className="flex-1 font-mono text-[11px] text-emerald-400 break-all leading-relaxed select-all">
                          {step.cmd}
                        </code>
                        <CopyButton text={step.cmd} />
                      </div>
                      {info.steps.length > 1 && step.note && (
                        <p className="text-[10px] text-muted-foreground/50 pl-1">{step.note}</p>
                      )}
                    </div>
                  )) : (
                    <p className="text-xs text-muted-foreground">No install instructions available. Check the official documentation.</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Installed */}
          {installed.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground/50 font-semibold uppercase tracking-wider">
                Installed
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {installed.map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="text-xs text-emerald-400 truncate">{value.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border/30 bg-secondary/10 shrink-0">
          <p className="text-[11px] text-muted-foreground">
            {error ? 'Check your terminal for backend output.' : 'Restart the backend after installing tools.'}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={runCheck}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Re-check
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Dismiss
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
