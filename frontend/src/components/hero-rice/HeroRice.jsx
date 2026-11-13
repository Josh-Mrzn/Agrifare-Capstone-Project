import React, { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../motion/useInView';
import { createHeroRice, LOOP } from './heroRiceLoop';
import './HeroRice.css';

// How much of the image's height the soft edge of the wipe covers, in percent.
const FEATHER = 24;

/**
 * The hero's stalk image, with a canvas over it on which the palay grains
 * fall from the panicles, are milled into bigas on the way down, pile up into
 * a mound and fly back, on a loop.
 *
 * The image (passed as the child) stays in the page as it is: it is the
 * largest paint, and what shows with reduced motion. The canvas shares its
 * wrapper, so anything that moves the wrapper moves both together.
 *
 * `floorRef` points at the floor shadow the mound rests on, a sibling of
 * this wrapper. The loop starts once the Reveal around it has finished and
 * the image has loaded, and sleeps while the hero is off screen or the tab
 * is hidden.
 */
export default function HeroRice({ className, floorRef, children }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const glowRef = useRef(null);
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (reduced) return undefined;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const floor = floorRef.current;
    const glow = glowRef.current;
    const img = wrap.querySelector('img');
    const reveal = wrap.closest('.af-reveal');
    const show = createHeroRice(canvas, window.innerWidth < 900 ? 1100 : 1900);

    let raf = 0;
    let started = false;
    let onScreen = false;
    let clock = 0;
    let lastFrame = 0;
    let shown = { opacity: 1, wipe: 0, sink: 0, glow: 0 };

    // Layout boxes, not transformed ones: the float and the scroll drift move
    // the whole visual, never its parts against each other.
    const fit = () => {
      const cx = canvas.offsetLeft;
      const cy = canvas.offsetTop;
      show.resize({
        width: canvas.offsetWidth,
        height: canvas.offsetHeight,
        imgX: img.offsetLeft - cx,
        imgY: img.offsetTop - cy,
        imgW: img.offsetWidth,
        floorX: floor.offsetLeft - wrap.offsetLeft + floor.offsetWidth / 2 - cx,
        floorY: floor.offsetTop - wrap.offsetTop + floor.offsetHeight / 2 - cy,
      });
      if (started) show.draw(clock);
    };

    function frame(now) {
      raf = window.requestAnimationFrame(frame);
      // After a pause the loop carries on where it was, not where it would be.
      const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      clock = (clock + dt) % LOOP;
      const stalk = show.draw(clock);
      if (stalk.opacity !== shown.opacity || stalk.wipe !== shown.wipe || stalk.sink !== shown.sink
        || stalk.glow !== shown.glow) {
        shown = stalk;
        img.style.opacity = stalk.opacity < 1 ? String(stalk.opacity) : '';
        img.style.transform = stalk.sink > 0
          ? `translateY(${3 * stalk.sink}%) scale(${1 - 0.05 * stalk.sink})` : '';
        // Wiped away from the top down, with a soft edge.
        const edge = stalk.wipe * (100 + FEATHER) - FEATHER;
        const mask = stalk.wipe > 0
          ? `linear-gradient(to bottom, transparent ${edge}%, #000 ${edge + FEATHER}%)` : '';
        img.style.maskImage = mask;
        img.style.webkitMaskImage = mask;
        glow.style.opacity = String(stalk.glow);
      }
    }

    const update = () => {
      const run = started && onScreen && !document.hidden;
      if (run && !raf) {
        lastFrame = 0;
        raf = window.requestAnimationFrame(frame);
      } else if (!run && raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const tryStart = () => {
      if (started || (reveal && !reveal.hasAttribute('data-af-done'))) return;
      if (!img.complete || !img.naturalWidth) return;
      started = true;
      update();
    };
    const revealDone = new MutationObserver(tryStart);
    if (reveal) revealDone.observe(reveal, { attributes: true, attributeFilter: ['data-af-done'] });
    img.addEventListener('load', tryStart);

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(wrap);
    resizeObserver.observe(floor);

    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      update();
    });
    visibility.observe(wrap);
    document.addEventListener('visibilitychange', update);

    fit();
    tryStart();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      revealDone.disconnect();
      resizeObserver.disconnect();
      visibility.disconnect();
      img.removeEventListener('load', tryStart);
      document.removeEventListener('visibilitychange', update);
      img.style.opacity = '';
      img.style.transform = '';
      img.style.maskImage = '';
      img.style.webkitMaskImage = '';
      show.destroy();
    };
  }, [reduced, floorRef]);

  return (
    <div ref={wrapRef} className={`hero-rice ${className || ''}`}>
      {!reduced && <span ref={glowRef} className="hero-rice-glow" aria-hidden="true" />}
      {children}
      {!reduced && <canvas ref={canvasRef} className="hero-rice-canvas" aria-hidden="true" />}
    </div>
  );
}
