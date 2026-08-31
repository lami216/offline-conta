#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci
rm -rf .next-candidate
NEXT_DIST_DIR=.next-candidate npm run build
rm -rf .next-previous
if [[ -d .next ]]; then mv .next .next-previous; fi
mv .next-candidate .next
if ! pm2 reload ecosystem.config.cjs --update-env; then
  rm -rf .next
  [[ ! -d .next-previous ]] || mv .next-previous .next
  pm2 reload ecosystem.config.cjs --update-env || true
  exit 1
fi
curl --fail --silent --show-error --retry 10 --retry-delay 2 http://127.0.0.1:3000/api/health >/dev/null
rm -rf .next-previous
pm2 save
echo "Conta deployed successfully"
