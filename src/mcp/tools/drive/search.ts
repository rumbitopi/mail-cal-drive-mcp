/**
 * Drive search MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry, FileSearchCriteria } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register drive search tools with the MCP server.
 */
export function registerDriveSearchTools(server: McpServer): void {
  // search_files - Search for files
  server.tool(
    'search_files',
    'Search for files matching criteria',
    {
      accountId: z.string().describe('The account ID'),
      query: z.string().optional().describe('Search query (file name)'),
      fullText: z.string().optional().describe('Full-text content search'),
      mimeType: z.string().optional().describe('Filter by MIME type'),
      folderId: z.string().optional().describe('Limit to specific folder'),
      includeTrash: z.boolean().optional().describe('Include trashed files'),
      modifiedAfter: z.string().optional().describe('Modified after (ISO 8601)'),
      modifiedBefore: z.string().optional().describe('Modified before (ISO 8601)'),
      sharedWithMe: z.boolean().optional().describe('Only shared files'),
      starred: z.boolean().optional().describe('Only starred files'),
      limit: z.number().optional().describe('Maximum results (default: 50)'),
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

        const criteria: FileSearchCriteria = {
          limit: args.limit ?? 50,
        };

        if (args.query) criteria.query = args.query;
        if (args.fullText) criteria.fullText = args.fullText;
        if (args.mimeType) criteria.mimeType = args.mimeType;
        if (args.folderId) criteria.folderId = args.folderId;
        if (args.includeTrash !== undefined) criteria.includeTrash = args.includeTrash;
        if (args.modifiedAfter) criteria.modifiedAfter = args.modifiedAfter;
        if (args.modifiedBefore) criteria.modifiedBefore = args.modifiedBefore;
        if (args.sharedWithMe !== undefined) criteria.sharedWithMe = args.sharedWithMe;
        if (args.starred !== undefined) criteria.starred = args.starred;

        const files = await provider.drive.searchFiles(criteria);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  accountId: args.accountId,
                  criteria: {
                    query: args.query,
                    fullText: args.fullText,
                    mimeType: args.mimeType,
                    folderId: args.folderId,
                    includeTrash: args.includeTrash,
                    modifiedAfter: args.modifiedAfter,
                    modifiedBefore: args.modifiedBefore,
                    sharedWithMe: args.sharedWithMe,
                    starred: args.starred,
                  },
                  files: files.map((f) => ({
                    id: f.id,
                    name: f.name,
                    mimeType: f.mimeType,
                    size: f.size,
                    isFolder: f.isFolder,
                    modifiedAt: f.modifiedAt.toISOString(),
                    webUrl: f.webUrl,
                    shared: f.shared,
                  })),
                  count: files.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('search_files failed', error);
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
