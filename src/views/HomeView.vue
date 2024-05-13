<template>
	<div class="home">
		<div class="home__center">
			<div class="control" @click="move('back')">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 28 28"
					style="fill: var(--cream); fill-rule: evenodd"
				>
					<path
						d="M14,1A13,13,0,1,1,1,14,13,13,0,0,1,14,1m0-1A14,14,0,1,0,28,14,14,14,0,0,0,14,0Z"
					/>
					<rect x="6.5" y="13" width="15" height="2" />
				</svg>
			</div>
			<figure>
				<div class="img-wrap">
					<img
						:src="currentImage.link"
						alt=""
						:key="currentImage.index"
						class="full-image"
					/>

					<figcaption class="home__center--desc">
						{{ currentImage.desc }}
					</figcaption>
				</div>
			</figure>
			<div class="control" @click="move('forward')">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 28 28"
					style="fill: var(--cream); fill-rule: evenodd"
				>
					<path
						d="M14,1A13,13,0,1,1,1,14,13,13,0,0,1,14,1m0-1A14,14,0,1,0,28,14,14,14,0,0,0,14,0Z"
					/>
					<polygon
						points="21.5 12.35 15.4 12.35 15.4 6.35 13.4 6.35 13.4 12.35 6.5 12.35 6.5 14.35 13.4 14.35 13.4 21.35 15.4 21.35 15.4 14.35 21.5 14.35 21.5 12.35"
					/>
				</svg>
			</div>
		</div>
		<div class="sider">
			<div
				v-for="image in this.imageData"
				class="sider--entry"
				:key="image.index"
				:class="{ active: image.index == this.index }"
				@click="setImageIndex(image.index)"
			>
				{{ image.holder }}
			</div>
		</div>
	</div>
</template>

<script>
	import { imageData } from '@/imageData.js';
	import gsap from 'gsap';

	export default {
		data() {
			return {
				index: 0,
				imageData: [],
			};
		},
		mounted() {
			this.imageData = imageData;
		},
		methods: {
			move(dir) {
				if (dir === 'forward') {
					this.index === this.imageData.length - 1
						? (this.index = 0)
						: this.index++;
				} else if (dir === 'back') {
					this.index === 0
						? (this.index = this.imageData.length - 1)
						: this.index--;
				}
			},
			setImageIndex(index) {
				this.index = index;
			},
			doAnimation() {
				console.log('this ', this.isFirstRun);

				let tl = gsap.timeline();
				tl.set('.sider, .home__center', { opacity: 0 });
				tl.to('.sider', { opacity: 1, delay: 5 }).to(
					'.home__center',
					{ opacity: 1 }
				);
				this.isFirstRun = false;
			},
			doNotAnimate() {
				tl.set('.sider, .home__center', { opacity: 1 });
			},
		},
		computed: {
			currentImage() {
				return this.imageData[this.index] || {};
			},
		},
	};
</script>

<style lang="scss">
	.home {
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-antonio);
		letter-spacing: 1px;
		height: 100%;
		margin-bottom: auto;

		@media (max-width: 37.5em) {
			flex-direction: column;
			justify-content: space-around;
			align-items: center;
		}

		&__center {
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 1.3rem;
			height: 100%;
			margin-bottom: auto;

			@media (max-width: 37.5em) {
				margin-bottom: 0;
				height: 70%;
			}

			&--desc {
				font-family: var(--font-antonio);
				margin-top: 1rem;

				@media (max-width: 37.5em) {
					font-size: 1rem;
					margin-bottom: 0.3rem;
				}
			}
		}

		figure {
			& .img-wrap {
				display: block;
				height: auto;
			}

			& .full-image {
				display: block;
				width: 90%;
				// min-width: 20rem;
				margin: 0 auto;
				// max-height: calc(100vh - 15rem);

				min-height: 15rem;
				// max-height: 90%;
				height: auto;
				line-height: 0;
				border-radius: 5px;
				box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.2);
			}
		}
	}
	.sider {
		position: fixed;
		display: flex;
		flex-direction: column;
		gap: 5px;
		top: 50px;
		right: 50px;
		text-align: left;

		@media (max-width: 37.5em) {
			display: none;
		}

		&--entry {
			display: block;
			cursor: pointer;
			transition: all 0.4s ease;

			@media (max-width: 37.5em) {
				font-size: 0.9rem;
				margin: 0 0.2rem;
				margin-bottom: 1rem;
				border: 1px solid var(--cream);
				padding: 0.2rem 0.3rem;
			}

			&:hover {
				filter: opacity(50%);
			}
		}
	}

	.control {
		cursor: pointer;
		width: 30px;
		transition: all 0.4s ease;
		margin: 0 1rem;

		@media (max-width: 37.5em) {
			min-width: 30px;
		}

		&:hover {
			filter: opacity(50%);
		}
	}

	.mobile-sider {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-around;
		gap: 10px;
		width: 90%;
		display: none;

		@media (min-width: 37.5em) {
			display: none;
		}
	}

	.active {
		color: var(--blue);

		@media (max-width: 37.5em) {
			color: var(--blue);
		}
	}
</style>
