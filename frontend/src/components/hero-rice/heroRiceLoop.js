/**
 * The hero's palay-to-bigas loop, drawn with Canvas 2D over the stalk image.
 *
 * Every LOOP seconds the grains come loose from the panicles of
 * rice-stalk.webp, from the top of the bundle down, a few at first and then
 * a steady fall. Each one drops under its own weight, tumbling, and is
 * milled on the way down: golden husk at the panicle, white rice by the time
 * it lands. The stalk is wiped away from the top behind the grains that have
 * left it, as if it were coming apart into them, and what is left of it
 * sinks into the mound that piles up at its foot and turns slowly. After a
 * hold it all plays back.
 *
 * As in the "Know your rice" showcase, each grain is a pre-shaded sprite:
 * shaded per pixel once, for 16 angles and 3 brightness levels, then stamped
 * with a transform every frame. The layout comes from a seeded random
 * generator, so the mound is the same on every load.
 *
 *   const show = createHeroRice(canvas, count);
 *   show.resize({ width, height, imgX, imgY, imgW, floorX, floorY });
 *   const { opacity, wipe, sink, glow } = show.draw(t);   // t in 0..LOOP s
 *
 * resize() takes CSS pixels inside the canvas: the image's top left corner
 * and width, and the centre of the floor shadow. draw() returns how the
 * stalk image and the glow behind the mound should look at that moment:
 * `wipe` is how far down the image has been wiped away (0..1) and `sink`
 * how far it has sunk toward the floor (0..1).
 */
import { fnv1a, xorshift } from '../rice-varieties/riceShowcase';

/* ── Timeline (seconds) ── */

export const LOOP = 11;
const RELEASE = 3; // the first grain comes loose
const FADE_IN = 0.15; // a grain shows on its panicle this long before it lets go
const FIRST_LAND = 3.9;
const LAST_LAND = 6.6;
const HOP = 0.3; // a landed grain's bounce
const WIPE_FROM = 3.5; // the stalk is wiped away from the top, behind the grains
const WIPE_TO = 6.5;
const REST = 6.9; // every grain is at rest
const BACK = 8.9; // the story starts to play back

/* ── The art ── */

// Width of rice-stalk.webp, in the pixels everything below is measured in.
const ART_W = 694;
// About where the mound's foot is in the art, for how long each grain falls.
const ART_FLOOR = 740;
// Seconds per √px dropped: free fall from rest.
const FALL_K = 0.045;

/**
 * The panicles of rice-stalk.webp (694 × 860), each as a centre line through
 * its grains, with how far the grains reach either side of it (hw) and how
 * long they are drawn there (len).
 */
const PANICLES = [
  // The two upright ones on the left.
  { hw: 22, len: 38, pts: [[283, 72], [262, 108], [244, 142], [229, 178], [217, 215], [209, 252], [204, 290], [203, 328]] },
  { hw: 13, len: 34, pts: [[296, 130], [283, 170], [271, 210], [261, 250], [253, 290], [248, 330]] },
  // The top one, reaching up and right.
  { hw: 16, len: 36, pts: [[322, 160], [345, 128], [372, 102], [405, 85], [440, 70], [470, 63]] },
  // The outer arch, down the right edge.
  { hw: 18, len: 40, pts: [[395, 170], [445, 165], [495, 175], [540, 200], [575, 232], [608, 258], [635, 288], [652, 322], [664, 360], [668, 400], [667, 428]] },
  // The dense cluster under it.
  { hw: 18, len: 36, pts: [[318, 252], [350, 230], [392, 215], [440, 208], [485, 212], [525, 232]] },
  // The long one that hangs down on the right (its start is behind a leaf).
  { hw: 15, len: 34, pts: [[470, 288], [515, 300], [548, 318], [573, 342], [590, 375], [603, 410], [610, 450], [610, 490], [606, 530], [601, 562]] },
  // The short one under that.
  { hw: 15, len: 32, pts: [[360, 338], [395, 334], [425, 338], [465, 350], [495, 368], [515, 392], [530, 420], [542, 452]] },
  // The low one in the middle.
  { hw: 12, len: 32, pts: [[293, 436], [302, 408], [315, 380], [333, 354]] },
];

