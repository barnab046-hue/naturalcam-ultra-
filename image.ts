/** Still-image pipeline. Luminance-only tone so hue is not rotated. No face synthesis. */

export type StillMode = "natural" | "portrait" | "hdr" | "night";

export type FrameMetrics = {
  meanLuma: number;
  highlightClip: number;
  shadowClip: number;
  noise: number;
};

export type PipelineClaim = {
  multiFrameHdr: boolean;
  multiFrameDenoise: boolean;
  artificialBokeh: boolean;
  /** Always false. This pipeline never rebuilds a face. */
  faceAltered: false;
};

export type PipelineResult = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  notes: string[];
  before: FrameMetrics;
  after: FrameMetrics;
  claimed: PipelineClaim;
  processingMs: number;
};

export type PipelineInput = {
  frames: Uint8ClampedArray[];
  width: number;
  height: number;
  mode: StillMode;
  blurRadius?: number;
  mask?: Uint8Array | null;
  laboratory?: boolean;
};

const PIVOT = 0.18;

export function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function srgbToLinear(c: number): number {
  const x = c / 255;
  if (x <= 0.04045) return x / 12.92;
  return ((x + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgbByte(c: number): number {
  const x = clamp01(c);
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function lumaLinear(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function lumaByte(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Skin-like hues lose chroma and never rotate. Other hues pass through. */
export function skinGuard(
  r: number,
  g: number,
  b: number,
  chromaScale: number,
): [number, number, number] {
  const { h, s, v } = rgbToHsv(r, g, b);
  const skin = h >= 8 && h <= 50 && s >= 0.12 && s <= 0.78 && v >= 0.22 && v <= 0.98;
  if (!skin) return [r, g, b];
  return hsvToRgb(h, Math.min(s, s * chromaScale), v);
}

/** Global shoulder. Applied to luminance, then RGB is scaled, so hue stays put. */
export function filmicShoulder(x: number): number {
  const lifted = clamp01(x) ** 0.85;
  const white = 1.15;
  const shoulder = (lifted * (1 + lifted / (white * white))) / (1 + lifted);
  const norm = (1 * (1 + 1 / (white * white))) / 2;
  return clamp01(shoulder / norm);
}

function scaleLuma(
  r: number,
  g: number,
  b: number,
  nextY: number,
): [number, number, number] {
  const y = lumaLinear(r, g, b);
  const scale = y > 1e-6 ? nextY / y : 1;
  return [clamp01(r * scale), clamp01(g * scale), clamp01(b * scale)];
}

export function naturalColor(
  src: Uint8ClampedArray,
  opts: { contrast: number; saturation: number; skinChroma: number; tone: "none" | "filmic" },
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    let r = srgbToLinear(src[i] ?? 0);
    let g = srgbToLinear(src[i + 1] ?? 0);
    let b = srgbToLinear(src[i + 2] ?? 0);
    if (opts.tone === "filmic") {
      const y = filmicShoulder(lumaLinear(r, g, b));
      [r, g, b] = scaleLuma(r, g, b, y);
    }
    const contrasted = PIVOT + (lumaLinear(r, g, b) - PIVOT) * (1 + opts.contrast);
    [r, g, b] = scaleLuma(r, g, b, clamp01(contrasted));
    const y = lumaLinear(r, g, b);
    r = clamp01(y + (r - y) * opts.saturation);
    g = clamp01(y + (g - y) * opts.saturation);
    b = clamp01(y + (b - y) * opts.saturation);
    let R = linearToSrgbByte(r);
    let G = linearToSrgbByte(g);
    let B = linearToSrgbByte(b);
    [R, G, B] = skinGuard(R, G, B, opts.skinChroma);
    out[i] = R;
    out[i + 1] = G;
    out[i + 2] = B;
    out[i + 3] = 255;
  }
  return out;
}

export function sharpenLuma(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number,
  threshold: number,
  limit: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      let blur = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const yy = Math.min(h - 1, Math.max(0, y + ky));
        for (let kx = -1; kx <= 1; kx++) {
          const xx = Math.min(w - 1, Math.max(0, x + kx));
          const q = (yy * w + xx) * 4;
          blur += lumaByte(src[q] ?? 0, src[q + 1] ?? 0, src[q + 2] ?? 0);
        }
      }
      blur /= 9;
      const y0 = lumaByte(src[p] ?? 0, src[p + 1] ?? 0, src[p + 2] ?? 0);
      const diff = y0 - blur;
      let add = 0;
      if (Math.abs(diff) >= threshold) add = Math.max(-limit, Math.min(limit, diff * amount));
      out[p] = Math.max(0, Math.min(255, Math.round((src[p] ?? 0) + add)));
      out[p + 1] = Math.max(0, Math.min(255, Math.round((src[p + 1] ?? 0) + add)));
      out[p + 2] = Math.max(0, Math.min(255, Math.round((src[p + 2] ?? 0) + add)));
      out[p + 3] = 255;
    }
  }
  return out;
}

export function boxBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(src);
  const tmp = new Float32Array(src.length);
  const out = new Uint8ClampedArray(src.length);
  const r = radius;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const p = (y * w + xx) * 4;
        rs += src[p] ?? 0;
        gs += src[p + 1] ?? 0;
        bs += src[p + 2] ?? 0;
        n++;
      }
      const p = (y * w + x) * 4;
      tmp[p] = rs / n;
      tmp[p + 1] = gs / n;
      tmp[p + 2] = bs / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rs = 0;
      let gs = 0;
      let bs = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const p = (yy * w + x) * 4;
        rs += tmp[p] ?? 0;
        gs += tmp[p + 1] ?? 0;
        bs += tmp[p + 2] ?? 0;
        n++;
      }
      const p = (y * w + x) * 4;
      out[p] = rs / n;
      out[p + 1] = gs / n;
      out[p + 2] = bs / n;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** mask 0 keeps the subject, 255 blurs the background. Subject pixels are not smoothed. */
