// Generates the app icons in public/icons. Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${pad ? 0 : size * 0.18}" fill="#0f766e"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size * (pad ? 0.34 : 0.42)}" fill="#ffffff">BF</text>
</svg>`;

mkdirSync("public/icons", { recursive: true });
const out = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];
for (const [name, size, pad] of out) {
  await sharp(Buffer.from(svg(size, pad))).png().toFile(`public/icons/${name}`);
}
await sharp(Buffer.from(svg(48, false))).png().toFile("public/icons/favicon-48.png");
console.log("Icons written to public/icons");
