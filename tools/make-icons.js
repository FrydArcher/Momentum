// Draws the Momentum icon (a gold arc with a dot ahead of it) as PNGs.
// Run: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3, [r, g, b] = px(x, y);
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function draw(size) {
  const bgTop = [42, 33, 20], bgBot = [16, 13, 9];
  const goldA = [244, 205, 112], goldB = [196, 140, 46];
  const R = 0.27, T = 0.085;            // arc radius and thickness (fraction of size)
  const start = (150 * Math.PI) / 180;  // arc runs clockwise from 150° to 410° (screen coords)
  const sweep = (260 * Math.PI) / 180;
  const end = start + sweep;
  const dotA = end + 0.42, dotR = T * 0.62;
  const SS = 4;
  return png(size, (x, y) => {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (x + (sx + 0.5) / SS) / size - 0.5, v = (y + (sy + 0.5) / SS) / size - 0.5;
      let col = mix(bgTop, bgBot, v + 0.5);
      const r = Math.hypot(u, v);
      let a = Math.atan2(v, u); while (a < start) a += 2 * Math.PI;
      const along = (a - start) / sweep;
      const capS = Math.hypot(u - R * Math.cos(start), v - R * Math.sin(start)) < T / 2;
      const capE = Math.hypot(u - R * Math.cos(end), v - R * Math.sin(end)) < T / 2;
      const onArc = (Math.abs(r - R) < T / 2 && along <= 1) || capS || capE;
      if (onArc) col = mix(goldB, goldA, capS ? 0 : capE ? 1 : Math.min(1, along));
      if (Math.hypot(u - R * Math.cos(dotA), v - R * Math.sin(dotA)) < dotR) col = goldA;
      acc = acc.map((c, i) => c + col[i]);
    }
    return acc.map(c => Math.round(c / (SS * SS)));
  });
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [180, 192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), draw(s));
console.log('icons written to', out);
