export type PerformanceTier = 'high' | 'medium' | 'low';

export function getPerformanceTier(): PerformanceTier {
  if (typeof window === 'undefined') return 'high';

  // Immediately degrade on mobile / small screens — no point loading Spline
  if (window.innerWidth < 1024) return 'low';

  // Honour reduced-motion preference
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low';

  // Check WebGL availability
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    if (!gl) return 'low';
  } catch {
    return 'low';
  }

  // CPU / memory signals
  const cores = navigator.hardwareConcurrency ?? 2;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;

  if (cores <= 2 || memory <= 2) return 'low';
  if (cores <= 4 || memory <= 4) return 'medium';
  return 'high';
}
