/**
 * Mail search MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry, EmailSearchCriteria } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register mail search tools with the MCP server.
 */
export function registerMailSearchTools(server: McpServer): void {
  // search_messages - Search messages across folders and accounts
  server.tool(
    'search_messages',
    'Search for email messages matching criteria across one or more accounts',
    {
      accountIds: z.array(z.string()).describe('The account IDs to search'),
      from: z.string().optional().describe('Filter by sender email'),
      to: z.string().optional().describe('Filter by recipient email'),
      subject: z.string().optional().describe('Filter by subject (partial match)'),
      body: z.string().optional().describe('Search in message body'),
      folder: z.string().optional().describe('Limit search to specific folder'),
      hasAttachment: z.boolean().optional().describe('Filter by attachment presence'),
      isRead: z.boolean().optional().describe('Filter by read status'),
      isStarred: z.boolean().optional().describe('Filter by starred status'),
      after: z.string().optional().describe('Messages after this date (ISO 8601)'),
      before: z.string().optional().describe('Messages before this date (ISO 8601)'),
      labels: z.array(z.string()).optional().describe('Filter by labels (Gmail)'),
      limit: z.number().optional().describe('Maximum results per account (default: 50)'),
    },
    async (args) => {
      try {
        const registry = getProviderRegistry();
        const allMessages: Array<{
          accountId: string;
          id: string;
          subject: string;
          from: any;
          to: any;
          date: string;
          snippet: string;
          isRead: boolean;
          isStarred: boolean;
          hasAttachments: boolean;
          folder: string;
        }> = [];
        const errors: string[] = [];

        // Build criteria once
        const criteria: EmailSearchCriteria = {
          limit: args.limit ?? 50,
        };

        if (args.from) criteria.from = args.from;
        if (args.to) criteria.to = args.to;
        if (args.subject) criteria.subject = args.subject;
        if (args.body) criteria.body = args.body;
        if (args.folder) criteria.folder = args.folder;
        if (args.hasAttachment !== undefined) criteria.hasAttachment = args.hasAttachment;
        if (args.isRead !== undefined) criteria.isRead = args.isRead;
        if (args.isStarred !== undefined) criteria.isStarred = args.isStarred;
        if (args.after) criteria.after = new Date(args.after);
        if (args.before) criteria.before = new Date(args.before);
        if (args.labels) criteria.labels = args.labels;

        // Search across all specified accounts
        for (const accountId of args.accountIds) {
          try {
            const provider = await registry.getProvider(accountId);

            if (!provider) {
              errors.push(`${accountId}: Account not found or not connected`);
              continue;
            }

            if (!provider.mail) {
              errors.push(`${accountId}: Account does not support mail`);
              continue;
            }

            const messages = await provider.mail.searchMessages(criteria);

            // Add accountId to each message for identification
            for (const m of messages) {
              allMessages.push({
                accountId,
                id: m.id,
                subject: m.subject,
                from: m.from,
                to: m.to,
                date: m.date.toISOString(),
                snippet: m.snippet,
                isRead: m.isRead,
                isStarred: m.isStarred ?? false,
                hasAttachments: m.hasAttachments,
                folder: m.folder,
              });
            }
          } catch (error) {
            errors.push(
              `${accountId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }

        // Sort all messages by date, newest first
        allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const result: any = {
          accountIds: args.accountIds,
          criteria: {
            from: args.from,
            to: args.to,
            subject: args.subject,
            body: args.body,
            folder: args.folder,
            hasAttachment: args.hasAttachment,
            isRead: args.isRead,
            isStarred: args.isStarred,
            after: args.after,
            before: args.before,
            labels: args.labels,
          },
          messages: allMessages,
          count: allMessages.length,
        };

        if (errors.length > 0) {
          result.errors = errors;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('search_messages failed', error);
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
