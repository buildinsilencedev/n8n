# Local Windows n8n profile

This profile runs the checked-out `n8n` repo inside Docker Desktop, persists your app state in Docker volumes, and adds helpers for:

- daily launch without opening a terminal
- enabling instance MCP access in the database
- setting your default instance AI model to OpenRouter + `x-ai/grok-4.1-fast`
- exposing the Claude mobile connector surface through Cloudflare Tunnel

## What this setup does

- Builds `n8n` from the local repo inside Docker, so you are using this branch's MCP builder implementation.
- Runs `n8n` with PostgreSQL for easier automation and maintenance.
- Persists database state in `postgres_data` and app state in `n8n_data`.
- Leaves your local editor at [http://localhost:5678](http://localhost:5678).
- Supports an optional `cloudflared` sidecar for Claude mobile.

## First-time setup

1. Install Docker Desktop for Windows.
2. From the repo root, run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-local-n8n.ps1
```

3. Open `http://localhost:5678` and complete the owner account setup.
4. Create an `OpenRouter` credential in n8n with your API key.
5. Set the default instance AI preference to OpenRouter + Grok 4.1 Fast:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\set-local-n8n-instance-ai-preferences.ps1 -CredentialName OpenRouter
```

## Daily use

- Double-click the desktop shortcut created by `setup-local-n8n.ps1`, or run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-local-n8n.ps1
```

- To stop the stack:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\stop-local-n8n.ps1
```

## MCP and Claude

`scripts\enable-local-n8n-mcp.ps1` is run automatically by the start/setup scripts. It writes `mcp.access.enabled=true` into the n8n settings table.

To make an existing workflow visible to Claude over MCP:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\set-local-n8n-workflow-mcp-access.ps1 -WorkflowId <workflow-id> -Enabled $true
```

New workflows created through the MCP builder already default to `availableInMCP=true`.

## Cloudflare Tunnel for Claude mobile

Claude mobile can only use remote MCP connectors, so you need a public HTTPS endpoint.

1. Copy `local\windows\cloudflared\config.example.yml` to `local\windows\cloudflared\config.yml`.
2. Put your Cloudflare tunnel credentials JSON in `local\windows\cloudflared\`.
3. Change `INSTANCE_BASE_URL` in `local\windows\.env` to your public MCP hostname, for example:

```dotenv
INSTANCE_BASE_URL=https://n8n-mcp.example.com
```

4. Start the public profile:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-local-n8n.ps1 -WithTunnel
```

5. Add the connector in `claude.ai` using the public MCP URL:

```text
https://n8n-mcp.example.com/mcp-server/http
```

## Important note about the public surface

The tunnel example intentionally exposes more than just `/mcp-server/http`. n8n's MCP OAuth flow also uses:

- `/.well-known/*`
- `/mcp-oauth/*`
- `/oauth/consent`
- `/signin`
- `/rest/*`
- frontend assets required by the consent/login views

If you try to expose only `/mcp-server/http`, Claude mobile authorization will fail.

When you switch `INSTANCE_BASE_URL` to the public hostname, n8n will advertise that hostname for MCP and OAuth metadata. Your editor can still be opened locally at `http://localhost:5678`, but the public hostname must remain locked down to the MCP, OAuth, signin, REST, and asset routes listed above.
