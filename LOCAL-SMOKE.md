# Phase-A local full-stack smoke

Run the Admin CMS end-to-end on your machine — static site + Fastify API + a local
bare git repo standing in for the GitHub remote — with the **same routing as prod**:
the site reverse-proxies `/api` to the API, so everything is one same-origin host.

This is **local only**. No production, no real secrets, no GitHub, no Coolify.

## Prerequisites

- Docker + Docker Compose
- Node (only for the seed script's scrypt/secret one-liners)

## 1. Seed

```sh
./scripts/seed-cms-repo.sh
```

Creates (all gitignored, under `.cms-local/`):

- `remote.git` — a bare repo seeded on `main` from the current checkout
  (`src/gallery.json`, `source-images/`, `public/images/opt/`). The CMS clones this
  and pushes drafts to `cms-draft`.
- `api.env` — throwaway `ADMIN_PASSWORD_HASH` + `COOKIE_SECRET`. The admin password
  is printed by the script (`admin-local-smoke`).

## 2. Up

```sh
docker compose up --build
```

- Site: <http://localhost:8080>  (try `/`, `/about`, `/admin`)
- API (via the proxy): `http://localhost:8080/api/...`

## 3. Smoke (curl)

`localhost` is a secure context, so a browser accepts the `Secure` session cookie
over http. **curl won't replay a `Secure` cookie over http from its jar**, so grab
the cookie from the login response and pass it back explicitly:

```sh
# login -> capture the signed session cookie
COOKIE=$(curl -si -X POST http://localhost:8080/api/login \
  -H 'content-type: application/json' \
  -d '{"password":"admin-local-smoke"}' \
  | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: \(session=[^;]*\).*/\1/p')

# list works (expect 200)
curl -s -b "$COOKIE" http://localhost:8080/api/works

# upload (expect 201)
curl -s -b "$COOKIE" -F file=@source-images/firepit.png \
  -F holder=Test -F desc='smoke upload' -F year=2026 \
  http://localhost:8080/api/works

# draft status / publish / discard all go through the same proxy
curl -s -b "$COOKIE" http://localhost:8080/api/draft/status
curl -s -b "$COOKIE" -X POST http://localhost:8080/api/publish
```

Inspect what the backend actually committed to the bare remote from the host:

```sh
git -C .cms-local/remote.git ls-tree -r cms-draft        # draft contents
git -C .cms-local/remote.git show main:src/gallery.json  # what publish promoted
```

## 4. Teardown

```sh
docker compose down
rm -rf .cms-local
```
