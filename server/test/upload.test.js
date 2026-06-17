import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  extractSessionCookie,
  listFiles,
  makeApp,
  multipartBody,
  showBuffer,
  showFile,
  TEST_PASSWORD,
} from './helpers.js'

// HEVC decode needs heif-convert (libde265), present in the API container but not
// on a bare host. The HEIC test below skips when it's unavailable so `npm test` on
// a dev machine stays green; it runs in-container (and is verified live).
const HEIF_CONVERT_AVAILABLE = (() => {
  try {
    execFileSync('heif-convert', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const SAMPLE_HEIC = fileURLToPath(new URL('./fixtures/sample.heic', import.meta.url))

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

// A real (small) image generated in-test — no committed fixture needed.
function testImage({ width = 1200, height = 800, format = 'png' } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    [format]()
    .toBuffer()
}

describe('upload -> cms-draft', () => {
  it('appends a gallery record (identity edit, appended order) committed to cms-draft', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    const { payload, headers } = multipartBody({
      fields: { holder: 'New Work', desc: 'A fresh piece', year: '2024' },
      file: { contentType: 'image/png', filename: 'photo.png', buffer: await testImage() },
    })

    const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })

    expect(res.statusCode).toBe(201)
    const work = res.json().work
    expect(work.caption).toEqual({ holder: 'New Work', desc: 'A fresh piece', year: 2024 })
    expect(work.order).toBe(2) // fixture has orders 0 and 1
    expect(work.base).toBe(`/images/opt/${work.id}`)
    expect(work.original).toBe(`source-images/${work.id}.png`)
    expect(work.edit).toEqual({ brightness: 1, contrast: 1, crop: null, tilt: 0 })

    const { bareDir } = app.testCtx
    const draft = JSON.parse(await showFile(bareDir, 'cms-draft', 'src/gallery.json'))
    expect(draft.works).toHaveLength(3)
    expect(draft.works.find((w) => w.id === work.id)).toEqual(work)
  })

  it('commits the pristine original + all 6 variants (450/900 x avif/webp/jpg)', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    const original = await testImage()
    const { payload, headers } = multipartBody({
      file: { contentType: 'image/png', filename: 'photo.png', buffer: original },
    })
    const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
    expect(res.statusCode).toBe(201)
    const { id } = res.json().work

    const { bareDir } = app.testCtx
    const files = await listFiles(bareDir, 'cms-draft')

    // The pristine original is stored byte-for-byte.
    expect(files).toContain(`source-images/${id}.png`)
    expect(await showBuffer(bareDir, 'cms-draft', `source-images/${id}.png`)).toEqual(original)

    // All 6 responsive variants are present.
    for (const w of [450, 900]) {
      for (const ext of ['avif', 'webp', 'jpg']) {
        expect(files).toContain(`public/images/opt/${id}-${w}.${ext}`)
      }
    }

    // A variant is a real image at the expected width.
    const avif450 = await showBuffer(bareDir, 'cms-draft', `public/images/opt/${id}-450.avif`)
    const meta = await sharp(avif450).metadata()
    expect(meta.format).toBe('heif') // sharp reports avif as the heif container
    expect(meta.width).toBe(450)
  })

  it('defaults holder/year when caption fields are omitted', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { payload, headers } = multipartBody({
      file: { contentType: 'image/png', filename: 'photo.png', buffer: await testImage() },
    })
    const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
    expect(res.statusCode).toBe(201)
    const { caption } = res.json().work
    expect(caption.holder).toBe('Untitled')
    expect(typeof caption.year).toBe('number')
  })
})

