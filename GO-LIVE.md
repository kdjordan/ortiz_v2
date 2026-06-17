# Admin CMS — Go-Live Runbook (Slice #11, Phase B)

Production cutover for the Admin CMS. **Phase A (local deploy) is already proven.** This is the
HITL prod work: deploy key, secrets, the Coolify compose app, the go-live merge, and the smoke.

**Deployment shape:** a single Coolify *Docker Compose* app (`docker-compose.prod.yml`) tracking
`main`, running `api` + `site` on one network so nginx's `/api` → `api:3001` proxy resolves.
Everything is on the apex `ortizmetals.com` (reverse-proxy on apex — **no `api.` subdomain, no
second cert, no CORS, no parent-domain cookie**).

> Downtime tolerance is high (occasionally-viewed portfolio). A brief cutover is fine. `/` and
> `/about` are unaffected throughout; only `/admin` (unlinked, private) has a short window.

---

## 0. Prerequisites
- Coolify access on the Hetzner box (`178.156.251.139`), domain `ortizmetals.com` already → Coolify.
- `gh`/git authed as `kdjordan`; you on the repo.
- Decide the **admin password** (you'll hash it, never commit it).

## 1. SSH deploy key (write, single-repo)
```sh
ssh-keygen -t ed25519 -C "ortiz-cms-deploy" -f ./ortiz-cms-deploy -N ""
```
- Add **`ortiz-cms-deploy.pub`** to GitHub → repo **Settings → Deploy keys → Add** → **Allow write access** ✅.
- Keep **`ortiz-cms-deploy`** (private) for step 3 — it becomes the `DEPLOY_KEY` secret. **Never commit it.**
- Delete both local files after Coolify has the private key.

## 2. App secrets
```sh
# Admin password hash (scrypt "saltHex:keyHex") — replace the password:
node -e "const c=require('crypto');const s=c.randomBytes(16);console.log(s.toString('hex')+':'+c.scryptSync('YOUR-REAL-PASSWORD',s,64).toString('hex'))"
# Cookie signing secret:
openssl rand -hex 32
```
Hold both for step 4. They are **only** ever Coolify secrets.

## 3. Pre-merge local re-smoke (confirm the Phase-B entrypoint didn't regress local)
The `server/Dockerfile` now has an entrypoint that's a no-op without `DEPLOY_KEY`. Re-prove the
local stack before touching prod:
```sh
./scripts/seed-cms-repo.sh
docker compose up --build -d          # uses docker-compose.yml (local, file://)
# login -> upload -> publish smoke at http://localhost:8080 (see LOCAL-SMOKE.md)
docker compose down && rm -rf .cms-local
```
Expect the same green smoke as Phase A (login 200 + cookie, upload 201 + 6 variants, publish → main 9 works).

## 4. Merge to `main` (go-live commit)
```sh
git checkout main && git pull
git merge --no-ff feature/admin-cms
git push origin main
```
The existing static Coolify app will auto-redeploy to the new static site (with `/admin` + the
`/api` proxy). `/` and `/about` stay up; `/admin` login `502`s on `/api` only until step 5 — fine
(it's unlinked).

## 5. Coolify: the compose app
In Coolify:
1. **New Resource → Docker Compose** (or reconfigure the existing app to Compose), repo
   `kdjordan/ortiz_v2`, branch **`main`**, compose file **`docker-compose.prod.yml`**.
2. **Environment / Secrets** — set, marked secret:
   - `ADMIN_PASSWORD_HASH` = step 2 hash
   - `COOKIE_SECRET` = step 2 secret
   - `DEPLOY_KEY` = full contents of the private `ortiz-cms-deploy` (multi-line)
3. **Domain** → `ortizmetals.com` mapped to the **`site`** service (port 80), TLS on (Let's Encrypt).
4. Deploy. Watch the `api` build log for the sharp self-check line
   (`sharp … | libvips … | HEIF decode: true`) and a successful initial clone of `main` over SSH.
5. Decommission the old static-only app once the domain is on the compose app.

## 6. Production smoke (the deferred checks live here)
At `https://ortizmetals.com`:
- `/` and `/about` render, images sharp, SEO intact (don't regress the 97/98/100/100 Lighthouse).
- `/admin` → login with the real password → works list (8) loads (proves `/api` proxy + cookie over https).
- **Upload a real iPhone HEIC** → expect a processed work + 6 variants (the HEIF decode we couldn't fixture locally).
- **Cropper rehydration** (deferred from #9): open a work, set tilt+crop+brightness, save; reopen →
  controls show the stored values; save-without-change leaves the image unchanged.
- Edit a caption → **Publish** → within ~1–2 min the public gallery reflects it (proves push-to-main → Coolify rebuild).
- **Discard** a draft change → reverts.
- **Collage check:** delete a work → confirm the home collage still lays out acceptably (the CSS is
  tuned for ~8 tiles; decide if it needs to be made count-resilient).

## 7. Rollback
- **Bad publish (content):** `git revert` the CMS commit on `main` (or reset `main` to the prior
  commit) and push — Coolify redeploys the prior site.
- **Bad app deploy:** redeploy the previous successful deployment in Coolify, or re-point the domain
  back to the old static app (kept until step 5 confirms green).
- **Key compromise:** remove the deploy key in GitHub + rotate `DEPLOY_KEY`; rotate `COOKIE_SECRET`
  (invalidates sessions) and `ADMIN_PASSWORD_HASH`.

## Security notes
- Deploy-key blast radius: write to **this repo only**; held only by the API container; never logged
  or committed. A password compromise lets an attacker manage the gallery + publish — **not** push
  arbitrary code.
- Pinned GitHub host key in the entrypoint → no TOFU/MITM; if GitHub rotates its key, deploys fail
  loudly (update `server/docker-entrypoint.sh`).
- Session cookie is httpOnly/Secure/SameSite=Lax, host-only on the apex. (Optional hardening: add a
  `maxAge` — currently a browser-session cookie with no server-side expiry.)
