import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { applyEdits } from '../images.js'

// A solid-colour image so every output pixel is identical — lets us assert the
// exact colour map without lossy-encoder noise (raw output, no AVIF/JPEG).
function solid(value, { width = 8, height = 8 } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: value, g: value, b: value } },
  })
    .png()
    .toBuffer()
}

// First pixel's RGB of applyEdits' raw (un-encoded) output.
async function firstPixel(buffer, edit) {
  const { data } = await applyEdits(buffer, edit).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return [data[0], data[1], data[2]]
}

// The browser's `filter: brightness(b) contrast(c)` on an 8-bit sRGB value:
// brightness(b) -> v*b, then contrast(c) -> (v-128)*c + 128. This is the preview
// the editor shows; sharp must reproduce it.
function cssFilter(v, b, c) {
  const bright = v * b
  const out = (bright - 128) * c + 128
  return Math.round(out)
}

describe('applyEdits colour map matches the CSS brightness()/contrast() preview', () => {
  it('reproduces the CSS affine map exactly on a known mid-grey pixel', async () => {
    const v = 128
    const b = 1.1
    const c = 1.2
    const [r, g, bl] = await firstPixel(await solid(v), { brightness: b, contrast: c })
    const expected = cssFilter(v, b, c) // (1.2*1.1)*128 + 128*(1-1.2) = 143.36 -> 143
    expect(expected).toBe(143)
    // sharp.linear rounds to the nearest integer; allow ±1 for rounding.
    expect(Math.abs(r - expected)).toBeLessThanOrEqual(1)
    expect(g).toBe(r)
    expect(bl).toBe(r)
  })

  it('reproduces the CSS map on an off-centre pixel (contrast pivots about 128)', async () => {
    const v = 200
    const b = 1
    const c = 1.4
    const [r] = await firstPixel(await solid(v), { brightness: b, contrast: c })
    const expected = cssFilter(v, b, c) // 1.4*200 + 128*(1-1.4) = 228.8 -> 229
    expect(expected).toBe(229)
    expect(Math.abs(r - expected)).toBeLessThanOrEqual(1)
  })

  it('treats identity (brightness:1, contrast:1) as a byte-for-byte no-op', async () => {
    const buf = await solid(100)
    const plain = await applyEdits(buf, {}).raw().toBuffer()
    const identity = await applyEdits(buf, { brightness: 1, contrast: 1 }).raw().toBuffer()
    expect(Buffer.compare(plain, identity)).toBe(0)
  })
})

describe('applyEdits colour direction', () => {
  // Mean luma of the raw output — the simplest observable of "brighter".
  async function meanLuma(buffer, edit) {
    const { data } = await applyEdits(buffer, edit).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]
    return sum / data.length
  }

  it('brightness > 1 raises mean luma', async () => {
    const buf = await solid(120)
    const base = await meanLuma(buf, {})
    const brighter = await meanLuma(buf, { brightness: 1.5, contrast: 1 })
    expect(brighter).toBeGreaterThan(base)
  })

  it('contrast > 1 pushes a dark pixel darker (widens the spread)', async () => {
    const buf = await solid(80) // below the 128 pivot
    const base = await meanLuma(buf, {})
    const harder = await meanLuma(buf, { brightness: 1, contrast: 1.5 })
    expect(harder).toBeLessThan(base)
  })
})

describe('applyEdits pipeline order', () => {
  it('applies colour before tilt so the tilt-exposed corners stay transparent', async () => {
    // A solid opaque image; after a tilt the corners are added by .rotate() with a
    // transparent background. Colour runs first, so it never touches that alpha.
    const buf = await solid(120, { width: 200, height: 100 })
    const { data, info } = await applyEdits(buf, { brightness: 1.4, contrast: 1.2, tilt: 10 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4) // rotate added an alpha channel
    // Top-left pixel is an exposed corner -> fully transparent (alpha 0).
    expect(data[3]).toBe(0)
  })
})
