import React, { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './useInView';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Lays its content back in perspective and stands it up as it scrolls in.
 *
 * Styles are written straight to the inner element, once per frame at most,
 * and only while the stage is within 200px of the screen.
 */
export default function ScrollTilt({ from = 16, className, children }) {
  const stageRef = useRef(null);
  const innerRef = useRef(null);

  useEffect(() => {
    const stage = stageRef.current;
    const inner = innerRef.current;
    if (!stage || !inner || prefersReducedMotion()) return undefined;

    let raf = 0;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      const rect = stage.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > vh + 200) return;
      const p = clamp((vh - rect.top) / (vh * 0.7), 0, 1);
      const e = 1 - (1 - p) ** 3;
      inner.style.transform = `rotateX(${(1 - e) * from}deg) scale(${0.92 + 0.08 * e}) translateY(${(1 - e) * 48}px)`;
      inner.style.opacity = String(0.35 + 0.65 * e);
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) window.cancelAnimationFrame(raf);
      inner.style.transform = '';
      inner.style.opacity = '';
    };
  }, [from]);

  return (
    <div ref={stageRef} className={className ? `af-tilt ${className}` : 'af-tilt'}>
      <div ref={innerRef} className="af-tilt-inner">{children}</div>
    </div>
  );
}
