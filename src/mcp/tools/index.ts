/**
 * MCP Tools Registry.
 * Registers all available tools with the MCP server.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logger.js';

// Auth tools
import { registerAuthTools } from './auth.js';

// Mail tools
import { registerMailAccountTools } from './mail/accounts.js';
import { registerMailFolderTools } from './mail/folders.js';
import { registerMailMessageTools } from './mail/messages.js';
import { registerMailSearchTools } from './mail/search.js';
import { registerMailActionTools } from './mail/actions.js';

// Calendar tools
import { registerCalendarListTools } from './calendar/calendars.js';
import { registerCalendarEventTools } from './calendar/events.js';
import { registerCalendarManageTools } from './calendar/manage.js';
import { registerCalendarAvailabilityTools } from './calendar/availability.js';

// Drive tools
import { registerDriveFileTools } from './drive/files.js';
import { registerDriveSearchTools } from './drive/search.js';
import { registerDriveManageTools } from './drive/manage.js';
import { registerDriveShareTools } from './drive/share.js';
import { registerDriveQuotaTools } from './drive/quota.js';

/**
 * Register all MCP tools with the server.
 * Tools are organized by category: auth, mail, calendar, drive
 */
export function registerAllTools(server: McpServer): void {
  logger.info('Registering MCP tools');

  // Authentication tools (4 tools)
  // auth_status, auth_start, auth_complete, auth_revoke
  registerAuthTools(server);

  // Mail tools (9 tools)
  // list_accounts
  registerMailAccountTools(server);
  // list_folders
  registerMailFolderTools(server);
  // list_messages, get_message, get_attachment
  registerMailMessageTools(server);
  // search_messages
  registerMailSearchTools(server);
  // move_message, delete_message, mark_read, bulk_mail_action
  registerMailActionTools(server);

  // Calendar tools (8 tools)
  // list_calendars
  registerCalendarListTools(server);
  // list_events, get_event
  registerCalendarEventTools(server);
  // create_event, update_event, delete_event
  registerCalendarManageTools(server);
  // find_free_time, check_conflicts
  registerCalendarAvailabilityTools(server);

  // Drive tools (14 tools)
  // list_files, get_file, get_file_content
  registerDriveFileTools(server);
  // search_files
  registerDriveSearchTools(server);
  // upload_file, create_folder, move_file, copy_file, rename_file, delete_file
  registerDriveManageTools(server);
  // get_sharing, share_file, unshare_file
  registerDriveShareTools(server);
  // get_storage_quota
  registerDriveQuotaTools(server);

  logger.info('MCP tools registered', { count: 36 });
}

// Re-export for OAuth callback handling
export { getGoogleAuthFlow } from './auth.js';