/* ── The mound ── */

const R = 250; // radius of its foot
const H = 200; // height
const PITCH = (22 * Math.PI) / 180;
const CP = Math.cos(PITCH);
const SP = Math.sin(PITCH);
const STRAY_SHARE = 0.03; // grains on the floor around the mound
const GRAIN_LEN = 40; // a milled grain's length, at 1900 grains
const TURN_FROM = -18; // degrees the mound is turned to as the grains arrive
const TURN_RATE = 7; // and degrees per second it turns after that

/* ── Sprites ── */

const SMALL_LEN = 52;
const BUCKETS = 16;
const LEVELS = [0.66, 0.83, 1.0];

const TAU = Math.PI * 2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (x) => x * x * (3 - 2 * x);
const smoothstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
const lerp = (a, b, t) => a + (b - a) * t;

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

// Screen space, y pointing down: light from the upper left, toward the viewer.
const KEY_LIGHT = norm3(-0.52, -0.62, 0.59);
// The same light in the mound's space, y pointing up.
const LIGHT_WORLD = norm3(-0.45, 0.78, 0.5);

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Golden palay: plump, pointed, matte, with fine ridges and darker tips. */
const HUSK = {
  width: 0.44, pu: 1.8, pv: 2.2, contact: 0.12,
  base: rgb('#F2BC4B'), light: rgb('#FFF0B8'), dark: rgb('#A86A1A'),
  gloss: 0.3, shine: 24, trans: 0.3, wrap: 0.5, amb: 0.55, shadowMix: 0.18, ridge: 0.12, tip: 0.22,
};

/** Milled bigas: slimmer, rounded, glossy and a little translucent. */
const MILLED = {
  width: 0.27, pu: 2.4, pv: 2.4, contact: 0.34,
  base: rgb('#F2EDDF'), light: rgb('#FFFBEF'), dark: rgb('#B9AD92'),
  gloss: 0.62, shine: 70, trans: 1, wrap: 0.65, amb: 0.44, shadowMix: 0.28, chalk: 0.25, germ: true,
};

/** Story time: forward to REST, held, then played back to RELEASE. */
function storyAt(t) {
  if (t < BACK) return Math.min(t, REST);
  return REST - (REST - RELEASE) * smooth(clamp01((t - BACK) / (LOOP - BACK)));
}

/* ── Layout ── */

function toLine({ hw, len, pts }) {
  const segs = [];
  let length = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const dx = pts[i][0] - x0;
    const dy = pts[i][1] - y0;
    const l = Math.hypot(dx, dy);
    segs.push({ x0, y0, tx: dx / l, ty: dy / l, l });
    length += l;
  }
  return { hw, len, segs, length };
}

function pointAt(line, d) {
  let left = d;
  for (const seg of line.segs) {
    if (left <= seg.l) return { x: seg.x0 + seg.tx * left, y: seg.y0 + seg.ty * left, tx: seg.tx, ty: seg.ty };
    left -= seg.l;
  }
  const seg = line.segs[line.segs.length - 1];
  return { x: seg.x0 + seg.tx * seg.l, y: seg.y0 + seg.ty * seg.l, tx: seg.tx, ty: seg.ty };
}

