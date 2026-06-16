import { scryptSync, randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { simpleGit } from 'simple-git'
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

// Stands up a throwaway *bare* git repo (the GitHub stand-in) seeded with the
// fixture gallery on `main`, plus an empty working-clone target dir. Real git —
// only the remote is swapped for this local path.
async function seedBareRepo() {
  const root = await mkdtemp(join(tmpdir(), 'ortiz-cms-'))
  const bareDir = join(root, 'remote.git')
  const seedDir = join(root, 'seed')
  const workDir = join(root, 'work')

  await mkdir(bareDir, { recursive: true })
  await simpleGit(bareDir).init(true, ['-b', 'main'])

  await mkdir(join(seedDir, 'src'), { recursive: true })
  const fixture = await readFile(FIXTURE_GALLERY, 'utf8')
  await writeFile(join(seedDir, 'src', 'gallery.json'), fixture)

  const seed = simpleGit(seedDir)
  await seed.init(false, ['-b', 'main'])
  await seed.addConfig('user.email', 'seed@test')
  await seed.addConfig('user.name', 'Seed')
  await seed.add('.')
  await seed.commit('seed gallery')
  await seed.addRemote('origin', bareDir)
  await seed.push(['-u', 'origin', 'main'])

  return { root, bareDir, workDir }
}

// Reads a file at a given ref straight out of the bare repo — the assertion seam
// for "what was actually committed to cms-draft / main".
export function showFile(bareDir, ref, path) {
  return simpleGit(bareDir).show([`${ref}:${path}`])
}

// Builds an app wired to a fresh seeded bare repo. Returns the app with a
// `testCtx` ({ bareDir, workDir }) attached and registers temp-dir cleanup on
// close. Async because seeding the repo is real git I/O.
export async function makeApp(overrides = {}) {
  const { root, bareDir, workDir } = await seedBareRepo()
  const app = buildApp({
    passwordHash: hashPassword(TEST_PASSWORD),
    cookieSecret: 'test-cookie-secret-needs-to-be-long-enough',
    remoteUrl: bareDir,
    workDir,
    ...overrides,
  })
  app.addHook('onClose', async () => {
    await rm(root, { recursive: true, force: true })
  })
  app.testCtx = { bareDir, workDir }
  return app
}
