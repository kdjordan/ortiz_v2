#!/usr/bin/env bash
# Seed the LOCAL Phase-A CMS stack (see docker-compose.yml). Idempotent: rebuilds
# the bare remote and regenerates the throwaway secrets from scratch each run.
#
# Creates (all under .cms-local/, which is gitignored):
#   .cms-local/remote.git  — a bare git repo seeded on `main` from the current repo
#                            content (src/gallery.json + source-images + the
#                            optimized image variants), standing in for the GitHub
#                            remote the CMS clones and pushes drafts to.
#   .cms-local/api.env      — ADMIN_PASSWORD_HASH (scrypt) + COOKIE_SECRET for the
#                            api service. Throwaway, local-only, NOT production.
set -euo pipefail

# Local-only admin password. Printed below; used by the smoke to POST /api/login.
PASS="admin-local-smoke"

cd "$(dirname "$0")/.."
ROOT="$PWD"
LOCAL="$ROOT/.cms-local"
BARE="$LOCAL/remote.git"

echo "==> Reseeding $LOCAL"
rm -rf "$LOCAL"
mkdir -p "$LOCAL"

# Build the seed working tree from the current checkout, then push it into a fresh
# bare repo on `main`.
SEED="$(mktemp -d)"
trap 'rm -rf "$SEED"' EXIT

mkdir -p "$SEED/src" "$SEED/public/images"
cp "$ROOT/src/gallery.json" "$SEED/src/gallery.json"
cp -R "$ROOT/source-images" "$SEED/source-images"
cp -R "$ROOT/public/images/opt" "$SEED/public/images/opt"

git init -q -b main "$SEED"
git -C "$SEED" -c user.email=seed@local -c user.name=Seed add .
git -C "$SEED" -c user.email=seed@local -c user.name=Seed commit -q -m "seed gallery"

git init -q --bare -b main "$BARE"
git -C "$SEED" push -q "$BARE" main

# Throwaway secrets, generated with the exact one-liners from server/.env.example.
HASH="$(node -e "const c=require('crypto');const s=c.randomBytes(16);console.log(s.toString('hex')+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" "$PASS")"
SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

cat > "$LOCAL/api.env" <<EOF
# LOCAL Phase-A smoke secrets — gitignored, throwaway. NOT production values.
# Admin login password (plaintext, local only): $PASS
ADMIN_PASSWORD_HASH=$HASH
COOKIE_SECRET=$SECRET
EOF

echo "==> Seeded bare remote: $BARE"
echo "    main: $(git -C "$BARE" rev-parse --short main)  files: $(git -C "$BARE" ls-tree -r --name-only main | wc -l | tr -d ' ')"
echo "==> Wrote secrets: $LOCAL/api.env"
echo "    admin password: $PASS"
echo
echo "Next:  docker compose up --build   then smoke http://localhost:8080"
