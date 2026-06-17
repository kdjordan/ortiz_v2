# Admin CMS API (Fastify, server.js on :3001).
# glibc base (bookworm-slim), NOT alpine/musl: sharp's prebuilt @img/sharp-linux-*
# binary + its bundled libvips (incl. HEIF/HEIC decode) load reliably on glibc; the
# musl build is a separate artifact with flakier HEIF support.
FROM node:22-bookworm-slim

# git      — simple-git shells out to the git binary for clone/commit/push; without
#            it every CMS git op fails.
# ca-certificates — TLS roots for https/ssh remotes.
# openssh-client  — only used in Phase B, when the prod remote is an SSH URL pushed
#            with a deploy key. A local file:// remote does NOT need it; it's
#            installed here (~1MB) so the prod image needs no Dockerfile change.
# libheif-examples (heif-convert) + libde265-0 — HEVC decoder for iPhone HEIC. The
#            @img/sharp prebuilt bundles libheif but NOT the HEVC decoder (libde265,
#            omitted for patent reasons), so it reads the HEIF container header but
#            cannot decode HEVC pixels. images.js shells out to heif-convert for
#            HEIC inputs. libde265-0 is listed explicitly so --no-install-recommends
#            cannot drop it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git ca-certificates openssh-client libheif-examples libde265-0 \
  && rm -rf /var/lib/apt/lists/*

# simple-git invokes git inside the bind-mounted bare remote (file://). Git's
# dubious-ownership guard rejects a repo whose owner uid differs from the process
# uid; this controlled single-purpose image opts every repo out of that check.
RUN git config --system --add safe.directory '*'

WORKDIR /app

COPY package*.json ./
# sharp ships its native binding as a prebuilt @img/sharp-linux-* optionalDependency
# (no node-gyp build), so no install script needs to run — --ignore-scripts is safe
# and the linux-arm64/x64 binaries resolve straight from the committed lockfile.
# --omit=dev drops vitest (test-only) from the runtime image.
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# Fail the build if sharp's native binding can't load; report whether this libvips
# build can DECODE HEIF/HEIC (a noted limitation if absent — does not fail the build).
RUN node -e "const s=require('sharp'); const heif=!!s.format.heif?.input?.buffer; console.log('sharp', s.versions.sharp, '| libvips', s.versions.vips, '| HEIF decode:', heif); if(!heif){console.warn('WARN: HEIF/HEIC decode NOT available in this sharp build')}"

ENV NODE_ENV=production
# Bind on all interfaces so the sibling nginx container can reach the API
# (server.js defaults to 127.0.0.1, which would be unreachable cross-container).
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# Unauthenticated /api/works returns 401 once the server is listening (onReady has
# cloned the remote), so a 401 means healthy; anything else (incl. connection
# refused) is unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/works').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
