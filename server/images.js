import sharp from 'sharp'

// Responsive widths + per-format encoder settings. These MUST stay identical to
// scripts/optimize-images.mjs so the frontend's existing -450/-900.avif/webp/jpg
// srcset keeps working unchanged.
export const VARIANT_WIDTHS = [450, 900]
const AVIF_OPTS = { quality: 50 }
const WEBP_OPTS = { quality: 78 }
const JPEG_OPTS = { quality: 80, progressive: true, mozjpeg: true }

// Apply the non-destructive edit params to the pristine original, yielding the
// "master" sharp pipeline that the responsive variants are resized from.
//
// For #5 the edit params are identity (brightness/contrast 1, no crop, no tilt),
// so master === original. #6/#7 slot their brightness/contrast/crop/tilt here,
// always working from the pristine original (never a previously rendered output).
function applyEdits(buffer, _edit) {
  return sharp(buffer)
}

// Decode + validate the upload, then generate the full responsive variant set.
// Returns the sharp metadata of the original plus the variant buffers; the caller
// (repo.js) writes them. Throws if sharp cannot parse the input (not an image).
export async function processImage(buffer, edit = {}) {
  const metadata = await sharp(buffer).metadata()
  const master = applyEdits(buffer, edit)

  const variants = []
  for (const width of VARIANT_WIDTHS) {
    const resized = master.clone().resize({ width, withoutEnlargement: true })
    const [avif, webp, jpg] = await Promise.all([
      resized.clone().avif(AVIF_OPTS).toBuffer(),
      resized.clone().webp(WEBP_OPTS).toBuffer(),
      resized.clone().jpeg(JPEG_OPTS).toBuffer(),
    ])
    variants.push(
      { width, ext: 'avif', buffer: avif },
      { width, ext: 'webp', buffer: webp },
      { width, ext: 'jpg', buffer: jpg },
    )
  }

  return { metadata, variants }
}
