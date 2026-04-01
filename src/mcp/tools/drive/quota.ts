/**
 * Drive storage quota MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Format bytes to human readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Register drive quota tools with the MCP server.
 */
export function registerDriveQuotaTools(server: McpServer): void {
  // get_storage_quota - Get storage usage information
  server.tool(
    'get_storage_quota',
    'Get storage quota and usage information',
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

        const quota = await provider.drive.getStorageQuota();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accountId: quota.accountId,
                  used: quota.used,
                  usedFormatted: formatBytes(quota.used),
                  total: quota.total,
                  totalFormatted: quota.total > 0 ? formatBytes(quota.total) : 'Unlimited',
                  usedPercentage: quota.usedPercentage.toFixed(2) + '%',
                  trash: quota.trash,
                  trashFormatted: formatBytes(quota.trash ?? 0),
                  available: quota.total > 0 ? quota.total - quota.used : -1,
                  availableFormatted:
                    quota.total > 0 ? formatBytes(quota.total - quota.used) : 'Unlimited',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('get_storage_quota failed', error);
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
