# Ortiz Metals

Vue 3/Vite portfolio site for Randy Ortiz / Ortiz Metals.

## Local development

```sh
npm install
npm run dev
```

## Production build

```sh
npm run build
```

The static production output is written to `dist/`.

## Hetzner / Coolify deployment

This repo includes a multi-stage `Dockerfile` for container deployment:

```sh
docker build -t ortiz-metals .
docker run --rm -p 8080:80 ortiz-metals
```

Runtime path:

1. `node:20-alpine` installs locked dependencies with `npm ci --ignore-scripts`.
2. Vite builds the static site into `dist/`.
3. `nginx:1.27-alpine` serves the compiled files.
4. `nginx.conf` includes an SPA fallback so `/about` works on direct loads.

In Coolify, point the app at this repository and use Dockerfile build mode. The container listens on port `80`.
