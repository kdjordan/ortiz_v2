<template>
	<div class="wheelctl">
		<span class="wheelctl__label">{{ label }}</span>
		<div ref="track" class="wheelctl__wheel" :style="wheelStyle" @pointerdown="onDown">
			<span class="wheelctl__center"></span>
		</div>
		<div class="wheelctl__nudge">
			<button type="button" class="wheelctl__btn" aria-label="Increase" @click="nudge(step)">▲</button>
			<button type="button" class="wheelctl__btn" aria-label="Decrease" @click="nudge(-step)">▼</button>
		</div>
		<span class="wheelctl__val">{{ display }}</span>
	</div>
</template>

<script setup>
	// Drag-to-spin tick-ruler control. Reused for straighten (degrees) and light
	// (brightness/contrast). The wheel is conceptually endless; bounded values just
	// stop at min/max. Emits `update:modelValue` (v-model) + `change` for side effects.
	import { computed, onBeforeUnmount, ref } from 'vue';

	const props = defineProps({
		modelValue: { type: Number, required: true },
		label: { type: String, default: '' },
		min: { type: Number, default: -Infinity },
		max: { type: Number, default: Infinity },
		step: { type: Number, default: 0.1 }, // micro-nudge + rounding granularity
		pxPerUnit: { type: Number, default: 10 }, // drag sensitivity + tick scale
		minorTick: { type: Number, default: 1 }, // value between minor ticks
		majorTick: { type: Number, default: 5 }, // value between major (brighter) ticks
		decimals: { type: Number, default: 1 },
		suffix: { type: String, default: '' },
	});
	const emit = defineEmits(['update:modelValue', 'change']);

	const track = ref(null);
	let lastX = 0;

	const display = computed(() => props.modelValue.toFixed(props.decimals) + props.suffix);
	const wheelStyle = computed(() => ({
		'--wheel-offset': -props.modelValue * props.pxPerUnit + 'px',
		'--wheel-minor': props.minorTick * props.pxPerUnit + 'px',
		'--wheel-major': props.majorTick * props.pxPerUnit + 'px',
	}));

	function setValue(v) {
		const clamped = Math.min(props.max, Math.max(props.min, v));
		// snap to step, then trim float dust (e.g. 1.0500000000001 -> 1.05)
		const snapped = parseFloat((Math.round(clamped / props.step) * props.step).toFixed(6));
		if (snapped !== props.modelValue) {
			emit('update:modelValue', snapped);
			emit('change', snapped);
		}
	}
	function nudge(d) {
		setValue(props.modelValue + d);
	}
	function onDown(e) {
		lastX = e.clientX;
		// Capture so we keep getting move/up even if the pointer leaves the window.
		e.currentTarget.setPointerCapture?.(e.pointerId);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
	function onMove(e) {
		const dx = e.clientX - lastX;
		lastX = e.clientX;
		setValue(props.modelValue + dx / props.pxPerUnit);
	}
	function onUp() {
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
	}
	// Drop any in-flight drag listeners if the control unmounts mid-drag (e.g. the
	// user switches tool tabs while dragging), so they can't fire on a dead instance.
	onBeforeUnmount(onUp);
</script>

<style scoped lang="scss">
	.wheelctl {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		font-size: 0.85rem;
		color: rgba(255, 246, 234, 0.9);

		&__label {
			opacity: 0.6;
			white-space: nowrap;
			min-width: 5rem;
		}

		&__wheel {
			position: relative;
			flex: 1;
			height: 2.5rem;
			border: 1px solid var(--line);
			border-radius: 6px;
			overflow: hidden;
			cursor: ew-resize;
			touch-action: none;
			user-select: none;
			background-color: rgba(0, 0, 0, 0.25);
			// Minor + major tick rulers, spacing driven by the value-to-px scale so the
			// ticks always read the real value. Both scroll via --wheel-offset.
			background-image: repeating-linear-gradient(
					90deg,
					transparent 0 calc(var(--wheel-minor) - 1px),
					rgba(255, 246, 234, 0.22) calc(var(--wheel-minor) - 1px) var(--wheel-minor)
				),
				repeating-linear-gradient(
					90deg,
					transparent 0 calc(var(--wheel-major) - 1px),
					rgba(255, 246, 234, 0.45) calc(var(--wheel-major) - 1px) var(--wheel-major)
				);
			background-repeat: repeat-x;
			background-position-x: var(--wheel-offset, 0px);
			mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
		}

		&__center {
			position: absolute;
			left: 50%;
			top: 0;
			bottom: 0;
			width: 2px;
			transform: translateX(-50%);
			background: var(--ember);
			pointer-events: none;
		}

		&__nudge {
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
		}

		&__btn {
			padding: 0.1rem 0.55rem;
			line-height: 1.1;
			font-size: 0.7rem;
			border: 1px solid var(--line);
			border-radius: 6px;
			background: transparent;
			color: inherit;
			cursor: pointer;
		}

		&__val {
			min-width: 3.5rem;
			text-align: right;
			color: var(--ember);
		}
	}
</style>
