import './assets/main.css'

import { ViteSSG } from 'vite-ssg'
import App from './App.vue'
import { routes } from './router'

// ViteSSG creates the app + router (history mode) and prerenders each route
// to static HTML at build time, hydrating on the client.
export const createApp = ViteSSG(App, { routes })
