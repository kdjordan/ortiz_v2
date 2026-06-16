<template>
  <div class="bottom">
      <div class="bottom__left">
          <div>
              <a href="mailto:ortizmetals@gmail.com" target="_blank" rel="noopener noreferrer nofollow">ortizmetals@gmail.com</a>
          </div>
          <div>
              <a href="tel:541-510-2182">541-510-2182</a> 
          </div>
      </div>
      <div class="bottom__mid">
          Sculpture | Design
      </div>
      <div class="bottom__right">
          <div>
              &#169; 2024 Ortiz Metals 
          </div>
          <div>
              <a href="https://www.kevinjordan.dev" target="_blank" rel="noopener noreferrer nofollow">BUILT BY : Kevin Jordan</a>
          </div>
      </div>    
  </div>
</template>

<style scoped lang="scss">
a {
  cursor: pointer;
}
.bottom {
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem clamp(1rem, 4vw, 3rem);
  font-family: var(--font-antonio);
  letter-spacing: 0;
  color: rgba(255, 233, 211, 0.82);

  @media (max-width: 35em) {
      flex-direction: column;
      gap: 10px;
      align-items: flex-start;
  }


  &__mid {
      font-size: 1.4rem;
      line-height: 1.8;
      color: var(--bone);

       @media (max-width: 35em) {
          order: -1;
      }
  }
}

</style>
