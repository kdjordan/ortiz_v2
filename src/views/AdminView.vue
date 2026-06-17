<template>
	<div class="admin">
		<p class="eyebrow">Ortiz Metals — Admin</p>

		<!-- Login screen -->
		<form v-if="!authed" class="admin__login" @submit.prevent="login">
			<label for="admin-password">Password</label>
			<input
				id="admin-password"
				v-model="password"
				type="password"
				autocomplete="current-password"
				:disabled="busy"
			/>
			<button type="submit" :disabled="busy || !password">
				{{ busy ? 'Signing in…' : 'Sign in' }}
			</button>
			<p v-if="error" class="admin__error">{{ error }}</p>
		</form>

		<!-- Works list (after login) -->
		<div v-else class="admin__works">
			<div class="admin__bar">
				<h1>Works ({{ works.length }})</h1>
				<div class="admin__bar-actions">
					<button type="button" :disabled="publishing" @click="publish">
						{{ publishing ? 'Publishing…' : 'Publish' }}
					</button>
					<button type="button" @click="logout">Log out</button>
				</div>
			</div>
			<p v-if="publishMsg" class="admin__notice">{{ publishMsg }}</p>
			<div class="admin__upload">
				<label class="admin__upload-label">
					{{ uploading ? 'Uploading…' : 'Add work' }}
					<input
						type="file"
						accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
						:disabled="uploading"
						@change="upload"
					/>
				</label>
			</div>
			<ul>
				<li v-for="work in works" :key="work.id">
					<span class="admin__order">{{ work.order }}</span>
					<input
						v-model="work.caption.holder"
						class="admin__field admin__holder"
						aria-label="Holder"
					/>
					<input
						v-model="work.caption.desc"
						class="admin__field admin__desc"
						aria-label="Description"
					/>
					<input
						v-model.number="work.caption.year"
						type="number"
						class="admin__field admin__year"
						aria-label="Year"
					/>
					<button
						type="button"
						class="admin__save"
						:disabled="savingId === work.id"
						@click="saveCaption(work)"
					>
						{{ savingId === work.id ? 'Saving…' : 'Save' }}
					</button>
					<button type="button" class="admin__save" @click="openEditor(work)">
						Edit photo
					</button>
				</li>
			</ul>

			<!-- Crop + tilt editor -->
			<div v-if="editingId" class="admin__editor">
				<div class="admin__editor-stage" :style="{ '--preview-filter': previewFilter }">
					<Cropper
						:key="editingId"
						ref="cropperRef"
						class="admin__cropper"
						:src="editorSrc"
						:canvas="false"
						@ready="onCropperReady"
						@change="onCropChange"
					/>
				</div>
				<label class="admin__tilt">
					Straighten
					<input
						v-model.number="tilt"
						type="range"
						min="-45"
						max="45"
						step="0.5"
						@input="onTiltInput"
					/>
					<span class="admin__tilt-val">{{ tilt }}°</span>
				</label>
				<label class="admin__tilt">
					Brightness
					<input
						v-model.number="brightness"
						type="range"
						min="0.5"
						max="1.5"
						step="0.01"
					/>
					<span class="admin__tilt-val">{{ brightness.toFixed(2) }}</span>
				</label>
				<label class="admin__tilt">
					Contrast
					<input
						v-model.number="contrast"
						type="range"
						min="0.5"
						max="1.5"
						step="0.01"
					/>
					<span class="admin__tilt-val">{{ contrast.toFixed(2) }}</span>
				</label>
				<div class="admin__editor-actions">
					<button type="button" :disabled="savingEdit" @click="saveEdit">
						{{ savingEdit ? 'Saving…' : 'Save edit' }}
					</button>
					<button type="button" :disabled="savingEdit" @click="closeEditor">Cancel</button>
				</div>
			</div>
		</div>
	</div>
</template>