export function maskedBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  mask: Uint8Array,
  radius: number,
): Uint8ClampedArray {
  if (radius <= 0) return new Uint8ClampedArray(src);
  const blurred = boxBlur(src, w, h, radius);
  const out = new Uint8ClampedArray(src.length);
  const pixels = w * h;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const a = (mask[p] ?? 0) / 255;
    out[i] = (src[i] ?? 0) * (1 - a) + (blurred[i] ?? 0) * a;
    out[i + 1] = (src[i + 1] ?? 0) * (1 - a) + (blurred[i + 1] ?? 0) * a;
    out[i + 2] = (src[i + 2] ?? 0) * (1 - a) + (blurred[i + 2] ?? 0) * a;
    out[i + 3] = 255;
  }
  return out;
}

/** Chroma-only denoise. Luma is kept so edges and pores are not waxed over. */
export function chromaDenoise(
  src: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8ClampedArray {
  const cb = new Float32Array(w * h);
  const cr = new Float32Array(w * h);
  const yA = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const r = src[i] ?? 0;
    const g = src[i + 1] ?? 0;
    const b = src[i + 2] ?? 0;
    yA[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    cb[p] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    cr[p] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const blurCh = (plane: Float32Array) => {
    const tmp = new Float32Array(plane.length);
    const out = new Float32Array(plane.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -1; k <= 1; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          const weight = k === 0 ? 2 : 1;
          s += (plane[y * w + xx] ?? 0) * weight;
          n += weight;
        }
        tmp[y * w + x] = s / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let k = -1; k <= 1; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          const weight = k === 0 ? 2 : 1;
          s += (tmp[yy * w + x] ?? 0) * weight;
          n += weight;
        }
        out[y * w + x] = s / n;
      }
    }
    return out;
  };
  const cb2 = blurCh(cb);
  const cr2 = blurCh(cr);
  const out = new Uint8ClampedArray(src.length);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const y = yA[p] ?? 0;
    const cbb = (cb2[p] ?? 128) - 128;
    const crr = (cr2[p] ?? 128) - 128;
    out[i] = Math.max(0, Math.min(255, Math.round(y + 1.402 * crr)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(y - 0.344136 * cbb - 0.714136 * crr)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(y + 1.772 * cbb)));
    out[i + 3] = 255;
  }
  return out;
}

