/**
 * Drive sharing MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry, ShareInput } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register drive sharing tools with the MCP server.
 */
export function registerDriveShareTools(server: McpServer): void {
  // get_sharing - Get sharing information for a file
  server.tool(
    'get_sharing',
    'Get sharing information for a file',
    {
      accountId: z.string().describe('The account ID'),
      fileId: z.string().describe('The file ID'),
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

        if (!provider.drive) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support drive' }),
              },
            ],
            isError: true,
          };
        }

        const sharedUsers = await provider.drive.getSharing(args.fileId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  fileId: args.fileId,
                  sharedWith: sharedUsers.map((u) => ({
                    id: u.id,
                    email: u.email,
                    displayName: u.displayName,
                    role: u.role,
                    type: u.type,
                  })),
                  count: sharedUsers.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('get_sharing failed', error);
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

  // share_file - Share a file
  server.tool(
    'share_file',
    'Share a file with a user/group or create a public link',
    {
      accountId: z.string().describe('The account ID'),
      fileId: z.string().describe('The file ID'),
      type: z.enum(['user', 'group', 'anyone']).describe('Share type'),
      email: z.string().optional().describe('Email address (required for user/group)'),
      role: z
        .enum(['reader', 'writer', 'commenter'])
        .describe('Access role'),
      sendNotification: z.boolean().optional().describe('Send email notification'),
      message: z.string().optional().describe('Message to include in notification'),
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

        if (!provider.drive) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support drive' }),
              },
            ],
            isError: true,
          };
        }

        if ((args.type === 'user' || args.type === 'group') && !args.email) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Email required for user/group sharing' }),
              },
            ],
            isError: true,
          };
        }

        const input: ShareInput = {
          type: args.type,
          role: args.role,
        };

        if (args.email) input.email = args.email;
        if (args.sendNotification !== undefined) input.sendNotification = args.sendNotification;
        if (args.message) input.message = args.message;

        const result = await provider.drive.shareFile(args.fileId, input);

        // Check if result is a link or user
        if ('url' in result) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    fileId: args.fileId,
                    shareLink: {
                      url: result.url,
                      type: result.type,
                      scope: result.scope,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    fileId: args.fileId,
                    sharedUser: {
                      id: result.id,
                      email: result.email,
                      role: result.role,
                      type: result.type,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } catch (error) {
        logger.error('share_file failed', error);
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

  // unshare_file - Remove sharing permission
  server.tool(
    'unshare_file',
    'Remove sharing permission from a file',
    {
      accountId: z.string().describe('The account ID'),
      fileId: z.string().describe('The file ID'),
      permissionId: z.string().describe('The permission ID to remove'),
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

        if (!provider.drive) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Account does not support drive' }),
              },
            ],
            isError: true,
          };
        }

        await provider.drive.unshareFile(args.fileId, args.permissionId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                fileId: args.fileId,
                permissionId: args.permissionId,
                removed: true,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error('unshare_file failed', error);
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
