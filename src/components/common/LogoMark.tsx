import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';

type Tone = 'opaque' | 'dark' | 'light';
const cache = new Map<string, Tone>();

/** Looks at the logo's own pixels once: solid picture, mostly dark artwork, or mostly light (white) artwork. */
function useLogoTone(src: string): Tone | null {
  const [tone, setTone] = useState<Tone | null>(() => cache.get(src) ?? null);
  useEffect(() => {
    if (cache.has(src)) { setTone(cache.get(src)!); return; }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      try {
        const S = 40;
        const c = document.createElement('canvas'); c.width = c.height = S;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, S, S);
        const d = g.getImageData(0, 0, S, S).data;
        let seen = 0, lum = 0, clear = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 40) { clear++; continue; }
          seen++; lum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        }
        const t: Tone = clear / (S * S) < 0.05 ? 'opaque' : seen === 0 ? 'opaque' : lum / seen < 0.5 ? 'dark' : 'light';
        cache.set(src, t);
        if (alive) setTone(t);
      } catch { cache.set(src, 'opaque'); if (alive) setTone('opaque'); }
    };
    img.onerror = () => { if (alive) setTone('opaque'); };
    img.src = src;
    return () => { alive = false; };
  }, [src]);
  return tone;
}

/**
 * The organisation logo, adjusted to the surface it sits on: dark artwork gets a light tile on dark surfaces,
 * light (white) artwork gets a dark tile on light surfaces, and each is shown plain where it already contrasts.
 */
export const LogoMark: React.FC<{ src: string; alt?: string; className?: string; surface?: 'auto' | 'dark' }> = ({ src, alt = '', className = 'w-10 h-10', surface = 'auto' }) => {
  const { isDarkMode } = useApp();
  const tone = useLogoTone(src);
  const onDark = surface === 'dark' || isDarkMode;
  let box = 'bg-white ring-1 ring-slate-200 dark:ring-slate-700 p-1';
  if (tone === 'dark') box = onDark ? 'bg-slate-100 ring-1 ring-white/20 p-1' : 'bg-transparent p-0.5';
  else if (tone === 'light') box = onDark ? 'bg-transparent p-0.5' : 'bg-slate-800 ring-1 ring-slate-700 p-1';
  else if (tone === 'opaque') box = 'ring-1 ring-slate-200 dark:ring-slate-700';
  return <img src={src} alt={alt} draggable={false} className={`${className} rounded-xl object-contain shrink-0 transition-colors ${box}`} />;
};
