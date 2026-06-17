<template>
	<div class="main-wrapper">
		<!-- Admin + the throwaway editor lab run as full-screen apps without the public
		     marketing header/logo/footer. -->
		<template v-if="!bare">
			<TheHeader />
			<TheLogo />
		</template>
		<RouterView />
		<TheFooter v-if="!bare" />
	</div>
</template>

<script setup>
	import { computed } from 'vue';
	import { useRoute } from 'vue-router';
	import TheFooter from '@/components/TheFooter.vue';
	import TheHeader from '@/components/TheHeader.vue';
	import TheLogo from '@/components/TheLogo.vue';

	const route = useRoute();
	const bare = computed(() => route.path === '/admin');
</script>

<style lang="scss">
	.main-wrapper {
		position: relative;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		width: 100%;
	}
</style>
