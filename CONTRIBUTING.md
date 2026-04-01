# Contributing

Contributions are welcome! Here's how to get started.

## Development Setup

```bash
# Clone
git clone https://github.com/rumbitopi/mail-cal-drive-mcp.git
cd mail-cal-drive-mcp

# Install dependencies
npm install

# Copy env and configure
cp .env.example .env
# Edit .env with your DATABASE_URL, keys, and provider credentials

# Start Postgres (Docker) + dev server
docker compose up postgres -d
npm run dev

# Or start everything in Docker
docker compose up --build
```

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Make your changes
4. Run type checking: `npm run typecheck`
5. Run tests: `npm test`
6. Commit with a descriptive message
7. Push and open a Pull Request

## Code Style

- TypeScript with strict mode enabled
- No external linter — TypeScript strict checks are the standard
- Keep tool implementations in `src/mcp/tools/` organized by domain (mail, calendar, drive)
- Provider implementations go in `src/providers/{provider-name}/`
- All credentials must be encrypted before storage — never store plaintext tokens

## Adding a New MCP Tool

1. Create or edit the appropriate file in `src/mcp/tools/{domain}/`
2. Use Zod schemas for parameter validation
3. Register the tool in `src/mcp/tools/index.ts`
4. Update the tool count in README if adding new tools

## Adding a New Provider

1. Create a directory under `src/providers/{name}/`
2. Implement `IMailProvider`, `ICalendarProvider`, and/or `IDriveProvider` from `src/providers/base.ts`
3. Add auth flow support in `src/mcp/tools/auth.ts`
4. Add provider to the registry in `src/providers/index.ts`

## Questions?

Open an issue for questions or discussion.
