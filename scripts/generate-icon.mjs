/**
 * Sinh build/icon.ico (256x256, PNG-encoded ICO) không cần thư viện ngoài.
 * Chạy: node scripts/generate-icon.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 256;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
const cx = SIZE / 2 - 0.5;
const cy = SIZE / 2 - 0.5;
const pinRadius = SIZE * 0.32;

for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    const dx = x - cx;
    const dy = y - cy;
    // Giọt ghim: hình tròn + mũi nhọn hướng xuống.
    const inCircle = dx * dx + dy * dy <= pinRadius * pinRadius;
    const inTail = y > cy && Math.abs(dx) <= (SIZE * 0.30) * (1 - (y - cy) / (SIZE * 0.42));
    const inPin = inCircle || inTail;
    const inHole = dx * dx + dy * dy <= (pinRadius * 0.42) ** 2;
    const index = rowStart + 1 + x * 4;
    if (inPin && !inHole) {
      // Teal 700 (#0f766e) -> emerald ở đỉnh
      const t = Math.min(1, Math.max(0, (y / SIZE)));
      raw[index] = Math.round(16 + (5 - 16) * t);
      raw[index + 1] = Math.round(118 + (150 - 118) * t);
      raw[index + 2] = Math.round(110 + (105 - 110) * t);
      raw[index + 3] = 255;
    } else {
      raw[index] = 0;
      raw[index + 1] = 0;
      raw[index + 2] = 0;
      raw[index + 3] = 0;
    }
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256
entry[1] = 0; // height 256
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12); // offset

mkdirSync("build", { recursive: true });
writeFileSync("build/icon.ico", Buffer.concat([header, entry, png]));
writeFileSync("build/icon.png", png);
console.log("Đã tạo build/icon.ico và build/icon.png (256x256)");
