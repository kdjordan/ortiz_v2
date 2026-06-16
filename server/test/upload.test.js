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
