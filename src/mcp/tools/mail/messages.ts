/**
 * Mail message MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register mail message tools with the MCP server.
 */
export function registerMailMessageTools(server: McpServer): void {
  // list_messages - List messages in a folder
  server.tool(
    'list_messages',
    'List messages in an email folder',
    {
      accountId: z.string().describe('The account ID'),
      folder: z.string().optional().describe('Folder name/ID (default: INBOX)'),
      limit: z.number().optional().describe('Maximum number of messages (default: 50)'),
      pageToken: z.string().optional().describe('Pagination token from previous response'),
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

        const result = await provider.mail.listMessages(
          args.folder ?? 'INBOX',
          args.limit ?? 50,
          args.pageToken
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accountId: args.accountId,
                  folder: args.folder ?? 'INBOX',
                  messages: result.messages.map((m) => ({
                    id: m.id,
                    subject: m.subject,
                    from: m.from,
                    to: m.to,
                    date: m.date.toISOString(),
                    snippet: m.snippet,
                    isRead: m.isRead,
                    isStarred: m.isStarred,
                    hasAttachments: m.hasAttachments,
                  })),
                  count: result.messages.length,
                  nextPageToken: result.nextPageToken,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_messages failed', error);
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

  // get_message - Get full message details
  server.tool(
    'get_message',
    'Get full details of an email message including body',
    {
      accountId: z.string().describe('The account ID'),
      messageId: z.string().describe('The message ID'),
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

        const message = await provider.mail.getMessage(args.messageId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: message.id,
                  accountId: message.accountId,
                  threadId: message.threadId,
                  subject: message.subject,
                  from: message.from,
                  to: message.to,
                  cc: message.cc,
                  bcc: message.bcc,
                  date: message.date.toISOString(),
                  body: message.body,
                  bodyHtml: message.bodyHtml,
                  isRead: message.isRead,
                  isStarred: message.isStarred,
                  hasAttachments: message.hasAttachments,
                  attachments: message.attachments,
                  folder: message.folder,
                  labels: message.labels,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('get_message failed', error);
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
