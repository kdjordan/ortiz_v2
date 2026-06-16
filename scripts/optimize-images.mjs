// One-off image optimizer. Reads originals from /source-images and emits
// AVIF + WebP + JPEG-fallback at responsive widths into /public/images/opt.
// Run with:  node scripts/optimize-images.mjs   (requires devDependency `sharp`)
import sharp from 'sharp';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'source-images');
const outDir = join(root, 'public', 'images', 'opt');

// portraits get their own widths; everything else is a square gallery work
const WIDTHS = { 'r-profile': [480, 800] };
const DEFAULT_WIDTHS = [450, 900];

await mkdir(outDir, { recursive: true });

const files = (await readdir(srcDir)).filter((f) => /\.(png|jpe?g)$/i.test(f));
let count = 0;

for (const file of files) {
	const name = basename(file, extname(file));
	const widths = WIDTHS[name] ?? DEFAULT_WIDTHS;
	const input = join(srcDir, file);

	for (const w of widths) {
		const base = sharp(input).resize({ width: w, withoutEnlargement: true });
		await base.clone().avif({ quality: 50 }).toFile(join(outDir, `${name}-${w}.avif`));
		await base.clone().webp({ quality: 78 }).toFile(join(outDir, `${name}-${w}.webp`));
		await base
			.clone()
			.jpeg({ quality: 80, progressive: true, mozjpeg: true })
			.toFile(join(outDir, `${name}-${w}.jpg`));
		count += 3;
	}
	console.log(`✓ ${name} (${widths.join(', ')}px)`);
}

console.log(`\nDone — ${count} files written to public/images/opt/`);
