/**
 * Calendar list MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register calendar list tools with the MCP server.
 */
export function registerCalendarListTools(server: McpServer): void {
  // list_calendars - List all calendars for an account
  server.tool(
    'list_calendars',
    'List all calendars for an account',
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

        if (!provider.calendar) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support calendar' }),
              },
            ],
            isError: true,
          };
        }

        const calendars = await provider.calendar.listCalendars();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accountId: args.accountId,
                  calendars: calendars.map((c) => ({
                    id: c.id,
                    name: c.name,
                    description: c.description,
                    color: c.color,
                    isDefault: c.isDefault,
                    isReadOnly: c.isReadOnly,
                    timeZone: c.timeZone,
                    canEdit: c.canEdit,
                    canShare: c.canShare,
                  })),
                  count: calendars.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_calendars failed', error);
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
