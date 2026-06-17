// Routes are consumed by ViteSSG (see main.js), which creates the router and
// prerenders each path to static HTML at build time.
export const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('../views/AboutView.vue'),
  },
  {
    // Admin CMS. Lazy-loaded and client-only — excluded from SSG prerender via
    // ssgOptions.includedRoutes in vite.config.js, and kept out of the sitemap.
    path: '/admin',
    name: 'admin',
    component: () => import('../views/AdminView.vue'),
  },
]