<script setup>
	import { computed, nextTick, onMounted, ref } from 'vue';
	import { Cropper } from 'vue-advanced-cropper';
	import 'vue-advanced-cropper/dist/style.css';

	const authed = ref(false);
	const works = ref([]);
	const password = ref('');
	const error = ref('');
	const busy = ref(false);
	const savingId = ref('');
	const publishing = ref(false);
	const publishMsg = ref('');
	const uploading = ref(false);

	// --- Crop + tilt editor (#6, re-edit #9) ---
	// The cropper loads the pristine original so the crop rectangle it emits is in
	// original-pixel space. Convention: tilt (rotate) then crop — the same order the
	// server's applyEdits uses — so this preview reproduces the saved result.
	const editingId = ref('');
	const editorSrc = ref('');
	const tilt = ref(0);
	// brightness/contrast (#7): identity is 1. The live preview is the browser's
	// `filter: brightness(b) contrast(c)`; the backend reproduces it exactly via
	// sharp.linear when it reprocesses from the original.
	const brightness = ref(1);
	const contrast = ref(1);
	const previewFilter = computed(
		() => `brightness(${brightness.value}) contrast(${contrast.value})`,
	);
	const savingEdit = ref(false);
	const cropperRef = ref(null);
	// The cropper's rotate() is relative; track the angle we've applied so a slider
	// move only rotates by the delta to reach the new absolute straighten angle.
	let appliedTilt = 0;
	// Latest crop rectangle from the cropper, in rotated-image pixel coordinates.
	let cropCoords = null;
	// The work's stored crop, replayed into the cropper once it's ready (#9).
	let storedCrop = null;
	// While replaying a stored edit, ignore the cropper's auto-fit @change events so
	// a re-opened "no crop" work isn't fabricated into the default 80% stencil.
	let initializing = false;

	// Open the editor on a work, rehydrating every control from its stored params so
	// adjustments continue non-destructively from the pristine original (#9). tilt +
	// crop need the loaded image's dimensions, so they're replayed in onCropperReady.
	function openEditor(work) {
		editingId.value = work.id;
		const edit = work.edit ?? {};
		tilt.value = edit.tilt ?? 0;
		appliedTilt = 0;
		brightness.value = edit.brightness ?? 1;
		contrast.value = edit.contrast ?? 1;
		storedCrop = edit.crop ?? null;
		cropCoords = storedCrop;
		initializing = true;
		// Same-origin (via the dev proxy); a fresh Cropper mounts per work (keyed).
		editorSrc.value = `/api/works/${work.id}/original`;
	}

	// Replay the stored edit into the freshly-loaded cropper in the #6 rotated-bbox
	// convention: rotate to the stored tilt first, then restore the crop rectangle
	// (which was captured in that post-rotation space, so it sets back directly).
	// Transitions off -> the restore is instant and deterministic, not animated.
	function onCropperReady() {
		if (tilt.value) {
			cropperRef.value.rotate(tilt.value, { transitions: false });
			appliedTilt = tilt.value;
		}
		if (storedCrop) {
			cropperRef.value.setCoordinates(
				{ left: storedCrop.x, top: storedCrop.y, width: storedCrop.w, height: storedCrop.h },
				{ transitions: false },
			);
		}
		// setCoordinates applies on the next tick; resume honouring change events only
		// after that so the replay isn't mistaken for a user-driven crop.
		nextTick(() => {
			initializing = false;
		});
	}

	function closeEditor() {
		editingId.value = '';
		editorSrc.value = '';
		cropCoords = null;
		storedCrop = null;
		initializing = false;
	}

	// vue-advanced-cropper emits coordinates {left, top, width, height} in the
	// rotated image's pixel space — exactly what the server extracts after rotating.
	function onCropChange({ coordinates }) {
		if (initializing) return;
		cropCoords = coordinates;
	}

	// Drive the cropper's rotation from the straighten slider (relative delta).
	function onTiltInput() {
		const delta = tilt.value - appliedTilt;
		if (delta && cropperRef.value) {
			cropperRef.value.rotate(delta);
			appliedTilt = tilt.value;
		}
	}

	// Save crop + tilt to cms-draft: the backend reprocesses the master from the
	// pristine original and regenerates the variant set.
	async function saveEdit() {
		if (!editingId.value) return;
		savingEdit.value = true;
		publishMsg.value = '';
		try {
			const crop = cropCoords
				? {
						x: Math.round(cropCoords.left),
						y: Math.round(cropCoords.top),
						w: Math.round(cropCoords.width),
						h: Math.round(cropCoords.height),
					}
				: null;
			const res = await fetch(`/api/works/${editingId.value}/edit`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({
					crop,
					tilt: tilt.value,
					brightness: brightness.value,
					contrast: contrast.value,
				}),
			});
			if (!res.ok) {
				publishMsg.value = 'Could not save the edit.';
				return;
			}
			closeEditor();
			await loadWorks();
			publishMsg.value = 'Edit saved to draft.';
		} catch {
			publishMsg.value = 'Could not reach the server.';
		} finally {
			savingEdit.value = false;
		}
	}

	// Fetch the works list; returns true if the session is valid (200), false on 401.
	async function loadWorks() {
		const res = await fetch('/api/works', { credentials: 'same-origin' });
		if (res.status === 401) return false;
		if (!res.ok) throw new Error(`Failed to load works (${res.status})`);
		const body = await res.json();
		works.value = body.works ?? [];
		return true;
	}

	async function login() {
		busy.value = true;
		error.value = '';
		try {
			const res = await fetch('/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ password: password.value }),
			});
			if (res.status === 429) {
				error.value = 'Too many attempts. Please wait and try again.';
				return;
			}
			if (!res.ok) {
				error.value = 'Incorrect password.';
				return;
			}
			password.value = '';
			authed.value = await loadWorks();
		} catch {
			error.value = 'Could not reach the server.';
		} finally {
			busy.value = false;
		}
	}

	// Commit one work's edited caption to the cms-draft branch.
	async function saveCaption(work) {
		savingId.value = work.id;
		publishMsg.value = '';
		try {
			const res = await fetch(`/api/works/${work.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify(work.caption),
			});
			if (!res.ok) {
				publishMsg.value = `Could not save “${work.caption.holder}”.`;
				return;
			}
			const body = await res.json();
			work.caption = body.work.caption;
			publishMsg.value = `Saved “${work.caption.holder}” to draft.`;
		} catch {
			publishMsg.value = 'Could not reach the server.';
		} finally {
			savingId.value = '';
		}
	}

	// Upload a new photo: POST the multipart form, then refresh the list so the
	// new work appears. Surfaces clear errors for too-large / unsupported files.
	async function upload(event) {
		const file = event.target.files?.[0];
		if (!file) return;
		uploading.value = true;
		publishMsg.value = '';
		try {
			const form = new FormData();
			form.append('file', file);
			const res = await fetch('/api/works', {
				method: 'POST',
				credentials: 'same-origin',
				body: form,
			});
			if (res.status === 413) {
				publishMsg.value = 'That file is too large (max 25 MB).';
				return;
			}
			if (res.status === 415) {
				publishMsg.value = 'Unsupported file type. Use JPEG, PNG, WebP, or HEIC.';
				return;
			}
			if (!res.ok) {
				publishMsg.value = 'Upload failed. Please try again.';
				return;
			}
			await loadWorks();
			publishMsg.value = 'Uploaded to draft.';
		} catch {
			publishMsg.value = 'Could not reach the server.';
		} finally {
			uploading.value = false;
			event.target.value = '';
		}
	}

	// Merge all staged draft edits into the live site.
	async function publish() {
		publishing.value = true;
		publishMsg.value = '';
		try {
			const res = await fetch('/api/publish', {
				method: 'POST',
				credentials: 'same-origin',
			});
			publishMsg.value = res.ok
				? 'Published! The site is updating and will be live shortly.'
				: 'Publish failed. Please try again.';
		} catch {
			publishMsg.value = 'Could not reach the server.';
		} finally {
			publishing.value = false;
		}
	}

	async function logout() {
		await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
		authed.value = false;
		works.value = [];
	}

	// On load, reuse an existing session if the cookie is still valid.
	onMounted(async () => {
		try {
			authed.value = await loadWorks();
		} catch {
			authed.value = false;
		}
	});
</script>

<style scoped lang="scss">
	.admin {
		flex: 1;
		width: min(720px, calc(100% - 2rem));
		margin: 0 auto;
		padding: clamp(2rem, 6vw, 5rem) 0;
		font-family: var(--font-body);
		color: rgba(255, 246, 234, 0.85);

		.eyebrow {
			font-family: var(--font-antonio);
			text-transform: uppercase;
			color: var(--ember);
			margin-bottom: 1.25rem;
		}

		input,
		button {
			font: inherit;
		}

		&__login {
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
			max-width: 22rem;

			input {
				padding: 0.6rem 0.75rem;
				border: 1px solid var(--line);
				border-radius: 6px;
				background: transparent;
				color: inherit;
			}
		}

		button {
			padding: 0.6rem 1rem;
			border: 1px solid var(--line);
			border-radius: 6px;
			background: transparent;
			color: inherit;
			cursor: pointer;

			&:disabled {
				opacity: 0.5;
				cursor: default;
			}
		}

		&__error {
			color: var(--ember);
		}

		&__bar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 1.5rem;
		}

		&__bar-actions {
			display: flex;
			gap: 0.75rem;
		}

		&__notice {
			color: var(--ember);
			margin-bottom: 1rem;
		}

		&__upload {
			margin-bottom: 1.5rem;
		}

		&__upload-label {
			display: inline-flex;
			align-items: center;
			gap: 0.75rem;
			padding: 0.6rem 1rem;
			border: 1px solid var(--line);
			border-radius: 6px;
			cursor: pointer;
		}

		&__works ul {
			list-style: none;
			padding: 0;
			margin: 0;
		}

		&__works li {
			display: grid;
			grid-template-columns: 2rem 8rem 1fr 5rem auto;
			gap: 0.75rem;
			align-items: center;
			padding: 0.6rem 0;
			border-top: 1px solid var(--line);
		}

		&__field {
			padding: 0.4rem 0.5rem;
			border: 1px solid var(--line);
			border-radius: 6px;
			background: transparent;
			color: inherit;
			min-width: 0;
		}

		&__order {
			color: var(--ember);
		}

		&__year {
			opacity: 0.7;
		}

		&__save {
			padding: 0.4rem 0.75rem;
		}

		&__editor {
			margin-top: 1.5rem;
			padding-top: 1.5rem;
			border-top: 1px solid var(--line);
			display: flex;
			flex-direction: column;
			gap: 1rem;
		}

		&__editor-stage {
			max-height: 60vh;
		}

		&__cropper {
			max-height: 60vh;
			background: rgba(0, 0, 0, 0.35);

			// Live brightness/contrast preview — filter only the image, not the crop
			// handles/overlay. The backend reproduces this exact filter via sharp.
			:deep(.vue-advanced-cropper__image) {
				filter: var(--preview-filter, none);
			}
		}

		&__tilt {
			display: flex;
			align-items: center;
			gap: 0.75rem;

			input[type='range'] {
				flex: 1;
			}
		}

		&__tilt-val {
			min-width: 3.5rem;
			text-align: right;
			color: var(--ember);
		}

		&__editor-actions {
			display: flex;
			gap: 0.75rem;
		}
	}
</style>
