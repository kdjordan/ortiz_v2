<template>
	<div class="overlay" v-if="!isLoaded">
		<div class="overlay__container">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 200.51 578.74"
			>
				<path
					class="outer"
					d="M101.35,444s30.6-26.41,39.54-40.45c12.77-20.07,26.08-57.49,23.72-88.19a143.6,143.6,0,0,0-44.1-92.76C99.7,202.8,88.92,197.46,77.94,189.46c-13.38-9.73-18.86-20.68-21-24-6.77-10.63-9.73-27.52-8.21-43.8,1.44-15.35,8-37.25,26.76-53.22,25.22-21.52,54.75-22.8,54.75-22.8L126.9,0S95,3.65,72.46,15.81C49.36,28.3,21.86,55.18,13.76,73.9-.84,107.65.69,132,.08,165.14s2.43,376,2.43,376l47.6.46L50.86,468l88.81,110.7L182,546ZM50.57,418.77,50,228.39s67.44,32.54,66,98.54S50.57,418.77,50.57,418.77Z"
					style="fill: var(--orange)"
				/>
				<path
					class="inner"
					d="M129.08,96.71a30.56,30.56,0,1,1-30.44,30.56,30.53,30.53,0,0,1,30.44-30.56m0-41a71.56,71.56,0,1,0,71.43,71.56,71.5,71.5,0,0,0-71.43-71.56Z"
					style="fill: var(--orange)"
				/>
			</svg>
		</div>
	</div>
</template>

<script>
	import gsap from 'gsap';

	export default {
		data() {
			return {
				isLoaded: false,
			};
		},
		methods: {
			setIsLoading() {
				this.isLoaded = true;
			},
		},
		mounted() {
			let tl = gsap.timeline();
			tl.set('.outer, .inner', {
				opacity: 0,
			});
			tl.to('.inner', { opacity: 1, duration: 1.5 });
			tl.to('.outer', { opacity: 1, duration: 1.5 });
			tl.to('.overlay__container', { scale: 100, duration: 2 });
			tl.to('.overlay', {
				opacity: 0,
				duration: 2,
				delay: -2,
				onComplete: this.setIsLoading,
			});
		},
	};
</script>

<style lang="scss">
	//opening animation
	.overlay {
		overflow-y: hidden;
		display: block;
		position: absolute;
		top: 0;
		left: 0;
		background-color: #222831;
		height: 100vh;
		width: 100vw;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 99;

		&__container {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 10%;
		}
	}
</style>
