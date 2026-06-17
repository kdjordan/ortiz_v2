import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import sharp from 'sharp'
import { processImage, rotatedSize } from './images.js'

const DRAFT_BRANCH = 'cms-draft'
const MAIN_BRANCH = 'main'
const GALLERY_REL = 'src/gallery.json'
const SOURCE_DIR = 'source-images'
const OPT_DIR = join('public', 'images', 'opt')

const IDENTITY_EDIT = { brightness: 1, contrast: 1, crop: null, tilt: 0 }

// Thrown by updateCaption when the target work id isn't in the gallery; the HTTP
// layer maps it to a 404.
export class WorkNotFoundError extends Error {
  constructor(id) {
    super(`work not found: ${id}`)
    this.name = 'WorkNotFoundError'
    this.id = id
  }
}

// Thrown by updateEdit when the params can't be applied to the actual image
// (e.g. a crop rectangle outside the rotated bounds); maps to a 400.
export class InvalidEditError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InvalidEditError'
  }
}

// Is the crop rectangle fully inside the rotated bounding box? The cropper sizes
// its canvas by truncating the float bbox, so floor() is the authoritative bound
// (sharp's rotated canvas ceils, i.e. is never smaller — so a crop valid here
// always fits the rendered image).
function cropWithinBounds(crop, bbox) {
  return (
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.x + crop.w <= Math.floor(bbox.width) &&
    crop.y + crop.h <= Math.floor(bbox.height)
  )
}

