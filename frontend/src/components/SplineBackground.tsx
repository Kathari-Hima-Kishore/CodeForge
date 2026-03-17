'use client';

// §3.8 — Suppress harmless Spline OpenType warning
if (typeof window !== 'undefined') {
  const _warn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Unsupported OpenType')) return;
    _warn(...args);
  };
}

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Spline from '@splinetool/react-spline';
import type { Application } from '@splinetool/runtime';
import gsap from 'gsap';
import { getPerformanceTier, type PerformanceTier } from '@/lib/performance';

interface Props {
  onLoad?: () => void;
  /** CSS transform scale factor (default: 0.55 to fit typical containers) */
  scale?: number;
}

const SplineBackground = memo(function SplineBackground({ onLoad, scale = 0.55 }: Props) {
  // §3.3 — Read tier once, never re-evaluate
  const [tier] = useState<PerformanceTier>(() => getPerformanceTier());

  // §3.1 — 2-second gate hides WebGL bootstrap spike
  const [gateOpen, setGateOpen] = useState(false);
  const [splineReady, setSplineReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setGateOpen(true), 2000);
    return () => clearTimeout(t);
  }, []);

  // §3.5 — GSAP reveal + cleanup
  useEffect(() => {
    if (!gateOpen || !splineReady || !containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.killTweensOf(containerRef.current!);
      gsap.to(containerRef.current!, {
        opacity: 1,
        duration: 0.9,
        ease: 'power2.out',
      });
    }, containerRef);

    return () => ctx.revert();
  }, [gateOpen, splineReady]);

  const handleLoad = useCallback(
    (app: Application) => {
      // §3.3 — Cap pixel ratio for smaller canvas (faster rendering)
      try {
        const renderer = (
          app as unknown as { _renderer?: { setPixelRatio: (v: number) => void } }
        )._renderer;
        if (tier === 'medium') {
          renderer?.setPixelRatio(1);
        } else {
          renderer?.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        }
      } catch { /* ignore */ }

      setSplineReady(true);
      onLoad?.();
    },
    [tier, onLoad],
  );

  // §3.3 — Low-tier devices skip Spline entirely
  if (tier === 'low') return null;

  // Mouse events ARE allowed (no pointer-events-none)
  // Render at large size, then scale down - no clipping container
  return (
    <div
      ref={containerRef}
      style={{
        width: '1200px',
        height: '1000px',
        transform: `scale(${scale})`,
        transformOrigin: 'left center',
        opacity: 0,
      }}
    >
      <Spline
        scene="/pc.spline"
        onLoad={handleLoad}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
});

export default SplineBackground;
