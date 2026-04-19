# mail-cal-drive-mcp

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue.svg)](https://docs.docker.com/compose/)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-purple.svg)](https://modelcontextprotocol.io)
[![SafeSkill 88/100](https://img.shields.io/badge/SafeSkill-88%2F100_Passes%20with%20Notes-yellow)](https://safeskill.dev/scan/rumbitopi-mail-cal-drive-mcp)

A self-hosted [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for multi-account email, calendar, and cloud storage. Connect Microsoft 365, Google Workspace, and IMAP accounts to any MCP client — Claude Desktop, Claude Code, VS Code, Cursor, and more.

Runs locally in Docker with Postgres. Credentials encrypted at rest. Survives reboots without re-authorization.

| Provider | Email | Calendar | Drive |
|----------|-------|----------|-------|
| Microsoft 365 | ✅ | ✅ | ✅ OneDrive |
| Google Workspace | ✅ | ✅ | ✅ Google Drive |
| IMAP | ✅ | ❌ | ❌ |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js 20+](https://nodejs.org) (for local development only)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/rumbitopi/mail-cal-drive-mcp.git
cd mail-cal-drive-mcp

# 2. Configure
cp .env.example .env

# 3. Generate keys (run 3 times — one for each)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste into .env as POSTGRES_PASSWORD, CREDENTIAL_ENCRYPTION_KEY, and API_KEY
# Update DATABASE_URL to use the same POSTGRES_PASSWORD

# 4. Start (server runs with zero providers — configure them later)
docker compose up --build -d

# 5. Verify health
curl http://localhost:3100/health

# 6. Verify MCP
curl -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'
```

## Architecture

```
┌──────────────────────────────────────────────┐
│  Docker Compose                              │
│  ┌─────────────┐    ┌──────────────┐         │
│  │ workspace   │◄──►│ postgres:5432│         │
│  │ -mcp :3100  │    │ (persistent) │         │
│  │ Streamable  │    └──────────────┘         │
│  │ HTTP + Auth │                             │
│  └─────────────┘                             │
└──────────────────────────────────────────────┘
```

**Protocol:** MCP over Streamable HTTP (`2024-11-05`), MCP SDK 1.25.3

**What persists across reboots (in Postgres):**
- Credentials (AES-256-GCM encrypted)
- MSAL token cache (silent Microsoft refresh — no re-auth)
- Pending auth flows (survive restarts mid-auth)

**What's ephemeral (in memory):**
- MCP sessions (clients auto-reconnect)

---

## Client Configuration

### Claude Desktop

Claude Desktop speaks stdio, not HTTP. [supergateway](https://github.com/nicholasgriffintn/supergateway) bridges the two.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "workspace": {
      "command": "npx",
      "args": [
        "-y", "supergateway",
        "--streamableHttp", "http://localhost:3100/mcp",
        "--header", "Authorization: Bearer YOUR_API_KEY"
      ]
    }
  }
}
```

### Claude Code

Add to `.claude/settings.local.json` in your project:

```json
{
  "mcpServers": {
    "workspace": {
      "type": "streamable-http",
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/settings.json`:

```json
{
  "github.copilot.chat.mcpServers": {
    "workspace": {
      "type": "streamable-http",
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "workspace": {
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

---

## Provider Setup

### Microsoft 365

Uses **device code flow** — no redirect URI needed.

#### Azure App Registration

1. Go to [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name: `Workspace MCP` (or anything)
3. Supported account types: **"Accounts in any organizational directory and personal Microsoft accounts"**
4. Redirect URI: **Leave blank**
5. Click **Register**

#### Enable Public Client Flow

1. Go to your app → **Authentication**
2. Under **Advanced settings**, set **"Allow public client flows"** to **Yes**
3. Click **Save**

#### Add API Permissions

1. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**
2. Add:
   - `Mail.ReadWrite`, `Mail.Send`
   - `Calendars.ReadWrite`, `Calendars.Read.Shared`
   - `Files.ReadWrite`, `Files.ReadWrite.All`
   - `User.Read`, `offline_access`
3. Click **"Grant admin consent"** if you're an admin

#### Configure .env

```
MS_ENABLED=true
MS_CLIENT_ID=<Application (client) ID from Overview page>
MS_TENANT_ID=<Directory (tenant) ID, or "common" for multi-tenant>
```

#### Connect

Call `auth_start` with `provider: "microsoft"`. You'll get a URL and code. Visit the URL, enter the code, sign in. Then call `auth_complete`. **One-time setup** — refresh tokens persist across reboots.

---

### Google Workspace

Uses **OAuth callback flow** — requires a redirect URI.

#### Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create or select a project
2. **Enable APIs**: Gmail API, Google Calendar API, Google Drive API
3. **OAuth consent screen**:
   - User Type: External (or Internal for Workspace)
   - Add scopes: `gmail.modify`, `gmail.labels`, `calendar`, `calendar.events`, `drive`, `drive.file`
   - Add yourself as a test user
4. **Credentials** → **Create OAuth client ID**:
   - Type: Web application
   - Redirect URI: `http://localhost:3100/auth/google/callback`

#### Configure .env

```
GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=<Client ID>
GOOGLE_CLIENT_SECRET=<Client Secret>
GOOGLE_REDIRECT_URI=http://localhost:3100/auth/google/callback
```

#### Connect

Call `auth_start` with `provider: "google"`. Open the URL, sign in, grant permissions. The callback saves your tokens. Then call `auth_complete`. **One-time setup.**

---

### IMAP

No external setup needed — provide credentials directly.

#### Connect

Call `auth_start` with:
```
provider: "imap"
accountName: "Personal Email"
email: "user@example.com"
imapHost: "imap.example.com"
imapPort: 993
imapUsername: "user@example.com"
imapPassword: "your-app-password"
imapTls: true
```

No `auth_complete` needed — IMAP accounts are ready immediately.

#### Common IMAP Servers

| Provider | Host | Port | Notes |
|----------|------|------|-------|
| Gmail | `imap.gmail.com` | 993 | Requires [App Password](https://myaccount.google.com/apppasswords) |
| Outlook/Hotmail | `outlook.office365.com` | 993 | Requires App Password |
| Yahoo | `imap.mail.yahoo.com` | 993 | Requires App Password |
| Fastmail | `imap.fastmail.com` | 993 | Requires App Password |

---

## MCP Tools (35 total)

### Authentication (4)

| Tool | Description |
|------|-------------|
| `auth_status` | List all accounts with connection status |
| `auth_start` | Start OAuth/device code flow or IMAP setup |
| `auth_complete` | Complete pending authentication |
| `auth_revoke` | Remove an account |

### Email (9)

| Tool | Description |
|------|-------------|
| `list_accounts` | List all configured email accounts |
| `list_folders` | Get folders/labels for an account |
| `list_messages` | Messages with pagination |
| `get_message` | Full message with body and attachments |
| `search_messages` | Search with filters (see parameters below) |
| `move_message` | Move to folder |
| `delete_message` | Trash or permanent delete |
| `mark_read` | Mark read/unread |
| `bulk_mail_action` | Batch operations with dry-run support |

### Calendar (8)

| Tool | Description |
|------|-------------|
| `list_calendars` | All calendars for an account |
| `list_events` | Events in a date range |
| `get_event` | Full event details |
| `create_event` | Create with attendees, recurrence, conferencing |
| `update_event` | Modify existing event |
| `delete_event` | Delete event |
| `find_free_time` | Find available time slots across accounts |
| `check_conflicts` | Detect scheduling conflicts |

### Drive (14)

| Tool | Description |
|------|-------------|
| `list_files` | List files and folders |
| `get_file` | File metadata |
| `get_file_content` | Download file content |
| `search_files` | Search by name, content, or type |
| `upload_file` | Upload new file (text or base64) |
| `create_folder` | Create folder |
| `move_file` | Move file/folder |
| `copy_file` | Copy file |
| `rename_file` | Rename file/folder |
| `delete_file` | Delete (trash or permanent) |
| `get_sharing` | View sharing permissions |
| `share_file` | Share with user or create link |
| `unshare_file` | Remove sharing |
| `get_storage_quota` | Storage usage info |

---

## Tool Parameter Reference

### search_messages

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountIds` | string[] | Yes | Account IDs to search |
| `from` | string | No | Filter by sender email |
| `to` | string | No | Filter by recipient email |
| `subject` | string | No | Filter by subject (partial match) |
| `body` | string | No | Search in message body |
| `folder` | string | No | Limit to specific folder |
| `hasAttachment` | boolean | No | Filter by attachment presence |
| `isRead` | boolean | No | Filter by read status |
| `isStarred` | boolean | No | Filter by starred status |
| `after` | string | No | Messages after date (ISO 8601) |
| `before` | string | No | Messages before date (ISO 8601) |
| `labels` | string[] | No | Filter by labels (Gmail) |
| `limit` | number | No | Max results per account (default: 50) |

### create_event

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountId` | string | Yes | Account ID |
| `title` | string | Yes | Event title |
| `startTime` | string | Yes | Start time (ISO 8601) |
| `endTime` | string | Yes | End time (ISO 8601) |
| `calendarId` | string | No | Calendar ID (default: primary) |
| `description` | string | No | Event description |
| `location` | string | No | Event location |
| `isAllDay` | boolean | No | All-day event |
| `timeZone` | string | No | Time zone (default: UTC) |
| `attendees` | array | No | `[{email, optional?}]` |
| `visibility` | string | No | `"public"` or `"private"` |
| `addConference` | boolean | No | Add video conference link |

### bulk_mail_action

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountId` | string | Yes | Account ID |
| `action` | string | Yes | `"move"`, `"delete"`, `"markRead"`, `"markUnread"`, `"star"`, `"unstar"`, `"archive"` |
| `dryRun` | boolean | No | Preview without executing (default: false) |
| `targetFolder` | string | No | Destination folder (required for `"move"`) |
| `from` | string | No | Filter by sender |
| `subject` | string | No | Filter by subject |
| `folder` | string | No | Limit to folder |
| `isRead` | boolean | No | Filter by read status |
| `after` | string | No | After date (ISO 8601) |
| `before` | string | No | Before date (ISO 8601) |
| `limit` | number | No | Max messages to process |

### find_free_time

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountIds` | string[] | Yes | Account IDs to check |
| `startDate` | string | Yes | Start of range (ISO 8601) |
| `endDate` | string | Yes | End of range (ISO 8601) |
| `duration` | number | Yes | Required duration in minutes |
| `calendarIds` | string[] | No | Calendars to check (default: primary) |

### upload_file

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountId` | string | Yes | Account ID |
| `name` | string | Yes | File name |
| `content` | string | Yes | File content (text or base64) |
| `folderId` | string | No | Parent folder ID (default: root) |
| `mimeType` | string | No | MIME type |
| `isBase64` | boolean | No | Content is base64 encoded |

### share_file

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountId` | string | Yes | Account ID |
| `fileId` | string | Yes | File ID |
| `type` | string | Yes | `"user"`, `"group"`, or `"anyone"` |
| `role` | string | Yes | `"reader"`, `"writer"`, or `"commenter"` |
| `email` | string | No | Email (required for user/group) |
| `sendNotification` | boolean | No | Send email notification |
| `message` | string | No | Notification message |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `POSTGRES_PASSWORD` | Yes | — | Postgres password (used by Docker Compose) |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | — | 64 hex chars (32 bytes) for AES-256-GCM |
| `API_KEY` | Yes | — | Min 32 chars, used as Bearer token |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `MCP_PORT` | No | `3100` | Server port |
| `LOG_LEVEL` | No | `info` | `error`, `warn`, `info`, `debug` |
| `MS_ENABLED` | No | `false` | Enable Microsoft 365 |
| `MS_CLIENT_ID` | If MS | — | Azure App client ID |
| `MS_TENANT_ID` | If MS | `common` | Azure tenant ID |
| `GOOGLE_ENABLED` | No | `false` | Enable Google Workspace |
| `GOOGLE_CLIENT_ID` | If Google | — | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | If Google | — | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | If Google | — | OAuth callback URL |
| `IMAP_ENABLED` | No | `true` | Enable IMAP provider |

## Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check |
| `/mcp` | POST | Bearer | MCP JSON-RPC endpoint |
| `/mcp` | GET | Bearer | SSE stream for notifications |
| `/mcp` | DELETE | Bearer | Session cleanup |
| `/auth/google/callback` | GET | No | Google OAuth redirect handler |

## Security

This server is designed for **localhost use only**. Do not expose it to the internet without additional hardening.

- **Encryption at rest**: All credentials, MSAL token cache, and pending auth flows encrypted with AES-256-GCM before storage in Postgres
- **Bearer auth**: Timing-safe token comparison (`crypto.timingSafeEqual`) on all protected endpoints
- **Session limits**: Max 100 concurrent sessions, 30-minute TTL with automatic eviction
- **Network**: Binds to `127.0.0.1` only — not accessible from other machines
- **Body size**: 10MB request limit to prevent memory exhaustion
- **IMAP note**: IMAP credentials are passwords (not OAuth tokens) — encrypted at rest, but inherently less secure than OAuth. Use app passwords where possible.
- **Logging**: All logs to stderr (MCP requirement). No tokens, passwords, or keys logged.
- **Token rotation**: To rotate the encryption key, generate a new one, re-run `auth_start` for each account, and update `.env`. There is no in-place re-encryption (accounts must be re-authorized).

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Troubleshooting

**Container won't start**
- Check `docker compose logs workspace-mcp` for errors
- Verify `DATABASE_URL` matches the Postgres container credentials
- Ensure Postgres is healthy: `docker compose logs postgres`

**Microsoft device code expired**
- Device codes expire after 15 minutes. Call `auth_start` again for a fresh code.

**Google OAuth: "Access blocked" or consent screen issues**
- Make sure your Google Cloud app is in "Testing" mode with your email added as a test user
- Verify the redirect URI in Google Cloud Console matches `GOOGLE_REDIRECT_URI` exactly

**IMAP connection refused**
- Verify host, port, and TLS settings for your provider
- Most providers require an App Password when 2FA is enabled (not your regular password)
- Check if your provider blocks third-party IMAP access (Gmail: enable "Less secure apps" or use App Password)

**"Invalid or expired session" on tool calls**
- MCP sessions expire after 30 minutes of inactivity and are lost on container restart. Your client should auto-reconnect. If not, restart the client.

## Development

```bash
# Install dependencies
npm install

# Start with hot reload (requires local Postgres on DATABASE_URL)
npm run dev

# Build TypeScript
npm run build

# Production start
npm start

# Run tests
npm test

# Type check
npm run typecheck

# Migrate credentials from old file-based storage
DATABASE_URL=... CREDENTIAL_ENCRYPTION_KEY=... npm run migrate
```

## Project Structure

```
mail-cal-drive-mcp/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Express server
│   ├── config.ts             # Environment config
│   ├── logger.ts             # Structured console logger
│   ├── auth/
│   │   ├── types.ts          # Credential interfaces
│   │   ├── storage.ts        # Postgres credential storage
│   │   └── bearer.ts         # Bearer token middleware
│   ├── storage/
│   │   ├── postgres.ts       # Postgres client + encrypted CRUD
│   │   ├── msal-cache.ts     # MSAL cache plugin (Postgres)
│   │   └── pending-flows.ts  # Pending auth flow storage
│   ├── providers/
│   │   ├── base.ts           # Abstract interfaces
│   │   ├── types.ts          # Shared types
│   │   ├── microsoft/        # Graph API (mail, calendar, drive)
│   │   ├── google/           # Google APIs (Gmail, Calendar, Drive)
│   │   └── imap/             # ImapFlow (mail only)
│   ├── mcp/
│   │   ├── handler.ts        # MCP request routing
│   │   ├── session.ts        # Session management
│   │   └── tools/            # 35 MCP tools
│   └── utils/                # Timezone, recurrence, MIME helpers
├── db/migrations/            # Postgres schema
├── docker-compose.yml
├── Dockerfile
└── .env                      # Configuration (gitignored)
```

## License

[MIT](LICENSE)
