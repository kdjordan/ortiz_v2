<template>
  <div class="header">
    <h1 class="brand" aria-label="Randy Ortiz">
      <span class="brand__word" aria-hidden="true">
        <span v-for="(ch, ci) in 'Randy'" :key="'r' + ci" class="brand__char">{{ ch }}</span>
      </span>
      <span class="brand__word" aria-hidden="true">
        <span v-for="(ch, ci) in 'Ortiz'" :key="'o' + ci" class="brand__char">{{ ch }}</span>
      </span>
    </h1>
    <nav>
      <router-link to="/" class="link">Work</router-link>
      <router-link to="/about" class="link">About</router-link>
    </nav>
  </div>
</template>

<script setup>
  import { onMounted } from 'vue';
  import gsap from 'gsap';

  onMounted(() => {
    // Plays LAST — after the home photo intro settles (~1.2s in).
    const tl = gsap.timeline({ delay: 1.2 });
    tl.to('.brand__char', {
      opacity: 1,
      y: 0,
      duration: 0.55,
      ease: 'power3.out',
      stagger: 0.055,
    }).to(
      '.header nav .link',
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out' },
      '-=0.3'
    );
  });
</script>

<style>
.header {
  padding: 1.25rem clamp(1rem, 4vw, 3rem) 0;
  background: transparent;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  letter-spacing: 0;
  position: relative;
  z-index: 5;
}

h1 {
  font-family: var(--font-antonio);
  font-size: clamp(2rem, 5vw, 4.5rem);
  line-height: 0.9;
  text-transform: uppercase;
}

.brand {
  display: inline-flex;
  gap: 0.3em;
}

.brand__word {
  display: inline-flex;
}

.brand__char {
  display: inline-block;
  /* hidden until the delayed reveal runs — never permanently clipped */
  opacity: 0;
  transform: translateY(0.5em);
  will-change: transform, opacity;
}

nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
}

.header nav .link {
  opacity: 0;
  transform: translateY(-8px);
}

.router-link-exact-active{
  border-bottom: 1px solid var(--cream);
  color: var(--bone);
}

@media (max-width: 600px) {
  nav {
    justify-content: flex-end;
  }

  .link {
    margin-left: 0;
  }
}
</style>
