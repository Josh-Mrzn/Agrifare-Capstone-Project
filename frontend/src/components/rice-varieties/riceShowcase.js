/**
 * Draws a mound of rice grains on a turntable, with Canvas 2D only.
 *
 * Each grain is a pre-shaded sprite: shaded per pixel once, for 16 angles and
 * 3 brightness levels, then stamped with a transform every frame. The mound is
 * laid out from a seeded random generator, so it is the same on every load.
 * Between two varieties the grains of one fly over and become the next.
 *
 *   const show = createRiceShowcase(canvas, varieties);
 *   show.resize(cssWidth, cssHeight);
 *   show.draw({ idx, t, th, time });   // th in degrees, t in 0..1, time in s
 */

// Art space, scaled to fit the canvas.
const ART_W = 360;
const ART_H = 480;
const CX = 180;
const BASE = 380;
const R = 148;
const H = 150;

const PITCH = (24 * Math.PI) / 180;
const CP = Math.cos(PITCH);
const SP = Math.sin(PITCH);
const TAU = Math.PI * 2;

const BUCKETS = 16;
const LEVELS = [0.66, 0.83, 1.0];
const SMALL_LEN = 56;
const LARGE_LEN = 220;
const STRAYS = 46;
const HEROES = 7;
const SPREAD = 0.42;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x) => x * x * (3 - 2 * x);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2);

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

