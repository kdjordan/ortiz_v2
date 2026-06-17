#!/bin/sh
# API container entrypoint.
#
# Phase A (local smoke) uses a file:// GIT_REMOTE_URL and sets no DEPLOY_KEY, so
# this is a pure no-op there and `exec node server.js` runs unchanged.
#
# Phase B (prod) sets GIT_REMOTE_URL to the GitHub SSH URL and provides the repo's
# write-scoped deploy private key. Prefer DEPLOY_KEY_B64 (the key base64-encoded) —
# it survives secret/env fields that strip the newlines a PEM key needs; fall back to
# a raw multi-line DEPLOY_KEY. We materialise it with strict perms, pin GitHub's host
# key (no TOFU/MITM), and force strict host verification for every git push/clone.
set -e

if [ -n "$DEPLOY_KEY_B64" ] || [ -n "$DEPLOY_KEY" ]; then
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh

  if [ -n "$DEPLOY_KEY_B64" ]; then
    printf '%s' "$DEPLOY_KEY_B64" | tr -d '[:space:]' | base64 -d > /root/.ssh/id_ed25519
  else
    printf '%s\n' "$DEPLOY_KEY" > /root/.ssh/id_ed25519
  fi
  chmod 600 /root/.ssh/id_ed25519

  # Pinned GitHub SSH host key (Ed25519). If GitHub rotates this, deploys fail
  # loudly — which is the correct, safe failure mode. Verify/update from
  # https://docs.github.com/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
  cat > /root/.ssh/known_hosts <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
EOF
  chmod 644 /root/.ssh/known_hosts

  # Make git's SSH strict + non-interactive (verify against the pinned known_hosts).
  export GIT_SSH_COMMAND="ssh -i /root/.ssh/id_ed25519 -o UserKnownHostsFile=/root/.ssh/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes"
fi

exec "$@"
