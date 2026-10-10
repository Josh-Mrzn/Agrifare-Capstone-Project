import { useEffect } from 'react';

/**
 * Fades .reveal elements in as they scroll into view, once each.
 *
 * One IntersectionObserver for the page rather than a scroll listener, so it
 * costs nothing while nothing is crossing the edge of the screen. Elements
 * already on screen when the page opens are revealed straight away.
 */
export default function useReveal(deps = []) {
  useEffect(() => {
    const pending = document.querySelectorAll('.reveal:not(.is-visible)');
    if (!('IntersectionObserver' in window)) {
      pending.forEach((el) => el.classList.add('is-visible'));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );

    pending.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
