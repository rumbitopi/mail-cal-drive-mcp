/**
 * Microsoft OneDrive provider using Graph API.
 */

import { Client } from '@microsoft/microsoft-graph-client';
import { Readable } from 'stream';
import { IDriveProvider } from '../base.js';
import {
  DriveFile,
  FileSearchCriteria,
  FileListResult,
  ShareInput,
  SharedUser,
  ShareLink,
  StorageQuota,
  NotFoundError,
} from '../types.js';
import { logger } from '../../logger.js';

/**
 * Microsoft OneDrive provider implementation.
 */
export class MicrosoftDriveProvider implements IDriveProvider {
  readonly accountId: string;
  readonly capabilities = ['drive'] as const;
  private client: Client;

  constructor(accountId: string, client: Client) {
    this.accountId = accountId;
    this.client = client;
  }

  async listFiles(
    folderId?: string,
    limit: number = 50,
    pageToken?: string
  ): Promise<FileListResult> {
    const path = folderId
      ? `/me/drive/items/${folderId}/children`
      : '/me/drive/root/children';

    let request = this.client
      .api(path)
      .select(
        'id,name,size,file,folder,parentReference,createdDateTime,lastModifiedDateTime,webUrl,createdBy,lastModifiedBy,shared'
      )
      .top(limit);

    if (pageToken) {
      request = this.client.api(pageToken);
    }

    const response = await request.get();

    return {
      files: response.value.map((item: any) => this.mapFile(item)),
      nextPageToken: response['@odata.nextLink'],
    };
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const response = await this.client
      .api(`/me/drive/items/${fileId}`)
      .select(
        'id,name,size,file,folder,parentReference,createdDateTime,lastModifiedDateTime,webUrl,createdBy,lastModifiedBy,shared,@microsoft.graph.downloadUrl,description'
      )
      .get();

    if (!response) {
      throw new NotFoundError('microsoft', `File ${fileId}`);
    }

    return this.mapFile(response);
  }

  async getFileContent(fileId: string): Promise<Buffer> {
    const response = await this.client
      .api(`/me/drive/items/${fileId}/content`)
      .getStream();

    return this.streamToBuffer(response);
  }

  async searchFiles(criteria: FileSearchCriteria): Promise<DriveFile[]> {
    let query = criteria.query || criteria.fullText || '';

    if (!query) {
      // If no query, just list files
      const result = await this.listFiles(criteria.folderId, criteria.limit);
      return result.files;
    }

    const response = await this.client
      .api(`/me/drive/root/search(q='${encodeURIComponent(query)}')`)
      .select(
        'id,name,size,file,folder,parentReference,createdDateTime,lastModifiedDateTime,webUrl'
      )
      .top(criteria.limit || 50)
      .get();

    let files = response.value.map((item: any) => this.mapFile(item));

    // Apply additional filters
    if (criteria.mimeType) {
      files = files.filter((f: DriveFile) =>
        f.mimeType.startsWith(criteria.mimeType!)
      );
    }
    if (criteria.modifiedAfter) {
      const after = new Date(criteria.modifiedAfter);
      files = files.filter((f: DriveFile) => f.modifiedAt >= after);
    }
    if (criteria.modifiedBefore) {
      const before = new Date(criteria.modifiedBefore);
      files = files.filter((f: DriveFile) => f.modifiedAt <= before);
    }

    return files;
  }

  async uploadFile(
    folderId: string | null,
    name: string,
    content: Buffer,
    mimeType: string
  ): Promise<DriveFile> {
    const path = folderId
      ? `/me/drive/items/${folderId}:/${encodeURIComponent(name)}:/content`
      : `/me/drive/root:/${encodeURIComponent(name)}:/content`;

    // For files > 4MB, use upload session
    if (content.length > 4 * 1024 * 1024) {
      return this.uploadLargeFile(folderId, name, content, mimeType);
    }

    const response = await this.client
      .api(path)
      .putStream(Readable.from(content));

    logger.debug('File uploaded', { name, size: content.length });
    return this.mapFile(response);
  }

