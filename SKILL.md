---
name: workspace-mcp
description: "Use when you need to access email, calendar, or cloud drive. Provides 35 tools for Microsoft 365, Google Workspace, and IMAP — read/search/manage email, create/check calendar events, browse/upload/share files. Triggers on: email, inbox, calendar, meeting, schedule, drive, files, OneDrive, Gmail, Outlook."
---

# Workspace MCP — Agent Skill

Access email, calendar, and cloud storage across Microsoft 365, Google Workspace, and IMAP accounts through 36 MCP tools.

## When to Use This Skill

Use this when the user asks you to:
- Read, search, or manage email (inbox, messages, folders)
- Check, create, or modify calendar events and meetings
- Find free time or check scheduling conflicts
- Browse, search, upload, or share files in cloud storage
- Perform bulk email operations (archive, delete, mark read)
- Work with multiple accounts across providers

**Do not use** for: composing email content (use your own writing), tasks that don't involve actual mailbox/calendar/drive data.

---

## MCP Server Setup

This skill requires the `workspace-mcp` server running locally in Docker.

### Prerequisites

- Docker and Docker Compose installed
- The server repo cloned and configured

### Starting the Server

```bash
cd /path/to/mail-cal-drive-mcp
docker compose up -d
```

Verify: `curl http://localhost:3100/health`

### Client Configuration

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

`supergateway` bridges Claude Desktop's stdio transport to this server's Streamable HTTP.

#### Claude Code

Add to `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "workspace": {
      "type": "streamable-http",
      "url": "http://localhost:3100/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

#### VS Code / Cursor

Use `streamable-http` type with `http://localhost:3100/mcp` and the Authorization header.

### Adding Accounts

Accounts are added once and persist across restarts.

**Microsoft 365:** Call `auth_start` with `provider: "microsoft"` → get a device code → visit URL → enter code → call `auth_complete`.

**Google:** Call `auth_start` with `provider: "google"` → get OAuth URL → sign in → call `auth_complete`.

**IMAP:** Call `auth_start` with `provider: "imap"` and all credentials inline → ready immediately.

---

## Tool Reference

### Discovering Accounts

Before using any tool, check what accounts are available:

**`auth_status`** — Lists all connected accounts with their IDs, providers, and capabilities. Use this first to get the `accountId` needed by all other tools.

---

### Email Tools

**`list_accounts`** — List all email-capable accounts.

**`list_folders`** — Get all folders/labels for an account.
- Use to find folder IDs before moving or filtering messages.

**`list_messages`** — Get messages from a folder with pagination.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `folder` | No | Folder name (default: INBOX) |
| `limit` | No | Max messages (default: 20) |
| `offset` | No | Pagination offset |

**`get_message`** — Get full message content including body and attachments.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `messageId` | Yes | Message ID from list/search |

**`get_attachment`** — Download an attachment. Text files returned decoded; binary files (PDF, images) returned as MCP blob resources.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `messageId` | Yes | Message ID |
| `attachmentId` | Yes | Attachment ID from `get_message` |

**`search_messages`** — Search across one or more accounts with rich filters.
| Param | Required | Description |
|-------|----------|-------------|
| `accountIds` | Yes | Array of account IDs to search |
| `from` | No | Sender email |
| `to` | No | Recipient email |
| `subject` | No | Subject (partial match) |
| `body` | No | Body content search |
| `folder` | No | Limit to folder |
| `hasAttachment` | No | Filter by attachment presence |
| `isRead` | No | Filter by read/unread |
| `after` | No | After date (ISO 8601) |
| `before` | No | Before date (ISO 8601) |
| `limit` | No | Max results per account (default: 50) |

**`move_message`** — Move a message to a different folder.

**`delete_message`** — Trash or permanently delete a message.

**`mark_read`** — Mark messages as read or unread.

**`bulk_mail_action`** — Batch operations on messages matching filters. **Always use `dryRun: true` first** to preview what will be affected.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `action` | Yes | `"move"`, `"delete"`, `"markRead"`, `"markUnread"`, `"star"`, `"unstar"`, `"archive"` |
| `dryRun` | No | Preview without executing (default: false) |
| `targetFolder` | No | Required for `"move"` action |
| Filter params | No | Same filters as `search_messages` |

---

### Calendar Tools

**`list_calendars`** — List all calendars for an account.

**`list_events`** — Get events in a date range.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `startDate` | Yes | Range start (ISO 8601) |
| `endDate` | Yes | Range end (ISO 8601) |
| `calendarId` | No | Specific calendar (default: primary) |

