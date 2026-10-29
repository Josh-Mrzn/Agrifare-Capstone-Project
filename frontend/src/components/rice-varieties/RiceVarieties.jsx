import React, { useEffect, useRef, useState } from 'react';
import BlurText from '../../motion/BlurText';
import Reveal from '../../motion/Reveal';
import { prefersReducedMotion } from '../../motion/useInView';
import { RICE_VARIETIES, SOLD_PER } from './riceVarieties.data';
import { createRiceShowcase } from './riceShowcase';
import { createRicePhotoShowcase } from './ricePhotoShowcase';
import './RiceVarieties.css';

/**
 * "Know your rice": a pinned section that scrolls through the varieties.
 *
 * Each variety gets 85vh of scroll. Over it the mound turns once, then its
 * grains fly over and become the next variety. Everything is driven by the
 * scroll position, so scrolling back plays it in reverse. The mound can also
 * be dragged around while it is not changing over.
 *
 * Per-frame values (the dial, the tab bars) are written straight to the DOM;
 * React only re-renders when the variety on show changes.
 */

const N = RICE_VARIETIES.length;
const U = N - 0.2;
const DIAL_C = 2 * Math.PI * 54;
const DRAG_DEG_PER_PX = 0.6;
// How quickly the shown state catches up with the scroll position (seconds).
// A wheel moves the page in steps; easing toward it turns steps into a glide.
const SCROLL_EASE = 0.22;
// How long a flicked mound keeps coasting after it is let go (seconds).
const SPIN_COAST = 0.5;

// Photos only when every variety has them; until then the grains are drawn.
const PHOTO_MODE = RICE_VARIETIES.every((v) => v.photo || (v.frames && v.frames.length));
const SINGLE_PHOTOS = PHOTO_MODE && RICE_VARIETIES.every((v) => !v.frames);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x) => x * x * (3 - 2 * x);
const mod360 = (d) => ((d % 360) + 360) % 360;
const pad2 = (n) => String(n).padStart(2, '0');

/** How far through the section the page is, 0..U. */
function scrollProgress(section) {
  const rect = section.getBoundingClientRect();
  const range = Math.max(1, rect.height - window.innerHeight);
  return clamp01(-rect.top / range) * U;
}

function stateAt(p) {
  const idx = Math.min(N - 1, Math.floor(p));
  const local = p - idx;
  // The turn takes up most of a variety's scroll and the change-over the
  // last third, long enough for the grains' flight to read as one motion.
  const spin = smooth(clamp01((local - 0.05) / 0.6)) * 360;
  const t = idx < N - 1 ? clamp01((local - 0.68) / 0.32) : 0;
  return { idx, local, spin, t, shown: t > 0.5 ? idx + 1 : idx };
}

function tabFill(j, idx, local) {
  if (j < idx) return 1;
  if (j > idx) return 0;
  return idx === N - 1 ? clamp01(local / 0.8) : local;
}

