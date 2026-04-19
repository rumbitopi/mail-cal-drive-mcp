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

  // get_attachment - Download attachment content
  server.tool(
    'get_attachment',
    'Download an email attachment. Returns text content for text types, or an embedded blob resource for binary files (PDF, images, etc). Use get_message first to see attachment IDs.',
    {
      accountId: z.string().describe('The account ID'),
      messageId: z.string().describe('The message ID'),
      attachmentId: z.string().describe('The attachment ID from get_message'),
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

        const attachment = await provider.mail.getAttachment(
          args.messageId,
          args.attachmentId
        );

        // Guard: reject attachments over 5MB
        const MAX_SIZE = 5 * 1024 * 1024;
        if (attachment.size > MAX_SIZE) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: `Attachment too large (${(attachment.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`,
                  name: attachment.name,
                  size: attachment.size,
                }),
              },
            ],
            isError: true,
          };
        }

        // Text-based attachments: return as text content
        const isText = attachment.contentType.startsWith('text/') ||
          attachment.contentType === 'application/json' ||
          attachment.contentType === 'application/xml' ||
          attachment.contentType === 'application/javascript';

        if (isText) {
          const decoded = Buffer.from(attachment.content, 'base64').toString('utf8');
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  name: attachment.name,
                  contentType: attachment.contentType,
                  size: attachment.size,
                  content: decoded,
                }, null, 2),
              },
            ],
          };
        }

        // Binary attachments: return as embedded blob resource
        const uri = `attachment://${args.accountId}/${args.messageId}/${args.attachmentId}/${encodeURIComponent(attachment.name)}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                name: attachment.name,
                contentType: attachment.contentType,
                size: attachment.size,
              }),
            },
            {
              type: 'resource' as const,
              resource: {
                uri,
                mimeType: attachment.contentType,
                blob: attachment.content,
              },
            },
          ],
        };
      } catch (error) {
        logger.error('get_attachment failed', error);
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
