/**
 * Mail folder MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register mail folder tools with the MCP server.
 */
export function registerMailFolderTools(server: McpServer): void {
  // list_folders - List email folders/labels for an account
  server.tool(
    'list_folders',
    'List email folders/labels for an account',
    {
      accountId: z.string().describe('The account ID'),
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

        const folders = await provider.mail.listFolders();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accountId: args.accountId,
                  folders: folders.map((f) => ({
                    id: f.id,
                    name: f.name,
                    path: f.path,
                    type: f.type,
                    unreadCount: f.unreadCount,
                    totalCount: f.totalCount,
                    parentId: f.parentId,
                  })),
                  count: folders.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_folders failed', error);
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
