/**
 * Mail action MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getProviderRegistry,
  EmailSearchCriteria,
  BulkMailAction,
} from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register mail action tools with the MCP server.
 */
export function registerMailActionTools(server: McpServer): void {
  // move_message - Move a message to a different folder
  server.tool(
    'move_message',
    'Move an email message to a different folder',
    {
      accountId: z.string().describe('The account ID'),
      messageId: z.string().describe('The message ID'),
      toFolder: z.string().describe('Destination folder name/ID'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const provider = await registry.getProvider(args.accountId);

        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account not found or not connected' }),
              },
            ],
            isError: true,
          };
        }

        if (!provider.mail) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support mail' }),
              },
            ],
            isError: true,
          };
        }

        await provider.mail.moveMessage(args.messageId, args.toFolder);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                messageId: args.messageId,
                toFolder: args.toFolder,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error('move_message failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // delete_message - Delete/trash a message
  server.tool(
    'delete_message',
    'Delete an email message (moves to trash by default)',
    {
      accountId: z.string().describe('The account ID'),
      messageId: z.string().describe('The message ID'),
      permanent: z.boolean().optional().describe('Permanently delete (default: false)'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const provider = await registry.getProvider(args.accountId);

        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account not found or not connected' }),
              },
            ],
            isError: true,
          };
        }

        if (!provider.mail) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support mail' }),
              },
            ],
            isError: true,
          };
        }

        await provider.mail.deleteMessage(args.messageId, args.permanent ?? false);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                messageId: args.messageId,
                permanent: args.permanent ?? false,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error('delete_message failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // mark_read - Mark message as read/unread
  server.tool(
    'mark_read',
    'Mark an email message as read or unread',
    {
      accountId: z.string().describe('The account ID'),
      messageId: z.string().describe('The message ID'),
      read: z.boolean().describe('True to mark read, false to mark unread'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const provider = await registry.getProvider(args.accountId);

        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account not found or not connected' }),
              },
            ],
            isError: true,
          };
        }

        if (!provider.mail) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support mail' }),
              },
            ],
            isError: true,
          };
        }

        await provider.mail.markRead(args.messageId, args.read);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                messageId: args.messageId,
                read: args.read,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error('mark_read failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // bulk_mail_action - Perform bulk actions on messages
  server.tool(
    'bulk_mail_action',
    'Perform bulk actions on messages matching criteria',
    {
      accountId: z.string().describe('The account ID'),
      action: z
        .enum(['move', 'delete', 'markRead', 'markUnread', 'star', 'unstar', 'archive'])
        .describe('Action to perform'),
      targetFolder: z.string().optional().describe('Destination folder (required for move)'),
      dryRun: z.boolean().optional().describe('Preview without executing (default: false)'),
      // Search criteria
      from: z.string().optional().describe('Filter by sender'),
      to: z.string().optional().describe('Filter by recipient'),
      subject: z.string().optional().describe('Filter by subject'),
      folder: z.string().optional().describe('Limit to specific folder'),
      hasAttachment: z.boolean().optional().describe('Filter by attachment'),
      isRead: z.boolean().optional().describe('Filter by read status'),
      isStarred: z.boolean().optional().describe('Filter by starred status'),
      after: z.string().optional().describe('After date (ISO 8601)'),
      before: z.string().optional().describe('Before date (ISO 8601)'),
      labels: z.array(z.string()).optional().describe('Filter by labels'),
      limit: z.number().optional().describe('Maximum messages to process'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const provider = await registry.getProvider(args.accountId);

        if (!provider) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account not found or not connected' }),
              },
            ],
            isError: true,
          };
        }

        if (!provider.mail || !provider.mail.bulkAction) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support mail' }),
              },
            ],
            isError: true,
          };
        }

        if (args.action === 'move' && !args.targetFolder) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'targetFolder required for move action' }),
              },
            ],
            isError: true,
          };
        }

        const criteria: EmailSearchCriteria = {
          limit: args.limit ?? 100,
        };

        if (args.from) criteria.from = args.from;
        if (args.to) criteria.to = args.to;
        if (args.subject) criteria.subject = args.subject;
        if (args.folder) criteria.folder = args.folder;
        if (args.hasAttachment !== undefined) criteria.hasAttachment = args.hasAttachment;
        if (args.isRead !== undefined) criteria.isRead = args.isRead;
        if (args.isStarred !== undefined) criteria.isStarred = args.isStarred;
        if (args.after) criteria.after = new Date(args.after);
        if (args.before) criteria.before = new Date(args.before);
        if (args.labels) criteria.labels = args.labels;

        const bulkAction: BulkMailAction = {
          action: args.action,
          criteria,
          dryRun: args.dryRun ?? false,
        };

        if (args.targetFolder) {
          bulkAction.targetFolder = args.targetFolder;
        }

        const result = await provider.mail.bulkAction(bulkAction);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: result.success,
                  action: args.action,
                  affected: result.affected,
                  messageIds: result.messageIds,
                  dryRun: args.dryRun ?? false,
                  errors: result.errors,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('bulk_mail_action failed', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
