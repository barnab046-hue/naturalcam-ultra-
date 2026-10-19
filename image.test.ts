import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chromaDenoise,
  estimateIntegerShift,
  exposeEv,
  lumaByte,
  maskedBlur,
  measure,
  mertensFusion,
  rgbToHsv,
  robustAverage,
  runStillPipeline,
  sharpenLuma,
  skinGuard,
} from "./image.ts";

function solid(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rgb[0];
    out[i + 1] = rgb[1];
    out[i + 2] = rgb[2];
    out[i + 3] = 255;
  }
  return out;
}

describe("natural still pipeline", () => {
  it("reduces skin chroma without rotating hue", () => {
    const src: [number, number, number] = [214, 168, 142];
    const before = rgbToHsv(...src);
    const guarded = skinGuard(...src, 0.9);
    const after = rgbToHsv(...guarded);
    assert.ok(Math.abs(after.h - before.h) < 1.5);
    assert.ok(after.s < before.s);

    const frame = solid(4, 4, src);
    const result = runStillPipeline({ frames: [frame], width: 4, height: 4, mode: "natural" });
    const out = rgbToHsv(result.rgba[0]!, result.rgba[1]!, result.rgba[2]!);
    assert.ok(Math.abs(out.h - before.h) < 3, `hue drifted ${before.h} -> ${out.h}`);
    assert.ok(out.s <= before.s + 0.02);
    assert.equal(result.claimed.faceAltered, false);
  });

  it("does not sharpen a flat patch", () => {
    const frame = solid(6, 6, [128, 128, 128]);
    const sharp = sharpenLuma(frame, 6, 6, 0.22, 6, 10);
    assert.deepEqual(Array.from(sharp), Array.from(frame));
  });

  it("keeps the brightest pixel in place", () => {
    const w = 7;
    const h = 7;
    const frame = solid(w, h, [8, 8, 8]);
    const c = (3 * w + 3) * 4;
    frame[c] = 220;
    frame[c + 1] = 220;
    frame[c + 2] = 220;
    const out = runStillPipeline({ frames: [frame], width: w, height: h, mode: "natural" });
    let best = -1;
    let at = 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const y = lumaByte(out.rgba[i]!, out.rgba[i + 1]!, out.rgba[i + 2]!);
      if (y > best) {
        best = y;
        at = p;
      }
    }
    assert.equal(at, 3 * w + 3);
  });

  it("does not invent a clipped highlight from one frame", () => {
    const frame = solid(2, 2, [255, 255, 255]);
    frame[4] = 20;
    frame[5] = 20;
    frame[6] = 20;
    const out = runStillPipeline({ frames: [frame], width: 2, height: 2, mode: "hdr" });
    assert.equal(out.claimed.multiFrameHdr, false);
    assert.equal(out.rgba[0], 255);
    assert.match(out.notes.join(" "), /single-frame/i);
  });

  it("fuses a real three-frame bracket and prefers the mid exposure", () => {
    const dark = solid(2, 2, [12, 12, 12]);
    const mid = solid(2, 2, [140, 140, 140]);
    const blown = solid(2, 2, [252, 252, 252]);
    const fused = mertensFusion([dark, mid, blown], 2, 2);
    const y = lumaByte(fused[0]!, fused[1]!, fused[2]!);
    assert.ok(y > 80 && y < 190, `fused luma ${y}`);
    const out = runStillPipeline({
      frames: [dark, mid, blown],
      width: 2,
      height: 2,
      mode: "hdr",
    });
    assert.equal(out.claimed.multiFrameHdr, true);
    assert.equal(out.claimed.faceAltered, false);
  });

  it("averages a steady night burst and rejects pixels that moved", () => {
    const w = 8;
    const h = 8;
    const a = solid(w, h, [30, 30, 30]);
    const b = solid(w, h, [34, 34, 34]);
    const c = solid(w, h, [28, 28, 28]);
    const out = runStillPipeline({ frames: [a, b, c], width: w, height: h, mode: "night" });
    assert.equal(out.claimed.multiFrameDenoise, true);
    assert.match(out.notes.join(" "), /averaged/i);

    const moved = [a, solid(w, h, [30, 30, 30]), solid(w, h, [30, 30, 30])];
    for (let i = 0; i < 16; i++) {
      const p = i * 4;
      moved[1]![p] = 240;
      moved[1]![p + 1] = 240;
      moved[1]![p + 2] = 240;
      moved[2]![p] = 5;
      moved[2]![p + 1] = 5;
      moved[2]![p + 2] = 5;
    }
    const ghost = robustAverage(moved, w, h);
    assert.ok(ghost.ghostFraction > 0.1);
    assert.ok(ghost.rgba[0]! < 50);
  });

  it("blurs only masked background pixels", () => {
    const w = 5;
    const h = 5;
    const frame = solid(w, h, [20, 40, 220]);
    const subject = (2 * w + 2) * 4;
    frame[subject] = 240;
    frame[subject + 1] = 80;
    frame[subject + 2] = 60;
    const mask = new Uint8Array(w * h).fill(255);
    mask[2 * w + 2] = 0;
    const out = maskedBlur(frame, w, h, mask, 2);
    assert.equal(out[subject], 240);
    assert.equal(out[subject + 1], 80);
    assert.equal(out[subject + 2], 60);
    const result = runStillPipeline({
      frames: [frame],
      width: w,
      height: h,
      mode: "portrait",
      mask,
      blurRadius: 2,
    });
    assert.equal(result.claimed.artificialBokeh, true);
    assert.equal(result.claimed.faceAltered, false);
  });

  it("leaves portrait natural when no mask is provided", () => {
    const frame = solid(3, 3, [180, 140, 120]);
    const out = runStillPipeline({ frames: [frame], width: 3, height: 3, mode: "portrait" });
    assert.equal(out.claimed.artificialBokeh, false);
    assert.match(out.notes.join(" "), /No artificial blur/);
  });

  it("finds an integer shift", () => {
    const w = 12;
    const h = 12;
    const ref = new Uint8Array(w * h).fill(20);
    for (let y = 3; y < 8; y++) for (let x = 3; x < 8; x++) ref[y * w + x] = 200;
    const cur = new Uint8Array(w * h).fill(20);
    for (let y = 3; y < 8; y++) for (let x = 3; x < 8; x++) cur[y * w + (x + 1)] = 200;
    const shift = estimateIntegerShift(ref, cur, w, h, 3);
    assert.equal(shift.dx, 1);
    assert.equal(shift.dy, 0);
  });

  it("pulls a chroma spike toward neighbors and leaves distant gray alone", () => {
    const frame = solid(7, 7, [128, 128, 128]);
    const center = (3 * 7 + 3) * 4;
    frame[center] = 128;
    frame[center + 1] = 40;
    frame[center + 2] = 128;
    const out = chromaDenoise(frame, 7, 7);
    assert.ok(out[center + 1]! > 60);
    assert.ok(Math.abs((out[0] ?? 0) - 128) <= 2);
    assert.ok(Math.abs((out[1] ?? 0) - 128) <= 2);
    assert.ok(Math.abs((out[2] ?? 0) - 128) <= 2);
  });

  it("measures clipping", () => {
    const frame = solid(2, 1, [255, 255, 255]);
    frame[4] = 0;
    frame[5] = 0;
    frame[6] = 0;
    const m = measure(frame, 2, 1);
    assert.equal(m.highlightClip, 0.5);
    assert.equal(m.shadowClip, 0.5);
  });

  it("raises exposure when asked", () => {
    const frame = solid(2, 2, [40, 40, 40]);
    const brighter = exposeEv(frame, 1);
    assert.ok(brighter[0]! > frame[0]!);
  });
});
