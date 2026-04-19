# Changelog

## [1.1.0] - 2026-04-19

### Added
- `get_attachment` tool — download email attachments across all providers
- Binary attachments (PDF, images) returned as MCP EmbeddedResource with blob
- Text attachments (txt, json, csv) returned as decoded UTF-8 text
- 5MB attachment size guard

### Security
- Encrypt MSAL token cache at rest (was plaintext JSONB)
- Encrypt pending auth flows at rest (device codes were plaintext)
- Fix reflected XSS in Google OAuth callback
- Use crypto.timingSafeEqual for bearer token comparison
- Add session TTL (30 min) and max limit (100) with LRU eviction
- Replace Math.random() with crypto.randomUUID() for auth/account IDs
- Bind Docker ports to 127.0.0.1 only
- Reduce body parser limit from 100MB to 10MB
- Fix GCM IV length to 12 bytes (NIST recommendation)

## [1.0.0] - 2026-04-01

### Added
- 36 MCP tools across email, calendar, and drive
- Microsoft 365 provider (Graph API) — mail, calendar, OneDrive
- Google Workspace provider — Gmail, Calendar, Drive
- IMAP provider — email only
- Docker Compose deployment with Postgres
- AES-256-GCM credential encryption in Postgres
- MSAL token cache persistence for silent Microsoft refresh
- Device code flow for Microsoft authentication
- OAuth callback flow for Google authentication
- Direct credential entry for IMAP
- Pending auth flow persistence across restarts
- Credential migration script from file-based storage
