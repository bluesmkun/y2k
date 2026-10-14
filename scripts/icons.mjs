// Draws the 180x180 home-screen icon iOS demands, with no image library: a PNG is
// a zlib stream of filtered scanlines, and zlib is in Node's standard library.
// iOS only reads PNG here and fills transparency with black, so the icon is
// opaque. Everything comes from the theme's own palette so it cannot drift.
//
// `preview.png`, the panel's preview card, is not drawn here: it is a real
// screenshot of the built theme, which shows the actual thing rather than an
// approximation of it. See the README for how to retake it.
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** `pixels` is RGBA, row-major, `width * height * 4` bytes. */
function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // 10-12 stay zero: deflate, adaptive filtering, no interlace.
  // One filter byte per scanline, all zero (None): these images are flat enough
  // that the extra pass of a real filter would not pay for itself.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// --- a tiny painter ---------------------------------------------------------

function canvas(width, height) {
  return { width, height, px: Buffer.alloc(width * height * 4, 255) }
}

/** Alpha-composites `colour` (each 0-1, alpha 0-1) over the pixel at `x, y`. */
function blend(img, x, y, [r, g, b], a = 1) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height || a <= 0) return
  const i = (y * img.width + x) * 4
  img.px[i] = img.px[i] + (r * 255 - img.px[i]) * a
  img.px[i + 1] = img.px[i + 1] + (g * 255 - img.px[i + 1]) * a
  img.px[i + 2] = img.px[i + 2] + (b * 255 - img.px[i + 2]) * a
  img.px[i + 3] = 255
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255]

/** Anti-aliased coverage of a shape given as a signed distance, in pixels. */
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d))

function disc(img, cx, cy, radius, colour, alpha = 1) {
  for (let y = Math.floor(cy - radius - 1); y <= cy + radius + 1; y++) {
    for (let x = Math.floor(cx - radius - 1); x <= cx + radius + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius
      blend(img, x, y, colour, cover(d) * alpha)
    }
  }
}

function ring(img, cx, cy, radius, width, colour, alpha = 1) {
  for (let y = Math.floor(cy - radius - width); y <= cy + radius + width; y++) {
    for (let x = Math.floor(cx - radius - width); x <= cx + radius + width; x++) {
      const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius) - width / 2
      blend(img, x, y, colour, cover(d) * alpha)
    }
  }
}

/** Vertical gradient over the whole canvas. */
function gradient(img, top, bottom) {
  for (let y = 0; y < img.height; y++) {
    const colour = mix(top, bottom, y / (img.height - 1))
    for (let x = 0; x < img.width; x++) blend(img, x, y, colour, 1)
  }
}

/** A fixed starfield: a hash, not Math.random, so the icon is reproducible. */
function stars(img, count, seed) {
  let s = seed
  const next = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < count; i++) {
    const x = next() * img.width
    const y = next() * img.height * 0.9
    const r = 0.6 + next() * 1.5
    disc(img, x, y, r, hex("#eaf6ff"), 0.35 + next() * 0.55)
  }
}

/** The horizon grid, in perspective: rows converge toward the vanishing point. */
function perspectiveGrid(img, colour) {
  const vx = img.width / 2
  const horizon = img.height * 0.62
  const bottom = img.height
  for (let i = -14; i <= 14; i++) {
    const xBottom = vx + i * (img.width / 9)
    for (let t = 0; t < 1; t += 0.004) {
      const y = horizon + (bottom - horizon) * t * t
      const x = vx + (xBottom - vx) * t * t
      blend(img, Math.round(x), Math.round(y), colour, 0.5 * t)
      blend(img, Math.round(x) + 1, Math.round(y), colour, 0.3 * t)
    }
  }
  // Horizontal rungs, spaced by the same square-law as the depth.
  for (let i = 1; i <= 9; i++) {
    const t = i / 9
    const y = horizon + (bottom - horizon) * t * t
    for (let x = 0; x < img.width; x++) blend(img, x, Math.round(y), colour, 0.34 * (1 - t * 0.5))
  }
}

// --- the icon ---------------------------------------------------------------

/**
 * The mark: a chrome-ringed status LED over the horizon grid, on the theme's
 * night-sky gradient. Drawn at `size` with every dimension proportional, so the
 * 180px icon and the 640px preview card are the same picture.
 */
function draw(size) {
  const img = canvas(size, size)
  const u = size / 180
  gradient(img, hex("#050a1e"), hex("#123a6e"))
  stars(img, Math.round(size * 0.5), 20000114)
  perspectiveGrid(img, hex("#4fd2ff"))

  const cx = size / 2
  const cy = size * 0.44
  const r = size * 0.27

  // The glow behind the mark, built from rings rather than a blur.
  for (let i = 12; i >= 1; i--) ring(img, cx, cy, r + i * 1.6 * u, i * 1.6 * u, hex("#4fd2ff"), 0.035)
  // The chrome bezel: a light top-left and a dark bottom-right, as a 1999 panel.
  ring(img, cx, cy, r, 7 * u, hex("#8fb6d8"), 0.9)
  ring(img, cx - 1.2 * u, cy - 1.2 * u, r, 2.4 * u, hex("#dff3ff"), 0.95)
  ring(img, cx + 1.4 * u, cy + 1.4 * u, r, 2.4 * u, hex("#4a6c93"), 0.9)
  // The dial face, recessed.
  disc(img, cx, cy, r - 3.4 * u, hex("#050d20"), 0.94)
  disc(img, cx, cy, r - 3.4 * u, mix(hex("#050d20"), hex("#4fd2ff"), 0.22), 0.5)

  // The LED itself, with its highlight.
  disc(img, cx, cy, r * 0.42, hex("#45f0a8"), 1)
  disc(img, cx - r * 0.13, cy - r * 0.15, r * 0.16, hex("#eafff5"), 0.85)

  // A signal trace across the face, the thing a probe theme is about.
  for (let x = -r * 0.92; x <= r * 0.92; x += 0.5) {
    const t = x / r
    const y = cy + r * 0.62 + Math.sin(t * 7) * r * 0.11
    if (Math.hypot(x, y - cy) < r - 5 * u) {
      blend(img, Math.round(cx + x), Math.round(y), hex("#b6f2ff"), 0.9)
      blend(img, Math.round(cx + x), Math.round(y) + 1, hex("#4fd2ff"), 0.35)
    }
  }
  return img
}

// --- write ------------------------------------------------------------------

mkdirSync(join(ROOT, "public"), { recursive: true })
const icon = draw(180)
writeFileSync(join(ROOT, "public", "apple-touch-icon.png"), png(icon.width, icon.height, icon.px))
console.log("wrote public/apple-touch-icon.png (180x180)")
