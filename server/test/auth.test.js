import { afterEach, describe, expect, it } from 'vitest'
import { extractSessionCookie, makeApp, TEST_PASSWORD } from './helpers.js'

let app

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('works listing auth gating', () => {
  it('rejects the works list without a session', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/api/works' })
    expect(res.statusCode).toBe(401)
  })
})

describe('login', () => {
  it('sets an httpOnly session cookie on the correct password', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: TEST_PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    const setCookie = res.headers['set-cookie']
    expect(setCookie).toBeTruthy()
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie
    expect(cookieStr).toMatch(/session=/)
    expect(cookieStr).toMatch(/HttpOnly/i)
    expect(cookieStr).toMatch(/SameSite=Lax/i)
  })

  it('rejects the wrong password with 401 and no cookie', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.headers['set-cookie']).toBeUndefined()
  })
})

describe('works listing with a session', () => {
  it('returns the gallery works once authenticated', async () => {
    app = await makeApp()
    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { password: TEST_PASSWORD },
    })
    const res = await app.inject({
      method: 'GET',
      url: '/api/works',
      cookies: extractSessionCookie(login),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.works).toHaveLength(2)
    expect(body.works.map((w) => w.id)).toEqual(['alpha', 'beta'])
  })
})

describe('logout', () => {
  it('clears the session cookie', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/api/logout' })
    expect(res.statusCode).toBe(200)
    const setCookie = res.headers['set-cookie']
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie
    // Cleared cookie is set with an expiry in the past / empty value.
    expect(cookieStr).toMatch(/session=;/)
    expect(cookieStr).toMatch(/Expires=Thu, 01 Jan 1970/i)
  })
})

describe('login rate limiting', () => {
  it('returns 429 after too many attempts', async () => {
    app = await makeApp({ rateLimit: { max: 2, timeWindow: '1 minute' } })
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/login',
        payload: { password: 'wrong-password' },
      })

    expect((await attempt()).statusCode).toBe(401)
    expect((await attempt()).statusCode).toBe(401)
    // Third attempt exceeds max=2 within the window.
    expect((await attempt()).statusCode).toBe(429)
  })
})
