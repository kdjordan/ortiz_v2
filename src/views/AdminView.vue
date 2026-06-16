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
				</li>
			</ul>
		</div>
	</div>
</template>

<script setup>
	import { onMounted, ref } from 'vue';

	const authed = ref(false);
	const works = ref([]);
	const password = ref('');
	const error = ref('');
	const busy = ref(false);
	const savingId = ref('');
	const publishing = ref(false);
	const publishMsg = ref('');
	const uploading = ref(false);

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
	}
</style>