// Git-backed persistence for the CMS. Wraps an ephemeral working clone of the
// remote: content edits commit + push to `cms-draft` (no deploy), publish merges
// `cms-draft` -> `main` (which, in prod, triggers the rebuild). The remote
// branches are the source of truth; the clone is re-creatable on restart.
//
// All git operations run through a single in-process queue so concurrent
// edits/publish can't race on the one working clone.
export function createRepo({ remoteUrl, workDir }) {
  let git

  // Serialize every git operation: one chain, each task waits for the previous.
  let queue = Promise.resolve()
  function serialize(task) {
    const result = queue.then(task)
    // Keep the chain alive even if a task rejects.
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  const galleryFile = () => join(workDir, GALLERY_REL)

  async function readGallery() {
    return JSON.parse(await readFile(galleryFile(), 'utf8'))
  }

  // Fresh clone + ensure cms-draft exists (branched from main if absent). Run
  // once before serving; safe to re-run (re-clones from scratch).
  async function init() {
    if (!remoteUrl) throw new Error('GIT_REMOTE_URL is not set')
    await rm(workDir, { recursive: true, force: true })
    await simpleGit().clone(remoteUrl, workDir)

    git = simpleGit(workDir)
    await git.addConfig('user.email', 'cms@ortizmetals.com')
    await git.addConfig('user.name', 'Ortiz Metals CMS')
    await git.fetch('origin')

    const remotes = await git.branch(['-r'])
    if (remotes.all.includes(`origin/${DRAFT_BRANCH}`)) {
      await git.checkout(['-B', DRAFT_BRANCH, `origin/${DRAFT_BRANCH}`])
    } else {
      await git.checkout(['-B', DRAFT_BRANCH, `origin/${MAIN_BRANCH}`])
      await git.push(['-u', 'origin', DRAFT_BRANCH])
    }
  }

  // The works as they stand on cms-draft (what the admin sees, pending edits).
  function readWorks() {
    return serialize(async () => (await readGallery()).works)
  }

  // Apply caption fields to one work, commit + push to cms-draft. Returns the
  // updated work.
  function updateCaption(id, { holder, desc, year }) {
    return serialize(async () => {
      const gallery = await readGallery()
      const work = gallery.works.find((w) => w.id === id)
      if (!work) throw new WorkNotFoundError(id)

      work.caption = { holder, desc, year }
      await writeFile(galleryFile(), `${JSON.stringify(gallery, null, 2)}\n`)

      await git.add(GALLERY_REL)
      await git.commit(`CMS: update caption for ${id}`)
      await git.push(['origin', DRAFT_BRANCH])
      return work
    })
  }

  // Add a new work: write the pristine original + all responsive variants,
  // append a gallery record (identity edit params), then commit + push the whole
  // set to cms-draft in one commit. `ext` is the original's file extension;
  // `variants` are the {width, ext, buffer} set from images.processImage.
  function addWork({ ext, originalBuffer, variants, caption }) {
    return serialize(async () => {
      const gallery = await readGallery()

      // Filename-safe, collision-free id (randomUUID is hex+hyphens only).
      let id
      do {
        id = randomUUID()
      } while (gallery.works.some((w) => w.id === id))

      const originalRel = `${SOURCE_DIR}/${id}.${ext}`
      await mkdir(join(workDir, SOURCE_DIR), { recursive: true })
      await writeFile(join(workDir, originalRel), originalBuffer)

      await mkdir(join(workDir, OPT_DIR), { recursive: true })
      for (const v of variants) {
        await writeFile(join(workDir, OPT_DIR, `${id}-${v.width}.${v.ext}`), v.buffer)
      }

      const maxOrder = gallery.works.reduce((m, w) => Math.max(m, w.order), -1)
      const work = {
        id,
        order: maxOrder + 1,
        caption,
        base: `/images/opt/${id}`,
        original: originalRel,
        edit: { ...IDENTITY_EDIT },
      }
      gallery.works.push(work)
      await writeFile(galleryFile(), `${JSON.stringify(gallery, null, 2)}\n`)

      await git.add('.')
      await git.commit(`CMS: add work ${id}`)
      await git.push(['origin', DRAFT_BRANCH])
      return work
    })
  }

  // Apply crop + tilt edit params: reload the pristine original from the clone,
  // reprocess it through the same pipeline upload uses, overwrite this work's
  // variants in place (same id), store the params in gallery.json, then commit +
  // push to cms-draft. brightness/contrast are preserved (those are #7). Always
  // reprocesses from the original — never a previously rendered variant.
  function updateEdit(id, { crop, tilt }) {
    return serialize(async () => {
      const gallery = await readGallery()
      const work = gallery.works.find((w) => w.id === id)
      if (!work) throw new WorkNotFoundError(id)

      const originalBuffer = await readFile(join(workDir, work.original))
      const meta = await sharp(originalBuffer).metadata()
      if (crop && !cropWithinBounds(crop, rotatedSize(meta, tilt))) {
        throw new InvalidEditError('crop is out of bounds')
      }

      const edit = { ...work.edit, crop, tilt }
      const { variants } = await processImage(originalBuffer, edit)

      await mkdir(join(workDir, OPT_DIR), { recursive: true })
      for (const v of variants) {
        await writeFile(join(workDir, OPT_DIR, `${id}-${v.width}.${v.ext}`), v.buffer)
      }

      work.edit = edit
      await writeFile(galleryFile(), `${JSON.stringify(gallery, null, 2)}\n`)

      await git.add('.')
      await git.commit(`CMS: update edit for ${id}`)
      await git.push(['origin', DRAFT_BRANCH])
      return work
    })
  }

  // The pristine original bytes for a work (loaded into the cropper for editing),
  // plus its file extension so the HTTP layer can set the right content-type.
  function readOriginal(id) {
    return serialize(async () => {
      const gallery = await readGallery()
      const work = gallery.works.find((w) => w.id === id)
      if (!work) throw new WorkNotFoundError(id)
      const buffer = await readFile(join(workDir, work.original))
      return { buffer, ext: work.original.split('.').pop() }
    })
  }

  // Promote draft to live: rebase draft onto the latest main (safety against
  // out-of-band dev commits), then fast-forward main to draft and push.
  function publish() {
    return serialize(async () => {
      await git.fetch('origin')
      await git.checkout(MAIN_BRANCH)
      await git.reset(['--hard', `origin/${MAIN_BRANCH}`])

      await git.checkout(DRAFT_BRANCH)
      await git.rebase([MAIN_BRANCH])
      await git.push(['--force-with-lease', 'origin', DRAFT_BRANCH])

      await git.checkout(MAIN_BRANCH)
      await git.merge([DRAFT_BRANCH])
      await git.push(['origin', MAIN_BRANCH])

      // Leave the clone on cms-draft for subsequent edits.
      await git.checkout(DRAFT_BRANCH)
    })
  }

  return { init, readWorks, updateCaption, addWork, updateEdit, readOriginal, publish }
}
