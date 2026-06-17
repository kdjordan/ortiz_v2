import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  extractSessionCookie,
  listFiles,
  makeApp,
  multipartBody,
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

function testImage({ width = 1200, height = 800, format = 'png' } = {}) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    [format]()
    .toBuffer()
}

// Upload a real image so a delete has a committed original + variant set to remove
// (the fixture works have no image bytes in the bare repo).
async function uploadWork(cookies) {
  const { payload, headers } = multipartBody({
    file: { contentType: 'image/png', filename: 'photo.png', buffer: await testImage() },
  })
  const res = await app.inject({ method: 'POST', url: '/api/works', cookies, headers, payload })
  expect(res.statusCode).toBe(201)
  return res.json().work
}

function draftGallery(bareDir) {
  return showFile(bareDir, 'cms-draft', 'src/gallery.json').then(JSON.parse)
}

describe('reorder works -> cms-draft', () => {
  it('renumbers order to the new sequence and commits to cms-draft', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { bareDir } = app.testCtx

    // Fixture is [alpha (0), beta (1)]; reverse it.
    const res = await app.inject({
      method: 'PUT',
      url: '/api/works/order',
      cookies,
      payload: { ids: ['beta', 'alpha'] },
    })

    expect(res.statusCode).toBe(200)

    const draft = await draftGallery(bareDir)
    const byId = Object.fromEntries(draft.works.map((w) => [w.id, w.order]))
    expect(byId).toEqual({ beta: 0, alpha: 1 })

    // main is untouched until publish.
    const main = JSON.parse(await showFile(bareDir, 'main', 'src/gallery.json'))
    expect(Object.fromEntries(main.works.map((w) => [w.id, w.order]))).toEqual({
      alpha: 0,
      beta: 1,
    })
  })

  it('rejects an id set that does not match the gallery exactly with 400', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    const cases = [
      ['alpha'], // missing one
      ['alpha', 'beta', 'gamma'], // extra/unknown
      ['alpha', 'alpha'], // duplicate
      ['alpha', 'ghost'], // right count, unknown id
    ]
    for (const ids of cases) {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/works/order',
        cookies,
        payload: { ids },
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('carries the new order through to main on publish', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { bareDir } = app.testCtx

    await app.inject({
      method: 'PUT',
      url: '/api/works/order',
      cookies,
      payload: { ids: ['beta', 'alpha'] },
    })
    await app.inject({ method: 'POST', url: '/api/publish', cookies })

    const main = JSON.parse(await showFile(bareDir, 'main', 'src/gallery.json'))
    expect(Object.fromEntries(main.works.map((w) => [w.id, w.order]))).toEqual({
      beta: 0,
      alpha: 1,
    })
  })

  it('rejects a reorder without a session', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/works/order',
      payload: { ids: ['beta', 'alpha'] },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('delete work -> cms-draft', () => {
  it('removes the gallery record and every file (original + 6 variants) from cms-draft', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { bareDir } = app.testCtx
    const { id } = await uploadWork(cookies)

    // The upload committed the original + all 6 variants.
    const before = await listFiles(bareDir, 'cms-draft')
    expect(before).toContain(`source-images/${id}.png`)

    const res = await app.inject({ method: 'DELETE', url: `/api/works/${id}`, cookies })
    expect(res.statusCode).toBe(200)

    // The record is gone from the gallery.
    const draft = await draftGallery(bareDir)
    expect(draft.works.some((w) => w.id === id)).toBe(false)

    // Every file for the work is gone from the cms-draft tree.
    const after = await listFiles(bareDir, 'cms-draft')
    expect(after).not.toContain(`source-images/${id}.png`)
    for (const w of [450, 900]) {
      for (const ext of ['avif', 'webp', 'jpg']) {
        expect(after).not.toContain(`public/images/opt/${id}-${w}.${ext}`)
      }
    }
  })

  it('leaves main untouched until publish, then carries the deletion through', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const { bareDir } = app.testCtx

    // Delete a fixture work (alpha). main still has it until publish.
    const res = await app.inject({ method: 'DELETE', url: '/api/works/alpha', cookies })
    expect(res.statusCode).toBe(200)

    const mainBefore = JSON.parse(await showFile(bareDir, 'main', 'src/gallery.json'))
    expect(mainBefore.works.some((w) => w.id === 'alpha')).toBe(true)

    await app.inject({ method: 'POST', url: '/api/publish', cookies })

    const mainAfter = JSON.parse(await showFile(bareDir, 'main', 'src/gallery.json'))
    expect(mainAfter.works.some((w) => w.id === 'alpha')).toBe(false)
  })

  it('returns 404 for an unknown work id', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const res = await app.inject({ method: 'DELETE', url: '/api/works/does-not-exist', cookies })
    expect(res.statusCode).toBe(404)
  })

  it('rejects a delete without a session', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/works/alpha' })
    expect(res.statusCode).toBe(401)
  })
})
