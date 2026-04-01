# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it through [GitHub's private security advisory feature](https://github.com/rumbitopi/mail-cal-drive-mcp/security/advisories/new).

**Do not** open a public issue for security vulnerabilities.

## Scope

This server handles sensitive data including:
- Microsoft 365 OAuth tokens (access + refresh)
- Google OAuth tokens (access + refresh)
- IMAP credentials (username + password, encrypted at rest)
- Email content, calendar events, and drive files via provider APIs

## Design Assumptions

- **Localhost only.** This server is designed to run on your local machine inside Docker. It binds to `localhost:3100` and should **not** be exposed to the internet or untrusted networks without additional hardening (reverse proxy, TLS, rate limiting).
- **Single user.** There is no multi-tenancy or user isolation. The bearer token is a shared secret.
- **Encryption at rest.** All credentials, MSAL token cache, and pending auth flows are encrypted with AES-256-GCM before storage in Postgres. The encryption key is in your `.env` file.

## What We Consider Vulnerabilities

- Credential leakage (tokens, passwords exposed in logs, responses, or storage)
- Authentication bypass (accessing endpoints without valid bearer token)
- Encryption weaknesses in credential storage
- Injection attacks via MCP tool parameters
- Unauthorized access to provider APIs beyond granted scopes

## What We Don't Consider Vulnerabilities

- Attacks requiring local access to the Docker host (the trust boundary is the machine)
- Denial of service against a localhost-only server
- Missing rate limiting (acceptable for single-user local use)
