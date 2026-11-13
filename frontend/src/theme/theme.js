/*
 * Light or dark. The choice is the visitor's once they have used the toggle
 * (kept in localStorage); until then it follows the device. It is published
 * as data-theme on <html>, which index.css reads. The small script in
 * index.html sets the same attribute before the first paint.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'agrifair-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

function chosen() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

export function getTheme() {
  return chosen() || (media.matches ? 'dark' : 'light');
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener());
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  apply(theme);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The theme in use, 'light' or 'dark'; re-renders when it changes. */
export function useTheme() {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme);
}

media.addEventListener('change', () => apply(getTheme()));
apply(getTheme());
