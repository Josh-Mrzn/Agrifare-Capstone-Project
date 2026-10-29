/**
 * Photo mode for the rice showcase: real photos instead of drawn grains.
 *
 * Used only when every variety has `photo` (one image) or `frames` (images
 * for a 360° turntable). Same interface as createRiceShowcase. Photos are
 * cleaned up on load so they sit on the page's cream when the canvas is
 * multiplied onto it: white-balanced to the paper, near-white lifted to pure
 * white, and the frame edge feathered out.
 *
 * Between two varieties, the first dissolves from the top down into grains
 * of light that fly over and settle into the second.
 */

import { fnv1a, xorshift } from './riceShowcase';

const PARTICLES = 3200;
const SPREAD = 0.42;
const MAX_PHOTO = 1400;
const MAX_FRAME = 1000;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x) => x * x * (3 - 2 * x);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function cleanImage(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;

  // White balance: the 70th-percentile colour of the border is the paper.
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const reds = [];
  const greens = [];
  const blues = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (x >= ring && y >= ring && x < w - ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      reds.push(px[i]);
      greens.push(px[i + 1]);
      blues.push(px[i + 2]);
    }
  }
  const p70 = (list) => {
    list.sort((a, b) => a - b);
    return Math.max(1, list[Math.floor(list.length * 0.7)] || 255);
  };
  const gain = [255 / p70(reds), 255 / p70(greens), 255 / p70(blues)];
  const edge = Math.min(w, h) * 0.05;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      let r = Math.min(255, px[i] * gain[0]);
      let g = Math.min(255, px[i + 1] * gain[1]);
      let b = Math.min(255, px[i + 2] * gain[2]);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      let white = smoothstep(0.9, 0.975, lum);
      const dist = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (dist < edge) white = Math.max(white, 1 - dist / edge);
      r += (255 - r) * white;
      g += (255 - g) * white;
      b += (255 - b) * white;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas: cv, px, w, h };
}

/** Rice pixels to fly with, top first, in the photo's own 0..1 space. */
function sampleParticles(clean, seed) {
  const rand = xorshift(seed);
  const out = [];
  for (let tries = 0; out.length < PARTICLES && tries < PARTICLES * 40; tries += 1) {
    const x = Math.floor(rand() * clean.w);
    const y = Math.floor(rand() * clean.h);
    const i = (y * clean.w + x) * 4;
    const r = clean.px[i];
    const g = clean.px[i + 1];
    const b = clean.px[i + 2];
    if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 >= 0.9) continue;
    out.push({ x: x / clean.w, y: y / clean.h, color: `rgb(${r},${g},${b})` });
  }
  out.sort((p, q) => p.y - q.y);
  return out;
}

export function createRicePhotoShowcase(canvas, varieties, { onChange } = {}) {
  const ctx = canvas.getContext('2d');
  const assets = varieties.map(() => null);
  let alive = true;

  const flight = [];
  for (let i = 0; i < PARTICLES; i += 1) {
    const rand = xorshift(Math.imul(i + 1, 2654435761));
    rand();
    flight.push({ lift: 0.1 + rand() * 0.18, side: rand() * 2 - 1 });
  }

  varieties.forEach((v, i) => {
    const sources = v.frames && v.frames.length ? v.frames : [v.photo];
    const maxSide = v.frames ? MAX_FRAME : MAX_PHOTO;
    Promise.all(sources.map(loadImage))
      .then((imgs) => {
        if (!alive) return;
        const images = imgs.map((img) => cleanImage(img, maxSide));
        assets[i] = {
          turntable: Boolean(v.frames),
          images,
          particles: sampleParticles(images[0], fnv1a(v.id)),
        };
        if (onChange) onChange();
      })
      .catch(() => {});
  });

  let dpr = 1;
  let boxW = 1;
  let boxH = 1;

  function resize(cssW, cssH, stageW = cssW, stageH = cssH) {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    boxW = stageW * dpr;
    boxH = stageH * dpr;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  /** Where a photo sits on the canvas, contained in the stage, with the push-in applied. */
  function rectFor(img, push) {
    const fit = Math.min(boxW / img.w, boxH / img.h);
    const scale = fit * (1 + 0.06 * push);
    const w = img.w * scale;
    const h = img.h * scale;
    return {
      x: (canvas.width - w) / 2,
      y: (canvas.height - h) / 2 - push * 0.12 * h,
      w,
      h,
    };
  }

  /** One variety at rest: a pushed-in photo, or the turntable frame for `th`. */
  function drawVariety(asset, th, push, alpha, clipFrom = 0) {
    const first = asset.images[0];
    const rect = rectFor(first, push);
    ctx.save();
    if (clipFrom > 0) {
      ctx.beginPath();
      ctx.rect(0, rect.y + rect.h * clipFrom, canvas.width, canvas.height);
      ctx.clip();
    }
    if (asset.turntable) {
      const count = asset.images.length;
      const f = ((((th % 360) + 360) % 360) / 360) * count;
      const i0 = Math.floor(f) % count;
      const mix = f - Math.floor(f);
      ctx.globalAlpha = alpha;
      ctx.drawImage(asset.images[i0].canvas, rect.x, rect.y, rect.w, rect.h);
      if (mix > 0) {
        ctx.globalAlpha = alpha * mix;
        ctx.drawImage(asset.images[(i0 + 1) % count].canvas, rect.x, rect.y, rect.w, rect.h);
      }
    } else {
      ctx.globalAlpha = alpha;
      ctx.drawImage(first.canvas, rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
    return rect;
  }

  function draw({ idx, t, th, local }) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const A = assets[idx];
    if (!A) return;

    if (t <= 0) {
      const push = A.turntable ? 0 : smoothstep(0, 1, local / 0.75);
      drawVariety(A, th, push, 1);
      return;
    }

    const B = assets[idx + 1];
    const clip = clamp01(t / 0.4);
    const rectA = clip < 1
      ? drawVariety(A, 0, A.turntable ? 0 : 1, 1, clip)
      : rectFor(A.images[0], A.turntable ? 0 : 1);
    if (!B) return;

    const fadeB = smoothstep(0.8, 1, t);
    const rectB = rectFor(B.images[0], 0);
    const size = Math.max(1.5, 2.2 * dpr);
    const count = Math.min(A.particles.length, B.particles.length);

    for (let i = 0; i < count; i += 1) {
      const pa = A.particles[i];
      const pb = B.particles[i];
      const d = Math.min(SPREAD, pa.y * 0.4);
      const u = clamp01((t - d) / (1 - SPREAD));
      if (u <= 0) continue;
      const e = easeInOutCubic(u);
      const m = Math.sin(Math.PI * u);
      const fl = flight[i];
      const x = lerp(rectA.x + pa.x * rectA.w, rectB.x + pb.x * rectB.w, e) + m * fl.side * 0.22 * rectA.w;
      const y = lerp(rectA.y + pa.y * rectA.h, rectB.y + pb.y * rectB.h, e) - m * fl.lift * rectA.h;
      ctx.globalAlpha = u >= 1 ? 1 - fadeB : 1;
      ctx.fillStyle = u < 0.5 ? pa.color : pb.color;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }

    if (fadeB > 0) drawVariety(B, 0, 0, fadeB);
    ctx.globalAlpha = 1;
  }

  function destroy() {
    alive = false;
  }

  return { resize, draw, destroy };
}
