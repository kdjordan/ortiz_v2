import { fileURLToPath } from 'node:url'
import { scryptSync, timingSafeEqual } from 'node:crypto'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { createRepo, WorkNotFoundError, InvalidEditError, InvalidReorderError } from './repo.js'
import { processImage } from './images.js'

const SESSION_COOKIE = 'session'
const SESSION_VALUE = 'ok'

// Accepted upload types -> the extension the pristine original is stored under.
// HEIC stays .heic; sharp/libvips decodes it to generate the variants.
const ACCEPTED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
}

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024

// Straighten only — not free rotation. Anything beyond this is rejected.
const MAX_TILT_DEGREES = 45

// Brightness/contrast slider bounds. 1 is the identity (no-op); the range is a
// gentle ±50% so the affine colour map never clips a normal photo to black/white.
const MIN_LEVEL = 0.5
const MAX_LEVEL = 1.5

// Stored original extension -> content-type for serving it back to the editor.
const ORIGINAL_MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
}

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

// Structural validation of brightness/contrast + crop + tilt edit params (the
// image-relative crop bounds check needs the original's dimensions, so it lives in
// repo.updateEdit). brightness/contrast are optional and default to 1 (identity)
// when omitted. Returns an error string, or null if the shape is valid.
function validateEdit(body) {
  if (!body || typeof body !== 'object') return 'invalid edit'
  const { crop, tilt } = body
  for (const k of ['brightness', 'contrast']) {
    const v = body[k]
    if (v === undefined) continue
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${k} must be a number`
    if (v < MIN_LEVEL || v > MAX_LEVEL) return `${k} must be within ${MIN_LEVEL}–${MAX_LEVEL}`
  }
  if (typeof tilt !== 'number' || !Number.isFinite(tilt)) return 'tilt must be a number'
  if (Math.abs(tilt) > MAX_TILT_DEGREES) return `tilt must be within ±${MAX_TILT_DEGREES}°`
  if (crop !== null) {
    if (typeof crop !== 'object') return 'crop must be an object or null'
    for (const k of ['x', 'y', 'w', 'h']) {
      if (typeof crop[k] !== 'number' || !Number.isFinite(crop[k])) return `crop.${k} must be a number`
    }
    if (crop.x < 0 || crop.y < 0 || crop.w <= 0 || crop.h <= 0) return 'crop has invalid dimensions'
  }
  return null
}

// Coerce an optional multipart year field (a string) to a number, defaulting to
// the current year when omitted or non-numeric, so the record is always valid.
function parseYear(raw) {
  const n = Number(raw)
  return raw != null && raw !== '' && Number.isFinite(n) ? n : new Date().getFullYear()
}

export function buildApp(opts = {}) {
  const cookieSecret = opts.cookieSecret ?? process.env.COOKIE_SECRET
  const passwordHash = opts.passwordHash ?? process.env.ADMIN_PASSWORD_HASH
  const loginRateLimit = opts.rateLimit ?? { max: 10, timeWindow: '1 minute' }
  const remoteUrl = opts.remoteUrl ?? process.env.GIT_REMOTE_URL
  const workDir = opts.workDir ?? DEFAULT_WORK_DIR
  const repo = opts.repo ?? createRepo({ remoteUrl, workDir })
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES

  const app = Fastify({ logger: false })

  // Clone the remote and ensure cms-draft exists before the first request.
  app.addHook('onReady', async () => {
    await repo.init()
  })

  app.register(cookie, { secret: cookieSecret })
  // Registered globally but opted in per-route, so only login is throttled.
  app.register(rateLimit, { global: false })
  // Busboy enforces the size cap mid-stream: an oversized file rejects without
  // buffering the whole upload.
  app.register(multipart, { limits: { fileSize: maxFileBytes } })

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

    // Reorder works: body { ids } is the full id list in the new sequence. Renumbers
    // the order fields (0..n) and commits to cms-draft. A bad id set -> 400.
    routes.put('/api/works/order', { preHandler: requireSession }, async (request, reply) => {
      const ids = request.body?.ids
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
        return reply.code(400).send({ error: 'ids must be an array of strings' })
      }
      try {
        const works = await repo.reorderWorks(ids)
        return { works }
      } catch (err) {
        if (err instanceof InvalidReorderError) return reply.code(400).send({ error: err.message })
        throw err
      }
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

    // Edit a work's brightness/contrast/crop/tilt -> reprocess variants from the
    // pristine original -> commit to cms-draft. Non-destructive: params stored,
    // original preserved. brightness/contrast default to 1 (identity) when omitted.
    routes.put('/api/works/:id/edit', { preHandler: requireSession }, async (request, reply) => {
      const invalid = validateEdit(request.body)
      if (invalid) return reply.code(400).send({ error: invalid })

      const { crop, tilt, brightness = 1, contrast = 1 } = request.body
      try {
        const work = await repo.updateEdit(request.params.id, { brightness, contrast, crop, tilt })
        return { work }
      } catch (err) {
        if (err instanceof WorkNotFoundError) return reply.code(404).send({ error: 'work not found' })
        if (err instanceof InvalidEditError) return reply.code(400).send({ error: err.message })
        throw err
      }
    })

    // Delete a work: remove its files + gallery record -> commit to cms-draft.
    routes.delete('/api/works/:id', { preHandler: requireSession }, async (request, reply) => {
      try {
        await repo.deleteWork(request.params.id)
        return { ok: true }
      } catch (err) {
        if (err instanceof WorkNotFoundError) return reply.code(404).send({ error: 'work not found' })
        throw err
      }
    })

    // Serve a work's pristine original so the editor can load it into the cropper
    // (the crop rect must be captured in original-pixel space).
    routes.get('/api/works/:id/original', { preHandler: requireSession }, async (request, reply) => {
      try {
        const { buffer, ext } = await repo.readOriginal(request.params.id)
        return reply.type(ORIGINAL_MIME[ext] ?? 'application/octet-stream').send(buffer)
      } catch (err) {
        if (err instanceof WorkNotFoundError) return reply.code(404).send({ error: 'work not found' })
        throw err
      }
    })

    // Upload a new work: validate -> process (sharp) -> commit original + the
    // full responsive variant set + gallery record to cms-draft.
    routes.post('/api/works', { preHandler: requireSession }, async (request, reply) => {
      let fileBuffer
      let mimetype
      const fields = {}

      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            mimetype = part.mimetype
            // toBuffer() drains the stream; throws FST_REQ_FILE_TOO_LARGE if the
            // size cap is exceeded.
            fileBuffer = await part.toBuffer()
          } else {
            fields[part.fieldname] = part.value
          }
        }
      } catch (err) {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.code(413).send({ error: 'file too large' })
        }
        throw err
      }

      if (!fileBuffer) {
        return reply.code(400).send({ error: 'file is required' })
      }

      const ext = ACCEPTED_TYPES[mimetype]
      if (!ext) {
        return reply.code(415).send({ error: 'unsupported file type' })
      }

      let processed
      try {
        processed = await processImage(fileBuffer)
      } catch {
        // sharp could not decode it — treat as an unsupported/corrupt image.
        return reply.code(415).send({ error: 'could not read image' })
      }

      const caption = {
        holder: (fields.holder ?? '').trim() || 'Untitled',
        desc: (fields.desc ?? '').trim(),
        year: parseYear(fields.year),
      }

      const work = await repo.addWork({
        ext,
        originalBuffer: fileBuffer,
        variants: processed.variants,
        caption,
      })
      return reply.code(201).send({ work })
    })

    // How many unpublished changes are staged (commits cms-draft is ahead of main).
    routes.get('/api/draft/status', { preHandler: requireSession }, async () => {
      return repo.draftStatus()
    })

    // Discard all unpublished changes: reset cms-draft back to main.
    routes.post('/api/draft/discard', { preHandler: requireSession }, async () => {
      await repo.discardDraft()
      return { ok: true }
    })

    // Promote the draft: merge cms-draft -> main (triggers deploy in prod).
    routes.post('/api/publish', { preHandler: requireSession }, async () => {
      await repo.publish()
      return { ok: true }
    })
  })

  return app
}