**`get_event`** — Full event details including attendees and recurrence.

**`create_event`** — Create a new event.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `title` | Yes | Event title |
| `startTime` | Yes | Start (ISO 8601) |
| `endTime` | Yes | End (ISO 8601) |
| `description` | No | Event description |
| `location` | No | Location |
| `attendees` | No | Array of `{email, optional?}` |
| `addConference` | No | Add video call link |
| `timeZone` | No | Time zone (default: UTC) |
| `visibility` | No | `"public"` or `"private"` |

**`update_event`** — Modify an existing event. Same params as create, plus `eventId`.

**`delete_event`** — Delete an event.

**`find_free_time`** — Find available time slots across accounts.
| Param | Required | Description |
|-------|----------|-------------|
| `accountIds` | Yes | Array of account IDs |
| `startDate` | Yes | Search range start (ISO 8601) |
| `endDate` | Yes | Search range end (ISO 8601) |
| `duration` | Yes | Required duration in minutes |

**`check_conflicts`** — Check if a proposed time conflicts with existing events.

---

### Drive Tools

**`list_files`** — List files and folders in a directory.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `folderId` | No | Folder to list (default: root) |

**`get_file`** — Get file metadata (name, size, modified date, sharing).

**`get_file_content`** — Download file content.

**`search_files`** — Search by name, content, or MIME type.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `query` | Yes | Search query |
| `mimeType` | No | Filter by MIME type |

**`upload_file`** — Upload a file.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `name` | Yes | File name |
| `content` | Yes | Text or base64 content |
| `folderId` | No | Parent folder (default: root) |
| `mimeType` | No | MIME type |
| `isBase64` | No | Content is base64 encoded |

**`create_folder`** — Create a new folder.

**`move_file`** / **`copy_file`** / **`rename_file`** — File management operations.

**`delete_file`** — Delete a file (trash or permanent).

**`get_sharing`** — View who has access to a file.

**`share_file`** — Share with a user, group, or create a public link.
| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Account ID |
| `fileId` | Yes | File ID |
| `type` | Yes | `"user"`, `"group"`, or `"anyone"` |
| `role` | Yes | `"reader"`, `"writer"`, `"commenter"` |
| `email` | No | Required for user/group |

**`unshare_file`** — Remove sharing permissions.

**`get_storage_quota`** — Check storage usage and limits.

---

## Workflow Patterns

### Check email and summarize

```
1. auth_status → get account IDs
2. list_messages(accountId, folder: "INBOX", limit: 10) → recent messages
3. get_message(accountId, messageId) → full content for important ones
```

### Download an attachment

```
1. auth_status → get account IDs
2. get_message(accountId, messageId) → see attachments[] with IDs
3. get_attachment(accountId, messageId, attachmentId) → text content or binary blob
```

### Schedule a meeting

```
1. auth_status → get account IDs
2. find_free_time(accountIds, startDate, endDate, duration: 60) → available slots
3. check_conflicts(accountId, proposedStart, proposedEnd) → verify no conflicts
4. create_event(accountId, title, startTime, endTime, attendees, addConference: true)
```

### Find and share a document

```
1. auth_status → get account IDs
2. search_files(accountId, query: "Q4 Report") → find the file
3. get_sharing(accountId, fileId) → check current permissions
4. share_file(accountId, fileId, type: "user", email: "...", role: "reader")
```

### Clean up old email

```
1. auth_status → get account IDs
2. bulk_mail_action(accountId, action: "archive", before: "2025-01-01", dryRun: true) → preview
3. bulk_mail_action(accountId, action: "archive", before: "2025-01-01", dryRun: false) → execute
```

## Important Notes

- **Always call `auth_status` first** to discover available accounts and their IDs.
- **Use `dryRun: true`** before any `bulk_mail_action` to preview the impact.
- **Dates are ISO 8601** (e.g., `2026-04-01T09:00:00-05:00`).
- **Multi-account**: `search_messages` and `find_free_time` accept arrays of account IDs to search across providers.
- **Destructive operations**: `delete_message`, `delete_event`, `delete_file`, and `bulk_mail_action` can permanently remove data. Confirm with the user before executing.
- **Sessions expire** after 30 minutes of inactivity. If a tool call returns "Invalid or expired session", the client will auto-reconnect.
- **All data encrypted at rest**: Credentials, MSAL token cache, and pending auth flows are AES-256-GCM encrypted in Postgres.
