<template>
  <div class="side-nav">
    <!-- <Logo /> -->
    <ul>
      <li>Item XX</li>
      <li>Item XX</li>
      <li>Item XX</li>
      <li>Item XX</li>
      <li>Item XX</li>
    </ul>
  </div>
</template>

<script>
import Logo from '@/components/Logo.vue'
export default {
  components: {
    Logo
  }
}
</script>

<style scoped lang="scss">
.side-nav {
  display: flex;
  flex-direction: column;
  position: absolute;
  top: 6rem; 
  left: 0;
  z-index: 2;
  width: 9rem;
  height: 100%;
  background-color: var(--saddle-brown);
  color: white;

  & ul {
    
    position: relative;
    top: 20%;
    overflow-y: auto;
  }
}
</style>