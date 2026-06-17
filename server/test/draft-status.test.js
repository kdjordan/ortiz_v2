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

describe('draft status', () => {
  it('reports no pending changes on a fresh draft', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    const res = await app.inject({ method: 'GET', url: '/api/draft/status', cookies })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ pending: 0, hasChanges: false })
  })

  it('counts a draft edit as pending, then back to zero after publish', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    await app.inject({
      method: 'PATCH',
      url: '/api/works/alpha',
      cookies,
      payload: { holder: 'Edited', desc: 'Edited desc', year: 2020 },
    })

    const afterEdit = await app.inject({ method: 'GET', url: '/api/draft/status', cookies })
    expect(afterEdit.json().pending).toBeGreaterThanOrEqual(1)
    expect(afterEdit.json().hasChanges).toBe(true)

    await app.inject({ method: 'POST', url: '/api/publish', cookies })

    const afterPublish = await app.inject({ method: 'GET', url: '/api/draft/status', cookies })
    expect(afterPublish.json()).toEqual({ pending: 0, hasChanges: false })
  })
})

describe('discard draft', () => {
  it('resets cms-draft to main: status returns to zero and the edits are gone', async () => {
    app = await makeApp()
    const cookies = await authedCookie()

    // Stage two unpublished edits onto the draft.
    await app.inject({
      method: 'PATCH',
      url: '/api/works/alpha',
      cookies,
      payload: { holder: 'Drafty', desc: 'Drafty desc', year: 2020 },
    })
    await app.inject({
      method: 'PATCH',
      url: '/api/works/beta',
      cookies,
      payload: { holder: 'Also drafty', desc: 'Also drafty desc', year: 2021 },
    })

    const before = await app.inject({ method: 'GET', url: '/api/draft/status', cookies })
    expect(before.json().pending).toBeGreaterThanOrEqual(2)

    const res = await app.inject({ method: 'POST', url: '/api/draft/discard', cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    const after = await app.inject({ method: 'GET', url: '/api/draft/status', cookies })
    expect(after.json()).toEqual({ pending: 0, hasChanges: false })

    // Assert against the bare repo (the source of truth): cms-draft now carries
    // the original main captions, i.e. the drafted edits are gone.
    const { bareDir } = app.testCtx
    const draft = JSON.parse(await showFile(bareDir, 'cms-draft', 'src/gallery.json'))
    const alpha = draft.works.find((w) => w.id === 'alpha')
    expect(alpha.caption).toEqual({ holder: 'Sculpture', desc: 'First test work', year: 2018 })
    const beta = draft.works.find((w) => w.id === 'beta')
    expect(beta.caption).toEqual({ holder: 'Relief', desc: 'Second test work', year: 2019 })
  })
})

describe('auth gating', () => {
  it('rejects reading draft status without a session', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/draft/status' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects discarding the draft without a session', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/api/draft/discard' })
    expect(res.statusCode).toBe(401)
  })
})
