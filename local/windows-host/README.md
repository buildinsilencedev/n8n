# Local Windows n8n profile (no Docker)

This profile runs the checked-out `n8n` repo directly on Windows with Node.js and SQLite, which is the right fallback when Docker cannot use virtualization on a Shadow PC.

## What this setup does

- Installs workspace dependencies with a Windows-safe wrapper for `pnpm`
- Builds the local repo for host execution
- Stores n8n data in `local\windows-host\data`
- Runs n8n on `http://localhost:5678`
- Keeps MCP builder enabled and supports OpenRouter defaults
- Creates a desktop shortcut for daily launch

## First-time setup

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-local-n8n-host.ps1
```

Then:

1. Complete owner setup in the browser.
2. Create an `OpenRouter` credential named `OpenRouter`.
3. Run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\set-local-n8n-instance-ai-preferences-host.ps1 -CredentialName OpenRouter
```

## Daily use

- Double-click the `n8n Local.lnk` shortcut on your desktop, or run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-local-n8n-host.ps1
```

- To stop n8n:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\stop-local-n8n-host.ps1
```

## MCP and Claude

The startup flow automatically writes `mcp.access.enabled=true` into the local SQLite database.

To make an existing workflow visible to Claude over MCP:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\set-local-n8n-workflow-mcp-access-host.ps1 -WorkflowId <workflow-id> -Enabled $true
```

## Cloudflare Tunnel for Claude mobile

1. Install `cloudflared` for Windows and authenticate it with your Cloudflare account.
2. Run `cloudflared tunnel login` and then create a named tunnel plus a DNS route on a hostname you control.
3. Generate the local tunnel config and update the public n8n URLs in one step:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\configure-local-n8n-cloudflared-host.ps1 -TunnelId <tunnel-uuid> -Hostname n8n-mcp.example.com
```

4. Start the tunnel in the background:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-local-n8n-cloudflared-host.ps1
```

5. Add the connector in `claude.ai` with:

```text
https://n8n-mcp.example.com/mcp-server/http
```

Like the Docker profile, the public hostname must expose the OAuth and signin routes n8n uses for MCP authorization, not just `/mcp-server/http`.
