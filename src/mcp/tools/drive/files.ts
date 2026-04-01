/**
 * Drive file MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';

/**
 * Register drive file tools with the MCP server.
 */
export function registerDriveFileTools(server: McpServer): void {
  // list_files - List files in a folder
  server.tool(
    'list_files',
    'List files in a drive folder',
    {
      accountId: z.string().describe('The account ID'),
      folderId: z.string().optional().describe('Folder ID (default: root)'),
      limit: z.number().optional().describe('Maximum files to return (default: 50)'),
      pageToken: z.string().optional().describe('Pagination token'),
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

        const result = await provider.drive.listFiles(
          args.folderId,
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
                  folderId: args.folderId ?? 'root',
                  files: result.files.map((f) => ({
                    id: f.id,
                    name: f.name,
                    mimeType: f.mimeType,
                    size: f.size,
                    isFolder: f.isFolder,
                    modifiedAt: f.modifiedAt.toISOString(),
                    webUrl: f.webUrl,
                    shared: f.shared,
                  })),
                  count: result.files.length,
                  nextPageToken: result.nextPageToken,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('list_files failed', error);
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

  // get_file - Get file metadata
  server.tool(
    'get_file',
    'Get file metadata and details',
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

        const file = await provider.drive.getFile(args.fileId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: file.id,
                  accountId: file.accountId,
                  name: file.name,
                  mimeType: file.mimeType,
                  size: file.size,
                  isFolder: file.isFolder,
                  parentId: file.parentId,
                  createdAt: file.createdAt.toISOString(),
                  modifiedAt: file.modifiedAt.toISOString(),
                  webUrl: file.webUrl,
                  downloadUrl: file.downloadUrl,
                  thumbnailUrl: file.thumbnailUrl,
                  description: file.description,
                  shared: file.shared,
                  starred: file.starred,
                  trashed: file.trashed,
                  createdBy: file.createdBy,
                  modifiedBy: file.modifiedBy,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('get_file failed', error);
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

  // get_file_content - Download file content
  server.tool(
    'get_file_content',
    'Download file content (returns base64 for binary, text for text files)',
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

        // Get file metadata first
        const file = await provider.drive.getFile(args.fileId);
        const content = await provider.drive.getFileContent(args.fileId);

        // Check if it's a text file
        const isText =
          file.mimeType.startsWith('text/') ||
          file.mimeType === 'application/json' ||
          file.mimeType === 'application/xml' ||
          file.mimeType.includes('javascript');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  fileId: args.fileId,
                  name: file.name,
                  mimeType: file.mimeType,
                  size: content.length,
                  encoding: isText ? 'utf-8' : 'base64',
                  content: isText ? content.toString('utf-8') : content.toString('base64'),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('get_file_content failed', error);
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
