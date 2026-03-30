'use client';

// §3.7 — Mobile and portrait gating
// Returns null while device check is in-flight (avoids flash of wrong content).
// On mobile width or portrait orientation: renders the fallback instead of children.
// On desktop landscape: renders children normally.

import { useState, useEffect, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export function MobileWarning({ children, fallback = null }: Props) {
  const [state, setState] = useState<'checking' | 'ok' | 'warn'>('checking');

  useEffect(() => {
    const check = () => {
      const isSmallScreen = window.innerWidth < 1024;
      const isPortrait = window.matchMedia('(orientation: portrait)').matches;
      setState(isSmallScreen || isPortrait ? 'warn' : 'ok');
    };

    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  if (state === 'checking') return null;
  if (state === 'warn') return <>{fallback}</>;
  return <>{children}</>;
}
