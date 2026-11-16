// Scroll-spy for a page's section nav: the active section is the one under a reading line at 25% of
// the viewport (IntersectionObserver on a thin band; in the gap between two sections the previous one
// stays); at the top of the page the first, at the bottom the last. go(id) scrolls there smoothly
// and puts #id in the URL.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useScrollSpy(ids: readonly string[], ready = true): { active: string; go: (id: string) => void } {
  const [active, setActive] = useState(ids[0] ?? '');
  // while a click's smooth scroll runs, the clicked section stays active
  const pinned = useRef<{ id: string; until: number } | null>(null);
  const key = ids.join('|');

  useEffect(() => {
    if (!ready || typeof IntersectionObserver === 'undefined') return;
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    if (!els.length) return;
    const inBand = new Set<string>();
    const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const pick = () => {
      const pin = pinned.current;
      if (pin && Date.now() < pin.until) { setActive(pin.id); return; }
      pinned.current = null;
      if (atBottom()) { setActive(els[els.length - 1].id); return; }
      if (window.scrollY < 4) { setActive(els[0].id); return; }
      const first = els.find((e) => inBand.has(e.id));
      if (first) setActive(first.id);
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? inBand.add(e.target.id) : inBand.delete(e.target.id));
      pick();
    }, { rootMargin: '-25% 0px -74% 0px', threshold: 0 });
    els.forEach((e) => io.observe(e));
    let frame = 0;
    const scroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(pick); };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { io.disconnect(); window.removeEventListener('scroll', scroll); cancelAnimationFrame(frame); };
  }, [key, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // #section in the URL on arrival
  useEffect(() => {
    if (!ready) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!ids.includes(id)) return;
    const t = window.setTimeout(() => { document.getElementById(id)?.scrollIntoView({ block: 'start' }); setActive(id); }, 50);
    return () => window.clearTimeout(t);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    pinned.current = { id, until: Date.now() + 900 };
    setActive(id);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`); } catch { /* ignore */ }
  }, []);

  return { active, go };
}
