// Run with: node generate_icons.js
// Generates icons/icon16.png, icon48.png, icon128.png
// Requires: npm install canvas  (or: brew install pkg-config cairo pango && npm install canvas)

const { createCanvas } = require('canvas');
const fs = require('fs');

if (!fs.existsSync('icons')) fs.mkdirSync('icons');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx    = canvas.getContext('2d');
  const cx     = size / 2;
  const cy     = size / 2;
  const r      = size / 2;

  // Red circle background
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#FF0000';
  ctx.fill();

  // White play triangle
  const t = size * 0.28;
  ctx.beginPath();
  ctx.moveTo(cx - t * 0.5, cy - t);
  ctx.lineTo(cx - t * 0.5, cy + t);
  ctx.lineTo(cx + t,        cy);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  return canvas.toBuffer('image/png');
}

[16, 48, 128].forEach(size => {
  fs.writeFileSync(`icons/icon${size}.png`, drawIcon(size));
  console.log(`icons/icon${size}.png written`);
});