function buildLayout(count) {
  const rand = xorshift(fnv1a('hero-rice'));

  // Where each grain starts: along the panicles, alternating sides of the
  // centre line, shared out by the panicles' lengths.
  const lines = PANICLES.map(toLine);
  const length = lines.reduce((sum, l) => sum + l.length, 0);
  const starts = [];
  let cum = 0;
  for (const line of lines) {
    const from = Math.round((cum / length) * count);
    cum += line.length;
    const n = Math.round((cum / length) * count) - from;
    for (let j = 0; j < n; j += 1) {
      const p = pointAt(line, ((j + rand()) / n) * line.length);
      const side = j % 2 ? 1 : -1;
      const off = side * line.hw * (0.2 + 0.7 * rand());
      starts.push({
        x0: p.x - p.ty * off,
        y0: p.y + p.tx * off,
        a0: Math.atan2(p.ty, p.tx) + side * (0.45 + 0.3 * rand()),
        len0: line.len * (0.9 + 0.2 * rand()),
        lvl0: rand() < 0.35 ? 1 : 2,
      });
    }
  }
  // From the top of the bundle down, loosely: the highest grains are the
  // first to go, so the stalk can be wiped away behind them.
  const height = starts.map((st) => st.y0 + rand() * 220);
  const topFirst = starts.map((_, i) => i).sort((p, q) => height[p] - height[q]);

  // Where each grain rests: on the mound, a few on the floor around it.
  const grains = [];
  const strays = Math.round(count * STRAY_SHARE);
  for (let i = 0; i < count - strays; i += 1) {
    const rr = R * Math.sqrt(rand());
    const a = rand() * TAU;
    const q = rr / R;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const bump = (Math.sin(3 * a + 1.3) * 0.5 + Math.sin(5 * a + 0.4) * 0.3) * 0.04 * R * q;
    const y = Math.max(0, H * (1 - q ** 1.5) ** 1.25 + bump + (rand() - 0.5) * 0.035 * R);
    const slope = (H * 1.875 * q ** 0.5 * Math.max(0.001, 1 - q ** 1.5) ** 0.25) / R;
    const [nx, ny, nz] = norm3(ux * slope, 1, uz * slope);
    const phi = rand() * TAU;
    const dx0 = Math.cos(phi);
    const dz0 = Math.sin(phi);
    const [dx, dy, dz] = norm3(dx0, -slope * (dx0 * ux + dz0 * uz) + (rand() - 0.5) * 0.5, dz0);
    let size = 0.88 + rand() * 0.24;
    if (rand() < 0.07) size *= 0.6;
    grains.push({
      x: ux * rr, y, z: uz * rr, nx, ny, nz, dx, dy, dz, size,
      jit: rand() < 0.25 ? -1 : 0, ao: 0.62 + 0.38 * clamp01(y / H),
    });
  }
  for (let i = 0; i < strays; i += 1) {
    const rr = R * (0.98 + rand() ** 1.6 * 0.3);
    const a = rand() * TAU;
    const phi = rand() * TAU;
    grains.push({
      x: Math.cos(a) * rr, y: 0.5, z: Math.sin(a) * rr, nx: 0, ny: 1, nz: 0,
      dx: Math.cos(phi), dy: 0, dz: Math.sin(phi), size: 0.88 + rand() * 0.24,
      jit: rand() < 0.25 ? -1 : 0, ao: 0.95,
    });
  }

  // The mound fills from the floor up: the lowest place is landed on first,
  // by the grain that leaves first.
  const key = grains.map((g) => g.y + rand() * 0.2 * H);
  const rank = grains.map((_, i) => i).sort((p, q) => key[p] - key[q]);
  const turn = [];
  rank.forEach((gi, i) => { turn[gi] = i; });

  grains.forEach((g, i) => {
    Object.assign(g, starts[topFirst[turn[i]]], {
      sway: (rand() - 0.5) * 0.22 * R,
      pop: (0.02 + rand() * 0.05) * R, // a little hop as it comes loose
      spin: (rand() - 0.5) * 5,
      flips: rand() < 0.6 ? 1 : 2,
      tumble: 0.25 + rand() * 0.3,
      hop: (0.015 + rand() * 0.03) * R,
      even: i % 2 === 0,
      // Filled in on every frame.
      sx: 0, sy: 0, fx: 0, fy: 0, h: 0, depth: 0, angle: 0, fore: 1, len: 0, shade: 0, mix: 0, alpha: 0, flying: false,
    });
  });

  // Landings come slowly at first and then steadily, and each grain lets go
  // one fall's length before its landing.
  rank.forEach((gi, i) => {
    const g = grains[gi];
    const f = (i / Math.max(1, count - 1)) ** 0.8;
    g.land = FIRST_LAND + (LAST_LAND - FIRST_LAND) * f;
    g.r = Math.max(RELEASE, g.land - FALL_K * Math.sqrt(Math.max(0, ART_FLOOR - g.y * CP - g.y0)));
  });
  return grains;
}

