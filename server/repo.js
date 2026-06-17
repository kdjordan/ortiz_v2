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

// Thrown by reorderWorks when the supplied id list isn't a permutation of the
// gallery's ids (missing, extra, duplicated, or unknown); maps to a 400.
export class InvalidReorderError extends Error {
  constructor(message) {
    super(message)
    this.name = 'InvalidReorderError'
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

  // Apply brightness/contrast/crop/tilt edit params: reload the pristine original
  // from the clone, reprocess it through the same pipeline upload uses, overwrite
  // this work's variants in place (same id), store all four params in gallery.json,
  // then commit + push to cms-draft. Always reprocesses from the original — never a
  // previously rendered variant — so re-editing is non-cumulative.
  function updateEdit(id, { brightness, contrast, crop, tilt }) {
    return serialize(async () => {
      const gallery = await readGallery()
      const work = gallery.works.find((w) => w.id === id)
      if (!work) throw new WorkNotFoundError(id)

      const originalBuffer = await readFile(join(workDir, work.original))
      const meta = await sharp(originalBuffer).metadata()
      if (crop && !cropWithinBounds(crop, rotatedSize(meta, tilt))) {
        throw new InvalidEditError('crop is out of bounds')
      }

      const edit = { ...work.edit, brightness, contrast, crop, tilt }
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

  // A small, browser-displayable thumbnail for the admin list: the committed 450px
  // JPEG variant from the working clone. Works for freshly-uploaded works too (their
  // variants live in cms-draft before publish), and JPEG renders everywhere.
  function readPreview(id) {
    return serialize(async () => {
      const gallery = await readGallery()
      const work = gallery.works.find((w) => w.id === id)
      if (!work) throw new WorkNotFoundError(id)
      return readFile(join(workDir, OPT_DIR, `${id}-450.jpg`))
    })
  }

  // Reorder the gallery: `orderedIds` must be an exact permutation of the
  // current works' ids. Renumber each work's `order` to its index in that list
  // (0..n) so `order` is the single source of truth for sequence, then commit +
  // push to cms-draft. Returns the works in the new order.
  function reorderWorks(orderedIds) {
    return serialize(async () => {
      const gallery = await readGallery()
      const current = gallery.works.map((w) => w.id)

      const sameSet =
        Array.isArray(orderedIds) &&
        orderedIds.length === current.length &&
        new Set(orderedIds).size === orderedIds.length &&
        orderedIds.every((id) => current.includes(id))
      if (!sameSet) throw new InvalidReorderError('ids must be a permutation of the gallery ids')

      const rank = new Map(orderedIds.map((id, i) => [id, i]))
      for (const work of gallery.works) work.order = rank.get(work.id)
      gallery.works.sort((a, b) => a.order - b.order)

      await writeFile(galleryFile(), `${JSON.stringify(gallery, null, 2)}\n`)
      await git.add(GALLERY_REL)
      await git.commit('CMS: reorder works')
      await git.push(['origin', DRAFT_BRANCH])
      return gallery.works
    })
  }

  // Delete a work: remove its pristine original + all six responsive variants +
  // its gallery record, then commit + push the deletions to cms-draft. Unknown id
  // -> WorkNotFoundError (404). Order fields of the remaining works are left as-is
  // (gaps are harmless: sequence is read by `order`, not array index).
  function deleteWork(id) {
    return serialize(async () => {
      const gallery = await readGallery()
      const work = gallery.works.find((w) => w.id === id)
      if (!work) throw new WorkNotFoundError(id)

      // force: a variant file may be absent (e.g. partially-written); don't fail.
      await rm(join(workDir, work.original), { force: true })
      for (const width of [450, 900]) {
        for (const ext of ['avif', 'webp', 'jpg']) {
          await rm(join(workDir, OPT_DIR, `${id}-${width}.${ext}`), { force: true })
        }
      }

      gallery.works = gallery.works.filter((w) => w.id !== id)
      await writeFile(galleryFile(), `${JSON.stringify(gallery, null, 2)}\n`)

      // -A stages the file removals as well as the gallery.json change.
      await git.add(['-A'])
      await git.commit(`CMS: delete work ${id}`)
      await git.push(['origin', DRAFT_BRANCH])
    })
  }

  // How far cms-draft is ahead of main, measured against the remote (the source
  // of truth). This is a commit count, not a logical-change count: each CMS
  // operation (upload/edit/reorder/delete) is one commit, so `pending` is the
  // number of unpublished commits, which may exceed the number of distinct works
  // touched. hasChanges is just pending > 0.
  function draftStatus() {
    return serialize(async () => {
      await git.fetch('origin')
      const out = await git.raw([
        'rev-list',
        '--count',
        `origin/${MAIN_BRANCH}..origin/${DRAFT_BRANCH}`,
      ])
      const pending = parseInt(out.trim(), 10)
      return { pending, hasChanges: pending > 0 }
    })
  }

  // Throw away all unpublished work: point cms-draft back at the latest main and
  // force-push it. Only the CMS writes cms-draft, so force-with-lease is safe
  // (same assumption publish() relies on). After this, draftStatus() is 0.
  function discardDraft() {
    return serialize(async () => {
      await git.fetch('origin')
      await git.checkout(DRAFT_BRANCH)
      await git.reset(['--hard', `origin/${MAIN_BRANCH}`])
      await git.push(['--force-with-lease', 'origin', DRAFT_BRANCH])
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

  return {
    init,
    readWorks,
    updateCaption,
    addWork,
    updateEdit,
    readOriginal,
    readPreview,
    reorderWorks,
    deleteWork,
    draftStatus,
    discardDraft,
    publish,
  }
}
