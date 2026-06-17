import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  extractSessionCookie,
  makeApp,
  multipartBody,
  showBuffer,
  showFile,
  TEST_PASSWORD,
} from './helpers.js'

let app

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function authedCookie() {
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password: TEST_PASSWORD },
  })
  return extractSessionCookie(login)
}

function testImage({ width = 1600, height = 1000, format = 'png' } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    [format]()
    .toBuffer()
}

// Upload a real image so the edit endpoint has a committed pristine original to
// reprocess from (the fixture works have no original bytes in the bare repo).
async function uploadWork(cookies) {
  const { payload, headers } = multipartBody({
    file: { contentType: 'image/png', filename: 'photo.png', buffer: await testImage() },
  })
  const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
  expect(res.statusCode).toBe(201)
  return res.json().work
}

// Dimensions of a committed variant, read straight from cms-draft with sharp.
async function variantSize(bareDir, id, width, ext) {
  const buf = await showBuffer(bareDir, 'cms-draft', `public/images/opt/${id}-${width}.${ext}`)
  const meta = await sharp(buf).metadata()
  return { width: meta.width, height: meta.height }
}

describe('edit (crop + tilt) -> cms-draft', () => {
  it('reprocesses the variants from the original to reflect the crop', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)
    const { bareDir } = app.testCtx

    // 1600x1000 (aspect 1.6) identity 450 variant: 450x281.
    const before = await variantSize(bareDir, id, 450, 'avif')
    expect(before.width).toBe(450)

    // Crop an 800x400 (aspect 2.0) rectangle, no tilt.
    const crop = { x: 200, y: 100, w: 800, h: 400 }
    const res = await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      payload: { crop, tilt: 0 },
    })

    expect(res.statusCode).toBe(200)
    const work = res.json().work
    // brightness/contrast are untouched (#7); crop + tilt are stored.
    expect(work.edit).toEqual({ brightness: 1, contrast: 1, crop, tilt: 0 })

    // The 800x400 crop scaled to 450 wide -> 450x225 (aspect 2.0), differing from
    // the identity 450x281. Proves the variant reflects the crop rectangle.
    const after = await variantSize(bareDir, id, 450, 'avif')
    expect(after).toEqual({ width: 450, height: 225 })
    expect(after.height).not.toBe(before.height)
  })

  it('stores the crop rect + tilt in cms-draft gallery.json', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)
    const { bareDir } = app.testCtx

    const crop = { x: 0, y: 0, w: 600, h: 600 }
    await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      payload: { crop, tilt: 5 },
    })

    const draft = JSON.parse(await showFile(bareDir, 'cms-draft', 'src/gallery.json'))
    const stored = draft.works.find((w) => w.id === id)
    expect(stored.edit).toEqual({ brightness: 1, contrast: 1, crop, tilt: 5 })
  })

  it('reprocesses from the pristine original (not cumulatively from a prior render)', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)
    const { bareDir } = app.testCtx

    const cropA = { x: 200, y: 100, w: 800, h: 400 }
    const cropB = { x: 0, y: 0, w: 300, h: 300 }

    // Edit A, then a much smaller crop B, then A again. If the server cropped the
    // *previous render* rather than the original, the second A (an 800x400 window)
    // would fall outside B's 300x300 output and fail. Re-deriving from the pristine
    // 1600x1000 original must reproduce A's variant byte-for-byte.
    await app.inject({ method: 'PUT', url: `/api/works/${id}/edit`, cookies, payload: { crop: cropA, tilt: 0 } })
    const firstA = await showBuffer(bareDir, 'cms-draft', `public/images/opt/${id}-450.avif`)

    await app.inject({ method: 'PUT', url: `/api/works/${id}/edit`, cookies, payload: { crop: cropB, tilt: 0 } })

    const res = await app.inject({ method: 'PUT', url: `/api/works/${id}/edit`, cookies, payload: { crop: cropA, tilt: 0 } })
    expect(res.statusCode).toBe(200)
    const secondA = await showBuffer(bareDir, 'cms-draft', `public/images/opt/${id}-450.avif`)

    expect(Buffer.compare(firstA, secondA)).toBe(0)
  })

  it('reflects tilt by reprocessing from the original', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)
    const { bareDir } = app.testCtx

    const before = await variantSize(bareDir, id, 450, 'avif')

    const res = await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      payload: { crop: null, tilt: 8 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().work.edit.tilt).toBe(8)

    // Rotating 1600x1000 by 8deg expands the canvas to its bounding box, changing
    // the aspect ratio -> the 450 variant's height shifts away from the identity.
    const after = await variantSize(bareDir, id, 450, 'avif')
    expect(after.width).toBe(450)
    expect(after.height).not.toBe(before.height)
  })

  it('leaves main untouched (edit commits only to cms-draft)', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)
    const { bareDir } = app.testCtx

    await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      payload: { crop: { x: 0, y: 0, w: 400, h: 400 }, tilt: 0 },
    })

    // The uploaded work only exists on cms-draft; main must not contain it.
    const main = JSON.parse(await showFile(bareDir, 'main', 'src/gallery.json'))
    expect(main.works.find((w) => w.id === id)).toBeUndefined()
  })
})

describe('edit validation', () => {
  it('rejects a crop outside the image bounds with 400', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      // x + w = 1700 > 1600 image width.
      payload: { crop: { x: 1000, y: 0, w: 700, h: 400 }, tilt: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-finite tilt with 400', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      payload: { crop: null, tilt: 'wonky' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a tilt outside the sane straighten range with 400', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      payload: { crop: null, tilt: 120 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a crop with non-finite/negative dimensions with 400', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)

    const res = await app.inject({
      method: 'PUT',
      url: `/api/works/${id}/edit`,
      cookies,
      payload: { crop: { x: 0, y: 0, w: -10, h: 400 }, tilt: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for an unknown work id', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/works/does-not-exist/edit',
      cookies,
      payload: { crop: null, tilt: 0 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects an edit without a session', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/works/alpha/edit',
      payload: { crop: null, tilt: 0 },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('fetch original for editing', () => {
  it('returns the pristine original bytes for an authed session', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { id } = await uploadWork(cookies)

    const res = await app.inject({ method: 'GET', url: `/api/works/${id}/original`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    // It is a real PNG at the original dimensions.
    const meta = await sharp(res.rawPayload).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(1600)
    expect(meta.height).toBe(1000)
  })

  it('rejects fetching the original without a session', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/works/alpha/original' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for an unknown work id', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const res = await app.inject({ method: 'GET', url: '/api/works/does-not-exist/original', cookies })
    expect(res.statusCode).toBe(404)
  })
})
