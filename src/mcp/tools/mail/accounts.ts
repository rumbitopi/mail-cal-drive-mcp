/**
 * Mail account MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register mail account tools with the MCP server.
 */
export function registerMailAccountTools(server: McpServer): void {
  // list_accounts - List all email accounts
  server.tool(
    'list_accounts',
    'List all configured email accounts',
    {},
    async () => {
      try {
        const registry = getProviderRegistry();
        const accounts = await registry.listAccounts();

        // Filter to accounts with mail capability
        const mailAccounts = accounts.filter((a) => a.capabilities.includes('mail'));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accounts: mailAccounts.map((a) => ({
                    id: a.id,
                    name: a.name,
                    provider: a.provider,
                    email: a.email,
                    connected: a.connected,
                  })),
                  count: mailAccounts.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_accounts failed', error);
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
