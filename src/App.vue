<template>
	<div class="main-wrapper">
		<TheHeader />
		<TheLogo />
		<RouterView />
		<TheFooter />
	</div>
</template>

<script setup>
	import TheFooter from '@/components/TheFooter.vue';
	import TheHeader from '@/components/TheHeader.vue';
	import TheLogo from '@/components/TheLogo.vue';
</script>

<style lang="scss">
	.main-wrapper {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		width: 100%;
	}
</style>
