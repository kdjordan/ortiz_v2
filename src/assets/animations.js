import { gsap } from 'gsap'


export default function animatePage(pageTransition) {
  gsap.to(pageTransition, {
    top:0,
    opacity: 1,
    duration: 0.5,
    onComplete: () => {
      window.scrollTo(0, 0); // Scroll to the top of the page
      gsap.to(pageTransition, {
        top: '100vh',
        opacity: 1,
        duration: 0.5,
      });
    },
  });
}