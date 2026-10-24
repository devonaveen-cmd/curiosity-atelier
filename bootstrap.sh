#!/usr/bin/env bash
# One command: creates the GitHub repo, stores your API key as a secret, enables Pages, pushes, and runs the first build.
# Usage:  GEMINI_API_KEY=xxxx ./bootstrap.sh [repo-name]
set -euo pipefail
REPO="${1:-curiosity-atelier}"
command -v gh  >/dev/null || { echo "Install GitHub CLI first:  sudo dnf install gh   (Fedora)  /  sudo apt install gh  (Debian/Ubuntu)"; exit 1; }
command -v git >/dev/null || { echo "Install git first."; exit 1; }
gh auth status >/dev/null 2>&1 || gh auth login
if [ -z "${GEMINI_API_KEY:-}" ]; then read -rsp "Paste your Gemini API key (https://aistudio.google.com/apikey): " GEMINI_API_KEY; echo; fi

[ -d fonts ] || node fetch-fonts.mjs      # fonts are bundled in the zip; this only runs if they are missing
[ -d .git ] || git init -b main
git add -A && git commit -qm "Curiosity Atelier" || true
gh repo create "$REPO" --public --source=. --remote=origin           # public repos get free Pages
OWNER="$(gh api user -q .login)"
printf %s "$GEMINI_API_KEY" | gh secret set GEMINI_API_KEY --repo "$OWNER/$REPO"
# Optional: AI images (Cloudflare Workers AI free tier). Skip with Enter; the app then uses its generated art.
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -t 0 ]; then read -rp "Cloudflare account ID (Enter to skip images): " CLOUDFLARE_ACCOUNT_ID; fi
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then read -rsp "Cloudflare API token (Workers AI permission): " CLOUDFLARE_API_TOKEN; echo; fi
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  printf %s "$CLOUDFLARE_ACCOUNT_ID" | gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$OWNER/$REPO"
  printf %s "$CLOUDFLARE_API_TOKEN"  | gh secret set CLOUDFLARE_API_TOKEN  --repo "$OWNER/$REPO"
fi
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
git push -u origin main
sleep 5
gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
gh workflow run site.yml --repo "$OWNER/$REPO" -f force=true || true
echo
echo "Done. Watch the build:  gh run watch --repo $OWNER/$REPO"
echo "Your app will be live at: https://$OWNER.github.io/$REPO/  (allow a few minutes for the first edition + deploy)"
