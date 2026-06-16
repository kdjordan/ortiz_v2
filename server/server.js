import { buildApp } from './app.js'

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '127.0.0.1'

const app = buildApp()

app
  .listen({ port, host })
  .then((address) => {
    app.log?.info?.(`admin server listening on ${address}`)
    // eslint-disable-next-line no-console
    console.log(`admin server listening on ${address}`)
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
