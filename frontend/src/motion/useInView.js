import { useEffect, useRef, useState } from 'react';

/**
 * Reveal-once visibility for scroll motion.
 *
 * Every caller shares one IntersectionObserver, so a page full of reveals
 * costs a single observer. An element counts as seen once; it is then
 * unobserved and never hidden again.
 */

const callbacks = new Map();
let observer = null;

function sharedObserver() {
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const reveal = callbacks.get(entry.target);
          callbacks.delete(entry.target);
          observer.unobserve(entry.target);
          if (reveal) reveal();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
  }
  return observer;
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** With reduced motion, or no observer to tell, everything is in view. */
function startsInView() {
  return typeof window === 'undefined' || !('IntersectionObserver' in window) || prefersReducedMotion();
}

export default function useInView() {
  const ref = useRef(null);
  const [inView, setInView] = useState(startsInView);

  useEffect(() => {
    const el = ref.current;
    if (inView || !el) return undefined;
    const io = sharedObserver();
    callbacks.set(el, () => setInView(true));
    io.observe(el);
    return () => {
      callbacks.delete(el);
      io.unobserve(el);
    };
  }, [inView]);

  return [ref, inView];
}
