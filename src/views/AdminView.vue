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
				<button type="button" @click="logout">Log out</button>
			</div>
			<ul>
				<li v-for="work in works" :key="work.id">
					<span class="admin__order">{{ work.order }}</span>
					<span class="admin__holder">{{ work.caption.holder }}</span>
					<span class="admin__desc">{{ work.caption.desc }}</span>
					<span class="admin__year">{{ work.caption.year }}</span>
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

		&__works ul {
			list-style: none;
			padding: 0;
			margin: 0;
		}

		&__works li {
			display: grid;
			grid-template-columns: 2rem 8rem 1fr auto;
			gap: 0.75rem;
			align-items: baseline;
			padding: 0.6rem 0;
			border-top: 1px solid var(--line);
		}

		&__order {
			color: var(--ember);
		}

		&__year {
			opacity: 0.7;
		}
	}
</style>
