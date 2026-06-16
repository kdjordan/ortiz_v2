<template>
	<div class="about">
		<div class="about__portrait">
			<img src="/images/r-profile.jpg" alt="Randy Ortiz Artist" />
		</div>
		<div class="about__copy">
			<p class="eyebrow">About the artist</p>
			<p>
				Randy Ortiz is a Eugene, Oregon based, Southern California
				native, who received his Fine and Applied Arts degree from the
				University of Oregon in 2003.
			</p>
			<p>
				Trained in the classical drawing and sculptural methods passed
				down over millennia, Randy has amassed extensive knowledge of
				long-established design principals and techniques trusted
				throughout humanities’ imaginative evolution. Working apace
				with contemporary building trends in wide ranging mediums has
				allowed Randy to successfully envision a channel between
				modern design esthetics and those of antiquity.
			</p>
			<p>
				His work can be found in both private and public collections
				throughout the Willamette valley and beyond.
			</p>
		</div>
	</div>
</template>

<style scoped lang="scss">
	.about {
		flex: 1;
		font-family: var(--font-body);
		letter-spacing: 0;
		font-size: clamp(1rem, 1.6vw, 1.18rem);
		display: grid;
		grid-template-columns: minmax(12rem, 0.55fr) minmax(18rem, 1fr);
		gap: clamp(1.5rem, 5vw, 5rem);
		align-items: center;
		width: min(960px, calc(100% - 2rem));
		margin: 0 auto;
		padding: clamp(2rem, 6vw, 5rem) 0;
		line-height: 1.6;

		&__portrait {
			position: relative;

			&::before {
				content: '';
				position: absolute;
				inset: -0.8rem;
				border: 1px solid var(--line);
				border-radius: 8px;
			}

			img {
				position: relative;
				display: block;
				width: 100%;
				aspect-ratio: 4 / 5;
				object-fit: cover;
				border-radius: 8px;
				box-shadow: 0 28px 80px var(--shadow);
			}
		}

		&__copy {
			color: rgba(255, 246, 234, 0.85);

			p {
				text-align: left;
				margin-bottom: 1rem;
			}
		}

		.eyebrow {
			font-family: var(--font-antonio);
			text-transform: uppercase;
			color: var(--ember);
			margin-bottom: 1.25rem;
		}
	}

	@media (max-width: 720px) {
		.about {
			grid-template-columns: 1fr;

			&__portrait {
				max-width: 18rem;
			}
		}
	}
</style>
