<template>
	<TheLoading />
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
	import TheLoading from '@/components/TheLoading.vue';
	import TheLogo from '@/components/TheLogo.vue';
</script>

<style lang="scss">
	.main-wrapper {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}
</style>
