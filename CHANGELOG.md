# Changelog

## [1.0.0] - 2026-04-01

### Added
- 35 MCP tools across email, calendar, and drive
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
