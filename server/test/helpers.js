import { scryptSync, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../app.js'

export const TEST_PASSWORD = 'correct-horse-battery-staple'

// Mirrors the scrypt scheme the server verifies against (salt:derivedKey, hex).
export function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, 64)
  return `${salt.toString('hex')}:${derived.toString('hex')}`
}

const FIXTURE_GALLERY = fileURLToPath(new URL('./fixtures/gallery.json', import.meta.url))

// Pulls the signed `session` cookie out of a login response into the {name: value}
// shape that Fastify's inject() accepts, so a follow-up request carries the session.
export function extractSessionCookie(loginRes) {
  const setCookie = loginRes.headers['set-cookie']
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie]
  const session = headers.find((h) => h?.startsWith('session='))
  const value = session.slice('session='.length).split(';')[0]
  return { session: decodeURIComponent(value) }
}

export function makeApp(overrides = {}) {
  return buildApp({
    passwordHash: hashPassword(TEST_PASSWORD),
    cookieSecret: 'test-cookie-secret-needs-to-be-long-enough',
    galleryPath: FIXTURE_GALLERY,
    ...overrides,
  })
}