const LIGHT_WORLD = norm3(-0.45, 0.78, 0.5);
// Screen space, y pointing down: light from the upper left, toward the viewer.
const KEY_LIGHT = norm3(-0.52, -0.62, 0.59);

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function xorshift(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A portable blur: shrink by each factor in turn, then scale back up. */
function soften(src, factors) {
  let cur = src;
  for (const f of factors) {
    const next = makeCanvas(cur.width / f, cur.height / f);
    const nctx = next.getContext('2d');
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const out = makeCanvas(src.width, src.height);
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

function valueNoise(seed) {
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/* ── Layout ── */

function buildLayout(variety, count) {
  const rand = xorshift(fnv1a(variety.id));
  const altShare = variety.altPalette ? variety.altShare || 0 : 0;
  const grains = [];

  const pickPalette = () => (rand() < altShare ? 1 : 0);
  const pickJit = () => (rand() < 0.25 ? -1 : 0);

  for (let i = 0; i < count - STRAYS; i += 1) {
    const rr = R * Math.sqrt(rand());
    const a = rand() * TAU;
    const q = rr / R;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const bump = (Math.sin(3 * a + 1.3) * 0.5 + Math.sin(5 * a + 0.4) * 0.3) * 6 * q;
    const y = Math.max(0, H * (1 - q ** 1.5) ** 1.25 + bump + (rand() - 0.5) * 5);
    const slope = (H * 1.875 * q ** 0.5 * Math.max(0.001, 1 - q ** 1.5) ** 0.25) / R;
    const [nx, ny, nz] = norm3(ux * slope, 1, uz * slope);
    const phi = rand() * TAU;
    const dx0 = Math.cos(phi);
    const dz0 = Math.sin(phi);
    const dy0 = -slope * (dx0 * ux + dz0 * uz) + (rand() - 0.5) * 0.5;
    const [dx, dy, dz] = norm3(dx0, dy0, dz0);
    let size = 0.88 + rand() * 0.24;
    if (rand() < 0.07) size *= 0.6;
    grains.push({
      x: ux * rr, y, z: uz * rr, nx, ny, nz, dx, dy, dz, size,
      pal: pickPalette(), jit: pickJit(), ao: 0.62 + 0.38 * clamp01(y / H),
    });
  }

  for (let i = 0; i < STRAYS; i += 1) {
    const rr = R * (0.98 + rand() ** 1.6 * 0.5);
    const a = rand() * TAU;
    const phi = rand() * TAU;
    let size = 0.88 + rand() * 0.24;
    if (rand() < 0.1) size *= 0.6;
    grains.push({
      x: Math.cos(a) * rr, y: 0.5, z: Math.sin(a) * rr, nx: 0, ny: 1, nz: 0,
      dx: Math.cos(phi), dy: 0, dz: Math.sin(phi), size,
      pal: pickPalette(), jit: pickJit(), ao: 0.95,
    });
  }

  // Top first: grain i of one variety flies to grain i of the next.
  grains.sort((p, q) => q.y - p.y);

  const heroes = [];
  for (let i = 0; i < HEROES; i += 1) {
    const a = (i / HEROES) * TAU + rand() * 0.5;
    const rr = R * (1.02 + rand() * 0.3);
    const y = 70 + rand() * 150;
    const phi = rand() * TAU;
    const [dx, dy, dz] = norm3(Math.cos(phi), (rand() - 0.5) * 1.2, Math.sin(phi));
    heroes.push({
      x: Math.cos(a) * rr, y, z: Math.sin(a) * rr, nx: 0, ny: 1, nz: 0, dx, dy, dz,
      size: 3.3 * (0.85 + rand() * 0.3), phase: rand() * TAU, pal: 0, jit: 0, ao: 1,
    });
  }

  return { grains, heroes };
}

/* ── Sprites ── */

function palette(p) {
  return { base: rgb(p.base), light: rgb(p.light), dark: rgb(p.dark) };
}

/** One grain, long axis horizontal, lit as if turned to `bucket`. */
function shadeGrain(spriteLen, g, pal, bucket, level, noise) {
  const L = spriteLen * g.len;
  const W = L * g.width;
  const pad = Math.ceil(W * 0.2) + 2;
  const w = Math.ceil(L) + pad * 2;
  const h = Math.ceil(W) + pad * 2;
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cv.width, cv.height);
  const px = img.data;

  const hl = L / 2;
  const hw = W / 2;
  const T = hw * 0.95;
  const cx = cv.width / 2;
  const cy = cv.height / 2;

  // The key light, turned into the sprite's own frame.
  const ang = (bucket / BUCKETS) * TAU;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const lx = KEY_LIGHT[0] * ca + KEY_LIGHT[1] * sa;
  const ly = -KEY_LIGHT[0] * sa + KEY_LIGHT[1] * ca;
  const lz = KEY_LIGHT[2];
  const [hx, hy, hz] = norm3(lx, ly, lz + 1);

  const { base, light, dark } = pal;
  const streak = g.streak ? rgb(g.streak) : null;
  const chalk = g.chalk || 0;
  const shadowMix = g.shadowMix || 0;
  const E = 0.025;

  const heightAt = (u, v) => {
    const vv = v / (1 - 0.1 * u) + 0.05 * (1 - u * u);
    const f = 1 - (Math.abs(u) ** 2.4 + Math.abs(vv) ** 2.4);
    return f > 0 ? Math.sqrt(f) : 0;
  };

  for (let y = 0; y < cv.height; y += 1) {
    const v = (y + 0.5 - cy) / hw;
    for (let x = 0; x < cv.width; x += 1) {
      const u = (x + 0.5 - cx) / hl;
      const vv = v / (1 - 0.1 * u) + 0.05 * (1 - u * u);
      const field = 1 - (Math.abs(u) ** 2.4 + Math.abs(vv) ** 2.4);
      if (field <= -0.06) continue;

      const ht = field > 0 ? Math.sqrt(field) : 0;
      const dhu = ((heightAt(u + E, v) - heightAt(u - E, v)) * T) / (2 * E * hl);
      const dhv = ((heightAt(u, v + E) - heightAt(u, v - E)) * T) / (2 * E * hw);
      const [nx, ny, nz] = norm3(-dhu, -dhv, 1);

      const diffuse = clamp01((nx * lx + ny * ly + nz * lz + g.wrap) / (1 + g.wrap));
      const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
      const spec = ndh ** g.shine * g.gloss * 1.7;
      const sheen = ndh ** 6 * 0.12 * g.gloss;
      const fresnel = (1 - nz) ** 3 * 0.18 * level;

      const n1 = noise(u * 3.2 + 7, v * 1.2);
      const tex = 0.65 * n1 + 0.35 * noise(u * 14, v * 5);
      const tint = 0.93 + tex * 0.14;
      let r = base[0] * tint;
      let gr = base[1] * tint;
      let b = base[2] * tint;

      if (chalk) {
        const c = smoothstep(0.05, 0.85, v + (n1 - 0.5) * 0.6) * chalk * 0.6;
        r += (255 - r) * c;
        gr += (255 - gr) * c;
        b += (255 - b) * c;
      }
      if (streak) {
        const ridge = (0.5 + 0.5 * Math.sin(v * Math.PI * 3.6 + n1 * 2.2)) ** 2;
        const s = ridge * g.streakAmt;
        r += (streak[0] - r) * s;
        gr += (streak[1] - gr) * s;
        b += (streak[2] - b) * s;
      }

      const ao = 0.78 + 0.22 * Math.sqrt(ht);
      const shade = (g.amb + 0.8 * diffuse) * ao * level;
      r *= shade;
      gr *= shade;
      b *= shade;

      const toDark = (1 - diffuse) * shadowMix;
      r += (dark[0] - r) * toDark;
      gr += (dark[1] - gr) * toDark;
      b += (dark[2] - b) * toDark;

      const glow = g.trans * (1 - ht) ** 1.6 * (0.4 + 0.6 * diffuse) * 0.55 * level;
      const add = 255 * (fresnel + spec + sheen);
      r += light[0] * glow + add;
      gr += light[1] * glow + add;
      b += light[2] * glow + add;

      // The germ notch at one end.
      const germ = (u + 0.88) ** 2 * 6 + (v - 0.32) ** 2;
      if (germ < 0.09) {
        const k = 1 - 0.25 * (1 - germ / 0.09);
        r *= k;
        gr *= k;
        b *= k;
      }

      const i = (y * cv.width + x) * 4;
      px[i] = r;
      px[i + 1] = gr;
      px[i + 2] = b;
      px[i + 3] = 255 * smoothstep(-0.06, 0.03, field);
    }
  }

  ctx.putImageData(img, 0, 0);
  return cv;
}

function shadowSprite(spriteLen, g) {
  const L = spriteLen * g.len;
  const W = L * g.width;
  const pad = 0.9 * W;
  const cv = makeCanvas(L + pad * 2, W + pad * 2);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(40,28,12,1)';
  ctx.beginPath();
  ctx.ellipse(cv.width / 2, cv.height / 2, L / 2, W / 2, 0, 0, TAU);
  ctx.fill();
  const out = soften(cv, [Math.max(2, W * 0.35), 2]);

  // The blur reaches the sprite's edge on the large shadow; fade it out
  // before the edge so no straight line shows where the sprite ends.
  const octx = out.getContext('2d');
  octx.globalCompositeOperation = 'destination-in';
  octx.setTransform(out.width / 2, 0, 0, out.height / 2, out.width / 2, out.height / 2);
  const mask = octx.createRadialGradient(0, 0, 0.55, 0, 0, 1);
  mask.addColorStop(0, '#000');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  octx.fillStyle = mask;
  octx.fillRect(-1, -1, 2, 2);
  return out;
}

/**
 * A small grain with its contact shadow under it, in one sprite.
 *
 * The shadow is the shadow sprite at 0.34 alpha, offset by (0.09, 0.13) of
 * the grain's length on screen, turned into the sprite's own frame for this
 * angle bucket. One stamp per grain instead of two halves the frame's work.
 */
function withContactShadow(grain, shadow, bucket, spriteLen) {
  const ang = (bucket / BUCKETS) * TAU;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const dx = (0.09 * ca + 0.13 * sa) * spriteLen;
  const dy = (-0.09 * sa + 0.13 * ca) * spriteLen;
  const w = Math.ceil(Math.max(grain.width, shadow.width + 2 * Math.abs(dx)));
  const h = Math.ceil(Math.max(grain.height, shadow.height + 2 * Math.abs(dy)));
  const cv = makeCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.globalAlpha = 0.34;
  ctx.drawImage(shadow, (cv.width - shadow.width) / 2 + dx, (cv.height - shadow.height) / 2 + dy);
  ctx.globalAlpha = 1;
  ctx.drawImage(grain, (cv.width - grain.width) / 2, (cv.height - grain.height) / 2);
  return cv;
}

/** The mound's solid body, so no floor shows between the grains. */
function coreSprite(pal) {
  const cv = makeCanvas(ART_W, ART_H);
  const ctx = cv.getContext('2d');
  const apex = BASE - H * 0.88 * CP;
  const rise = BASE - apex;
  const rx = 0.9 * R;
  const ry = rx * SP;

  ctx.beginPath();
  ctx.moveTo(CX - rx, BASE);
  ctx.bezierCurveTo(CX - rx * 0.62, BASE - rise * 0.78, CX - rx * 0.3, apex, CX, apex);
  ctx.bezierCurveTo(CX + rx * 0.3, apex, CX + rx * 0.62, BASE - rise * 0.78, CX + rx, BASE);
  ctx.ellipse(CX, BASE, rx, ry, 0, 0, Math.PI);
  ctx.closePath();

  const shade = (c, f) => `rgb(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)})`;
  const grad = ctx.createLinearGradient(0, apex, 0, BASE + ry);
  grad.addColorStop(0, shade(pal.base, 0.7));
  grad.addColorStop(1, shade(pal.dark, 0.5));
  ctx.fillStyle = grad;
  ctx.fill();
  return soften(cv, [3]);
}

/**
 * Packs sprites into one canvas, shelf by shelf, and returns where each sits.
 * Thousands of stamps from one image batch on the GPU; from a hundred small
 * canvases they do not, and a frame costs several times as much.
 */
function packAtlas(sprites) {
  const GAP = 2;
  const WIDTH = 1024;
  let x = GAP;
  let y = GAP;
  let rowH = 0;
  const rects = sprites.map((s) => {
    if (x + s.width + GAP > WIDTH) {
      x = GAP;
      y += rowH + GAP;
      rowH = 0;
    }
    const rect = { x, y, w: s.width, h: s.height };
    x += s.width + GAP;
    rowH = Math.max(rowH, s.height);
    return rect;
  });
  const atlas = makeCanvas(WIDTH, y + rowH + GAP);
  const ctx = atlas.getContext('2d');
  sprites.forEach((s, i) => {
    ctx.drawImage(s, rects[i].x, rects[i].y);
    rects[i].src = atlas;
  });
  return rects;
}

/** Every piece of one variety, as small steps that can run in idle time. */
function buildSteps(variety, count, done) {
  const g = variety.grain;
  const pals = [palette(g)];
  if (variety.altPalette) pals.push(palette(variety.altPalette));
  const noise = valueNoise(fnv1a(`${variety.id}:grain`));
  const out = {
    small: pals.map(() => []), large: [], largeBlur: [],
  };

  const steps = [() => {
    out.layout = buildLayout(variety, count);
    out.shadowSmall = shadowSprite(SMALL_LEN, g);
    out.shadowLarge = shadowSprite(LARGE_LEN, g);
    out.core = coreSprite(pals[0]);
  }];
  pals.forEach((pal, p) => {
    LEVELS.forEach((level, l) => {
      steps.push(() => {
        for (let b = 0; b < BUCKETS; b += 1) {
          const grain = shadeGrain(SMALL_LEN, g, pal, b, level, noise);
          out.small[p][l * BUCKETS + b] = withContactShadow(grain, out.shadowSmall, b, SMALL_LEN);
        }
      });
    });
  });
  for (let b = 0; b < BUCKETS; b += 1) {
    steps.push(() => {
      out.large[b] = shadeGrain(LARGE_LEN, g, pals[0], b, 1, noise);
      out.largeBlur[b] = soften(out.large[b], [5]);
    });
  }
  steps.push(() => {
    const all = [...out.small.flat(), ...out.large, ...out.largeBlur, out.shadowSmall, out.shadowLarge];
    const rects = packAtlas(all);
    let at = 0;
    const take = (list) => list.map(() => rects[at++]);
    out.small = out.small.map(take);
    out.large = take(out.large);
    out.largeBlur = take(out.largeBlur);
    [out.shadowSmall, out.shadowLarge] = take([0, 0]);
    done(out);
  });
  return steps;
}

/* ── Renderer ── */

export function createRiceShowcase(canvas, varieties) {
  const ctx = canvas.getContext('2d');
  const count = window.innerWidth < 700 ? 1600 : 2300;
  const total = count + HEROES;

  // Fixed per index, so a grain takes the same path every time.
  const flight = [];
  for (let i = 0; i < total; i += 1) {
    const rand = xorshift(Math.imul(i + 1, 2654435761));
    rand();
    flight.push({ lift: rand(), swirl: rand(), tumble: rand() * 4 - 2 });
  }

  const built = varieties.map(() => null);
  const queues = varieties.map((v, i) => buildSteps(v, count, (out) => { built[i] = out; }));

  const ensure = (i) => {
    const queue = queues[i];
    while (!built[i] && queue.length) queue.shift()();
    return built[i];
  };

  // Everything is built a step at a time while the browser is idle, the first
  // variety first, so the page's own entrance never waits on it; a variety
  // the scroll reaches before then is built on the spot. While the section
  // is animating the browser is rarely idle, so a timed-out callback still
  // takes a short slice and the next variety is ready before it is needed.
  const idle = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 200 })
    : (cb) => window.setTimeout(() => cb({ timeRemaining: () => 8 }), 60);
  const cancelIdle = window.cancelIdleCallback
    ? (id) => window.cancelIdleCallback(id)
    : (id) => window.clearTimeout(id);
  let idleId = 0;
  const work = (deadline) => {
    idleId = 0;
    const next = queues.findIndex((q, i) => !built[i] && q.length);
    if (next < 0) return;
    const until = performance.now() + (deadline.didTimeout ? 8 : deadline.timeRemaining() - 2);
    do queues[next].shift()();
    while (queues[next].length && performance.now() < until);
    idleId = idle(work);
  };
  idleId = idle(work);

  // One item per grain; `order` keeps last frame's depth order, so each
  // frame's sort starts nearly sorted.
  const items = [];
  for (let i = 0; i < total; i += 1) items.push({});
  const order = items.slice();

  let k = 1;
  let ox = 0;
  let oy = 0;

  // A mound at rest is drawn once into `layer` and reused while only the
  // floating grains bob; it is drawn again when the turn changes.
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  let layerKey = '';

  // The art is fitted to the box (the stage); the canvas may be larger, so
  // floating grains and the floor shadow are not cut off at the stage edge.
  function resize(cssW, cssH, boxW = cssW, boxH = cssH) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    layer.width = canvas.width;
    layer.height = canvas.height;
    const fit = Math.min(boxW / ART_W, boxH / ART_H);
    k = dpr * fit;
    ox = (canvas.width - ART_W * k) / 2;
    oy = (canvas.height - ART_H * k) / 2;
    for (const c of [ctx, lctx]) {
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
    }
    layerKey = '';
  }

  /** Place one grain: from A alone, or on its way from A to B. */
  function place(item, a, b, i, hero, f) {
    const bobA = hero ? Math.sin(f.time * 1.1 + a.phase) * 6 : 0;
    let x;
    let y;
    let z;
    let dx;
    let dy;
    let dz;
    let lit = -1;
    let tumble = 0;
    let src = a;
    let set = f.A;
    let size = a.size;
    let ao = a.ao;
    let flying = false;

    if (!b) {
      ({ x, z, dx, dy, dz } = a);
      y = a.y + bobA;
    } else {
      const fl = flight[i];
      const d = hero ? 0.25 * SPREAD : (i / count) * SPREAD;
      const u = clamp01((f.t - d) / (1 - SPREAD));
      const e = easeInOutCubic(u);
      const m = Math.sin(Math.PI * u);
      const bobB = hero ? Math.sin(f.time * 1.1 + b.phase) * 6 : 0;
      x = lerp(a.x, b.x, e);
      y = lerp(a.y + bobA, b.y + bobB, e) + m * (90 + fl.lift * 150);
      z = lerp(a.z, b.z, e);
      const swirl = m * (1.1 + fl.swirl * 1.2);
      const cs = Math.cos(swirl);
      const sn = Math.sin(swirl);
      const grow = 1 + 0.25 * m;
      const xs = (x * cs - z * sn) * grow;
      z = (x * sn + z * cs) * grow;
      x = xs;
      [dx, dy, dz] = norm3(lerp(a.dx, b.dx, e), lerp(a.dy, b.dy, e), lerp(a.dz, b.dz, e));
      size = lerp(a.size, b.size, e);
      ao = lerp(a.ao, b.ao, e);
      if (u >= 0.5) {
        src = b;
        set = f.B;
      }
      if (u > 0 && u < 1) {
        flying = true;
        tumble = m * fl.tumble;
        lit = 0.6 + 0.35 * (1 - m);
      }
    }

    const { cosT, sinT } = f;
    const xr = x * cosT + z * sinT;
    const zr = -x * sinT + z * cosT;
    item.sx = CX + xr;
    item.sy = BASE - (y * CP - zr * SP);
    item.depth = zr * CP + y * SP;
    item.fx = CX + xr;
    item.fy = BASE + zr * SP;
    item.h = y;

    const dxr = dx * cosT + dz * sinT;
    const dzr = -dx * sinT + dz * cosT;
    const vy = dy * CP - dzr * SP;
    item.angle = Math.atan2(-vy, dxr) + tumble;
    item.fore = Math.max(0.3, Math.hypot(dxr, vy));

    if (lit < 0) {
      const nxr = src.nx * cosT + src.nz * sinT;
      const nzr = -src.nx * sinT + src.nz * cosT;
      lit = clamp01(nxr * LIGHT_WORLD[0] + src.ny * LIGHT_WORLD[1] + nzr * LIGHT_WORLD[2]);
    }

    item.lit = lit;
    item.ao = ao;
    item.size = size;
    item.jit = src.jit;
    item.pal = src.pal;
    item.set = set;
    item.hero = hero;
    item.flying = flying;
  }

  /** Steps 1 and 2: the floor shadow, then the body of the mound. */
  function paintFloorAndCore(c, f) {
    const air = Math.sin(Math.PI * f.t);
    c.setTransform(k, 0, 0, k * SP, ox + 8 * k, oy + k * BASE * (1 - SP) + 4 * k);
    for (const [r, a] of [[1.32 * R, 0.18], [1.02 * R, 0.34], [0.86 * R, 0.3]]) {
      const alpha = a * (1 - air * 0.75);
      const grad = c.createRadialGradient(CX, BASE, 0.2 * r, CX, BASE, r);
      grad.addColorStop(0, `rgba(52,38,16,${alpha})`);
      grad.addColorStop(1, 'rgba(52,38,16,0)');
      c.fillStyle = grad;
      c.fillRect(CX - r, BASE - r, r * 2, r * 2);
    }

    // The core fades out as the grains lift and back in as they land.
    let coreAlpha = 1;
    if (f.t > 0) coreAlpha = f.t < 0.5 ? 1 - smooth(clamp01(3 * f.t)) : smooth(clamp01((f.t - 0.88) / 0.12));
    if (coreAlpha > 0) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = coreAlpha;
      c.drawImage(f.t < 0.5 ? f.A.core : f.B.core, ox, oy, ART_W * k, ART_H * k);
      c.globalAlpha = 1;
    }
  }

  // Sprites live in an atlas; each is stamped centred on the current transform.
  const stamp = (c, r) => c.drawImage(r.src, r.x, r.y, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);

  /** Step 3: shadows under whatever is in the air. */
  function paintAirShadows(c, list) {
    for (const it of list) {
      if (!it.hero && !(it.flying && it.h > 20)) continue;
      const shadow = it.hero ? it.set.shadowLarge : it.set.shadowSmall;
      const spriteLen = it.hero ? LARGE_LEN : SMALL_LEN;
      const lift = clamp01(it.h / 240);
      const grow = 1 + 1.6 * lift;
      const len = 23 * it.size * (1 + it.depth / 800);
      const ls = ((len * it.fore) / spriteLen) * grow;
      const ws = (len / spriteLen) * grow;
      const ca = Math.cos(it.angle);
      const sa = Math.sin(it.angle);
      c.globalAlpha = (it.hero ? 0.22 : 0.12) * (1 - 0.6 * lift);
      c.setTransform(
        k * ca * ls, k * sa * ls * SP, -k * sa * ws, k * ca * ws * SP,
        ox + k * (it.fx + 10 + 26 * lift), oy + k * (it.fy + 6),
      );
      stamp(c, shadow);
    }
    c.globalAlpha = 1;
  }

  /** Step 4: the grains in the order given (farthest first). */
  function paintGrains(c, list, skipHeroes) {
    for (const it of list) {
      if (skipHeroes && it.hero) continue;
      const len = 23 * it.size * (1 + it.depth / 800);
      const spriteLen = it.hero ? LARGE_LEN : SMALL_LEN;
      const ls = (len * it.fore) / spriteLen;
      const ws = len / spriteLen;
      const ca = Math.cos(it.angle);
      const sa = Math.sin(it.angle);
      const turn = ((it.angle % TAU) + TAU) % TAU;
      const bucket = Math.round((turn / TAU) * BUCKETS) % BUCKETS;
      let sprite;
      if (it.hero) {
        // Depth of field: the nearest and farthest floating grains are soft.
        const soft = it.depth > 0.55 * R || it.depth < -0.7 * R;
        sprite = soft ? it.set.largeBlur[bucket] : it.set.large[bucket];
      } else {
        // Small sprites carry their contact shadow already.
        const level = Math.min(2, Math.max(0, Math.floor((0.3 + it.lit * 0.75) * it.ao * 3) + it.jit));
        sprite = it.set.small[it.pal][level * BUCKETS + bucket];
      }
      c.setTransform(k * ca * ls, k * sa * ls, -k * sa * ws, k * ca * ws, ox + k * it.sx, oy + k * it.sy);
      stamp(c, sprite);
    }
  }

  const heroItems = items.slice(count);

  function draw({ idx, t, th, time }) {
    const A = ensure(idx);
    const B = t > 0 ? ensure(idx + 1) : null;
    const rad = (th * Math.PI) / 180;
    const f = {
      A, B, t, time, cosT: Math.cos(rad), sinT: Math.sin(rad),
    };
    const key = t > 0 ? '' : `${idx}|${th}`;
    const still = key !== '' && key === layerKey;

    if (!still) {
      const grainsA = A.layout.grains;
      const grainsB = B ? B.layout.grains : null;
      for (let i = 0; i < count; i += 1) place(items[i], grainsA[i], grainsB && grainsB[i], i, false, f);
    }
    for (let j = 0; j < HEROES; j += 1) {
      place(heroItems[j], A.layout.heroes[j], B && B.layout.heroes[j], count + j, true, f);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Changing over: everything moves, so everything is drawn in one pass.
    if (t > 0) {
      order.sort((p, q) => p.depth - q.depth);
      paintFloorAndCore(ctx, f);
      paintAirShadows(ctx, items);
      paintGrains(ctx, order, false);
      layerKey = '';
      return;
    }

    // At rest: the mound comes from the layer, redrawn only when it turned.
    // Floating grains behind the mound go under it, the rest over it.
    if (!still) {
      order.sort((p, q) => p.depth - q.depth);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      paintFloorAndCore(lctx, f);
      paintGrains(lctx, order, true);
      layerKey = key;
    }
    heroItems.sort((p, q) => p.depth - q.depth);
    const back = heroItems.filter((it) => it.depth < 0);
    const front = heroItems.filter((it) => it.depth >= 0);
    paintAirShadows(ctx, back);
    paintGrains(ctx, back, false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    paintAirShadows(ctx, front);
    paintGrains(ctx, front, false);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function destroy() {
    if (idleId) cancelIdle(idleId);
    idleId = 0;
  }

  return { resize, draw, destroy };
}
