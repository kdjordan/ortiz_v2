import { afterEach, describe, expect, it } from 'vitest'
import { extractSessionCookie, makeApp, showFile, TEST_PASSWORD } from './helpers.js'

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

describe('caption edit -> cms-draft', () => {
  it('commits the new caption to cms-draft and leaves main untouched', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/works/alpha',
      cookies,
      payload: { holder: 'Updated Holder', desc: 'Updated desc', year: 2020 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().work.caption).toEqual({
      holder: 'Updated Holder',
      desc: 'Updated desc',
      year: 2020,
    })

    const { bareDir } = app.testCtx
    const draft = JSON.parse(await showFile(bareDir, 'cms-draft', 'src/gallery.json'))
    const alphaDraft = draft.works.find((w) => w.id === 'alpha')
    expect(alphaDraft.caption).toEqual({
      holder: 'Updated Holder',
      desc: 'Updated desc',
      year: 2020,
    })

    // main is the source of truth for the live site — it must not move on a draft edit.
    const main = JSON.parse(await showFile(bareDir, 'main', 'src/gallery.json'))
    const alphaMain = main.works.find((w) => w.id === 'alpha')
    expect(alphaMain.caption).toEqual({
      holder: 'Sculpture',
      desc: 'First test work',
      year: 2018,
    })
  })
})

describe('publish -> main', () => {
  it('merges the draft caption edit into main', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    await app.inject({
      method: 'PATCH',
      url: '/api/works/beta',
      cookies,
      payload: { holder: 'Published Holder', desc: 'Published desc', year: 2021 },
    })

    const res = await app.inject({ method: 'POST', url: '/api/publish', cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    const { bareDir } = app.testCtx
    const main = JSON.parse(await showFile(bareDir, 'main', 'src/gallery.json'))
    const betaMain = main.works.find((w) => w.id === 'beta')
    expect(betaMain.caption).toEqual({
      holder: 'Published Holder',
      desc: 'Published desc',
      year: 2021,
    })
  })
})

describe('auth gating', () => {
  it('rejects a caption edit without a session', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/works/alpha',
      payload: { holder: 'Nope', desc: 'Nope', year: 2020 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects publish without a session', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/api/publish' })
    expect(res.statusCode).toBe(401)
  })
})

describe('caption validation', () => {
  it('rejects an empty holder with 400', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/works/alpha',
      cookies,
      payload: { holder: '  ', desc: 'ok', year: 2020 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a non-numeric year with 400', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/works/alpha',
      cookies,
      payload: { holder: 'ok', desc: 'ok', year: '2020' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for an unknown work id', async () => {
    app = await makeApp()
    const cookies = await authedCookie()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/works/does-not-exist',
      cookies,
      payload: { holder: 'ok', desc: 'ok', year: 2020 },
    })
    expect(res.statusCode).toBe(404)
  })
})
