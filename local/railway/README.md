# Railway deployment for custom n8n + Claude MCP

This setup deploys the checked-out custom `n8n` branch to Railway as one always-on web service with Railway Postgres and one persistent volume.

## What gets deployed

- One Railway service built from `Dockerfile.railway`
- One Railway Postgres service
- One Railway volume mounted at `/home/node/.n8n`
- One canonical public hostname: `https://n8n.active-agents.net`

## Files added for Railway

- `Dockerfile.railway`: source build plus runtime image packaging
- `Dockerfile.railway.dockerignore`: Railway-specific Docker context filter
- `railway.toml`: build/deploy config with Dockerfile path and healthcheck
- `scripts/n8n-postgres-admin.mjs`: Postgres helper for instance AI defaults, MCP settings, and workflow MCP visibility

## GitHub and Railway setup

1. Push this repo state to your own GitHub fork on a branch such as `railway-prod`.
2. In Railway, create a new project from that GitHub repo.
3. Add a PostgreSQL service to the same Railway project.
4. Add one volume to the `n8n-app` service mounted at `/home/node/.n8n`.
5. Make sure the service is using `Dockerfile.railway`.
   - `railway.toml` already points Railway at the file.
   - If Railway still uses another build path, set `RAILWAY_DOCKERFILE_PATH=Dockerfile.railway`.

## Required Railway variables

Use `local/railway/.env.example` as the source of truth. The key values are:

- `N8N_HOST=0.0.0.0`
- `N8N_PORT=${{PORT}}`
- `N8N_PROTOCOL=https`
- `N8N_EDITOR_BASE_URL=https://n8n.active-agents.net`
- `WEBHOOK_URL=https://n8n.active-agents.net/`
- `N8N_MCP_BUILDER_ENABLED=true`
- `N8N_SECURE_COOKIE=true`
- `DB_TYPE=postgresdb`
- `DB_POSTGRESDB_*` mapped from the Railway Postgres service

## Domain and Cloudflare

1. Add `n8n.active-agents.net` as a Railway custom domain.
2. In Cloudflare DNS, keep the record proxied.
3. Set Cloudflare SSL mode to `Full`.
4. Do not rely on a public `*.up.railway.app` hostname for Claude.

Because this deployment uses one canonical hostname, do not put the full site behind Cloudflare Access or Claude MCP OAuth will fail. Keep access controlled with n8n login, Cloudflare proxying, and Cloudflare WAF/bot protections instead.

## First boot

1. Open `https://n8n.active-agents.net`.
2. Complete owner setup.
3. Create an `OpenRouter` credential named `OpenRouter`.
4. Enable instance MCP access in the UI if it is not already enabled.

## Production helper commands

Run these as one-off commands in Railway, or in any shell where the same `DB_POSTGRESDB_*` variables are present.

Set instance MCP access:

```bash
n8n-postgres-admin --command set-setting --key mcp.access.enabled --value true
```

Set default AI model to OpenRouter + Grok 4.1 Fast:

```bash
n8n-postgres-admin --command set-instance-ai-defaults --credential-name OpenRouter --model-name x-ai/grok-4.1-fast
```

Expose a workflow to Claude MCP:

```bash
n8n-postgres-admin --command set-workflow-mcp-access --workflow-id <workflow-id> --enabled true
```

## Claude MCP connector

Use this URL in `claude.ai`:

```text
https://n8n.active-agents.net/mcp-server/http
```

After the service is healthy, verify these URLs resolve on the public domain:

- `https://n8n.active-agents.net/healthz/readiness`
- `https://n8n.active-agents.net/.well-known/oauth-authorization-server`
- `https://n8n.active-agents.net/.well-known/oauth-protected-resource/mcp-server/http`
