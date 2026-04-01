/**
 * Google Drive provider.
 */

import { google, drive_v3 } from 'googleapis';
import { Auth } from 'googleapis';
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
 * Google Drive provider implementation.
 */
export class GoogleDriveProvider implements IDriveProvider {
  readonly accountId: string;
  readonly capabilities = ['drive'] as const;
  private drive: drive_v3.Drive;

  constructor(accountId: string, auth: Auth.OAuth2Client) {
    this.accountId = accountId;
    this.drive = google.drive({ version: 'v3', auth });
  }

  async listFiles(
    folderId?: string,
    limit: number = 50,
    pageToken?: string
  ): Promise<FileListResult> {
    const query = folderId
      ? `'${folderId}' in parents and trashed = false`
      : `'root' in parents and trashed = false`;

    const response = await this.drive.files.list({
      q: query,
      pageSize: limit,
      pageToken: pageToken,
      fields:
        'nextPageToken, files(id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,owners,shared,sharingUser,permissions)',
      orderBy: 'folder,name',
    });

    return {
      files: (response.data.files || []).map((f) => this.mapFile(f)),
      nextPageToken: response.data.nextPageToken || undefined,
    };
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const response = await this.drive.files.get({
      fileId,
      fields:
        'id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,owners,shared,sharingUser,permissions,description,starred,trashed',
    });

    if (!response.data) {
      throw new NotFoundError('google', `File ${fileId}`);
    }

    return this.mapFile(response.data);
  }

  async getFileContent(fileId: string): Promise<Buffer> {
    const response = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    return Buffer.from(response.data as ArrayBuffer);
  }

  async searchFiles(criteria: FileSearchCriteria): Promise<DriveFile[]> {
    const queryParts: string[] = [];

    if (criteria.query) {
      queryParts.push(`name contains '${criteria.query}'`);
    }
    if (criteria.fullText) {
      queryParts.push(`fullText contains '${criteria.fullText}'`);
    }
    if (criteria.mimeType) {
      if (criteria.mimeType.endsWith('/')) {
        queryParts.push(`mimeType contains '${criteria.mimeType}'`);
      } else {
        queryParts.push(`mimeType = '${criteria.mimeType}'`);
      }
    }
    if (criteria.folderId) {
      queryParts.push(`'${criteria.folderId}' in parents`);
    }
    if (!criteria.includeTrash) {
      queryParts.push('trashed = false');
    }
    if (criteria.modifiedAfter) {
      queryParts.push(`modifiedTime > '${criteria.modifiedAfter}'`);
    }
    if (criteria.modifiedBefore) {
      queryParts.push(`modifiedTime < '${criteria.modifiedBefore}'`);
    }
    if (criteria.sharedWithMe) {
      queryParts.push('sharedWithMe = true');
    }
    if (criteria.starred) {
      queryParts.push('starred = true');
    }

    const response = await this.drive.files.list({
      q: queryParts.join(' and ') || undefined,
      pageSize: criteria.limit || 50,
      fields:
        'files(id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,owners,shared)',
    });

    return (response.data.files || []).map((f) => this.mapFile(f));
  }