export function measure(src: Uint8ClampedArray, w: number, h: number): FrameMetrics {
  const n = w * h;
  if (n === 0) return { meanLuma: 0, highlightClip: 0, shadowClip: 0, noise: 0 };
  let sum = 0;
  let hi = 0;
  let lo = 0;
  let noiseAcc = 0;
  let noiseN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const yb = lumaByte(src[p] ?? 0, src[p + 1] ?? 0, src[p + 2] ?? 0);
      sum += yb;
      if (yb >= 250) hi++;
      if (yb <= 4) lo++;
      if (x + 1 < w && y + 1 < h && ((x + y) & 3) === 0) {
        const r = (y * w + x + 1) * 4;
        const d = (y + 1) * w + x;
        const pr = d * 4;
        const yr = lumaByte(src[r] ?? 0, src[r + 1] ?? 0, src[r + 2] ?? 0);
        const yd = lumaByte(src[pr] ?? 0, src[pr + 1] ?? 0, src[pr + 2] ?? 0);
        noiseAcc += Math.abs(2 * yb - yr - yd);
        noiseN++;
      }
    }
  }
  return {
    meanLuma: sum / n,
    highlightClip: hi / n,
    shadowClip: lo / n,
    noise: noiseN ? noiseAcc / noiseN : 0,
  };
}

function exposedness(luma01: number): number {
  const d = (luma01 - 0.5) / 0.2;
  return Math.exp(-0.5 * d * d);
}

/** Well-exposedness + a little saturation. No local-contrast weight, to limit halos. */
export function mertensFusion(
  frames: Uint8ClampedArray[],
  w: number,
  h: number,
): Uint8ClampedArray {
  const n = frames.length;
  const weights = frames.map(() => new Float32Array(w * h));
  for (let f = 0; f < n; f++) {
    const img = frames[f]!;
    const plane = weights[f]!;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const r = img[i] ?? 0;
      const g = img[i + 1] ?? 0;
      const b = img[i + 2] ?? 0;
      const mean = (r + g + b) / 3;
      const sat = Math.sqrt(((r - mean) ** 2 + (g - mean) ** 2 + (b - mean) ** 2) / 3) / 255;
      const y = lumaByte(r, g, b) / 255;
      plane[p] = exposedness(y) * (0.2 + sat) + 1e-6;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    let ws = 0;
    for (let f = 0; f < n; f++) ws += weights[f]![p] ?? 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let f = 0; f < n; f++) {
      const wt = (weights[f]![p] ?? 0) / ws;
      const img = frames[f]!;
      r += (img[i] ?? 0) * wt;
      g += (img[i + 1] ?? 0) * wt;
      b += (img[i + 2] ?? 0) * wt;
    }
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return out;
}

export function estimateIntegerShift(
  ref: Uint8Array,
  cur: Uint8Array,
  width: number,
  height: number,
  radius: number,
): { dx: number; dy: number; meanAbs: number } {
  const maxR = Math.floor((Math.min(width, height) - 1) / 2);
  const rad = Math.max(0, Math.min(radius, maxR));
  if (rad === 0 || width < 3 || height < 3) {
    let sad = 0;
    const n = Math.min(ref.length, cur.length);
    for (let i = 0; i < n; i++) sad += Math.abs((ref[i] ?? 0) - (cur[i] ?? 0));
    return { dx: 0, dy: 0, meanAbs: n ? sad / n : 0 };
  }
  let bestDx = 0;
  let bestDy = 0;
  let best = Number.POSITIVE_INFINITY;
  const step = width >= 80 ? 2 : 1;
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      let sad = 0;
      let n = 0;
      for (let y = rad; y < height - rad; y += step) {
        const row = y * width;
        const row2 = (y + dy) * width;
        for (let x = rad; x < width - rad; x += step) {
          sad += Math.abs((ref[row + x] ?? 0) - (cur[row2 + x + dx] ?? 0));
          n++;
        }
      }
      const mean = n ? sad / n : Number.POSITIVE_INFINITY;
      if (mean < best) {
        best = mean;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy, meanAbs: best };
}

