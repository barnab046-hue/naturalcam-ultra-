/** Geometric test chart. Not a photograph and not a face. */

function put(
  data: Uint8ClampedArray,
  w: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
) {
  const p = (y * w + x) * 4;
  data[p] = r;
  data[p + 1] = g;
  data[p + 2] = b;
  data[p + 3] = 255;
}

export function makeTestChart(w = 640, h = 400): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) put(data, w, x, y, 22, 22, 20);
  }
  const rampH = Math.round(h * 0.22);
  for (let y = 0; y < rampH; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      put(data, w, x, y, v, v, v);
    }
  }
  const patches: Array<[number, number, number]> = [
    [214, 168, 142],
    [241, 208, 180],
    [140, 96, 74],
    [92, 62, 48],
    [180, 40, 40],
    [40, 140, 70],
    [40, 80, 180],
    [128, 128, 128],
  ];
  const top = rampH + 16;
  const size = Math.floor(Math.min(64, (w - 32) / patches.length - 8));
  patches.forEach((rgb, index) => {
    const x0 = 16 + index * (size + 8);
    for (let y = top; y < top + size; y++) {
      for (let x = x0; x < x0 + size; x++) put(data, w, x, y, rgb[0], rgb[1], rgb[2]);
    }
  });
  const edgeY = top + size + 24;
  for (let y = edgeY; y < Math.min(h - 24, edgeY + 80); y++) {
    for (let x = 0; x < w; x++) {
      const on = x > w * 0.45 && x < w * 0.55;
      const fine = y > edgeY + 48 && x % 2 === 0;
      if (fine) put(data, w, x, y, 230, 230, 226);
      else if (on) put(data, w, x, y, 245, 245, 242);
      else put(data, w, x, y, 12, 12, 12);
    }
  }
  return data;
}
