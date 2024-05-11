<template>
	<div v-if="loading">
		<TheLoading @handleLoading="setLoadingFalse" />
	</div>
	<div v-else>
		<div class="main-wrapper">
			<TheHeader />
			<TheLogo />
			<RouterView />
			<TheFooter />
		</div>
	</div>
</template>

<script>
	import TheFooter from '@/components/TheFooter.vue';
	import TheHeader from '@/components/TheHeader.vue';
	import TheLoading from '@/components/TheLoading.vue';
	import TheLogo from '@/components/TheLogo.vue';

	export default {
		data() {
			return {
				loading: false,
			};
		},
		methods: {
			setLoadingFalse() {
				this.loading = false;
			},
		},
		components: {
			TheHeader,
			TheLogo,
			TheLoading,
			TheFooter,
		},
	};
</script>

<style lang="scss">
	.main-wrapper {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

</style>
