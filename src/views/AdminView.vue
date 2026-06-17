<template>
	<div class="admin">
		<!-- Login -->
		<form v-if="!authed" class="admin__login" @submit.prevent="login">
			<p class="admin__brand">Ortiz Metals · Admin</p>
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

		<!-- App shell: works rail (left) + editor (main) -->
		<div v-else class="admin__shell">
			<aside class="admin__rail">
				<div class="admin__rail-head">
					<p class="admin__brand">Ortiz Metals · Admin</p>
					<label class="admin__upload-label">
						{{ uploading ? 'Uploading…' : '+ Add work' }}
						<input
							type="file"
							accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
							:disabled="uploading"
							@change="upload"
						/>
					</label>
				</div>

				<ul class="admin__works">
					<li
						v-for="(work, index) in works"
						:key="work.id"
						class="admin__work"
						:class="{
							'admin__work--on': editingId === work.id,
							'admin__work--dragging': dragIndex === index,
						}"
						draggable="true"
						title="Drag to reorder"
						@dragstart="onDragStart(index)"
						@dragend="onDragEnd"
						@dragover.prevent="onDragOver(index)"
						@drop="onDrop(index)"
						@click="openEditor(work)"
					>
						<img
							class="admin__thumb"
							:src="previewSrc(work.id)"
							:alt="work.caption.holder"
							loading="lazy"
						/>
						<span class="admin__work-title">{{ work.caption.holder || 'Untitled' }}</span>
						<span
								class="admin__work-spot"
								:class="{ 'admin__work-spot--unplaced': work.order >= homeZones.length }"
							>
								{{ work.order < homeZones.length ? work.order + 1 : 'Unplaced' }}
							</span>
					</li>
				</ul>

				<div class="admin__map">
					<p class="admin__map-label">Homepage layout</p>
					<div class="admin__map-grid">
						<button
							v-for="z in homeZones"
							:key="z.spot"
							type="button"
							class="admin__zone"
							:class="{ 'admin__zone--on': workAtSpot(z.spot)?.id === editingId }"
							:style="{ gridColumn: z.col, gridRow: z.row }"
							:title="workAtSpot(z.spot)?.caption.holder || `Spot ${z.spot} — empty`"
							@click="workAtSpot(z.spot) && openEditor(workAtSpot(z.spot))"
						>
							<Preview
								v-if="workAtSpot(z.spot)?.id === editingId && cropResult?.coordinates && !loadingImage"
								class="admin__zone-live"
								:style="{ '--preview-filter': previewFilter }"
								fill
								:image="cropResult.image"
								:coordinates="cropResult.coordinates"
							/>
							<img
								v-else-if="workAtSpot(z.spot)"
								class="admin__zone-img"
								:src="previewSrc(workAtSpot(z.spot).id)"
								alt=""
								loading="lazy"
							/>
							<span class="admin__zone-num">{{ z.spot }}</span>
						</button>
					</div>
				</div>

				<div class="admin__rail-foot">
					<p class="admin__draft">
						{{
							draft.hasChanges
								? `${draft.pending} unpublished change${draft.pending === 1 ? '' : 's'}`
								: 'No unpublished changes'
						}}
					</p>
					<button type="button" :disabled="publishing" @click="publish">
						{{ publishing ? 'Publishing…' : 'Publish' }}
					</button>
					<button
						type="button"
						:disabled="discarding || !draft.hasChanges"
						@click="discard"
					>
						{{ discarding ? 'Discarding…' : 'Discard draft' }}
					</button>
					<button type="button" @click="logout">Log out</button>
				</div>
			</aside>

			<main class="admin__main">
				<p v-if="publishMsg" class="admin__notice">{{ publishMsg }}</p>

				<div v-if="!currentWork" class="admin__empty">
					<p>Select a work to edit — or add one with “+ Add work”.</p>
				</div>

				<div v-else class="admin__detail">
					<!-- Metadata up top -->
					<div class="admin__meta">
						<div class="admin__caption">
							<label>
								Title
								<input v-model="currentWork.caption.holder" aria-label="Title" />
							</label>
							<label>
								Description
								<input v-model="currentWork.caption.desc" aria-label="Description" />
							</label>
							<label>
								Year
								<input v-model.number="currentWork.caption.year" type="number" aria-label="Year" />
							</label>
						</div>
						<div class="admin__detail-actions">
							<button type="button" :disabled="savingEdit" @click="saveAll">
								{{ savingEdit ? 'Saving…' : 'Save' }}
							</button>
							<button
								type="button"
								class="admin__delete"
								:disabled="deletingId === currentWork.id"
								@click="removeWork(currentWork)"
							>
								{{ deletingId === currentWork.id ? 'Deleting…' : 'Delete work' }}
							</button>
						</div>
					</div>

					<!-- Photo editor — image, contextual controls, then the tool tabs as a
					     long skinny bar across the bottom. The frame IS the published result. -->
					<div class="admin__editor">
						<div class="admin__editor-main">
							<div class="admin__editor-stage" :style="{ '--preview-filter': previewFilter }">
								<Cropper
									:key="editingId + ':' + aspect"
									ref="cropperRef"
									class="admin__cropper"
									:src="editorSrc"
									:canvas="false"
									:stencil-props="stencilProps"
									:stencil-size="stencilSize"
									:resize-image="{ wheel: true, touch: true }"
									image-restriction="stencil"
									@ready="onCropperReady"
									@change="onCropChange"
								/>
								<div v-if="loadingImage" class="admin__editor-loading">
									<span class="admin__spinner" aria-hidden="true"></span>
									<span>Rendering preview…</span>
								</div>
							</div>
							<p class="admin__editor-hint">
								Drag the photo to position · scroll to zoom · the frame is exactly what publishes
							</p>

							<div class="admin__editor-controls">
								<template v-if="tool === 'crop'">
									<span class="admin__ctl-label">Aspect</span>
									<button
										v-for="a in aspectPresets"
										:key="a.label"
										type="button"
										class="admin__chip"
										:class="{ 'admin__chip--on': aspect === a.value }"
										@click="setAspect(a.value)"
									>
										{{ a.label }}
									</button>
									<span class="admin__ctl-zoom">
										<button type="button" class="admin__chip" @click="zoomBy(0.9)">−</button>
										<button type="button" class="admin__chip" @click="zoomBy(1.1)">+</button>
									</span>
								</template>
								<template v-else-if="tool === 'straighten'">
									<WheelControl
										v-model="tilt"
										label="Straighten"
										:step="0.1"
										:px-per-unit="10"
										:minor-tick="1"
										:major-tick="5"
										:decimals="1"
										suffix="°"
										@change="onTiltInput"
									/>
								</template>
								<template v-else>
									<div class="admin__light">
										<WheelControl
											v-model="brightness"
											label="Brightness"
											:min="0.5"
											:max="1.5"
											:step="0.01"
											:px-per-unit="300"
											:minor-tick="0.05"
											:major-tick="0.25"
											:decimals="2"
										/>
										<WheelControl
											v-model="contrast"
											label="Contrast"
											:min="0.5"
											:max="1.5"
											:step="0.01"
											:px-per-unit="300"
											:minor-tick="0.05"
											:major-tick="0.25"
											:decimals="2"
										/>
									</div>
								</template>
							</div>

							<div class="admin__spot-pick">
								<span class="admin__ctl-label">Homepage spot</span>
								<button
									v-for="z in homeZones"
									:key="z.spot"
									type="button"
									class="admin__chip"
									:class="{ 'admin__chip--on': currentSpot === z.spot }"
									@click="assignSpot(z.spot)"
								>
									{{ z.spot }}
								</button>
								<button
									type="button"
									class="admin__chip"
									:class="{ 'admin__chip--on': currentSpot === null }"
									@click="unplace"
								>
									Unplaced
								</button>
							</div>
						</div>
						<!-- Tool tabs — long skinny buttons across the bottom -->
						<div class="admin__editor-rail">
							<button
								v-for="t in editorTools"
								:key="t.id"
								type="button"
								class="admin__tool"
								:class="{ 'admin__tool--on': tool === t.id }"
								@click="tool = t.id"
							>
								<span class="admin__tool-ico">{{ t.icon }}</span>
								<span class="admin__tool-name">{{ t.name }}</span>
							</button>
						</div>
					</div>
				</div>
			</main>
		</div>
	</div>
