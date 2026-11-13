import React from 'react';
import { flushSync } from 'react-dom';
import { Moon, Sun } from 'lucide-react';
import { prefersReducedMotion } from '../motion/useInView';
import { setTheme, useTheme } from './theme';

/**
 * The light/dark switch. Each place it sits in styles it through className.
 *
 * The new theme opens out from the button in a growing circle (a view
 * transition; see index.css). Browsers without view transitions, and
 * visitors who asked for reduced motion, get the plain switch.
 */
export default function ThemeToggle({ className, size = 18 }) {
  const dark = useTheme() === 'dark';
  const Icon = dark ? Sun : Moon;

  const flip = (event) => {
    const next = dark ? 'light' : 'dark';
    if (!document.startViewTransition || prefersReducedMotion()) {
      setTheme(next);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    // Far enough to reach the corner of the screen furthest from the button.
    const reach = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => flushSync(() => setTheme(next)));
    // While it runs, clicks land on the page as a whole, not on this button:
    // a quick second click would select text and images as a double-click
    // does, and tint them with the selection colour.
    const noSelection = (e) => e.preventDefault();
    document.addEventListener('selectstart', noSelection);
    transition.finished.finally(() => document.removeEventListener('selectstart', noSelection));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => { /* the transition was skipped: the theme has still changed */ });
  };

  return (
    <button
      type="button"
      className={className}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      // Quick repeated clicks would otherwise select the page content after
      // the button, as a double-click does.
      onMouseDown={(event) => { if (event.detail > 1) event.preventDefault(); }}
      onClick={flip}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}
