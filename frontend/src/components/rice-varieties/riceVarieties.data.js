/**
 * The rice varieties shown on the landing page, in scroll order.
 *
 * `grain` describes how one grain is drawn: its shape (len, width, relative
 * to a sprite length), its colours (base, light, dark) and how it takes
 * light (gloss, shine, trans, wrap, amb, shadowMix, chalk, streak).
 * `altPalette` recolours a share (`altShare`) of the grains in a mound.
 *
 * Photo mode: when EVERY variety has `photo` (one image URL) or `frames`
 * (image URLs for a 360° turntable), plus `imageAlt`, the section shows the
 * photos instead of drawn grains. None do yet, so the drawn grains ship.
 */

export const SOLD_PER = 'Sold per 1, 25 or 50 kg';

export const RICE_VARIETIES = [
  {
    id: 'jasmine',
    name: 'Jasmine',
    label: 'Jasmine rice',
    glow: 'rgba(125,176,110,.40)',
    grain: {
      len: 1.14, width: 0.24, base: '#F2EDDF', light: '#FFFBEF', dark: '#B9AD92',
      gloss: 0.62, shine: 70, trans: 1, wrap: 0.65, amb: 0.44, shadowMix: 0.28, chalk: 0.25,
    },
    desc: 'Long, slender grains that cook soft and fragrant. An easy everyday pick for plain rice with ulam.',
    traits: ['Long grain', 'Fragrant', 'Soft when cooked'],
  },
  {
    id: 'dinorado',
    name: 'Dinorado',
    label: 'Dinorado rice',
    glow: 'rgba(201,162,74,.40)',
    grain: {
      len: 0.86, width: 0.33, base: '#EFE6D0', light: '#FFF8E8', dark: '#B5A27C',
      gloss: 0.5, shine: 60, trans: 0.8, wrap: 0.6, amb: 0.42, shadowMix: 0.3, chalk: 0.5,
    },
    desc: 'A Filipino favorite with a light aroma and a slightly sticky bite, often saved for special meals.',
    traits: ['Aromatic', 'Slightly sticky', 'Medium grain'],
  },
  {
    id: 'sinandomeng',
    name: 'Sinandomeng',
    label: 'Sinandomeng rice',
    glow: 'rgba(46,106,51,.24)',
    grain: {
      len: 0.96, width: 0.29, base: '#F4F2EA', light: '#FFFFFA', dark: '#BDB7A6',
      gloss: 0.45, shine: 55, trans: 0.75, wrap: 0.6, amb: 0.44, shadowMix: 0.28, chalk: 0.55,
    },
    desc: 'A dependable daily rice that cooks fluffy and holds up well for sinangag the next morning.',
    traits: ['Everyday rice', 'Fluffy', 'Good for fried rice'],
  },
  {
    id: 'red-cargo',
    name: 'Red cargo',
    label: 'Red cargo rice',
    glow: 'rgba(170,70,40,.30)',
    grain: {
      len: 0.9, width: 0.31, base: '#8C3B26', light: '#C77556', dark: '#4E1A0E',
      gloss: 0.28, shine: 34, trans: 0.25, wrap: 0.35, amb: 0.34, streak: '#C98A6E', streakAmt: 0.32,
    },
    altPalette: { base: '#A5502F', light: '#D88E68', dark: '#5E2412' },
    altShare: 0.25,
    desc: 'Unpolished red rice with the bran left on. Nutty and chewy, and it needs a little more water and time.',
    traits: ['Whole grain', 'Nutty', 'Chewier'],
  },
  {
    id: 'black',
    name: 'Black',
    label: 'Black rice',
    glow: 'rgba(95,60,120,.26)',
    grain: {
      len: 0.88, width: 0.3, base: '#2C1C28', light: '#7C5A7A', dark: '#0B0609',
      gloss: 0.55, shine: 44, trans: 0.15, wrap: 0.3, amb: 0.3, streak: '#4E3346', streakAmt: 0.35,
    },
    altPalette: { base: '#4A2620', light: '#8A5444', dark: '#1C0C08' },
    altShare: 0.14,
    desc: 'A whole grain that cooks to a deep purple, with a slightly sweet, nutty taste. Often used in kakanin and desserts.',
    traits: ['Whole grain', 'Slightly sweet', 'Deep purple'],
  },
];
