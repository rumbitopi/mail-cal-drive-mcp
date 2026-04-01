/**
 * Drive file management MCP tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getProviderRegistry } from '../../../providers/index.js';
import { logger } from '../../../logger.js';
/**
 * Register drive management tools with the MCP server.
 */
export function registerDriveManageTools(server: McpServer): void {
  // upload_file - Upload a file
  server.tool(
    'upload_file',
    'Upload a file to drive. Provide content directly as text or base64.',
    {
      accountId: z.string().describe('The account ID'),
      folderId: z.string().optional().describe('Parent folder ID (default: root)'),
      name: z.string().describe('File name'),
      content: z.string().describe('File content (text or base64)'),
      mimeType: z.string().optional().describe('MIME type of the file'),
      isBase64: z.boolean().optional().describe('Content is base64 encoded'),
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

        const contentBuffer = args.isBase64
          ? Buffer.from(args.content, 'base64')
          : Buffer.from(args.content, 'utf-8');
        const mimeType = args.mimeType || 'application/octet-stream';

        const file = await provider.drive.uploadFile(
          args.folderId ?? null,
          args.name,
          contentBuffer,
          mimeType
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  file: {
                    id: file.id,
                    name: file.name,
                    mimeType: file.mimeType,
                    size: file.size,
                    webUrl: file.webUrl,
                    createdAt: file.createdAt.toISOString(),
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('upload_file failed', error);
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

  // create_folder - Create a new folder
  server.tool(
    'create_folder',
    'Create a new folder in drive',
    {
      accountId: z.string().describe('The account ID'),
      parentId: z.string().optional().describe('Parent folder ID (default: root)'),
      name: z.string().describe('Folder name'),
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

        const folder = await provider.drive.createFolder(args.parentId ?? null, args.name);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  folder: {
                    id: folder.id,
                    name: folder.name,
                    webUrl: folder.webUrl,
                    createdAt: folder.createdAt.toISOString(),
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('create_folder failed', error);
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

  // move_file - Move a file to a different folder
  server.tool(
    'move_file',
    'Move a file to a different folder',
    {
      accountId: z.string().describe('The account ID'),
      fileId: z.string().describe('The file ID'),
      newParentId: z.string().describe('Destination folder ID'),
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

        const file = await provider.drive.moveFile(args.fileId, args.newParentId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  file: {
                    id: file.id,
                    name: file.name,
                    parentId: file.parentId,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('move_file failed', error);
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

  // copy_file - Copy a file
  server.tool(
    'copy_file',
    'Copy a file to a new location',
    {
      accountId: z.string().describe('The account ID'),
      fileId: z.string().describe('The file ID'),
      newParentId: z.string().optional().describe('Destination folder ID'),
      newName: z.string().optional().describe('New file name'),
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

        const file = await provider.drive.copyFile(args.fileId, args.newParentId, args.newName);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  file: {
                    id: file.id,
                    name: file.name,
                    parentId: file.parentId,
                    webUrl: file.webUrl,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('copy_file failed', error);
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

  // rename_file - Rename a file
  server.tool(
    'rename_file',
    'Rename a file',
    {
      accountId: z.string().describe('The account ID'),
      fileId: z.string().describe('The file ID'),
      newName: z.string().describe('New file name'),
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

        const file = await provider.drive.renameFile(args.fileId, args.newName);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  file: {
                    id: file.id,
                    name: file.name,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('rename_file failed', error);
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

  // delete_file - Delete/trash a file
  server.tool(
    'delete_file',
    'Delete a file (moves to trash by default)',
    {
      accountId: z.string().describe('The account ID'),
      fileId: z.string().describe('The file ID'),
      permanent: z.boolean().optional().describe('Permanently delete (default: false)'),
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

        await provider.drive.deleteFile(args.fileId, args.permanent ?? false);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                fileId: args.fileId,
                permanent: args.permanent ?? false,
              }),
            },
          ],
        };
      } catch (error) {
        logger.error('delete_file failed', error);
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