/* ── Sprites ── */

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

/**
 * Everything about one grain's pixels that does not depend on the light:
 * coverage, surface normal, height and colour. Shading it for each angle
 * and brightness step is then a few multiplications per pixel.
 */
function grainSurface(g, L, noise) {
  const W = L * g.width;
  const pad = Math.ceil(W * 0.2) + 2;
  const w = Math.ceil(L) + pad * 2;
  const h = Math.ceil(W) + pad * 2;
  const hl = L / 2;
  const hw = W / 2;
  const T = hw * 0.95;
  const E = 0.025;
  const size = w * h;
  const s = {
    w, h,
    alpha: new Float32Array(size),
    nx: new Float32Array(size),
    ny: new Float32Array(size),
    nz: new Float32Array(size),
    ht: new Float32Array(size),
    r: new Float32Array(size),
    g: new Float32Array(size),
    b: new Float32Array(size),
  };

  const field = (u, v) => {
    const vv = v / (1 - 0.1 * u) + 0.05 * (1 - u * u);
    return 1 - (Math.abs(u) ** g.pu + Math.abs(vv) ** g.pv);
  };
  const heightAt = (u, v) => {
    const f = field(u, v);
    return f > 0 ? Math.sqrt(f) : 0;
  };

  for (let y = 0; y < h; y += 1) {
    const v = (y + 0.5 - h / 2) / hw;
    for (let x = 0; x < w; x += 1) {
      const u = (x + 0.5 - w / 2) / hl;
      const f = field(u, v);
      if (f <= -0.06) continue;
      const i = y * w + x;
      const dhu = ((heightAt(u + E, v) - heightAt(u - E, v)) * T) / (2 * E * hl);
      const dhv = ((heightAt(u, v + E) - heightAt(u, v - E)) * T) / (2 * E * hw);
      const [nx, ny, nz] = norm3(-dhu, -dhv, 1);
      const n1 = noise(u * 3.2 + 7, v * 1.2);
      const tint = 0.93 + (0.65 * n1 + 0.35 * noise(u * 14, v * 5)) * 0.14;
      let r = g.base[0] * tint;
      let gr = g.base[1] * tint;
      let b = g.base[2] * tint;
      if (g.chalk) {
        const c = smoothstep(0.05, 0.85, v + (n1 - 0.5) * 0.6) * g.chalk * 0.6;
        r += (255 - r) * c;
        gr += (255 - gr) * c;
        b += (255 - b) * c;
      }
      if (g.ridge) {
        const ridge = (0.5 + 0.5 * Math.sin(v * Math.PI * 4.2 + n1 * 2.2)) ** 2;
        const c = ridge * g.ridge + smoothstep(0.62, 1, Math.abs(u)) * g.tip;
        r += (g.dark[0] - r) * c;
        gr += (g.dark[1] - gr) * c;
        b += (g.dark[2] - b) * c;
      }
      s.alpha[i] = smoothstep(-0.06, 0.03, f);
      s.nx[i] = nx;
      s.ny[i] = ny;
      s.nz[i] = nz;
      s.ht[i] = f > 0 ? Math.sqrt(f) : 0;
      // The germ notch at one end of a milled grain.
      const germ = g.germ ? (u + 0.88) ** 2 * 6 + (v - 0.32) ** 2 : 1;
      const k = germ < 0.09 ? 1 - 0.25 * (1 - germ / 0.09) : 1;
      s.r[i] = r * k;
      s.g[i] = gr * k;
      s.b[i] = b * k;
    }
  }
  return s;
}