export function downscaleGray(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  targetW: number,
): { gray: Uint8Array; w: number; h: number } {
  const grayOf = (buf: Uint8ClampedArray, bw: number, bh: number) => {
    const gray = new Uint8Array(bw * bh);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = lumaByte(buf[p] ?? 0, buf[p + 1] ?? 0, buf[p + 2] ?? 0) | 0;
    }
    return gray;
  };
  if (targetW >= w) return { gray: meanCenter(grayOf(rgba, w, h)), w, h };
  const tw = Math.max(1, targetW);
  const th = Math.max(1, Math.round(h * (tw / w)));
  const gray = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
      let s = 0;
      let n = 0;
      for (let yy = y0; yy < y1 && yy < h; yy++) {
        for (let xx = x0; xx < x1 && xx < w; xx++) {
          const p = (yy * w + xx) * 4;
          s += lumaByte(rgba[p] ?? 0, rgba[p + 1] ?? 0, rgba[p + 2] ?? 0);
          n++;
        }
      }
      gray[y * tw + x] = n ? (s / n) | 0 : 0;
    }
  }
  return { gray: meanCenter(gray), w: tw, h: th };
}

function meanCenter(gray: Uint8Array): Uint8Array {
  let sum = 0;
  for (const v of gray) sum += v;
  const mean = gray.length ? sum / gray.length : 0;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round((gray[i] ?? 0) - mean + 128)));
  }
  return out;
}

export function translateRgba(
  src: Uint8ClampedArray,
  ref: Uint8ClampedArray,
  w: number,
  h: number,
  dx: number,
  dy: number,
): Uint8ClampedArray {
  if (dx === 0 && dy === 0) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x + dx;
      const sy = y + dy;
      const d = (y * w + x) * 4;
      const inside = sx >= 0 && sy >= 0 && sx < w && sy < h;
      const s = inside ? (sy * w + sx) * 4 : d;
      const from = inside ? src : ref;
      out[d] = from[s] ?? 0;
      out[d + 1] = from[s + 1] ?? 0;
      out[d + 2] = from[s + 2] ?? 0;
      out[d + 3] = 255;
    }
  }
  return out;
}

export function alignFrames(
  frames: Uint8ClampedArray[],
  w: number,
  h: number,
  refIndex: number,
): { frames: Uint8ClampedArray[]; notes: string[] } {
  const notes: string[] = [];
  if (frames.length <= 1) return { frames, notes };
  const targetW = Math.min(160, w);
  const grays = frames.map((frame) => downscaleGray(frame, w, h, targetW));
  const refG = grays[refIndex] ?? grays[0]!;
  const ref = frames[refIndex] ?? frames[0]!;
  const kept: Uint8ClampedArray[] = [];
  frames.forEach((frame, index) => {
    if (index === refIndex) {
      kept.push(frame);
      return;
    }
    const g = grays[index] ?? refG;
    const shift = estimateIntegerShift(refG.gray, g.gray, refG.w, refG.h, 6);
    const sx = Math.round(shift.dx * (w / refG.w));
    const sy = Math.round(shift.dy * (h / refG.h));
    if (shift.meanAbs > 42) {
      notes.push(
        `Frame ${index + 1} dropped. It could not be aligned (mean error ${shift.meanAbs.toFixed(1)}).`,
      );
      return;
    }
    kept.push(translateRgba(frame, ref, w, h, sx, sy));
  });
  return { frames: kept, notes };
}

