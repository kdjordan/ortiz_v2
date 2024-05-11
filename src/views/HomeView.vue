<template>
  <div class="home">
    <div class="home__center">
      <div class="control" @click="move(0)" >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" style="fill:var(--cream);fill-rule:evenodd">
          <path d="M14,1A13,13,0,1,1,1,14,13,13,0,0,1,14,1m0-1A14,14,0,1,0,28,14,14,14,0,0,0,14,0Z"/>
          <rect x="6.5" y="13" width="15" height="2"/>
        </svg>
      </div>
      <figure >
        <div class="img-wrap">
          <transition name="fade" mode="out-in">
            <img :src="`${imageData[index].link}`"  :key="imageData[index].link" alt="" class="full-image">
          </transition>
        </div>
        <figcaption class="home__center--desc">
          {{imageData[index].desc}}
        </figcaption>
      </figure>
      <div class="control" @click="move(1)" >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" style="fill:var(--cream);fill-rule:evenodd">
          <path d="M14,1A13,13,0,1,1,1,14,13,13,0,0,1,14,1m0-1A14,14,0,1,0,28,14,14,14,0,0,0,14,0Z"/>
          <polygon points="21.5 12.35 15.4 12.35 15.4 6.35 13.4 6.35 13.4 12.35 6.5 12.35 6.5 14.35 13.4 14.35 13.4 21.35 15.4 21.35 15.4 14.35 21.5 14.35 21.5 12.35"/>
        </svg>
      </div>
    </div>
    <div class="sider">
      <!-- <transition-group name='fade' tag='div'>
        <div v-for="image in getAllImages" 
        class="sider--entry"
        :key="image.index" 
        :class="{active: image.index == getCurrentImage.index}"
        @click=setImageIndex(image.index)
        >
          {{image.holder}}
          </div>
      </transition-group> -->
      </div> 
  </div>
</template>

<script>
import Logo from '@/components/TheLogo.vue'
import { imageData } from '@/imageData.js'

export default {
  name: 'home',
  components: {
    Logo
  },
  data() {
    return {
      index: 0,
      imageData
    }
  },
  mounted() {
    // console.log('here', imageData)
  }
  // computed: {
  //   ...mapGetters(['getCurrentImage', 'getAllImages', 'getImageIndex'])
  // },
  // methods: {
  //   move(dir) {
  //     if (dir == 1) {e
  //       this.$store.commit('moveIndex', 1)
  //     } else if(dir ==0) {
  //       this.$store.commit('moveIndex', 0)
  //     }
  //   },
  //   setImageIndex(index){
  //     this.$store.commit('setImageIndex', index)
  //   }
  // }
}
</script>

<style lang="scss">
@import '@/assets/css/animations.scss';

.home {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-antonio);
  letter-spacing: 1px;
  z-index: 2;
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
    }

    &--desc {
      font-family: var(--font-antonio);
      margin-top: 1rem;

       @media (max-width: 37.5em) {
        font-size: 1rem;
        margin-bottom: .3rem;
      }
    }
  }

  figure {
    & .img-wrap  {
      display: block;
      height: auto;
    }

    & .full-image {
        display: block;
        max-width: 90%;
        margin:  0 auto;
        max-height: calc(100vh - 15rem);
        height: auto;
        line-height: 0;
        border-radius: 5px;
        box-shadow: 0px 3px 15px rgba(0,0,0,0.2);
    } 

  }

  
}
.sider {
    position: fixed;
    top: 0;
    right: 0;
    margin-right: 1rem;
    margin-top: 1rem;
    text-align: left;

    @media (max-width: 37.5em) {
      position: static;
      display: flex;
      justify-content: space-between;
      text-align: center;
    }

    &--entry {
      display: block;
      cursor: pointer;
      transition: all .4s ease;

      @media (max-width: 37.5em) {
        font-size: .9rem;
        margin: 0 .2rem;
        margin-bottom: 1rem;
        border: 1px solid var(--cream);
        padding: .2rem .3rem;
      }

      &:hover {
        filter: opacity(50%);
      }
    }
  }

.control {
  cursor: pointer;
  width: 30px;
  transition: all .4s ease;
  margin: 0 1rem;

  @media (max-width: 37.5em) {
      min-width: 30px;
    }

  &:hover {
    filter: opacity(50%);
  }
}

.active {
  color: var(--blue);

  @media (max-width: 37.5em) {
    border: 1px solid var(--blue);
    
  }
  
}

.fade-enter-active, .fade-leave-active {
  transition: all 0.8s ease;
  overflow: hidden;
  visibility: visible;
  opacity: 1;
  position: relative;
  top: 0;
  left: 0;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
  visibility: hidden;
}

</style>