/** One grain, long axis horizontal, lit as if turned to `bucket`. */
function shadeGrain(s, g, bucket, level) {
  const cv = makeCanvas(s.w, s.h);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(s.w, s.h);
  const px = img.data;

  // The key light, turned into the sprite's own frame.
  const ang = (bucket / BUCKETS) * TAU;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const lx = KEY_LIGHT[0] * ca + KEY_LIGHT[1] * sa;
  const ly = -KEY_LIGHT[0] * sa + KEY_LIGHT[1] * ca;
  const lz = KEY_LIGHT[2];
  const [hx, hy, hz] = norm3(lx, ly, lz + 1);
  const { light, dark } = g;

  for (let i = 0; i < s.alpha.length; i += 1) {
    if (!s.alpha[i]) continue;
    const nx = s.nx[i];
    const ny = s.ny[i];
    const nz = s.nz[i];
    const ht = s.ht[i];
    const diffuse = clamp01((nx * lx + ny * ly + nz * lz + g.wrap) / (1 + g.wrap));
    const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
    const spec = ndh ** g.shine * g.gloss * 1.7;
    const sheen = ndh ** 6 * 0.12 * g.gloss;
    const fresnel = (1 - nz) ** 3 * 0.18 * level;

    const shade = (g.amb + 0.8 * diffuse) * (0.78 + 0.22 * Math.sqrt(ht)) * level;
    let r = s.r[i] * shade;
    let gr = s.g[i] * shade;
    let b = s.b[i] * shade;
    const toDark = (1 - diffuse) * g.shadowMix;
    r += (dark[0] - r) * toDark;
    gr += (dark[1] - gr) * toDark;
    b += (dark[2] - b) * toDark;

    const glow = g.trans * (1 - ht) ** 1.6 * (0.4 + 0.6 * diffuse) * 0.55 * level;
    const add = 255 * (fresnel + spec + sheen);
    const o = i * 4;
    px[o] = r + light[0] * glow + add;
    px[o + 1] = gr + light[1] * glow + add;
    px[o + 2] = b + light[2] * glow + add;
    px[o + 3] = 255 * s.alpha[i];
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function shadowSprite(g) {
  const L = SMALL_LEN;
  const W = L * g.width;
  const pad = 0.9 * W;
  const cv = makeCanvas(L + pad * 2, W + pad * 2);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(40,28,12,1)';
  ctx.beginPath();
  ctx.ellipse(cv.width / 2, cv.height / 2, L / 2, W / 2, 0, 0, TAU);
  ctx.fill();
  const out = soften(cv, [Math.max(2, W * 0.35), 2]);

  // The blur reaches the sprite's edge; fade it out before the edge, so no
  // straight line shows where the sprite ends under a large floating grain.
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
 * A grain with its contact shadow under it, in one sprite: the shadow offset
 * by (0.09, 0.13) of the grain's length on screen, turned into the sprite's
 * own frame for this angle bucket.
 */
function withContactShadow(grain, shadow, bucket, alpha) {
  const ang = (bucket / BUCKETS) * TAU;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const dx = (0.09 * ca + 0.13 * sa) * SMALL_LEN;
  const dy = (-0.09 * sa + 0.13 * ca) * SMALL_LEN;
  const cv = makeCanvas(
    Math.ceil(Math.max(grain.width, shadow.width + 2 * Math.abs(dx))),
    Math.ceil(Math.max(grain.height, shadow.height + 2 * Math.abs(dy))),
  );
  const ctx = cv.getContext('2d');
  ctx.globalAlpha = alpha;
  ctx.drawImage(shadow, (cv.width - shadow.width) / 2 + dx, (cv.height - shadow.height) / 2 + dy);
  ctx.globalAlpha = 1;
  ctx.drawImage(grain, (cv.width - grain.width) / 2, (cv.height - grain.height) / 2);
  return cv;
}

/**
 * Packs sprites into one canvas, shelf by shelf, and returns where each sits:
 * stamps from one image batch on the GPU, from a hundred small canvases not.
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

/** Every sprite, as small steps that can run while the browser is idle. */
function buildSteps(done) {
  const noise = valueNoise(fnv1a('hero-rice:grain'));
  const out = { husk: [], milled: [], shadow: null };
  const steps = [];
  for (const [name, g] of [['husk', HUSK], ['milled', MILLED]]) {
    let surface;
    let shadow;
    steps.push(() => {
      surface = grainSurface(g, SMALL_LEN, noise);
      shadow = shadowSprite(g);
      if (g === MILLED) out.shadow = shadow;
    });
    LEVELS.forEach((level, l) => {
      steps.push(() => {
        for (let b = 0; b < BUCKETS; b += 1) {
          out[name][l * BUCKETS + b] = withContactShadow(shadeGrain(surface, g, b, level), shadow, b, g.contact);
        }
      });
    });
  }
  steps.push(() => {
    const n = LEVELS.length * BUCKETS;
    const rects = packAtlas([...out.husk, ...out.milled, out.shadow]);
    done({ husk: rects.slice(0, n), milled: rects.slice(n, 2 * n), shadow: rects[2 * n] });
  });
  return steps;
}

/* ── Renderer ── */

export function createHeroRice(canvas, count) {
  const ctx = canvas.getContext('2d');
  const grains = buildLayout(count);
  // Kept in last frame's depth order, so each frame's sort starts nearly sorted.
  const order = grains.slice();
  const grainLen = GRAIN_LEN * Math.sqrt(1900 / count);

  let sprites = null;
  const queue = buildSteps((out) => { sprites = out; });
  const ensure = () => {
    while (!sprites && queue.length) queue.shift()();
    return sprites;
  };

  // The sprites are built a step at a time while the browser is idle; the
  // loop holds the plain stalk for its first three seconds, so they are
  // nearly always ready before a grain is drawn.
  const idle = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 300 })
    : (cb) => window.setTimeout(() => cb({ didTimeout: true }), 60);
  const cancelIdle = window.cancelIdleCallback
    ? (id) => window.cancelIdleCallback(id)
    : (id) => window.clearTimeout(id);
  let idleId = 0;
  const work = (deadline) => {
    idleId = 0;
    if (sprites || !queue.length) return;
    const until = performance.now() + (deadline.didTimeout ? 8 : deadline.timeRemaining() - 2);
    do queue.shift()();
    while (queue.length && performance.now() < until);
    if (queue.length) idleId = idle(work);
  };
  idleId = idle(work);

  // Device pixels per art pixel, and where the art's origin is on the canvas.
  let k = 0;
  let ox = 0;
  let oy = 0;
  // The centre of the mound's foot, in art pixels.
  let cx = 0;
  let cy = 0;
  let core = null;
  let coreX = 0;
  let coreY = 0;
  let floor = null;
  let floorX = 0;
  let floorY = 0;
  let blank = false;

  /** The mound's solid body, so no floor shows between the grains. */
  function buildCore() {
    const m = 0.1 * R * k;
    const rx = 0.9 * R * k;
    const ry = rx * SP;
    const rise = H * 0.88 * CP * k;
    const cv = makeCanvas(2 * (rx + m), rise + ry + 2 * m);
    const c = cv.getContext('2d');
    const mid = cv.width / 2;
    const base = m + rise;
    c.beginPath();
    c.moveTo(mid - rx, base);
    c.bezierCurveTo(mid - rx * 0.62, base - rise * 0.78, mid - rx * 0.3, base - rise, mid, base - rise);
    c.bezierCurveTo(mid + rx * 0.3, base - rise, mid + rx * 0.62, base - rise * 0.78, mid + rx, base);
    c.ellipse(mid, base, rx, ry, 0, 0, Math.PI);
    c.closePath();
    const grad = c.createLinearGradient(0, base - rise, 0, base + ry);
    grad.addColorStop(0, 'rgb(214,209,195)');
    grad.addColorStop(1, 'rgb(158,150,130)');
    c.fillStyle = grad;
    c.fill();
    core = soften(cv, [3]);
    coreX = ox + k * cx - mid;
    coreY = oy + k * cy - base;
  }

  /** The soft shadow the mound casts on the floor. */
  function buildFloor() {
    const r = 1.16 * R * k;
    const cv = makeCanvas(2 * r, 2 * r * SP);
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, SP, 0, 0);
    for (const [rad, a] of [[1.16, 0.18], [1.0, 0.3], [0.86, 0.28]]) {
      const grad = c.createRadialGradient(r, r, 0.2 * rad * R * k, r, r, rad * R * k);
      grad.addColorStop(0, `rgba(52,38,16,${a})`);
      grad.addColorStop(1, 'rgba(52,38,16,0)');
      c.fillStyle = grad;
      c.fillRect(0, 0, 2 * r, 2 * r);
    }
    floor = cv;
    floorX = ox + k * (cx + 0.05 * R) - r;
    floorY = oy + k * (cy + 0.03 * R) - r * SP;
  }

  function resize({ width, height, imgX, imgY, imgW, floorX: fx, floorY: fy }) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const s = imgW / ART_W;
    k = s * dpr;
    ox = imgX * dpr;
    oy = imgY * dpr;
    // The mound's front edge, not its centre, sits on the floor shadow.
    cx = (fx - imgX) / s;
    cy = (fy - imgY) / s - 0.95 * R * SP;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    buildCore();
    buildFloor();
    blank = false;
  }

  /** Where one grain is, how it is turned and how it is lit, at story time s. */
  function place(g, s, cosT, sinT) {
    if (s <= g.r - FADE_IN) {
      g.alpha = 0;
      g.depth = -1e9;
      return;
    }
    // 0 on the panicle, 1 on the mound; it falls from rest, so the way down
    // goes with the square of the time.
    const u = clamp01((s - g.r) / (g.land - g.r));
    const landed = clamp01((s - g.land) / HOP);

    // Its place on the mound, turned with the mound.
    const tx = g.x * cosT + g.z * sinT;
    const tz = -g.x * sinT + g.z * cosT;
    const tdx = g.dx * cosT + g.dz * sinT;
    const tdz = -g.dx * sinT + g.dz * cosT;
    const nxr = g.nx * cosT + g.nz * sinT;
    const nzr = -g.nx * sinT + g.nz * cosT;
    const rest = clamp01(nxr * LIGHT_WORLD[0] + g.ny * LIGHT_WORLD[1] + nzr * LIGHT_WORLD[2]);

    // The panicle is in the plane of the picture.
    const x = lerp(g.x0 - cx, tx, u) + g.sway * Math.sin(Math.PI * u);
    const y = lerp((cy - g.y0) / CP, g.y, u * u) + g.pop * 4 * u * (1 - u)
      + g.hop * Math.sin(Math.PI * landed) * (1 - landed);
    const z = tz * u;
    g.sx = cx + x;
    g.sy = cy - (y * CP - z * SP);
    g.fx = cx + x;
    g.fy = cy + z * SP;
    g.h = y;
    g.depth = z * CP + y * SP;

    const [dx, dy, dz] = norm3(
      lerp(Math.cos(g.a0), tdx, u),
      lerp(-Math.sin(g.a0) / CP, g.dy, u),
      tdz * u,
    );
    const vy = dy * CP - dz * SP;
    const flip = Math.sin(Math.PI * g.flips * u);
    g.angle = Math.atan2(-vy, dx) + g.spin * Math.sin(Math.PI * u);
    g.fore = lerp(1, Math.max(0.3, Math.hypot(dx, vy)), u) * (1 - g.tumble * flip * flip);

    // Milled little by little on the way down, and slimmer with it.
    g.mix = smoothstep(0.12, 0.88, u);
    g.len = lerp(g.len0, grainLen * g.size * (1 + g.depth / (5.4 * R)), g.mix);
    g.alpha = smoothstep(g.r - FADE_IN, g.r, s);
    g.flying = u > 0 && u < 1;
    const lit = lerp(0.85, rest, u);
    const shade = Math.floor((0.3 + lit * 0.75) * lerp(1, g.ao, u) * 3) + (u > 0.5 ? g.jit : 0);
    g.shade = Math.min(2, Math.max(0, shade));
  }

  // Sprites live in an atlas; each is stamped centred on the current transform.
  const stamp = (r) => ctx.drawImage(r.src, r.x, r.y, r.w, r.h, -r.w / 2, -r.h / 2, r.w, r.h);

  /** Soft shadows on the floor under the falling grains, every other one. */
  function paintAirShadows(sp) {
    for (const g of grains) {
      if (!g.flying || !g.even || g.h < 0.13 * R) continue;
      const lift = clamp01(g.h / (1.6 * R));
      const grow = 1 + 1.6 * lift;
      const ws = ((g.len * k) / SMALL_LEN) * grow;
      const ls = ws * g.fore;
      const ca = Math.cos(g.angle);
      const sa = Math.sin(g.angle);
      ctx.globalAlpha = 0.16 * (1 - 0.75 * lift) * g.alpha;
      ctx.setTransform(
        ca * ls, sa * ls * SP, -sa * ws, ca * ws * SP,
        ox + k * (g.fx + (0.07 + 0.17 * lift) * R), oy + k * (g.fy + 0.04 * R),
      );
      stamp(sp.shadow);
    }
  }

  function paintGrain(g, sp) {
    const ca = Math.cos(g.angle);
    const sa = Math.sin(g.angle);
    const turn = ((g.angle % TAU) + TAU) % TAU;
    const b = Math.round((turn / TAU) * BUCKETS) % BUCKETS;
    const ws = (g.len * k) / SMALL_LEN;
    const ls = ws * g.fore;
    ctx.setTransform(ca * ls, sa * ls, -sa * ws, ca * ws, ox + k * g.sx, oy + k * g.sy);
    // Husk and milled grain cross over: the milled one comes in on top,
    // then the husk under it goes.
    if (g.mix < 1) {
      ctx.globalAlpha = g.alpha * Math.min(1, 2 * (1 - g.mix));
      stamp(sp.husk[g.lvl0 * BUCKETS + b]);
    }
    if (g.mix > 0) {
      ctx.globalAlpha = g.alpha * Math.min(1, 2 * g.mix);
      stamp(sp.milled[g.shade * BUCKETS + b]);
    }
  }

  function draw(t) {
    const s = storyAt(t);
    // The stalk is wiped away from the top, behind the grains that have left
    // it, and sinks a little into the mound; only its last trace is faded.
    const wipe = clamp01((s - WIPE_FROM) / (WIPE_TO - WIPE_FROM));
    const look = {
      opacity: 1 - smoothstep(0.9, 1, wipe),
      wipe,
      sink: smoothstep(FIRST_LAND, WIPE_TO, s),
      glow: smoothstep(FIRST_LAND + 0.5, LAST_LAND, s),
    };

    if (!k || s <= RELEASE - FADE_IN) {
      if (!blank) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        blank = true;
      }
      return look;
    }

    const sp = ensure();
    blank = false;
    const theta = ((TURN_FROM + TURN_RATE * (t - RELEASE)) * Math.PI) / 180;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    for (const g of grains) place(g, s, cosT, sinT);
    order.sort((p, q) => p.depth - q.depth);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // The floor shadow and the body come in under the grains as they land.
    const body = smoothstep(FIRST_LAND + 0.2, LAST_LAND - 0.6, s);
    if (body > 0) {
      ctx.globalAlpha = body;
      ctx.drawImage(floor, floorX, floorY);
      ctx.drawImage(core, coreX, coreY);
    }
    paintAirShadows(sp);
    for (const g of order) if (g.alpha > 0) paintGrain(g, sp);

    ctx.globalAlpha = 1;
    return look;
  }

  function destroy() {
    if (idleId) cancelIdle(idleId);
    idleId = 0;
  }

  return { resize, draw, destroy };
}