  private async uploadLargeFile(
    folderId: string | null,
    name: string,
    content: Buffer,
    mimeType: string
  ): Promise<DriveFile> {
    const path = folderId
      ? `/me/drive/items/${folderId}:/${encodeURIComponent(name)}:/createUploadSession`
      : `/me/drive/root:/${encodeURIComponent(name)}:/createUploadSession`;

    // Create upload session
    const session = await this.client.api(path).post({
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
      },
    });

    const uploadUrl = session.uploadUrl;
    const fileSize = content.length;
    const chunkSize = 10 * 1024 * 1024; // 10MB chunks
    let finalFile: any = null;

    // Upload chunks
    for (let i = 0; i < fileSize; i += chunkSize) {
      const chunk = content.slice(i, Math.min(i + chunkSize, fileSize));
      const end = Math.min(i + chunkSize, fileSize) - 1;

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': chunk.length.toString(),
          'Content-Range': `bytes ${i}-${end}/${fileSize}`,
        },
        body: chunk,
      });

      // 202 means chunk accepted, in progress - no JSON body
      // 200/201 means upload complete - response contains the file
      if (response.status === 200 || response.status === 201) {
        finalFile = await response.json();
      } else if (response.status === 202) {
        // Upload session in progress, continue with next chunk
        continue;
      } else {
        throw new Error(`Upload chunk failed: ${response.statusText}`);
      }
    }

    if (!finalFile) {
      throw new Error('Upload completed but no file metadata returned');
    }

    logger.debug('Large file uploaded', { name, size: fileSize });
    return this.mapFile(finalFile);
  }

  async createFolder(parentId: string | null, name: string): Promise<DriveFile> {
    const path = parentId
      ? `/me/drive/items/${parentId}/children`
      : '/me/drive/root/children';

    const response = await this.client.api(path).post({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    });

    logger.debug('Folder created', { name, parentId });
    return this.mapFile(response);
  }

  async moveFile(fileId: string, newParentId: string): Promise<DriveFile> {
    const response = await this.client.api(`/me/drive/items/${fileId}`).patch({
      parentReference: { id: newParentId },
    });

    logger.debug('File moved', { fileId, newParentId });
    return this.mapFile(response);
  }

  async copyFile(
    fileId: string,
    newParentId?: string,
    newName?: string
  ): Promise<DriveFile> {
    const body: any = {};
    if (newParentId) {
      body.parentReference = { id: newParentId };
    }
    if (newName) {
      body.name = newName;
    }

    // Copy is async, returns a monitor URL in the Location header
    // The client.api().post() returns the response body, but for copy it may be empty
    // We need to use a lower-level approach to get the Location header
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/copy`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.getAccessToken()}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok && response.status !== 202) {
      throw new Error(`Copy failed: ${response.statusText}`);
    }

    const monitorUrl = response.headers.get('Location');
    if (monitorUrl) {
      // Poll the monitor URL until copy completes
      const maxAttempts = 30; // 30 seconds max wait
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const statusRes = await fetch(monitorUrl);
        if (statusRes.status === 200) {
          // Copy complete, response contains the new file
          const newFile = await statusRes.json() as any;
          logger.debug('File copy completed', { fileId, newFileId: newFile.id });
          return this.mapFile(newFile);
        } else if (statusRes.status === 202) {
          // Still in progress
          continue;
        } else {
          throw new Error(`Copy monitoring failed: ${statusRes.statusText}`);
        }
      }
      throw new Error('Copy timed out after 30 seconds');
    }

    logger.debug('File copy initiated', { fileId, newParentId, newName });
    // Fallback: return original file info
    return this.getFile(fileId);
  }

  /**
   * Get current access token for direct API calls.
   */
  private async getAccessToken(): Promise<string> {
    // The client's authProvider is set up to return a token
    return new Promise((resolve, reject) => {
      (this.client as any).config.authProvider((err: Error | null, token: string) => {
        if (err) reject(err);
        else resolve(token);
      });
    });
  }

  async renameFile(fileId: string, newName: string): Promise<DriveFile> {
    const response = await this.client.api(`/me/drive/items/${fileId}`).patch({
      name: newName,
    });

    logger.debug('File renamed', { fileId, newName });
    return this.mapFile(response);
  }

  async deleteFile(fileId: string, permanent: boolean = false): Promise<void> {
    // OneDrive always moves to recycle bin first
    await this.client.api(`/me/drive/items/${fileId}`).delete();

    logger.debug('File deleted', { fileId, permanent });
  }

  async getSharing(fileId: string): Promise<SharedUser[]> {
    const response = await this.client
      .api(`/me/drive/items/${fileId}/permissions`)
      .get();

    return response.value
      .filter((p: any) => p.grantedTo || p.grantedToIdentities)
      .map((p: any) => this.mapPermission(p));
  }

  async shareFile(fileId: string, input: ShareInput): Promise<SharedUser | ShareLink> {
    if (input.type === 'anyone') {
      // Create sharing link
      const response = await this.client
        .api(`/me/drive/items/${fileId}/createLink`)
        .post({
          type: input.role === 'reader' ? 'view' : 'edit',
          scope: 'anonymous',
        });

      return {
        url: response.link.webUrl,
        type: input.role === 'reader' ? 'view' : 'edit',
        scope: 'anonymous',
      };
    } else {
      // Invite specific user
      const response = await this.client
        .api(`/me/drive/items/${fileId}/invite`)
        .post({
          recipients: [{ email: input.email }],
          roles: [input.role],
          sendInvitation: input.sendNotification ?? true,
          message: input.message,
        });

      logger.debug('File shared', { fileId, email: input.email, role: input.role });

      return {
        id: response.value[0]?.id || '',
        email: input.email || '',
        role: input.role as any,
        type: 'user',
      };
    }
  }

  async unshareFile(fileId: string, permissionId: string): Promise<void> {
    await this.client
      .api(`/me/drive/items/${fileId}/permissions/${permissionId}`)
      .delete();

    logger.debug('File unshared', { fileId, permissionId });
  }

  async getStorageQuota(): Promise<StorageQuota> {
    const response = await this.client
      .api('/me/drive')
      .select('quota')
      .get();

    const quota = response.quota;
    const used = quota.used || 0;
    const total = quota.total || 0;

    return {
      accountId: this.accountId,
      used,
      total,
      usedPercentage: total > 0 ? (used / total) * 100 : 0,
      trash: quota.deleted,
    };
  }

  /**
   * Convert stream to buffer.
   */
  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Map Graph drive item to our DriveFile type.
   */
  private mapFile(item: any): DriveFile {
    const file: DriveFile = {
      id: item.id,
      accountId: this.accountId,
      name: item.name,
      mimeType: item.file?.mimeType || 'application/vnd.ms-folder',
      size: item.size || 0,
      isFolder: !!item.folder,
      createdAt: new Date(item.createdDateTime),
      modifiedAt: new Date(item.lastModifiedDateTime),
      shared: !!item.shared,
    };

    if (item.parentReference?.id) file.parentId = item.parentReference.id;
    if (item.parentReference?.path) file.path = item.parentReference.path;
    if (item.webUrl) file.webUrl = item.webUrl;
    if (item['@microsoft.graph.downloadUrl']) file.downloadUrl = item['@microsoft.graph.downloadUrl'];
    if (item.createdBy?.user) {
      file.createdBy = {
        email: item.createdBy.user.email,
        displayName: item.createdBy.user.displayName,
      };
    }
    if (item.lastModifiedBy?.user) {
      file.modifiedBy = {
        email: item.lastModifiedBy.user.email,
        displayName: item.lastModifiedBy.user.displayName,
      };
    }
    if (item.description) file.description = item.description;

    return file;
  }

  /**
   * Map Graph permission to SharedUser.
   */
  private mapPermission(perm: any): SharedUser {
    const identity = perm.grantedTo?.user || perm.grantedToIdentities?.[0]?.user;
    return {
      id: perm.id,
      email: identity?.email || '',
      displayName: identity?.displayName,
      role: this.mapRole(perm.roles),
      type: perm.grantedTo ? 'user' : 'anyone',
    };
  }

  /**
   * Map Graph roles to our role type.
   */
  private mapRole(roles: string[]): 'owner' | 'writer' | 'commenter' | 'reader' {
    if (roles.includes('owner')) return 'owner';
    if (roles.includes('write')) return 'writer';
    if (roles.includes('read')) return 'reader';
    return 'reader';
  }
}