</template>

<script setup>
	import { computed, nextTick, onMounted, ref } from 'vue';
	import { Cropper, Preview } from 'vue-advanced-cropper';
	import 'vue-advanced-cropper/dist/style.css';
	import WheelControl from '@/components/WheelControl.vue';

	const authed = ref(false);
	const works = ref([]);
	const password = ref('');
	const error = ref('');
	const busy = ref(false);
	const savingId = ref('');
	const publishing = ref(false);
	const publishMsg = ref('');
	// How many unpublished commits cms-draft is ahead of main (#10).
	const draft = ref({ pending: 0, hasChanges: false });
	const discarding = ref(false);
	const uploading = ref(false);
	const deletingId = ref('');
	// Index of the row currently being dragged for reorder (-1 when idle).
	const dragIndex = ref(-1);
	// Bumped on every reload so thumbnail <img> srcs cache-bust after an edit
	// regenerates a work's variants (same URL would otherwise serve a stale image).
	const rev = ref(0);
	function previewSrc(id) {
		return `/api/works/${id}/preview?r=${rev.value}`;
	}

	// --- Photo editor (fixed frame; #6 crop/tilt, #7 light, #9 re-edit) ---
	// The cropper loads the original (HEIC is transcoded to JPEG server-side) so the
	// crop rectangle it emits is in original-pixel space. Convention: tilt then crop
	// — the same order the server's applyEdits uses — so the preview matches the save.
	const editingId = ref('');
	const editorSrc = ref('');
	const tilt = ref(0);
	const brightness = ref(1);
	const contrast = ref(1);
	const previewFilter = computed(
		() => `brightness(${brightness.value}) contrast(${contrast.value})`,
	);
	const savingEdit = ref(false);
	// True from when an image src is assigned until the cropper reports it loaded —
	// HEIC works transcode to JPEG server-side, so the stage would otherwise sit blank.
	const loadingImage = ref(false);
	const cropperRef = ref(null);
	// The cropper's rotate() is relative; track the applied angle so a slider move
	// only rotates by the delta to reach the new absolute straighten angle.
	let appliedTilt = 0;
	// Latest crop rectangle from the cropper, in rotated-image pixel coordinates.
	let cropCoords = null;
	// The cropper's full live result ({ image, coordinates }) — fed to the <Preview>
	// in the work's homepage zone so the wireframe tile updates live while editing.
	const cropResult = ref(null);
	// The work's stored crop, replayed into the cropper once it's ready (#9).
	let storedCrop = null;
	// While replaying a stored edit, ignore the cropper's auto-fit @change events.
	let initializing = false;

	// The selected work — its editor + caption fill the main pane.
	const currentWork = computed(() => works.value.find((w) => w.id === editingId.value) || null);

	// Editor tool rail + fixed output frame (the image pans/zooms behind it).
	const tool = ref('crop');
	const aspect = ref('original'); // 'original' (image aspect) | numeric ratio
	const editorTools = [
		{ id: 'crop', name: 'Crop', icon: '⛶' },
		{ id: 'straighten', name: 'Straighten', icon: '∡' },
		{ id: 'light', name: 'Light', icon: '☀' },
	];
	const aspectPresets = [
		{ label: 'Original', value: 'original' },
		{ label: '1:1', value: 1 },
		{ label: '4:3', value: 4 / 3 },
		{ label: '3:4', value: 3 / 4 },
		{ label: '16:9', value: 16 / 9 },
	];
	// The 8 fixed homepage spots, in the exact grid placement HomeView uses (spot 1 =
	// feature/hero, spots 2–8 = the asymmetric tiles). `col`/`row` drive the nav
	// wireframe; `ar` is each zone's real rendered aspect ratio (measured on the live
	// homepage at a typical desktop) so the editor frame previews how a photo will be
	// cropped in that slot. Spot N maps to `order` N−1; orders 8+ are unplaced.
	const homeZones = [
		{ spot: 1, col: '1 / 8', row: '1 / 8', ar: 1.74 },
		{ spot: 2, col: '8 / 13', row: '1 / 4', ar: 3.0 },
		{ spot: 3, col: '8 / 11', row: '4 / 8', ar: 1.3 },
		{ spot: 4, col: '11 / 13', row: '4 / 6', ar: 1.8 },
		{ spot: 5, col: '11 / 13', row: '6 / 8', ar: 1.8 },
		{ spot: 6, col: '1 / 4', row: '8 / 12', ar: 1.3 },
		{ spot: 7, col: '4 / 8', row: '8 / 12', ar: 1.76 },
		{ spot: 8, col: '8 / 13', row: '8 / 12', ar: 2.21 },
	];
	// The work occupying a given homepage spot (works.value is order-sorted, so the
	// work at order N−1 sits in spot N), or null if that spot is empty.
	function workAtSpot(spot) {
		return works.value.find((w) => w.order === spot - 1) || null;
	}
	// The spot the selected work currently fills (1–8), or null when it's unplaced.
	const currentSpot = computed(() => {
		const w = currentWork.value;
		if (!w || w.order >= homeZones.length) return null;
		return w.order + 1;
	});
	// Fixed stencil: it doesn't move/resize — the user moves the image instead.
	const stencilProps = computed(() => ({
		movable: false,
		resizable: false,
		aspectRatio: aspect.value === 'original' ? undefined : aspect.value,
	}));
	// Size the fixed stencil to ~90% of the stage, honouring the chosen aspect
	// ('original' = the loaded image's own aspect).
	function stencilSize({ boundaries, imageSize }) {
		const imgAr = imageSize && imageSize.width ? imageSize.width / imageSize.height : 1;
		const ar = aspect.value === 'original' ? imgAr : aspect.value;
		let w = boundaries.width * 0.9;
		let h = w / ar;
		if (h > boundaries.height * 0.9) {
			h = boundaries.height * 0.9;
			w = h * ar;
		}
		return { width: w, height: h };
	}
	function setAspect(v) {
		aspect.value = v; // re-keys the cropper -> remounts + refits the image to the frame
	}
	function zoomBy(factor) {
		cropperRef.value?.zoom(factor);
	}

	// Assign the selected work to homepage spot N: swap it with whoever holds that spot
	// (so only those two move), then snap the editor frame to the zone's aspect so the
	// preview shows how the photo will be cropped there. Persisted via the order endpoint.
	function assignSpot(spot) {
		const work = currentWork.value;
		if (!work) return;
		const to = spot - 1;
		// No filled spot here (gallery has fewer works than the 8 fixed spots) — don't
		// touch the frame either, or it would look like the work moved when it didn't.
		if (to >= works.value.length) return;
		const next = works.value.slice();
		const from = next.findIndex((w) => w.id === work.id);
		if (from !== to) {
			[next[from], next[to]] = [next[to], next[from]];
			works.value = next;
			persistOrder();
		}
		// Re-key the cropper only when the frame aspect actually changes, so re-clicking
		// the current spot doesn't remount and discard an in-progress crop.
		if (aspect.value !== homeZones[spot - 1].ar) setAspect(homeZones[spot - 1].ar);
	}

	// Take the selected work off the homepage: swap it with the first unplaced work
	// (order ≥ 8) so the 8 fixed spots stay filled. No-op if it's already unplaced or
	// there's no overflow work to pull onto the board.
	function unplace() {
		const work = currentWork.value;
		if (!work || work.order >= homeZones.length) return;
		const next = works.value.slice();
		const overflow = next.findIndex((w) => w.order >= homeZones.length);
		if (overflow === -1) return;
		const from = next.findIndex((w) => w.id === work.id);
		[next[from], next[overflow]] = [next[overflow], next[from]];
		works.value = next;
		persistOrder();
	}

	// Select + open a work in the editor, rehydrating every control from its stored
	// params so adjustments continue non-destructively from the pristine original (#9).
	function openEditor(work) {
		editingId.value = work.id;
		// Frame to the work's homepage zone so the preview shows how it'll be cropped
		// there; unplaced works fall back to their own aspect ('original').
		aspect.value = work.order < homeZones.length ? homeZones[work.order].ar : 'original';
		const edit = work.edit ?? {};
		tilt.value = edit.tilt ?? 0;
		appliedTilt = 0;
		brightness.value = edit.brightness ?? 1;
		contrast.value = edit.contrast ?? 1;
		storedCrop = edit.crop ?? null;
		cropCoords = storedCrop;
		cropResult.value = null; // drop the prior work's live preview until this one is ready
		initializing = true;
		loadingImage.value = true;
		editorSrc.value = `/api/works/${work.id}/original`;
	}

	// Replay the stored edit into the freshly-loaded cropper (#9): rotate to the
	// stored tilt, then restore the crop rectangle (captured in that post-rotation
	// space, so it sets back directly). Transitions off -> instant + deterministic.
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
		loadingImage.value = false;
		nextTick(() => {
			initializing = false;
		});
	}

	// vue-advanced-cropper emits coordinates {left, top, width, height} in the
	// rotated image's pixel space — exactly what the server extracts after rotating.
	function onCropChange(result) {
		// Feed the live zone preview on every change (including the rehydration replay).
		cropResult.value = result;
		if (initializing) return;
		cropCoords = result.coordinates;
	}

	// Bring the cropper to the current absolute `tilt` by rotating the remaining delta.
	// `transitions: false` is essential: rotate() no-ops while a transition is active, so
	// the default (animated) call would drop rapid wheel updates — pass false to apply
	// every delta instantly, which also keeps the cover-the-stencil re-fit scale steady.
	function onTiltInput() {
		if (!cropperRef.value) return;
		const delta = tilt.value - appliedTilt;
		if (!delta) return;
		cropperRef.value.rotate(delta, { transitions: false });
		appliedTilt = tilt.value;
	}

	// Save the selected work's caption + photo edit to cms-draft.
	async function saveAll() {
		const work = currentWork.value;
		if (!work) return;
		await saveCaption(work);
		await saveEdit();
	}

	// Save crop + tilt + light to cms-draft: the backend reprocesses the master from
	// the pristine original and regenerates the variant set. Keeps the work selected.
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
			await loadWorks();
			publishMsg.value = 'Saved to draft.';
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
		// `order` is the source of truth for sequence — sort by it so the admin list
		// matches the published gallery.
		works.value = (body.works ?? []).slice().sort((a, b) => a.order - b.order);
		rev.value += 1; // cache-bust thumbnails after any change
		await refreshDraftStatus();
		return true;
	}

	// Refresh the unpublished-changes count. Non-critical: on failure the last known
	// status is left in place rather than surfacing an error.
	async function refreshDraftStatus() {
		try {
			const res = await fetch('/api/draft/status', { credentials: 'same-origin' });
			if (res.ok) draft.value = await res.json();
		} catch {
			// Ignore — keep the previous count.
		}
	}

	// Discard all unpublished work (with a confirm step): resets cms-draft to main.
	async function discard() {
		const ok = window.confirm(
			'Discard all unpublished changes? This reverts the draft to what is currently live and cannot be undone.',
		);
		if (!ok) return;
		discarding.value = true;
		publishMsg.value = '';
		try {
			const res = await fetch('/api/draft/discard', {
				method: 'POST',
				credentials: 'same-origin',
			});
			if (!res.ok) {
				publishMsg.value = 'Could not discard the draft.';
				return;
			}
			await loadWorks();
			publishMsg.value = 'Draft discarded — back to what is currently live.';
		} catch {
			publishMsg.value = 'Could not reach the server.';
		} finally {
			discarding.value = false;
		}
	}

	// --- Reorder (native HTML5 drag-and-drop on the rail) ---
	function onDragStart(index) {
		dragIndex.value = index;
	}
	function onDragOver() {
		// Required so the row is a valid drop target.
	}
	function onDragEnd() {
		dragIndex.value = -1;
	}
	function onDrop(targetIndex) {
		const from = dragIndex.value;
		dragIndex.value = -1;
		if (from === -1 || from === targetIndex) return;
		const next = works.value.slice();
		const [moved] = next.splice(from, 1);
		next.splice(targetIndex, 0, moved);
		works.value = next;
		persistOrder();
	}

	// Persist the current sequence to cms-draft; the server renumbers order fields.
	async function persistOrder() {
		publishMsg.value = '';
		try {
			const res = await fetch('/api/works/order', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ ids: works.value.map((w) => w.id) }),
			});
			if (!res.ok) {
				publishMsg.value = 'Could not save the new order.';
				await loadWorks();
				return;
			}
			const body = await res.json();
			works.value = body.works;
			await refreshDraftStatus();
			publishMsg.value = 'Order saved to draft.';
		} catch {
			publishMsg.value = 'Could not reach the server.';
			await loadWorks();
		}
	}

	// Delete a work (with a confirm step): removes its files + record from cms-draft.
	async function removeWork(work) {
		const ok = window.confirm(
			`Delete “${work.caption.holder}”? This removes the photo and all its sizes from the draft. This cannot be undone.`,
		);
		if (!ok) return;
		deletingId.value = work.id;
		publishMsg.value = '';
		try {
			const res = await fetch(`/api/works/${work.id}`, {
				method: 'DELETE',
				credentials: 'same-origin',
			});
			if (!res.ok) {
				publishMsg.value = 'Could not delete the work.';
				return;
			}
			if (editingId.value === work.id) editingId.value = '';
			await loadWorks();
			publishMsg.value = `Deleted “${work.caption.holder}” from the draft.`;
		} catch {
			publishMsg.value = 'Could not reach the server.';
		} finally {
			deletingId.value = '';
		}
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
			await refreshDraftStatus();
		} catch {
			publishMsg.value = 'Could not reach the server.';
		} finally {
			savingId.value = '';
		}
	}

	// Upload a new photo: POST the multipart form, then refresh the list.
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
			const body = await res.json();
			await loadWorks();
			publishMsg.value = 'Uploaded to draft.';
			if (body.work) openEditor(body.work); // jump straight into the new work
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
			if (res.ok) await refreshDraftStatus();
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
		editingId.value = '';
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
		min-height: 100vh;
		width: 100%;
		background: #1a1413;
		color: rgba(255, 246, 234, 0.9);
		font-family: var(--font-body);

		input,
		button {
			font: inherit;
		}

		button {
			padding: 0.55rem 1rem;
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

		&__brand {
			font-family: var(--font-antonio);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: var(--ember);
			margin: 0;
		}

		&__error {
			color: var(--ember);
		}

		// --- Login ---
		&__login {
			min-height: 100vh;
			max-width: 22rem;
			margin: 0 auto;
			padding: 1rem;
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: 0.75rem;

			input {
				padding: 0.6rem 0.75rem;
				border: 1px solid var(--line);
				border-radius: 6px;
				background: transparent;
				color: inherit;
			}
		}

		// --- App shell ---
		&__shell {
			display: flex;
			min-height: 100vh;
		}

		&__rail {
			flex: 0 0 19rem;
			display: flex;
			flex-direction: column;
			min-height: 100vh;
			max-height: 100vh;
			border-right: 1px solid var(--line);
			background: rgba(0, 0, 0, 0.25);
		}

		&__rail-head {
			padding: 1rem;
			display: flex;
			flex-direction: column;
			gap: 0.7rem;
			border-bottom: 1px solid var(--line);
		}

		&__upload-label {
			display: block;
			text-align: center;
			padding: 0.55rem 0.75rem;
			border: 1px dashed var(--line);
			border-radius: 6px;
			cursor: pointer;
			font-size: 0.9rem;

			input {
				display: none;
			}

			&:hover {
				border-color: var(--ember);
				color: var(--ember);
			}
		}

		&__works {
			list-style: none;
			margin: 0;
			padding: 0.5rem;
			flex: 1;
			overflow-y: auto;
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
		}

		&__work {
			display: grid;
			grid-template-columns: 2.5rem 1fr auto;
			align-items: center;
			gap: 0.6rem;
			padding: 0.4rem 0.5rem;
			border-radius: 8px;
			cursor: pointer;

			&:hover {
				background: rgba(255, 255, 255, 0.04);
			}
		}

		&__work--on {
			background: rgba(210, 105, 63, 0.18);
			outline: 1px solid var(--ember);
		}

		&__work--dragging {
			opacity: 0.4;
		}

		&__thumb {
			width: 2.5rem;
			height: 2.5rem;
			object-fit: cover;
			border-radius: 4px;
			background: rgba(255, 255, 255, 0.04);
		}

		&__work-title {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 0.9rem;
		}

		&__work-spot {
			flex-shrink: 0;
			font-size: 0.75rem;
			color: var(--ember);
			opacity: 0.85;
		}

		&__work-spot--unplaced {
			color: inherit;
			opacity: 0.4;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			font-size: 0.62rem;
		}

		&__rail-foot {
			padding: 1rem;
			border-top: 1px solid var(--line);
			display: flex;
			flex-direction: column;
			gap: 0.5rem;
		}

		&__draft {
			margin: 0 0 0.25rem;
			font-size: 0.8rem;
			opacity: 0.7;
		}

		// --- Homepage layout wireframe (nav) ---
		// Same 12-col × 11-row grid + zone spans as HomeView, so the mini map mirrors the
		// real collage proportions. Cell aspect ≈ 1.74, hence the grid aspect-ratio.
		&__map {
			padding: 0.75rem 1rem;
			border-top: 1px solid var(--line);
		}

		&__map-label {
			margin: 0 0 0.5rem;
			font-size: 0.72rem;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			opacity: 0.5;
		}

		&__map-grid {
			display: grid;
			grid-template-columns: repeat(12, 1fr);
			grid-template-rows: repeat(11, 1fr);
			gap: 2px;
			aspect-ratio: 1.9;
			width: 100%;
		}

		&__zone {
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
			overflow: hidden;
			padding: 0;
			min-height: 0;
			border: 1px solid var(--line);
			border-radius: 2px;
			background: rgba(255, 255, 255, 0.04);
			cursor: pointer;
		}

		&__zone--on {
			border-color: var(--ember);
			outline: 1px solid var(--ember);
		}

		&__zone-img {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			object-fit: cover;
			opacity: 0.7;
		}

		// Live crop preview (vue-advanced-cropper <Preview fill>) for the work being
		// edited; mirror the editor's brightness/contrast filter onto its image.
		&__zone-live {
			position: absolute;
			inset: 0;

			:deep(.vue-preview__image) {
				filter: var(--preview-filter, none);
			}
		}

		// Scrim so the spot number stays legible over any image.
		&__zone::after {
			content: '';
			position: absolute;
			inset: 0;
			background: rgba(0, 0, 0, 0.4);
			pointer-events: none;
		}

		&__zone-num {
			position: relative;
			z-index: 1;
			font-family: var(--font-antonio);
			font-size: 0.95rem;
			font-weight: 700;
			color: var(--bone);
			text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
		}

		// --- Main / detail ---
		&__main {
			flex: 1;
			min-width: 0;
			max-height: 100vh;
			overflow-y: auto;
			padding: 1.5rem clamp(1rem, 4vw, 3rem);
		}

		&__notice {
			color: var(--ember);
			margin: 0 0 1rem;
		}

		&__empty {
			height: 70vh;
			display: grid;
			place-items: center;
			opacity: 0.45;
		}

		&__detail {
			max-width: 880px;
			margin: 0 auto;
			display: flex;
			flex-direction: column;
			gap: 1.25rem;
		}

		// Metadata row at the top of the editor: fields on the left, actions on the right.
		&__meta {
			display: flex;
			flex-wrap: wrap;
			align-items: flex-end;
			justify-content: space-between;
			gap: 1rem;
		}

		&__caption {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-start;
			gap: 1rem;

			label {
				display: flex;
				flex-direction: column;
				gap: 0.3rem;
				font-size: 0.78rem;
				opacity: 0.85;
			}

			input {
				padding: 0.45rem 0.6rem;
				border: 1px solid var(--line);
				border-radius: 6px;
				background: transparent;
				color: inherit;
			}
		}

		&__detail-actions {
			display: flex;
			justify-content: flex-end;
			gap: 0.75rem;
		}

		&__delete {
			border-color: rgba(210, 105, 63, 0.55);
		}

		// --- Editor (image, contextual controls, tool tabs across the bottom) ---
		&__editor {
			display: flex;
			flex-direction: column;
			gap: 1rem;
		}

		// Tool tabs: long skinny buttons spanning the full width across the bottom.
		&__editor-rail {
			display: flex;
			flex-direction: row;
			gap: 0.5rem;
		}

		&__tool {
			flex: 1;
			display: flex;
			flex-direction: row;
			align-items: center;
			justify-content: center;
			gap: 0.45rem;
			padding: 0.55rem 0.75rem;
			border: 1px solid var(--line);
			border-radius: 8px;
			background: transparent;
			color: inherit;
			cursor: pointer;
			font-size: 0.8rem;
		}

		// Compound selector so it outranks the global `.admin button` rule (which would
		// otherwise reset border/colour back to the default line colour).
		&__tool.admin__tool--on {
			border-color: var(--ember);
			color: var(--ember);
		}

		&__tool-ico {
			font-size: 1rem;
		}

		&__editor-main {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}

		&__editor-stage {
			position: relative;
			height: 60vh;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		&__editor-loading {
			position: absolute;
			inset: 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.75rem;
			background: rgba(0, 0, 0, 0.35);
			font-size: 0.85rem;
			opacity: 0.85;
		}

		&__spinner {
			width: 2rem;
			height: 2rem;
			border-radius: 50%;
			border: 3px solid rgba(255, 246, 234, 0.2);
			border-top-color: var(--ember);
			animation: admin-spin 0.7s linear infinite;
		}

		@keyframes admin-spin {
			to {
				transform: rotate(360deg);
			}
		}

		&__cropper {
			width: 100%;
			height: 100%;
			background: rgba(0, 0, 0, 0.35);

			// Live brightness/contrast preview — filter both the faded background image
			// AND the bright in-crop stencil preview (a separate element). The backend
			// reproduces this exact filter via sharp.
			:deep(.vue-advanced-cropper__image),
			:deep(.vue-preview__image) {
				filter: var(--preview-filter, none);
			}
		}

		&__editor-hint {
			margin: 0;
			font-size: 0.75rem;
			opacity: 0.55;
		}

		&__editor-controls {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.75rem;
			min-height: 2.5rem;
		}

		&__spot-pick {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.4rem;
			margin-top: 0.75rem;
		}

		&__ctl-label {
			opacity: 0.6;
			font-size: 0.85rem;
		}

		&__ctl-zoom {
			display: inline-flex;
			gap: 0.4rem;
			margin-left: auto;
		}

		&__chip {
			padding: 0.3rem 0.7rem;
			border: 1px solid var(--line);
			border-radius: 999px;
			background: transparent;
			color: inherit;
			cursor: pointer;
		}

		// Filled active state, with a compound selector so it outranks `.admin button`.
		&__chip.admin__chip--on {
			background: var(--ember);
			border-color: var(--ember);
			color: #1a1413;
		}

		// Light tool: brightness + contrast wheels stacked.
		&__light {
			display: flex;
			flex-direction: column;
			gap: 0.6rem;
			width: 100%;
		}
	}
</style>