export default function RiceVarieties() {
  const sectionRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const dialRef = useRef(null);
  const dialLabelRef = useRef(null);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const dial = dialRef.current;
    const dialLabel = dialLabelRef.current;
    const tabs = Array.from(section.querySelectorAll('.rs-tab'));
    const reduced = prefersReducedMotion();

    let raf = 0;
    let visible = false;
    let progress = 0;
    let lastFrame = 0;
    // The turn added by hand, in degrees. It is kept, not sprung back, so the
    // mound can be turned as far as anyone likes; a flick keeps it coasting.
    let drag = 0;
    let velocity = 0;
    let dragging = false;
    let canDrag = false;
    let lastX = 0;
    let lastMove = 0;
    const last = {
      shown: 0, dial: '', fills: tabs.map(() => -1), locked: null, still: '',
    };

    // Photos load late; when one arrives, a still frame has to be drawn again.
    const redraw = () => {
      last.still = '';
      if (!raf) raf = window.requestAnimationFrame(frame);
    };
    const show = (PHOTO_MODE ? createRicePhotoShowcase : createRiceShowcase)(
      canvas,
      RICE_VARIETIES,
      { onChange: redraw },
    );

    const fit = () => {
      const c = canvas.getBoundingClientRect();
      const r = stage.getBoundingClientRect();
      show.resize(c.width, c.height, r.width, r.height);
      redraw();
    };

    function frame(now) {
      raf = visible ? window.requestAnimationFrame(frame) : 0;

      // Ease toward the scroll position; jump straight there on the first
      // frame after the loop was asleep, so nothing replays from a stale spot.
      const target = scrollProgress(section);
      const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = raf ? now : 0;
      if (reduced || !dt) progress = target;
      else progress += (target - progress) * (1 - Math.exp(-dt / SCROLL_EASE));
      if (Math.abs(target - progress) < 1e-4) progress = target;

      const s = stateAt(progress);
      const photo = PHOTO_MODE && !RICE_VARIETIES[s.idx].frames;

      if (!dragging && velocity !== 0) {
        drag += velocity * dt;
        velocity *= Math.exp(-dt / SPIN_COAST);
        if (Math.abs(velocity) < 2) velocity = 0;
      }

      canDrag = !reduced && !photo && s.t === 0;
      if (canDrag !== last.locked) {
        last.locked = canDrag;
        if (canDrag) delete stage.dataset.locked;
        else stage.dataset.locked = 'true';
      }

      // With reduced motion: a still mound at 20°, swapped when the variety changes.
      if (reduced) {
        const key = `${s.shown}`;
        if (key !== last.still) {
          last.still = key;
          show.draw({ idx: s.shown, t: 0, th: 20, local: 0, time: 0 });
        }
      } else {
        show.draw({ idx: s.idx, t: s.t, th: s.spin + drag, local: s.local, time: now / 1000 });
      }

      if (s.shown !== last.shown) {
        last.shown = s.shown;
        setShown(s.shown);
      }

      let fill;
      let label;
      if (photo) {
        fill = tabFill(s.idx, s.idx, s.local);
        label = pad2(s.shown + 1);
      } else {
        let deg = reduced || s.t > 0 ? 0 : mod360(s.spin + drag);
        const handTurned = mod360(drag + 0.5) > 1 || dragging || velocity !== 0;
        if (!reduced && s.t === 0 && s.spin >= 359.5 && !handTurned) deg = 360;
        fill = deg / 360;
        label = `${Math.round(deg)}°`;
      }
      const dialKey = `${label}|${fill.toFixed(3)}`;
      if (dialKey !== last.dial) {
        last.dial = dialKey;
        dial.style.strokeDashoffset = String(DIAL_C * (1 - fill));
        dial.style.strokeWidth = fill >= 1 ? '7' : '';
        dial.style.opacity = fill > 0 ? '' : '0';
        dialLabel.textContent = label;
      }

      tabs.forEach((tab, j) => {
        const f = Math.round(tabFill(j, s.idx, s.local) * 1000) / 1000;
        if (f !== last.fills[j]) {
          last.fills[j] = f;
          tab.style.setProperty('--fill', String(f));
        }
      });
    }

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(stage);
    fit();

    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !raf) raf = window.requestAnimationFrame(frame);
    }, { rootMargin: '100px 0px' });
    visibility.observe(section);

    const onDown = (e) => {
      if (!canDrag) return;
      dragging = true;
      velocity = 0;
      lastX = e.clientX;
      lastMove = e.timeStamp;
      stage.setPointerCapture(e.pointerId);
      stage.dataset.dragging = 'true';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const turn = (e.clientX - lastX) * DRAG_DEG_PER_PX;
      const ms = Math.max(1, e.timeStamp - lastMove);
      drag += turn;
      // Degrees per second, smoothed over the last few moves.
      velocity = velocity * 0.6 + ((turn / ms) * 1000) * 0.4;
      lastX = e.clientX;
      lastMove = e.timeStamp;
    };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      // Held still before letting go: no flick.
      if (e.timeStamp - lastMove > 80) velocity = 0;
      delete stage.dataset.dragging;
    };
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('lostpointercapture', onUp);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      visible = false;
      resizeObserver.disconnect();
      visibility.disconnect();
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('lostpointercapture', onUp);
      show.destroy();
    };
  }, []);

  const goTo = (j) => {
    const section = sectionRef.current;
    const rect = section.getBoundingClientRect();
    const range = rect.height - window.innerHeight;
    window.scrollTo({
      top: window.scrollY + rect.top + ((j + 0.02) / U) * range,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  };

  const current = RICE_VARIETIES[shown];

  return (
    <section
      ref={sectionRef}
      className={`rs${PHOTO_MODE ? ' rs--photo' : ''}`}
      id="varieties"
      aria-labelledby="varieties-title"
      style={{ '--rs-n': N, '--rs-glow': current.glow }}
    >
      <div className="rs-pin">
        <div className="rs-grid">
          <div className="rs-intro">
            <Reveal as="span" variant="fade" className="lp-section-badge rs-badge">Rice varieties</Reveal>
            <h2 id="varieties-title" className="lp-section-title rs-title">
              <BlurText text="Know your rice" />
              <br />
              <BlurText as="em" text="before you buy" delay={220} />
            </h2>
            <Reveal as="p" delay={450} className="rs-lede">
              {SINGLE_PHOTOS
                ? 'Scroll to see each variety up close.'
                : 'Scroll to turn each variety around, or drag it to turn it yourself.'}
            </Reveal>
            <div className="rs-dial" aria-hidden="true">
              <svg viewBox="0 0 120 120">
                <circle className="rs-dial-track" cx="60" cy="60" r="54" />
                <circle
                  ref={dialRef}
                  className="rs-dial-progress"
                  cx="60"
                  cy="60"
                  r="54"
                  strokeDasharray={DIAL_C}
                  strokeDashoffset={DIAL_C}
                />
              </svg>
              <span ref={dialLabelRef} className="rs-dial-label">{SINGLE_PHOTOS ? '01' : '0°'}</span>
            </div>
          </div>

          <div ref={stageRef} className="rs-stage">
            <div className="rs-glow" aria-hidden="true" />
            <canvas
              ref={canvasRef}
              className="rs-canvas"
              role="img"
              aria-label={PHOTO_MODE && current.imageAlt
                ? current.imageAlt
                : `A mound of ${current.label.toLowerCase()} grains`}
            />
          </div>

          <div className="rs-info">
            <div className="rs-panels">
              {RICE_VARIETIES.map((v, j) => {
                let state = 'active';
                if (j < shown) state = 'before';
                else if (j > shown) state = 'after';
                return (
                  <div
                    key={v.id}
                    id={`rs-panel-${v.id}`}
                    className="rs-panel"
                    role="tabpanel"
                    aria-labelledby={`rs-tab-${v.id}`}
                    aria-hidden={j !== shown || undefined}
                    data-state={state}
                  >
                    <p className="rs-eyebrow" style={{ '--i': 0 }}>{pad2(j + 1)} · {v.name}</p>
                    <h3 style={{ '--i': 1 }}>{v.label}</h3>
                    <p className="rs-desc" style={{ '--i': 2 }}>{v.desc}</p>
                    <ul className="rs-traits" style={{ '--i': 3 }}>
                      {v.traits.map((trait) => <li key={trait}>{trait}</li>)}
                    </ul>
                    <p className="rs-sold" style={{ '--i': 4 }}>{SOLD_PER}</p>
                  </div>
                );
              })}
            </div>

            <div className="rs-tabs" role="tablist" aria-label="Rice varieties">
              {RICE_VARIETIES.map((v, j) => (
                <button
                  key={v.id}
                  type="button"
                  id={`rs-tab-${v.id}`}
                  className="rs-tab"
                  role="tab"
                  aria-selected={j === shown}
                  aria-controls={`rs-panel-${v.id}`}
                  onClick={() => goTo(j)}
                >
                  <span className="rs-tab-bar" aria-hidden="true"><span className="rs-tab-fill" /></span>
                  {v.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