  async uploadFile(
    folderId: string | null,
    name: string,
    content: Buffer,
    mimeType: string
  ): Promise<DriveFile> {
    const fileMetadata: drive_v3.Schema$File = {
      name,
      parents: folderId ? [folderId] : undefined,
    };

    const media = {
      mimeType,
      body: Readable.from(content),
    };

    const response = await this.drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink',
    });

    logger.debug('File uploaded', { name, size: content.length });
    return this.mapFile(response.data);
  }

  async createFolder(parentId: string | null, name: string): Promise<DriveFile> {
    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
      fields: 'id,name,mimeType,createdTime,modifiedTime,webViewLink',
    });

    logger.debug('Folder created', { name, parentId });
    return this.mapFile(response.data);
  }

  async moveFile(fileId: string, newParentId: string): Promise<DriveFile> {
    // Get current parents
    const file = await this.drive.files.get({
      fileId,
      fields: 'parents',
    });

    const previousParents = file.data.parents?.join(',') || '';

    const response = await this.drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: previousParents,
      fields: 'id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink',
    });

    logger.debug('File moved', { fileId, newParentId });
    return this.mapFile(response.data);
  }

  async copyFile(
    fileId: string,
    newParentId?: string,
    newName?: string
  ): Promise<DriveFile> {
    const response = await this.drive.files.copy({
      fileId,
      requestBody: {
        parents: newParentId ? [newParentId] : undefined,
        name: newName,
      },
      fields: 'id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink',
    });

    logger.debug('File copied', { fileId, newParentId, newName });
    return this.mapFile(response.data);
  }

  async renameFile(fileId: string, newName: string): Promise<DriveFile> {
    const response = await this.drive.files.update({
      fileId,
      requestBody: { name: newName },
      fields: 'id,name,mimeType,size,parents,createdTime,modifiedTime,webViewLink',
    });

    logger.debug('File renamed', { fileId, newName });
    return this.mapFile(response.data);
  }

  async deleteFile(fileId: string, permanent: boolean = false): Promise<void> {
    if (permanent) {
      await this.drive.files.delete({ fileId });
    } else {
      await this.drive.files.update({
        fileId,
        requestBody: { trashed: true },
      });
    }

    logger.debug('File deleted', { fileId, permanent });
  }

  async getSharing(fileId: string): Promise<SharedUser[]> {
    const response = await this.drive.permissions.list({
      fileId,
      fields: 'permissions(id,type,emailAddress,role,displayName)',
    });

    return (response.data.permissions || [])
      .filter((p) => p.type === 'user' || p.type === 'group')
      .map((p) => {
        const user: SharedUser = {
          id: p.id || '',
          email: p.emailAddress || '',
          role: this.mapRole(p.role),
          type: p.type as 'user' | 'group',
        };
        if (p.displayName) user.displayName = p.displayName;
        return user;
      });
  }

  async shareFile(fileId: string, input: ShareInput): Promise<SharedUser | ShareLink> {
    if (input.type === 'anyone') {
      const response = await this.drive.permissions.create({
        fileId,
        requestBody: {
          type: 'anyone',
          role: input.role,
        },
      });

      const file = await this.drive.files.get({
        fileId,
        fields: 'webViewLink',
      });

      return {
        url: file.data.webViewLink || '',
        type: input.role === 'reader' ? 'view' : 'edit',
        scope: 'anonymous',
      };
    } else {
      const response = await this.drive.permissions.create({
        fileId,
        sendNotificationEmail: input.sendNotification ?? true,
        emailMessage: input.message,
        requestBody: {
          type: input.type,
          role: input.role,
          emailAddress: input.email,
        },
      });

      logger.debug('File shared', { fileId, email: input.email, role: input.role });

      return {
        id: response.data.id || '',
        email: input.email || '',
        role: input.role as any,
        type: input.type as 'user' | 'group',
      };
    }
  }

  async unshareFile(fileId: string, permissionId: string): Promise<void> {
    await this.drive.permissions.delete({
      fileId,
      permissionId,
    });

    logger.debug('File unshared', { fileId, permissionId });
  }

  async getStorageQuota(): Promise<StorageQuota> {
    const response = await this.drive.about.get({
      fields: 'storageQuota',
    });

    const quota = response.data.storageQuota;
    const used = parseInt(quota?.usage || '0', 10);
    const total = parseInt(quota?.limit || '-1', 10);

    return {
      accountId: this.accountId,
      used,
      total,
      usedPercentage: total > 0 ? (used / total) * 100 : 0,
      trash: parseInt(quota?.usageInDriveTrash || '0', 10),
    };
  }

  /**
   * Map Google Drive file to our DriveFile type.
   */
  private mapFile(file: drive_v3.Schema$File): DriveFile {
    const driveFile: DriveFile = {
      id: file.id || '',
      accountId: this.accountId,
      name: file.name || '',
      mimeType: file.mimeType || 'application/octet-stream',
      size: parseInt(file.size || '0', 10),
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      createdAt: new Date(file.createdTime || Date.now()),
      modifiedAt: new Date(file.modifiedTime || Date.now()),
      shared: file.shared || false,
    };

    if (file.parents?.[0]) driveFile.parentId = file.parents[0];
    if (file.webViewLink) driveFile.webUrl = file.webViewLink;
    if (file.webContentLink) driveFile.downloadUrl = file.webContentLink;
    if (file.thumbnailLink) driveFile.thumbnailUrl = file.thumbnailLink;
    if (file.description) driveFile.description = file.description;
    if (file.starred) driveFile.starred = file.starred;
    if (file.trashed) driveFile.trashed = file.trashed;

    if (file.owners?.[0]) {
      driveFile.createdBy = {
        email: file.owners[0].emailAddress ?? undefined,
        displayName: file.owners[0].displayName ?? undefined,
      };
    }

    return driveFile;
  }

  /**
   * Map Google role to our role type.
   */
  private mapRole(role?: string | null): 'owner' | 'writer' | 'commenter' | 'reader' {
    switch (role) {
      case 'owner':
        return 'owner';
      case 'writer':
        return 'writer';
      case 'commenter':
        return 'commenter';
      default:
        return 'reader';
    }
  }
}