export function robustAverage(
  frames: Uint8ClampedArray[],
  w: number,
  h: number,
): { rgba: Uint8ClampedArray; ghostFraction: number } {
  const n = frames.length;
  const out = new Uint8ClampedArray(w * h * 4);
  if (n === 0) return { rgba: out, ghostFraction: 0 };
  if (n === 1) return { rgba: new Uint8ClampedArray(frames[0]!), ghostFraction: 0 };
  let ghosts = 0;
  const count = w * h;
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    let sumY = 0;
    let sumYY = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let f = 0; f < n; f++) {
      const s = frames[f]!;
      const y = lumaByte(s[i] ?? 0, s[i + 1] ?? 0, s[i + 2] ?? 0);
      sumY += y;
      sumYY += y * y;
      r += s[i] ?? 0;
      g += s[i + 1] ?? 0;
      b += s[i + 2] ?? 0;
    }
    const mean = sumY / n;
    const variance = Math.max(0, sumYY / n - mean * mean);
    if (Math.sqrt(variance) > 18) {
      ghosts++;
      const s = frames[0]!;
      out[i] = s[i] ?? 0;
      out[i + 1] = s[i + 1] ?? 0;
      out[i + 2] = s[i + 2] ?? 0;
    } else {
      out[i] = r / n;
      out[i + 1] = g / n;
      out[i + 2] = b / n;
    }
    out[i + 3] = 255;
  }
  return { rgba: out, ghostFraction: ghosts / count };
}

export function exposeEv(src: Uint8ClampedArray, ev: number): Uint8ClampedArray {
  const scale = 2 ** ev;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = linearToSrgbByte(srgbToLinear(src[i] ?? 0) * scale);
    out[i + 1] = linearToSrgbByte(srgbToLinear(src[i + 1] ?? 0) * scale);
    out[i + 2] = linearToSrgbByte(srgbToLinear(src[i + 2] ?? 0) * scale);
    out[i + 3] = 255;
  }
  return out;
}

export function fitLongEdge(
  src: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  maxEdge: number,
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const edge = Math.max(w, h);
  if (edge <= maxEdge) {
    const rgba = src instanceof Uint8ClampedArray ? src : new Uint8ClampedArray(src);
    return { rgba, width: w, height: h };
  }
  const scale = maxEdge / edge;
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor(x / scale));
      const s = (sy * w + sx) * 4;
      const d = (y * tw + x) * 4;
      out[d] = src[s] ?? 0;
      out[d + 1] = src[s + 1] ?? 0;
      out[d + 2] = src[s + 2] ?? 0;
      out[d + 3] = 255;
    }
  }
  return { rgba: out, width: tw, height: th };
}

function finish(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  beforeSrc: Uint8ClampedArray,
  notes: string[],
  claimed: PipelineClaim,
  started: number,
): PipelineResult {
  return {
    rgba,
    width: w,
    height: h,
    notes,
    before: measure(beforeSrc, w, h),
    after: measure(rgba, w, h),
    claimed,
    processingMs: Math.round((globalThis.performance?.now?.() ?? Date.now()) - started),
  };
}

