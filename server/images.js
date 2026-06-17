import sharp from 'sharp'

// Responsive widths + per-format encoder settings. These MUST stay identical to
// scripts/optimize-images.mjs so the frontend's existing -450/-900.avif/webp/jpg
// srcset keeps working unchanged.
export const VARIANT_WIDTHS = [450, 900]
const AVIF_OPTS = { quality: 50 }
const WEBP_OPTS = { quality: 78 }
const JPEG_OPTS = { quality: 80, progressive: true, mozjpeg: true }

// Transparent fill for the corners that a tilt exposes. JPEG (no alpha) flattens
// it to black; AVIF/WebP keep it transparent — matching the cropper, which leaves
// those corners transparent. Straightening normally crops them away anyway.
const ROTATE_BG = { r: 0, g: 0, b: 0, alpha: 0 }

// Size of the axis-aligned bounding box after rotating a w×h rect by `angleDeg`.
// This is exactly vue-advanced-cropper's `rotateSize` (|w·cos|+|h·sin|, …), which
// is also the canvas size sharp's .rotate() produces — so the crop rectangle the
// cropper emits lives in this same space. Used to validate crop bounds.
export function rotatedSize({ width, height }, angleDeg) {
  const r = (angleDeg * Math.PI) / 180
  return {
    width: Math.abs(width * Math.cos(r)) + Math.abs(height * Math.sin(r)),
    height: Math.abs(width * Math.sin(r)) + Math.abs(height * Math.cos(r)),
  }
}

// Apply the non-destructive edit params to the pristine original, yielding the
// "master" sharp pipeline that the responsive variants are resized from.
//
// CONVENTION — reproduces vue-advanced-cropper's live preview exactly: TILT, then
// CROP. The cropper's getCanvas() first rotates the source onto a canvas sized to
// the rotated bounding box, then extracts its `coordinates` rectangle from that
// rotated canvas. So:
//   1. tilt: rotate the original clockwise by `tilt`° about its centre, expanding
//      to the rotated bounding box (sharp's .rotate matches the cropper's bbox).
//   2. crop: extract {x,y,w,h} from that rotated image. The crop rect is therefore
//      in ROTATED-image pixel space — which equals original-image pixel space when
//      tilt is 0 (the crop-only case). Order matters: rotate-then-crop ≠
//      crop-then-rotate. #7/#9 extend this seam; keep the tilt→crop order.
// Always starts from the pristine original buffer — never a previously rendered
// variant — so re-editing reloads original + params and reproduces the same
// result. brightness/contrast are #7 and not applied here yet.
function applyEdits(buffer, edit = {}) {
  const { crop = null, tilt = 0 } = edit
  let pipeline = sharp(buffer)
  if (tilt) {
    pipeline = pipeline.rotate(tilt, { background: ROTATE_BG })
  }
  if (crop) {
    pipeline = pipeline.extract({
      left: Math.round(crop.x),
      top: Math.round(crop.y),
      width: Math.round(crop.w),
      height: Math.round(crop.h),
    })
  }
  return pipeline
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
