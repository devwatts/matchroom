#!/usr/bin/env bash
# Deploy n8n, the app and Caddy to the VM. Usage: infra/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VM="${VM:-devwatts@172.191.124.27}"
set -a; . ./.env; set +a
umask 077; TMP=$(mktemp)
for k in N8N_HOST N8N_ENCRYPTION_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY OPENROUTER_API_KEY APIFY_TOKEN WEBHOOK_SHARED_SECRET APP_PASSWORD SESSION_SECRET N8N_ONBOARDING_WORKFLOW_ID N8N_DAILY_WORKFLOW_ID; do
  printf '%s=%s\n' "$k" "${!k}" >> "$TMP"; done
printf 'APP_HOST=%s\n' "${APP_HOST:-match.devwatts.tech}" >> "$TMP"
ssh "$VM" 'mkdir -p ~/match-n8n/web && chmod 700 ~/match-n8n'
scp -q infra/n8n/docker-compose.yml infra/n8n/Caddyfile "$VM":~/match-n8n/
scp -q "$TMP" "$VM":~/match-n8n/.env && rm -f "$TMP"
rsync -az --delete --exclude node_modules --exclude .next --exclude '.env*' web/ "$VM":~/match-n8n/web/
ssh "$VM" 'chmod 600 ~/match-n8n/.env && cd ~/match-n8n && sudo -n docker compose up -d --build 2>&1 | tail -5'