export function runStillPipeline(input: PipelineInput): PipelineResult {
  const started = globalThis.performance?.now?.() ?? Date.now();
  const { width: w, height: h, mode } = input;
  const frames = input.frames;
  if (frames.length === 0) throw new Error("No frames to process.");
  for (const frame of frames) {
    if (frame.length !== w * h * 4) throw new Error("Frame size does not match width and height.");
  }
  const notes: string[] = [
    "Faces are not rebuilt, smoothed, or recolored beyond a global profile.",
  ];
  const baseClaim: PipelineClaim = {
    multiFrameHdr: false,
    multiFrameDenoise: false,
    artificialBokeh: false,
    faceAltered: false,
  };

  if (mode === "night") {
    const aligned = alignFrames(frames, w, h, 0);
    notes.push(...aligned.notes);
    let working = aligned.frames[0]!;
    if (aligned.frames.length >= 3) {
      const avg = robustAverage(aligned.frames, w, h);
      working = avg.rgba;
      baseClaim.multiFrameDenoise = true;
      notes.push(
        `Low light averaged ${aligned.frames.length} aligned frames. Fine detail is only what those frames contained.`,
      );
      if (avg.ghostFraction > 0.02) {
        notes.push(
          `Motion kept the first frame on ${Math.round(avg.ghostFraction * 100)}% of pixels so moving subjects do not ghost.`,
        );
      }
    } else {
      notes.push(
        "Not enough steady frames for burst denoise. No texture was invented to fill the gap.",
      );
    }
    working = chromaDenoise(working, w, h);
    const mean = measure(working, w, h).meanLuma;
    const tone = mean < 48 ? "filmic" : "none";
    if (tone === "filmic") {
      notes.push("Shadows were lifted slightly because the frame is dark. Clipped blacks stay clipped.");
    } else {
      notes.push("Exposure was already usable, so night mode did not brighten the frame.");
    }
    let out = naturalColor(working, {
      contrast: 0.03,
      saturation: 0.94,
      skinChroma: 0.88,
      tone,
    });
    out = sharpenLuma(out, w, h, 0.08, 8, 6);
    notes.push("Sharpening is minimal so noise is not turned into fake detail.");
    return finish(out, w, h, frames[0]!, notes, baseClaim, started);
  }

  if (mode === "hdr") {
    const ref = frames[Math.min(1, frames.length - 1)]!;
    const aligned = alignFrames(frames, w, h, Math.min(1, frames.length - 1));
    notes.push(...aligned.notes);
    if (input.laboratory) {
      notes.push("Laboratory exposure set synthesized from one image, not a sensor bracket.");
    }
    if (aligned.frames.length >= 3) {
      let out = mertensFusion(aligned.frames, w, h);
      out = naturalColor(out, { contrast: 0.03, saturation: 0.98, skinChroma: 0.9, tone: "none" });
      out = sharpenLuma(out, w, h, 0.12, 7, 8);
      baseClaim.multiFrameHdr = true;
      notes.push(
        `Exposure fusion of ${aligned.frames.length} frames. Weights prefer midtones, not harsh local contrast.`,
      );
      notes.push("Highlights that are clipped in every frame cannot come back.");
      return finish(out, w, h, ref, notes, baseClaim, started);
    }
    let out = naturalColor(frames[0]!, {
      contrast: 0.04,
      saturation: 0.97,
      skinChroma: 0.9,
      tone: "filmic",
    });
    out = sharpenLuma(out, w, h, 0.14, 7, 8);
    notes.push(
      "Exposure could not be bracketed. This is a single-frame global tone curve. Clipped highlights stay clipped.",
    );
    return finish(out, w, h, frames[0]!, notes, baseClaim, started);
  }

  const portrait = mode === "portrait";
  let out = naturalColor(frames[0]!, {
    contrast: portrait ? 0.04 : 0.06,
    saturation: portrait ? 0.94 : 0.96,
    skinChroma: portrait ? 0.86 : 0.9,
    tone: "none",
  });
  out = sharpenLuma(
    out,
    w,
    h,
    portrait ? 0.1 : 0.22,
    portrait ? 8 : 6,
    portrait ? 6 : 10,
  );
  const radius = input.blurRadius ?? 0;
  if (portrait && input.mask && radius > 0) {
    out = maskedBlur(out, w, h, input.mask, radius);
    baseClaim.artificialBokeh = true;
    notes.push(
      "Background blur uses the supplied mask only. Subject pixels, including skin, are not smoothed.",
    );
  } else if (portrait) {
    notes.push(
      "Natural portrait. No artificial blur — real optical blur only, and this path does not invent any.",
    );
  } else {
    notes.push("Natural profile: slightly restrained saturation, protected skin hue, light edge sharpen.");
  }
  return finish(out, w, h, frames[0]!, notes, baseClaim, started);
}
