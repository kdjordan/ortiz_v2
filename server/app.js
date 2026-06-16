import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { scryptSync, timingSafeEqual } from 'node:crypto'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'

const SESSION_COOKIE = 'session'
const SESSION_VALUE = 'ok'

// Constant-time verify of `password` against a stored `saltHex:derivedKeyHex` scrypt hash.
function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false
  const [saltHex, keyHex] = storedHash.split(':')
  if (!saltHex || !keyHex) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// Default gallery source: the #2 contract file at the repo root (../src/gallery.json).
const DEFAULT_GALLERY_PATH = fileURLToPath(new URL('../src/gallery.json', import.meta.url))

export function buildApp(opts = {}) {
  const cookieSecret = opts.cookieSecret ?? process.env.COOKIE_SECRET
  const passwordHash = opts.passwordHash ?? process.env.ADMIN_PASSWORD_HASH
  const galleryPath = opts.galleryPath ?? DEFAULT_GALLERY_PATH
  const loginRateLimit = opts.rateLimit ?? { max: 10, timeWindow: '1 minute' }

  const app = Fastify({ logger: false })

  app.register(cookie, { secret: cookieSecret })
  // Registered globally but opted in per-route, so only login is throttled.
  app.register(rateLimit, { global: false })

  // Rejects any request that does not carry a valid, signed session cookie.
  async function requireSession(request, reply) {
    const raw = request.cookies[SESSION_COOKIE]
    const unsigned = raw ? request.unsignCookie(raw) : null
    if (!unsigned?.valid || unsigned.value !== SESSION_VALUE) {
      reply.code(401).send({ error: 'unauthorized' })
    }
  }

  // Routes live in a child plugin so they register *after* @fastify/rate-limit's
  // onRoute hook is in place — otherwise the per-route limit never attaches.
  app.register(async (routes) => {
    routes.post('/api/login', { config: { rateLimit: loginRateLimit } }, async (request, reply) => {
      const password = request.body?.password
      if (!verifyPassword(password, passwordHash)) {
        return reply.code(401).send({ error: 'invalid credentials' })
      }
      reply.setCookie(SESSION_COOKIE, SESSION_VALUE, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        signed: true,
      })
      return { ok: true }
    })

    routes.post('/api/logout', async (request, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: '/' })
      return { ok: true }
    })

    routes.get('/api/works', { preHandler: requireSession }, async () => {
      const gallery = JSON.parse(await readFile(galleryPath, 'utf8'))
      return { works: gallery.works }
    })
  })

  return app
}