describe('upload — content-based type detection', () => {
  it('accepts a PNG even when the browser mislabels its MIME (octet-stream)', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    // Browsers often send application/octet-stream for images; the gate must detect
    // the real format from the bytes, not trust the label. (This is the bug that
    // rejected HEIC uploads in prod.)
    const { payload, headers } = multipartBody({
      file: { contentType: 'application/octet-stream', filename: 'photo', buffer: await testImage() },
    })
    const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
    expect(res.statusCode).toBe(201)
    expect(res.json().work.original).toBe(`source-images/${res.json().work.id}.png`)
  })

  it.skipIf(!HEIF_CONVERT_AVAILABLE)(
    'decodes a HEVC HEIC (iPhone) and commits the original + all 6 variants',
    async () => {
      app = await makeApp()
      const cookies = await authedCookie()
      const heic = await readFile(SAMPLE_HEIC)
      // Mislabelled MIME on purpose, exactly like a browser uploading a .heic.
      const { payload, headers } = multipartBody({
        file: { contentType: 'application/octet-stream', filename: 'IMG_0001.HEIC', buffer: heic },
      })
      const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })

      expect(res.statusCode).toBe(201)
      const { id, original } = res.json().work
      expect(original).toBe(`source-images/${id}.heic`) // pristine HEIC archived

      const { bareDir } = app.testCtx
      const files = await listFiles(bareDir, 'cms-draft')
      expect(files).toContain(`source-images/${id}.heic`)
      for (const w of [450, 900]) {
        for (const ext of ['avif', 'webp', 'jpg']) {
          expect(files).toContain(`public/images/opt/${id}-${w}.${ext}`)
        }
      }
      // The variant was really decoded from HEVC and resized, with the fixture's
      // 1000x750 landscape aspect preserved (a rotation/orientation bug would flip it).
      const avif450 = await showBuffer(bareDir, 'cms-draft', `public/images/opt/${id}-450.avif`)
      const vmeta = await sharp(avif450).metadata()
      expect(vmeta.width).toBe(450)
      expect(vmeta.height).toBeLessThan(vmeta.width)
    },
  )
})

describe('upload validation', () => {
  it('rejects an unsupported type with 415', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { payload, headers } = multipartBody({
      file: { contentType: 'text/plain', filename: 'note.txt', buffer: Buffer.from('not an image') },
    })
    const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
    expect(res.statusCode).toBe(415)
  })

  it('rejects a file claiming an image type that sharp cannot decode with 415', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { payload, headers } = multipartBody({
      file: { contentType: 'image/png', filename: 'fake.png', buffer: Buffer.from('still not an image') },
    })
    const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
    expect(res.statusCode).toBe(415)
  })

  it('rejects an oversized file with 413', async () => {
    app = await makeApp({ maxFileBytes: 1024 })
    const cookies = await authedCookie()
    const { payload, headers } = multipartBody({
      file: { contentType: 'image/png', filename: 'big.png', buffer: await testImage() },
    })
    const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
    expect(res.statusCode).toBe(413)
  })

  it('rejects an upload without a session', async () => {
    app = await makeApp()
    const { payload, headers } = multipartBody({
      file: { contentType: 'image/png', filename: 'photo.png', buffer: await testImage() },
    })
    const res = await app.inject({ method: 'POST', url: '/api/works', headers, payload })
    expect(res.statusCode).toBe(401)
  })
})

describe('admin previews + display original', () => {
  it('serves a JPEG thumbnail (preview) for an uploaded work', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { payload, headers } = multipartBody({
      file: { contentType: 'image/png', filename: 'photo.png', buffer: await testImage() },
    })
    const up = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
    const { id } = up.json().work

    const res = await app.inject({ method: 'GET', url: `/api/works/${id}/preview`, cookies })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/jpeg')
    expect((await sharp(res.rawPayload).metadata()).format).toBe('jpeg')
  })

  it('preview is auth-gated and 404s for an unknown id', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const unknown = await app.inject({ method: 'GET', url: '/api/works/nope/preview', cookies })
    expect(unknown.statusCode).toBe(404)
    const noSession = await app.inject({ method: 'GET', url: '/api/works/nope/preview' })
    expect(noSession.statusCode).toBe(401)
  })

  it.skipIf(!HEIF_CONVERT_AVAILABLE)(
    'serves a HEIC original as a browser-displayable JPEG (so the editor can render it)',
    async () => {
      app = await makeApp()
      const cookies = await authedCookie()
      const heic = await readFile(SAMPLE_HEIC)
      const up = await app.inject({
        method: 'POST',
        url: '/api/works',
        cookies,
        ...multipartBody({
          file: { contentType: 'application/octet-stream', filename: 'x.HEIC', buffer: heic },
        }),
      })
      const { id } = up.json().work

      const res = await app.inject({ method: 'GET', url: `/api/works/${id}/original`, cookies })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('image/jpeg')
      expect((await sharp(res.rawPayload).metadata()).format).toBe('jpeg')
    },
  )
})
