# Workspace MCP Server - Project Instructions

## Project Overview
Self-hosted MCP server for multi-account email, calendar, and cloud storage management.
Runs in Docker with local Postgres for persistent credential and token storage.

**Stack:** Node.js 20+, TypeScript 5.4+, Express, MCP SDK, Postgres
**Providers:** Microsoft 365, Google Workspace, IMAP
**Transport:** Streamable HTTP on port 3100

## Development Commands

```bash
# Install dependencies
npm install

# Start Postgres + MCP server (Docker)
docker compose up --build

# Development with hot reload (requires local Postgres)
npm run dev

# Build TypeScript
npm run build

# Production start (requires local Postgres)
npm start

# Run tests
npm test

# Type check
npm run typecheck

# Migrate credentials from old local files to Postgres
DATABASE_URL=... CREDENTIAL_ENCRYPTION_KEY=... npm run migrate
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point |
| `src/server.ts` | Express server setup |
| `src/mcp/handler.ts` | MCP request routing (session-based) |
| `src/auth/storage.ts` | Credential storage (Postgres-backed) |
| `src/storage/postgres.ts` | Postgres client + encrypted CRUD |
| `src/storage/msal-cache.ts` | MSAL cache plugin (Postgres) |
| `src/storage/pending-flows.ts` | Pending auth flow storage |
| `src/providers/` | Provider implementations |
| `src/mcp/tools/` | MCP tool definitions (36 tools) |

## Environment Variables

Required in `.env`:
```
POSTGRES_PASSWORD=<password>
DATABASE_URL=postgresql://mcp:<password>@localhost:5432/workspace_mcp
CREDENTIAL_ENCRYPTION_KEY=<64-hex-chars>
API_KEY=<min-32-chars>

# Microsoft 365 (optional)
MS_ENABLED=true
MS_CLIENT_ID=
MS_TENANT_ID=common

# Google (optional)
GOOGLE_ENABLED=true
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3100/auth/google/callback

# IMAP (optional)
IMAP_ENABLED=true
```

## Architecture

- **Docker Compose**: Postgres 16 + Node.js MCP server
- **All sensitive data encrypted at rest**: Credentials, MSAL cache, and pending auth flows encrypted with AES-256-GCM before Postgres storage
- **Sessions in memory**: Max 100, 30-min TTL, auto-evicted. Lost on restart (clients auto-reconnect)
- **Ports bound to 127.0.0.1**: Not accessible from other machines

## MCP Tools Reference

### Authentication (4 tools)
- `auth_status` - List all accounts
- `auth_start` - Start OAuth/device code flow
- `auth_complete` - Complete pending authentication
- `auth_revoke` - Remove account

### Email (10 tools)
- `list_accounts`, `list_folders`, `list_messages`, `get_message`
- `get_attachment`, `search_messages`, `move_message`, `delete_message`
- `mark_read`, `bulk_mail_action`

### Calendar (8 tools)
- `list_calendars`, `list_events`, `get_event`
- `create_event`, `update_event`, `delete_event`
- `find_free_time`, `check_conflicts`

### Drive (14 tools)
- `list_files`, `get_file`, `get_file_content`, `search_files`
- `upload_file`, `create_folder`, `move_file`, `copy_file`
- `rename_file`, `delete_file`
- `get_sharing`, `share_file`, `unshare_file`, `get_storage_quota`

## Testing the Server

```bash
# Health check
curl http://localhost:3100/health

# MCP initialize
curl -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}},"id":1}'
```

## Code Patterns

### MCP Tool Registration
```typescript
server.tool('tool_name', 'Description', {
  param: z.string().describe('Parameter description')
}, async ({ param }) => {
  return { content: [{ type: 'text', text: result }] };
});
```

### Provider Interface
All providers implement `IMailProvider`, `ICalendarProvider`, or `IDriveProvider` from `src/providers/base.ts`.

### Error Handling
Use MCP error codes: -32600 (Invalid Request), -32601 (Method not found), -32602 (Invalid params), -32603 (Internal error).

## Security Notes

- Credentials encrypted with AES-256-GCM before storage in Postgres
- Encryption key stored in .env (never committed)
- Bearer token required for all endpoints except `/health` and `/auth/google/callback`
- Logger writes to stderr only (MCP requirement)
- Never log sensitive data (tokens, passwords)

## Documentation Lookup

Use Context7 MCP for up-to-date documentation:
- `@modelcontextprotocol/sdk` - MCP SDK (Streamable HTTP transport, tool registration)
- `googleapis` - Google APIs (Gmail, Calendar, Drive)
- `@microsoft/microsoft-graph-client` - Microsoft Graph API
- `@azure/msal-node` - Microsoft authentication
- `imapflow` - IMAP client
- `express` - HTTP server
- `zod` - Schema validation
