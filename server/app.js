import { fileURLToPath } from 'node:url'
import { scryptSync, timingSafeEqual } from 'node:crypto'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { createRepo, WorkNotFoundError } from './repo.js'

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

// Default ephemeral working clone (gitignored; re-cloned on each restart).
const DEFAULT_WORK_DIR = fileURLToPath(new URL('./work', import.meta.url))

// Caption fields the CMS may edit. Returns an error string, or null if valid.
function validateCaption(body) {
  if (!body || typeof body !== 'object') return 'invalid caption'
  const { holder, desc, year } = body
  if (typeof holder !== 'string' || holder.trim() === '') return 'holder is required'
  if (typeof desc !== 'string' || desc.trim() === '') return 'desc is required'
  if (typeof year !== 'number' || !Number.isFinite(year)) return 'year must be a number'
  return null
}

export function buildApp(opts = {}) {
  const cookieSecret = opts.cookieSecret ?? process.env.COOKIE_SECRET
  const passwordHash = opts.passwordHash ?? process.env.ADMIN_PASSWORD_HASH
  const loginRateLimit = opts.rateLimit ?? { max: 10, timeWindow: '1 minute' }
  const remoteUrl = opts.remoteUrl ?? process.env.GIT_REMOTE_URL
  const workDir = opts.workDir ?? DEFAULT_WORK_DIR
  const repo = opts.repo ?? createRepo({ remoteUrl, workDir })

  const app = Fastify({ logger: false })

  // Clone the remote and ensure cms-draft exists before the first request.
  app.addHook('onReady', async () => {
    await repo.init()
  })

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
      return { works: await repo.readWorks() }
    })

    // Edit a work's caption -> commit to cms-draft (no deploy).
    routes.patch('/api/works/:id', { preHandler: requireSession }, async (request, reply) => {
      const invalid = validateCaption(request.body)
      if (invalid) return reply.code(400).send({ error: invalid })

      const { holder, desc, year } = request.body
      try {
        const work = await repo.updateCaption(request.params.id, { holder, desc, year })
        return { work }
      } catch (err) {
        if (err instanceof WorkNotFoundError) {
          return reply.code(404).send({ error: 'work not found' })
        }
        throw err
      }
    })

    // Promote the draft: merge cms-draft -> main (triggers deploy in prod).
    routes.post('/api/publish', { preHandler: requireSession }, async () => {
      await repo.publish()
      return { ok: true }
    })
  })

  return app
}
